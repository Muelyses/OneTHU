/**
 * 极简 CDP 客户端（WebView DevTools 协议）——Demo Flow 自动化的眼睛与手。
 *
 * 为什么不用 uiautomator / 坐标：实测本应用 WebView **不向 uiautomator 暴露可访问性节点**
 * （dump 出来只有一个空 WebView），而坐标写死在换设备/换字号后必崩。CDP 直接读写渲染进程里的
 * 真实 DOM：元素文字、坐标、滚动都能拿到，点击用 Input.dispatchMouseEvent（可信事件）。
 *
 * 连接方式：adb forward tcp:<port> localabstract:webview_devtools_remote_<pid>
 */
import { execFileSync } from "node:child_process";

export function adb(args, opts = {}) {
  return execFileSync("adb", args, { encoding: "utf8", ...opts });
}

/** 找到应用 WebView 的 devtools socket 名（release 也可能开着，实测 demo 包是开的） */
export function webviewSocket(pkg) {
  const pid = adb(["shell", "pidof", pkg]).trim();
  if (!pid) throw new Error(`应用未运行：${pkg}`);
  const socks = adb(["shell", "cat", "/proc/net/unix"]).split("\n");
  const hit = socks.map((l) => l.trim().split(/\s+/).pop()).find((n) => n?.startsWith("@webview_devtools_remote_"));
  if (!hit) throw new Error("未找到 WebView devtools socket（该构建未开启调试）");
  return { pid, socket: hit.replace(/^@/, "") };
}

/** 建立 CDP 连接：adb forward → /json 列表 → WebSocket */
export async function connectCdp(pkg, port = 9222) {
  const { pid, socket } = webviewSocket(pkg);
  try { adb(["forward", "--remove", `tcp:${port}`], { stdio: "ignore" }); } catch { /* 没有旧的 */ }
  adb(["forward", `tcp:${port}`, `localabstract:${socket}`]);

  const list = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
  const page = list.find((t) => t.type === "page") ?? list[0];
  if (!page?.webSocketDebuggerUrl) throw new Error("没有可连接的页面目标");

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", () => res());
    ws.addEventListener("error", (e) => rej(new Error(`WS 连接失败：${e?.message ?? e}`)));
  });

  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
      setTimeout(() => {
        if (pending.has(mid)) { pending.delete(mid); reject(new Error(`CDP 超时：${method}`)); }
      }, 15000);
    });

  /** 在页面里求值（返回 JSON 化的结果） */
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`页面求值异常：${r.exceptionDetails.text}`);
    return r.result?.value;
  };

  return { send, evaluate, pid, close: () => ws.close() };
}

/** 人类化等待：带 ±25% 抖动，避免"机械秒点" */
export function human(ms) {
  const jitter = ms * 0.25;
  return new Promise((r) => setTimeout(r, Math.round(ms - jitter + Math.random() * jitter * 2)));
}

/**
 * 找到可见元素（按文字/属性），返回中心点与文本——CDP 版的「看懂界面」。
 * 多个命中时取最靠上、面积合理的那个（避免拿到隐藏节点或整页容器）。
 */
export const FIND_JS = (needle) => `(() => {
  const needle = ${JSON.stringify(needle)};
  const all = [...document.querySelectorAll('*')];
  const hits = [];
  for (const el of all) {
    const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
    const txt = own || (el.children.length === 0 ? (el.textContent || '').trim() : '');
    const attr = (el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || '').trim();
    if (!txt && !attr) continue;
    if (!(txt.includes(needle) || attr.includes(needle))) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8 || r.bottom < 0 || r.top > innerHeight) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
    hits.push({ text: (txt || attr).slice(0, 60), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height), cls: String(el.className || '').slice(0, 60) });
  }
  hits.sort((a, b) => (a.w * a.h) - (b.w * b.h));
  return hits.slice(0, 6);
})()`;
