import DOMPurify from "dompurify";

/** Treat remote documents and generated widgets as static content, never app code. */
export function sanitizeDisplayHtml(html: string): string {
  if (typeof html !== "string" || !html) return "";
  if (!DOMPurify.isSupported || typeof DOMPurify.sanitize !== "function") return escapeHtml(html);
  try {
    return DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true },
      // Embedded documents and form submission have no place in an inline preview.
      FORBID_TAGS: ["style", "iframe", "object", "embed", "link", "meta", "base", "form", "input", "button", "select", "textarea", "option"],
      ALLOW_DATA_ATTR: false,
      RETURN_TRUSTED_TYPE: false,
    });
  } catch {
    // A parser/runtime failure must never return active original markup.
    return escapeHtml(html);
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
