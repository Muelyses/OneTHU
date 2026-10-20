/** Diagnostics only. Never use these sanitized values for an actual request. */
export function networkLogUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "[non-http URL]";
    // OAuth/CAS codes, signed URLs and fragments must not become persistent log data.
    return url.origin + url.pathname;
  } catch { return "[invalid URL]"; }
}

export function networkLogCookieNames(headers: readonly string[]): string {
  return headers.map(line => {
    const separator = line.indexOf("=");
    if (separator <= 0) return "[invalid cookie]";
    const name = line.slice(0, separator).trim();
    return /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) ? name : "[invalid cookie]";
  }).join(",");
}

/** A final guard for structured credentials; full page bodies are omitted at their source. */
export function redactNetworkLog(text: string): string {
  if (/<(?:!doctype|html|body|form|input)\b/i.test(text)) return `[omitted page markup: ${text.length} characters]`;
  return text
    .replace(/https?:\/\/[^\s<>"']+/gi, networkLogUrl)
    .replace(/(\b(?:body(?:\(\d+\))?|schooldata|submittedContent)\s*[:=]\s*)[^\r\n]*/gi, "$1[omitted body]")
    .replace(/(^|[\r\n])([ \t]*(?:authorization|proxy-authorization|cookie|set-cookie)[ \t]*[:=])[^\r\n]*/gi, "$1$2 [redacted]")
    .replace(/(["']?(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|token|ticket|_csrf|authorization|cookie|set-cookie|username|studentId)["']?\s*[:=]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}]+)/gi, "$1[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/=\-]+/gi, "Bearer [redacted]");
}
