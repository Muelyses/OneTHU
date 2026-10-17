/**
 * 分享引用账本（Phase 2.3）：记录每条云分享引用了哪些文件（hash + 云盘路径），
 * 用于「过期/撤销后只删无其他引用的文件」。文件本体在云盘只存一份，分享只是引用。
 *
 * 只在本机记录（发起方）；接收方不需要账本。
 */
export interface ShareFileRef {
  hash: string;
  /** 云盘内相对路径（files/xxxx-name） */
  path: string;
}

export interface ShareRef {
  id: string;
  shareUrl: string;
  shareToken: string;
  repoId: string;
  /** 分享的目录或清单路径 */
  path: string;
  manifestName?: string;
  files: ShareFileRef[];
  createdAt: number;
  expiresAt?: number;
  revokedAt?: number;
}

export interface ShareRefDoc {
  v: 1;
  refs: ShareRef[];
}

const KEY = "onethu.shareRefs.v1";

function load(): ShareRefDoc {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { v: 1, refs: [] };
    const p = JSON.parse(raw) as Partial<ShareRefDoc>;
    if (p?.v !== 1 || !Array.isArray(p.refs)) return { v: 1, refs: [] };
    return { v: 1, refs: p.refs.filter((r): r is ShareRef => !!r && typeof r.id === "string" && Array.isArray(r.files)) };
  } catch {
    return { v: 1, refs: [] };
  }
}

let doc: ShareRefDoc = load();
const listeners = new Set<() => void>();
function commit(): void {
  try { localStorage.setItem(KEY, JSON.stringify(doc)); } catch { /* 配额满保持内存态 */ }
  listeners.forEach((f) => f());
}
export function subscribeShareRefs(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}
export function shareRefsSnapshot(): ShareRefDoc {
  return doc;
}

/** 记录一条分享；同 shareUrl 视为同一条（重复生成时更新文件清单）。 */
export function rememberShare(ref: Omit<ShareRef, "id" | "createdAt"> & { id?: string; createdAt?: number }): ShareRef {
  const id = ref.id ?? ("sr." + Date.now().toString(36) + Math.random().toString(36).slice(2, 5));
  const full: ShareRef = {
    ...ref,
    id,
    createdAt: ref.createdAt ?? Date.now(),
    files: ref.files.map((f) => ({ hash: f.hash, path: f.path })),
  };
  const exists = doc.refs.some((r) => r.shareUrl === full.shareUrl);
  doc = { ...doc, refs: exists ? doc.refs.map((r) => (r.shareUrl === full.shareUrl ? { ...full, id: r.id, createdAt: r.createdAt } : r)) : [full, ...doc.refs] };
  commit();
  return full;
}

export function markShareRevoked(id: string, at = Date.now()): void {
  doc = { ...doc, refs: doc.refs.map((r) => (r.id === id ? { ...r, revokedAt: at } : r)) };
  commit();
}

export function activeShareRefs(now = Date.now()): ShareRef[] {
  return doc.refs.filter((r) => !r.revokedAt && (!r.expiresAt || r.expiresAt > now));
}

export function expiredShareRefs(now = Date.now()): ShareRef[] {
  return doc.refs.filter((r) => !r.revokedAt && r.expiresAt !== undefined && r.expiresAt <= now);
}

/** 一条分享里、可以安全删除的文件（其他有效分享都没引用同一路径）。 */
export function unreferencedFilesOf(id: string, now = Date.now()): ShareFileRef[] {
  const target = doc.refs.find((r) => r.id === id);
  if (!target) return [];
  const used = new Set<string>();
  for (const r of activeShareRefs(now)) {
    if (r.id === id) continue;
    for (const f of r.files) used.add(f.path);
  }
  return target.files.filter((f) => !used.has(f.path));
}

/** 全账本里是否还有有效引用（hash 维度；给以后 GC 用）。 */
export function hashReferenced(hash: string, now = Date.now()): boolean {
  return activeShareRefs(now).some((r) => r.files.some((f) => f.hash === hash));
}
