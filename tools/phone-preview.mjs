#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════════
 * 竖屏预览窗口：开一个「手机形状」的**可见** Chrome 窗口，真看手机版 OneTHU。
 *
 * 为什么需要它：Cmd+Shift+M 在新版 Chrome 是切个人资料（只有 DevTools 有焦点时才是设备工具条），
 * 而桌面窗口靠手拖很难稳在手机比例；本脚本用一条固定尺寸的窗口 + CDP 先把 localStorage
 * 种子灌进去（壁纸/主题/玻璃档/首页摆位/已看过导览），于是开出来就跟真机同一个样子。
 *
 * 跑法：
 *   node tools/phone-preview.mjs                     # 首页竖屏
 *   node tools/phone-preview.mjs otherinfo           # 任意免登录预览场景
 *   node tools/phone-preview.mjs page --page=cloud   # 任意内容页（?explorer-preview=page&page=…）
 *   node tools/phone-preview.mjs home --w=430 --h=900 --seed=/tmp/contrast/seed-full-local.json
 * 关窗即结束；脚本只负责把窗口开出来，然后退出（浏览器是独立进程）。
 * ══════════════════════════════════════════════════════════════════════════ */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, existsSync } from "node:fs";

const CHROME = process.env.CHROME_BIN ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.split("=")[1] : d; };
const scene = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "home";
const page = arg("page", "");
const W = Number(arg("w", 430)), H = Number(arg("h", 900));
const PORT = Number(arg("port", 9350));
const SEED = arg("seed", "/tmp/contrast/seed-full-local.json");
const PROFILE = arg("profile", "/tmp/onethu-phone-preview");
const APP = arg("app", "http://127.0.0.1:5180");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 同尺寸窗口重复开会打架：先探一下端口，已经在跑就直接把 URL 指过去 */
const alive = async () => { try { await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); return true; } catch { return false; } };
const query = new URLSearchParams({ "explorer-preview": scene });
if (page) query.set("page", page);
const url = `${APP}/?${query.toString()}`;

if (!(await alive())) {
  mkdirSync(PROFILE, { recursive: true });
  spawn(CHROME, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    `--window-size=${W},${H}`, "--window-position=60,40",
    "--no-first-run", "--no-default-browser-check", "--disable-features=ProfilePicker",
    url,
  ], { detached: true, stdio: "ignore" }).unref();
  for (let i = 0; i < 60 && !(await alive()); i++) await sleep(300);
  await sleep(1200);
}

/* 灌种子（壁纸/主题/玻璃档/首页摆位/导览已读）后重载一次 —— 于是窗口里就是真机同款 */
let ver;
try { ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch { console.error("拿不到 CDP 端口，窗口可能开了但没法灌种子"); process.exit(1); }
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const target = list.find((t) => t.type === "page" && t.url.includes("127.0.0.1:5180")) ?? list.find((t) => t.type === "page");
if (!target) { console.error("没找到页面 target"); process.exit(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
let id = 0; const pending = new Map();
ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res } = pending.get(m.id); pending.delete(m.id); res(m.error ? { __error: m.error } : m.result); } });
const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, { res }); ws.send(JSON.stringify({ id: mid, method, params })); });

/* Browser.* 域只在**浏览器级** WebSocket 上有效（挂在页面 target 上会静默失败——
   这就是第一版 setWindowBounds 没生效的原因）。单开一条连接专门摆窗口。 */
let bid = 0; const bpend = new Map();
const bws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((res, rej) => { bws.addEventListener("open", res); bws.addEventListener("error", rej); });
bws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && bpend.has(m.id)) { const { res } = bpend.get(m.id); bpend.delete(m.id); res(m.error ? { __error: m.error } : m.result); } });
const bsend = (method, params = {}) => new Promise((res) => { const mid = ++bid; bpend.set(mid, { res }); bws.send(JSON.stringify({ id: mid, method, params })); });
if (existsSync(SEED)) {
  const seed = readFileSync(SEED, "utf8");
  await send("Page.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `(()=>{const s=${seed};for(const k of Object.keys(s)){try{localStorage.setItem(k,s[k])}catch(e){}}})();` });
  await send("Page.navigate", { url });
  await sleep(1500);
}
/* 窗口尺寸：--window-size 在 macOS 上常被忽略（实测开出来 500x547），
   所以连上 CDP 后用 Browser.setWindowBounds 精确摆一次 —— 这样才真的是"手机形状"。 */
const win = await bsend("Browser.getWindowForTarget", { targetId: target.id });
let sizeErr = "";
if (win?.windowId != null) {
  await bsend("Browser.setWindowBounds", { windowId: win.windowId, bounds: { windowState: "normal" } });
  const r = await bsend("Browser.setWindowBounds", { windowId: win.windowId, bounds: { left: 60, top: 40, width: W, height: H } });
  if (r?.__error) sizeErr = JSON.stringify(r.__error).slice(0, 120);
  await sleep(800);
} else {
  sizeErr = win?.__error ? JSON.stringify(win.__error).slice(0, 120) : "拿不到 windowId";
}
const size = await send("Runtime.evaluate", { expression: "innerWidth + 'x' + innerHeight", returnByValue: true });
console.log(`手机预览窗口已就绪：${url}`);
console.log(`视口 ${size.result?.value ?? "?"}（短边 < 600 即手机形态）；尺寸用 --w/--h 改，关掉窗口即结束。` + (sizeErr ? ` [窗口尺寸设置失败：${sizeErr}]` : ""));
console.log(ver.Browser ? `浏览器 ${ver.Browser}` : "");
/* 显式收尾：两条 CDP WebSocket 不关的话 node 不会自己退（第一版就卡在这儿） */
try { ws.close(); } catch {}
try { bws.close(); } catch {}
process.exit(0);
