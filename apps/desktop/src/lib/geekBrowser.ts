/**
 * 极客模式（浏览器探索）TS 半边：CDP over WebSocket 直连本机 EXPLORER 浏览器。
 *
 * - Rust 侧（geek_browser_*）负责进程生命周期：独立 profile（登录态自持）+ remote-debugging-port；
 * - 本文件负责连 ws://127.0.0.1:<port>，取 page target，发 Runtime.evaluate / Page.navigate；
 * - 能力面刻意最小：navigate / eval / snapshot（innerText + 可交互元素清单）。
 *   不做跨页 JS 注入服务、不做无头后台爬取——「真人操作视角，助理读回来」。
 * - 手机端（Android）在 Rust 侧直接报错；这里不再重复判定。
 * - 连接是会话级：App 重启后 Rust 侧浏览器进程若仍活着，可随时重连（launch 幂等返回端口）。
 */
import { invoke } from "@tauri-apps/api/core";

export interface GeekProbe {
  browsers: string[];
  profileReady: boolean;
  playwrightReady: boolean;
  profileDir: string;
  running?: boolean;
  port?: number;
}

export interface GeekLaunch {
  pid?: number;
  port?: number;
  profileDir: string;
  alreadyRunning?: boolean;
}

export async function probeGeek(): Promise<GeekProbe> {
  const base = await invoke<GeekProbe>("geek_browser_probe");
  return { ...base, running: cdpPort > 0, port: cdpPort || undefined };
}

/** 页面 target 的 ws 地址（e797 /json 列表，取第一个 type=page 非 devtools 项） */
async function pageWs(port: number): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${port}/json`);
  if (!res.ok) throw new Error(`调试口 ${port} 没应答（浏览器可能还在启动，稍等再试）`);
  const list = (await res.json()) as Array<{ type: string; webSocketDebuggerUrl: string; url: string }>;
  const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl && !t.url.startsWith("devtools://"));
  if (!page || !page.webSocketDebuggerUrl) throw new Error("没有可用的页面（去探索浏览器里开一个标签页）");
  return page.webSocketDebuggerUrl;
}

type CdpId = number;
let cdpWs: WebSocket | null = null;
let cdpPort = 0;
let seq: CdpId = 0;
const pending = new Map<CdpId, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function onMessage(ev: MessageEvent): void {
  try {
    const msg = JSON.parse(String(ev.data)) as { id?: CdpId; error?: { message: string }; result?: unknown };
    if (typeof msg.id === "number") {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (!p) return;
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
    }
  } catch {
    /* 非 JSON 帧：忽略 */
  }
}

async function connect(port: number): Promise<void> {
  if (cdpWs && cdpPort === port && cdpWs.readyState === WebSocket.OPEN) return;
  if (cdpWs) {
    try { cdpWs.close(); } catch { /* noop */ }
    cdpWs = null;
  }
  const wsUrl = await pageWs(port);
  cdpWs = new WebSocket(wsUrl);
  cdpPort = port;
  cdpWs.onmessage = onMessage;
  await new Promise<void>((resolve, reject) => {
    cdpWs?.addEventListener("open", () => resolve(), { once: true });
    cdpWs?.addEventListener("error", () => reject(new Error("连不上探索浏览器（调试口在但页面没就绪）")), { once: true });
  });
}

async function cdp(method: string, params?: Record<string, unknown>): Promise<unknown> {
  if (!cdpWs || cdpWs.readyState !== WebSocket.OPEN) throw new Error("探索浏览器没在运行（先启动）");
  seq += 1;
  const id = seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    cdpWs?.send(JSON.stringify({ id, method, params }));
    window.setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`${method} 15 秒没回音`));
      }
    }, 15_000);
  });
}

/** 启动（幂等：已在跑就返回现有端口）。mode: "system" | "playwright" */
export async function launchGeek(mode: string): Promise<GeekLaunch> {
  const r = await invoke<GeekLaunch>("geek_browser_launch", { mode });
  if (typeof r.port === "number" && r.port > 0) await connect(r.port).catch(() => undefined);
  return r;
}

export async function geekNavigate(url: string): Promise<void> {
  const port = cdpPort;
  if (!port) throw new Error("探索浏览器没在运行（先启动）");
  await connect(port);
  await cdp("Page.navigate", { url });
}

export async function geekEval(js: string): Promise<unknown> {
  const port = cdpPort;
  if (!port) throw new Error("探索浏览器没在运行（先启动）");
  await connect(port);
  const r = (await cdp("Runtime.evaluate", { expression: js, returnByValue: true, awaitPromise: true })) as
    | { result?: { value?: unknown; type?: string; description?: string } }
    | undefined;
  return r?.result?.value ?? r?.result?.description ?? null;
}

export interface GeekSnapshot {
  title: string;
  url: string;
  text: string;
}

export async function geekSnapshot(): Promise<GeekSnapshot> {
  const port = cdpPort;
  if (!port) throw new Error("探索浏览器没在运行（先启动）");
  await connect(port);
  const r = (await cdp("Runtime.evaluate", {
    expression:
      "(() => {" +
      "const text = (document.body && document.body.innerText) || '';" +
      "const els = Array.from(document.querySelectorAll('a[href],button,input,select,textarea'))" +
      "  .slice(0, 80)" +
      "  .map((e) => (e instanceof HTMLElement) ? (e.innerText || e.getAttribute('aria-label') || e.getAttribute('placeholder') || '') " +
      "    + (e instanceof HTMLAnchorElement ? ' [' + e.getAttribute('href') + ']' : e instanceof HTMLInputElement ? ' [input:' + e.type + ']' : '')" +
      "  ).filter(Boolean).slice(0, 80);" +
      "return JSON.stringify({ title: document.title || '', url: location.href, text: text.slice(0, 12000), elements: els });" +
      "})()",
    returnByValue: true,
  })) as { result?: { value?: string } };
  try {
    if (typeof r?.result?.value === "string") return JSON.parse(r.result.value) as GeekSnapshot;
  } catch {
    /* 解析失败走空壳 */
  }
  return { title: "", url: "", text: "" };
}

export async function closeGeek(): Promise<boolean> {
  try {
    cdpWs?.close();
    cdpWs = null;
    cdpPort = 0;
  } catch {
    /* noop */
  }
  return invoke<boolean>("geek_browser_close");
}

/** 一键下载 playwright chromium（桌面 Only；阻塞到完成才返回日志尾） */
export function installPlaywright(): Promise<string> {
  return invoke<string>("geek_playwright_install");
}
