import { ensureContrast, mix, parseColor, toCss } from './color.js';
import type { OGTheme, OGScheme, ThemeRole } from './director.js';

/** Adapt old theme tokens at the boundary. Material/action roles are never theme inputs. */
export function themeFromVars(id: string, vars: Record<string, string>, scheme: OGScheme, fonts?: {ui?: string; mono?: string}): OGTheme {
  const aliases: Partial<Record<ThemeRole, string[]>> = {
    'surface-0': ['--bg', '--md-sys-color-background'],
    'surface-1': ['--surface', '--md-sys-color-surface'],
    'surface-2': ['--surface-2', '--bg-soft', '--md-sys-color-surface-container-low'],
    'surface-3': ['--surface-2', '--md-sys-color-surface-container'],
    'surface-4': ['--surface-3', '--md-sys-color-surface-container-high'],
    'surface-overlay': ['--surface', '--md-sys-color-surface'],
    'content-1': ['--text-1', '--md-sys-color-on-surface'],
    'content-2': ['--text-2', '--md-sys-color-on-surface-variant'],
    'content-3': ['--text-3', '--md-sys-color-on-surface-variant'],
    'line-1': ['--border', '--md-sys-color-outline-variant'],
    'line-2': ['--border-strong', '--border', '--md-sys-color-outline'],
    'line-3': ['--border-strong', '--border', '--md-sys-color-outline'],
    'font-ui': ['--font-ui'], 'font-mono': ['--font-mono'],
    'radius-sm': ['--r-sm'], 'radius-md': ['--r-md'], 'radius-lg': ['--r-lg'], 'radius-xl': ['--r-xl'], 'radius-2xl': ['--r-xl', '--r-lg'],
  };
  const roles: NonNullable<OGTheme['roles']> = {};
  for (const [role, keys] of Object.entries(aliases)) {
    const value = [vars[`--og-${role}`], ...keys.map(k => vars[k])].find(Boolean);
    if (!value || /[;{}]/.test(value) || value.includes('var(--og-')) continue;
    if (/^(surface|content|line)-/.test(role) && !parseColor(value)) continue;
    roles[role as ThemeRole] = value;
  }
  // A partial surface palette still defines a complete, coherent set of levels.
  if (roles['surface-0'] || roles['surface-1'] || roles['surface-2']) {
    const canvas = parseColor(roles['surface-0'] ?? roles['surface-1'] ?? (scheme === 'dark' ? '#202020' : '#f7f7f5'))!;
    const paper = parseColor(roles['surface-1'] ?? '') ?? mix(canvas, {r:255,g:255,b:255,a:1}, scheme === 'dark' ? .03 : .5);
    const ink = {r: scheme === 'dark' ? 255 : 0, g: scheme === 'dark' ? 255 : 0, b: scheme === 'dark' ? 255 : 0, a:1};
    roles['surface-0'] ??= toCss(canvas);
    roles['surface-1'] ??= toCss(paper);
    roles['surface-2'] ??= toCss(mix(paper, ink, .025));
    roles['surface-3'] ??= roles['surface-2'];
    roles['surface-4'] ??= toCss(mix(paper, ink, .07));
    roles['surface-overlay'] ??= roles['surface-1'];
  }
  if (fonts?.ui && !/[;{}]/.test(fonts.ui)) roles['font-ui'] = fonts.ui;
  if (fonts?.mono && !/[;{}]/.test(fonts.mono)) roles['font-mono'] = fonts.mono;
  const base = parseColor(roles['surface-1'] ?? (scheme === 'dark' ? '#292927' : '#ffffff'))!;
  // Partial palettes must not leave unreadable default ink on a custom surface.
  if (roles['surface-1'] || roles['content-1']) {
    for (const role of ['content-1', 'content-2', 'content-3'] as const) {
      const primary = parseColor(roles['content-1'] ?? (scheme === 'dark' ? '#eeeeee' : '#242424'))!;
      const seed = roles[role] ? parseColor(roles[role])! : mix(primary, base, role === 'content-2' ? .24 : role === 'content-3' ? .4 : 0);
      roles[role] = toCss(ensureContrast(seed, base, 4.5));
    }
  }
  return {id, scheme, roles, accent: vars['--og-accent'] ?? vars['--accent'] ?? vars['--md-sys-color-secondary'] ?? (scheme === 'dark' ? '#eeeeee' : '#242424')};
}
