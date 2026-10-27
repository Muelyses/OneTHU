import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, readFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { CliError, errorPayload } from "./client.mjs";

const FORMAT = "onethu-learn-export-v1";
const META = ".onethu-export";
const RUN = /^\d{8}T\d{9}Z-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const MAX_MANIFEST = 16 * 1024 * 1024;
const BATCH_SIZE = 500;
const digest = (text) => createHash("sha256").update(text).digest("hex");
const issue = (code, message, extra = {}) => ({ code, message, ...extra });

function invalid(message) { throw new CliError("INVALID_EXPORT_ARGUMENT", message, 2); }
function invalidResponse(message) { throw new CliError("INVALID_EXPORT_RESPONSE", message, 3); }
function identifier(value) { return typeof value === "string" && value.length > 0 && value.length <= 1024 && !/[\x00-\x1f]/.test(value); }
function safeCode(value, fallback) { return typeof value === "string" && /^[A-Z][A-Z0-9_]{0,100}$/.test(value) ? value : fallback; }
function caught(error) { const safe = errorPayload(error).error; return issue(safe.code, safe.message); }

/** A single component on both macOS and Windows. Preserve Chinese course names. */
export function courseDirectoryName(name, id, semester) {
  let base = String(name || "课程").normalize("NFC")
    .replace(/[<>:"/\\|?*\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, "_")
    .replace(/[. ]+$/g, "").trim();
  if (!base || /^\.+$/.test(base)) base = "课程";
  if (/^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(base)) base = `_${base}`;
  while (Buffer.byteLength(base) > 100) base = Array.from(base).slice(0, -1).join("");
  return `${base}--${digest(`${semester}\n${id}`).slice(0, 12)}`;
}

/** Check every component instead of following a symlink (including junctions). */
async function checkPath(target, { allowMissing = false, file = false } = {}) {
  const absolute = path.resolve(target);
  const parsed = path.parse(absolute);
  const parts = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let current = parsed.root;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    let info;
    try { info = await lstat(current); }
    catch (error) {
      if (error.code === "ENOENT" && allowMissing) return false;
      if (error.code === "ENOENT") throw new CliError("EXPORT_PATH_MISSING", "An export path disappeared. Run the command again after checking its folder.", 1);
      throw new CliError("EXPORT_PATH_UNREADABLE", "Cannot inspect an export path. Check its permissions.", 1);
    }
    if (info.isSymbolicLink()) throw new CliError("EXPORT_SYMLINK_REFUSED", "Export paths and their parents must be real directories/files, without symbolic links or junctions.", 2);
    const last = i === parts.length - 1;
    if (!(last && file ? info.isFile() : info.isDirectory())) throw new CliError("EXPORT_PATH_TYPE", "An export path has an unexpected file type.", 2);
  }
  return true;
}

async function ensureDirectory(target) {
  const absolute = path.resolve(target);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    await checkPath(path.dirname(current));
    try { await mkdir(current, { mode: 0o700 }); }
    catch (error) { if (error.code !== "EEXIST") throw new CliError("EXPORT_DIRECTORY_FAILED", "Cannot create the export directory. Check free space and folder permissions.", 1); }
    await checkPath(current);
  }
}

function within(root, target) {
  const relative = path.relative(root, target);
  return relative && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

async function writeNew(file, content) {
  await checkPath(path.dirname(file));
  let handle;
  try {
    handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } catch { throw new CliError("EXPORT_WRITE_FAILED", "Cannot create an archive file. Existing files are preserved; check free space and folder permissions.", 1); }
  finally { await handle?.close(); }
}
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

async function fileHash(file) {
  await checkPath(file, { file: true });
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new Error("Not a regular file");
    const hash = createHash("sha256");
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
    const after = await handle.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) throw new Error("File changed during verification");
    return { sha256: hash.digest("hex"), bytes: after.size };
  } finally { await handle.close(); }
}

function resourceFingerprint(resource) {
  return digest(JSON.stringify([resource.resourceRef, resource.resourceId, resource.courseId, resource.semesterId,
    resource.kind, resource.parentId ?? "", resource.title, resource.filename, resource.size ?? "",
    resource.attachmentRole ?? "", resource.attachmentRoles ?? []]));
}

async function previousFiles(courseDir, courseId, semesterId) {
  const found = new Map();
  if (!await checkPath(courseDir, { allowMissing: true })) return found;
  const metadata = path.join(courseDir, META);
  if (!await checkPath(metadata, { allowMissing: true })) return found;
  const names = (await readdir(metadata)).filter(name => RUN.test(name)).sort().reverse();
  for (const name of names) {
    const file = path.join(metadata, name, "manifest.json");
    // A malformed historical manifest cannot redirect traversal or count as a download.
    try {
      await checkPath(file, { file: true });
      if ((await lstat(file)).size > MAX_MANIFEST) continue;
      const manifest = JSON.parse(await readFile(file, "utf8"));
      if (manifest.format !== FORMAT || manifest.courseId !== courseId || manifest.semesterId !== semesterId || !Array.isArray(manifest.resources)) continue;
      for (const entry of manifest.resources) {
        if (!entry || !["downloaded", "reused", "skipped"].includes(entry.status) || !identifier(entry.resourceRef) || found.has(entry.resourceRef)) continue;
        if (!SHA.test(entry.file?.sha256 ?? "") || !SHA.test(entry.fingerprint ?? "") || typeof entry.file.relativePath !== "string") continue;
        const relative = entry.file.relativePath;
        if (!relative || relative.includes("\\") || relative.split("/").some(part => !part || part === "." || part === ".." || part.includes(":"))) continue;
        const candidate = path.resolve(courseDir, ...relative.split("/"));
        if (!within(courseDir, candidate) || candidate.startsWith(metadata + path.sep)) continue;
        const actual = await fileHash(candidate);
        if (actual.sha256 === entry.file.sha256 && actual.bytes === entry.file.bytes) found.set(entry.resourceRef, entry);
      }
    } catch (error) {
      if (error instanceof CliError && error.code === "EXPORT_SYMLINK_REFUSED") throw error;
      // Incomplete old runs and removed/edited files are downloaded to a new name.
    }
  }
  return found;
}

/** Plain text for readable archives; source HTML remains intact in content.json. */
export function htmlText(value) {
  return String(value ?? "").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(?:br|hr)\b[^>]*>|<\/(?:p|div|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
      const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
      if (!entity.startsWith("#")) return named[entity.toLowerCase()] ?? match;
      const code = entity[1].toLowerCase() === "x" ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : match;
    }).replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
function block(value) {
  const text = String(value ?? "");
  let longest = 0;
  for (const match of text.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}text\n${text}\n${fence}\n`;
}
function contentMarkdown(course, resources) {
  const lines = ["# 课程资料 / Course archive", block(course.name), block(`Course ID: ${course.id}\nSemester: ${resources.semesterId}`),
    "Source HTML and structured metadata are retained in content.json. Files are listed in manifest.json.\n",
    "## 作业 / Assignments\n"];
  for (const row of resources.homework ?? []) {
    lines.push(block(row.title ?? row.name ?? row.id), block(htmlText(row.descriptionHtml ?? row.content)),
      block(`ID: ${row.id ?? ""}\nDeadline: ${row.deadline ?? row.endTime ?? ""}`));
    if (row.submittedContent) lines.push("### 已提交内容 / Submitted content\n", block(htmlText(row.submittedContent)));
  }
  lines.push("## 公告 / Announcements\n");
  for (const row of resources.notifications ?? []) lines.push(block(row.title ?? row.name ?? row.id), block(htmlText(row.contentHtml ?? row.content)), block(`ID: ${row.id ?? ""}\nPublished: ${row.publishTime ?? ""}`));
  return lines.join("\n");
}

function validateResources(result, course, semester) {
  if (!result || result.courseId !== course.id || result.semesterId !== semester || !Array.isArray(result.items) || result.items.length > 30_000) invalidResponse("Resource list does not match the selected course and semester.");
  const unique = new Map();
  for (const item of result.items) {
    if (!item || !/^learn:[a-f0-9]{64}$/.test(item.resourceRef ?? "") || item.courseId !== course.id || item.semesterId !== semester || typeof item.filename !== "string" || typeof item.title !== "string") invalidResponse("A resource is missing its registered reference or course attribution.");
    if (unique.has(item.resourceRef) && resourceFingerprint(unique.get(item.resourceRef)) !== resourceFingerprint(item)) invalidResponse("The resource list contains conflicting duplicate references.");
    unique.set(item.resourceRef, item);
  }
  if (!Number.isInteger(result.count) || result.count !== unique.size) invalidResponse("The resource count does not match the returned list.");
  if (result.homework !== undefined && !Array.isArray(result.homework) || result.notifications !== undefined && !Array.isArray(result.notifications)) invalidResponse("Course content has an invalid shape.");
  for (const row of [...(result.homework ?? []), ...(result.notifications ?? [])]) {
    if (!row || row.courseId !== course.id || row.semesterId !== semester) invalidResponse("Course content belongs to a different course or semester.");
  }
  return { ...result, items: [...unique.values()] };
}

async function acceptDownload(result, courseDir, courseId, semesterId) {
  if (!result || result.courseId !== courseId || result.semesterId !== semesterId || typeof result.absolutePath !== "string" || !path.isAbsolute(result.absolutePath)
    || !SHA.test(result.sha256 ?? "") || !Number.isSafeInteger(result.bytes) || result.bytes < 0) invalidResponse("A download returned invalid attribution or checksum metadata.");
  const target = path.resolve(result.absolutePath);
  if (!within(courseDir, target) || target.startsWith(path.join(courseDir, META) + path.sep)) invalidResponse("A download returned a path outside its course directory.");
  const actual = await fileHash(target);
  if (actual.sha256 !== result.sha256 || actual.bytes !== result.bytes) invalidResponse("A downloaded file failed the size or SHA-256 verification.");
  return { relativePath: path.relative(courseDir, target).split(path.sep).join("/"), sha256: actual.sha256, bytes: actual.bytes, mime: result.mime };
}

async function download(client, courseResult, resources, oldFiles) {
  const entries = resources.items.map(resource => {
    const fingerprint = resourceFingerprint(resource);
    const old = oldFiles.get(resource.resourceRef);
    return { ...resource, fingerprint, status: old?.fingerprint === fingerprint ? "skipped" : "pending", ...(old?.fingerprint === fingerprint ? { file: old.file } : {}) };
  });
  const pending = entries.filter(item => item.status === "pending");
  courseResult.downloadBatches = [];
  let stop = false;
  for (let offset = 0; offset < pending.length; offset += BATCH_SIZE) {
    const batch = pending.slice(offset, offset + BATCH_SIZE);
    if (stop) { for (const entry of batch) { entry.status = "failed"; entry.error = issue("EXPORT_BATCH_NOT_ATTEMPTED", "A previous batch failed; remaining writes were not retried."); } continue; }
    try {
      await checkPath(courseResult.directory);
      const response = await client.call("service/call", { operation: "learn.downloadMany", args: [batch.map(item => item.resourceRef), courseResult.directory], confirm: true });
      if (!response || !Array.isArray(response.results) || !Array.isArray(response.failures)) invalidResponse("Download batch has an invalid result shape.");
      const returned = new Set();
      const expected = new Map(batch.map(item => [item.resourceRef, item]));
      for (const item of [...response.results, ...response.failures]) {
        if (!expected.has(item?.resourceRef) || returned.has(item.resourceRef)) invalidResponse("Download batch contains unexpected or repeated resource references.");
        returned.add(item.resourceRef);
      }
      const failedRefs = new Set(response.failures.map(item => item.resourceRef));
      if (response.remaining !== undefined && (!Array.isArray(response.remaining)
        || response.remaining.some(ref => typeof ref !== "string" || !failedRefs.has(ref))
        || new Set(response.remaining).size !== response.remaining.length)) invalidResponse("Download batch contains invalid remaining resource references.");
      courseResult.downloadBatches.push({ requested: batch.length, timedOut: response.timedOut === true,
        remaining: response.remaining ?? [], complete: response.complete === true && response.timedOut !== true });
      if (response.timedOut === true) courseResult.timedOut = true;
      for (const result of response.results) {
        const entry = expected.get(result.resourceRef);
        try { entry.file = await acceptDownload(result, courseResult.directory, courseResult.courseId, courseResult.semesterId); entry.status = result.reused ? "reused" : "downloaded"; }
        catch (error) { entry.status = "failed"; entry.error = caught(error); }
      }
      for (const failure of response.failures) {
        const entry = expected.get(failure.resourceRef);
        entry.status = "failed"; entry.error = issue(safeCode(failure.code, "LEARN_DOWNLOAD_FAILED"), "The app reported a resource download failure.");
      }
      for (const entry of batch) if (entry.status === "pending") { entry.status = "failed"; entry.error = issue("EXPORT_DOWNLOAD_MISSING", "The app did not return this requested download."); }
      if (response.complete !== true || response.timedOut === true || batch.some(item => item.status === "failed")) {
        courseResult.issues.push(issue("EXPORT_BATCH_INCOMPLETE", "A requested batch did not finish completely. Successful files were retained."));
        stop = true;
      }
    } catch (error) {
      const reason = caught(error);
      if (reason.code === "TIMEOUT") courseResult.timedOut = true;
      for (const entry of batch) if (entry.status === "pending") { entry.status = "failed"; entry.error = reason; }
      courseResult.issues.push(reason); stop = true;
    }
  }
  // Include failed/unknown outcomes as well as refs the app explicitly left
  // unstarted. A later, separately confirmed run verifies prior successes.
  courseResult.remainingResourceRefs = entries.filter(item => item.status === "failed").map(item => item.resourceRef);
  return entries;
}

export async function exportLearn(client, options) {
  if (typeof options.output !== "string" || !path.isAbsolute(options.output) || options.output.startsWith("\\\\") || options.output.startsWith("//") || options.output.includes("\0")) invalid("--output must be an absolute local directory path.");
  if (options.args !== undefined || options.argsFile !== undefined) invalid("learn export uses --semester and --course, without --args or --args-file.");
  if (options.semester !== undefined && !identifier(options.semester) || options.course !== undefined && !identifier(options.course)) invalid("Semester and course IDs must be nonempty strings without control characters.");
  const outputDir = path.resolve(options.output);
  if (outputDir === path.parse(outputDir).root) invalid("Choose a named export directory inside the drive.");
  await checkPath(outputDir, { allowMissing: true });
  const write = options.confirm === true && options.dryRun !== true;
  const runId = `${new Date().toISOString().replace(/[-:.]/g, "")}-${randomBytes(6).toString("hex")}`;
  const report = { format: FORMAT, mode: write ? "export" : "dry-run", runId, outputDir,
    createdAt: new Date().toISOString(), complete: false, status: "planned", courses: [], issues: [],
    reusePolicy: "same-reference-and-metadata-with-verified-local-sha256" };
  try {
    const catalog = await client.call("service/call", { operation: "learn.courses", args: options.semester ? [options.semester] : [] });
    if (!catalog || !identifier(catalog.semester) || !Array.isArray(catalog.rows) || catalog.count !== catalog.rows.length || (options.semester && catalog.semester !== options.semester)
      || !catalog.rows.every(row => row && identifier(row.id) && typeof row.name === "string") || new Set(catalog.rows.map(row => row.id)).size !== catalog.rows.length) invalidResponse("The app returned an invalid course catalog.");
    report.semesterId = catalog.semester;
    if (catalog.complete !== true) report.issues.push(issue("EXPORT_COURSES_INCOMPLETE", "The app could not confirm the full course list."));
    const courses = catalog.rows.filter(row => !options.course || row.id === options.course);
    if (options.course && courses.length === 0) throw new CliError("LEARN_COURSE_NOT_FOUND", "The requested course is not in this semester's catalog.", 2);
    for (const course of courses) {
      const directory = path.join(outputDir, courseDirectoryName(course.name, course.id, catalog.semester));
      const result = { courseId: course.id, semesterId: catalog.semester, courseName: course.name, directory, complete: false, issues: [], resources: [] };
      report.courses.push(result);
      try {
        const resources = validateResources(await client.call("service/call", { operation: "learn.resources", args: [course.id] }), course, catalog.semester);
        if (resources.complete !== true || resources.enumerationComplete === false) result.issues.push(issue("EXPORT_ENUMERATION_INCOMPLETE", "The app cannot confirm that every course resource was enumerated."));
        for (const item of resources.issues ?? []) result.issues.push(issue(safeCode(item?.code, "LEARN_RESOURCE_ISSUE"), "The app reported an enumeration/detail issue.", identifier(item?.resourceId) ? { resourceId: item.resourceId } : {}));
        if (!Array.isArray(resources.homework) || !Array.isArray(resources.notifications)) result.issues.push(issue("EXPORT_CONTENT_MISSING", "Assignment or announcement content is missing. Update OneTHU before requesting a complete archive."));
        if ((resources.homework ?? []).some(row => row.complete !== true || typeof row.descriptionHtml !== "string")
          || (resources.notifications ?? []).some(row => row.complete !== true || typeof row.contentHtml !== "string")) {
          result.issues.push(issue("EXPORT_CONTENT_INCOMPLETE", "Some course details are incomplete; the available body and metadata are retained."));
        }
        const oldFiles = await previousFiles(directory, course.id, catalog.semester);
        result.contentCount = { homework: resources.homework?.length ?? 0, notifications: resources.notifications?.length ?? 0 };
        if (write) {
          await ensureDirectory(directory);
          const metadata = path.join(directory, META, runId);
          await ensureDirectory(metadata);
          await writeNew(path.join(metadata, "content.json"), json({ format: FORMAT, course, semesterId: catalog.semester, ...resources }));
          await writeNew(path.join(metadata, "content.md"), contentMarkdown(course, resources));
          result.contentPath = path.join(metadata, "content.md");
          result.resources = await download(client, result, resources, oldFiles);
          result.complete = result.issues.length === 0 && result.resources.every(item => ["downloaded", "reused", "skipped"].includes(item.status));
          result.manifestPath = path.join(metadata, "manifest.json");
          await writeNew(result.manifestPath, json({ format: FORMAT, runId, createdAt: report.createdAt, ...result }));
        } else {
          result.resources = resources.items.map(resource => ({ ...resource, status: oldFiles.get(resource.resourceRef)?.fingerprint === resourceFingerprint(resource) ? "would-skip" : "would-download" }));
          result.complete = result.issues.length === 0;
        }
      } catch (error) { result.complete = false; result.issues.push(caught(error)); }
    }
  } catch (error) { report.issues.push(caught(error)); }
  report.complete = report.issues.length === 0 && report.courses.every(course => course.complete);
  report.status = report.complete ? write ? "complete" : "planned" : "partial";
  report.counts = { courses: report.courses.length, resources: report.courses.reduce((sum, course) => sum + course.resources.length, 0),
    downloaded: report.courses.flatMap(course => course.resources).filter(item => item.status === "downloaded").length,
    reused: report.courses.flatMap(course => course.resources).filter(item => ["skipped", "reused"].includes(item.status)).length,
    failed: report.courses.flatMap(course => course.resources).filter(item => item.status === "failed").length };
  if (write) {
    try {
      await ensureDirectory(outputDir);
      report.reportPath = path.join(outputDir, `onethu-export-${runId}.json`);
      await writeNew(path.join(outputDir, `onethu-export-${runId}.md`), `# OneTHU 课程资料导出 / Course export\n\n${block(`Status: ${report.status}\nSemester: ${report.semesterId ?? "unknown"}\nCourses: ${report.counts.courses}\nDownloaded: ${report.counts.downloaded}\nReused: ${report.counts.reused}\nFailed: ${report.counts.failed}`)}\n` + report.courses.map(course => `## 课程 / Course\n\n${block(`${course.courseName}\n${course.directory}\nComplete: ${course.complete}`)}\n${block(course.issues.map(item => `${item.code}: ${item.message}`).join("\n"))}`).join("\n") + (report.issues.length ? `\n## 问题 / Issues\n\n${block(report.issues.map(item => `${item.code}: ${item.message}`).join("\n"))}` : ""));
      // Write the authoritative JSON last, after every other archive write succeeds.
      await writeNew(report.reportPath, json(report));
    } catch (error) { report.complete = false; report.status = "partial"; report.issues.push(caught(error)); }
  }
  return { report, exitCode: report.complete ? 0 : 5 };
}
