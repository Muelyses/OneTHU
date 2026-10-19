/**
 * OneTHU 名片与通讯录（Phase 3 地基）：个人名片 / 组织名片 / 收到的联系人。
 *
 * 口径（计划 §6/§7）：
 * - 个人名片只有：头像、个人网址、社交媒体、手机号、个人简介（简介 ≤120 字，NFC 短传）。
 * - 组织名片 = 组织邀请的具体化形式（名称、简介、加入方式），以后接 GitLab/云盘。
 * - 全部本地持久化；分享/碰一碰是显式动作，手机号默认随名片显式发出（用户自己填的）。
 */
import { getSeafileAccount } from "./seafile.js";
import { getCampusSnapshot } from "./data.js";
import { getCloudCalEmail } from "./cloudCal.js";
import { useSyncExternalStore } from "react";
import type { VaultCatch } from "./vault.js";

/** 名片卡面自定义封面：图片 + 取景（焦点/缩放）+ 自动字色 + 云盘备份。 */
export interface CardCover {
  /** data URL（压缩后的卡面图；给卡片本体与名片口令一起带出去） */
  src: string;
  /** 取景焦点：0..1（图片里对准卡片中心的位置） */
  focusX: number;
  focusY: number;
  /** 缩放 1..2.5 */
  zoom: number;
  /** 根据背景亮度自动选的字色：light = 白字 / dark = 黑字 */
  ink: "light" | "dark";
  /** 存到云盘的位置（备份/多设备；失败时可缺省） */
  cloud?: { repoId: string; path: string; shareUrl?: string };
  updatedAt: number;
}

export interface PersonalCard {
  name: string;
  /** data: URL（≤200KB）或空串 */
  avatar: string;
  /** 自定义卡面（可选）；没有就是默认纸卡 */
  cover?: CardCover;
  website: string;
  social: string;
  phone: string;
  /** 清华云盘邮箱（用于好友共享云盘的双向账号共享；可空） */
  cloudEmail?: string;
  bio: string;
  updatedAt: number;
}

export interface OrgCard {
  id: string;
  name: string;
  brief: string;
  joinUrl: string;
  updatedAt: number;
}

export interface FriendShare {
  repoId: string;
  path: string;
  /** 云盘分享链接（好友加入后双方共享该文件夹） */
  shareUrl?: string;
  shareToken?: string;
  expiresAt?: number;
  createdAt: number;
  /** 已把该文件夹以读写权限共享给好友账号（双向通道前提） */
  sharedWith?: { email: string; permission: string; at: number };
}

export type ContactCard = {
  id: string;
  kind: "personal" | "organization";
  name: string;
  note: string;
  card: PersonalCard | OrgCard;
  addedAt: number;
  /** 与这位好友的共享云盘（创建后写入；以后放文件/作业/口令） */
  shared?: FriendShare;
};

export interface CardDoc {
  v: 1;
  personal: PersonalCard;
  orgs: OrgCard[];
  contacts: ContactCard[];
}

const KEY = "onethu.cards.v1";

export const CARD_LIMITS = { name: 40, website: 200, social: 120, phone: 40, bio: 120, orgName: 60, orgBrief: 200, joinUrl: 300 } as const;
/** 卡面图上限：压缩后 dataURL 长度（约 1.5MB 字符 ≈ 1.1MB 图片） */
const MAX_COVER_CHARS = 1_500_000;

function empty(): CardDoc {
  return {
    v: 1,
    personal: { name: "", avatar: "", website: "", social: "", phone: "", bio: "", updatedAt: Date.now() },
    orgs: [],
    contacts: [],
  };
}

function load(): CardDoc {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const p = JSON.parse(raw) as Partial<CardDoc>;
    if (p?.v !== 1 || !p.personal) return empty();
    return {
      v: 1,
      personal: { ...empty().personal, ...p.personal },
      orgs: Array.isArray(p.orgs) ? p.orgs.filter((o): o is OrgCard => !!o && typeof o.id === "string") : [],
      contacts: Array.isArray(p.contacts) ? p.contacts.filter((c): c is ContactCard => !!c && typeof c.id === "string") : [],
    };
  } catch {
    return empty();
  }
}

let doc: CardDoc = load();
const listeners = new Set<() => void>();
function commit(): void {
  try { localStorage.setItem(KEY, JSON.stringify(doc)); } catch { /* 配额满保持内存态 */ }
  listeners.forEach((f) => f());
}
export function subscribeCards(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}
export function cardsSnapshot(): CardDoc {
  return doc;
}
export function useCards(): CardDoc {
  return useSyncExternalStore(subscribeCards, cardsSnapshot, cardsSnapshot);
}

function clamp(s: string, n: number): string {
  return Array.from(String(s ?? "").trim()).slice(0, n).join("");
}

/**
 * 本人清华云盘邮箱：应用已经能自动拿到，不该再让用户手填。
 * 顺序：名片里已保存的 → 云盘账号（seafile_account.email）→ 校园数据里的 info 邮箱 → 已配置的 CalDAV 邮箱。
 */
export function resolveCloudEmail(): string {
  const saved = (doc.personal.cloudEmail ?? "").trim();
  if (saved) return saved;
  const seafile = getSeafileAccount()?.email?.trim();
  if (seafile) return seafile;
  const campus = getCampusSnapshot()?.user?.email?.trim();
  if (campus) return campus;
  const cal = (getCloudCalEmail() ?? "").trim();
  return cal;
}

function normalizeCover(raw: CardCover | null | undefined): CardCover | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const src = typeof raw.src === "string" ? raw.src.trim() : "";
  if (!src.startsWith("data:image/") || src.length > MAX_COVER_CHARS) return undefined;
  const clamp01 = (v: unknown, fallback: number): number => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
  };
  const zoom = Number(raw.zoom);
  return {
    src,
    focusX: clamp01(raw.focusX, 0.5),
    focusY: clamp01(raw.focusY, 0.5),
    zoom: Number.isFinite(zoom) ? Math.min(2.5, Math.max(1, zoom)) : 1,
    ink: raw.ink === "dark" ? "dark" : "light",
    ...(raw.cloud && typeof raw.cloud.repoId === "string" && raw.cloud.repoId
      ? { cloud: { repoId: raw.cloud.repoId, path: String(raw.cloud.path ?? ""), ...(raw.cloud.shareUrl ? { shareUrl: raw.cloud.shareUrl } : {}) } }
      : {}),
    updatedAt: Number(raw.updatedAt) || Date.now(),
  };
}

export function savePersonalCard(patch: Omit<Partial<PersonalCard>, "cover"> & { cover?: CardCover | null }): PersonalCard {
  const cur = doc.personal;
  const cover = patch.cover === undefined ? cur.cover : normalizeCover(patch.cover);
  const next: PersonalCard = {
    name: clamp(patch.name ?? cur.name, CARD_LIMITS.name),
    avatar: patch.avatar !== undefined ? String(patch.avatar ?? "") : cur.avatar,
    website: clamp(patch.website ?? cur.website, CARD_LIMITS.website),
    social: clamp(patch.social ?? cur.social, CARD_LIMITS.social),
    phone: clamp(patch.phone ?? cur.phone, CARD_LIMITS.phone),
    cloudEmail: clamp(patch.cloudEmail ?? cur.cloudEmail ?? "", 120).trim(),
    bio: clamp(patch.bio ?? cur.bio, CARD_LIMITS.bio),
    ...(cover ? { cover } : {}),
    updatedAt: Date.now(),
  };
  doc = { ...doc, personal: next };
  commit();
  return next;
}

export function upsertOrgCard(input: { id?: string; name: string; brief?: string; joinUrl?: string }): OrgCard {
  const id = input.id ?? "org." + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const next: OrgCard = {
    id,
    name: clamp(input.name, CARD_LIMITS.orgName) || "未命名组织",
    brief: clamp(input.brief ?? "", CARD_LIMITS.orgBrief),
    joinUrl: clamp(input.joinUrl ?? "", CARD_LIMITS.joinUrl),
    updatedAt: Date.now(),
  };
  const exists = doc.orgs.some((o) => o.id === id);
  doc = { ...doc, orgs: exists ? doc.orgs.map((o) => (o.id === id ? next : o)) : [...doc.orgs, next] };
  commit();
  return next;
}

export function removeOrgCard(id: string): void {
  doc = { ...doc, orgs: doc.orgs.filter((o) => o.id !== id) };
  commit();
}

/** 收到名片（以后来自口令/碰一碰/文件导入）；同名同号不重复。 */
export function addContact(kind: ContactCard["kind"], card: PersonalCard | OrgCard, note = ""): { ok: boolean; reason?: "duplicate" | "self" } {
  if (kind === "personal") {
    const p = card as PersonalCard;
    if (p.name && p.name === doc.personal.name && p.phone && p.phone === doc.personal.phone) return { ok: false, reason: "self" };
  }
  const dup = doc.contacts.some((c) => c.kind === kind && c.name === card.name && (kind === "personal" ? (card as PersonalCard).phone === (c.card as PersonalCard).phone : (card as OrgCard).id === (c.card as OrgCard).id));
  if (dup) return { ok: false, reason: "duplicate" };
  const c: ContactCard = { id: "ct." + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), kind, name: card.name, note: clamp(note, 120), card, addedAt: Date.now() };
  doc = { ...doc, contacts: [c, ...doc.contacts] };
  commit();
  return { ok: true };
}

export function removeContact(id: string): void {
  doc = { ...doc, contacts: doc.contacts.filter((c) => c.id !== id) };
  commit();
}

export function setContactShare(id: string, shared: FriendShare): void {
  doc = { ...doc, contacts: doc.contacts.map((c) => (c.id === id ? { ...c, shared } : c)) };
  commit();
}

/** 名片进暂存箱的 catch（payload 型；分享口令/碰一碰共用）。 */
export function personalCardCatch(): VaultCatch {
  return { type: "payload", title: `名片 · ${doc.personal.name || "我"}`, sub: doc.personal.bio || "我的 OneTHU 名片", payload: { kind: "namecard", card: doc.personal }, source: "我的名片" };
}

export function orgCardCatch(org: OrgCard): VaultCatch {
  return { type: "payload", title: `组织名片 · ${org.name}`, sub: org.brief || "组织邀请", payload: { kind: "namecard", card: org, org: true }, source: "组织名片" };
}
