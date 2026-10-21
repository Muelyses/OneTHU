#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════════
 * 对比度实测审计 —— 「白字压白底 / 黑字压深底」的取证工具（无依赖）
 *
 * 为什么需要它：单看 CSS 或单看引擎自报都判不准。本工具的判据是**真实渲染像素**：
 *   ① headless Chrome 打开 dev 服务器（默认 127.0.0.1:5180）的某个免登录场景；
 *   ② 页内取「每个文本节点自己的颜色 + 各段文字矩形」，并标记是否被上层盖住；
 *   ③ 截图后在 Node 里解码 PNG，对每段文字**取盒外一圈像素的众数色**当背景
 *      （盒内取众数会被大字号小盒子骗到：22px 的「日」量出来是深底，其实是浅托盘）；
 *   ④ 按 WCAG 算对比率，低于 3:1 报「严重」，低于 AA 需求（小字 4.5 / 大字 3）报「偏弱」。
 *
 * 跑法（dev 服务器必须已经在跑；端口别重起第二个，会撞）：
 *   node tools/contrast-audit.mjs "http://127.0.0.1:5180/?explorer-preview=home" 主页
 *   node tools/contrast-audit.mjs "http://127.0.0.1:5180/?explorer-preview=overlay" 设置面板
 *   node tools/contrast-audit.mjs ... 标签 --dark            # 先切成深色套再量
 *   node tools/contrast-audit.mjs ... 标签 --seed=seed.json  # 先注入 localStorage 再开页
 *   node tools/contrast-audit.mjs ... 标签 --wait=20000       # 静置 20s 再量（视频壁纸漂移路径）
 *   #   seed.json = {"键":"值"}，用来复现「用户的壁纸/主题/玻璃档」；见文件尾部说明
 *
 * 输出：控制台清单（按对比率升序）+ /tmp/contrast-audit/<标签>.png / .json
 * 退出码：有严重项 = 1（可直接进护栏链），否则 0。
 *
 * ⚠️ 已知误判（人工复核这两类，别当 bug 改）：
 *   · 极小元件（角标/圆点）四周有描边时，"盒外一圈"会取到描边色 → 报出假阳性；
 *   · 被弹层盖住的字已用 elementFromPoint 过滤，但半透明遮罩下的字仍会被量到。
 * ══════════════════════════════════════════════════════════════════════════ */
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";

const CHROME = process.env.CHROME_BIN ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.CDP_PORT ?? 9341);
const OUT = process.env.CONTRAST_OUT ?? "/tmp/contrast-audit";
const url = process.argv[2];
const tag = process.argv[3] ?? "run";
const dark = process.argv.includes("--dark");
const light = process.argv.includes("--light");
const seedArg = process.argv.find((a) => a.startsWith("--seed="));
const waitArg = process.argv.find((a) => a.startsWith("--wait="));
const WAIT_MS = waitArg ? Number(waitArg.slice("--wait=".length)) : 3500;   // 开页后静置多久再量（视频壁纸建议 --wait=20000）
if (!url) {
  console.error('用法：node tools/contrast-audit.mjs "<url>" <标签> [--dark|--light] [--seed=文件.json]');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── 页内采集：文本节点 → 颜色/字号/矩形/是否被盖 ───────────────────────── */
const COLLECT = String.raw`(() => {
  const path = (el) => {
    const parts = [];
    for (let p = el; p && p.nodeType === 1 && parts.length < 4; p = p.parentElement) {
      let s = p.tagName.toLowerCase();
      const cls = (typeof p.className === "string" ? p.className : "").trim().split(/\s+/).filter(Boolean).slice(0, 3).join(".");
      if (cls) s += "." + cls;
      parts.unshift(s);
    }
    return parts.join(">");
  };
  const out = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const txt = (n.textContent || "").trim();
    if (!txt) continue;
    const el = n.parentElement;
    if (!el) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || parseFloat(cs.opacity || "1") < 0.15) continue;
    const r = document.createRange();
    r.selectNodeContents(n);
    const rects = [...r.getClientRects()].filter((rc) => rc.width > 1 && rc.height > 1);
    if (!rects.length) continue;
    const occl = rects.map((rc) => {
      const cx = Math.min(innerWidth - 1, Math.max(0, Math.round(rc.left + rc.width / 2)));
      const cy = Math.min(innerHeight - 1, Math.max(0, Math.round(rc.top + rc.height / 2)));
      const top = document.elementFromPoint(cx, cy);
      return !top ? true : !(top === el || el.contains(top) || top.contains(el));
    });
    out.push({
      o: occl, s: path(el), t: txt.slice(0, 30), c: cs.color,
      fs: Math.round(parseFloat(cs.fontSize) * 10) / 10, fw: cs.fontWeight,
      tx: el.dataset.tx || el.dataset.txi || null, inl: el.style.color || null,
      r: rects.slice(0, 8).map((rc) => [Math.round(rc.left), Math.round(rc.top), Math.round(rc.right), Math.round(rc.bottom)]),
    });
  }
  return { items: out, scheme: document.documentElement.dataset.scheme || "", glass: document.documentElement.dataset.glass || "" };
})()`;

/* ── 极简 PNG 解码（8bit RGB/RGBA、非隔行） ─────────────────────────────── */
function decodePng(buf) {
  let p = 8, w = 0, h = 0, depth = 8, colorType = 6, interlace = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("ascii", p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; colorType = data[9]; interlace = data[12]; }
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  if (depth !== 8 || interlace !== 0) throw new Error(`不支持的 PNG：depth=${depth} interlace=${interlace}`);
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!ch) throw new Error(`不支持的 colorType=${colorType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const cur = Buffer.from(raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride));
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      let v = cur[i];
      if (ft === 1) v += a; else if (ft === 2) v += b; else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
      cur[i] = v & 255;
    }
    cur.copy(out, y * stride); prev = cur;
  }
  return { width: w, height: h, channels: ch, data: out };
}
const px = (img, x, y) => { const i = (y * img.width + x) * img.channels; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };

const lin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const hi = Math.max(a, b), lo = Math.min(a, b); return (hi + 0.05) / (lo + 0.05); };
const parse = (s) => { const m = (s || "").match(/[\d.]+/g) || []; return m.length >= 3 ? [+m[0], +m[1], +m[2]] : null; };

/** 背景 = 文字盒**外一圈**的众数色（盒内会被字形像素带偏，见文件头） */
function bgOf(img, rect, textRgb) {
  const [x0, y0, x1, y1] = rect;
  const L = Math.max(0, x0 - 1), T = Math.max(0, y0 - 1), R = Math.min(img.width - 1, x1 + 1), B = Math.min(img.height - 1, y1 + 1);
  if (R <= L || B <= T) return null;
  const pad = Math.max(3, Math.min(8, Math.round(0.25 * Math.min(x1 - x0, y1 - y0))));
  const hist = new Map();
  const add = (x, y) => {
    const c = px(img, x, y); const k = ((c[0] >> 4) << 8) | ((c[1] >> 4) << 4) | (c[2] >> 4);
    let e = hist.get(k); if (!e) { e = { n: 0, r: 0, g: 0, b: 0 }; hist.set(k, e); }
    e.n++; e.r += c[0]; e.g += c[1]; e.b += c[2];
  };
  const oL = Math.max(0, x0 - pad), oT = Math.max(0, y0 - pad);
  const oR = Math.min(img.width - 1, x1 + pad), oB = Math.min(img.height - 1, y1 + pad);
  let ring = 0;
  for (let y = oT; y <= oB; y++) for (let x = oL; x <= oR; x++) { if (x >= L && x <= R && y >= T && y <= B) continue; add(x, y); ring++; }
  if (ring < 12) for (let y = T; y <= B; y++) for (let x = L; x <= R; x++) add(x, y);
  const bins = [...hist.values()].map((e) => ({ n: e.n, c: [Math.round(e.r / e.n), Math.round(e.g / e.n), Math.round(e.b / e.n)] })).sort((a, b) => b.n - a.n);
  if (!bins.length) return null;
  const total = bins.reduce((s, b) => s + b.n, 0);
  const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  let pick = bins[0];
  if (textRgb && dist(pick.c, textRgb) < 36 && bins.length > 1) pick = bins[1];
  return { rgb: pick.c, share: pick.n / total };
}

/* ── 跑 ─────────────────────────────────────────────────────────────────── */
const dir = mkdtempSync(join(tmpdir(), "contrast-"));
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`,
  "--window-size=1280,860", "--force-device-scale-factor=1", "--no-first-run",
  "--no-default-browser-check", "--disable-extensions", "--hide-scrollbars", "about:blank",
], { stdio: "ignore" });

let ws = null;
try {
  let ver = null;
  for (let i = 0; i < 60 && !ver; i++) {
    try { ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch { await sleep(250); }
  }
  if (!ver) throw new Error("headless Chrome 起不来");
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === "page");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const listeners = [];
  await new Promise((res, rej) => {
    ws.addEventListener("open", res);
    ws.addEventListener("error", rej);
  });
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result); }
    else if (msg.method) for (const l of listeners) l(msg);
  });
  const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error("页面异常：" + JSON.stringify(r.exceptionDetails).slice(0, 500));
    return r.result.value;
  };
  await send("Page.enable");
  if (seedArg) {
    const seed = JSON.parse(readFileSync(seedArg.slice("--seed=".length), "utf8"));
    await send("Page.addScriptToEvaluateOnNewDocument", {
      source: `(() => { const s = ${JSON.stringify(seed)}; for (const k of Object.keys(s)) { try { localStorage.setItem(k, s[k]); } catch (e) {} } })();`,
    });
  }
  const loaded = new Promise((res) => { const t = setTimeout(res, 12000); listeners.push((m) => { if (m.method === "Page.loadEventFired") { clearTimeout(t); res(); } }); });
  await send("Page.navigate", { url });
  await loaded;
  await sleep(WAIT_MS);
  if (dark || light) { await evaluate(`document.documentElement.dataset.scheme='${dark ? "dark" : "light"}'`); await sleep(1800); }
  const dom = await evaluate(COLLECT);
  const shot = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
  const png = Buffer.from(shot.data, "base64");
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${tag}.png`), png);
  const img = decodePng(png);

  const rows = [];
  for (const it of dom.items) {
    const tRgb = parse(it.c);
    if (!tRgb) continue;
    const tL = lum(tRgb);
    let worst = null;
    for (let ri = 0; ri < it.r.length; ri++) {
      if (it.o && it.o[ri]) continue;                       // 被上层盖住：不是用户看到的字
      const bg = bgOf(img, it.r[ri], tRgb);
      if (!bg) continue;
      const cr = ratio(tL, lum(bg.rgb));
      if (!worst || cr < worst.cr) worst = { cr, bg: bg.rgb, bL: lum(bg.rgb), share: bg.share, rect: it.r[ri] };
    }
    if (!worst) continue;
    const large = it.fs >= 24 || (it.fs >= 18.66 && Number(it.fw) >= 700);
    rows.push({ ...it, tRgb, ...worst, need: large ? 3 : 4.5, bad: worst.cr < 3, weak: worst.cr < (large ? 3 : 4.5) });
  }
  rows.sort((a, b) => a.cr - b.cr);
  writeFileSync(join(OUT, `${tag}.json`), JSON.stringify({ url, dark, scheme: dom.scheme, glass: dom.glass, rows }, null, 1));

  const bad = rows.filter((r) => r.bad), weak = rows.filter((r) => !r.bad && r.weak);
  console.log(`\n=== ${tag} ${url} scheme=${dom.scheme || "-"} glass=${dom.glass || "-"} 文本块=${rows.length} 截图=${img.width}x${img.height} ===`);
  console.log(`严重(<3:1)=${bad.length}  偏弱(不达 AA)=${weak.length}   产物 ${OUT}/${tag}.png|.json`);
  for (const r of bad) {
    console.log(`  ${r.cr.toFixed(2)}:1  ${r.tL > r.bL ? "浅字压浅底" : "深字压深底"}  字${r.tRgb} 底${r.bg}  ${r.fs}px/${r.fw}  tx=${r.tx ?? "-"} inl=${r.inl ?? "-"}\n      ${r.s}  「${r.t}」`);
  }
  for (const r of weak) console.log(`  · 偏弱 ${r.cr.toFixed(2)}:1 ${r.fs}px ${r.s} 「${r.t}」`);
  process.exitCode = bad.length ? 1 : 0;
} finally {
  try { ws?.close(); } catch { /* 忽略 */ }
  chrome.kill("SIGKILL");
}
