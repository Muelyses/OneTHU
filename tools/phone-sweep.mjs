#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════════
 * 竖屏全站巡检：把每个页面都过一遍手机视口，汇总缺陷数并出一张联络表（contact sheet）。
 *
 *   node tools/phone-sweep.mjs [--seed=…] [--wait=4500] [--only=课表,云盘]
 *
 * 产物：/tmp/phone-audit/<页>.png|.json（逐页，来自 phone-audit.mjs）
 *      /tmp/phone-audit/sheet.html（缩略图网格，可直接用浏览器看）
 * 判定与 phone-audit 同一套：横向溢出 / 文字截断 / 文字互压 / 触目标过小 / 跑出视口。
 * ══════════════════════════════════════════════════════════════════════════ */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.split("=")[1] : d; };
const SEED = arg("seed", "/tmp/contrast/seed-full-local.json");
const WAIT = arg("wait", "4500");
const ONLY = arg("only", "");
const OUT = "/tmp/phone-audit";
const APP = "http://127.0.0.1:5180";

/* 页面清单：命名 → URL。页面 id 取自 state/explorer.ts 的 KNOWN_PAGES。 */
const PAGES = [
  ["首页", "?explorer-preview=home"],
  ["其他Info", "?explorer-preview=otherinfo"],
  ["抽屉", "?explorer-preview=drawer"],
  ["设置", "?explorer-preview=settings-tab"],
  ["设置-插件", "?explorer-preview=overlay-plugins"],
  ["搜索", "?explorer-preview=search"],
  ["OneGO", "?explorer-preview=onego"],
  ["课表", "?explorer-preview=page&page=schedule"],
  ["云盘", "?explorer-preview=page&page=cloud"],
  ["任务", "?explorer-preview=page&page=tasks"],
  ["邮箱", "?explorer-preview=page&page=mail"],
  ["网络学堂", "?explorer-preview=page&page=learn"],
  ["信息", "?explorer-preview=page&page=info"],
  ["小搭", "?explorer-preview=page&page=xiaoda"],
  ["THUbook", "?explorer-preview=page&page=thubook"],
  ["服务", "?explorer-preview=page&page=services"],
  ["收藏夹", "?explorer-preview=page&page=favs"],
  ["OnePage", "?explorer-preview=page&page=boards"],
  ["寻迹", "?explorer-preview=page&page=trace"],
  ["预约", "?explorer-preview=page&page=reserve"],
  ["生活", "?explorer-preview=page&page=life"],
  ["选课", "?explorer-preview=page&page=zhjwxk"],
  ["THOS", "?explorer-preview=page&page=thos"],
  ["GitLab", "?explorer-preview=page&page=gitlab"],
];

mkdirSync(OUT, { recursive: true });
const rows = [];
const only = ONLY ? new Set(ONLY.split(",").map((s) => s.trim())) : null;
for (const [name, q] of PAGES) {
  if (only && !only.has(name)) continue;
  const tag = `sweep-${name}`;
  try {
    execFileSync(process.execPath, ["tools/phone-audit.mjs", `${APP}/${q}`, tag, `--seed=${SEED}`, `--wait=${WAIT}`], { stdio: "pipe" });
  } catch {
    /* 有缺陷时 phone-audit 返回 1，属于正常 */
  }
  try {
    const r = JSON.parse(readFileSync(`${OUT}/${tag}.json`, "utf8"));
    const i = r.issues;
    rows.push({
      页: name, 溢出: i.overflowX.length, 截断: i.clippedText.length, 互压: i.textOverlap.length,
      小目标: i.tinyTargets.length, 出框: i.offscreen.length,
      样例: [
        ...i.overflowX.slice(0, 2).map((x) => `溢出 ${x.el}`),
        ...i.clippedText.slice(0, 2).map((x) => `截断 ${x.el} ${x.clientH}<${x.scrollH}`),
        ...i.textOverlap.slice(0, 2).map((x) => `互压${x.ratio}% ${x.a}×${x.b}`),
      ].join(" ; "),
    });
  } catch (e) {
    rows.push({ 页: name, 溢出: -1, 截断: -1, 互压: -1, 小目标: -1, 出框: -1, 样例: "读不到结果：" + String(e).slice(0, 60) });
  }
}
const pad = (s, n) => { const w = [...String(s)].reduce((a, c) => a + (c.charCodeAt(0) > 127 ? 2 : 1), 0); return String(s) + " ".repeat(Math.max(0, n - w)); };
console.log(pad("页", 14) + pad("溢出", 6) + pad("截断", 6) + pad("互压", 6) + pad("小目标", 8) + pad("出框", 6));
for (const r of rows) console.log(pad(r.页, 14) + pad(r.溢出, 6) + pad(r.截断, 6) + pad(r.互压, 6) + pad(r.小目标, 8) + pad(r.出框, 6) + (r.样例 ? "  " + r.样例 : ""));

const sheet = `<!doctype html><meta charset="utf-8"><title>竖屏巡检联络表</title>
<style>body{margin:0;background:#15171c;color:#dfe6f2;font:12px/1.4 -apple-system,"PingFang SC",sans-serif}
h1{font-size:15px;margin:10px 14px}
.grid{display:grid;grid-template-columns:repeat(8,1fr);gap:8px;padding:0 12px 16px}
figure{margin:0;background:#1e222b;border:1px solid #2c313b;border-radius:8px;overflow:hidden}
img{display:block;width:100%;height:auto}
figcaption{padding:4px 6px;font-size:11px;color:#aab4c4}
.bad{color:#ff9c8a}</style>
<h1>OneTHU 竖屏巡检（390×844@3x） ${new Date().toLocaleString("zh-CN")}</h1>
<div class="grid">
${rows.map((r) => `<figure><img src="sweep-${r.页}.png"><figcaption>${r.页}<br><span class="${r.溢出 + r.截断 + r.互压 > 0 ? "bad" : ""}">溢${r.溢出} 截${r.截断} 压${r.互压} 小${r.小目标}</span></figcaption></figure>`).join("\n")}
</div>`;
writeFileSync(`${OUT}/sheet.html`, sheet);
console.log(`\n联络表：${OUT}/sheet.html`);
