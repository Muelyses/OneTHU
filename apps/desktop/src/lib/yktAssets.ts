/**
 * R20-B3：雨课堂资源加载 IO 薄层 —— 加密字体缓存 + 图片代理重试。
 *
 * 与纯逻辑的分界：判定/拼装口径全在 ./yktBody.ts（Node 直引可测）；本模块只做
 * Tauri invoke 往返，全部「尽力而为」：任何失败都返回 null/抛给调用方走降级，
 * 绝不让题干渲染白屏。
 *
 * 字体缓存（docs 28.10）：
 *  - 落点：复用 Rust `state_read`/`state_write`（appData/state/<name>.json）——应用数据
 *    目录，**不进仓库**；字体二进制 base64 存 JSON（实测 exam_font_*.ttf 几十 KB 量级）；
 *  - 键：`yktFontCacheKey(url)`（slug + 64bit 指纹，兼容 Rust safe_name 白名单）；
 *  - 有效期：TTL 7 天 + magic 内容校验（isFontCacheFresh），过期/污染/时钟回拨一律重取；
 *  - 失败退避：下载失败记 lastFailAt（内存），10 分钟内不再打网络（fontDownloadAllowed），
 *    防止一份 404 字体把整卷 N 道题拖成 N 次超时；`force` 旁路全部缓存（字体失效重取）。
 *
 * 图片代理：`<img>` 直挂失败后的第二次机会 —— `fetch_binary` 走 Rust reqwest（无 CORS），
 * 带雨课堂站内 Referer（防盗链口径与官方页一致）；仅 yuketang/xuetangx 自有域附加会话
 * Cookie（shouldAttachYktCookies，不向第三方图床外泄凭据）；mime 必须 image/*。
 */
import { isTauri } from "./transport.js";
import {
  YKT_FONT_MAX_B64_LEN,
  fontDownloadAllowed,
  fontMimeFromBase64,
  isFontCacheFresh,
  shouldAttachYktCookies,
  yktFontCacheKey,
  type YktFontCacheRecord,
} from "./yktBody.js";

/** 防盗链 Referer：与官方页同源口径（字体/图片 CDN 多为 Referer 白名单校验） */
export const YKT_ASSET_REFERER = "https://pro.yuketang.cn/";

/** 一次字体加载的结果（fromCache 仅用于日志/测试观察） */
export interface YktFontData {
  dataUrl: string;
  fromCache: boolean;
}

/** 进程内去重：同 URL 并发加载共享同一 Promise；失败结果同样记忆（退避窗口由
 *  fontDownloadAllowed 把关），避免整卷 N 道题 × 每题一次网络超时。 */
const mem = new Map<string, Promise<YktFontData | null>>();
const lastFailAt = new Map<string, number>();

async function tauriInvoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args) as Promise<T>;
}

/** log_debug 留痕（失败静默——诊断通道自身不可用时不能反噬主流程） */
async function logDebug(line: string): Promise<void> {
  try {
    await tauriInvoke("log_debug", { line });
  } catch {
    /* noop */
  }
}

/** 读缓存 → data URL；任何异常（无文件/坏 JSON/过期/污染）都按「无缓存」处理 */
async function readFontCache(url: string): Promise<string | null> {
  if (!isTauri) return null;
  try {
    const raw = await tauriInvoke<string | null>("state_read", { name: yktFontCacheKey(url) });
    if (!raw) return null;
    const rec = JSON.parse(raw) as unknown;
    if (!isFontCacheFresh(rec, url, Date.now())) return null;
    const ok = rec as YktFontCacheRecord;
    return `data:${ok.mime};base64,${ok.data}`;
  } catch {
    return null;
  }
}

/** fetch_binary 下载字体并校验 magic；成功后异步落盘（写缓存失败不影响本次使用） */
async function fetchFontFromNet(url: string, cookies: string): Promise<string | null> {
  try {
    const out = await tauriInvoke<{ mime?: string; data?: string }>("fetch_binary", {
      url,
      cookies,
      referer: YKT_ASSET_REFERER,
    });
    const data = out?.data ?? "";
    // magic 校验是关键降级判定：404 页 / HTML 错误体 / 截断串一律按「没有字体」处理
    const mime = fontMimeFromBase64(data);
    if (!mime || data.length < 80 || data.length > YKT_FONT_MAX_B64_LEN) return null;
    const rec: YktFontCacheRecord = { v: 1, url, mime, data, savedAt: Date.now() };
    void tauriInvoke("state_write", { name: yktFontCacheKey(url), content: JSON.stringify(rec) }).catch(
      () => undefined,
    );
    return `data:${mime};base64,${data}`;
  } catch {
    return null;
  }
}

/**
 * 加密字体加载（主入口）。
 * 顺序：进程内记忆 → 磁盘缓存（TTL+magic 判定）→ fetch_binary 下载。
 * `force: true` 旁路记忆与磁盘缓存（iframe 内 document.fonts 校验失败后的自动重取）。
 * 任何失败返回 null —— 调用方（ProblemBody）随即走「普通字体兜底」。
 */
export async function loadYktFont(url: string, opts: { force?: boolean; cookies?: string } = {}): Promise<YktFontData | null> {
  const clean = (url ?? "").trim();
  if (!clean || !isTauri) return null;
  const force = opts.force === true;
  if (!force) {
    const hit = mem.get(clean);
    if (hit) return hit;
    if (!fontDownloadAllowed(lastFailAt.get(clean), Date.now())) return null;
  }
  const job = (async (): Promise<YktFontData | null> => {
    if (!force) {
      const cached = await readFontCache(clean);
      if (cached) return { dataUrl: cached, fromCache: true };
    }
    const got = await fetchFontFromNet(clean, opts.cookies ?? "");
    if (!got) {
      lastFailAt.set(clean, Date.now());
      void logDebug(`R20-B3 加密字体获取失败，降级普通字体：${clean.slice(0, 200)}`);
      return null;
    }
    lastFailAt.delete(clean);
    return { dataUrl: got, fromCache: false };
  })();
  if (!force) mem.set(clean, job);
  return job;
}

/**
 * 图片代理重试：fetch_binary（Rust reqwest，无 CORS）+ 雨课堂 Referer；
 * 仅 yuketang/xuetangx 自有域附加会话 Cookie。非 Tauri（浏览器预览）直接抛错 →
 * 组件回「放弃代理 → 占位框」。
 */
export async function fetchYktImageAsDataUrl(url: string, cookies: string): Promise<string> {
  if (!isTauri) throw new Error("非 Tauri 环境无图片代理通道");
  const out = await tauriInvoke<{ mime?: string; data?: string }>("fetch_binary", {
    url,
    cookies: shouldAttachYktCookies(url) ? cookies : "",
    referer: YKT_ASSET_REFERER,
  });
  if (!out || !/^image\//i.test(out.mime ?? "") || (out.data?.length ?? 0) < 80) {
    throw new Error(`图片代理响应非图片（mime=${out?.mime ?? "空"} bytes=${out?.data?.length ?? 0}）`);
  }
  return `data:${out.mime};base64,${out.data}`;
}

/** 仅供测试注入/重置进程内记忆（生产代码勿调） */
export function resetYktFontMemForTest(): void {
  mem.clear();
  lastFailAt.clear();
}
