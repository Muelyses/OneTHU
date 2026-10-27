/** Shared course and assignment service for independent CLI and graphical hosts. */
import type { CourseInfo, CourseFile, Homework, Notification, LearnAttachment } from "@onethu/core";
export interface CliLearnOperation {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  mutation?: boolean;
  run: (...args: any[]) => Promise<unknown>;
}
export type LearnContext = { epoch: number; owner: string };
type Context = LearnContext;
type ResourceKind = "file" | "homework" | "notification" | "inline";
type ResourceReference = {
  resourceRef: string; resourceId: string; courseId: string; semesterId: string;
  kind: ResourceKind; parentId?: string; title: string; filename: string;
  attachmentRole?: string; attachmentRoles?: string[]; size?: string;
};
type StoredResource = { reference: ResourceReference; url: string; context: Context };
const LEARN_WEBVPN_PATH = "/https/77726476706e69737468656265737421fcf2408e297e7c4377068ea48d546d30ca8cc97bcc/";
export interface LearnServicePorts {
  learn: import("@onethu/core").LearnClient;
  http: import("@onethu/core").HttpClient;
  session: { username: string; state: string };
  sessionUrl(url: string): string;
  authorize(): void;
  epoch(): Promise<number>;
  assertEpoch(epoch: number): Promise<void>;
  parseElements(html: string): ArrayLike<{ tagName: string; getAttribute(name: string): string | null }>;
  download(args: { url: string; cookies: string; filename: string; resourceId: string; outputDir: string; expectedEpoch: number; deadlineUnixMs: number; remainingBudgetMs: number }, control?: { beforeWrite?: () => Promise<void>; signal?: AbortSignal }): Promise<Record<string, unknown>>;
  loadResources?(owner: string): Promise<Array<{ reference: ResourceReference; url: string }>>;
  saveResource?(owner: string, record: { reference: ResourceReference; url: string }): Promise<void>;
}
/** Each host owns an isolated service instance; no browser or native globals. */
export function createLearnService(ports: LearnServicePorts) {
const { learn, http, session, sessionUrl } = ports;
const nativeSessionEpoch = ports.epoch;
const assertNativeSessionEpoch = ports.assertEpoch;
const nativeSessionChanged = () => new Error("AUTH_SESSION_CHANGED");
const resources = new Map<string, StoredResource>();
const knownCourses = new Map<string, { semesterId: string; course: CourseInfo }>();
let activeContext = "";
const MAX_REFERENCES = 30_000;
// A legacy caller may spend 45 seconds confirming inside the app before run().
// Keep its execution below the CLI's 120-second request and Harness's 180-second
// host timeout. The service may supply an earlier, request-scoped deadline.
const DEFAULT_DOWNLOAD_BUDGET_MS = 60_000;
const MAX_DOWNLOAD_BUDGET_MS = 150_000;
type DownloadBudget = { deadlineUnixMs: number; monotonicEnd: number; beforeWrite?: () => Promise<void>; signal?: AbortSignal };
function downloadBudget(deadlineUnixMs?: number): DownloadBudget {
  if (deadlineUnixMs !== undefined && (!Number.isSafeInteger(deadlineUnixMs) || deadlineUnixMs < 1)) fail("CLI_INVALID_ARGUMENT", "deadlineUnixMs");
  const now = Date.now();
  const end = Math.min(deadlineUnixMs ?? now + DEFAULT_DOWNLOAD_BUDGET_MS, now + MAX_DOWNLOAD_BUDGET_MS);
  return { deadlineUnixMs: end, monotonicEnd: performance.now() + Math.max(0, end - now) };
}
function ensureDownloadBudget(budget: DownloadBudget): void {
  if (budget.signal?.aborted) fail("LEARN_DOWNLOAD_CANCELLED");
  if (Date.now() >= budget.deadlineUnixMs || performance.now() >= budget.monotonicEnd) fail("LEARN_DOWNLOAD_DEADLINE_EXCEEDED");
}

function fail(code: string, detail?: string): never {
  throw Object.assign(new Error(detail ? `${code}: ${detail}` : code), { code });
}
function text(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 1024 || /[\x00-\x1f]/.test(value)) fail("CLI_INVALID_ARGUMENT", name);
  return value.trim();
}
function authorized(): void { ports.authorize(); }

async function context(): Promise<Context> {
  authorized();
  const owner = session.username;
  if (!owner || session.state !== "ready") fail("SCHOOL_SESSION_REQUIRED");
  const epoch = await nativeSessionEpoch();
  if (session.username !== owner || session.state !== "ready") throw nativeSessionChanged();
  const key = `${epoch}:${owner}`;
  if (activeContext !== key) {
    resources.clear(); knownCourses.clear(); activeContext = key;
    for (const cached of await ports.loadResources?.(owner) ?? []) {
      if (resources.size >= MAX_REFERENCES) break;
      if (!cached?.reference?.resourceRef?.match(/^learn:[a-f0-9]{64}$/)) continue;
      try { resources.set(cached.reference.resourceRef, { reference: cached.reference, url: allowedResourceUrl(cached.url), context: { epoch, owner } }); } catch { /* invalid cache entries never become downloadable */ }
    }
    if (session.username !== owner || session.state !== "ready") throw nativeSessionChanged();
    await assertNativeSessionEpoch(epoch);
  }
  return { epoch, owner };
}
async function unchanged(ctx: Context): Promise<void> {
  authorized();
  if (session.username !== ctx.owner || session.state !== "ready") throw nativeSessionChanged();
  await assertNativeSessionEpoch(ctx.epoch);
  authorized();
  if (session.username !== ctx.owner || session.state !== "ready") throw nativeSessionChanged();
}
function allowedResourceUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { return fail("LEARN_RESOURCE_URL_INVALID"); }
  const allowed = url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443")
    && (url.hostname === "learn.tsinghua.edu.cn"
      || (url.hostname === "webvpn.tsinghua.edu.cn" && url.pathname.startsWith(LEARN_WEBVPN_PATH)));
  if (!allowed) fail("LEARN_RESOURCE_URL_REJECTED");
  url.hash = "";
  return url.toString();
}
async function courseFor(courseId: string, ctx: Context) {
  text(courseId, "courseId");
  let found = knownCourses.get(courseId);
  if (!found) {
    const semester = await learn.getCurrentSemester();
    const courses = await learn.getCourseList(semester.id);
    await unchanged(ctx);
    for (const course of courses) knownCourses.set(course.id, { semesterId: semester.id, course });
    found = knownCourses.get(courseId);
  }
  if (!found) fail("LEARN_COURSE_NOT_FOUND", "Call courses(semesterId) for a previous semester first.");
  return found;
}
async function registerResource(ctx: Context, reference: Omit<ResourceReference, "resourceRef">, url: string): Promise<ResourceReference> {
  const validUrl = allowedResourceUrl(url);
  await unchanged(ctx);
  // The session registry owns the URL. Clients can only replay a registered reference.
  const source = [reference.kind, reference.semesterId, reference.courseId, reference.parentId ?? "", reference.attachmentRole ?? "", reference.resourceId || validUrl].join("\n");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  await unchanged(ctx);
  const resourceRef = `learn:${[...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("")}`;
  if (resources.size >= MAX_REFERENCES && !resources.has(resourceRef)) fail("LEARN_RESOURCE_REGISTRY_LIMIT");
  const out = { ...reference, resourceRef, attachmentRoles: reference.attachmentRole ? [reference.attachmentRole] : [] };
  resources.set(resourceRef, { reference: out, url: validUrl, context: ctx });
  await ports.saveResource?.(ctx.owner, { reference: out, url: validUrl });
  await unchanged(ctx);
  return out;
}
async function fileReference(file: CourseFile, semesterId: string, ctx: Context) {
  const ext = file.fileType?.replace(/^\./, "");
  const filename = ext && !file.title.toLowerCase().endsWith(`.${ext.toLowerCase()}`) ? `${file.title}.${ext}` : file.title;
  return registerResource(ctx, { kind: "file", courseId: file.courseId, semesterId, resourceId: file.id, title: file.title, filename: filename || `file-${file.id}`, size: file.size }, file.downloadUrl);
}
async function attachmentReference(attachment: LearnAttachment, kind: "homework" | "notification", courseId: string, semesterId: string, parentId: string, role: string, ctx: Context) {
  return registerResource(ctx, { kind, courseId, semesterId, parentId, attachmentRole: role, resourceId: attachment.id,
    title: attachment.name, filename: attachment.name || `attachment-${attachment.id || parentId}`, size: attachment.size }, attachment.downloadUrl);
}
async function inlineReferences(html: string, courseId: string, semesterId: string, parentId: string, ctx: Context) {
  const found: ResourceReference[] = [];
  const seen = new Set<string>();
  // DOMParser decodes HTML entities while preserving the original body returned to clients.
  for (const el of Array.from(ports.parseElements(html))) {
    const candidates = [el.getAttribute("src"), el.getAttribute("poster"), el.getAttribute("href"),
      ...(el.getAttribute("srcset") ?? "").split(",").map(value => value.trim().split(/\s+/)[0])];
    for (const raw of candidates) {
      if (!raw || /^(?:data|blob|javascript|mailto):/i.test(raw)) continue;
      let url: string;
      try {
        url = allowedResourceUrl(new URL(raw, raw.startsWith(LEARN_WEBVPN_PATH) ? "https://webvpn.tsinghua.edu.cn/" : "https://learn.tsinghua.edu.cn/").toString());
      } catch { continue; }
      if (el.tagName === "A" && !/[?&](?:wjid|fileId|downloadUrl)=|\.(?:pdf|docx?|pptx?|xlsx?|zip|rar|7z|png|jpe?g|gif|webp|mp4|mp3)(?:[?#]|$)/i.test(url)) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      const pathname = new URL(url).pathname;
      const name = el.getAttribute("download") || el.getAttribute("alt") || pathname.split("/").pop() || "inline-resource";
      const reference = await registerResource(ctx, { kind: "inline", courseId, semesterId, parentId, resourceId: "", title: name, filename: name, attachmentRole: "inline" }, url);
      found.push(reference);
    }
  }
  return found;
}
function publicFile(file: CourseFile, ref: ResourceReference) {
  const { downloadUrl: _, ...metadata } = file;
  return { ...metadata, resource: ref };
}
function publicHomework(row: Homework) { const { url: _, ...rest } = row; return rest; }
function publicNotification(row: Notification) { const { url: _, ...rest } = row; return rest; }
const homeworkIssues = [{ code: "LEARN_HOMEWORK_ENUMERATION_UNVERIFIED", message: "The three homework endpoints do not expose a verified completion total. Returned assignments are available; full enumeration remains unverified." }];

async function getNotifications(courseId: string, includeExpired: boolean) {
  const active = await learn.getNotificationList(courseId, false);
  const expired = includeExpired ? await learn.getNotificationList(courseId, true) : [];
  const rows = new Map<string, Notification>();
  for (const item of [...active, ...expired]) if (!rows.has(item.id)) rows.set(item.id, item);
  return [...rows.values()].sort((a, b) => b.publishTime.localeCompare(a.publishTime));
}
type DetailIssue = { code: string; kind: string; stage: string; resourceId?: string };
function detailIssue(error: unknown, stage: string): DetailIssue {
  const value = error as { code?: unknown; kind?: unknown; stage?: unknown; name?: unknown; message?: unknown } | null;
  const message = typeof value?.message === "string" ? value.message : "";
  // Only structural codes cross the boundary. Upstream messages may contain HTML,
  // credentials or signed URLs and are deliberately excluded from detail issues.
  const knownCode = typeof value?.code === "string" && /^[A-Z][A-Z0-9_]{2,80}$/.test(value.code) ? value.code : /^([A-Z][A-Z0-9_]{2,80})(?:$|:)/.exec(message)?.[1];
  if (/^(?:AUTH_|CLI_|SCHOOL_SESSION_|OH_AUTHORIZATION_)/.test(knownCode ?? "") || /^(?:AuthRequiredError|SessionExpiredError|LearnSessionMissingError)$/.test(String(value?.name ?? ""))) throw error;
  const http = /^HTTP ([1-5][0-9]{2})$/.exec(message)?.[1];
  const kind = typeof value?.kind === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(value.kind) ? value.kind : http ? `http-${http}` : "request-failed";
  const step = ["homework-submit-page", "homework-grade-page"].includes(String(value?.stage)) ? String(value?.stage) : stage;
  return { code: knownCode ?? (http ? "LEARN_HTTP_ERROR" : "LEARN_DETAIL_REQUEST_FAILED"), kind, stage: step };
}
async function homeworkDetail(courseId: string, studentHomeworkId: string, baseId: string | undefined, ctx: Context, knownRow?: Homework) {
  const course = await courseFor(courseId, ctx);
  const row = knownRow ?? (await learn.getAllHomework([courseId])).find(item => item.id === studentHomeworkId);
  if (!row || (baseId && row.baseId !== baseId)) fail("LEARN_HOMEWORK_NOT_FOUND");
  const issues: DetailIssue[] = [];
  let description = row.content ?? "";
  let descriptionSource: "list" | "detail" | "page" | null = description.trim() ? "list" : null;
  let descriptionComplete = descriptionSource !== null;
  // The list sometimes carries the entire description. Reuse it, as the app UI
  // does, and keep independent attachment reads useful if the JSON endpoint fails.
  if (!descriptionComplete && row.baseId) {
    try {
      description = (await learn.getHomeworkDetail(row.baseId)).description;
      descriptionSource = "detail";
      descriptionComplete = true;
    } catch (error) { await unchanged(ctx); issues.push(detailIssue(error, "homework-description")); }
  }
  let detail: Awaited<ReturnType<typeof learn.getHomeworkReadDetail>> | undefined;
  try { detail = await learn.getHomeworkReadDetail(courseId, studentHomeworkId); }
  catch (error) { await unchanged(ctx); issues.push(detailIssue(error, "homework-pages")); }
  await unchanged(ctx);
  if (!descriptionComplete && detail?.description !== undefined) {
    description = detail.description;
    descriptionSource = "page";
    descriptionComplete = true;
  }
  if (!descriptionComplete && !issues.some(issue => issue.stage === "homework-description")) {
    issues.push({ code: "LEARN_HOMEWORK_DESCRIPTION_UNAVAILABLE", kind: "missing-description", stage: "homework-description" });
  }
  const attachments = [];
  for (const attachment of detail?.attachments ?? []) attachments.push(await attachmentReference(attachment, "homework", courseId, course.semesterId, row.id, attachment.role, ctx));
  const inlineResources = await inlineReferences([description, detail?.submittedContent].filter(Boolean).join("\n"), courseId, course.semesterId, row.id, ctx);
  return { ...publicHomework(row), semesterId: course.semesterId, descriptionHtml: description, descriptionSource, submittedContent: detail?.submittedContent,
    attachments, inlineResources, submitFormChecked: false, descriptionComplete, attachmentsComplete: !!detail,
    issues, complete: descriptionComplete && !!detail && issues.length === 0 };
}
async function notificationDetail(courseId: string, notificationId: string, ctx: Context, knownRow?: Notification) {
  const course = await courseFor(courseId, ctx);
  const row = knownRow ?? (await getNotifications(courseId, true)).find(item => item.id === notificationId);
  if (!row) fail("LEARN_NOTIFICATION_NOT_FOUND");
  const detail = await learn.getNotificationPageDetail(courseId, notificationId, row.attachmentName);
  await unchanged(ctx);
  const attachments = [];
  for (const attachment of detail.attachments ?? []) attachments.push(await attachmentReference(attachment, "notification", courseId, course.semesterId, row.id, "attachment", ctx));
  const inlineResources = await inlineReferences(row.content ?? "", courseId, course.semesterId, row.id, ctx);
  return { ...publicNotification(row), semesterId: course.semesterId, contentHtml: row.content ?? "", attachments, inlineResources, complete: true };
}
async function downloadResource(ctx: Context, resourceRef: string, outputDir: string, budget: DownloadBudget, onStart?: () => void) {
  ensureDownloadBudget(budget);
  text(resourceRef, "resourceRef"); text(outputDir, "outputDir");
  const stored = resources.get(resourceRef);
  if (!stored || stored.context.owner !== ctx.owner || stored.context.epoch !== ctx.epoch) fail("LEARN_RESOURCE_REFERENCE_EXPIRED", "Enumerate this resource again in the current app session.");
  await unchanged(ctx);
  const target = allowedResourceUrl(sessionUrl(stored.url));
  const cookies = http.jar.getCookies(new URL(target)).map(cookie => `${cookie.name}=${cookie.value}`).join("; ");
  await unchanged(ctx);
  ensureDownloadBudget(budget);
  await budget.beforeWrite?.();
  ensureDownloadBudget(budget);
  onStart?.();
  const result = await ports.download({ url: target, cookies,
    filename: stored.reference.filename, resourceId: resourceRef, outputDir, expectedEpoch: ctx.epoch,
    deadlineUnixMs: budget.deadlineUnixMs, remainingBudgetMs: Math.max(1, Math.floor(budget.monotonicEnd - performance.now())) }, { beforeWrite: budget.beforeWrite, signal: budget.signal });
  await unchanged(ctx);
  // Native publication is the commit point. Preserve an already committed result
  // even if receiving it consumes the last milliseconds; the next file will stop.
  return { ...result, resourceRef, courseId: stored.reference.courseId, semesterId: stored.reference.semesterId };
}
async function downloadOne(resourceRef: string, outputDir: string, budget: DownloadBudget) {
  ensureDownloadBudget(budget);
  const ctx = await context();
  return downloadResource(ctx, resourceRef, outputDir, budget);
}
async function downloadMany(resourceRefs: string[], outputDir: string, budget: DownloadBudget) {
  if (!Array.isArray(resourceRefs) || resourceRefs.length < 1 || resourceRefs.length > 500) fail("CLI_INVALID_ARGUMENT", "resourceRefs must contain 1–500 entries.");
  resourceRefs.forEach(ref => text(ref, "resourceRef")); text(outputDir, "outputDir");
  const ctx = await context();
  const results = []; const failures: Array<{ resourceRef: string; code: string }> = [];
  const remaining: string[] = [];
  let timedOut = false;
  for (let i = 0; i < resourceRefs.length; i++) {
    const ref = resourceRefs[i]!;
    let attempted = false;
    try {
      ensureDownloadBudget(budget);
      await unchanged(ctx);
      ensureDownloadBudget(budget);
      results.push(await downloadResource(ctx, ref, outputDir, budget, () => { attempted = true; }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = /(?:AUTH_SESSION_CHANGED|SCHOOL_SESSION_REQUIRED|OH_AUTHORIZATION_REQUIRED|LEARN_[A-Z_0-9]+|CLI_[A-Z_0-9]+)/.exec(message)?.[0] ?? "LEARN_DOWNLOAD_FAILED";
      if (code === "LEARN_DOWNLOAD_DEADLINE_EXCEEDED") {
        timedOut = true;
        failures.push({ resourceRef: ref, code: attempted ? code : "LEARN_DOWNLOAD_NOT_ATTEMPTED_DEADLINE" });
        remaining.push(...resourceRefs.slice(i));
        for (const skipped of resourceRefs.slice(i + 1)) failures.push({ resourceRef: skipped, code: "LEARN_DOWNLOAD_NOT_ATTEMPTED_DEADLINE" });
        break;
      }
      failures.push({ resourceRef: ref, code });
      if (["AUTH_SESSION_CHANGED", "SCHOOL_SESSION_REQUIRED", "CLI_DISABLED", "OH_AUTHORIZATION_REQUIRED", "LEARN_DOWNLOAD_CANCELLED"].includes(code)) {
        for (const skipped of resourceRefs.slice(i + 1)) failures.push({ resourceRef: skipped, code: code === "CLI_DISABLED" || code === "OH_AUTHORIZATION_REQUIRED" ? "LEARN_DOWNLOAD_SKIPPED_AUTHORIZATION_CHANGED" : "LEARN_DOWNLOAD_SKIPPED_SESSION_CHANGED" });
        break;
      }
    }
  }
  return { results, failures, remaining, timedOut, deadlineUnixMs: budget.deadlineUnixMs,
    complete: results.length === resourceRefs.length && failures.length === 0, enumerationComplete: false,
    note: "complete describes this requested batch only; remaining refs require a separate confirmed call. Course enumeration completeness is returned by resources()." };
}
/** Internal service entry: carry the original request deadline across confirmation.
 * This is not an operation advertised to clients, and never extends that deadline. */
function runCliLearnDownloadWithDeadline(operation: "learn.download" | "learn.downloadMany", args: unknown[], deadlineUnixMs: number, beforeWrite?: () => Promise<void>, signal?: AbortSignal): Promise<unknown> {
  if (!Number.isSafeInteger(deadlineUnixMs) || deadlineUnixMs < 1) fail("CLI_INVALID_ARGUMENT", "deadlineUnixMs");
  // Native expiry still needs to travel back through the host and serialize a
  // partial report before the outer request's own deadline check fires.
  const budget: DownloadBudget = { ...downloadBudget(Math.max(1, deadlineUnixMs - 1000)), beforeWrite, signal };
  if (operation === "learn.download") return downloadOne(args[0] as string, args[1] as string, budget);
  if (operation === "learn.downloadMany") return downloadMany(args[0] as string[], args[1] as string, budget);
  return Promise.reject(new Error("CLI_INVALID_ARGUMENT: download operation"));
}
const arg = (description: string) => ({ type: "string", minLength: 1, description });
const tuple = (items: unknown[], required = items.length) => ({ type: "array", items, minItems: required, maxItems: items.length, additionalItems: false });
const scoped = (run: (ctx: Context, ...args: any[]) => Promise<unknown>) => async (...args: any[]) => {
  const ctx = await context(); const result = await run(ctx, ...args); await unchanged(ctx); return result;
};

const cliLearnOperations: CliLearnOperation[] = [
  { name: "currentSemester", description: "Read the current semester returned by Web Learning.", parameters: tuple([]), run: scoped(async () => learn.getCurrentSemester()) },
  { name: "courses", description: "List courses with official Chinese names; semester defaults to the server's current semester.", parameters: tuple([arg("Semester ID")], 0), run: scoped(async (ctx, semesterId?: string) => {
    const semester = semesterId ? text(semesterId, "semesterId") : (await learn.getCurrentSemester()).id;
    const rows = await learn.getCourseList(semester); await unchanged(ctx);
    for (const course of rows) knownCourses.set(course.id, { semesterId: semester, course });
    return { semester, rows: rows.map(({ url: _, ...row }) => row), count: rows.length, complete: true };
  }) },
  { name: "files", description: "Enumerate course files and register downloadable references; rejects incomplete enumeration.", parameters: tuple([arg("Course ID")]), run: scoped(async (ctx, courseId: string) => {
    const course = await courseFor(courseId, ctx); const rows = await learn.getFileList(courseId); const result = [];
    for (const row of rows) result.push(publicFile(row, await fileReference(row, course.semesterId, ctx)));
    return { courseId, semesterId: course.semesterId, rows: result, count: result.length, complete: true };
  }) },
  { name: "homework", description: "Read all three homework states for one course, retaining stable IDs and descriptions.", parameters: tuple([arg("Course ID")]), run: scoped(async (ctx, courseId: string) => {
    const course = await courseFor(courseId, ctx); const rows = await learn.getAllHomework([courseId]);
    const unique = new Map(rows.map(row => [row.id, row]));
    return { courseId, semesterId: course.semesterId, rows: [...unique.values()].map(publicHomework), count: unique.size, complete: false, enumerationComplete: false, issues: homeworkIssues };
  }) },
  { name: "notifications", description: "Enumerate current and optionally expired course announcements (default both).", parameters: tuple([arg("Course ID"), { type: "boolean", default: true }], 1), run: scoped(async (ctx, courseId: string, includeExpired = true) => {
    const course = await courseFor(courseId, ctx); const rows = await getNotifications(courseId, includeExpired);
    return { courseId, semesterId: course.semesterId, rows: rows.map(publicNotification), count: rows.length, complete: true, includeExpired };
  }) },
  { name: "homeworkDetail", description: "Read assignment HTML, all parsed attachment roles and inline resources.", parameters: tuple([arg("Course ID"), arg("Student homework ID"), arg("Optional matching base ID")], 2), run: scoped((ctx, courseId, id, baseId) => homeworkDetail(courseId, text(id, "studentHomeworkId"), baseId, ctx)) },
  { name: "notificationDetail", description: "Read announcement HTML, parsed attachments and inline resources.", parameters: tuple([arg("Course ID"), arg("Notification ID")]), run: scoped((ctx, courseId, id) => notificationDetail(courseId, text(id, "notificationId"), ctx)) },
  { name: "resources", description: "Collect course files and assignment/announcement resources, with explicit failures and completeness.", parameters: tuple([arg("Course ID")]), run: scoped(async (ctx, courseId: string) => {
    const course = await courseFor(courseId, ctx); const items: ResourceReference[] = []; const issues: Array<{ code: string; resourceId?: string; message?: string; kind?: string; stage?: string }> = [...homeworkIssues];
    const homeworkDetails: Array<Awaited<ReturnType<typeof homeworkDetail>> | (ReturnType<typeof publicHomework> & { descriptionHtml: string; complete: false })> = [];
    const notificationDetails: Array<Awaited<ReturnType<typeof notificationDetail>> | (ReturnType<typeof publicNotification> & { contentHtml: string; complete: false })> = [];
    for (const file of await learn.getFileList(courseId)) items.push(await fileReference(file, course.semesterId, ctx));
    const homework = await learn.getAllHomework([courseId]);
    for (const row of new Map(homework.map(item => [item.id, item])).values()) {
      try { const detail = await homeworkDetail(courseId, row.id, row.baseId, ctx, row); homeworkDetails.push(detail); items.push(...detail.attachments, ...detail.inlineResources); issues.push(...detail.issues.map(issue => ({ ...issue, resourceId: row.id }))); }
      catch (error) { await unchanged(ctx); homeworkDetails.push({ ...publicHomework(row), descriptionHtml: row.content ?? "", complete: false }); issues.push({ ...detailIssue(error, "homework-detail"), resourceId: row.id }); }
    }
    for (const row of await getNotifications(courseId, true)) {
      try { const detail = await notificationDetail(courseId, row.id, ctx, row); notificationDetails.push(detail); items.push(...detail.attachments, ...detail.inlineResources); }
      catch (error) { await unchanged(ctx); notificationDetails.push({ ...publicNotification(row), contentHtml: row.content ?? "", complete: false }); issues.push({ ...detailIssue(error, "notification-detail"), resourceId: row.id }); }
    }
    const unique = new Map(items.map(item => [item.resourceRef, item]));
    return { courseId, semesterId: course.semesterId, courseName: course.course.name, items: [...unique.values()], homework: homeworkDetails, notifications: notificationDetails, count: unique.size, complete: false, enumerationComplete: false, issues };
  }) },
  { name: "download", description: "Download a registered resource within the request deadline; preserve existing files and remove incomplete output.", parameters: tuple([arg("Registered resourceRef"), arg("Existing absolute output directory")]), mutation: true, run: (resourceRef: string, outputDir: string) => downloadOne(resourceRef, outputDir, downloadBudget()) },
  { name: "downloadMany", description: "Download up to 500 registered resources sequentially within one bounded request; preserve successes and return unattempted refs explicitly.", parameters: tuple([{ type: "array", items: arg("Registered resourceRef"), minItems: 1, maxItems: 500 }, arg("Existing absolute output directory")]), mutation: true, run: (resourceRefs: string[], outputDir: string) => downloadMany(resourceRefs, outputDir, downloadBudget()) },
];

return { operations: cliLearnOperations, runDownload: runCliLearnDownloadWithDeadline };
}
