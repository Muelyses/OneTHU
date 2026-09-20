/**
 * 「小组件显示什么」的解析：把配置（收藏夹 / 收藏原子）解析成原生可画的内容。
 *
 * 纯函数 + 依赖注入：收藏夹数据与原子元数据都从参数进来，因此可以脱离应用状态直测
 * （这类「用户挑了个东西，我们把它变成几行字」的逻辑最容易在边角上出错——
 *  删掉的原子、空收藏夹、子收藏夹条目）。
 */
import type { WidgetSettings } from "./widgetSettings.js";

/** 与 widgetSnapshot 的 WidgetRow 同形（此处重复声明以避免循环依赖） */
export interface SourceRow {
  text: string;
  sub?: string;
}

export interface ResolvedSource {
  title: string;
  rows: SourceRow[];
  footer: string;
  /** 点击落点（页面 + 参数） */
  target: string;
  params?: Record<string, unknown>;
}

export interface WidgetSourceDeps {
  /** 收藏夹表：id → { title, items } */
  folders: Record<string, { title: string; items: Array<{ t: "a"; atom: { kind: string; key: string } } | { t: "f"; id: string }> }>;
  /** 原子元数据解析（宿主原子注册表 / 插件原子注册表）；target 为原子自身落点 */
  resolveAtom: (ref: { kind: string; key: string }) => {
    title: string;
    sub?: string;
    target?: { page: string; params?: Record<string, unknown> };
  } | null;
  /** 最多几行（原生按尺寸决定，这里先按最大 3 行算，脚注负责交代截断） */
  maxRows?: number;
}

function clip(s: string, n: number): string {
  const t = String(s ?? "").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

/** 收藏夹内的原子行（子收藏夹单独成行并提示「收藏夹」） */
function rowsOfFolder(folderId: string, deps: WidgetSourceDeps, skip = 0): { rows: SourceRow[]; total: number } {
  const folder = deps.folders[folderId];
  if (!folder) return { rows: [], total: 0 };
  const rows: SourceRow[] = [];
  let total = 0;
  for (const item of folder.items) {
    if (item.t === "f") {
      const sub = deps.folders[item.id];
      if (!sub) continue;                       // 悬空引用（理论上不该有）：跳过而不是显示空白
      total += 1;
      rows.push({ text: clip(sub.title, 16), sub: "收藏夹" });
      continue;
    }
    const meta = deps.resolveAtom(item.atom);
    if (!meta) continue;                        // 原子已失效：跳过（与收藏夹页的降级一致）
    total += 1;
    rows.push({ text: clip(meta.title, 16), sub: meta.sub ? clip(meta.sub, 18) : undefined });
  }
  const max = Math.max(1, deps.maxRows ?? 3);
  const sliced = skip > 0 ? rows.slice(skip, skip + max) : rows.slice(0, max);
  return { rows: sliced, total };
}

/**
 * 解析配置为小组件内容；返回 null 表示「配置不可用」（收藏夹被删、原子失效等）——
 * 调用方据此回落到默认的今日视图，而不是推一张空白卡片。
 */
export function resolveWidgetSource(settings: WidgetSettings, deps: WidgetSourceDeps): ResolvedSource | null {
  const src = settings.source;
  const max = Math.max(1, deps.maxRows ?? 3);

  if (src.kind === "folder") {
    const folderId = String(src.folderId ?? "");
    const folder = deps.folders[folderId];
    if (!folder) return null;
    const { rows, total } = rowsOfFolder(folderId, deps);
    const more = total - rows.length;
    return {
      title: clip(folder.title, 18),
      rows,
      footer: total === 0 ? "收藏夹是空的" : `${total} 项${more > 0 ? ` · 还有 ${more} 项` : ""}`,
      target: "folder",
      params: { folderId },
    };
  }

  if (src.kind === "atom") {
    const atom = src.atom;
    if (!atom?.key) return null;
    const meta = deps.resolveAtom(atom);
    if (!meta) return null;
    // 单个原子：先显示它自己，再把同一收藏夹里排在它后面的项接上（给上下文，而不是孤零零一行）
    let rest: SourceRow[] = [];
    for (const [fid, folder] of Object.entries(deps.folders)) {
      const idx = folder.items.findIndex((it) => it.t === "a" && it.atom.kind === atom.kind && it.atom.key === atom.key);
      if (idx < 0) continue;
      const { rows } = rowsOfFolder(fid, deps, idx + 1);
      rest = rows.slice(0, max - 1);
      // 点击落点优先是「这个原子本身」——用户既然点名显示它，点开就该到它，
      // 而不是到它所在的收藏夹（收藏夹只是我们借来补上下文的）。
      return {
        title: clip(meta.title, 18),
        rows: [{ text: clip(meta.title, 16), sub: meta.sub ? clip(meta.sub, 18) : undefined }, ...rest],
        footer: `${folder.title}${rest.length ? ` · 另有 ${rest.length} 项` : ""}`,
        target: meta.target?.page ?? "folder",
        params: meta.target ? meta.target.params : { folderId: fid },
      };
    }
    // 原子不在任何收藏夹里（可能是插件刚注册、用户还没收藏）：只显示它本身
    return {
      title: clip(meta.title, 18),
      rows: [{ text: clip(meta.title, 16), sub: meta.sub ? clip(meta.sub, 18) : undefined }],
      footer: "未收藏",
      target: meta.target?.page ?? "folder",
      params: meta.target?.params,
    };
  }

  return null;   // today：走默认快照，不由本模块负责
}
