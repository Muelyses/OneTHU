#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════════
 * 竖屏（手机）布局体检 —— 用真触摸仿真的手机视口，把「截断 / 溢出 / 太小的触目标」量出来
 *
 * 为什么不能只看 CSS：`html.is-phone` 的判据是 `触屏 && 宽度不是 expanded`，桌面窄窗**不会**
 * 进手机档；只截桌面窗口永远看不到手机布局。本工具用 CDP 打开触摸仿真再开页，等价真机。
 *
 * 跑法：
 *   node tools/phone-audit.mjs "http://127.0.0.1:5180/?explorer-preview=home" 主页
 *   node tools/phone-audit.mjs ... 主页 --w=390 --h=844 [--dpr=3] [--land=1] [--dark] [--wait=4000]
 *   node tools/phone-audit.mjs ... 主页 --seed=seed.json      # 注入用户壁纸/主题/玻璃档
 * 产物：/tmp/phone-audit/<标签>.png|.json ；有「横向溢出」或「文字截断」= exit 1。
 * ══════════════════════════════════════════════════════════════════════════ */
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME_BIN ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.CDP_PORT ?? 9342);
const OUT = process.env.PHONE_OUT ?? "/tmp/phone-audit";
const url = process.argv[2];
const tag = process.argv[3] ?? "phone";
const num = (name, dflt) => { const a = process.argv.find((x) => x.startsWith(`--${name}=`)); return a ? Number(a.split("=")[1]) : dflt; };
const W = num("w", 390), H = num("h", 844);
const DPR = num("dpr", 3);
const LAND = process.argv.some((a) => a === "--land" || a.startsWith("--land="));
const DARK = process.argv.includes("--dark");
const waitMs = num("wait", 4000);
const seedArg = process.argv.find((a) => a.startsWith("--seed="));
if (!url) { console.error('用法：node tools/phone-audit.mjs "<url>" <标签> [--w=390 --h=844 --dpr=3 --land --dark --wait=4000 --seed=f.json]'); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vw = LAND ? Math.max(W, H) : Math.min(W, H);
const vh = LAND ? Math.min(W, H) : Math.max(W, H);

const REPORT = String.raw`(() => {
  const R = (el) => el.getBoundingClientRect();
  const label = (el) => {
    const cls = (typeof el.className === "string" ? el.className : "").trim().split(/\s+/).filter(Boolean).slice(0, 3).join(".");
    const t = (el.textContent || "").trim().slice(0, 18);
    return el.tagName.toLowerCase() + (cls ? "." + cls : "") + (t ? " 「" + t + "」" : "");
  };
  const vw = innerWidth, vh = innerHeight;
  const out = { vw, vh, phoneClass: document.documentElement.classList.contains("is-phone"), scheme: document.documentElement.dataset.scheme || "", issues: { overflowX: [], clippedText: [], tinyTargets: [], offscreen: [], textOverlap: [] } };
  const all = [...document.querySelectorAll("body *")];
  for (const el of all) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity || "1") < 0.1) continue;
    const r = R(el);
    if (r.width < 1 || r.height < 1) continue;
    const fixedOrAbs = cs.position === "fixed" || cs.position === "absolute";
    // ① 横向溢出：内容比视口宽（且不是允许横滚的容器）
    const scrollableX = cs.overflowX === "auto" || cs.overflowX === "scroll";
    if (!scrollableX && (r.right > vw + 1 || r.left < -1) && el.scrollWidth > vw + 1) {
      out.issues.overflowX.push({ el: label(el), rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], scrollW: el.scrollWidth });
    }
    // ② 文字被截断：自己滚得动但被 overflow 裁掉
    const clips = cs.overflow === "hidden" || cs.overflowY === "hidden";
    if (clips && el.scrollHeight > el.clientHeight + 2 && el.clientHeight > 0 && (el.textContent || "").trim()) {
      out.issues.clippedText.push({ el: label(el), clientH: el.clientHeight, scrollH: el.scrollHeight, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] });
    }
    // ③ 触目标太小（可点元素 < 40px 高或 < 32px 宽）
    const clickable = el.matches("button, a[href], input, select, textarea, [role=button], [role=tab], [data-tap]") && !el.closest("[aria-hidden=true]");
    if (clickable) {
      const small = (r.height < 40 && r.width < 40) || r.height < 28;
      if (small) out.issues.tinyTargets.push({ el: label(el), rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] });
    }
    // ④ 固定层跑出视口
    if (fixedOrAbs && r.width > 4 && r.height > 4 && (r.right < 2 || r.bottom < 2 || r.left > vw - 2 || r.top > vh - 2)) {
      out.issues.offscreen.push({ el: label(el), rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] });
    }
  }
  // ⑤ 文字互相压（真「重叠」）：两个**流内**的文字叶子矩形相交超过小者的 30%。
  //    固定/绝对定位的元素（FAB、徽标、浮层）天然压内容，不算——那些单独看。
  /* 只看"真的看得见、又没被别的层盖住"的流内文字叶子 —— 否则浮层与隐藏层会刷一堆假互压
     （设置浮层盖住首页、隐藏的登录层都是这么进来的）。 */
  const hidden = (el) => {
    if (typeof el.checkVisibility === "function") {
      return !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true });
    }
    const cs2 = getComputedStyle(el);
    return cs2.display === "none" || cs2.visibility === "hidden" || parseFloat(cs2.opacity || "1") < 0.05;
  };
  const occluded = (el, r) => {
    const x = Math.min(innerWidth - 1, Math.max(1, r.left + r.width / 2));
    const y = Math.min(innerHeight - 1, Math.max(1, r.top + r.height / 2));
    const hit = document.elementFromPoint(x, y);
    if (!hit) return true;
    return !(hit === el || el.contains(hit) || hit.contains(el));
  };
  const leaves = all.filter((el) => {
    const cs2 = getComputedStyle(el);
    if (cs2.position === "fixed" || cs2.position === "absolute") return false;
    if (hidden(el)) return false;
    if (!(el.textContent || "").trim()) return false;
    return ![...el.children].some((c) => (c.textContent || "").trim());
  }).filter((el) => !occluded(el, R(el))).slice(0, 500);
  const boxes = leaves.map((el) => ({ el, r: R(el) })).filter((x) => x.r.width > 2 && x.r.height > 2);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].r, b = boxes[j].r;
      const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ix <= 1 || iy <= 1) continue;
      const inter = ix * iy;
      const small = Math.min(a.width * a.height, b.width * b.height);
      if (inter / small < 0.3) continue;
      if (boxes[i].el.contains(boxes[j].el) || boxes[j].el.contains(boxes[i].el)) continue;
      out.issues.textOverlap.push({ a: label(boxes[i].el), b: label(boxes[j].el), ratio: Math.round((inter / small) * 100) });
      if (out.issues.textOverlap.length > 24) break;
    }
    if (out.issues.textOverlap.length > 24) break;
  }

  // ⑥ 顶/底栏与内容的几何关系：内容和固定栏有没有互相压
  const bars = [...document.querySelectorAll(".explorer-topbar, .ex-mobile-strip, .ex-bbar, .ex-tb-home-mark, .ex-rail")].map((el) => {
    const r = R(el); const cs = getComputedStyle(el);
    return { el: label(el), pos: cs.position, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], display: cs.display };
  });
  const content = document.querySelector(".explorer-content");
  const contentPad = content ? { padTop: getComputedStyle(content).paddingTop, padBottom: getComputedStyle(content).paddingBottom } : null;
  out.bars = bars; out.contentPad = contentPad;
  out.docScrollW = document.documentElement.scrollWidth;
  out.strips = { mobileStrip: !!document.querySelector(".ex-mobile-strip"), tabstrip: !!document.querySelector(".explorer-topbar .tabstrip, .explorer-topbar [class*=strip]") };
  return out;
})()`;

const dir = mkdtempSync(join(tmpdir(), "phone-"));
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`,
  "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--hide-scrollbars", "about:blank",
], { stdio: "ignore" });

let ws = null;
try {
  let ver = null;
  for (let i = 0; i < 60 && !ver; i++) { try { ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch { await sleep(250); } }
  if (!ver) throw new Error("headless Chrome 起不来");
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === "page");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
  let id = 0; const pending = new Map(); const listeners = [];
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
    else if (m.method) for (const l of listeners) l(m);
  });
  const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error("页面异常：" + JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result.value;
  };
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: vw, height: vh, deviceScaleFactor: DPR, mobile: true, screenWidth: vw, screenHeight: vh });
  /* 默认按真机（触摸仿真）；--desk 关掉触摸，验「桌面拖窄窗也进手机形态」这条 */
  if (!process.argv.includes("--desk")) await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  if (seedArg) {
    const seed = JSON.parse(readFileSync(seedArg.slice("--seed=".length), "utf8"));
    await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { const s = ${JSON.stringify(seed)}; for (const k of Object.keys(s)) { try { localStorage.setItem(k, s[k]); } catch (e) {} } })();` });
  }
  const loaded = new Promise((res) => { const t = setTimeout(res, 12000); listeners.push((m) => { if (m.method === "Page.loadEventFired") { clearTimeout(t); res(); } }); });
  await send("Page.navigate", { url });
  await loaded;
  await sleep(waitMs);
  if (DARK) { await evaluate(`document.documentElement.dataset.scheme='dark'`); await sleep(1200); }
  const rep = await evaluate(REPORT);
  const shot = await send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${tag}.png`), Buffer.from(shot.data, "base64"));
  writeFileSync(join(OUT, `${tag}.json`), JSON.stringify(rep, null, 1));
  const i = rep.issues;
  console.log(`\n=== ${tag} ${vw}x${vh}@${DPR}x is-phone=${rep.phoneClass} 手机条=${rep.strips.mobileStrip} 顶栏标签条=${rep.strips.tabstrip} docScrollW=${rep.docScrollW} ===`);
  console.log(`栏体：` + rep.bars.map((b) => `${b.el}[${b.pos}]${b.rect.join(",")}`).join("  "));
  console.log(`内容内边距：${JSON.stringify(rep.contentPad)}`);
  console.log(`横向溢出=${i.overflowX.length}  文字截断=${i.clippedText.length}  文字互压=${i.textOverlap.length}  触目标过小=${i.tinyTargets.length}  跑出视口=${i.offscreen.length}   产物 ${OUT}/${tag}.png|.json`);
  for (const x of i.textOverlap.slice(0, 6)) console.log(`  互压 ${x.ratio}%  ${x.a}  ×  ${x.b}`);
  for (const x of i.overflowX.slice(0, 8)) console.log(`  溢出 ${x.el} rect=${x.rect} scrollW=${x.scrollW}`);
  for (const x of i.clippedText.slice(0, 10)) console.log(`  截断 ${x.el} clientH=${x.clientH} scrollH=${x.scrollH} rect=${x.rect}`);
  for (const x of i.tinyTargets.slice(0, 8)) console.log(`  小目标 ${x.el} rect=${x.rect}`);
  process.exitCode = (i.overflowX.length || i.clippedText.length || i.textOverlap.length) ? 1 : 0;
} finally {
  try { ws?.close(); } catch {}
  chrome.kill("SIGKILL");
}
