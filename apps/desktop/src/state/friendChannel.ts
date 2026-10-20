import { t as i18n } from "../i18n/index.js";
/**
 * 好友通道（Phase 3.2 地基）：给已建共享云盘的联系人留言/传文件。
 * 通道内容先落本地消息账本；有共享云盘时同时把文字/文件写进共享文件夹，
 * 对方通过共享链接能看到；真正的双向写入需要云盘账号级共享（API 待补）。
 */
import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getSeafileToken, ensureSeafileLoaded, seafileShareFolderToUser } from "./seafile.js";
import { cardsSnapshot, setContactShare } from "./nameCard.js";
import { bytesToBase64 } from "../lib/imageSave.js";

export interface FriendMessage {
  id: string;
  contactId: string;
  mine: boolean;
  kind: "text" | "file";
  text: string;
  /** 云盘内相对/绝对路径（有共享云盘时） */
  cloudPath?: string;
  at: number;
}

interface ChannelDoc { v: 1; messages: FriendMessage[] }
const KEY = "onethu.friendMsgs.v1";

function load(): ChannelDoc {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { v: 1, messages: [] };
    const p = JSON.parse(raw) as Partial<ChannelDoc>;
    if (p?.v !== 1 || !Array.isArray(p.messages)) return { v: 1, messages: [] };
    return { v: 1, messages: p.messages.filter((m): m is FriendMessage => !!m && typeof m.id === "string") };
  } catch { return { v: 1, messages: [] }; }
}
let doc: ChannelDoc = load();
const listeners = new Set<() => void>();
function commit(): void {
  try { localStorage.setItem(KEY, JSON.stringify(doc)); } catch { /* 配额满 */ }
  listeners.forEach((f) => f());
}
export function subscribeFriendChannel(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}
export function friendChannelSnapshot(): ChannelDoc {
  return doc;
}
export function useFriendMessages(contactId: string): FriendMessage[] {
  const snap = useSyncExternalStore(subscribeFriendChannel, friendChannelSnapshot, friendChannelSnapshot);
  return snap.messages.filter((m) => m.contactId === contactId).slice().sort((a, b) => a.at - b.at);
}

function newId(): string {
  return "fm." + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

function record(m: Omit<FriendMessage, "id" | "at">): FriendMessage {
  const full: FriendMessage = { ...m, id: newId(), at: Date.now() };
  doc = { v: 1, messages: [...doc.messages, full] };
  commit();
  return full;
}

async function uploadText(path: string, name: string, text: string): Promise<void> {
  await ensureSeafileLoaded();
  const token = getSeafileToken();
  if (!token) throw new Error(i18n("state.friendchannel.a6e7bedde538"));
  const contact = cardsSnapshot().contacts.find((c) => c.id === path);
  const shared = contact?.shared;
  if (!contact || !shared) throw new Error(i18n("state.friendchannel.b0267114fbda"));
  await invoke("seafile_mkdir", { token, repoId: shared.repoId, path: `${shared.path}/messages` });
  const b64 = bytesToBase64(new TextEncoder().encode(text));
  const local = await invoke<string>("write_temp_file", { name, dataBase64: b64 });
  await invoke("seafile_upload", { token, repoId: shared.repoId, parentDir: `${shared.path}/messages`, localPath: local, replace: true });
}

async function ensureShared(contactId: string): Promise<{ repoId: string; path: string }> {
  await ensureSeafileLoaded();
  if (!getSeafileToken()) throw new Error(i18n("state.friendchannel.0507dadfda6a"));
  const contact = cardsSnapshot().contacts.find((c) => c.id === contactId);
  if (!contact?.shared) throw new Error(i18n("state.friendchannel.b0267114fbda"));
  return { repoId: contact.shared.repoId, path: contact.shared.path };
}

/**
 * 把共享文件夹以读写权限共享给联系人的云盘邮箱（双向通道前提）。
 * 需要对方名片里填了 cloudEmail；成功后记录 sharedWith，好友可从自己的「共享给我的」库直接写文件。
 */
export async function openBidirectionalShare(contactId: string): Promise<{ ok: boolean; reason?: string }> {
  try {
    await ensureSeafileLoaded();
    if (!getSeafileToken()) throw new Error(i18n("state.friendchannel.a6e7bedde538"));
    const contact = cardsSnapshot().contacts.find((c) => c.id === contactId);
    if (!contact?.shared) throw new Error(i18n("state.friendchannel.c9a7838f815d"));
    const email = ((contact.card as { cloudEmail?: string }).cloudEmail ?? "").trim();
    if (!email || !email.includes("@")) throw new Error(i18n("state.friendchannel.6c6de71e6e09"));
    if (contact.shared.sharedWith?.email === email) return { ok: true };
    await seafileShareFolderToUser(contact.shared.repoId, contact.shared.path, email, "rw");
    setContactShare(contactId, { ...contact.shared, sharedWith: { email, permission: "rw", at: Date.now() } });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** 留言：本地记账；有共享云盘时同步写一份 txt，对方通过共享链接可读。 */
export async function sendFriendText(contactId: string, text: string): Promise<{ ok: boolean; reason?: string }> {
  const t = String(text ?? "").trim().slice(0, 2000);
  if (!t) return { ok: false, reason: i18n("state.friendchannel.596d6dbf6630") };
  let cloudPath: string | undefined;
  try {
    const shared = await ensureShared(contactId);
    const name = `msg-${Date.now()}.txt`;
    await uploadText(contactId, name, t);
    cloudPath = `${shared.path}/messages/${name}`;
  } catch (e) {
    /* 没云盘/网络失败：仍留本地留言，并如实告知 */
    record({ contactId, mine: true, kind: "text", text: t });
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
  record({ contactId, mine: true, kind: "text", text: t, cloudPath });
  return { ok: true };
}

/** 传文件：文件由调用方先 stage 到本地临时路径；写入共享云盘 messages/。 */
export async function sendFriendFile(contactId: string, staged: { name: string; localPath: string; size?: number }): Promise<{ ok: boolean; reason?: string; cloudPath?: string }> {
  try {
    const shared = await ensureShared(contactId);
    if (!staged.localPath) throw new Error(i18n("state.friendchannel.e6e1b1bf2d70"));
    await invoke("seafile_mkdir", { token: getSeafileToken(), repoId: shared.repoId, path: `${shared.path}/messages` });
    const safe = staged.name.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 120);
    await invoke("seafile_upload", { token: getSeafileToken(), repoId: shared.repoId, parentDir: `${shared.path}/messages`, localPath: staged.localPath, replace: true });
    const cloudPath = `${shared.path}/messages/${safe}`;
    record({ contactId, mine: true, kind: "file", text: staged.name, cloudPath });
    return { ok: true, cloudPath };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
