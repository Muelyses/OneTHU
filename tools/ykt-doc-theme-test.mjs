/**
 * 雨课堂内联文档的主题配色（回归护栏）：
 * srcdoc iframe 是 opaque origin，继承不到应用主题变量，因此文档配色必须随**运行时
 * 实际生效的主题令牌**注入（R20-B3 fix ②，霖口径：不假设明暗二元——暗色主题不止一个、
 * 浅色也可能是米白等自定义底色）。本文件由上游 1861e4e 的「浅/深两档」护栏改写而来，
 * 保留同等守护点：浅色定稿兼容、暗底配色与行内色兜底、剥行内色注入链路。
 */
import assert from "node:assert/strict";
import {
  DEFAULT_YKT_DOC_THEME,
  buildYktProblemDoc,
  isDarkBgColor,
  sanitizeDocColor,
  yktDocCss,
  YKT_DOC_CSS,
} from "../apps/desktop/src/lib/yktBody.ts";

// ① 缺省 = 历史浅色定稿（兼容旧引用），未传 theme 行为不变
const light = yktDocCss(DEFAULT_YKT_DOC_THEME);
assert.ok(light.includes("color:#222"), "浅色定稿正文应为 #222");
assert.equal(YKT_DOC_CSS, light, "YKT_DOC_CSS 仍是浅色定稿（兼容旧引用）");

// ② 暗底主题：配色来自注入的字面量 + 行内色兜底规则（官方 color:#000 压不过档位）
const darkTheme = {
  text: "#e8eaf0",
  textSoft: "#9aa0aa",
  bg: "#16181d",
  border: "#33363d",
  link: "#7aa2ff",
  fallbackBg: "#22252c",
};
const dark = yktDocCss(darkTheme);
assert.ok(dark.includes(`color:${darkTheme.text}`), "暗底文档正文色来自主题注入");
assert.ok(dark.includes(`background:${darkTheme.bg}`), "暗底文档显式给定底色（transparent 会被 Chromium 刷白）");
assert.ok(dark.includes("color:inherit!important"), "暗底需要行内色兜底规则");
assert.ok(!light.includes("color:inherit!important"), "亮底不改写官方配色");

// ③ isDarkBgColor：按解析出的底色亮度判定（不假设明暗二元）；解析不出 → 保守视为亮
for (const [v, want] of [
  ["#16181d", true],
  ["rgb(22, 24, 29)", true],
  ["#ffffff", false],
  ["rgb(249, 250, 251)", false],
  ["transparent", false],
  ["garbage", false],
]) {
  assert.equal(isDarkBgColor(v), want, `isDarkBgColor(${v}) = ${want}`);
}

// ④ sanitizeDocColor：拼进 <style> 的值必须只是颜色字面量
assert.equal(sanitizeDocColor("var(--x)", "FB"), "FB", "var() 引用不放行");
assert.equal(sanitizeDocColor("red}body{display:none", "FB"), "FB", "注入形态不放行");

// ⑤ 组装链路：theme 进文档；stripColors 注入才剥行内色（保 yktBody 零依赖）
const html = '<p style="color:#000;background:#fff">题干 $x^2$</p>';
const docLight = buildYktProblemDoc({ html });
assert.ok(docLight.includes("color:#222"), "未传 theme → 浅色定稿");
const docDark = buildYktProblemDoc({
  html,
  theme: darkTheme,
  // node 无 DOMParser：用替身剥掉全部 style 属性，验证「传了才走剥色」的接线与效果
  stripColors: (h) => h.replace(/style="[^"]*"/g, ""),
});
assert.ok(docDark.includes(`color:${darkTheme.text}`), "暗底文档用主题配色");
assert.ok(!docDark.includes("color:#000"), "传入 stripColors 后官方行内色被剥掉");
assert.ok(docDark.includes("题干 $x^2$"), "剥色不改正文文本");
assert.ok(
  buildYktProblemDoc({ html, theme: darkTheme }).includes("color:#000"),
  "未传 stripColors 不剥（官方行内色原样保留，不引入依赖）",
);

console.log("结果：雨课堂文档主题配色 ✓（9 组断言）");
