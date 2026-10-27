/** Common task command descriptions. Authorization is supplied only by the host. */
import type { TaskDraft, TaskManager } from "./types.js";
const id = { type: "string", minLength: 1, maxLength: 160 };
const object = { type: "object" };
const tuple = (items: unknown[]) => ({ type: "array", items, minItems: items.length, maxItems: items.length, additionalItems: false });
export const taskOperations = [
  { name: "tasks.list", description: "List persistent tasks for this account.", parameters: tuple([]) },
  { name: "tasks.get", description: "Inspect one task and its authorized scope.", parameters: tuple([id]) },
  { name: "tasks.create", description: "Authorize a persistent task, its schedule, courses, output directory and notification channels on this device.", parameters: tuple([object]), mutation: true, requiresGrant: true },
  { name: "tasks.update", description: "Replace a task definition and explicitly approve its continuing scope.", parameters: tuple([id, object]), mutation: true, requiresGrant: true },
  { name: "tasks.pause", description: "Immediately pause a task and cancel its active run.", parameters: tuple([id]), mutation: true },
  { name: "tasks.resume", description: "Resume a task after approving its recorded continuing scope.", parameters: tuple([id]), mutation: true, requiresGrant: true },
  { name: "tasks.remove", description: "Remove a task and stop its run; downloaded files are retained.", parameters: tuple([id]), mutation: true },
  { name: "tasks.run", description: "Run a previously authorized task now within its recorded scope.", parameters: tuple([id]), mutation: true },
  { name: "tasks.history", description: "Read recent runs, changes and uncertain deliveries.", parameters: tuple([id]) },
];
export function invokeTaskOperation(manager: TaskManager, operation: string, args: unknown[]): Promise<unknown> {
  switch (operation) {
    case "tasks.list": return manager.list();
    case "tasks.get": return manager.get(args[0] as string);
    case "tasks.create": return manager.create(args[0] as TaskDraft);
    case "tasks.update": return manager.update(args[0] as string, args[1] as TaskDraft);
    case "tasks.pause": return manager.pause(args[0] as string);
    case "tasks.resume": return manager.resume(args[0] as string);
    case "tasks.remove": return manager.remove(args[0] as string);
    case "tasks.run": return manager.run(args[0] as string);
    case "tasks.history": return manager.history(args[0] as string);
    default: return Promise.reject(new Error("UNKNOWN_TASK_OPERATION"));
  }
}
