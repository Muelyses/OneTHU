/**
 * Account sharing doubles as the inbox transport. A received folder is mounted as
 * a virtual library at "/", so never send the owner's repo/path to the recipient.
 * No public link, reciprocal grant, or application server is needed.
 */
import { invoke } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";
import { t } from "../i18n/index.js";
import { ensureSeafileLoaded, getSeafileToken, getSeafileCredentialVersion,
  type SeafileAccount, type SeafileRepo } from "./seafile.js";
import { attachFriendChannel, cardsSnapshot, setContactShare, type PersonalCard } from "./nameCard.js";

const MANIFEST = "onethu-friend-channel.json";
const RECEIPT = "onethu-friend-accepted.json";
const MAX_BYTES = 8192;
const normalizeEmail = (s: string): string => s.trim().toLowerCase();
const join = (path: string, name: string): string => `${path.replace(/\/+$/, "")}/${name}`;
interface ChannelManifest {
  v: 1;
  kind: "onethu-friend-channel";
  id: string;
  ownerEmail: string;
  ownerName: string;
  recipientEmail: string;
  createdAt: number;
  sentAt: number;
}
export interface FriendInvitation extends ChannelManifest {
  repoId: string;
  permission: string;
}
interface InboxState {
  email: string;
  invitations: FriendInvitation[];
  busy: boolean;
  error: string | null;
}
let state: InboxState = { email: "", invitations: [], busy: false, error: null };
const listeners = new Set<() => void>();
const emit = (patch: Partial<InboxState>): void => {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
};
const subscribe = (fn: () => void): (() => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const friendInboxSnapshot = (): InboxState => state;
export const useFriendInbox = (): InboxState => useSyncExternalStore(subscribe, friendInboxSnapshot, friendInboxSnapshot);
export function conflictingFriendChannel(invitation: FriendInvitation): string | null {
  return cardsSnapshot().contacts.find((c) => c.kind === "personal"
    && normalizeEmail((c.card as PersonalCard).cloudEmail ?? "") === invitation.ownerEmail
    && c.shared?.accountEmail === invitation.recipientEmail
    && c.shared.channelId !== invitation.id)?.id ?? null;
}
const ignoredKey = (email: string): string => `onethu.friendInbox.ignored.v1:${email}`;
function ignored(email: string): Set<string> {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(ignoredKey(email)) ?? "[]");
    return new Set(Array.isArray(data) ? data.filter((s): s is string => typeof s === "string") : []);
  } catch { return new Set(); }
}
export function ignoreFriendInvitation(id: string): void {
  const invitation = state.invitations.find((item) => item.id === id);
  if (!invitation) return;
  const ids = ignored(state.email); ids.add(`${id}:${invitation.sentAt}`);
  try { localStorage.setItem(ignoredKey(state.email), JSON.stringify([...ids].slice(-500))); } catch { /* local-only preference */ }
  emit({ invitations: state.invitations.filter((item) => item.id !== id) });
}
export function clearFriendInbox(): void {
  generation++;
  pending = null;
  negativeCache.clear();
  emit({ email: "", invitations: [], error: null, busy: false });
}
async function session() {
  await ensureSeafileLoaded();
  const token = getSeafileToken(), version = getSeafileCredentialVersion();
  if (!token) throw new Error(t("friends.connectCloud"));
  const assertCurrent = (): void => {
    if (token !== getSeafileToken() || version !== getSeafileCredentialVersion()) throw new Error(t("state.seafile.accountChanged"));
  };
  const account = await invoke<SeafileAccount>("seafile_account", { token });
  assertCurrent();
  const email = normalizeEmail(account.email);
  if (!email.includes("@")) throw new Error(t("friends.accountUnknown"));
  return { token, email, account, assertCurrent };
}
async function readJson(token: string, repoId: string, path: string): Promise<unknown> {
  const encoded = await invoke<string>("seafile_read_bytes", { token, repoId, path, maxBytes: MAX_BYTES });
  if (encoded.length > MAX_BYTES * 1.4) throw new Error(t("friends.invalidInvite"));
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)))) as unknown;
}
function parseManifest(raw: unknown, repo: SeafileRepo, email: string): FriendInvitation | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Partial<ChannelManifest>;
  const owner = normalizeEmail(repo.owner ?? "");
  // The server's owner identity is authoritative, never the sender's display name.
  if (m.v !== 1 || m.kind !== "onethu-friend-channel" || typeof m.id !== "string"
    || !/^[A-Za-z0-9.-]{8,100}$/.test(m.id) || !owner.includes("@") || owner === email
    || typeof m.ownerEmail !== "string" || normalizeEmail(m.ownerEmail) !== owner
    || typeof m.recipientEmail !== "string" || normalizeEmail(m.recipientEmail) !== email
    || typeof m.ownerName !== "string" || m.ownerName.length > 120
    || !Number.isFinite(m.createdAt) || Number(m.createdAt) <= 0) return null;
  return { v: 1, kind: m.kind, id: m.id, ownerEmail: owner, ownerName: m.ownerName,
    recipientEmail: email, createdAt: Number(m.createdAt),
    sentAt: typeof m.sentAt === "number" && Number.isFinite(m.sentAt) && m.sentAt > 0 ? m.sentAt : Number(m.createdAt),
    repoId: repo.id, permission: repo.permission ?? "" };
}
const negativeCache = new Map<string, { mtime: number; until: number }>();
let pending: Promise<void> | null = null;
let pendingIdentity = "";
let generation = 0;
/** One shared-library listing per foreground check; missing manifests are cached for 5 minutes. */
export function refreshFriendInvitations(force = false): Promise<void> {
  const identity = `${getSeafileCredentialVersion()}:${getSeafileToken()}`;
  if (pending && pendingIdentity === identity) return pending;
  pendingIdentity = identity;
  const epoch = ++generation;
  const run = (async () => {
    let current: Awaited<ReturnType<typeof session>> | undefined;
    try {
      if (!getSeafileToken()) await ensureSeafileLoaded();
      if (!getSeafileToken()) { clearFriendInbox(); return; }
      current = await session();
      const { token, email } = current;
      const assertCurrent = (): void => {
        current!.assertCurrent();
        if (epoch !== generation) throw new Error(t("state.seafile.accountChanged"));
      };
      assertCurrent();
      if (state.email !== email) { negativeCache.clear(); emit({ email, invitations: [] }); }
      emit({ busy: true, error: null });
      const repos = await invoke<SeafileRepo[]>("seafile_repos", { token });
      assertCurrent();
      const candidates = repos.filter((r) => r.repoType === "shared" && normalizeEmail(r.owner ?? "") !== email);
      const dismissed = ignored(email);
      const found: FriendInvitation[] = [];
      let failures = 0;
      // Bounded concurrency, no burst of one request per shared file.
      let index = 0;
      await Promise.all(Array.from({ length: Math.min(3, candidates.length) }, async () => {
        while (index < candidates.length) {
          const repo = candidates[index++]!;
          const cacheKey = `${email}:${repo.id}`;
          const miss = negativeCache.get(cacheKey);
          if (!force && miss && miss.mtime === repo.mtime && miss.until > Date.now()) continue;
          assertCurrent();
          try {
            const invite = parseManifest(await readJson(token, repo.id, `/${MANIFEST}`), repo, email);
            assertCurrent();
            if (!invite) { negativeCache.set(cacheKey, { mtime: repo.mtime, until: Date.now() + 300_000 }); continue; }
            const connected = cardsSnapshot().contacts.some((c) => c.shared?.channelId === invite.id && c.shared.accountEmail === email);
            if (!dismissed.has(`${invite.id}:${invite.sentAt}`) && !connected) found.push(invite);
          } catch (error) {
            assertCurrent();
            // Don't conceal temporary network failures for five minutes.
            if (error instanceof SyntaxError || /404|not found|没有这个文件|file missing/i.test(String(error))) {
              negativeCache.set(cacheKey, { mtime: repo.mtime, until: Date.now() + 300_000 });
            } else {
              failures++;
              // A transient failure in an unrelated library cannot suppress valid invitations.
              found.push(...state.invitations.filter((i) => i.repoId === repo.id));
            }
          }
        }
      }));
      assertCurrent();
      const hidden = ignored(email);
      emit({ invitations: [...new Map(found.filter((x) => !hidden.has(`${x.id}:${x.sentAt}`)
        && !cardsSnapshot().contacts.some((c) => c.shared?.channelId === x.id && c.shared.accountEmail === email))
        .map((x) => [x.id, x])).values()].sort((a, b) => b.sentAt - a.sentAt),
        error: failures ? t("friends.partialCheck") : null });
      // Receipts make "shared" and "accepted" visibly different for the sender.
      for (const contact of cardsSnapshot().contacts) {
        const shared = contact.shared;
        if (!shared?.channelId || shared.accountEmail !== email || shared.ownerEmail !== email || shared.acceptedAt) continue;
        try {
          const raw = await readJson(token, shared.repoId, join(shared.path, RECEIPT)) as Record<string, unknown>;
          assertCurrent();
          if (raw?.v === 1 && raw.channelId === shared.channelId && raw.recipientEmail === shared.peerEmail
            && typeof raw.acceptedAt === "number" && raw.acceptedAt > 0
            && cardsSnapshot().contacts.find((c) => c.id === contact.id)?.shared === shared) {
            setContactShare(contact.id, { ...shared, acceptedAt: raw.acceptedAt });
          }
        } catch { assertCurrent(); /* A missing receipt means not yet accepted, never success. */ }
      }
    } catch (e) {
      // Account changes must also discard the old inbox rather than publish stale results.
      if (epoch === generation) {
        try { current?.assertCurrent(); emit({ error: e instanceof Error ? e.message : String(e) }); }
        catch { clearFriendInbox(); }
      }
    } finally { if (epoch === generation) emit({ busy: false }); }
  })();
  pending = run;
  void run.finally(() => { if (pending === run) pending = null; }).catch(() => undefined);
  return run;
}

const publishing = new Map<string, Promise<void>>();
/** Called only from the user's "create / resend invitation" action. */
export function publishFriendInvitation(contactId: string): Promise<void> {
  const previous = publishing.get(contactId);
  if (previous) return previous;
  const run = (async () => {
    const { token, email, account, assertCurrent } = await session();
    const contact = cardsSnapshot().contacts.find((c) => c.id === contactId);
    if (!contact || contact.kind !== "personal") throw new Error(t("friends.personalOnly"));
    const peer = normalizeEmail((contact.card as PersonalCard).cloudEmail ?? "");
    if (!peer.includes("@") || peer === email) throw new Error(t("friends.needPeerEmail"));
    let shared = contact.shared;
    if (shared?.accountEmail && shared.accountEmail !== email) throw new Error(t("state.seafile.accountChanged"));
    const originalPeer = shared?.peerEmail ?? shared?.sharedWith?.email;
    if (originalPeer && normalizeEmail(originalPeer) !== peer) throw new Error(t("friends.peerChanged"));
    const assertContact = (): void => {
      assertCurrent();
      const live = cardsSnapshot().contacts.find((c) => c.id === contactId);
      if (!live || live.shared !== shared || normalizeEmail((live.card as PersonalCard).cloudEmail ?? "") !== peer) {
        throw new Error(t("state.seafile.accountChanged"));
      }
    };
    if (shared) {
      const owner = await invoke<string>("seafile_repo_owner", { token, repoId: shared.repoId });
      assertContact();
      if (normalizeEmail(owner) !== email) throw new Error(t("friends.ownerOnly"));
      // Legacy channels were public links. Revoke before adding account metadata.
      const oldToken = shared.shareToken ?? /\/[df]\/([A-Za-z0-9_-]+)/.exec(shared.shareUrl ?? "")?.[1];
      if (oldToken) {
        await invoke("seafile_share_delete", { token, shareToken: oldToken });
        assertContact();
        shared = { ...shared, shareToken: undefined, shareUrl: undefined, expiresAt: undefined };
        setContactShare(contactId, shared);
      } else if (shared.shareUrl) throw new Error(t("friends.legacyLinkUnknown"));
    } else {
      const repo = await invoke<SeafileRepo>("seafile_create_repo", { token,
        name: `OneTHU · ${cardsSnapshot().personal.name || account.name || email} · ${contact.name}`.slice(0, 80) });
      assertContact();
      shared = { repoId: repo.id, path: "/", createdAt: Date.now(), accountEmail: email };
      // Retain the created library after a later network failure so Retry doesn't create another.
      setContactShare(contactId, shared);
    }
    const manifest: ChannelManifest = { v: 1, kind: "onethu-friend-channel",
      id: shared.channelId ?? crypto.randomUUID(), ownerEmail: email,
      ownerName: (cardsSnapshot().personal.name || account.name || email).slice(0, 120),
      recipientEmail: peer, createdAt: shared.createdAt, sentAt: Date.now() };
    const next = { ...shared, channelId: manifest.id, accountEmail: email, ownerEmail: email, peerEmail: peer };
    setContactShare(contactId, next);
    shared = next;
    await invoke("seafile_upload_text", { token, repoId: shared.repoId, parentDir: shared.path,
      name: MANIFEST, content: JSON.stringify(manifest) });
    assertContact();
    if (shared.path === "/") {
      await invoke("seafile_set_repo_user_permission", { token, repoId: shared.repoId, email: peer, permission: "rw" });
    } else {
      await invoke("seafile_share_folder_to_user", { token, repoId: shared.repoId, path: shared.path, email: peer, permission: "rw" });
    }
    assertContact();
    if (cardsSnapshot().contacts.find((c) => c.id === contactId)?.shared !== next) return;
    setContactShare(contactId, { ...next, invitationPublishedAt: Date.now(),
      sharedWith: { email: peer, permission: "rw", at: Date.now() } });
  })();
  publishing.set(contactId, run);
  void run.finally(() => { if (publishing.get(contactId) === run) publishing.delete(contactId); }).catch(() => undefined);
  return run;
}

const accepting = new Map<string, Promise<string>>();
export function acceptFriendInvitation(id: string, replaceExisting = false): Promise<string> {
  const previous = accepting.get(id);
  if (previous) return previous;
  const run = (async () => {
    const cached = state.invitations.find((x) => x.id === id);
    if (!cached) throw new Error(t("friends.invalidInvite"));
    const { token, email, assertCurrent } = await session();
    const repos = await invoke<SeafileRepo[]>("seafile_repos", { token });
    assertCurrent();
    const repo = repos.find((r) => r.id === cached.repoId && r.repoType === "shared");
    if (!repo) throw new Error(t("friends.invalidInvite"));
    const invite = parseManifest(await readJson(token, repo.id, `/${MANIFEST}`), repo, email);
    assertCurrent();
    if (!invite || invite.id !== id) throw new Error(t("friends.invalidInvite"));
    if (invite.permission !== "rw") throw new Error(t("friends.readOnlyInvite"));
    const existing = cardsSnapshot().contacts.find((c) => c.kind === "personal"
      && normalizeEmail((c.card as PersonalCard).cloudEmail ?? "") === invite.ownerEmail
      && c.shared?.accountEmail === email);
    if (existing?.shared && existing.shared.channelId !== id
      && existing.shared.accountEmail === email && !replaceExisting) throw new Error(t("friends.alreadyConnected"));
    const acceptedAt = Date.now();
    await invoke("seafile_upload_text", { token, repoId: repo.id, parentDir: "/",
      name: RECEIPT, content: JSON.stringify({ v: 1, channelId: id, recipientEmail: email, acceptedAt }) });
    assertCurrent();
    const now = cardsSnapshot().contacts.find((c) => c.kind === "personal"
      && normalizeEmail((c.card as PersonalCard).cloudEmail ?? "") === invite.ownerEmail
      && c.shared?.accountEmail === email);
    if (now?.shared && now.shared.channelId !== id && (!replaceExisting || now.shared !== existing?.shared)) throw new Error(t("friends.alreadyConnected"));
    const contactId = attachFriendChannel(invite.ownerEmail, invite.ownerName, {
      repoId: repo.id, path: "/", channelId: id, accountEmail: email, ownerEmail: invite.ownerEmail,
      peerEmail: invite.ownerEmail, createdAt: invite.createdAt, invitationPublishedAt: invite.createdAt, acceptedAt,
      sharedWith: { email: invite.ownerEmail, permission: "rw", at: acceptedAt },
    });
    emit({ invitations: state.invitations.filter((item) => item.id !== id) });
    return contactId;
  })();
  accepting.set(id, run);
  void run.finally(() => { if (accepting.get(id) === run) accepting.delete(id); }).catch(() => undefined);
  return run;
}
