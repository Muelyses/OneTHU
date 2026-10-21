/** Computed CSS colors: sRGB mixes serialize as color(srgb …), instead of legacy functional notation. */
export function renderedColor(raw: string): {rgb: [number, number, number]; a: number} | null {
  const s = raw.trim().toLowerCase();
  if (s === 'transparent') return {rgb: [0, 0, 0], a: 0};
  if (/^#[\da-f]{3,8}$/.test(s)) {
    const hex = s.slice(1); const full = hex.length <= 4 ? [...hex].map(c => c + c).join('') : hex;
    if (full.length !== 6 && full.length !== 8) return null;
    return {rgb: [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16)) as [number, number, number], a: full.length === 8 ? parseInt(full.slice(6), 16) / 255 : 1};
  }
  const srgb = /^color\(srgb\s+(.+)\)$/.exec(s);
  const rgb = /^rgba?\((.+)\)$/.exec(s);
  const body = srgb?.[1] ?? rgb?.[1];
  if (!body) return null;
  const parts = body.split(/[,\s/]+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 4) return null;
  const values = parts.map((p, i) => {
    const n = Number.parseFloat(p);
    return p.endsWith('%') ? n / 100 * (i < 3 ? 255 : 1) : n * (srgb && i < 3 ? 255 : 1);
  });
  if (values.some(n => !Number.isFinite(n))) return null;
  return {rgb: values.slice(0, 3).map(n => Math.max(0, Math.min(255, n))) as [number, number, number], a: Math.max(0, Math.min(1, values[3] ?? 1))};
}
