/**
 * 壁纸云盘同步（清华云盘「OneTHU/壁纸」，2026-10-13）。
 *
 * 落点定案（与 memory/sync.ts 的《OH-Memory》同款模式）：专用资料库《OneTHU》没有就
 * 自动建（seafile_create_repo，建完按名复查），库内固定目录 /壁纸，档案固定
 * onethu-wallpaper.json——用户视角即云盘里的「OneTHU/壁纸」。repo id 按
 * onethu.wallpaper.repo.v1 缓存，失效后按名自愈。
 *
 * 档案 = 整份壁纸文档（含库内图片/视频 dataURL）JSON 序列化；恢复 = 下载后过
 * sanitize 整档替换本地。上传走 write_temp_file（JS 字节 → 临时文件路径），
 * 下载走 seafile_read_bytes（内存 base64，不落盘不弹下载目录）。
 * 云盘未连接直接给可操作文案；其余失败不静默吞——toast 说明并请用户重试。
 * 声音开关是本机偏好，不随档案同步。
 */
import { invoke } from "@tauri-apps/api/core";
import { ensureSeafileLoaded, getSeafileToken } from "./seafile.js";
import { replaceWallpaperDoc, wallpaperSnapshot } from "./wallpaper.js";

const REPO_NAME = "OneTHU";
const DIR = "/壁纸";
const FILE = "onethu-wallpaper.json";
const REPO_KEY = "onethu.wallpaper.repo.v1";
/** 档案大小防线：12 张 12MB 视频（base64 后 ~192MB）理论极限，取整放宽到 256MB */
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;

export interface WallpSyncResult {
  ok: boolean;
  msg: string;
}

async function cloudToken(): Promise<string | null> {
  try {
    await ensureSeafileLoaded();
  } catch {
    /* 配置读不到 = 未连接 */
  }
  return getSeafileToken() || null;
}

/** 找到（或建出）《OneTHU》资料库；建库响应形态不一，建后无论如何按名复查 */
async function ensureRepo(tk: string): Promise<string> {
  try {
    const cached = localStorage.getItem(REPO_KEY);
    if (cached) {
      const repos = await invoke<Array<{ id: string; name: string }>>("seafile_repos", { token: tk });
      if (repos.some((r) => r.id === cached)) return cached;
    }
  } catch {
    /* 缓存失效走全量查找 */
  }
  const repos = await invoke<Array<{ id: string; name: string }>>("seafile_repos", { token: tk });
  let repo = repos.find((r) => r.name === REPO_NAME);
  if (!repo) {
    await invoke("seafile_create_repo", { token: tk, name: REPO_NAME }).catch(() => undefined);
    const repos2 = await invoke<Array<{ id: string; name: string }>>("seafile_repos", { token: tk });
    repo = repos2.find((r) => r.name === REPO_NAME);
  }
  if (!repo) throw new Error("OneTHU 资料库没有建出来");
  try {
    localStorage.setItem(REPO_KEY, repo.id);
  } catch {
    /* 存不进就每次重查 */
  }
  return repo.id;
}

/** UTF-8 字符串 → base64（write_temp_file 吃 base64；分块拼接避免栈溢出） */
function utf8ToB64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CH));
  }
  return btoa(bin);
}

function b64ToText(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** 上传整份壁纸文档到云盘「OneTHU/壁纸/onethu-wallpaper.json」（replace 覆写） */
export async function syncWallpaperToCloud(): Promise<WallpSyncResult> {
  const tk = await cloudToken();
  if (!tk) return { ok: false, msg: "云盘还没连接：先到「云盘」页连接后再同步" };
  try {
    const repoId = await ensureRepo(tk);
    const json = JSON.stringify(wallpaperSnapshot());
    const localPath = await invoke<string>("write_temp_file", {
      name: FILE,
      dataBase64: utf8ToB64(json),
    });
    await invoke("seafile_mkdir", { token: tk, repoId, path: DIR }).catch(() => undefined);
    await invoke("seafile_upload", {
      token: tk,
      repoId,
      parentDir: DIR,
      localPath,
      replace: true,
    });
    return { ok: true, msg: "壁纸已同步到云盘" };
  } catch (e) {
    return { ok: false, msg: `同步没成功（${shortErr(e)}），请检查云盘后再试` };
  }
}

/** 从云盘下载档案并整档应用（覆盖本地的壁纸与库） */
export async function restoreWallpaperFromCloud(): Promise<WallpSyncResult> {
  const tk = await cloudToken();
  if (!tk) return { ok: false, msg: "云盘还没连接：先到「云盘」页连接后再恢复" };
  try {
    const repoId = await ensureRepo(tk);
    const b64 = await invoke<string>("seafile_read_bytes", {
      token: tk,
      repoId,
      path: `${DIR}/${FILE}`,
      maxBytes: MAX_ARCHIVE_BYTES,
    });
    const parsed: unknown = JSON.parse(b64ToText(b64));
    if (!replaceWallpaperDoc(parsed)) {
      return { ok: false, msg: "云盘上的壁纸档案读不出来，请先重新同步一次" };
    }
    return { ok: true, msg: "已恢复云盘壁纸" };
  } catch (e) {
    const raw = shortErr(e);
    if (/404|不存在|not found/i.test(raw)) {
      return { ok: false, msg: "云盘上还没有壁纸档案，请先在别的设备同步一次" };
    }
    return { ok: false, msg: `恢复没成功（${raw}），请检查云盘后再试` };
  }
}

function shortErr(e: unknown): string {
  const s = e instanceof Error ? e.message : String(e);
  return s.replace(/\s+/g, " ").slice(0, 60) || "原因不明";
}
