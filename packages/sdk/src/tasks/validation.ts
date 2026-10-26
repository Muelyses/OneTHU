import { validateSchedule } from "./schedule.js";
import type { TaskDraft, TaskManagerPorts, TaskScope } from "./types.js";
export const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export function text(value: unknown, field: string, max = 160): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x1f]/.test(value)) throw new Error(`TASK_INVALID_ARGUMENT: ${field}`);
  return value;
}
function strings(value: unknown, field: string, limit: number): string[] {
  if (!Array.isArray(value) || value.length > limit || new Set(value).size !== value.length) throw new Error(`TASK_INVALID_ARGUMENT: ${field}`);
  return value.map(item => text(item, field));
}
export function absoluteDirectory(value: unknown): string {
  const dir = text(value, "outputDir", 2048);
  if (!/^(?:\/(?!\/)|[a-zA-Z]:[\\/]|\\\\[^\\]+\\[^\\]+)/.test(dir) || dir.split(/[\\/]/).includes("..")) throw new Error("TASK_OUTPUT_DIRECTORY_INVALID");
  return dir;
}
export function validateDraft(value: TaskDraft, ports: Pick<TaskManagerPorts, "resolveOperation">): { draft: TaskDraft; scope: TaskScope } {
  if (!value || typeof value !== "object") throw new Error("TASK_INVALID_ARGUMENT");
  if (JSON.stringify({ name: value.name, schedule: value.schedule, template: value.template }).length > 32_000) throw new Error("TASK_ARGUMENTS_TOO_LARGE");
  text(value.name, "name"); validateSchedule(value.schedule);
  const template = value.template;
  if (!template || typeof template !== "object") throw new Error("TASK_TEMPLATE_INVALID");
  let scope: TaskScope;
  if (template.kind === "school-watch") {
    const courseIds = strings(template.courseIds, "courseIds", 100);
    if (!courseIds.length) throw new Error("TASK_COURSES_REQUIRED");
    const channels = strings(template.channels, "channels", 8);
    if (template.semesterId !== undefined) text(template.semesterId, "semesterId");
    if (template.remindBeforeHours !== undefined && (!Array.isArray(template.remindBeforeHours) || template.remindBeforeHours.length > 8 || template.remindBeforeHours.some(n => !Number.isFinite(n) || n <= 0 || n > 720))) throw new Error("TASK_REMINDER_INVALID");
    const outputDir = template.outputDir === undefined ? undefined : absoluteDirectory(template.outputDir);
    scope = { operations: ["learn.courses", "learn.resources", "learn.homework", ...(outputDir ? ["learn.download"] : [])], channels, ...(outputDir ? { outputDir } : {}) };
  } else if (template.kind === "operation") {
    text(template.operation, "operation");
    const registered = ports.resolveOperation?.(template.operation);
    if (!registered || !Array.isArray(template.args)) throw new Error("TASK_OPERATION_NOT_ALLOWED");
    if (JSON.stringify(template.args).length > 16_000) throw new Error("TASK_ARGUMENTS_TOO_LARGE");
    registered.validate(template.args);
    // Initial operation templates are read-only or the specialized one-file
    // download. Other school writes require a separately designed task template.
    if (registered.mutation && template.operation !== "learn.download") throw new Error("TASK_MUTATION_NOT_ALLOWED");
    scope = { operations: [template.operation], channels: strings(template.channels ?? [], "channels", 8) };
    if (template.operation === "learn.download") scope.outputDir = absoluteDirectory(template.args[1]);
  } else throw new Error("TASK_TEMPLATE_INVALID");
  // Pick documented fields. Public requests cannot smuggle owner/revision/grants.
  return { draft: copy({ name: value.name, schedule: value.schedule, template }), scope };
}
export function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /\b(?:TASK|CLI|LEARN|AUTH|SCHOOL|OH|PERMISSION|NETWORK)_[A-Z_0-9]+\b/.exec(message)?.[0] ?? "TASK_OPERATION_FAILED";
}
export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export async function fingerprint(value: unknown): Promise<string> {
  const bytes = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(stable(value))));
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}
