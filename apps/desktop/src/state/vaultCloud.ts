/**
 * 暂存箱云盘适配器（Phase 2.2）：把清单传上清华云盘并生成分享链接；
 * 接收方通过匿名分享链接读回清单。不依赖自建后端。
 *
 * 目录口径：资料库 `OneTHU` → `/Vault/shares/<shareId>/manifest.json`，每个分享独立文件夹。
 * 撤销：删除分享链接；文件本体等引用计数/GC（transferQueue）落地后再清。
 * 未连接云盘时不注册适配器 → vaultShare 继续走 inline（小箱子离线可用）。
 */
import { invoke } from "@tauri-apps/api/core";
import { ensureSeafileLoaded, getSeafileToken, seafileShareDelete, seafileShareRead } from "./seafile.js";
import { bytesToBase64 } from "../lib/imageSave.js";
import {
  registerVaultCloudAdapter, type VaultCloudAdapter, type VaultCloudRef, type VaultSharePayload,
} from "./vaultShare.js";
import {
  expiredShareRefs, markShareRevoked, rememberShare, shareRefsSnapshot, unreferencedFilesOf, type ShareFileRef,
} from "./shareRefs.js";

interface Repo { id: string; name: string }
interface ShareOut { link: string; token: string }

const REPO_NAME = "OneTHU";
const ROOT = "/Vault/shares";
const EXPIRE_DAYS = 7;

function tokenOrThrow(): string {
  const t = getSeafileToken();
  if (!t) throw new Error("清华云盘未连接：到云盘页粘贴 token 后再生成云分享口令");
  return t;
}

function shareId(): string {
  return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

async function ensureRepo(token: string): Promise<string> {
  const repos = await invoke<Repo[]>("seafile_repos", { token });
  const hit = repos.find((r) => r.name === REPO_NAME);
  if (hit) return hit.id;
  await invoke("seafile_create_repo", { token, name: REPO_NAME });
  const again = await invoke<Repo[]>("seafile_repos", { token });
  const made = again.find((r) => r.name === REPO_NAME);
  if (!made) throw new Error("创建 OneTHU 资料库失败：云盘没有返回该库");
  return made.id;
}

async function writeTemp(name: string, text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  return invoke<string>("write_temp_file", { name, dataBase64: bytesToBase64(bytes) });
}

const adapter: VaultCloudAdapter = {
  async upload(payload: VaultSharePayload): Promise<VaultCloudRef> {
    const token = tokenOrThrow();
    const repoId = await ensureRepo(token);
    const id = shareId();
    const dir = `${ROOT}/${id}`;
    await invoke("seafile_mkdir", { token, repoId, path: dir });
    /* 文件条目先上传到分享目录（同一目录一起分享）；清单里只留相对路径。 */
    const cloud = JSON.parse(JSON.stringify(payload)) as VaultSharePayload;
    const filesDir = `${dir}/files`;
    const shareFiles: ShareFileRef[] = [];
    let filesReady = false;
    for (const it of cloud.items ?? []) {
      const f = it.file;
      if (!f?.stagedPath) continue;
      if (!filesReady) {
        await invoke("seafile_mkdir", { token, repoId, path: filesDir });
        filesReady = true;
      }
      const safe = (f.hash ? f.hash.slice(0, 8) + "-" : "") + f.name.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 120);
      await invoke("seafile_upload", { token, repoId, parentDir: filesDir, localPath: f.stagedPath, replace: true });
      f.cloudPath = `files/${safe}`;
      if (f.hash) shareFiles.push({ hash: f.hash, path: `files/${safe}` });
    }
    const manifest = JSON.stringify(cloud);
    const localPath = await writeTemp(`onethu-vault-${id}.json`, manifest);
    const manifestPath = `${dir}/manifest.json`;
    await invoke("seafile_upload", { token, repoId, parentDir: dir, localPath, replace: true });
    let path = dir;
    try {
      const share = await invoke<ShareOut>("seafile_share", { token, repoId, path: dir, expireDays: EXPIRE_DAYS, password: "" });
      const expiresAt = Date.now() + EXPIRE_DAYS * 24 * 3600 * 1000;
      rememberShare({ shareUrl: share.link, shareToken: share.token, repoId, path, manifestName: "manifest.json", files: shareFiles, expiresAt });
      return { provider: "seafile", repoId, path, manifestName: "manifest.json", shareUrl: share.link, shareToken: share.token, expiresAt };
    } catch {
      /* 目录分享被云盘策略拒绝：退化为分享清单文件（文件条目不可直接下载） */
      path = manifestPath;
    }
    const share = await invoke<ShareOut>("seafile_share", {
      token, repoId, path, expireDays: EXPIRE_DAYS, password: "",
    });
    const expiresAt = Date.now() + EXPIRE_DAYS * 24 * 3600 * 1000;
    rememberShare({ shareUrl: share.link, shareToken: share.token, repoId, path: dir, manifestName: "manifest.json", files: shareFiles, expiresAt });
    return { provider: "seafile", repoId, path, manifestName: "manifest.json", shareUrl: share.link, shareToken: share.token, expiresAt };
  },

  async resolve(ref: VaultCloudRef): Promise<VaultSharePayload> {
    if (!ref.shareUrl) throw new Error("这条云分享口令没有分享链接");
    const text = await seafileShareRead(ref.shareUrl, ref.manifestName ?? "manifest.json");
    const p = JSON.parse(text) as VaultSharePayload;
    if (p?.kind !== "vault-share" || p.v !== 1) throw new Error("云盘清单格式不受支持");
    return p;
  },

  async revoke(ref: VaultCloudRef): Promise<void> {
    const st = ref.shareToken?.trim();
    if (!st) throw new Error("没有可撤销的分享 token");
    const record = shareRefsSnapshot().refs.find((r) => r.shareUrl === ref.shareUrl || r.shareToken === st);
    await seafileShareDelete(st);
    if (!record) return;
    markShareRevoked(record.id);
    /* 只删除其他有效分享没引用的文件；失败不阻塞撤销（下次启动再清）。 */
    const token = getSeafileToken();
    if (!token) return;
    const dir = /\/manifest\.json$/.test(record.path) ? record.path.replace(/\/manifest\.json$/, "") : record.path;
    /* 暂存箱分享目录是内部目录（每分享独立），撤销后整目录删；失败再退化为逐文件清理。 */
    const removed = await invoke("seafile_delete", { token, repoId: record.repoId, path: dir, kind: "dir" })
      .then(() => true)
      .catch(() => false);
    if (!removed) {
      for (const f of unreferencedFilesOf(record.id)) {
        const full = f.path.startsWith("/") ? f.path : `${dir}/${f.path}`;
        await invoke("seafile_delete", { token, repoId: record.repoId, path: full, kind: "file" }).catch(() => undefined);
      }
    }
  },
};

/** 启动时清理过期分享：先撤链接，再删无引用文件（尽力而为；失败留给下次）。 */
export async function cleanupExpiredVaultShares(): Promise<number> {
  const expired = expiredShareRefs();
  if (expired.length === 0) return 0;
  let n = 0;
  for (const r of expired) {
    try {
      await adapter.revoke({ provider: "seafile", repoId: r.repoId, path: r.path, manifestName: r.manifestName, shareUrl: r.shareUrl, shareToken: r.shareToken, expiresAt: r.expiresAt });
      n++;
    } catch {
      /* 网络/权限问题：保留待下次 */
    }
  }
  return n;
}

let installed = false;

/** 启动/进入暂存箱时调用：有 token 才注册；无 token 保持 inline 模式。 */
export async function installVaultCloudAdapter(): Promise<boolean> {
  await ensureSeafileLoaded();
  if (!getSeafileToken()) {
    registerVaultCloudAdapter(null);
    installed = false;
    return false;
  }
  if (!installed) registerVaultCloudAdapter(adapter);
  installed = true;
  void cleanupExpiredVaultShares().catch(() => undefined);
  return true;
}

export function vaultCloudConnected(): boolean {
  return installed;
}
