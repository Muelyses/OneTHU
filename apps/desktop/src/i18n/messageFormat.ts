import type { MessageParams, MessageValue } from "./types.js";

/** Only named slots are supported. ICU/HTML/Markdown are not interpreted. */
export const MESSAGE_SLOT = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
export type MessageToken = { text: string } | { name: string };

export function messageTokens(template: string): MessageToken[] {
  const out: MessageToken[] = [];
  let cursor = 0;
  for (const match of template.matchAll(MESSAGE_SLOT)) {
    const index = match.index!;
    if (index > cursor) out.push({ text: template.slice(cursor, index) });
    out.push({ name: match[1]! });
    cursor = index + match[0].length;
  }
  if (cursor < template.length) out.push({ text: template.slice(cursor) });
  return out;
}

export function hasMessageValue(params: MessageParams | undefined, key: string): boolean {
  return !!params && Object.hasOwn(params, key) && params[key] !== undefined;
}

export function messageValue(value: MessageValue): string {
  return value === null ? "" : String(value);
}

export function interpolateMessage(
  template: string,
  params: MessageParams | undefined,
  onMissing: (name: string) => void,
): string {
  return messageTokens(template).map(token => {
    if ("text" in token) return token.text;
    if (hasMessageValue(params, token.name)) return messageValue(params![token.name]);
    onMissing(token.name);
    return `{${token.name}}`;
  }).join("");
}
