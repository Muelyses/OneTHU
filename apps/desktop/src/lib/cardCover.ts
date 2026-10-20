import { t as i18n } from "../i18n/index.js";
/**
 * 名片卡面图：存到清华云盘（OneTHU 资料库 /Cards/<name>.jpg）。
 *
 * 口径：卡片本体里的 cover.src 是**压缩后的 dataURL**（随名片口令一起带出去，
 * 对方不连云盘也能看到卡面）；云盘那份是「存到云盘」的备份/多设备来源，
 * 顺带生成一个不过期的分享链接（cloud.shareUrl）。云盘不可用时本地封面照常可用，
 * 调用方只提示「备份失败」。
 */
import { invoke } from "@tauri-apps/api/core";
import { ensureSeafileLoaded, getSeafileToken, refreshRepos } from "../state/seafile.js";
import { ensureOneThuRepo } from "./cloudFolder.js";

const CARDS_DIR = "/Cards";

export interface CardCoverCloud {
  repoId: string;
  path: string;
  shareUrl?: string;
}

/** 把卡面 dataURL 上传到云盘，返回云盘位置（分享链接尽力而为）。 */
export async function uploadCardCover(dataUrl: string): Promise<CardCoverCloud> {
  const b64 = String(dataUrl ?? "").split(",")[1] ?? "";
  if (!b64) throw new Error(i18n("lib.cardcover.63b5c0cc3a81"));
  await ensureSeafileLoaded();
  const token = getSeafileToken();
  if (!token) throw new Error(i18n("lib.cardcover.15e1ef41e215"));
  const repoId = await ensureOneThuRepo();
  await invoke("seafile_mkdir", { token, repoId, path: CARDS_DIR });
  const name = "cover-" + Date.now().toString(36) + ".jpg";
  const localPath = await invoke<string>("write_temp_file", { name, dataBase64: b64 });
  await invoke("seafile_upload", { token, repoId, parentDir: CARDS_DIR, localPath, replace: true });
  let shareUrl: string | undefined;
  try {
    const share = await invoke<{ link: string }>("seafile_share", {
      token, repoId, path: `${CARDS_DIR}/${name}`, expireDays: 0, password: "",
    });
    shareUrl = share.link || undefined;
  } catch {
    /* 单文件分享可能被云盘策略拒绝：没有链接也不影响备份本身 */
  }
  void refreshRepos().catch(() => undefined);
  return { repoId, path: `${CARDS_DIR}/${name}`, ...(shareUrl ? { shareUrl } : {}) };
}

/** 删除云盘上的旧卡面（换图/移除封面时尽力清理，不阻塞本地操作）。 */
export async function deleteCardCover(cloud: CardCoverCloud | undefined): Promise<void> {
  if (!cloud?.repoId || !cloud.path) return;
  await ensureSeafileLoaded();
  const token = getSeafileToken();
  if (!token) return;
  await invoke("seafile_delete", { token, repoId: cloud.repoId, path: cloud.path, kind: "file" }).catch(() => undefined);
}
