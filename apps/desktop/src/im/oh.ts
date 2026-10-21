/**
 * OH 桥：IM 入站 → onethu.harness 的 chat 命令 → 回复原路发回。
 *
 * 首版按无后端主案（docs/im-cloud/00 §2.2）走「chat 命令零改动」路线：
 * 与 ChatDock 完全同一契约（callRust run {command:"chat"}，应答 {answer,error,confirm}），
 * 两段式确认直接映射为发送「确认/取消」二字——不新增任何 harness 方法。
 *
 * 2026-10-11 多模态：run 增加**可选** `attachments`（附件图片的 base64）。
 * 「是否真按图像喂模型」由 harness 侧设置项 `multimodal` 决定（见 core/src/config.rs），
 * 前端**不镜像**这个状态——没有附件时连 `attachments` 键都不带，请求形状与之前逐字节一致。
 *
 * 单飞队列：OH 的 chat 是有状态的连续对话，并发 run 会互串；IM 侧把并发
 * 入站排队串行执行，超队直接以忙回执（用户体感=排队叫号）。
 */
import { callRust } from "../plugins/rust.js";
import { logLine } from "../lib/clients.js";
import type { OhChatResult } from "./types.js";

const OH_ID = "onethu.harness";
/** 同时最多 1 个在跑、排队上限 4：防消息轰炸把 OH 顶满 */
const MAX_QUEUE = 4;

/** 随 chat 一起发出去的附件（图片等）。`dataBase64` 是**纯 base64**（不带 `data:` 前缀）。 */
export interface OhAttachment {
  name: string;
  mime: string;
  dataBase64: string;
}

let queue: Array<{ input: string; attachments?: OhAttachment[]; done: (r: OhChatResult) => void }> = [];
let running = false;

function fmt(r: unknown): OhChatResult {
  const v = (r ?? {}) as OhChatResult;
  return {
    answer: typeof v.answer === "string" ? v.answer : undefined,
    error: typeof v.error === "string" ? v.error : undefined,
    confirm: v.confirm && typeof v.confirm === "object" ? v.confirm : null,
  };
}

/** run 的 params：没有附件时**不带 attachments 键**（老端点零风险） */
export function runParams(
  command: string,
  input: string,
  attachments?: OhAttachment[],
): Record<string, unknown> {
  return {
    command,
    input,
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
  };
}

async function runOne(input: string, attachments?: OhAttachment[]): Promise<OhChatResult> {
  // 与桌面对话共用 callRust 的一次预检及后台运行门禁。
  try {
    const out = await callRust(OH_ID, "run", runParams("chat", input, attachments));
    // 主对话云盘同步：每轮 chat 完成后 debounce push（跨设备共享 active 会话）
    void import("./sessionSync.js").then((m) => m.scheduleSessionPush()).catch(() => undefined);
    return fmt(out);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

async function pump(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const head = queue.shift();
      if (!head) return;
      const t0 = Date.now();
      const r = await runOne(head.input, head.attachments);
      void logLine(
        `[IM] OH chat 完成 ${Date.now() - t0}ms${head.attachments?.length ? ` imgs=${head.attachments.length}` : ""} ${r.error ? `err=${r.error.slice(0, 80)}` : "ok"}`,
      );
      head.done(r);
    }
  } finally {
    running = false;
  }
}

/** 发给 OH 并等待应答；忙时排队（超队立即以忙回执，不悬挂发送方）。
 *  `attachments`（可选）= 随消息附带的图片；是否真按图像读由 harness 的多模态开关决定。 */
export function askOh(input: string, attachments?: OhAttachment[]): Promise<OhChatResult> {
  if (queue.length >= MAX_QUEUE) {
    return Promise.resolve({ answer: "上一条还在处理中，请稍候再发。" });
  }
  return new Promise<OhChatResult>((done) => {
    queue.push({ input, attachments, done });
    void pump();
  });
}

/** 直接执行 OH 的会话管理命令（registry 的 /new /sessions /switch 用；不走单飞队列） */
export function ohRun(command: string, input = "", attachments?: OhAttachment[]): Promise<unknown> {
  return callRust(OH_ID, "run", runParams(command, input, attachments));
}
