import type { SchoolWatch, StoredTask, TaskChange, TaskRun, TaskSnapshotItem } from "./types.js";
import { errorCode, fingerprint } from "./validation.js";

type Row = Record<string, any>;
const object = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const rows = (value: unknown): Row[] => {
  if (!Array.isArray(value)) return [];
  if (value.length > 20_000) throw new Error("TASK_RESULT_LIMIT");
  return value.filter(v => v && typeof v === "object" && !Array.isArray(v));
};
const label = (value: unknown): string => String(value ?? "").replace(/[\x00-\x1f]/g, " ").slice(0, 300);
export interface WatchPorts {
  now(): number; read(op: string, args: unknown[]): Promise<unknown>;
  download(ref: string, key: string): Promise<boolean>;
  notify(keys: string[], message: string): Promise<number>;
  allowResource(ref: string): void;
}

/** Keeps identity and a digest, never authenticated URLs or full course bodies. */
export async function schoolWatch(task: StoredTask, run: TaskRun, ports: WatchPorts): Promise<void> {
  const template = task.template as SchoolWatch;
  const coursePage = object(await ports.read("learn.courses", template.semesterId ? [template.semesterId] : []));
  if (!Array.isArray(coursePage.rows)) throw new Error("TASK_COURSES_RESPONSE_INVALID");
  const courses = new Map(rows(coursePage.rows).map(row => [String(row.id), row]));
  const previous = task.snapshot;
  const current: Record<string, TaskSnapshotItem> = { ...previous };
  const events: Array<{ key: string; change: TaskChange }> = [];
  const remind = [...new Set(template.remindBeforeHours ?? [24, 1])].sort((a, b) => a - b);
  let downloadCount = 0;
  for (const courseId of template.courseIds) {
    if (!courses.has(courseId)) { run.errors.push("TASK_COURSE_UNAVAILABLE"); continue; }
    let page: Row, homework: Row;
    try {
      page = object(await ports.read("learn.resources", [courseId]));
      homework = object(await ports.read("learn.homework", [courseId]));
    } catch (error) {
      const code = errorCode(error);
      if (/(?:CANCELLED|ACCOUNT_CHANGED|SESSION_CHANGED|AUTH|PERMISSION|DISABLED|STORAGE)/.test(code)) throw error;
      run.errors.push(code); continue;
    }
    if (!Array.isArray(page.items) || !Array.isArray(page.homework) || !Array.isArray(page.notifications) || !Array.isArray(homework.rows)) throw new Error("TASK_RESOURCES_RESPONSE_INVALID");
    if (page.complete === false || homework.complete === false) run.errors.push("TASK_ENUMERATION_PARTIAL");
    const items = rows(page.items);
    const assignments = new Map<string, Row>(rows(page.homework).map(row => [String(row.id ?? ""), row]));
    for (const row of rows(homework.rows)) { const id = String(row.id ?? ""); assignments.set(id, { ...assignments.get(id), ...row }); }
    const notifications = rows(page.notifications);
    const seen = new Set<string>();
    async function observe(kind: string, row: Row, metadata: unknown, id: string, deadline?: string): Promise<{ key: string; hash: string }> {
      const key = `${courseId}:${kind}:${id}`;
      seen.add(key);
      const hash = await fingerprint(metadata);
      const item: TaskSnapshotItem = { hash, title: label(row.title || row.filename || row.name || id), courseId, ...(deadline ? { deadline } : {}) };
      current[key] = item;
      if (previous[key]?.hash !== hash) {
        const change: TaskChange = { kind: previous[key] ? "changed" : "new", id: key, title: item.title, courseId, ...(deadline ? { deadline } : {}) };
        run.changes.push(change); events.push({ key: `change:${key}:${previous[key]?.hash ?? "new"}:${hash}`, change });
      }
      return { key, hash };
    }
    for (const row of items) {
      const ref = typeof row.resourceRef === "string" ? row.resourceRef : "";
      if (!/^learn:[a-f0-9]{64}$/.test(ref) || (row.courseId && row.courseId !== courseId)) { run.errors.push("TASK_RESOURCE_INVALID"); continue; }
      const metadata = { kind: row.kind, resourceId: row.resourceId, parentId: row.parentId, title: row.title, filename: row.filename, size: row.size, attachmentRoles: row.attachmentRoles };
      const { key, hash } = await observe("resource", row, metadata, ref);
      ports.allowResource(ref);
      if (template.outputDir && !task.downloads[`${key}:${hash}`]) {
        if (downloadCount >= 100) { run.errors.push("TASK_DOWNLOAD_BATCH_LIMIT"); continue; }
        downloadCount++;
        if (await ports.download(ref, `${key}:${hash}`)) run.downloaded++;
      }
    }
    for (const [id, row] of assignments) {
      if (!id || id === "undefined") continue;
      const deadline = label(row.deadline);
      const metadata = { title: row.title, deadline, lateDeadline: row.lateDeadline, publishTime: row.publishTime, submitted: row.submitted, graded: row.graded,
        description: String(row.descriptionHtml ?? row.content ?? "").slice(0, 1_000_000) };
      const { key } = await observe("homework", row, metadata, id, deadline);
      if (row.submitted || row.graded || !deadline) continue;
      const remaining = Date.parse(deadline) - ports.now();
      const hours = remind.find(value => remaining > 0 && remaining <= value * 3_600_000);
      if (hours !== undefined) {
        const change: TaskChange = { kind: "deadline", id: key, title: label(row.title), courseId, deadline };
        const eventKey = `deadline:${key}:${deadline}:${hours}`;
        if (template.channels.some(channel => !task.notifications[`${channel}:${eventKey}`])) {
          run.changes.push(change); events.push({ key: eventKey, change });
        }
      }
    }
    for (const row of notifications) {
      if (!row.id) continue;
      await observe("notification", row, { title: row.title, publisher: row.publisher, publishTime: row.publishTime, expireTime: row.expireTime,
        content: String(row.contentHtml ?? row.content ?? "").slice(0, 1_000_000) }, String(row.id));
    }
    // Missing entries from a partial response are not deletions. Other courses'
    // snapshots remain untouched if their request could not be completed.
    if (page.complete === true && homework.complete === true) {
      for (const key of Object.keys(previous)) if (previous[key]?.courseId === courseId && !seen.has(key)) {
        const item = previous[key]!; delete current[key];
        const change: TaskChange = { kind: "removed", id: key, title: item.title, courseId };
        run.changes.push(change); events.push({ key: `removed:${key}:${item.hash}`, change });
      }
    }
  }
  // Batch one message per channel/run while retaining every event's durable
  // idempotency key. A large course import must not produce hundreds of messages.
  if (events.length) {
    const lines = events.slice(0, 15).map(({ change }) => `${change.kind}: ${change.title}${change.deadline ? ` · ${change.deadline}` : ""}`);
    const message = `OneTHU · ${task.name}\n${lines.join("\n")}${events.length > 15 ? `\n+${events.length - 15} more changes` : ""}`;
    run.notified += await ports.notify(events.map(event => event.key), message);
  }
  task.snapshot = current;
}
