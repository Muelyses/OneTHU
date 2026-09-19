/**
 * 插件市场与 GitHub 仓库直装数据层。
 *
 * 两套机制共用同一仓库格式约定（JS 插件单文件 ES 模块，内嵌 manifest）：
 * - 市场：官方市场仓库维护 registry.json（人工审查收录），客户端拉取展示、搜索、一键安装；
 * - 直装：用户输入 GitHub 仓库地址（user/repo 或完整 URL，可 @branch），客户端从
 *   raw.githubusercontent.com 拉取入口模块，走与「粘贴安装」同一校验管线。
 *
 * 传输：tauriFetch（Tauri http_request，无 CORS 限制、走系统代理）；浏览器预览降级
 * window.fetch。Rust 插件的远程分发（二进制）不在本机制范围内。
 */

export const DEFAULT_MARKET_URL =
  "https://raw.githubusercontent.com/smartThise/OneTHU-Market/main/registry.json";
const MARKET_URL_KEY = "onethu.market.url";
const CACHE_KEY = "onethu.market.cache.v1";
const CACHE_TTL_MS = 5 * 60 * 1000;

export interface MarketEntry {
  id: string;
  name: string;
  version: string;
  author?: string;
  description?: string;
  repo: string;
  entry?: string;
  tags?: string[];
}

export interface MarketRegistry {
  version: number;
  updatedAt?: string;
  plugins: MarketEntry[];
}

export interface RepoRef {
  owner: string;
  repo: string;
  branch?: string;
  subPath?: string;
}

/** 解析 GitHub 仓库地址。接受：user/repo、user/repo@branch、
 *  https://github.com/user/repo(.git)(@branch)、user/repo/tree/branch/sub/path。
 *  非法输入抛 Error（message 面向用户）。 */
export function parseRepoInput(input: string): RepoRef {
  let s = (input ?? "").trim();
  if (!s) throw new Error("请输入仓库地址，如 user/repo");
  s = s.replace(/^git@github\.com:/i, "https://github.com/");
  if (!/^https?:\/\//i.test(s)) {
    // 允许省略协议：github.com/user/repo 或 user/repo
    s = s.replace(/^github\.com\//i, "https://github.com/");
    if (!/^https:\/\/[^/]+\/[^/]+/.test(s)) {
      const m = /^([\w.-]+)\/([\w.-]+?)(?:@([\w./-]+))?$/.exec(s);
      const owner = m?.[1];
      const repo = m?.[2];
      if (!m || !owner || !repo) throw new Error("无法识别的仓库地址；示例：user/repo 或 user/repo@dev");
      return { owner, repo: repo.replace(/\.git$/, ""), branch: m[3] || undefined };
    }
  }
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new Error("无法识别的仓库地址；示例：user/repo 或完整 GitHub URL");
  }
  if (!/(^|\.)github\.com$/i.test(u.hostname)) {
    throw new Error("目前仅支持 GitHub 仓库（github.com）");
  }
  const parts = u.pathname.replace(/^\/+|\/+$/g, "").split("/");
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    throw new Error("缺少 owner/repo；示例：https://github.com/user/repo");
  }
  const owner = parts[0];
  let repo = parts[1].replace(/\.git$/, "");
  let branch: string | undefined;
  let subPath: string | undefined;
  // /tree/<branch>(/sub/path) 形态
  if (parts[2] === "tree" && parts[3]) {
    branch = parts[3];
    subPath = parts.slice(4).join("/") || undefined;
  } else {
    const hash = s.lastIndexOf("@");
    if (hash > u.origin.length) {
      const tail = s.slice(hash + 1).replace(/\/+$/, "");
      if (tail) branch = tail;
    }
  }
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) {
    throw new Error("owner/repo 含非法字符");
  }
  return { owner, repo, branch, subPath };
}

/** 规范化仓库地址为 https://github.com/owner/repo（作为安装来源记录与跳转目标）。 */
export function normalizeRepoUrl(input: string): string {
  const ref = parseRepoInput(input);
  return `https://github.com/${ref.owner}/${ref.repo}`;
}

/** 入口模块候选（顺序即优先级）；分支缺省依次尝试 main、master。 */
const ENTRY_CANDIDATES = ["plugin.js", "index.js", "main.js"];
const DEFAULT_BRANCHES = ["main", "master"];

export function rawEntryUrl(ref: RepoRef, branch: string, entry: string): string {
  const base = `https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/${branch}`;
  const mid = ref.subPath ? `/${ref.subPath.replace(/^\/+|\/+$/g, "")}` : "";
  return `${base}${mid}/${entry.replace(/^\/+/, "")}`;
}

async function externalFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    const { isTauri, tauriFetch } = await import("./transport.js");
    if (isTauri) return await tauriFetch(url, init ?? {});
  } catch {
    /* 预览环境降级 */
  }
  return fetch(url, init ?? {});
}

/** 从 GitHub 仓库拉取插件入口模块文本。命中第一个存在的候选即返回；
 *  全部未命中抛错（列出已尝试的路径）。 */
export async function fetchEntryFromRepo(ref: RepoRef, entry?: string): Promise<string> {
  const branches = ref.branch ? [ref.branch] : DEFAULT_BRANCHES;
  const entries = entry ? [entry] : ENTRY_CANDIDATES;
  const tried: string[] = [];
  for (const b of branches) {
    for (const e of entries) {
      const url = rawEntryUrl(ref, b, e);
      tried.push(`${ref.owner}/${ref.repo}@${b}/${e}`);
      const res = await externalFetch(url).catch(() => null);
      if (res && res.ok) {
        const text = await res.text();
        if (text.trim()) return text;
      }
    }
  }
  throw new Error(
    `仓库中未找到插件入口（尝试：${tried.join("、")}）。仓库需在根目录提供 plugin.js（或 index.js / main.js，或清单指定 entry）。`,
  );
}

/** 三段版本号比较（v 前缀容错）：a<b 返回 -1，相等 0，a>b 返回 1。
 *  非数字段按字符串比较；段数不足补 0。 */
export function compareVersions(a: string, b: string): number {
  const norm = (v: string) => v.replace(/^v/i, "").split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
  const pa = norm(a);
  const pb = norm(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const xa = pa[i] ?? null;
    const xb = pb[i] ?? null;
    if (xa === xb) continue;
    // 数字段缺失按 0 补齐（1.0 == 1.0.0）；字符串段缺失即预发布语义（1.0.0-beta < 1.0.0）
    if (xa === null) {
      if (typeof xb === "number") {
        if (xb === 0) continue;
        return -1;
      }
      return 1;
    }
    if (xb === null) {
      if (typeof xa === "number") {
        if (xa === 0) continue;
        return 1;
      }
      return -1;
    }
    if (typeof xa === "number" && typeof xb === "number") return xa < xb ? -1 : 1;
    return String(xa) < String(xb) ? -1 : 1;
  }
  return 0;
}

/** 拉取一批仓库的 GitHub star 数（无 token 限额 60/h/IP，条目量级足够）。
 *  失败的条目返回 null，排序时沉底。结果并入注册表缓存。 */
export async function fetchStarMap(items: MarketEntry[]): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = {};
  await Promise.all(
    items.map(async (item) => {
      try {
        const ref = parseRepoInput(item.repo);
        // api.github.com 强制要求 User-Agent（缺失直接 403），Tauri http 层不带浏览器式 UA
        const res = await externalFetch(`https://api.github.com/repos/${ref.owner}/${ref.repo}`, {
          headers: { "User-Agent": "OneTHU-App", Accept: "application/vnd.github+json" },
        });
        if (!res.ok) {
          out[item.id] = null;
          return;
        }
        const j = (await res.json()) as { stargazers_count?: number };
        out[item.id] = typeof j.stargazers_count === "number" ? j.stargazers_count : null;
      } catch {
        out[item.id] = null;
      }
    }),
  );
  return out;
}

function marketUrl(): string {
  try {
    return localStorage.getItem(MARKET_URL_KEY) || DEFAULT_MARKET_URL;
  } catch {
    return DEFAULT_MARKET_URL;
  }
}

/** 拉取市场名单（带 5 分钟缓存）。force=true 跳过缓存。 */
export async function fetchRegistry(force = false): Promise<MarketRegistry> {
  if (!force) {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const { url, at, data } = JSON.parse(raw) as { url: string; at: number; data: MarketRegistry };
        if (url === marketUrl() && Date.now() - at < CACHE_TTL_MS && Array.isArray(data?.plugins)) {
          return data;
        }
      }
    } catch {
      /* 缓存损坏则直接拉取 */
    }
  }
  // force 刷新时加 cache-buster：raw.githubusercontent 的 Fastly 边缘缓存会短时间
  // 吐旧内容（不同客户端命中不同节点），换 query 视为新的缓存键直出最新
  const bust = force ? (marketUrl().includes("?") ? "&" : "?") + `t=${Date.now()}` : "";
  const res = await externalFetch(marketUrl() + bust);
  if (!res.ok) throw new Error(`市场名单拉取失败：HTTP ${res.status}`);
  const data = (await res.json()) as MarketRegistry;
  if (!data || !Array.isArray(data.plugins)) throw new Error("市场名单格式无效（缺 plugins 数组）");
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ url: marketUrl(), at: Date.now(), data }));
  } catch {
    /* 存不下就不缓存 */
  }
  return data;
}

/** 市场条目 → 安装：拉取其仓库入口并返回模块文本（交由 installPlugin 校验安装）。 */
export async function fetchEntryFromMarket(item: MarketEntry): Promise<string> {
  const ref = parseRepoInput(item.repo);
  return fetchEntryFromRepo(ref, item.entry);
}
