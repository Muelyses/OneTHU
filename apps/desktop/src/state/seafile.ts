import { t as i18n, msg as i18nMsg } from "../i18n/index.js";
/**
 * 清华云盘（Seafile）状态层。
 *
 * 认证：用户在 https://cloud.tsinghua.edu.cn/profile/#get-auth-token 生成的
 * Web API Token（一次性），XOR 混淆落 seafile.cfg.json（同 caldav 邮箱授权码模式）。
 * 数据：资料库 + 目录列表为内存缓存（不落盘——云盘内容大且变化快，每次进页刷新）。
 */
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { fileRead, fileWrite, fileDelete, obfuscateSecret, deobfuscateSecret } from "../lib/clients.js";
import { showToast } from "./toast.js";
import { ensureOwnedCloudRepo, hasOwnedRepoMetadata } from "../lib/ownedCloudRepo.js";

const CFG_FILE = "seafile.cfg";
/** 旧版（fileWrite 自动补 .json）写成了 seafile.cfg.json.json——读取迁移用 */
const CFG_FILE_LEGACY = "seafile.cfg.json"; // Rust state_read/write 自动补 .json → 旧文件实为 seafile.cfg.json.json
/** 混淆密钥绑定词（token 属于云盘本身，不需要用户名绑定） */
const KEY_ID = "seafile";

export interface SeafileRepo {
  id: string; name: string; mtime: number; size: number;
  repoType?: string; owner?: string; ownerName?: string; permission?: string; isVirtual?: boolean;
}
export interface SeafileEntry { name: string; kind: "dir" | "file"; size: number; mtime: number }
export interface SeafileAccount { name: string; email: string; usage: number; total: number }

/* ── token 配置 ── */
let cfg: { token: string } | null = null;
let loaded = false;
let loadPending: Promise<void> | null = null;
let credentialVersion = 0;
let persistenceTail: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach((fn) => fn());
const changedAccount = (): Error => new Error(i18n("state.seafile.accountChanged"));

/** Serialize disk writes so an older connect can never finish after a newer logout. */
function persistCfg(value: {token:string} | null, version: number): Promise<void> {
  const operation = persistenceTail.catch(() => undefined).then(async () => {
    if (value?.token && version !== credentialVersion) return;
    if (value?.token) await fileWrite(CFG_FILE, JSON.stringify({secret:obfuscateSecret(value.token, KEY_ID)}), {strict:true});
    else await fileDelete(CFG_FILE, {strict:true});
    // A leftover legacy file must not resurrect a cleared account on the next boot.
    await fileDelete(CFG_FILE_LEGACY, {strict:true});
  });
  persistenceTail = operation;
  return operation;
}
function resetAccountCache(): void {
  account = null; repos = []; reposVersion++; dirs.clear(); dirVersion++;
  busy = false; lastError = null;
}

export function ensureSeafileLoaded(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (loadPending) return loadPending;
  const version = credentialVersion;
  const operation = (async () => {
    let raw = await fileRead(CFG_FILE, {strict:true});
    const legacy = !raw;
    if (!raw) raw = await fileRead(CFG_FILE_LEGACY, {strict:true});
    let next: {token:string} | null = null;
    if (raw) {
      const stored = JSON.parse(raw) as {secret?:unknown};
      if (typeof stored.secret === "string") {
        const token = deobfuscateSecret(stored.secret, KEY_ID);
        if (token) next = {token};
      }
    }
    if (version !== credentialVersion) return;
    if (legacy && next) await persistCfg(next, version);
    if (version !== credentialVersion) return;
    cfg = next;
    loaded = true;
  })();
  loadPending = operation;
  void operation.finally(() => { if (loadPending === operation) loadPending = null; }).catch(() => undefined);
  return operation;
}

/** Validate before committing; a later clear/connect supersedes this request. */
export async function setSeafileToken(token: string): Promise<SeafileAccount> {
  const version = ++credentialVersion;
  const verified = await invoke<SeafileAccount>("seafile_account", { token });
  if (version !== credentialVersion) throw changedAccount();
  await persistCfg({token}, version);
  if (version !== credentialVersion) throw changedAccount();
  cfg = {token}; loaded = true;
  resetAccountCache(); account = verified;
  emit();
  return verified;
}

export async function clearSeafileToken(): Promise<void> {
  const version = ++credentialVersion;
  cfg = null; loaded = true;
  resetAccountCache();
  emit();
  await persistCfg(null, version);
}

/** 同步读资料库显示名（explorer 标签完整路径用；列表未拉到时返回 null） */
export function seafileRepoName(id: string): string | null {
  return repos.find((r) => r.id === id)?.name ?? null;
}

export function getSeafileCredentialVersion(): number { return credentialVersion; }

export function getSeafileToken(): string {
  return cfg?.token ?? "";
}

/* ── 数据面（内存缓存） ── */
let account: SeafileAccount | null = null;
let repos: SeafileRepo[] = [];
let reposVersion = 0;
/** 目录缓存（带 TTL）：key=repoId|path。15s 内命中走缓存，过期自动重取——
 * 上传后的强刷是即时路径；TTL 是兜底（错过强刷/外部变更，重进目录自愈） */
const DIR_TTL_MS = 15_000;
let dirs = new Map<string, { at: number; entries: SeafileEntry[] }>();
/** 目录缓存版本号：任何目录写入（含上传后强刷）bump → 所有 useSeafileDir 重取 */
let dirVersion = 0;
let busy = false;
let lastError: string | null = null;

/** 账号快照（含 email/配额）：云盘账号已加载过就能同步读到，供名片自动识别本人邮箱。 */
export function getSeafileAccount(): SeafileAccount | null {
  return account;
}

/** 账号信息（含配额）——进页刷新一次 */
export async function refreshSeafileAccount(): Promise<void> {
  if (!cfg) return;
  const version = credentialVersion;
  const next = await invoke<SeafileAccount>("seafile_account", { token: cfg.token });
  if (version !== credentialVersion) return;
  account = next; emit();
}

export async function refreshRepos(): Promise<void> {
  if (!cfg) return;
  const version = credentialVersion;
  const request = ++reposVersion;
  busy = true;
  lastError = null;
  emit();
  try {
    const next = await invoke<SeafileRepo[]>("seafile_repos", { token: cfg.token });
    if (version === credentialVersion && request === reposVersion) repos = next;
  } catch (e) {
    if (version === credentialVersion && request === reposVersion) lastError = String(e);
  } finally {
    if (version === credentialVersion && request === reposVersion) { busy = false; emit(); }
  }
}

/** A write grant on a shared library never authorizes deleting the library itself. */
export function canDeleteSeafileRepo(repo: SeafileRepo, email = account?.email ?? ""): boolean {
  return repo.repoType === "mine" && repo.isVirtual === false && !!email
    && repo.owner?.toLowerCase() === email.toLowerCase();
}

/** Older desktop hosts omit these fields entirely. Missing is not "not virtual"
 * or "not found": reads can still work, but ownership-sensitive writes must stop. */
export function hasSeafileRepoOwnershipMetadata(repo: SeafileRepo): boolean {
  return hasOwnedRepoMetadata(repo);
}

export async function deleteSeafileRepo(repoId: string): Promise<void> {
  if (!cfg) throw new Error(i18n("state.seafile.96e4aa1ffce5"));
  const version = credentialVersion;
  const token = cfg.token;
  const repo = repos.find((entry) => entry.id === repoId);
  if (repo && !hasSeafileRepoOwnershipMetadata(repo)) throw new Error(i18n("state.seafile.nativeRestartRequired"));
  if (!repo || !canDeleteSeafileRepo(repo)) throw new Error(i18n("state.seafile.deleteOwnerOnly"));
  try {
    await invoke("seafile_delete_owned_repo", {token, repoId});
  } catch (error) {
    // Never fall back to the differently scoped private-share cleanup command.
    if (/command .*seafile_delete_owned_repo.*not found|unknown command.*seafile_delete_owned_repo/i.test(String(error))) {
      throw new Error(i18n("state.seafile.nativeRestartRequired"));
    }
    throw error;
  }
  if (version !== credentialVersion) throw changedAccount();
  // Invalidate pending list requests too, so a response started before deletion
  // cannot put the removed library straight back into the current account's UI.
  reposVersion++;
  repos = repos.filter((entry) => entry.id !== repoId);
  for (const key of dirs.keys()) if (key.startsWith(`${repoId}|`)) dirs.delete(key);
  dirVersion++;
  busy = false;
  lastError = null;
  emit();
  await Promise.allSettled([refreshRepos(), refreshSeafileAccount()]);
}

/** 目录列表（缓存优先，force 强刷） */
export async function openDir(repoId: string, path: string, force = false): Promise<SeafileEntry[]> {
  if (!cfg) return [];
  const version = credentialVersion;
  const key = `${repoId}|${path}`;
  const hit = dirs.get(key);
  if (!force && hit && Date.now() - hit.at < DIR_TTL_MS) return hit.entries;
  const entries = await invoke<SeafileEntry[]>("seafile_dir", { token: cfg.token, repoId, path });
  if (version !== credentialVersion) return [];
  dirs.set(key, { at: Date.now(), entries });
  dirVersion++;
  emit();
  return entries;
}

/** 上传/外部变更后强制刷新目录（bump 版本 → 订阅该目录的界面立即重取新列表） */
export async function refreshDir(repoId: string, path: string): Promise<void> {
  await openDir(repoId, path, true);
}

export interface SeafilePreview {
  kind: "text" | "image" | "binary" | "too-big";
  text?: string;
  dataUrl?: string;
  size?: number;
  reason?: string;
}

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico"]);
const TEXT_EXT = new Set(["txt", "md", "markdown", "json", "csv", "tsv", "yml", "yaml", "toml", "ini", "log", "sh", "py", "js", "ts", "tsx", "jsx", "c", "h", "cpp", "hpp", "java", "go", "rs", "html", "css", "xml", "tex", "bib", "srt", "ipynb"]);

/** 组织页内联预览：小文件读进内存（不落盘），文本/图片直接显示，其余给下载。 */
export async function seafilePreview(repoId: string, path: string, maxBytes = 512 * 1024): Promise<SeafilePreview> {
  if (!cfg) throw new Error(i18n("state.seafile.15e1ef41e215"));
  const version = credentialVersion;
  const ext = (path.split(".").pop() ?? "").toLowerCase();
  let b64: string;
  try {
    b64 = await invoke<string>("seafile_read_bytes", { token: cfg.token, repoId, path, maxBytes });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/文件过大/.test(msg)) return { kind: "too-big", reason: msg };
    throw e;
  }
  if (version !== credentialVersion) throw changedAccount();
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  if (IMAGE_EXT.has(ext)) {
    const mime = ext === "svg" ? "image/svg+xml" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/" + ext;
    return { kind: "image", dataUrl: `data:${mime};base64,${b64}`, size: bytes.length };
  }
  let text = "";
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { kind: "binary", size: bytes.length };
  }
  /* 无明显文本扩展名时按可打印比例猜一把（PDF/zip 之类会解出乱码）。 */
  const printable = [...text.slice(0, 2000)].filter((ch) => ch === "\n" || ch === "\r" || ch === "\t" || ch >= " ").length;
  if (!TEXT_EXT.has(ext) && printable < Math.min(text.length, 2000) * 0.9) return { kind: "binary", size: bytes.length };
  return { kind: "text", text: text.slice(0, 200_000), size: bytes.length };
}

export async function seafileDownload(repoId: string, path: string): Promise<string> {
  if (!cfg) throw new Error(i18n("state.seafile.96e4aa1ffce5"));
  const local = await invoke<string>("seafile_download", { token: cfg.token, repoId, path });
  showToast(i18nMsg("state.seafile.f206fb3a20d8", { local: String(local) }));
  return local;
}

export async function seafileUpload(repoId: string, parentDir: string, localPath: string, replace: boolean): Promise<void> {
  if (!cfg) throw new Error(i18n("state.seafile.96e4aa1ffce5"));
  await invoke("seafile_upload", { token: cfg.token, repoId, parentDir, localPath, replace });
  await openDir(repoId, parentDir, true);
  showToast(i18nMsg("state.seafile.f423b2f16ab1"));
}

export async function seafileShare(repoId: string, path: string, expireDays: number): Promise<string> {
  if (!cfg) throw new Error(i18n("state.seafile.96e4aa1ffce5"));
  const r = await invoke<{ link: string }>("seafile_share", { token: cfg.token, repoId, path, expireDays, password: "" });
  return r.link;
}

/** 删除分享链接（云盘侧撤销；token 来自 seafile_share 返回的 token，或从链接反查）。 */
export async function seafileShareDelete(shareToken: string): Promise<void> {
  if (!cfg) throw new Error(i18n("state.seafile.96e4aa1ffce5"));
  await invoke("seafile_share_delete", { token: cfg.token, shareToken });
}

/** 匿名读取分享链接根目录的清单文件（接收端无需登录；只返回 UTF-8 文本）。 */
export async function seafileShareRead(link: string, name?: string): Promise<string> {
  return invoke<string>("seafile_share_read", { link, name: name ?? null });
}

/** 文件夹共享给云盘账号（双向通道）：permission="r"|"rw"|"admin"。 */
export async function seafileShareFolderToUser(repoId: string, path: string, email: string, permission = "rw"): Promise<void> {
  const token = getSeafileToken();
  if (!token) throw new Error(i18n("state.seafile.a6e7bedde538"));
  await invoke("seafile_share_folder_to_user", { token, repoId, path, email, permission });
}

/* ── 组织资料库（资料库 = repo，不是文件夹） ── */

/** 新建一个资料库（repo）并返回 repoId；同名已存在时直接复用。 */
export async function seafileCreateRepo(name: string): Promise<string> {
  await ensureSeafileLoaded();
  const token = getSeafileToken();
  if (!token) throw new Error(i18n("state.seafile.0507dadfda6a"));
  const wanted = String(name ?? "").trim().slice(0, 80) || "组织资料库";
  const repo = await ensureOwnedCloudRepo(token, wanted);
  if (token !== getSeafileToken()) throw changedAccount();
  await refreshRepos();
  return repo.id;
}

/** 把整个资料库（根目录）共享给云盘账号邮箱；permission="r"|"rw"|"admin"。 */
export async function seafileShareRepoToUser(repoId: string, email: string, permission = "rw"): Promise<void> {
  const token = getSeafileToken();
  if (!token) throw new Error(i18n("state.seafile.a6e7bedde538"));
  await invoke("seafile_share_folder_to_user", { token, repoId, path: "/", email, permission });
}

/** 生成资料库的公开分享链接（根目录）。 */
export async function seafileShareRepo(repoId: string, expireDays = 7): Promise<{ shareUrl: string; shareToken: string }> {
  const token = getSeafileToken();
  if (!token) throw new Error(i18n("state.seafile.a6e7bedde538"));
  const share = await invoke<{ link: string; token: string }>("seafile_share", { token, repoId, path: "/", expireDays, password: "" });
  return { shareUrl: share.link, shareToken: share.token };
}

export async function seafileSearch(repoId: string, query: string): Promise<SeafileEntry[]> {
  if (!cfg) throw new Error(i18n("state.seafile.96e4aa1ffce5"));
  return invoke<SeafileEntry[]>("seafile_search", { token: cfg.token, repoId, query });
}

/* ── hooks ── */

export function useSeafile() {
  const [, tick] = useState(0);
  useEffect(() => {
    const fn = () => tick((n) => n + 1);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  return {
    configured: !!cfg?.token,
    account,
    repos,
    busy,
    lastError,
  };
}

/** 单目录订阅（进目录拉取） */
export function useSeafileDir(repoId: string | null, path: string | null) {
  const [ver, setVer] = useState(dirVersion);
  const [state, setState] = useState<{ loading: boolean; entries: SeafileEntry[]; error: string | null }>({
    loading: false,
    entries: [],
    error: null,
  });
  useEffect(() => {
    const fn = () => setVer(dirVersion);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  useEffect(() => {
    if (!repoId || !path) return;
    let alive = true; // 卸载/切换后到达的响应丢弃
    setState((s) => ({ ...s, loading: true, error: null }));
    openDir(repoId!, path!)
      .then((entries) => { if (alive) setState({ loading: false, entries, error: null }); })
      .catch((e) => { if (alive) setState({ loading: false, entries: [], error: String(e) }); });
    return () => { alive = false; };
  }, [repoId, path, ver]);
  return state;
}

/** Explicit grants are verified by the server after every change. */
async function permissionsToken(): Promise<string> {
  await ensureSeafileLoaded();
  const token = getSeafileToken();
  if (!token) throw new Error(i18n("state.seafile.f6d2148271ab"));
  return token;
}
export async function repoOwnerEmail(repoId: string): Promise<string> {
  return invoke<string>("seafile_repo_owner", {token: await permissionsToken(), repoId});
}
export async function listRepoUserShares(repoId: string): Promise<{email:string;permission:string}[]> {
  return invoke("seafile_repo_user_shares", {token: await permissionsToken(), repoId});
}
export async function setRepoUserPermission(repoId:string,email:string,permission:"r"|"rw"):Promise<void> {
  await invoke("seafile_set_repo_user_permission", {token:await permissionsToken(),repoId,email,permission});
}
export async function removeRepoUserShare(repoId:string,email:string):Promise<void> {
  await invoke("seafile_remove_repo_user_share", {token:await permissionsToken(),repoId,email});
}

export async function assertRepoAccountAcl(repoId:string):Promise<void>{
  await invoke("seafile_assert_account_acl",{token:await permissionsToken(),repoId});
}

/** A hidden-resource 404 from a different account is not proof of deletion. */
export async function assertRepoOwner(repoId:string):Promise<void>{
  const token=await permissionsToken();
  const [owner,account]=await Promise.all([repoOwnerEmail(repoId),invoke<SeafileAccount>("seafile_account",{token})]);
  if(owner.toLowerCase()!==account.email.toLowerCase())throw new Error(i18n("state.seafile.2a15ea48f5c7"));
}
