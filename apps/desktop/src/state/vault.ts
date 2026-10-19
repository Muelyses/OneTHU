/**
 * OneTHU 暂存箱（Phase 1）：万物皆可收纳的本地清单层。
 *
 * 设计边界（docs/plans/2026-10-18-organization-vault-share.md）：
 * - **只存引用/摘要，不复制大内容**：原子存 `{kind,key}`，文件存云盘引用 + hash，文字片段才存正文。
 * - 云盘是文件与分享的最终存储；本模块不直接发请求（上传/分享在 vaultSync/vaultShare 适配层）。
 * - 暂存箱是「临时工作区」：内容随箱存在；被分享口令收录后才由云盘清单承担长期存储。
 * - 多个箱子；同一时刻有一个 active。全部本地持久化在 `onethu.vaults.v1`。
 */
import type { AtomRef } from "./favorites.js";

export type VaultItemType = "atom" | "text" | "file" | "board-item" | "payload";

/** 拖入暂存箱的识别结果（任何可拖元素最终都归一成这个） */
export interface VaultCatch {
  type: VaultItemType;
  title: string;
  sub?: string;
  atom?: AtomRef;
  text?: string;
  file?: VaultFileRef;
  board?: { boardId: string; itemId: string };
  /** 类型专属数据（主题变量、设置项、邮件/新闻快照等；只放必要字段） */
  payload?: unknown;
  /** 来源提示（首页/搜索/邮件…），用于清单副行 */
  source?: string;
  /** 远端文件来源：拖入后自动下载并缓存到暂存箱（云盘/附件）。 */
  remote?: {
    kind: "seafile" | "learn" | "news";
    repoId?: string;
    path?: string;
    url?: string;
    /** 云端已知大小（可选，缓存完以实际字节为准） */
    size?: number;
  };
}

export interface VaultFileRef {
  name: string;
  size?: number;
  mime?: string;
  /** 内容 SHA-256（去重键）；未算完为 undefined */
  hash?: string;
  /** 云盘内路径（Seafile repo path）；null = 还没上传/只在本机 */
  cloudPath?: string | null;
  /** 云盘分享链接（可选提示） */
  shareUrl?: string;
  /** 本地暂存路径（仅本机；分享清单会剔除） */
  stagedPath?: string;
}

export interface VaultItem extends VaultCatch {
  id: string;
  addedAt: number;
}

export interface VaultBox {
  id: string;
  name: string;
  items: VaultItem[];
  createdAt: number;
  updatedAt: number;
  /** 最近一次生成的口令（仅提示，可重新生成） */
  lastShareCode?: string;
}

export interface VaultDoc {
  v: 1;
  boxes: VaultBox[];
  activeId: string;
}

const KEY = "onethu.vaults.v1";

export const VAULT_TYPE_LABEL: Record<VaultItemType, string> = {
  atom: "应用对象",
  text: "文字",
  file: "文件",
  "board-item": "白板组件",
  payload: "数据",
};

function newId(prefix: string): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function emptyBox(name = "我的暂存箱"): VaultBox {
  const now = Date.now();
  return { id: newId("vb."), name, items: [], createdAt: now, updatedAt: now };
}

function load(): VaultDoc {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) throw new Error("empty");
    const p = JSON.parse(raw) as Partial<VaultDoc>;
    if (p.v !== 1 || !Array.isArray(p.boxes) || p.boxes.length === 0) throw new Error("bad");
    const boxes = p.boxes.filter((b): b is VaultBox => !!b && typeof b.id === "string" && Array.isArray(b.items));
    if (boxes.length === 0) throw new Error("bad");
    const activeId = boxes.some((b) => b.id === p.activeId) ? String(p.activeId) : boxes[0]!.id;
    return { v: 1, boxes, activeId };
  } catch {
    const box = emptyBox();
    return { v: 1, boxes: [box], activeId: box.id };
  }
}

let doc: VaultDoc = load();
const listeners = new Set<() => void>();

function commit(): void {
  doc = { ...doc, boxes: doc.boxes.map((b) => ({ ...b })) };
  try {
    localStorage.setItem(KEY, JSON.stringify(doc));
  } catch {
    /* 配额满：保持内存态可用 */
  }
  listeners.forEach((f) => f());
}

export function subscribeVault(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

export function vaultSnapshot(): VaultDoc {
  return doc;
}

export function activeVault(): VaultBox {
  return doc.boxes.find((b) => b.id === doc.activeId) ?? doc.boxes[0]!;
}

export function setActiveVault(id: string): void {
  if (!doc.boxes.some((b) => b.id === id) || doc.activeId === id) return;
  doc = { ...doc, activeId: id };
  commit();
}

export function createVault(name = "新暂存箱"): VaultBox {
  const box = emptyBox(name.trim() || "新暂存箱");
  doc = { ...doc, boxes: [...doc.boxes, box], activeId: box.id };
  commit();
  return box;
}

export function renameVault(id: string, name: string): void {
  const next = name.trim();
  if (!next) return;
  doc = { ...doc, boxes: doc.boxes.map((b) => (b.id === id ? { ...b, name: next, updatedAt: Date.now(), lastShareCode: undefined } : b)) };
  commit();
}

/** 删除箱子；至少保留一个（最后一个是 active 时重建一个空箱）。 */
export function deleteVault(id: string): void {
  const rest = doc.boxes.filter((b) => b.id !== id);
  if (rest.length === doc.boxes.length) return;
  if (rest.length === 0) {
    const box = emptyBox();
    doc = { v: 1, boxes: [box], activeId: box.id };
  } else {
    doc = { ...doc, boxes: rest, activeId: rest.some((b) => b.id === doc.activeId) ? doc.activeId : rest[0]!.id };
  }
  commit();
}

export function itemFromCatch(c: VaultCatch): VaultItem {
  return { ...c, id: newId("vi."), addedAt: Date.now() };
}

/** 同一 atom / 同一文件（hash）在同一箱内不重复；返回 duplicate 原因供调用方提示。 */
export function isDuplicate(box: VaultBox, c: VaultCatch): boolean {
  if (c.atom) return box.items.some((it) => it.atom && it.atom.kind === c.atom!.kind && it.atom.key === c.atom!.key);
  if (c.file?.hash) return box.items.some((it) => it.file?.hash && it.file.hash === c.file!.hash);
  if (c.text) return box.items.some((it) => it.type === "text" && it.text === c.text);
  return false;
}

export function addToVault(c: VaultCatch, boxId?: string): { ok: boolean; reason?: "duplicate" | "no-box"; item?: VaultItem } {
  const box = boxId ? doc.boxes.find((b) => b.id === boxId) : activeVault();
  if (!box) return { ok: false, reason: "no-box" };
  if (isDuplicate(box, c)) return { ok: false, reason: "duplicate" };
  const item = itemFromCatch(c);
  doc = {
    ...doc,
    boxes: doc.boxes.map((b) => (b.id === box.id ? { ...b, items: [item, ...b.items], updatedAt: Date.now(), lastShareCode: undefined } : b)),
  };
  commit();
  return { ok: true, item };
}

/** 更新箱内某条目（用于远端文件缓存完成后补 hash/stagedPath/cloudPath）。 */
export function updateVaultItem(itemId: string, patch: Partial<VaultItem>): void {
  let hit = false;
  doc = {
    ...doc,
    boxes: doc.boxes.map((b) => {
      if (!b.items.some((x) => x.id === itemId)) return b;
      hit = true;
      return { ...b, items: b.items.map((x) => (x.id === itemId ? { ...x, ...patch } : x)), updatedAt: Date.now() };
    }),
  };
  if (hit) commit();
}

export function removeFromVault(boxId: string, itemId: string): void {
  doc = {
    ...doc,
    boxes: doc.boxes.map((b) => (b.id === boxId ? { ...b, items: b.items.filter((x) => x.id !== itemId), updatedAt: Date.now(), lastShareCode: undefined } : b)),
  };
  commit();
}

export function clearVault(boxId: string): void {
  doc = {
    ...doc,
    boxes: doc.boxes.map((b) => (b.id === boxId ? { ...b, items: [], updatedAt: Date.now(), lastShareCode: undefined } : b)),
  };
  commit();
}

/** 整箱替换（口令导入为当前暂存箱；未收录内容即时消失，符合临时工作区语义）。 */
export function replaceVaultItems(boxId: string, catches: VaultCatch[]): void {
  const items = catches.map(itemFromCatch);
  doc = {
    ...doc,
    boxes: doc.boxes.map((b) => (b.id === boxId ? { ...b, items, updatedAt: Date.now(), lastShareCode: undefined } : b)),
  };
  commit();
}

export function markVaultShared(boxId: string, code: string): void {
  doc = {
    ...doc,
    boxes: doc.boxes.map((b) => (b.id === boxId ? { ...b, lastShareCode: code } : b)),
  };
  commit();
}

/** 文件去重索引：同一 hash 在全部箱子里出现一次（文件本体在云盘只存一份）。 */
export function fileHashIndex(): Map<string, VaultFileRef[]> {
  const out = new Map<string, VaultFileRef[]>();
  for (const b of doc.boxes) {
    for (const it of b.items) {
      const f = it.file;
      if (!f?.hash) continue;
      const arr = out.get(f.hash) ?? [];
      arr.push(f);
      out.set(f.hash, arr);
    }
  }
  return out;
}
