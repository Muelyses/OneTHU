/**
 * 云盘目录/分享小工具（组织空间、好友共享云盘共用）。
 * 只做「确保资料库/目录 → 上传一个说明文件 → 分享」；失败如实抛错，调用方决定降级。
 */
import { invoke } from "@tauri-apps/api/core";
import { ensureSeafileLoaded, getSeafileToken } from "../state/seafile.js";

interface Repo { id: string; name: string }
export interface CloudShare { repoId: string; path: string; shareUrl: string; shareToken: string; expiresAt: number }

export async function ensureOneThuRepo(): Promise<string> {
  await ensureSeafileLoaded();
  const token = getSeafileToken();
  if (!token) throw new Error("清华云盘未连接：先到云盘页粘贴 token");
  const repos = await invoke<Repo[]>("seafile_repos", { token });
  const hit = repos.find((r) => r.name === "OneTHU");
  if (hit) return hit.id;
  await invoke("seafile_create_repo", { token, name: "OneTHU" });
  const again = await invoke<Repo[]>("seafile_repos", { token });
  const made = again.find((r) => r.name === "OneTHU");
  if (!made) throw new Error("创建 OneTHU 资料库失败");
  return made.id;
}

async function writeTemp(name: string, text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const b64 = btoa([...bytes].map((b) => String.fromCharCode(b)).join(""));
  return invoke<string>("write_temp_file", { name, dataBase64: b64 });
}

/** 建目录 + 放一个 README + 分享目录；目录分享被禁时退化为分享 README 文件。 */
export async function prepareAndShareFolder(path: string, title: string, expireDays = 7): Promise<CloudShare> {
  await ensureSeafileLoaded();
  const token = getSeafileToken();
  if (!token) throw new Error("清华云盘未连接：先到云盘页粘贴 token");
  const repoId = await ensureOneThuRepo();
  const dir = path.startsWith("/") ? path : `/${path}`;
  await invoke("seafile_mkdir", { token, repoId, path: dir });
  const readme = `${title}\n\n由 OneTHU 创建；加入后把文件/作业/分享口令放在这个文件夹里。\n`;
  const local = await writeTemp("onethu-readme.txt", readme);
  const readmePath = `${dir}/README.txt`;
  await invoke("seafile_upload", { token, repoId, parentDir: dir, localPath: local, replace: true });
  let path_ = dir;
  try {
    const share = await invoke<{ link: string; token: string }>("seafile_share", { token, repoId, path: dir, expireDays, password: "" });
    return { repoId, path: dir, shareUrl: share.link, shareToken: share.token, expiresAt: Date.now() + expireDays * 86400_000 };
  } catch {
    /* 目录分享可能被云盘策略拒绝：退化为分享说明文件 */
    path_ = readmePath;
  }
  const share = await invoke<{ link: string; token: string }>("seafile_share", { token, repoId, path: path_, expireDays, password: "" });
  return { repoId, path: dir, shareUrl: share.link, shareToken: share.token, expiresAt: Date.now() + expireDays * 86400_000 };
}
