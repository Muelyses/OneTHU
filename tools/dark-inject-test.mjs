/**
 * 内嵌官方页「深色涂白」脚本的回归测试（2026-09-20 用户实录：THUbook 正文深色下仍是黑字）。
 *
 * 直接从 Kotlin 源码里抽出 DARK_INJECT_JS 再跑——保证测的是**真正打进包里的那份脚本**，
 * 而不是副本（上一版就因为 Kotlin 原始字符串里误写双反斜杠导致正则失效）。
 *
 * 为什么不用 WebView 算法暗化：setForceDark 在 targetSdk ≥ 33 被系统忽略（本应用 target 36），
 * 替代 API 需要插件模块没有的 androidx.webkit 依赖。所以走 CSSOM 注入。
 *
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/dark-inject-test.mjs
 */
import fs from "node:fs";
import path from "node:path";

const KT = path.join(
  import.meta.dirname, "..",
  "apps/desktop/src-tauri/plugins/onethu-mobile/android/src/main/java/app/onethu/mobile/OnethuMobilePlugin.kt",
);
const kt = fs.readFileSync(KT, "utf8");
const m = /private const val DARK_INJECT_JS = """([\s\S]*?)"""/.exec(kt);
if (!m) { console.error("✗ 找不到 DARK_INJECT_JS"); process.exit(1); }
const src = m[1];
if (/\\\\[ds(]/.test(src)) { console.error("✗ Kotlin 原始字符串里出现双反斜杠（正则会失效）"); process.exit(1); }

let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) pass++; else { fail++; console.error("✗ " + name); } };

/** 最小 DOM 桩 */
const made = [];
const el = (tag, color, bg) => {
  const s = new Map();
  const e = { tagName: tag, nodeType: 1, _color: color, _bg: bg, _s: s, style: { setProperty: (k, v) => s.set(k, v) }, querySelectorAll: () => made, addEventListener() {} };
  made.push(e);
  return e;
};
const html = el("HTML", "rgb(0,0,0)", "rgba(0, 0, 0, 0)");
const body = el("BODY", "rgb(0,0,0)", "rgba(0, 0, 0, 0)");
const black = el("DIV", "rgb(0, 0, 0)", "rgba(0, 0, 0, 0)");
const gray = el("SPAN", "rgb(90, 90, 90)", "rgba(0, 0, 0, 0)");
const white = el("P", "rgb(255, 255, 255)", "rgba(0, 0, 0, 0)");
const link = el("A", "rgb(0, 0, 238)", "rgba(0, 0, 0, 0)");
const whitish = el("TD", "rgb(0,0,0)", "rgb(255, 255, 255)");
const img = el("IMG", "rgb(0,0,0)", "rgb(255,255,255)");

globalThis.window = globalThis;
globalThis.document = { documentElement: html, body, readyState: "complete", addEventListener() {}, querySelectorAll: () => made };
globalThis.getComputedStyle = (e) => ({ color: e._color, backgroundColor: e._bg });
globalThis.setTimeout = () => 0;
globalThis.MutationObserver = class { observe() {} };

new Function(src)();
const got = (e, k) => e._s.get(k);

t("黑字 → 白字", got(black, "color") === "#E9E9E9");
t("深灰字 → 白字", got(gray, "color") === "#E9E9E9");
t("已是白字不动", got(white, "color") === undefined);
t("深蓝链接 → 高亮蓝", got(link, "color") === "#7AA2F7");
t("白底 → 透明（露出深色底）", got(whitish, "background-color") === "transparent");
t("IMG 等媒体元素不被涂色", got(img, "color") === undefined && got(img, "background-color") === undefined);
t("html/body 底色转深", got(html, "background-color") === "#111315" && got(body, "background-color") === "#111315");

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
