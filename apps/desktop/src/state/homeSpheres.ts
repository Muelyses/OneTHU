/**
 * 首页球型功能目录（home spheres）状态层。
 *
 * 需求（霖 2026-10-12）：首页右上角一个圆形功能目录 logo，点开向左下展开 0.10 风格
 * 子菜单小窗——每项是「圆球形 logo + 底下名字」；点圆球打开对应一级页；最边上一个
 * 「更多功能」球，点开弹窗列出全部一级标签页；球可以像手机 UI 一样拖出到白板上，
 * 外置球可拖动摆放，拖动过程显示红色垃圾桶（拖入即删）；小窗左上角「··· 详情」
 * 可在球阵与详细功能目录（分类列表）之间切换。
 *
 * 数据模型刻意保持最小：
 *   - docked：小窗里的球（NAV 注册表 id，顺序即展示顺序）；
 *   - loose：拖出到白板上的球（同 id 空间），pos 为相对首页内容区的百分比坐标；
 *   - 其余 NAV 一级页 = 未停靠（只出现在「更多功能」弹窗里）。
 * 不存 icon/label——那两样是 NAV 注册表的事实，这里只存「哪些、什么顺序、在哪」。
 */
import { NAV } from "../components/Layout.js";

/** 一级页条目（Layout 的 NAV 数组元素形状：page + label + icon，纯页面无参数） */
export type SphereNavEntry = (typeof NAV)[number];

export interface SpherePos {
  x: number; // 0..100，相对首页内容区宽度的百分比
  y: number; // 0..100，相对首页内容区高度
}

export interface SpheresDoc {
  v: 1;
  docked: string[]; // NAV id，顺序即小窗展示顺序（不含「更多功能」球——那是常驻功能位）
  loose: Array<{ id: string; pos: SpherePos }>;
}

const KEY = "onethu.home.spheres.v1";

/** 默认停靠：一级目录的前 8 个（今日/待办/课程/日程/寻迹/邮箱/云盘/GitLab），观感即现状首页目录的头部 */
function defaultDoc(): SpheresDoc {
  return {
    v: 1,
    docked: NAV.slice(0, 8).map((n) => sphereIdOf(n)),
    loose: [],
  };
}

/** NAV 行 → 球 id：NAV 一级页都是纯页面（无参数），页 id 即球 id */
export function sphereIdOf(entry: SphereNavEntry): string {
  return entry.page;
}

function sanitize(raw: unknown): SpheresDoc | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<SpheresDoc>;
  if (r.v !== 1 || !Array.isArray(r.docked) || !Array.isArray(r.loose)) return null;
  const known = new Set<string>(NAV.map((n) => n.page as string));
  const loose = r.loose
    .filter((s) => s && typeof s.id === "string" && s.pos && Number.isFinite(s.pos.x) && Number.isFinite(s.pos.y))
    .map((s) => ({ id: s.id, pos: { x: Math.min(96, Math.max(0, s.pos.x)), y: Math.min(96, Math.max(0, s.pos.y)) } }))
    .filter((s) => known.has(s.id));
  return {
    v: 1,
    docked: r.docked.filter((x): x is string => typeof x === "string" && known.has(x)),
    loose,
  };
}

export function loadSpheres(): SpheresDoc {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultDoc();
    return sanitize(JSON.parse(raw)) ?? defaultDoc();
  } catch {
    return defaultDoc();
  }
}

export function saveSpheres(doc: SpheresDoc): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(doc));
  } catch {
    /* 存储满/隐私模式：球目录是纯偏好，失败静默（下次启动回默认） */
  }
}

let doc: SpheresDoc = loadSpheres();
const listeners = new Set<() => void>();

export function spheresSnapshot(): SpheresDoc {
  return doc;
}

export function subscribeSpheres(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

function commit(next: SpheresDoc): void {
  doc = next;
  saveSpheres(doc);
  listeners.forEach((f) => f());
}

/** 停靠一个球（追加到小窗末尾；已在 docked/loose 里则先挪过去） */
export function dockSphere(id: string): void {
  if (doc.docked.includes(id)) return;
  commit({
    ...doc,
    docked: [...doc.docked, id],
    loose: doc.loose.filter((s) => s.id !== id),
  });
}

/** 小窗内重排（拖拽换位）：from/to 都是 docked 下标 */
export function reorderDocked(from: number, to: number): void {
  if (from === to || from < 0 || to < 0 || from >= doc.docked.length || to >= doc.docked.length) return;
  const next = doc.docked.slice();
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return;
  next.splice(to, 0, moved);
  commit({ ...doc, docked: next });
}

/** 把球拖出到白板（从 docked 或未停靠状态进入 loose） */
export function loosenSphere(id: string, pos: SpherePos): void {
  commit({
    ...doc,
    docked: doc.docked.filter((x) => x !== id),
    loose: [...doc.loose.filter((s) => s.id !== id), { id, pos }],
  });
}

/** 外置球挪位 */
export function moveLooseSphere(id: string, pos: SpherePos): void {
  commit({
    ...doc,
    loose: doc.loose.map((s) => (s.id === id ? { ...s, pos } : s)),
  });
}

/** 删除球（从 docked 与 loose 一并移除；可从「更多功能」弹窗重新加回） */
export function removeSphere(id: string): void {
  commit({
    ...doc,
    docked: doc.docked.filter((x) => x !== id),
    loose: doc.loose.filter((s) => s.id !== id),
  });
}

/** 按 id 找 NAV 行（找不到说明注册表变了——渲染层直接过滤掉即可） */
export function sphereEntry(id: string): SphereNavEntry | null {
  return NAV.find((n) => sphereIdOf(n) === id) ?? null;
}

/** 全部一级页（更多功能弹窗的数据源，保持 NAV 顺序） */
export function allSphereEntries(): SphereNavEntry[] {
  return NAV;
}
