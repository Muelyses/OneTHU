import { t as i18n } from "../i18n/index.js";
/**
 * 暂存箱云盘适配器（Phase 2.2）：把清单传上清华云盘并生成分享链接；
 * 接收方通过匿名分享链接读回清单。不依赖自建后端。
 *
 * 目录口径：资料库 `OneTHU` → `/Vault/shares/<shareId>/manifest.json`，每个分享独立文件夹。
 * 撤销：删除分享链接；文件本体等引用计数/GC（transferQueue）落地后再清。
 * 未连接云盘不能生成新口令；接收公开分享不需要自己的云盘登录。
 */
import { invoke } from "@tauri-apps/api/core";
import { ensureOwnedCloudRepo } from "../lib/ownedCloudRepo.js";
import { assertRepoOwner, ensureSeafileLoaded, getSeafileToken, seafileShareDelete, seafileShareRead } from "./seafile.js";
import { isSealed, newShareKey, readShareKey, readSharedJson, sealBytes, unsealBytes, type ShareKey } from "./sealedShare.js";
import { bytesToBase64 } from "../lib/imageSave.js";
import {
  registerVaultCloudAdapter, type VaultCloudAdapter, type VaultCloudRef, type VaultSharePayload,
} from "./vaultShare.js";
import {
  expiredShareRefs, markShareRevoked, rememberShare, shareRefsSnapshot, unreferencedFilesOf, type ShareFileRef,
} from "./shareRefs.js";

interface ShareOut { link: string; token: string }

const REPO_NAME = "OneTHU";
const ROOT = "/Vault/shares";
const EXPIRE_DAYS = 7;

function tokenOrThrow(): string {
  const t = getSeafileToken();
  if (!t) throw new Error(i18n("state.vaultcloud.33798ae55697"));
  return t;
}

function shareId(): string {
  return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

async function ensureRepo(token: string): Promise<string> {
  const repo = await ensureOwnedCloudRepo(token, REPO_NAME);
  if (token !== getSeafileToken()) throw new Error(i18n("state.seafile.accountChanged"));
  return repo.id;
}

async function writeTemp(name: string, text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  return invoke<string>("write_temp_file", { name, dataBase64: bytesToBase64(bytes) });
}

/** 所有交换类型共用上传、七天分享与撤销记录。 */
async function uploadSharedManifest(token: string, repoId: string, dir: string, manifest: string, shareFiles: ShareFileRef[] = [], expireDays = EXPIRE_DAYS, keyRepoId?:string): Promise<VaultCloudRef> {
  const localPath = await writeTemp("manifest.json", manifest);
  const manifestPath = `${dir}/manifest.json`;
  await invoke("seafile_upload", { token, repoId, parentDir: dir, localPath, replace: true });
  let path = dir;
  try {
    const share = await invoke<ShareOut>("seafile_share", { token, repoId, path: dir, expireDays, password: "" });
    const expiresAt = expireDays > 0 ? Date.now() + expireDays * 24 * 3600 * 1000 : 0;
    rememberShare({ shareUrl: share.link, shareToken: share.token, repoId, path, manifestName: "manifest.json", files: shareFiles, expiresAt, keyRepoId });
    return { provider: "seafile", repoId, path, manifestName: "manifest.json", shareUrl: share.link, shareToken: share.token, expiresAt, keyRepoId };
  } catch (error) {
    if (shareFiles.length) throw new Error(i18n("state.vaultcloud.ac986af5f7b3", { value: String(String(error)) }));
    /* 目录分享被云盘策略拒绝：退化为分享清单文件（文件条目不可直接下载） */
    path = manifestPath;
  }
  const share = await invoke<ShareOut>("seafile_share", {
    token, repoId, path, expireDays, password: "",
  });
  const expiresAt = expireDays > 0 ? Date.now() + expireDays * 24 * 3600 * 1000 : 0;
  rememberShare({ shareUrl: share.link, shareToken: share.token, repoId, path: dir, manifestName: "manifest.json", files: shareFiles, expiresAt, keyRepoId });
  return { provider: "seafile", repoId, path, manifestName: "manifest.json", shareUrl: share.link, shareToken: share.token, expiresAt, keyRepoId };
}

export async function uploadExchangeManifest(code: string, expireDays = EXPIRE_DAYS, allowEmail?:string): Promise<VaultCloudRef> {
  await ensureSeafileLoaded();
  const token = tokenOrThrow();
  const repoId = await ensureRepo(token);
  const dir = `${ROOT}/${shareId()}`;
  await invoke("seafile_mkdir", { token, repoId, path: dir });
  const key=allowEmail?await newShareKey(token,allowEmail):undefined;
  const raw=JSON.stringify({v:1,kind:"onethu-exchange",code});
  try{return await uploadSharedManifest(token,repoId,dir,key?JSON.stringify(await sealBytes(new TextEncoder().encode(raw),key)):raw,[],expireDays,key?.repoId);}
  catch(e){
    if(key)await invoke("seafile_delete_repo",{token,repoId:key.repoId}).catch(()=>undefined);
    await invoke("seafile_delete",{token,repoId,path:dir,kind:"dir"}).catch(()=>undefined);
    throw e;
  }
}

/**
 * 稳定分享位（名片/组织邀请）专用：往已存在的分享目录覆盖 manifest。
 * 同一个短码永远指向最新内容——名片改了就地更新，不新建目录、不换口令，
 * 也不会每改一次就在云盘堆一个 manifest。分享被撤销/过期后调用方会改走新建。
 */
export async function updateExchangeManifest(repoId: string, dir: string, code: string, keyRepoId?:string): Promise<void> {
  await ensureSeafileLoaded();
  const token = tokenOrThrow();
  await assertRepoOwner(repoId);
  const raw=JSON.stringify({v:1,kind:"onethu-exchange",code});
  const key=keyRepoId?await readShareKey({v:1,kind:"onethu-sealed",keyRepoId,keyPath:"/key.json",iv:"",data:""}):undefined;
  const localPath = await writeTemp("manifest.json", key?JSON.stringify(await sealBytes(new TextEncoder().encode(raw),key)):raw);
  await invoke("seafile_upload", { token, repoId, parentDir: dir, localPath, replace: true });
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
    const key=payload.allowEmail?await newShareKey(token,payload.allowEmail):undefined;
    const filesDir = `${dir}/files`;
    const shareFiles: ShareFileRef[] = [];
    let filesReady = false;
    try {
    for (const it of cloud.items ?? []) {
      const f = it.file;
      if (!f) continue;
      let data: string;
      if (f.stagedPath) data = await invoke<string>("read_file_base64", { path:f.stagedPath, maxBytes:128*1024*1024 });
      else if (f.shareUrl && f.cloudPath) {
        const path = await materializeSharedFile({provider:"seafile",path:"",shareUrl:f.shareUrl,keyRepoId:f.shareKeyRepoId}, f.cloudPath, f.name);
        data = await invoke<string>("read_file_base64", {path,maxBytes:128*1024*1024});
      } else if (f.cloudPath?.startsWith("/")) {
        data = await invoke<string>("seafile_read_bytes", {token,repoId:f.cloudRepoId ?? repoId,path:f.cloudPath,maxBytes:128*1024*1024});
      } else throw new Error(i18n("state.vaultcloud.aae73c7a3e65", { name: String(f.name) }));
      if (!filesReady) {
        await invoke("seafile_mkdir", { token, repoId, path: filesDir });
        filesReady = true;
      }
      const safe = crypto.randomUUID()+ (key?".enc":"-"+f.name.replace(/[\\/:*?"<>|]+/g,"_").slice(0,120));
      const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));
      const output=key?new TextEncoder().encode(JSON.stringify(await sealBytes(bytes,key))):bytes;
      const localPath=await invoke<string>("write_temp_file",{name:safe,dataBase64:bytesToBase64(output)});
      await invoke("seafile_upload", { token, repoId, parentDir: filesDir, localPath, replace: true });
      f.cloudPath = `files/${safe}`;
      delete f.stagedPath;
      delete f.cloudRepoId;
      delete f.shareUrl;
      delete f.shareKeyRepoId;
      shareFiles.push({ hash: f.hash || safe, path: `files/${safe}` });
    }
    return await uploadSharedManifest(token,repoId,dir,key?JSON.stringify(await sealBytes(new TextEncoder().encode(JSON.stringify(cloud)),key)):JSON.stringify(cloud),shareFiles,EXPIRE_DAYS,key?.repoId);
    } catch (error) {
      if (key) await invoke("seafile_delete_repo", {token,repoId:key.repoId}).catch(() => undefined);
      await invoke("seafile_delete", {token,repoId,path:dir,kind:"dir"}).catch(() => undefined);
      throw error;
    }
  },

  async resolve(ref: VaultCloudRef): Promise<VaultSharePayload> {
    if (!ref.shareUrl) throw new Error(i18n("state.vaultcloud.124e692f8b2a"));
    const text = await seafileShareRead(ref.shareUrl, ref.manifestName ?? "manifest.json");
    const p = await readSharedJson(text) as VaultSharePayload;
    if (p?.kind !== "vault-share" || p.v !== 1) throw new Error(i18n("state.vaultcloud.8adb5a5068bc"));
    return p;
  },

  /** 就地覆盖同一个分享里的清单（改名 / 限定邮箱）；口令与分享链接都不变。 */
  async update(ref: VaultCloudRef, payload: VaultSharePayload): Promise<void> {
    const token = tokenOrThrow();
    if (!ref.repoId) throw new Error(i18n("state.vaultcloud.ccd9ad2a2fee"));
    await assertRepoOwner(ref.repoId);
    const manifest = JSON.stringify(payload);
    const key=ref.keyRepoId?await readShareKey({v:1,kind:"onethu-sealed",keyRepoId:ref.keyRepoId,keyPath:"/key.json",iv:"",data:""}):undefined;
    if(Boolean(payload.allowEmail)!==Boolean(key))throw new Error(i18n("state.vaultcloud.20e701b06a1a"));
    const localPath = await writeTemp("manifest.json", key?JSON.stringify(await sealBytes(new TextEncoder().encode(manifest),key)):manifest);
    /* 目录分享时 ref.path 是目录；退化成单文件分享时 path 指向 manifest.json，取父目录写回。 */
    const parentDir = /\/manifest\.json$/.test(ref.path) ? ref.path.replace(/\/manifest\.json$/, "") : ref.path;
    if (!parentDir) throw new Error(i18n("state.vaultcloud.6a07b0abd9b4"));
    await invoke("seafile_upload", { token, repoId: ref.repoId, parentDir, localPath, replace: true });
  },

  async revoke(ref: VaultCloudRef): Promise<void> {
    const st = ref.shareToken?.trim();
    if (!st) throw new Error(i18n("state.vaultcloud.21e554dce895"));
    const record = shareRefsSnapshot().refs.find((r) => r.shareUrl === ref.shareUrl || r.shareToken === st);
    const ownerRepo=ref.repoId??record?.repoId;
    if(!ownerRepo)throw new Error(i18n("state.vaultcloud.c71c20943dfd"));
    await assertRepoOwner(ownerRepo);
    // Remove key first: if the subsequent link deletion fails the content stays inaccessible.
    if(ref.keyRepoId ?? record?.keyRepoId){
      await invoke("seafile_delete_repo",{token:tokenOrThrow(),repoId:ref.keyRepoId??record?.keyRepoId});
    }
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
/** 把暂存箱里「已落本机、还没上云」的文件上传到 OneTHU 资料库 /Vault/cache 并回写 cloudPath。 */
export async function cacheVaultFiles(): Promise<{ ok: boolean; uploaded: number; reason?: string }> {
  await ensureSeafileLoaded();
  const token = getSeafileToken();
  if (!token) return { ok: false, uploaded: 0, reason: i18n("state.vaultcloud.notConnected") };
  const repoId = await ensureRepo(token);
  const cacheDir = "/Vault/cache";
  try { await invoke("seafile_mkdir", { token, repoId, path: cacheDir }); } catch { /* 已存在 */ }
  let uploaded = 0;
  const { vaultSnapshot, updateVaultItem } = await import("./vault.js");
  for (const box of vaultSnapshot().boxes) {
    for (const it of box.items) {
      const f = it.file;
      if (!f?.stagedPath || f.cloudPath) continue;
      const safe = (f.hash ? f.hash.slice(0, 8) + "-" : "") + f.name.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 120);
      try {
        const dataBase64=await invoke<string>("read_file_base64",{path:f.stagedPath,maxBytes:128*1024*1024});
        const localPath=await invoke<string>("write_temp_file",{name:safe,dataBase64});
        await invoke("seafile_upload", { token, repoId, parentDir: cacheDir, localPath, replace: true });
        updateVaultItem(it.id, { file: { ...f, cloudPath: `${cacheDir}/${safe}`, cloudRepoId:repoId, stagedPath: undefined } });
        uploaded += 1;
      } catch { /* 单个失败不拖垮其它 */ }
    }
  }
  return { ok: uploaded > 0, uploaded };
}

export async function cleanupExpiredVaultShares(): Promise<number> {
  const expired = expiredShareRefs();
  if (expired.length === 0) return 0;
  let n = 0;
  for (const r of expired) {
    try {
      await adapter.revoke({ provider: "seafile", repoId: r.repoId, path: r.path, manifestName: r.manifestName, shareUrl: r.shareUrl, shareToken: r.shareToken, expiresAt: r.expiresAt, keyRepoId:r.keyRepoId });
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

export async function materializeSharedFile(ref:VaultCloudRef,path:string,name:string):Promise<string>{
 if(!ref.shareUrl||!/^files\/[^/\\]{1,240}$/.test(path))throw new Error(i18n("state.vaultcloud.5ce19f9c3d3c"));
 const b64=await invoke<string>("seafile_share_read_bytes",{link:ref.shareUrl,path,maxBytes:180*1024*1024});
 let bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
 if(ref.keyRepoId){const envelope=JSON.parse(new TextDecoder().decode(bytes));if(!isSealed(envelope)||envelope.keyRepoId!==ref.keyRepoId)throw new Error(i18n("state.vaultcloud.bd2fb4465b55"));bytes=new Uint8Array(await unsealBytes(envelope));}
 return invoke<string>("write_temp_file",{name:name.replace(/[\\/:*?"<>|]+/g,"_").slice(0,120),dataBase64:bytesToBase64(bytes)});
}
