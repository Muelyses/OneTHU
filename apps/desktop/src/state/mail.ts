import { t as i18n } from "../i18n/index.js";
/**
 * 邮箱状态层 —— 复用云日历的「邮箱 + 授权码」（同一个清华信息门户凭据）。
 *
 * 传输：Rust 直连（mail.rs：IMAP 993 收 / SMTP 465 发，rustls 全纯 Rust，
 * Android 可交叉编译）；列表头缓存到 state 文件（mail.cache，绕 localStorage
 * 驱逐），正文只留内存（体积大、时效短）。
 *
 * 设计：模块级单例 + 订阅广播（learn/cloudCal 同款）；已读在读取时标记，
 * 失败静默（下次刷新自然带回来）。
 */
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { fileRead, fileWrite } from "../lib/clients.js";
import { getCloudCalConfig, onCloudCalConfigChange, ensureCloudCalCredentialsLoaded } from "./cloudCal.js";

export interface MailHead {
  uid: number;
  subject: string;
  from: string;
  dateMs: number;
  seen: boolean;
}

export interface MailBody {
  subject: string;
  from: string;
  to: string;
  dateMs: number;
  text: string;
  html: string | null;
}

/** 服务器实探的文件夹（LIST：\Sent → "Sent Items"） */
export const MAIL_FOLDERS: Array<{ id: string; label: string }> = [
  { id: "INBOX", get label() { return i18n("state.mail.63a5e7b73911"); } },
  { id: "Sent Items", get label() { return i18n("state.mail.60823aaec73b"); } },
];

const CACHE_FILE = "mail.cache";
const FETCH_LIMIT = 50;

/* -------------- Account-scoped singleton -------------- */

type Credential = { email: string; auth: string; revision: number };
type ListReply = { total: number; minSeq: number; heads: MailHead[] };
let account: { email: string; auth: string } | null = null;
let accountKnown = false;
let revision = 0;
let headsByFolder: Record<string, MailHead[]> = {};
let lastRefreshAt: Record<string, number> = {};
let totalsByFolder: Record<string, number> = {};
let minSeqsByFolder: Record<string, number> = {};
let errorsByFolder: Record<string, string | null> = {};
const bodies = new Map<string, MailBody>();
const reading = new Map<string, Promise<MailBody>>();
const listing = new Map<string, { more: boolean; revision: number; promise: Promise<MailHead[]> }>();
let cacheLoad: { revision: number; promise: Promise<void> } | null = null;
let cacheTail: Promise<void> = Promise.resolve();
let initializationError: string | null = null;
const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach((fn) => fn());
const normalizedEmail = (email: string): string => email.trim().toLowerCase();

function matchesConfig(): boolean {
  const cfg = getCloudCalConfig();
  return !!account && !!cfg && account.email === normalizedEmail(cfg.email) && account.auth === cfg.authCode;
}
function current(c: Credential): boolean {
  return c.revision === revision && matchesConfig();
}
function assertCurrent(c: Credential): void {
  if (!current(c)) throw new Error(i18n("state.mail.e9a7b9e11064"));
}

/** Serialize disk writes so an old account's slow write cannot replace the new
 * account's cache. Auth codes and bodies are never included in this file. */
function persistCache(): Promise<void> {
  const at = revision;
  const raw = JSON.stringify({ version: 2, account: account?.email ?? null, headsByFolder, totalsByFolder, minSeqsByFolder });
  const next = cacheTail.catch(() => {}).then(async () => {
    if (at === revision) await fileWrite(CACHE_FILE, raw, { strict: true });
  });
  cacheTail = next.catch(() => {});
  return next;
}

function acceptConfig(): void {
  const cfg = getCloudCalConfig();
  const next = cfg?.email.trim() && cfg.authCode ? { email: normalizedEmail(cfg.email), auth: cfg.authCode } : null;
  if (accountKnown && next?.email === account?.email && next?.auth === account?.auth) return;
  const hadAccount = accountKnown;
  accountKnown = true;
  account = next;
  revision++;
  headsByFolder = {}; lastRefreshAt = {}; totalsByFolder = {}; minSeqsByFolder = {}; errorsByFolder = {};
  bodies.clear(); reading.clear(); listing.clear(); cacheLoad = null;
  // Initial configuration hydration must read the owner-tagged cache first.
  if (hadAccount) void persistCache().catch(() => {});
  emit();
}
// One module-level configuration subscription; mounted views only subscribe to
// mail state and always remove those subscriptions on unmount.
onCloudCalConfigChange(acceptConfig);

async function ensureLoaded(): Promise<void> {
  try {
    await ensureCloudCalCredentialsLoaded();
    if (initializationError) { initializationError = null; emit(); }
  } catch {
    const message = i18n("state.mail.credentialsReadFailed");
    if (initializationError !== message) { initializationError = message; emit(); }
    throw new Error(message);
  }
  acceptConfig();
  if (cacheLoad?.revision === revision) return cacheLoad.promise;
  const at = revision;
  const owner = account?.email;
  const promise: Promise<void> = (async () => {
    try {
      await cacheTail;
      const raw = await fileRead(CACHE_FILE, { strict: true });
      if (at !== revision || !owner || !raw) return;
      const parsed = JSON.parse(raw) as {
        version?: number; account?: string; headsByFolder?: Record<string, MailHead[]>;
        totalsByFolder?: Record<string, number>; minSeqsByFolder?: Record<string, number>;
      };
      // Legacy caches have no owner and cannot safely be attributed to a user.
      if (parsed.version !== 2 || parsed.account !== owner) return;
      for (const folder of MAIL_FOLDERS) {
        const rows = parsed.headsByFolder?.[folder.id];
        if (Array.isArray(rows)) headsByFolder[folder.id] = rows.filter((row) =>
          row && Number.isInteger(row.uid) && row.uid > 0 && typeof row.subject === "string"
          && typeof row.from === "string" && Number.isFinite(row.dateMs) && typeof row.seen === "boolean");
        const total = parsed.totalsByFolder?.[folder.id], minSeq = parsed.minSeqsByFolder?.[folder.id];
        if (typeof total === "number" && Number.isFinite(total) && total >= 0) totalsByFolder[folder.id] = total;
        if (typeof minSeq === "number" && Number.isFinite(minSeq) && minSeq >= 0) minSeqsByFolder[folder.id] = minSeq;
      }
    } catch { /* Invalid or legacy cache is treated as empty. */ }
    finally { if (at === revision) emit(); }
  })();
  cacheLoad = { revision: at, promise };
  await promise;
  if (at !== revision) await ensureLoaded();
}

async function cred(): Promise<Credential> {
  await ensureLoaded();
  if (!account || !matchesConfig()) throw new Error(i18n("state.mail.c7533b0c0d79"));
  return { ...account, revision };
}

async function listMail(folder: string, more: boolean): Promise<MailHead[]> {
  const c = await cred();
  const existing = listing.get(folder);
  if (existing?.revision === c.revision) {
    if (existing.more === more) return existing.promise;
    await existing.promise.catch(() => {});
    assertCurrent(c);
    return listMail(folder, more);
  }
  const before = minSeqsByFolder[folder];
  if (more && (!before || before <= 1)) return headsByFolder[folder] ?? [];
  errorsByFolder[folder] = null;
  const promise: Promise<MailHead[]> = Promise.resolve().then(async () => {
    try {
      const out = await invoke<ListReply>("mail_list", {
        email: c.email, auth: c.auth, folder, limit: FETCH_LIMIT,
        ...(more ? { beforeSeq: before } : {}),
      });
      assertCurrent(c);
      const seen = new Set((headsByFolder[folder] ?? []).map((head) => head.uid));
      headsByFolder[folder] = more
        ? [...(headsByFolder[folder] ?? []), ...out.heads.filter((head) => !seen.has(head.uid))]
        : out.heads;
      totalsByFolder[folder] = out.total;
      minSeqsByFolder[folder] = out.minSeq;
      if (!more) lastRefreshAt[folder] = Date.now();
      await persistCache().catch(() => {
        if (current(c)) errorsByFolder[folder] = i18n("state.mail.cacheWriteFailed");
      });
      assertCurrent(c);
      return out.heads;
    } catch (err) {
      if (current(c)) errorsByFolder[folder] = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      if (listing.get(folder)?.promise === promise) listing.delete(folder);
      if (current(c)) emit();
    }
  });
  listing.set(folder, { more, revision: c.revision, promise });
  emit();
  return promise;
}

export const refreshMail = (folder: string): Promise<MailHead[]> => listMail(folder, false);
export const loadMoreMail = (folder: string): Promise<MailHead[]> => listMail(folder, true);

/** Native requests may finish after a view closes; only the matching account
 * may receive or cache their results. Reading a cached UID still checks auth. */
export async function readMail(folder: string, uid: number, options: { markSeen?: boolean } = {}): Promise<MailBody> {
  const c = await cred();
  const key = `${folder}#${uid}`;
  const markSeen = () => {
    if (options.markSeen === false) return;
    assertCurrent(c);
    void invoke("mail_mark_seen", { email: c.email, auth: c.auth, folder, uid }).then(() => {
      if (!current(c)) return;
      const head = headsByFolder[folder]?.find((row) => row.uid === uid);
      if (head && !head.seen) {
        headsByFolder[folder] = headsByFolder[folder]!.map((row) => row.uid === uid ? { ...row, seen: true } : row);
        emit();
        void persistCache().catch(() => {});
      }
    }).catch(() => {});
  };
  const cached = bodies.get(key);
  if (cached) { markSeen(); return cached; }
  const pendingKey = `${key}:${options.markSeen !== false ? "seen" : "peek"}`;
  const pending = reading.get(pendingKey);
  if (pending) return pending;
  const promise: Promise<MailBody> = Promise.resolve().then(async () => {
    try {
      const body = await invoke<MailBody>("mail_read", { email: c.email, auth: c.auth, folder, uid });
      assertCurrent(c);
      if (bodies.size >= 24) bodies.clear();
      bodies.set(key, body);
      markSeen();
      return body;
    } finally {
      if (reading.get(pendingKey) === promise) reading.delete(pendingKey);
    }
  });
  reading.set(pendingKey, promise);
  return promise;
}

export function mailFolderTotal(folder: string): number {
  return matchesConfig() ? totalsByFolder[folder] ?? headsByFolder[folder]?.length ?? 0 : 0;
}
export function getMailHead(folder: string, uid: number): MailHead | null {
  return matchesConfig() ? headsByFolder[folder]?.find((head) => head.uid === uid) ?? null : null;
}
export async function mailSearch(folder: string, query: string): Promise<MailHead[]> {
  if (!query.trim()) return [];
  const c = await cred();
  const out = await invoke<MailHead[]>("mail_search", { email: c.email, auth: c.auth, folder, query: query.trim(), limit: 30 });
  assertCurrent(c);
  return out;
}
export async function sendMail(to: string, cc: string, subject: string, body: string, beforeWrite?: () => Promise<void>): Promise<void> {
  const tos = to.split(/[,;\s]+/).filter(Boolean), ccs = cc.split(/[,;\s]+/).filter(Boolean);
  if (!tos.length) throw new Error(i18n("state.mail.e405fef4c8cd"));
  const c = await cred();
  await beforeWrite?.();
  assertCurrent(c);
  await invoke("mail_send", { args: { email: c.email, auth: c.auth, to: tos, cc: ccs, subject, body } });
  if (current(c)) lastRefreshAt["Sent Items"] = 0;
  // SMTP cannot be recalled after dispatch; never retry automatically.
}

/* -------------- Hooks -------------- */

function useMailRevision(): number {
  const [, bump] = useState(0);
  useEffect(() => {
    const fn = (): void => bump((value) => value + 1);
    listeners.add(fn);
    void ensureLoaded().catch(() => {});
    return () => { listeners.delete(fn); };
  }, []);
  return revision;
}

export interface MailState {
  configured: boolean;
  email: string | null;
  accountRevision: number;
  heads: MailHead[];
  unread: number;
  total: number;
  canMore: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
}

export function useMail(folder: string): MailState {
  const accountRevision = useMailRevision();
  const refresh = useCallback(async (): Promise<void> => { await refreshMail(folder).catch(() => {}); }, [folder]);
  const loadMore = useCallback(async (): Promise<void> => { await loadMoreMail(folder).catch(() => {}); }, [folder]);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        await cred();
        if (!alive) return;
        const fresh = headsByFolder[folder] && (lastRefreshAt[folder] ?? 0) > Date.now() - 180_000 && totalsByFolder[folder] !== undefined;
        if (!fresh) await refreshMail(folder);
      } catch { /* State carries list errors; unconfigured views show the gate. */ }
    })();
    return () => { alive = false; };
  }, [folder, accountRevision]);
  const cfg = getCloudCalConfig();
  const valid = matchesConfig();
  const heads = valid ? headsByFolder[folder] ?? [] : [];
  const total = valid ? totalsByFolder[folder] ?? heads.length : 0;
  const minSeq = valid ? minSeqsByFolder[folder] : undefined;
  return {
    configured: !!cfg?.email.trim() && !!cfg.authCode,
    email: cfg?.email ?? null,
    accountRevision,
    heads, unread: heads.filter((head) => !head.seen).length, total,
    canMore: minSeq !== undefined && minSeq > 1 && heads.length < total,
    loading: listing.get(folder)?.revision === accountRevision,
    error: initializationError ?? (valid ? errorsByFolder[folder] ?? null : null),
    refresh, loadMore,
  };
}

export function useMailCounts(): Record<string, number> {
  useMailRevision();
  const out: Record<string, number> = {};
  for (const folder of MAIL_FOLDERS) out[folder.id] = matchesConfig() ? (headsByFolder[folder.id] ?? []).filter((head) => !head.seen).length : 0;
  return out;
}

export function useMailBody(folder: string, uid: number | null): { body: MailBody | null; loading: boolean; error: string | null } {
  const accountRevision = useMailRevision();
  const key = `${accountRevision}:${folder}:${uid}`;
  const [result, setResult] = useState<{ key: string; body: MailBody | null; loading: boolean; error: string | null }>({ key, body: null, loading: uid !== null, error: null });
  useEffect(() => {
    let alive = true;
    setResult({ key, body: null, loading: uid !== null, error: null });
    if (uid === null) return () => { alive = false; };
    void readMail(folder, uid).then(
      (body) => { if (alive) setResult({ key, body, loading: false, error: null }); },
      (err: unknown) => { if (alive) setResult({ key, body: null, loading: false, error: err instanceof Error ? err.message : String(err) }); },
    );
    return () => { alive = false; };
  }, [folder, uid, key]);
  return result.key === key ? result : { body: null, loading: uid !== null, error: null };
}
