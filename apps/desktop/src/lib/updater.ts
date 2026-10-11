/**
 * 应用更新（清华云盘）——清单读取 / 版本比较 / 下载编排 / 拉起安装页。
 *
 * ## 数据源
 * 云盘固定路径 `<repo>/OneTHU/release/latest.json`（可用 `dir` 覆盖）。清单形状：
 * ```json
 * {
 *   "version": "0.9.2",              // 必填：版本号（与 __APP_VERSION__ 同口径比较）
 *   "minVersion": "0.9.0",           // 可选：低于它的版本必须更新（UI 会提示，不强制）
 *   "url": "OneTHU/release/OneTHU-0.9.2.dmg",   // 安装包在云盘上的路径（或 http(s) 直链）
 *   "size": 91234567,                // 可选：字节数（下载后校验，不符即报错）
 *   "sha256": "…",                   // 可选：本轮**仅展示**（Rust 侧无哈希依赖，未校验，见报告）
 *   "notes": "更新说明（纯文本/markdown 均按纯文本显示）",
 *   "releasedAt": "2026-10-12",
 *   "assets": {                      // 可选：分平台包，覆盖上面的 url/size
 *     "macos":   { "url": "…/OneTHU-0.9.2.dmg", "size": 91234567, "name": "OneTHU-0.9.2.dmg" },
 *     "windows": { "url": "…/OneTHU-Setup-0.9.2.exe", "size": 73400320 },
 *     "android": { "url": "…/OneTHU-0.9.2.apk", "size": 83886080 }
 *   }
 * }
 * ```
 * 读清单复用既有 `seafile_read_bytes`（小文件通道，上限给 512KB），不新增读取命令。
 *
 * ## 红线
 * - **必须用户触发**：本模块不做任何后台轮询；只有用户点「检查更新」才读云盘，点「下载并安装」才下载；
 * - **绝不静默安装**：`installDownloaded()` 只是把系统安装器拉到前台（安卓 = 交给 ROM 的安装确认页）；
 * - 失败一律结构化返回 + 人话原因（不抛给 UI），并明确区分「云盘没连 / 没选库 / 清单不在 / 网络不通」。
 */
import { invoke } from "@tauri-apps/api/core";
import { ensureSeafileLoaded, getSeafileToken } from "../state/seafile.js";
import { isAndroidNavigator } from "./androidHost.js";
import { currentVersion, isNewer } from "./update.js";
import { logLine } from "./clients.js";

/** 云盘上的清单固定路径（仓库根下的相对路径，不带前导斜杠） */
export const MANIFEST_FILE = "OneTHU/release/latest.json";

export interface CloudAsset {
  url: string;
  size?: number;
  sha256?: string;
  name?: string;
}

export interface CloudUpdateManifest {
  version: string;
  minVersion?: string;
  url?: string;
  size?: number;
  sha256?: string;
  notes?: string;
  releasedAt?: string;
  assets?: Partial<Record<"macos" | "windows" | "linux" | "android", CloudAsset>>;
}

export interface CloudCheckResult {
  ok: boolean;
  /** 给人看的原因（ok=false 时必有） */
  error?: string;
  /** true = 需要用户先去挑资料库 / 连云盘（UI 据此给选择器） */
  needUi?: boolean;
  current: string;
  latest?: string;
  hasUpdate?: boolean;
  /** 低于清单 minVersion（必须更新；UI 加一句强提示，仍由用户决定） */
  belowMin?: boolean;
  notes?: string;
  releasedAt?: string;
  manifest?: CloudUpdateManifest;
  /** 当前平台要装的包 */
  asset?: CloudAsset;
  repoId?: string;
  repoName?: string;
  /** 读过的清单路径（出错时用来说明「去云盘看哪个文件」） */
  manifestPath?: string;
}

export interface UpdateProgress {
  phase: string;
  received: number;
  total: number;
  percent: number;
  path?: string;
}

/** 当前平台 key（安卓优先判定：主窗口 UA 被伪装成 Windows，必须先问多信号） */
export function platformKey(): "android" | "macos" | "windows" | "linux" {
  const nav = typeof navigator === "undefined" ? null : navigator;
  if (isAndroidNavigator(nav)) return "android";
  const uaData = (nav as unknown as { userAgentData?: { platform?: string } } | null)?.userAgentData;
  const p = String(uaData?.platform ?? nav?.platform ?? "");
  const ua = String(nav?.userAgent ?? "");
  if (/mac|darwin/i.test(p) || /Macintosh|Mac OS X/i.test(ua)) return "macos";
  if (/win/i.test(p) || /Windows/i.test(ua)) return "windows";
  return "linux";
}

/** 清单 → 当前平台的安装包（assets[平台] 优先，回落顶层 url/size） */
export function pickAsset(m: CloudUpdateManifest, key = platformKey()): CloudAsset | undefined {
  const a = m.assets?.[key];
  if (a?.url) {
    return { url: a.url, size: a.size ?? m.size, sha256: a.sha256 ?? m.sha256, name: a.name };
  }
  if (m.url) return { url: m.url, size: m.size, sha256: m.sha256, name: m.assets?.[key]?.name };
  return undefined;
}

/** base64 → UTF-8 文本（清单是 JSON，可能含中文说明） */
function b64ToText(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

/** 容错解析清单：字段缺/类型不对都给出可读原因，绝不把坏 JSON 当「已是最新」 */
export function parseManifest(raw: string): { ok: true; manifest: CloudUpdateManifest } | { ok: false; error: string } {
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    return { ok: false, error: "清单不是合法 JSON（云盘上的文件可能没传全）" };
  }
  const o = (j ?? {}) as Record<string, unknown>;
  const version = typeof o.version === "string" ? o.version.trim() : "";
  if (!version) return { ok: false, error: "清单缺 version 字段" };
  const str = (k: string): string | undefined =>
    typeof o[k] === "string" && String(o[k]).trim() ? String(o[k]).trim() : undefined;
  const num = (k: string): number | undefined => (typeof o[k] === "number" && o[k] > 0 ? (o[k] as number) : undefined);
  const assetsRaw = (o.assets ?? {}) as Record<string, unknown>;
  const assets: CloudUpdateManifest["assets"] = {};
  for (const key of ["macos", "windows", "linux", "android"] as const) {
    const a = assetsRaw[key] as Record<string, unknown> | undefined;
    if (a && typeof a.url === "string" && a.url.trim()) {
      assets[key] = {
        url: a.url.trim(),
        size: typeof a.size === "number" && a.size > 0 ? a.size : undefined,
        sha256: typeof a.sha256 === "string" ? a.sha256.trim() : undefined,
        name: typeof a.name === "string" && a.name.trim() ? a.name.trim() : undefined,
      };
    }
  }
  return {
    ok: true,
    manifest: {
      version,
      minVersion: str("minVersion"),
      url: str("url"),
      size: num("size"),
      sha256: str("sha256"),
      notes: str("notes"),
      releasedAt: str("releasedAt"),
      ...(Object.keys(assets).length ? { assets } : {}),
    },
  };
}

/**
 * 「上次选过的云盘库」记忆（与附件转存共用同一个 localStorage 键 `onethu.attach.cloud.v1`）。
 * 只读不写：本模块不替用户改选择；用户若在界面上显式选库，以显式入参为准。
 */
function rememberedCloudRepoId(): string {
  try {
    const raw = globalThis.localStorage?.getItem("onethu.attach.cloud.v1");
    if (!raw) return "";
    const j = JSON.parse(raw) as { repoId?: unknown };
    return typeof j.repoId === "string" ? j.repoId.trim() : "";
  } catch {
    return "";
  }
}

/** 云盘上有哪些库（没选库时给 UI 挑；**绝不替用户猜库**——与附件转存同一条规矩） */
export async function cloudRepos(): Promise<Array<{ id: string; name: string }>> {
  await ensureSeafileLoaded();
  const token = getSeafileToken();
  if (!token) return [];
  return invoke<Array<{ id: string; name: string }>>("seafile_repos", { token });
}

/**
 * 检查更新：读云盘清单 + 比版本。**不下载、不安装**（纯读，用户点了才调）。
 * `repoId` 省略时回落到「附件转存记住的那个库」（用户此前明确选过的），再没有就返回 needUi 让 UI 问。
 */
export async function checkCloudUpdate(opts: { repoId?: string; dir?: string; manifestPath?: string } = {}): Promise<CloudCheckResult> {
  const current = currentVersion();
  try {
    await ensureSeafileLoaded();
    const token = getSeafileToken();
    if (!token) {
      return { ok: false, needUi: true, current, error: "云盘还没连接：先到「云盘」页连上清华云盘（更新包放在云盘里）" };
    }
    // 回落顺序：显式入参 → 「上次选过的云盘库」（与附件转存共用同一份记忆）→ 让 UI 问用户
    const repoId = (opts.repoId ?? "").trim() || rememberedCloudRepoId() || "";
    if (!repoId) {
      return { ok: false, needUi: true, current, error: "还没选云盘资料库——请在下面选一个（不替你猜库）" };
    }
    const repos = await invoke<Array<{ id: string; name: string }>>("seafile_repos", { token });
    const repo = repos.find((r) => r.id === repoId);
    if (!repo) {
      return { ok: false, needUi: true, current, error: "这个资料库不在当前账号里（可能已删除/改名）——请重新选" };
    }
    const dir = (opts.dir ?? "").trim().replace(/^\/+|\/+$/g, "");
    // manifestPath 覆盖：只为联调/验收（把 mock 清单放测试目录）——生产留空即固定路径
    const manifestPath = (opts.manifestPath ?? "").trim() || `/${dir ? `${dir}/` : ""}${MANIFEST_FILE}`;
    let b64: string;
    try {
      b64 = await invoke<string>("seafile_read_bytes", { token, repoId, path: manifestPath, maxBytes: 512 * 1024 });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        current,
        repoId,
        repoName: repo.name,
        manifestPath,
        error: `读不到更新清单 ${manifestPath}：${msg}（若确实还没上传，请发布方按约定把 latest.json 放到这里）`,
      };
    }
    const parsed = parseManifest(b64ToText(b64));
    if (!parsed.ok) {
      return { ok: false, current, repoId, repoName: repo.name, manifestPath, error: `清单内容有问题：${parsed.error}` };
    }
    const m = parsed.manifest;
    const asset = pickAsset(m);
    const key = platformKey();
    const hasUpdate = isNewer(m.version, current);
    const belowMin = Boolean(m.minVersion && isNewer(m.minVersion, current));
    void logLine(`[更新] 云盘清单 ${manifestPath} → v${m.version}（当前 v${current}，${hasUpdate ? "有新版本" : "已是最新"}，平台 ${key}）`).catch(
      () => undefined,
    );
    if (hasUpdate && !asset) {
      return {
        ok: false,
        current,
        latest: m.version,
        repoId,
        repoName: repo.name,
        manifestPath,
        manifest: m,
        error: `清单说 v${m.version} 是新版，但没有当前平台（${key}）的安装包路径（url / assets.${key}.url 都缺）`,
      };
    }
    return {
      ok: true,
      current,
      latest: m.version,
      hasUpdate,
      belowMin,
      notes: m.notes,
      releasedAt: m.releasedAt,
      manifest: m,
      asset,
      repoId,
      repoName: repo.name,
      manifestPath,
    };
  } catch (e) {
    return { ok: false, current, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 下载更新包（用户点了才调）。进度经 `onethu-updater://progress` 事件回传；
 * `cancel()` 由 UI 调用（`cancelUpdateDownload()`），已下载的中间文件会被清掉。
 */
export async function downloadUpdate(opts: {
  repoId: string;
  remotePath: string;
  fileName: string;
  expectSize?: number;
  onProgress?: (p: UpdateProgress) => void;
}): Promise<{ ok: boolean; path?: string; dir?: string; size?: number; error?: string; cancelled?: boolean }> {
  let unlisten: (() => void) | undefined;
  try {
    await ensureSeafileLoaded();
    const token = getSeafileToken();
    if (!token) return { ok: false, error: "云盘还没连接" };
    if (typeof opts.onProgress === "function") {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen<UpdateProgress>("onethu-updater://progress", (ev) => {
        const p = ev.payload;
        if (p && typeof p.received === "number") opts.onProgress?.(p);
      });
    }
    const r = await invoke<{ path: string; dir: string; size: number }>("updater_download", {
      token,
      repoId: opts.repoId,
      path: opts.remotePath,
      fileName: opts.fileName,
      expectSize: opts.expectSize ?? null,
    });
    return { ok: true, path: r.path, dir: r.dir, size: r.size };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg, cancelled: /已取消/.test(msg) };
  } finally {
    unlisten?.();
  }
}

/** 取消进行中的下载（任何时刻都能点） */
export async function cancelUpdateDownload(): Promise<void> {
  await invoke("updater_cancel_download").catch(() => undefined);
}

export interface InstallLaunchResult {
  ok: boolean;
  /** 需要用户知道的额外一句（如安卓的「未知来源」授权引导） */
  hint?: string;
  error?: string;
}

/**
 * 把已下载的安装包拉到系统安装页。**只拉起，不静默安装**：
 * - 安卓：`updater_open_installer` → Kotlin FileProvider → `content://` → ACTION_VIEW
 *   （package-archive）；若系统还没允许本应用安装未知应用，ROM 会自己弹授权页；
 * - 桌面：`onethu_open_path` 用系统默认应用打开（macOS = 挂载 DMG 并弹安装窗；
 *   Windows = 直接进安装向导）。
 */
export async function installDownloaded(path: string): Promise<InstallLaunchResult> {
  if (!path) return { ok: false, error: "没有可安装的本地路径" };
  const key = platformKey();
  try {
    if (key === "android") {
      await invoke("updater_open_installer", { path });
      return { ok: true, hint: "已拉起系统安装页：首次安装需在系统提示里允许「安装未知应用」，之后确认安装即可。" };
    }
    await invoke("onethu_open_path", { path });
    return {
      ok: true,
      hint: key === "macos" ? "已用系统默认方式打开：若是 DMG，把应用拖进「应用程序」即完成更新。" : "已用系统默认方式打开安装包。",
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    void logLine(`[更新] 拉起安装页失败：${msg}`).catch(() => undefined);
    return { ok: false, error: msg };
  }
}

/** 从云盘路径里取文件名（清单没写 name 时的兜底） */
export function fileNameFor(asset: CloudAsset, version: string): string {
  const fromUrl = asset.url.split("?")[0]?.split("/").pop() ?? "";
  if (fromUrl && fromUrl.includes(".")) return fromUrl;
  if (asset.name) return asset.name;
  const ext = platformKey() === "android" ? "apk" : platformKey() === "windows" ? "exe" : "dmg";
  return `OneTHU-${version}.${ext}`;
}
