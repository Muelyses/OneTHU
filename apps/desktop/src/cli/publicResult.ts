/** Runtime projection: TS return types do not remove extra server JSON fields. */
const secretKey = /token|password|passwd|secret|credential|cookie|authorization|private.?key|api.?key|^(?:sessionid|session_id|__VIEWSTATE.*|__EVENTVALIDATION|hiddenFields|formFields)$/i;
const secretQuery = /^(?:_?csrf|xsrf|ticket|token|access_token|refresh_token|session|jsessionid|wengine_vpn_ticket)$/i;

function cleanUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (!['https:', 'http:'].includes(url.protocol)) return raw;
    if (!url.username && !url.password && ![...url.searchParams.keys()].some(key => secretQuery.test(key)) && !/;jsessionid=/i.test(url.pathname)) return raw;
    url.username = ''; url.password = '';
    for (const key of [...url.searchParams.keys()]) if (secretQuery.test(key)) url.searchParams.delete(key);
    url.pathname = url.pathname.replace(/;jsessionid=[^/;]*/ig, '');
    return url.toString();
  } catch { return raw; }
}
/** Remote failures can contain login URLs or a full authentication page. */
export function publicError(error: unknown): Error {
  const raw = error instanceof Error ? error.message : String(error);
  const cleaned = /<\/?(?:html|body|script|form)\b/i.test(raw)
    ? "SERVICE_RESPONSE_UNAVAILABLE: The service returned a web page instead of the expected response. Check its session in OneTHU."
    : String(publicResult(raw)).slice(0, 2000)
      .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
      .replace(/((?:["']?(?:[\w-]*(?:token|ticket|password|passwd|cookie|secret|credential|api[_-]?key)[\w-]*)["']?)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1[redacted]");
  const fields = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const code = typeof fields.code === "string" && /^[A-Z][A-Z0-9_]{2,63}$/.test(fields.code) ? fields.code : "";
  const context = ["kind", "stage"].flatMap(key => {
    const value = fields[key];
    return typeof value === "string" && /^[a-zA-Z0-9_.-]{1,80}$/.test(value) ? [`${key}=${value}`] : [];
  });
  const message = code && !cleaned.startsWith(code) ? `${code}: ${cleaned}` : cleaned;
  return new Error(context.length ? `${message} (${context.join(", ")})` : message);
}
export function publicResult(value: unknown, depth = 0): unknown {
  if (depth > 64) throw new Error("RESULT_TOO_DEEP");
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  if (typeof value === 'string') {
    if (/^https?:\/\/[^\s<>"']+$/.test(value)) return cleanUrl(value);
    return value.replace(/https?:\/\/[^\s<>"']+/g, match => cleanUrl(match));
  }
  if (Array.isArray(value)) return value.map(item => publicResult(item, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !secretKey.test(key) && !['__proto__', 'prototype', 'constructor'].includes(key))
    .map(([key, data]) => [key, publicResult(data, depth + 1)]));
  return value;
}
