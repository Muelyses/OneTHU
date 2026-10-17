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
    const manifest = JSON.stringify(payload);
    const localPath = await writeTemp(`onethu-vault-${id}.json`, manifest);
    const path = `${dir}/manifest.json`;
    await invoke("seafile_upload", { token, repoId, parentDir: dir, localPath, replace: true });
    const share = await invoke<ShareOut>("seafile_share", {
      token, repoId, path, expireDays: EXPIRE_DAYS, password: "",
    });
    const expiresAt = Date.now() + EXPIRE_DAYS * 24 * 3600 * 1000;
    return { provider: "seafile", repoId, path, shareUrl: share.link, shareToken: share.token, expiresAt };
  },

  async resolve(ref: VaultCloudRef): Promise<VaultSharePayload> {
    if (!ref.shareUrl) throw new Error("这条云分享口令没有分享链接");
    const text = await seafileShareRead(ref.shareUrl);
    const p = JSON.parse(text) as VaultSharePayload;
    if (p?.kind !== "vault-share" || p.v !== 1) throw new Error("云盘清单格式不受支持");
    return p;
  },

  async revoke(ref: VaultCloudRef): Promise<void> {
    const st = ref.shareToken?.trim();
    if (!st) throw new Error("没有可撤销的分享 token");
    await seafileShareDelete(st);
  },
};

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
  return true;
}

export function vaultCloudConnected(): boolean {
  return installed;
}
