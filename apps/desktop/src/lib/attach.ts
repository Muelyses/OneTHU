/**
 * 附件入口（需求 6/8）：拍照 / 相册 / 上传 → 统一成 AttachFile → 交给 OH。
 *
 * ## 取件走哪条路（2026-10-10 与 Lead 对齐后的结论）
 * **主路径是 WebView 自带的隐藏 `<input type=file>`**，与仓库既有做法一致
 * （`pages/learn/AssignmentDetailPage.tsx` 的通用附件 + 安卓拍照、ChatDock 的会话导入）：
 *   - 拍照：`accept="image/*" capture="environment"` → 安卓直接进相机，拍完回到应用；
 *   - 相册：`accept="image/*"` 不带 capture → 安卓出图片选择器（Android 13+ 是系统相册
 *     选择器），桌面出图片文件选择框；
 *   - 上传：桌面（Tauri）走系统文件对话框（`@tauri-apps/plugin-dialog`，任意类型、可多选），
 *     其余环境走 `<input type=file multiple>`。
 * 原生 Kotlin 取件桥（ACTION_IMAGE_CAPTURE / ACTION_PICK / ACTION_OPEN_DOCUMENT）**本轮不做**：
 * 系统悬浮层（非 Activity）里的 WebView 能不能弹 file chooser 还没上真机验证过，
 * 先不写一条用不上的原生通道。该缺口已列进交付报告。
 *
 * ## 关于 path
 * 走 `<input>` 拿到的只有浏览器 File 对象，**WebView 给不出文件系统路径**。此时 `path` 是空串，
 * 字节经 `fileToBytes()`（File.arrayBuffer，不落盘）取。只有原生侧给的路径（桌面文件对话框、
 * 安卓原生桥将来落地）才有真路径。
 *
 * ## 关于 OH
 * OH 目前**不是多模态**：harness 只吃 `{command:"chat", input:string}`。所以 `sendToOh()`
 * 把「附件就绪 + 名称/类型/大小/本地路径 + 文本类附件的内容预览」拼成一段文本发给它，
 * **不是**把图片喂给模型（别误会成打通了看图）。要真正看图得等 harness 支持图片输入。
 */
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./transport.js";
import { isAndroidNavigator } from "./androidHost.js";
import { askOh } from "../im/oh.js";
import { bytesToBase64, splitDataUrl } from "./imageSave.js";
import { logLine } from "./clients.js";

/** 一份待发送的附件 */
export interface AttachFile {
  /** 本地绝对路径；空串 = 只有内存里的 File（WebView 选择器给不出路径，见文件头） */
  path: string;
  name: string;
  mime: string;
  /** 字节数（拿不到时 0） */
  size: number;
  /** 图片预览地址（objectURL 或 dataURL）；非图片不设 */
  previewUrl?: string;
  /** 选择器给的原始 File（字节不落盘）。fileToBytes() 优先用它 */
  file?: File;
}

export interface PickOptions {
  /** 多选（上传入口用；拍照/相册默认单选） */
  multiple?: boolean;
}

/** 读盘上限（与主 crate `read_file_base64` 的默认值一致：64MB） */
export const MAX_READ_BYTES = 64 * 1024 * 1024;

/** 文本类附件的内容预览长度（超过就截断，别把 OH 的输入塞爆） */
const PREVIEW_CHARS = 1200;

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
  webp: "image/webp", bmp: "image/bmp", heic: "image/heic", heif: "image/heif",
  avif: "image/avif", svg: "image/svg+xml", tif: "image/tiff", tiff: "image/tiff",
  pdf: "application/pdf", zip: "application/zip", "7z": "application/x-7z-compressed",
  rar: "application/vnd.rar", tar: "application/x-tar", gz: "application/gzip",
  txt: "text/plain", md: "text/markdown", csv: "text/csv", json: "application/json",
  xml: "application/xml", html: "text/html", htm: "text/html", yml: "text/yaml",
  yaml: "text/yaml", log: "text/plain", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|jsonl|log|xml|html?|ya?ml|ts|tsx|js|jsx|mjs|cjs|py|rs|c|cc|cpp|h|hpp|java|kt|go|sh|bash|zsh|sql|ini|toml|conf|cfg|tex|srt|vtt)$/i;

/** 造 AttachFile 时要用的文件名后缀表（dataURL → File 用） */
export function extForMime(mime: string): string {
  const lower = (mime || "").toLowerCase();
  if (lower === "image/png") return "png";
  if (lower === "image/webp") return "webp";
  if (lower === "image/gif") return "gif";
  if (lower === "image/jpeg" || lower === "image/jpg") return "jpg";
  if (lower === "application/pdf") return "pdf";
  const sub = lower.startsWith("image/") ? lower.slice(6).replace(/[^a-z0-9]/g, "") : "";
  return sub || "bin";
}

export function mimeFromName(name: string): string {
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  return MIME_BY_EXT[ext] ?? "";
}

export function baseName(pathOrName: string): string {
  return pathOrName.split(/[/\\]/).pop() || pathOrName;
}

/** 人读的文件大小（沿用 im/mediaPipe.ts 的写法） */
export function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return "大小未知";
  if (bytes >= 1024 * 1024) return `${(bytes / 1048576).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

function isAndroidHost(): boolean {
  return isAndroidNavigator(typeof navigator !== "undefined" ? navigator : undefined);
}

/** 有没有取件界面（浏览器预览也算有；只在无 DOM 的环境才没有） */
export function attachPickersAvailable(): boolean {
  return typeof document !== "undefined" || isTauri;
}

/* ══════════ 取件：WebView input（主路径） ══════════ */

interface InputPickSpec {
  accept?: string;
  /** 安卓相机前后摄；桌面内核会忽略它 */
  capture?: "environment" | "user";
  multiple?: boolean;
}

/** 点一次隐藏 input，等用户选完。返回 File[]；用户取消 / 一直没回来给 null */
function pickViaInput(spec: InputPickSpec): Promise<File[] | null> {
  if (typeof document === "undefined") {
    return Promise.reject(new Error("当前环境没有取件界面，请在应用内操作"));
  }
  const input = document.createElement("input");
  input.type = "file";
  if (spec.accept) input.accept = spec.accept;
  if (spec.multiple) input.multiple = true;
  if (spec.capture) input.setAttribute("capture", spec.capture);
  // 放屏幕外而不是 display:none —— 个别老内核不给 display:none 的元素弹选择器
  input.style.position = "fixed";
  input.style.left = "-10000px";
  input.style.top = "0";
  input.style.width = "1px";
  input.style.height = "1px";
  input.style.opacity = "0";
  document.body.appendChild(input);

  return new Promise<File[] | null>((resolve) => {
    let settled = false;
    const finish = (files: File[] | null): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(hardTimer);
      input.removeEventListener("change", onChange);
      input.removeEventListener("cancel", onCancel);
      window.removeEventListener("focus", onFocus);
      input.remove();
      resolve(files);
    };
    const onChange = (): void => finish(Array.from(input.files ?? []));
    const onCancel = (): void => finish(null);
    // 老内核（Chromium <113 / 旧 WKWebView）没有 cancel 事件：窗口重新获得焦点后
    // 若 input.files 仍为空，就认定是取消。留 1.6s 缓冲，避免「change 还没到就先判取消」。
    const onFocus = (): void => {
      window.setTimeout(() => {
        if (!settled && (!input.files || input.files.length === 0)) finish(null);
      }, 1600);
    };
    // 硬上限：极端情况下（选择器被系统吞掉、既不 change 也不 focus）也不能永远挂着
    const hardTimer = window.setTimeout(() => finish(null), 5 * 60 * 1000);
    input.addEventListener("change", onChange);
    input.addEventListener("cancel", onCancel);
    window.addEventListener("focus", onFocus);
    input.click();
  });
}

/** File[] → AttachFile[]（挂 previewUrl 给图片；objectURL 记得用 releaseAttachPreviews 回收） */
export function filesToAttach(files: File[]): AttachFile[] {
  return files.map((f) => {
    const name = f.name || `附件-${Date.now()}`;
    const mime = f.type || mimeFromName(name) || "application/octet-stream";
    const out: AttachFile = { path: "", name, mime, size: f.size, file: f };
    if (mime.startsWith("image/")) out.previewUrl = URL.createObjectURL(f);
    return out;
  });
}

/** 挂载方卸载时回收 objectURL（不回收就是内存泄漏，长会话里很可观） */
export function releaseAttachPreviews(files: AttachFile[]): void {
  for (const f of files) {
    if (f.previewUrl && f.previewUrl.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(f.previewUrl);
      } catch {
        /* 已回收/不可回收：忽略 */
      }
    }
  }
}

/** 拍照（安卓进相机；桌面 = 图片文件选择框，内核忽略 capture） */
export async function pickCamera(): Promise<AttachFile | null> {
  const files = await pickViaInput({ accept: "image/*", capture: "environment" });
  return files && files.length > 0 ? filesToAttach(files)[0] ?? null : null;
}

/** 相册（安卓出图片选择器；桌面出图片文件框） */
export async function pickGallery(opts: PickOptions = {}): Promise<AttachFile | null> {
  const files = await pickViaInput({ accept: "image/*", multiple: opts.multiple });
  return files && files.length > 0 ? filesToAttach(files)[0] ?? null : null;
}

/* ══════════ 取件：系统文件对话框（桌面 Tauri 的「上传」） ══════════ */

async function pickPathsViaDialog(multiple: boolean): Promise<string[] | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const sel = multiple
    ? await open({ multiple: true, directory: false, title: "选择文件" })
    : await open({ multiple: false, directory: false, title: "选择文件" });
  if (!sel) return null;
  return Array.isArray(sel) ? sel : [sel];
}

/** 由本地路径造 AttachFile（大小走 im_stat_file；mime 按扩展名猜，猜不到留空） */
export async function attachFromPath(path: string, name?: string): Promise<AttachFile> {
  const finalName = name ?? baseName(path);
  let size = 0;
  if (isTauri) {
    try {
      size = (await invoke<number | null>("im_stat_file", { path })) ?? 0;
    } catch {
      size = 0;
    }
  }
  return { path, name: finalName, mime: mimeFromName(finalName), size };
}

/** 上传（单选）。桌面 Tauri 走系统对话框；安卓/浏览器走 input（安卓系统文件选择器） */
export async function pickFile(): Promise<AttachFile | null> {
  const many = await pickFiles();
  return many[0] ?? null;
}

/** 上传（可多选，返回数组版本；取消给空数组） */
export async function pickFiles(opts: PickOptions = {}): Promise<AttachFile[]> {
  const multiple = opts.multiple ?? true;
  if (isTauri && !isAndroidHost()) {
    const paths = await pickPathsViaDialog(multiple);
    if (!paths) return [];
    return await Promise.all(paths.map((p) => attachFromPath(p)));
  }
  const files = await pickViaInput({ multiple });
  return files ? filesToAttach(files) : [];
}

/* ══════════ 字节 ══════════ */

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * 附件 → 字节。两条路：
 *  ① `<input>` 选来的 File：直接 File.arrayBuffer()，不落盘、不过桥；
 *  ② 只有路径（桌面对话框 / 原生桥）：走主 crate 的 `read_file_base64(path, maxBytes)`
 *     —— **依赖 Lead 新增的命令**（`src-tauri/src/lib.rs`，默认 64MB 上限）。
 */
export async function fileToBytes(f: AttachFile, maxBytes = MAX_READ_BYTES): Promise<Uint8Array<ArrayBuffer>> {
  if (f.file) return new Uint8Array(await f.file.arrayBuffer());
  if (f.path && isTauri) {
    const b64 = await invoke<string>("read_file_base64", { path: f.path, maxBytes });
    return base64ToBytes(b64);
  }
  throw new Error("这份附件读不到内容，请重新选择文件");
}

/** 附件 → Blob（图片编辑、上传动作都吃 Blob） */
export async function fileToBlob(f: AttachFile): Promise<Blob> {
  if (f.file) return f.file;
  const src = f.previewUrl ?? "";
  if (src.startsWith("blob:") || src.startsWith("http")) {
    return await (await fetch(src)).blob();
  }
  if (src.startsWith("data:")) {
    const parsed = splitDataUrl(src);
    if (parsed) return new Blob([base64ToBytes(parsed.base64)], { type: parsed.mime });
  }
  const bytes = await fileToBytes(f);
  return new Blob([bytes], { type: f.mime || "application/octet-stream" });
}

/** dataURL → AttachFile（滤镜出图用）。**没有 path**：内容已被改写，原路径指向未编辑的文件 */
export function attachFromDataUrl(dataUrl: string, name: string, size = 0): AttachFile {
  const parsed = splitDataUrl(dataUrl);
  const mime = parsed?.mime ?? "image/jpeg";
  const bytes = parsed ? base64ToBytes(parsed.base64) : new Uint8Array();
  const file = new File([bytes], name, { type: mime });
  return { path: "", name, mime, size: size || file.size, previewUrl: dataUrl, file };
}

/** 字节 → dataURL（要交给画布/预览的地方用） */
export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  return `data:${mime || "application/octet-stream"};base64,${bytesToBase64(bytes)}`;
}

/* ══════════ 交给 OH ══════════ */

/** 宿主接管发送（悬浮面板/对话面板要把气泡渲染进自己的消息流时用）。
 *  不设 = 走默认通道：`askOh()`（纯前端，不打开任何窗口），回复只落日志。 */
export type OhAttachSender = (message: string, files: AttachFile[], text?: string) => Promise<string | void>;

let ohSender: OhAttachSender | null = null;

/** 注册/清空宿主发送器（传 null 恢复默认通道） */
export function setOhSender(fn: OhAttachSender | null): void {
  ohSender = fn;
}

function isTextLike(f: AttachFile): boolean {
  if (f.mime.startsWith("image/")) return false;
  return f.mime.startsWith("text/") || /json|xml|csv|yaml|javascript|typescript|markdown/i.test(f.mime) || TEXT_EXT.test(f.name);
}

/** 文本类附件的内容预览（读不到就 null，绝不编） */
async function previewOf(f: AttachFile): Promise<string | null> {
  try {
    if (!isTextLike(f)) return null;
    if (f.file) {
      const head = await f.file.slice(0, 256 * 1024).text();
      const cut = head.slice(0, PREVIEW_CHARS).trim();
      return cut || null;
    }
    if (f.path && isTauri) {
      const text = await invoke<string | null>("im_peek_text", { path: f.path, maxLen: PREVIEW_CHARS, clean: true });
      return (text ?? "").trim() || null;
    }
  } catch {
    /* 预览失败不影响发送：附件本身还能用 */
  }
  return null;
}

/** 拼「附件就绪」那条文本消息（纯函数 + 一次文本预览读盘；导出是为了可测/可复用） */
export async function buildOhMessage(files: AttachFile[], text?: string): Promise<string> {
  const parts: string[] = [];
  const head = (text ?? "").trim();
  if (head) parts.push(head);
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (!f) continue;
    const lines = [
      `【附件 ${i + 1}/${files.length}】${f.name}`,
      `类型 ${f.mime || "未知"} · 大小 ${formatSize(f.size)}${f.path ? ` · 本地路径 ${f.path}` : " · 尚未落盘"}`,
    ];
    const preview = await previewOf(f);
    if (preview) lines.push(`内容预览：\n${preview}`);
    parts.push(lines.join("\n"));
  }
  parts.push(
    "【附件说明】以上为设备本地文件，仅名称/类型/大小随消息带出（图片内容不会上传）。需要处理请告知：转存云盘 / 交作业 / 发讨论区。",
  );
  return parts.join("\n\n");
}

/**
 * 把附件作为**一条完整消息**交给 OH（需求 6）。
 * 默认通道 `askOh()`：纯前端、不打开任何窗口（悬浮层红线）；宿主若想让消息出现在自己的
 * 对话流里，先 `setOhSender()` 注入自己的发送函数（或给 AttachTray 传 onPicked）。
 */
export async function sendToOh(files: AttachFile[], text?: string): Promise<void> {
  if (files.length === 0) {
    void logLine("[附件] 没有附件可发送，已跳过").catch(() => undefined);
    return;
  }
  const message = await buildOhMessage(files, text);
  const sender = ohSender;
  if (sender) {
    await sender(message, files, text);
    return;
  }
  const r = await askOh(message);
  if (r.error) throw new Error(r.error);
  void logLine(`[附件] 已交给 OH：${files.length} 个文件${r.answer ? `，回复 ${String(r.answer).slice(0, 60)}` : ""}`).catch(
    () => undefined,
  );
}
