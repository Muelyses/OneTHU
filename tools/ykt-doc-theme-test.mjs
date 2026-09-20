/**
 * 雨课堂内联文档的深浅两档样式（回归护栏）：
 * srcdoc iframe 是 opaque origin，继承不到应用主题变量，因此文档内配色必须自带两档。
 * 此前只有浅色档 → 深色主题下正文保持 #222 黑字（用户实录「雨课堂 LaTeX 区域还是白底黑字」）。
 */
import assert from "node:assert/strict";
import { buildYktProblemDoc, yktDocCss, YKT_DOC_CSS } from "../apps/desktop/src/lib/yktBody.ts";

// ① 两档确实不同，且各取各的正文色
const light = yktDocCss(false);
const dark = yktDocCss(true);
assert.ok(light.includes("color:#222"), "浅色档正文应为 #222");
assert.ok(dark.includes("color:#e8ebf2"), "深色档正文应为 night 主题正文色");
assert.notEqual(light, dark, "两档样式必须不同");
assert.equal(YKT_DOC_CSS, light, "YKT_DOC_CSS 仍是浅色档（兼容旧引用）");

// ② 深色档兜底：行内色压不过档位（否则官方正文的 color:#000 又能翻上来）
assert.ok(dark.includes("color:inherit!important"), "深色档需要行内色兜底规则");
assert.ok(!light.includes("color:inherit!important"), "浅色档不该改写官方配色");

// ③ 组装链路按 dark 取档
const html = '<p style="color:#000;background:#fff">题干 $x^2$</p>';
const docLight = buildYktProblemDoc({ html, dark: false });
const docDark = buildYktProblemDoc({ html, dark: true });
assert.ok(docLight.includes("color:#222"), "浅色文档用浅色档");
assert.ok(docDark.includes("color:#e8ebf2"), "深色文档用深色档");
assert.ok(docDark.includes("题干 $x^2$"), "剥色不应改动正文文本");
// ④ 剥行内色走 DOMParser（仅浏览器/WebView 有）：node 下静默跳过，避免假绿/假红
if (typeof DOMParser === "undefined") {
  console.log("（node 无 DOMParser：跳过「剥掉官方行内色」断言；该路径由 htmlTheme 在 WebView 内负责）");
} else {
  assert.ok(!docDark.includes("color:#000"), "深色文档已剥掉官方写死的行内色");
}

console.log("结果：雨课堂文档深浅两档样式 ✓（6 组断言 + 1 条环境相关）");
