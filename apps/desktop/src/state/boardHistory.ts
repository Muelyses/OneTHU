/** Session-only undo, isolated by board/orientation. External writes invalidate stale history. */
type History = { past: string[]; current: string; mergeKey?: string; at: number };
const histories = new Map<string, History>();
export function recordBoardEdit(key: string, before: string, after: string, automatic = false, mergeKey?: string): void {
  if (before === after) return;
  let history = histories.get(key);
  if (history && history.current !== before) { histories.delete(key); history = undefined; }
  if (!history && automatic) return;
  history ??= { past: [], current: before, at: 0 };
  const now = Date.now();
  if (!automatic) {
    if (!mergeKey || history.mergeKey !== mergeKey || now - history.at > 750) history.past.push(before);
    while (history.past.length > 30 || (history.past.length > 1 && history.past.reduce((n, s) => n + s.length, 0) > 2_000_000)) history.past.shift();
    history.mergeKey = mergeKey; history.at = now;
  }
  history.current = after; histories.set(key, history);
}
export function canUndoBoardEdit(key: string, current: string): boolean {
  const history = histories.get(key);
  return !!history?.past.length && history.current === current;
}
export function takeBoardUndo(key: string, current: string): string | null {
  const history = histories.get(key);
  if (!history || history.current !== current) { histories.delete(key); return null; }
  const previous = history.past.pop();
  if (previous === undefined) return null;
  history.current = previous; history.mergeKey = undefined;
  return previous;
}
