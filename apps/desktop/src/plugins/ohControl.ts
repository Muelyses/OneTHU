/**
 * OH 命令总线（dev-explorer）：把「打开 OH 面板 / 进入语音」从 UI 组件解耦出来。
 *
 * 为什么要有这层：胶囊条（底栏中央）、悬浮球、首页搜索框、检索空态都可能要
 * 「打开搜索小窗 / 直接进语音」，而 ChatDock 是重状态机组件——它们不该 import 它。
 * 各 UI 只发命令；ChatDock 挂载时订阅并执行（palette.ts 同款模块级模式）。
 *
 * 发送目标（搜索 or OH）由 state/explorerPrefs.ts 的默认值 + 小窗内临时切换决定，
 * 这里不携带目标——那是 ChatDock 内部的事。
 */
export type OhMode = "search" | "oh" | "xiaoda";

export type OhCommand =
  | { type: "panel"; mode: OhMode; presetQuery?: string }
  | { type: "voice" };

let queue: OhCommand[] = [];
const subs = new Set<(cmd: OhCommand) => void>();

function dispatch(cmd: OhCommand): void {
  if (subs.size === 0) {
    // ChatDock 尚未挂载（理论上不会：它常驻）；排队防丢
    queue.push(cmd);
    if (queue.length > 4) queue.shift();
    return;
  }
  for (const f of subs) f(cmd);
}

/** 打开 OH 小窗：mode=search 落搜索；mode=oh 落 OH 对话；mode=xiaoda 落清小搭（只开新默认对话） */
export function requestOhPanel(mode: OhMode = "search", presetQuery?: string): void {
  dispatch({ type: "panel", mode, presetQuery });
}

/** 直接进语音输入（长按胶囊/悬浮球；发送目标按 explorerPrefs.voiceTarget） */
export function requestOhVoice(): void {
  dispatch({ type: "voice" });
}

/** ChatDock 订阅入口；返回退订函数。订阅即消费积压命令。 */
export function onOhCommand(f: (cmd: OhCommand) => void): () => void {
  subs.add(f);
  for (const cmd of queue.splice(0)) f(cmd);
  return () => {
    subs.delete(f);
  };
}
