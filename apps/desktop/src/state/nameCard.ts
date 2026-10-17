/**
 * OneTHU 名片与通讯录（Phase 3 地基）：个人名片 / 组织名片 / 收到的联系人。
 *
 * 口径（计划 §6/§7）：
 * - 个人名片只有：头像、个人网址、社交媒体、手机号、个人简介（简介 ≤120 字，NFC 短传）。
 * - 组织名片 = 组织邀请的具体化形式（名称、简介、加入方式），以后接 GitLab/云盘。
 * - 全部本地持久化；分享/碰一碰是显式动作，手机号默认随名片显式发出（用户自己填的）。
 */
import { useSyncExternalStore } from "react";
import type { VaultCatch } from "./vault.js";

export interface PersonalCard {
  name: string;
  /** data: URL（≤200KB）或空串 */
  avatar: string;
  website: string;
  social: string;
  phone: string;
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

export type ContactCard = { id: string; kind: "personal" | "organization"; name: string; note: string; card: PersonalCard | OrgCard; addedAt: number };

export interface CardDoc {
  v: 1;
  personal: PersonalCard;
  orgs: OrgCard[];
  contacts: ContactCard[];
}

const KEY = "onethu.cards.v1";

export const CARD_LIMITS = { name: 40, website: 200, social: 120, phone: 40, bio: 120, orgName: 60, orgBrief: 200, joinUrl: 300 } as const;

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

export function savePersonalCard(patch: Partial<PersonalCard>): PersonalCard {
  const cur = doc.personal;
  const next: PersonalCard = {
    name: clamp(patch.name ?? cur.name, CARD_LIMITS.name),
    avatar: patch.avatar !== undefined ? String(patch.avatar ?? "") : cur.avatar,
    website: clamp(patch.website ?? cur.website, CARD_LIMITS.website),
    social: clamp(patch.social ?? cur.social, CARD_LIMITS.social),
    phone: clamp(patch.phone ?? cur.phone, CARD_LIMITS.phone),
    bio: clamp(patch.bio ?? cur.bio, CARD_LIMITS.bio),
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

/** 名片进暂存箱的 catch（payload 型；分享口令/碰一碰共用）。 */
export function personalCardCatch(): VaultCatch {
  return { type: "payload", title: `名片 · ${doc.personal.name || "我"}`, sub: doc.personal.bio || "我的 OneTHU 名片", payload: { kind: "namecard", card: doc.personal }, source: "我的名片" };
}

export function orgCardCatch(org: OrgCard): VaultCatch {
  return { type: "payload", title: `组织名片 · ${org.name}`, sub: org.brief || "组织邀请", payload: { kind: "namecard", card: org, org: true }, source: "组织名片" };
}
