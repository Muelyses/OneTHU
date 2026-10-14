/**
 * 令牌守卫：应用里用到的 CSS 变量必须都有定义（§3.1 令牌层重写的安全网）。
 *
 * 为什么需要它：令牌层是「全应用隐式契约」——一个变量名写错/漏迁，不会编译报错、
 * 也没有测试失败，只会在某个页面某处变成透明或继承色，靠肉眼发现。
 * 重写令牌层时（Reference→System→Compat 三层）必须先有这个网。
 *
 * 检查两件事：
 * 1. 所有 var(--x) 引用都能在 CSS 里找到定义（含 fallback 的也算，但要单独列出）；
 * 2. Compat 层必须保留全部旧变量名（拓扑：凡是被引用的旧名都得留）。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/* 扫描根（2026-10-15 修）：必须含 packages/gui/src —— OneGUI 换血后
   apps/desktop 的样式大量引用库令牌 `--og-*`，而它们的**定义**在
   packages/gui/src/tokens/*.css + skins/*.css 里。此前漏了库根 → 95 个
   `--og-*` 被判"引用却未定义"，于是**整条 guard 链第一步就红**（红的第一步 = 全链形同虚设）。 */
const ROOTS = ["apps/desktop/src", "packages/ui/src", "packages/gui/src"];
function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(css|tsx|ts)$/.test(p)) out.push(p);
  }
  return out;
}
const files = ROOTS.flatMap((r) => walk(r));

/* CSS 注释不能嵌套：注释里再写 /* 会把外层提前关掉，后面的字变成真 CSS（构建才报错）。
   这个坑真踩过——tokens.css 注释里写示例变量时带了一对注释符，vite 构建直接 Unknown word。 */
const commentNest = [];
function checkCommentNesting(f, t) {
  let inComment = false;
  for (let i = 0; i < t.length - 1; i++) {
    const two = t.slice(i, i + 2);
    if (two === "/*") {
      /* 注释里写**路径通配符**（如 `skins/*.css`、`tools/*.mjs`、`styles/**`）会含 `/*`，
         那不是嵌套 —— 判据：紧邻的字符构成路径形状（前一个字符是路径字符、后一个仍属路径）。
         真嵌套长这样：`/* 说明\n/* 另一段 */`（内层 `/*` 前是空白/换行/中文）→ 仍然照抓。
         2026-10-15：这条假报曾把库根加进扫描后立刻绊住（semantic.css:8 的 `skins/*.css`）。 */
      const prev = t[i - 1] ?? "";
      const next = t[i + 2] ?? "";
      const glob = /[A-Za-z0-9_.\-]/.test(prev) && /[.*\w\-]/.test(next);
      if (inComment && !glob) commentNest.push(f + " 注释嵌套（注释里又出现 /*）");
      inComment = true;
      i++;
    } else if (two === "*/") {
      inComment = false;
      i++;
    }
  }
  if (inComment) commentNest.push(f + " 注释没有闭合（缺 */）");
}

const defined = new Set();
const used = new Map();
/** 运行时注入的自定义属性（TSX 里 style={{ "--i": n }}）——CSS 里查不到定义，但确实存在 */
const runtimeInjected = new Set();
/** 带 fallback 的引用（var(--x, 0)）——没定义也不算错，只是"可选变量" */
const optional = new Set();
/** 先去掉注释（CSS 块注释与 // 行注释）——注释里举例的 var(--x) 不是真引用 */
function stripComments(t) {
  return t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}
for (const f of files) {
  const raw = readFileSync(f, "utf8");
  if (f.endsWith(".css")) checkCommentNesting(f, raw);
  const text = stripComments(raw);
  for (const m of text.matchAll(/(--[a-z0-9-]+)\s*:/g)) defined.add(m[1]);
  for (const m of text.matchAll(/var\((--[a-z0-9-]+)(\s*,[^)]*)?\)/g)) {
    if (!used.has(m[1])) used.set(m[1], new Set());
    used.get(m[1]).add(f);
    if (m[2]) optional.add(m[1]); // 有 fallback：CSS 里没定义也安全
  }
  if (/\.tsx?$/.test(f)) {
    // 两种形态：JS 对象键 style={{ "--i": n }}，以及模板字符串拼的 style="--i:3"（theme.ts 注入主题就是这么干的）
    for (const m of text.matchAll(/["'](--[a-z0-9-]+)["']\s*:/g)) runtimeInjected.add(m[1]);
    for (const m of text.matchAll(/(--[a-z0-9-]+)\s*:/g)) runtimeInjected.add(m[1]);
    /* 第三种：TS **计算键**写法 `style={{ ["--x" as string]: v }}`（gui 的滑条就是这么注入位置的）
       —— 上面两条都要求引号后紧跟冒号，这种被 ` as string]` 挡住 → 2026-10-15 曾把
       --og-c-slider-pos / -pos-a / -pos-b 三个判成"引用却未定义"。 */
    for (const m of text.matchAll(/\[\s*["'](--[a-z0-9-]+)["']\s+as\s+string\s*\]\s*:/g)) runtimeInjected.add(m[1]);
  }
}

const missing = [...used.keys()].filter((v) => !defined.has(v) && !runtimeInjected.has(v) && !optional.has(v)).sort();
const unused = [...defined].filter((v) => !used.has(v)).sort();

/* Reference 层（tonal palette）本来就不该被组件直接引用——它是 System 层的取值来源，
   所以单独归类，不跟「可能忘了用」的令牌混在一起刷屏。 */
const isRef = (v) => v.startsWith("--md-ref-palette-");
const refUnused = unused.filter(isRef);
const otherUnused = unused.filter((v) => !isRef(v));

if (commentNest.length) {
  console.error("  ✗ CSS 注释问题（注释不能嵌套，会让后面的字变成真 CSS）：");
  for (const c of [...new Set(commentNest)]) console.error("    " + c);
  process.exit(1);
}
console.log(
  "令牌守卫：定义 " + defined.size + " 个 / 引用 " + used.size + " 个" +
  " / 运行时注入 " + runtimeInjected.size + " 个 / 可选(带 fallback) " + optional.size + " 个",
);
if (refUnused.length) console.log("  Reference 层预留 " + refUnused.length + " 个 tone（§3.2/§3.3 接入时取用）");
if (otherUnused.length) console.log("  未被引用（仅提示，可能是留白/预留）: " + otherUnused.join(" "));
if (missing.length) {
  console.error("  ✗ 有 " + missing.length + " 个变量被引用却没有定义：");
  for (const v of missing) console.error("    " + v + "  ← " + [...used.get(v)].slice(0, 3).join(", "));
  process.exit(1);
}
console.log("  所有引用均有定义 ✓");
