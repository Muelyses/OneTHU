import { t as i18n } from "../i18n/index.js";
/** Shared-folder messages: one immutable manifest per message, read by both peers. */
import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  getSeafileToken, getSeafileAccount, getSeafileCredentialVersion,
  ensureSeafileLoaded, refreshSeafileAccount, useSeafile,
  type SeafileEntry,
} from "./seafile.js";
import { cardsSnapshot, subscribeCards, type PersonalCard } from "./nameCard.js";

export interface FriendMessage {
  id: string;
  contactId: string;
  channelId?: string;
  mine: boolean;
  kind: "text" | "file";
  text: string;
  /** Path in this account's view of the shared folder. */
  cloudPath?: string;
  /** The manifest path is separate from an attachment's download path. */
  manifestPath?: string;
  authorEmail?: string;
  accountEmail?: string;
  at: number;
}

interface ChannelDoc { v: 1; messages: FriendMessage[] }
const KEY = "onethu.friendMsgs.v1";
const MAX_MANIFEST_BYTES = 16 * 1024;

function load(): ChannelDoc {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<ChannelDoc> | null;
    if (p?.v !== 1 || !Array.isArray(p.messages)) return { v: 1, messages: [] };
    return { v: 1, messages: p.messages.filter((m): m is FriendMessage => !!m && typeof m.id === "string" && typeof m.text === "string" && typeof m.contactId === "string") };
  } catch { return { v: 1, messages: [] }; }
}
let doc: ChannelDoc = load();
const listeners = new Set<() => void>();
function commit(): void {
  try { localStorage.setItem(KEY, JSON.stringify(doc)); } catch { /* Storage quota. */ }
  listeners.forEach((f) => f());
}
export function subscribeFriendChannel(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}
export function friendChannelSnapshot(): ChannelDoc { return doc; }
export function useFriendMessages(contactId: string): FriendMessage[] {
  const snap = useSyncExternalStore(subscribeFriendChannel, friendChannelSnapshot, friendChannelSnapshot);
  // Subscribe to account changes as well as messages; a logout must hide private history.
  const { configured, account } = useSeafile();
  const cards = useSyncExternalStore(subscribeCards, cardsSnapshot, cardsSnapshot);
  const channelId = cards.contacts.find((c) => c.id === contactId)?.shared?.channelId;
  const email = normalizeEmail(account?.email ?? "");
  return snap.messages.filter((m) => m.contactId === contactId && m.channelId === channelId && (
    m.accountEmail ? configured && m.accountEmail === email : !configured
  )).slice().sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}
function normalizeEmail(value: string): string { return value.trim().toLowerCase(); }
function newId(): string { return "fm." + crypto.randomUUID(); }
function append(message: FriendMessage): void {
  doc = { v: 1, messages: [...doc.messages, message] };
  commit();
}
function messagesPath(path: string): string { return `${path.replace(/\/+$/, "")}/messages`; }
function currentShare(contactId: string) { return cardsSnapshot().contacts.find((c) => c.id === contactId)?.shared; }
function peerEmail(contactId: string): string {
  const contact = cardsSnapshot().contacts.find((c) => c.id === contactId);
  return normalizeEmail(contact?.shared?.peerEmail ?? (contact?.card as PersonalCard | undefined)?.cloudEmail ?? "");
}

interface Session { token: string; version: number; accountEmail: string }
interface ChannelSession extends Session { contactId: string; repoId: string; path: string; channelId?: string; peerEmail: string }
function sameSession(s: Session): boolean {
  return s.version === getSeafileCredentialVersion() && s.token === getSeafileToken();
}
function sameChannel(s: ChannelSession): boolean {
  const shared = currentShare(s.contactId);
  return sameSession(s) && shared?.repoId === s.repoId && shared.path === s.path && shared.channelId === s.channelId
    && (!shared.accountEmail || normalizeEmail(shared.accountEmail) === s.accountEmail) && peerEmail(s.contactId) === s.peerEmail;
}
function assertChannel(s: ChannelSession): void {
  if (!sameChannel(s)) throw new Error(i18n("state.friendchannel.sessionChanged"));
}
async function session(): Promise<Session> {
  await ensureSeafileLoaded();
  const s: Session = { token: getSeafileToken(), version: getSeafileCredentialVersion(), accountEmail: "" };
  if (!s.token) throw new Error(i18n("state.friendchannel.a6e7bedde538"));
  if (!getSeafileAccount()) await refreshSeafileAccount();
  if (!sameSession(s)) throw new Error(i18n("state.friendchannel.sessionChanged"));
  s.accountEmail = normalizeEmail(getSeafileAccount()?.email ?? "");
  if (!s.accountEmail.includes("@")) throw new Error(i18n("state.friendchannel.identityUnavailable"));
  return s;
}
function channel(s: Session, contactId: string): ChannelSession {
  const shared = currentShare(contactId);
  if (!shared) throw new Error(i18n("state.friendchannel.b0267114fbda"));
  if (shared.accountEmail && normalizeEmail(shared.accountEmail) !== s.accountEmail) throw new Error(i18n("state.friendchannel.sessionChanged"));
  return { ...s, contactId, repoId: shared.repoId, path: shared.path, channelId: shared.channelId, peerEmail: peerEmail(contactId) };
}
async function mkdir(s: ChannelSession, path: string): Promise<void> {
  assertChannel(s);
  await invoke("seafile_mkdir", { token: s.token, repoId: s.repoId, path });
  assertChannel(s);
}
interface WireMessage {
  format: "onethu.friend-message";
  v: 1;
  id: string;
  authorEmail: string;
  at: number;
  kind: "text" | "file";
  text: string;
  /** Relative to messages/, so Seafile's virtual shared-library roots work. */
  attachment?: string;
}
async function uploadManifest(s: ChannelSession, wire: WireMessage): Promise<string> {
  assertChannel(s);
  await invoke("seafile_upload_text", {
    token: s.token, repoId: s.repoId, parentDir: messagesPath(s.path),
    name: `${wire.id}.json`, content: JSON.stringify(wire),
  });
  assertChannel(s);
  return `${messagesPath(s.path)}/${wire.id}.json`;
}
/** Keep older entry points on the same invitation-publication path. */
export async function openBidirectionalShare(contactId: string): Promise<{ ok: boolean; reason?: string }> {
  try {
    const { publishFriendInvitation } = await import("./friendInbox.js");
    await publishFriendInvitation(contactId);
    return { ok: true };
  } catch (e) { return { ok: false, reason: e instanceof Error ? e.message : String(e) }; }
}

/** Failed sends stay local and return ok:false; a superseded account never receives the result. */
export async function sendFriendText(contactId: string, text: string): Promise<{ ok: boolean; reason?: string }> {
  const value = String(text ?? "").trim().slice(0, 2000);
  if (!value) return { ok: false, reason: i18n("state.friendchannel.596d6dbf6630") };
  let scope: Session = { token: getSeafileToken(), version: getSeafileCredentialVersion(), accountEmail: normalizeEmail(getSeafileAccount()?.email ?? "") };
  let active: ChannelSession | undefined;
  const message: FriendMessage = { id: newId(), contactId, channelId: currentShare(contactId)?.channelId, mine: true, kind: "text", text: value, at: Date.now() };
  try {
    scope = await session();
    active = channel(scope, contactId);
    message.channelId = active.channelId;
    await mkdir(active, messagesPath(active.path));
    const manifestPath = await uploadManifest(active, {
      format: "onethu.friend-message", v: 1, id: message.id,
      authorEmail: scope.accountEmail, at: message.at, kind: "text", text: value,
    });
    append({ ...message, authorEmail: scope.accountEmail, accountEmail: scope.accountEmail, cloudPath: manifestPath, manifestPath });
    return { ok: true };
  } catch (e) {
    const boundAccount = currentShare(contactId)?.accountEmail;
    if (sameSession(scope) && (!boundAccount || normalizeEmail(boundAccount) === scope.accountEmail)
      && (!active || sameChannel(active)) && cardsSnapshot().contacts.some((c) => c.id === contactId)) {
      append({ ...message, accountEmail: scope.accountEmail || undefined, authorEmail: scope.accountEmail || undefined });
    }
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Each attachment has its own directory; two equally named files cannot overwrite one another. */
export async function sendFriendFile(contactId: string, staged: { name: string; localPath: string; size?: number }): Promise<{ ok: boolean; reason?: string; cloudPath?: string }> {
  try {
    const active = channel(await session(), contactId);
    const basename = staged.localPath.split(/[\\/]/).pop() ?? "";
    if (!staged.localPath || !basename || basename === "." || basename === ".." || basename.includes("\0")) throw new Error(i18n("state.friendchannel.e6e1b1bf2d70"));
    const id = newId(), at = Date.now(), root = messagesPath(active.path);
    await mkdir(active, root);
    await mkdir(active, `${root}/attachments`);
    await mkdir(active, `${root}/attachments/${id}`);
    assertChannel(active);
    await invoke("seafile_upload", { token: active.token, repoId: active.repoId, parentDir: `${root}/attachments/${id}`, localPath: staged.localPath, replace: false });
    assertChannel(active);
    const attachment = `attachments/${id}/${basename}`;
    const text = (staged.name || basename).slice(0, 256);
    const manifestPath = await uploadManifest(active, { format: "onethu.friend-message", v: 1, id, authorEmail: active.accountEmail, at, kind: "file", text, attachment });
    const cloudPath = `${root}/${attachment}`;
    append({ id, contactId, channelId: active.channelId, mine: true, kind: "file", text, at, accountEmail: active.accountEmail, authorEmail: active.accountEmail, cloudPath, manifestPath });
    return { ok: true, cloudPath };
  } catch (e) { return { ok: false, reason: e instanceof Error ? e.message : String(e) }; }
}

function decodeWire(raw: string, filename: string): WireMessage | null {
  try {
    const value = JSON.parse(raw) as Partial<WireMessage>;
    if (value?.format !== "onethu.friend-message" || value.v !== 1 || typeof value.id !== "string" || `${value.id}.json` !== filename || !/^fm\.[a-zA-Z0-9-]{8,80}$/.test(value.id)) return null;
    if (typeof value.authorEmail !== "string" || value.authorEmail.length > 254 || !value.authorEmail.includes("@")) return null;
    if (typeof value.at !== "number" || !Number.isFinite(value.at) || value.at <= 0 || value.at > Date.now() + 86400_000) return null;
    if ((value.kind !== "text" && value.kind !== "file") || typeof value.text !== "string" || !value.text.trim() || value.text.length > 2000) return null;
    if (value.kind === "file") {
      if (typeof value.attachment !== "string" || !value.attachment.startsWith(`attachments/${value.id}/`)) return null;
      const parts = value.attachment.split("/");
      if (parts.length !== 3 || parts.some((p) => !p || p === "." || p === ".." || /[\\\0]/.test(p))) return null;
    }
    return value as WireMessage;
  } catch { return null; }
}
export interface FriendRefreshResult { ok: boolean; added: number; reason?: string }
const pendingRefreshes = new Map<string, Promise<FriendRefreshResult>>();
const seenFiles = new Map<string, string>();

/** Read new or changed messages. Concurrent opens/polls share one refresh per account/channel. */
export async function refreshFriendMessages(contactId: string): Promise<FriendRefreshResult> {
  try {
    const active = channel(await session(), contactId);
    const key = `${active.version}|${contactId}|${active.repoId}|${active.path}|${active.channelId ?? ""}`;
    const running = pendingRefreshes.get(key);
    if (running) return await running;
    const operation = readMessages(active, key);
    pendingRefreshes.set(key, operation);
    try { return await operation; } finally { if (pendingRefreshes.get(key) === operation) pendingRefreshes.delete(key); }
  } catch (e) { return { ok: false, added: 0, reason: e instanceof Error ? e.message : String(e) }; }
}

async function readMessages(active: ChannelSession, key: string): Promise<FriendRefreshResult> {
  const root = messagesPath(active.path);
  assertChannel(active);
  // Older channels have no messages directory until the first send. Inspect the parent
  // instead of swallowing every directory error as an empty (apparently synced) channel.
  const children = await invoke<SeafileEntry[]>("seafile_dir", { token: active.token, repoId: active.repoId, path: active.path });
  assertChannel(active);
  if (!children.some((entry) => entry.kind === "dir" && entry.name === "messages")) return { ok: true, added: 0 };
  const listed = await invoke<SeafileEntry[]>("seafile_dir", { token: active.token, repoId: active.repoId, path: root });
  assertChannel(active);
  const entries = listed.filter((entry) => entry.kind === "file" && entry.size <= MAX_MANIFEST_BYTES && (/^fm\.[a-zA-Z0-9-]{8,80}\.json$/.test(entry.name) || /^msg-\d{10,16}\.txt$/.test(entry.name)))
    .sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
  const incoming: FriendMessage[] = [];
  // Pre-manifest versions uploaded files directly into messages/. They remain usable;
  // only known JSON message names are treated as manifests rather than attachments.
  for (const entry of listed) {
    if (entry.kind !== "file" || !entry.name || /[\\/\0]/.test(entry.name) || entry.name === "." || entry.name === ".."
      || entry.name.startsWith("fm.") || /^msg-\d{10,16}\.txt$/.test(entry.name)) continue;
    const path = `${root}/${entry.name}`;
    const previous = doc.messages.find((m) => m.contactId === active.contactId && m.channelId === active.channelId && m.accountEmail === active.accountEmail && m.cloudPath === path);
    incoming.push({ id: previous?.id ?? `legacy.file.${entry.name}`, contactId: active.contactId, channelId: active.channelId, mine: previous?.mine ?? false,
      kind: "file", text: entry.name, cloudPath: path, manifestPath: path, accountEmail: active.accountEmail,
      at: previous?.at ?? (entry.mtime ? (entry.mtime < 10_000_000_000 ? entry.mtime * 1000 : entry.mtime) : 0),
    });
  }
  let cursor = 0;
  const errors: string[] = [];
  await Promise.all(Array.from({ length: Math.min(4, entries.length) }, async () => {
    while (cursor < entries.length) {
      const entry = entries[cursor++]!;
      const path = `${root}/${entry.name}`, cacheKey = `${key}|${entry.name}`, signature = `${entry.size}|${entry.mtime}`;
      if (seenFiles.get(cacheKey) === signature) continue;
      try {
        assertChannel(active);
        const b64 = await invoke<string>("seafile_read_bytes", { token: active.token, repoId: active.repoId, path, maxBytes: MAX_MANIFEST_BYTES });
        assertChannel(active);
        const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
        if (bytes.byteLength > MAX_MANIFEST_BYTES) continue;
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        if (entry.name.endsWith(".txt")) {
          const previous = doc.messages.find((m) => m.contactId === active.contactId && m.channelId === active.channelId && m.accountEmail === active.accountEmail && m.cloudPath === path);
          incoming.push({
            id: previous?.id ?? `legacy.${entry.name}`, contactId: active.contactId, channelId: active.channelId,
            mine: previous?.mine ?? false, kind: "text", text: text.slice(0, 2000),
            cloudPath: path, manifestPath: path, accountEmail: active.accountEmail,
            at: Number(entry.name.slice(4, -4)),
          });
        } else {
          const wire = decodeWire(text, entry.name);
          // The manifest is collaborator-written metadata, not a signed identity.
          // Do not display a third person's claimed identity in a two-person channel.
          if (wire && [active.accountEmail, active.peerEmail].includes(normalizeEmail(wire.authorEmail))) incoming.push({
            id: wire.id, contactId: active.contactId, channelId: active.channelId, mine: normalizeEmail(wire.authorEmail) === active.accountEmail,
            kind: wire.kind, text: wire.text, at: wire.at, authorEmail: normalizeEmail(wire.authorEmail),
            accountEmail: active.accountEmail, manifestPath: path,
            cloudPath: wire.kind === "file" ? `${root}/${wire.attachment}` : path,
          });
        }
        seenFiles.set(cacheKey, signature);
      } catch (e) {
        if (!sameChannel(active)) throw e;
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }
  }));
  assertChannel(active);
  let added = 0;
  const messages = [...doc.messages];
  for (const m of incoming) {
    const index = messages.findIndex((old) => old.contactId === m.contactId && old.channelId === m.channelId && old.accountEmail === m.accountEmail && (old.id === m.id || old.manifestPath === m.manifestPath || old.cloudPath === m.manifestPath));
    if (index < 0) { messages.push(m); added++; } else messages[index] = m;
  }
  if (incoming.length) { doc = { v: 1, messages }; commit(); }
  // Don't let account/channel churn grow this in-memory optimization indefinitely.
  if (seenFiles.size > 10_000) seenFiles.clear();
  return errors.length ? { ok: false, added, reason: i18n("state.friendchannel.partialRefresh") } : { ok: true, added };
}
