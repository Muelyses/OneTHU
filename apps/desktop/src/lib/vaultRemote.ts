import { t as i18n, msg as i18nMsg } from "../i18n/index.js";
/**
 * 远端内容的「拖进暂存箱 = 自动缓存」：
 *  - 云盘文件 / 课程与新闻附件：先把字节下到本机（seafile_download / downloadLearnUrl），
 *    算 SHA-256 后写回暂存箱条目，再尽力上传到暂存箱云盘（/Vault/cache）；
 *  - 日程：拖入只是快照，点开时再问「要不要加进我的日程」（vaultRegistry 调用）。
 */
import { invoke } from "@tauri-apps/api/core";
import { seafileDownload } from "../state/seafile.js";
import { downloadLearnUrl } from "./clients.js";
import { updateVaultItem, type VaultCatch } from "../state/vault.js";
import { cacheVaultFiles } from "../state/vaultCloud.js";
import { showToast } from "../state/toast.js";

const MIME: Record<string, string> = {
  txt: "text/plain", md: "text/markdown", json: "application/json", csv: "text/csv",
  pdf: "application/pdf", zip: "application/zip", rar: "application/vnd.rar", "7z": "application/x-7z-compressed",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  mp4: "video/mp4", mp3: "audio/mpeg",
};
function mimeOf(name: string): string {
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  return MIME[ext] ?? "application/octet-stream";
}
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer.slice(0) as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 把远端文件下载进暂存箱，并尽力缓存到云盘。 */
export async function cacheRemoteFileToVault(itemId: string, remote: NonNullable<VaultCatch["remote"]>, title: string): Promise<void> {
  try {
    let localPath = "";
    if (remote.kind === "seafile" && remote.repoId && remote.path) {
      localPath = await seafileDownload(remote.repoId, remote.path);
    } else if (remote.url) {
      localPath = await downloadLearnUrl(remote.url, title);
    }
    if (!localPath) throw new Error(i18n("lib.vaultremote.b97fee010675"));
    const b64 = await invoke<string>("read_file_base64", { path: localPath, maxBytes: 512 * 1024 * 1024 });
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const hash = await sha256Hex(bytes);
    updateVaultItem(itemId, {
      file: { name: title, size: bytes.byteLength, mime: mimeOf(title), hash, cloudPath: null, stagedPath: localPath },
      sub: i18n("lib.vaultremote.ffccb4633b09", { byteLength: String(bytes.byteLength) }),
    });
    const cached = await cacheVaultFiles();
    showToast(cached.ok ? i18n("lib.vaultremote.0e41e88fae37", { title: title }) : i18n("lib.vaultremote.c2ffc377da9f", { error: cached.reason ?? i18n("lib.vaultremote.7b0fe85cc2ee") }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    showToast(i18nMsg("lib.vaultremote.b4a5cedce0c2", { value: String(msg.slice(0, 60)) }));
  }
}

/** 暂存箱里的日程快照：问一次要不要加进「我的日程」。 */
export async function offerScheduleToCalendar(payload: { title?: string; date?: string; startMs?: number; endMs?: number; location?: string; note?: string }): Promise<void> {
  const { confirmChoice } = await import("./confirm.js");
  const start = Number(payload.startMs) || (payload.date ? Date.parse(payload.date + "T09:00:00") : Date.now());
  const end = Number(payload.endMs) || start + 3600_000;
  const ok = await confirmChoice(i18nMsg("lib.vaultremote.1af4dc2d2c3a"), {
    title: i18nMsg("lib.vaultremote.9c896aad088b"),
    confirmText: i18nMsg("lib.vaultremote.75085b8b6e3c"),
    cancelText: i18nMsg("lib.vaultremote.7092111f462a"),
  });
  if (!ok) return;
  try {
    const { putLocalEvent } = await import("../state/cloudCal.js");
    await putLocalEvent({
      uid: "evt." + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      summary: String(payload.title ?? "日程"),
      start,
      end,
      location: payload.location || undefined,
      onethuSource: "manual",
    } as never);
    showToast(i18nMsg("lib.vaultremote.af6eec38ad8b"));
  } catch (e) {
    showToast(i18nMsg("lib.vaultremote.759687a48a96", { value: String(e instanceof Error ? e.message : String(e)) }));
  }
}
