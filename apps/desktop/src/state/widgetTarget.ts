/**
 * 小组件点击落点的编码/解码（纯函数）。
 *
 * 原生只帮我们存一个字符串（SharedPreferences / userInfo），所以落点必须能自描述：
 * 约定 `page` 或 `page?k=v&k2=v2`，与宿主 nav.go(page, params) 一一对应。
 * 之所以不做成 JSON：这个字符串会经由系统通知/小组件回传，越简单越不容易在中间环节被弄坏。
 */
export interface ParsedTarget {
  page: string;
  /** 参数值：布尔已还原为布尔；其余保持字符串（不猜数字——"1" 与 1 在业务上可能是两种东西） */
  params: Record<string, unknown>;
}

export function encodeWidgetTarget(page: string, params?: Record<string, unknown> | null): string {
  const p = String(page ?? "").trim();
  if (!p) return "";
  const entries = Object.entries(params ?? {}).filter(([, v]) => v !== undefined && v !== null && String(v) !== "");
  if (entries.length === 0) return p;
  const q = entries
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  return `${p}?${q}`;
}

export function parseWidgetTarget(raw: string): ParsedTarget | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const [page, query = ""] = s.split("?", 2);
  if (!page) return null;
  const params: Record<string, unknown> = {};
  for (const pair of query.split("&")) {
    if (!pair) continue;
    const [k, v = ""] = pair.split("=", 2);
    if (!k) continue;
    try {
      const val = decodeURIComponent(v);
      // 布尔必须还原：字符串 "false" 在 JS 里是真值，直接透传会把「关」当成「开」
      params[decodeURIComponent(k)] = val === "true" ? true : val === "false" ? false : val;
    } catch {
      /* 坏编码：跳过这一项而不是整个落点失效 */
    }
  }
  return { page, params };
}
