/**
 * 远端 HTML 的主题适配：把「源站写死的颜色」剥掉，让正文继承应用主题令牌。
 *
 * 为什么需要：THUbook（thubook.help）正文是整段 HTML 直接注入渲染的，源站正文里
 * 普遍带行内颜色（`style="color:#000"`、`<font color="#333">`、`bgcolor="#fff"`）。
 * 行内样式优先级高于我们的 `.thubook-body { color: var(--text) }`，于是在**深色主题下
 * 正文仍是黑字**（用户实录 2026-09-20：THUbook 正文黑夜模式还是黑字）。
 *
 * 做法：只摘掉颜色类声明/属性（color / background / background-color / bgcolor /
 *  font 的 color），其余样式（字号、加粗、对齐、宽高）原样保留——不做通用 sanitize，
 * 清洗活性另在 yktBody.sanitizeForInlineDoc 那条链上负责。
 */
export function stripInlineColors(html: string): string {
  if (!html || typeof DOMParser === "undefined") return html;
  const doc = new DOMParser().parseFromString(html, "text/html");

  // 1) style="…" 里的颜色类声明
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>("[style]"))) {
    const style = el.style;
    style.removeProperty("color");
    style.removeProperty("background");
    style.removeProperty("background-color");
    style.removeProperty("background-image");
    const left = style.cssText.trim();
    if (left) el.setAttribute("style", left);
    else el.removeAttribute("style");
  }

  // 2) <font color=…> 之类的呈现属性（HTML 3.2 老写法，thubook 正文里仍有）
  for (const el of Array.from(doc.querySelectorAll("[color],[bgcolor],[text],[link],[vlink]"))) {
    el.removeAttribute("color");
    el.removeAttribute("bgcolor");
    el.removeAttribute("text");
    el.removeAttribute("link");
    el.removeAttribute("vlink");
    if (el.tagName === "FONT" && el.attributes.length === 0) {
      el.replaceWith(...Array.from(el.childNodes)); // 纯颜色 font → 拆掉标签，继承主题色
    }
  }

  return doc.body.innerHTML;
}
