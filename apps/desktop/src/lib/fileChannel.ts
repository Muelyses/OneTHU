/**
 * 统一文件通道（Phase 2.1，暂存箱先落地「取件 → 哈希 → 暂存」这一段）。
 *
 * 口径（docs/research/2026-10-18-seafile-vault-capabilities.md）：
 * - 所有入口（文件选择、以后 OS 拖放/剪贴板/分享面板/云盘）都先 stage 成本结构；
 * - stage 时算 SHA-256（去重键），字节落本地暂存（Tauri 下 write_temp_file；纯浏览器只留内存）；
 * - 上传/分享/清理由后续 transferQueue + vaultCloud 接管，页面不许直接调 seafile_upload。
 */
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./transport.js";
import { pickFiles, fileToBytes, type AttachFile } from "./attach.js";
import { bytesToBase64 } from "./imageSave.js";

export interface StagedFile {
  id: string;
  name: string;
  mime: string;
  size: number;
  /** 内容 SHA-256（64 hex）；同一文件在不同入口得到同一个值 */
  sha256: string;
  /** 本地暂存绝对路径；纯浏览器/写盘失败时为空串（仍可入箱，上传前再取字节） */
  localPath: string;
  createdAt: number;
}

function newId(): string {
  return "sf." + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("当前环境没有 WebCrypto，无法计算文件指纹");
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 内存 File/AttachFile → 暂存结构（哈希 + 可选落盘）。 */
export async function stageFile(f: AttachFile): Promise<StagedFile> {
  const bytes = await fileToBytes(f);
  const sha256 = await sha256Hex(bytes);
  let localPath = f.path;
  if (!localPath && isTauri) {
    try {
      localPath = await invoke<string>("write_temp_file", { name: f.name, dataBase64: bytesToBase64(bytes) });
    } catch {
      localPath = "";
    }
  }
  return { id: newId(), name: f.name, mime: f.mime, size: f.size || bytes.byteLength, sha256, localPath, createdAt: Date.now() };
}

/** 系统文件选择（桌面对话框 / 浏览器 file input，复用附件入口的既有实现）。 */
export async function stageFromPicker(multiple = true): Promise<StagedFile[]> {
  const picked = await pickFiles({ multiple });
  const out: StagedFile[] = [];
  for (const f of picked) out.push(await stageFile(f));
  return out;
}

/** 直接给 File[]（OS 拖放/剪贴板/Android 分享面板以后都走这里）。 */
export async function stageFromFiles(files: File[], prefix = ""): Promise<StagedFile[]> {
  const out: StagedFile[] = [];
  for (const f of files) {
    const mime = f.type || "application/octet-stream";
    out.push(await stageFile({ path: "", name: prefix + f.name, mime, size: f.size, file: f }));
  }
  return out;
}

/** 暂存文件转成暂存箱文件引用（不复制字节；hash 是唯一去重键）。 */
export function fileRefOf(s: StagedFile): { name: string; size: number; mime: string; hash: string; cloudPath: null; stagedPath: string } {
  return { name: s.name, size: s.size, mime: s.mime, hash: s.sha256, cloudPath: null, stagedPath: s.localPath };
}
