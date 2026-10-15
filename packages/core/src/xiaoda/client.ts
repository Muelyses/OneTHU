/**
 * 清小搭（www.xiaoda.tsinghua.edu.cn 校园 AI 学伴）客户端。
 *
 * 鉴权链（scripts/xiaoda-probe.mts 实测定稿，2026-10-15）——与微信零耦合：
 *  1. GET ITS 服务表单（清小搭专属 service d982b7…）→ 提取 #sm2publicKey
 *  2. POST /do/off/ui/auth/login/check（learn-lib 字段集；受信指纹免 2FA；
 *     不发 singleLogin——那是「踢掉其他会话」）→ 成功页锚点 …/login.html?ticket=<漫游票>
 *  3. GET /api/token/login?ticket=… → { code:0, data:{ token: JWT(≈30 天), … } }
 *  4. 此后全部请求带自定义头 `token: <JWT>`（不是 Authorization Bearer）
 *
 * 探针教训（留档防重蹈）：
 *  - 表单页首个 `<form>` 是语言切换表单（/f/common/public/locale/change），
 *    登录表单由 JS 提交到 check 端点——勿用 form action；
 *  - ITS 漫游不走 webvpn 隧道（隧道内无应用会话，wengine 弹回 /login）；
 *    demoLogin 尾串的 JSESSIONID 也不足以直连出票（须对目标 service 完整登录）；
 *  - 业务失败也回 HTTP 200 + code!=0；鉴权失效是 code 2001 /「token 无效」；
 *  - /v1/chat/completions 是真实 OpenAI 兼容端点（SSE 流式），model 须
 *    "agent:<id>"（须为 UAP 路由已注册的智能体；默认助手 9999 不在其中，
 *    服务端错误原文透传即可——实验页的诚实行为）。
 */
import { encryptPassword } from "../crypto/sm2.js";
import { DEFAULT_USER_AGENT } from "../http.js";

export const XIAODA_BASE = "https://www.xiaoda.tsinghua.edu.cn";
const ITS_LOGIN_SVC = "https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/d982b795884e882abfa8ff3167aeb03e/0?/login.html";
const CAS_CHECK = "https://id.tsinghua.edu.cn/do/off/ui/auth/login/check";

export type XiaodaFetch = (url: string, init?: RequestInit) => Promise<Response>;

export class XiaodaApiError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = "XiaodaApiError";
    this.code = code;
  }
}

export class XiaodaAuthRequiredError extends Error {
  constructor(message = "清小搭登录已失效") {
    super(message);
    this.name = "XiaodaAuthRequiredError";
  }
}

export class XiaodaLoginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XiaodaLoginError";
  }
}

export interface XiaodaUser {
  uniqueId: string;
  name: string;
  zjh: string;
  phone?: string;
  yhlb?: string;
  icon?: string;
}

export interface XiaodaAgentMember {
  uniqueId: string;
  name: string;
  icon?: string;
  description?: string;
  objType?: number;
  status?: number;
}

export interface XiaodaAgentGroup {
  uniqueId: string;
  name: string;
  description?: string;
  members: XiaodaAgentMember[];
}

export interface XiaodaSkillCategory {
  code: string;
  name: string;
  count: number;
  summary?: string;
}

export interface XiaodaSkillItem {
  id: string;
  name: string;
  icon?: string;
  description?: string;
  category?: string;
  categoryName?: string;
  downloadCount?: number;
  authorName?: string;
}

export interface XiaodaSkillOverview {
  skillCount: number;
  contributorCount: number;
  downloadCount: number;
}

export interface XiaodaConversation {
  convId: string;
  query: string;
  createTime?: string | number;
  state?: number;
  agentId?: string;
  agentIcon?: string;
  isDeepResearch?: boolean;
}

export interface XiaodaModel {
  id: number;
  name: string;
  iconUri?: string;
  isDefault?: boolean;
}

export interface XiaodaDadouBalance {
  userUniqueId?: string;
  balance: number;
  totalEarned: number;
  totalSpent: number;
}

interface PageEnvelope<T> {
  page?: { totalCount?: number; totalPage?: number; currentPage?: number };
  dataList?: T[];
}

function safeJson(text: string): Record<string, unknown> {
  try {
    const j = JSON.parse(text);
    return typeof j === "object" && j !== null ? (j as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** JWT exp（毫秒）；解不出回 null（视为「不预判过期」） */
export function xiaodaTokenExpiresAt(token: string): number | null {
  try {
    const payload = token.split(".")[1] ?? "";
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "="));
    const j = safeJson(bin);
    const exp = j.exp;
    return typeof exp === "number" ? exp * 1000 : null;
  } catch {
    return null;
  }
}

interface ReqOpts {
  cookies?: string;
  data?: Record<string, string>;
  headers?: Record<string, string>;
}

export class XiaodaClient {
  private fetchLike: XiaodaFetch;
  private log: (line: string) => void;
  token = "";
  user: XiaodaUser | null = null;

  constructor(opts: { fetch: XiaodaFetch; log?: (line: string) => void }) {
    this.fetchLike = opts.fetch;
    this.log = opts.log ?? (() => undefined);
  }

  setToken(token: string): void {
    this.token = token;
  }

  getToken(): string {
    return this.token;
  }

  hasToken(): boolean {
    return this.token !== "";
  }

  tokenExpiresAt(): number | null {
    return this.token ? xiaodaTokenExpiresAt(this.token) : null;
  }

  /** 手动跟跳的单次请求（字符串 cookie 模型；Set-Cookie 同名覆盖）——探针同款 */
  private async req(
    method: "GET" | "POST",
    url: string,
    opts: ReqOpts = {},
  ): Promise<{ url: string; html: string; cookies: string; status: number }> {
    let cookies = opts.cookies ?? "";
    let currentUrl = url;
    let m = method;
    let body: string | undefined = opts.data ? new URLSearchParams(opts.data).toString() : undefined;
    const chain = new Map<string, string>();
    for (let hop = 0; hop < 14; hop++) {
      const headers: Record<string, string> = {
        "User-Agent": DEFAULT_USER_AGENT,
        ...(opts.headers ?? {}),
      };
      const pairs = new Map<string, string>();
      for (const pair of cookies.split("; ")) {
        const i = pair.indexOf("=");
        if (i > 0) pairs.set(pair.slice(0, i), pair.slice(i + 1));
      }
      for (const [k, v] of chain) pairs.set(k, v);
      if (pairs.size > 0) headers.Cookie = [...pairs].map(([k, v]) => `${k}=${v}`).join("; ");
      if (body !== undefined && !headers["Content-Type"]) {
        headers["Content-Type"] = "application/x-www-form-urlencoded";
      }
      const res = await this.fetchLike(currentUrl, { method: m, body, headers, redirect: "manual" });
      for (const sc of res.headers.getSetCookie?.() ?? []) {
        const mm = /^([^=]+)=([^;]*)/.exec(sc);
        if (mm?.[1]) chain.set(mm[1].trim(), mm[2] ?? "");
      }
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (loc && loc !== "null") {
          currentUrl = new URL(loc, currentUrl).toString();
          if (res.status === 303 || ((res.status === 301 || res.status === 302) && m === "POST")) {
            m = "GET";
            body = undefined;
          }
          continue;
        }
      }
      return { url: currentUrl, html: await res.text(), cookies, status: res.status };
    }
    throw new XiaodaApiError(0, "重定向超限（清小搭登录链）");
  }

  /** ITS 直连完整登录（fresh 会话 + 受信指纹免 2FA）→ 换内部 JWT */
  async login(username: string, password: string, fingerprint: string, finger3: string): Promise<XiaodaUser> {
    const form = await this.req("GET", ITS_LOGIN_SVC);
    const key = /id="sm2publicKey"[^>]*>\s*([0-9a-fA-F]{100,})\s*</.exec(form.html)?.[1] ?? "";
    if (!key) throw new XiaodaLoginError("登录表单获取失败（未找到 SM2 公钥）");
    const check = await this.req("POST", CAS_CHECK, {
      cookies: form.cookies,
      data: {
        i_user: username,
        i_pass: encryptPassword(password, key),
        fingerPrint: fingerprint,
        fingerGenPrint: finger3,
        fingerGenPrint3: "",
        i_captcha: "",
      },
    });
    let ticket = "";
    const anchor = /<a[^>]+href="([^"]+)"/i.exec(check.html)?.[1] ?? "";
    if (anchor) {
      const u = anchor.startsWith("http") ? anchor : new URL(anchor, check.url).toString();
      try {
        ticket = new URL(u).searchParams.get("ticket") ?? "";
      } catch {
        /* fallthrough */
      }
      if (!ticket) ticket = anchor.split("=").slice(-1)[0] ?? "";
    }
    if (!ticket) {
      try {
        ticket = new URL(check.url).searchParams.get("ticket") ?? "";
      } catch {
        /* fallthrough */
      }
    }
    if (!ticket && /二次认证|doubleauth|双因素/i.test(check.html) && !/登录成功|正在重定向/.test(check.html)) {
      throw new XiaodaLoginError("触发了二次认证（受信指纹未生效）；请先在 OneTHU 主登录过一次 2FA 并信任本设备");
    }
    if (!ticket) {
      throw new XiaodaLoginError("登录未出票：" + check.html.slice(0, 160).replace(/\s+/g, " "));
    }
    const ex = await this.req("GET", `${XIAODA_BASE}/api/token/login?ticket=${encodeURIComponent(ticket)}`);
    const j = safeJson(ex.html);
    const data = (j.data ?? {}) as Record<string, unknown>;
    const tok = typeof data.token === "string" ? data.token : "";
    if (j.code !== 0 || !tok) {
      throw new XiaodaLoginError(`token 兑换失败：${typeof j.message === "string" ? j.message : ex.html.slice(0, 120)}`);
    }
    this.token = tok;
    this.user = {
      uniqueId: typeof data.uniqueId === "string" ? data.uniqueId : "",
      name: typeof data.name === "string" ? data.name : "",
      zjh: typeof data.zjh === "string" ? data.zjh : "",
    };
    this.log(`xiaoda login ok：${this.user.name}（${this.user.zjh}）token ${tok.length} chars`);
    return this.user;
  }

  /** 业务 GET（token 头；code 2001/token 无效 → XiaodaAuthRequiredError） */
  private async apiGet<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    if (!this.token) throw new XiaodaAuthRequiredError("未登录（无 token）");
    const qs = params
      ? "?" +
        new URLSearchParams(
          Object.entries(params)
            .filter(([, v]) => v !== undefined && v !== "")
            .map(([k, v]) => [k, String(v)] as [string, string]),
        ).toString()
      : "";
    const res = await this.fetchLike(`${XIAODA_BASE}${path}${qs}`, { headers: { token: this.token } });
    const text = await res.text();
    const j = safeJson(text);
    if (!res.ok && j.code === undefined) throw new XiaodaApiError(res.status, text.slice(0, 160));
    if (j.code === 0) return (j.data ?? (null as unknown)) as T;
    const msg = typeof j.message === "string" ? j.message : text.slice(0, 160);
    if (j.code === 2001 || /token 无效|token 为空/.test(msg)) throw new XiaodaAuthRequiredError(msg);
    throw new XiaodaApiError(typeof j.code === "number" ? j.code : res.status, msg);
  }

  async getUserInfo(): Promise<XiaodaUser> {
    const u = await this.apiGet<XiaodaUser>("/api/token/getUserInfo");
    this.user = u;
    return u;
  }

  async dadouBalance(): Promise<XiaodaDadouBalance> {
    return this.apiGet<XiaodaDadouBalance>("/api/dadou/balance");
  }

  async builtinGroups(): Promise<XiaodaAgentGroup[]> {
    return this.apiGet<XiaodaAgentGroup[]>("/api/group/builtin/list");
  }

  async skillCategories(): Promise<XiaodaSkillCategory[]> {
    return this.apiGet<XiaodaSkillCategory[]>("/api/skill/plaza/categories");
  }

  async skillOverview(): Promise<XiaodaSkillOverview> {
    return this.apiGet<XiaodaSkillOverview>("/api/skill/plaza/overview");
  }

  async skillList(pageNum = 1, pageSize = 10): Promise<PageEnvelope<XiaodaSkillItem>> {
    return this.apiGet<PageEnvelope<XiaodaSkillItem>>("/api/skill/plaza/list", { pageNum, pageSize });
  }

  async conversationPage(pageNum = 1, pageSize = 10): Promise<PageEnvelope<XiaodaConversation>> {
    return this.apiGet<PageEnvelope<XiaodaConversation>>("/api/conversation/page", { pageNum, pageSize });
  }

  async customModels(): Promise<XiaodaModel[]> {
    return this.apiGet<XiaodaModel[]>("/api/opencoze/customModel/list");
  }

  /** OpenAI 兼容对话（SSE 流式）；服务端错误原文透传（XiaodaApiError） */
  async chatStream(opts: {
    model: string;
    messages: { role: string; content: string }[];
    signal?: AbortSignal;
    onDelta: (text: string) => void;
  }): Promise<string> {
    const res = await this.fetchLike(`${XIAODA_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": DEFAULT_USER_AGENT,
        ...(this.token ? { token: this.token } : {}),
      },
      body: JSON.stringify({ model: opts.model, messages: opts.messages, stream: true }),
      signal: opts.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const j = safeJson(body);
      const err = (j.error ?? {}) as Record<string, unknown>;
      throw new XiaodaApiError(
        res.status,
        typeof err.message === "string" ? err.message : body.slice(0, 160),
      );
    }
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("event-stream") || !res.body) {
      const body = await res.text();
      const j = safeJson(body);
      const err = (j.error ?? {}) as Record<string, unknown>;
      if (typeof err.message === "string") throw new XiaodaApiError(0, err.message);
      const choices = (j.choices ?? []) as { message?: { content?: string }; text?: string }[];
      const content = choices[0]?.message?.content ?? choices[0]?.text ?? "";
      if (content) opts.onDelta(content);
      return content;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let full = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]" || payload === "") continue;
        const j = safeJson(payload);
        const err = (j.error ?? {}) as Record<string, unknown>;
        if (typeof err.message === "string") throw new XiaodaApiError(0, err.message);
        const choices = (j.choices ?? []) as { delta?: { content?: string }; text?: string }[];
        const delta = choices[0]?.delta?.content ?? choices[0]?.text ?? "";
        if (delta) {
          full += delta;
          opts.onDelta(delta);
        }
      }
    }
    return full;
  }
}
