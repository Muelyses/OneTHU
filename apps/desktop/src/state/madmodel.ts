import { http } from "../lib/clients.js";
import { universalFetch } from "../lib/transport.js";
import { webvpnWrap } from "@onethu/core";
import { getPlugin, updatePlugin } from "../plugins/registry.js";
import { logLine } from "../lib/clients.js";

/** 清华 MadModel（校园网免费 DeepSeek）token 泵——嫁接 OneTHU 成熟 transport。
 *  站点语义（github.com/OverDustD7/thu-tok-auto 实测定案，MIT）：
 *  - GET /model-api/auth-login/check 校园网内免登录签发 6h JWT（{success,data}）；
 *  - 校外：SSO 重放（id.tsinghua 公网 + OneTHU 登录会话 cookie）拿 ticket →
 *    /check?ticket= 签发——madmodel 是校内域，校外该请求走 webvpn 包装
 *    （webvpnWrap 现成，收录与否实测）；
 *  - token 写入 onethu.harness settings（madmodelToken/madmodelAt）——Rust 每次
 *    run 经 settings.get 实时读取（R3），无需重启；
 *  - 续期泵 10 分钟粒度：距上次签发超 5h50min（6h 寿命留 10 分钟缓冲）才真拉。 */

const SITE = "https://madmodel.cs.tsinghua.edu.cn";
const SSO_APP = "d736f067a6705ab942df52f958a0f23b"; // md5('DEEPSEEK')，id.tsinghua 应用注册名
const REFRESH_MS = 5 * 3600_000 + 50 * 60_000;
const HARNESS_ID = "onethu.harness";

let pumping = false;

/** 是否该续期：provider=madmodel（默认）且未填自费 key 且到期 */
export function madmodelDue(): boolean {
  const rec = getPlugin(HARNESS_ID);
  const s = rec?.settings ?? {};
  const provider = String(s.provider ?? "");
  if (provider === "custom") return false; // 显式自费
  if (!provider && s.apiKey) return false; // 老用户未显式选择但已填 key：维持自费不破坏
  const at = Number(s.madmodelAt ?? 0);
  return !at || Date.now() - at > REFRESH_MS;
}

async function parseMint(res: Response): Promise<string> {
  const j = (await res.json().catch(() => null)) as { success?: boolean; data?: unknown } | null;
  if (j?.success === true && typeof j.data === "string" && j.data) return j.data;
  throw new Error(`签发未成功（HTTP ${res.status}）`);
}

/** 层 1：校园网内免登录直连（无任何凭据） */
async function mintDirect(): Promise<string> {
  const res = await universalFetch(`${SITE}/model-api/auth-login/check`);
  return parseMint(res);
}

/** 层 2a：SSO 重放——id.tsinghua（公网）带 OneTHU 登录会话逐跳跟 302 拿 ticket */
async function ssoTicket(): Promise<string> {
  let cur = `https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/${SSO_APP}/0?/authLogin`;
  for (let hops = 0; hops < 10; hops++) {
    const res = await http.request(cur, { redirect: "manual" });
    const loc: string | null = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      cur = new URL(loc, cur).toString();
      continue;
    }
    const m = /[?&]ticket=([^&#]+)/.exec(cur);
    if (m) return decodeURIComponent(m[1] as string);
    throw new Error(`SSO 重放未拿到 ticket（HTTP ${res.status}，末跳 ${cur.slice(0, 100)}）`);
  }
  throw new Error("SSO 重放超过 10 跳");
}

async function mintViaHttp(url: string): Promise<string> {
  const res = await http.request(url);
  return parseMint(res as unknown as Response);
}

/** 层 2b：ticket 换 token——校内直连优先；校外（IP 门禁 307）走 webvpn 包装。
 *  返回 {token, viaWebvpn}：viaWebvpn=true 时聊天请求也必须走 webvpn + 携带会话 cookie。 */
async function redeemTicket(ticket: string): Promise<{ token: string; viaWebvpn: boolean }> {
  const url = `${SITE}/model-api/auth-login/check?ticket=${encodeURIComponent(ticket)}`;
  try {
    return { token: await mintViaHttp(url), viaWebvpn: false };
  } catch (e) {
    void logLine(`[MADMODEL] ticket 直连兑换失败，转 webvpn 包装：${e instanceof Error ? e.message : e}`).catch(() => undefined);
    const wUrl = webvpnWrap(url);
    const token = await mintViaHttp(wUrl);
    void logLine("[MADMODEL] webvpn 兑换成功（校外白嫖通道）").catch(() => undefined);
    return { token, viaWebvpn: true };
  }
}

/** 全阶梯获取一枚新 token 并写入 harness settings（Rust 下一轮 run 即用）。
 *  关键：成功路径决定聊天的 base_url 与 cookie——
 *  - 校内直连成功 → madmodelBase=直连、无 cookie；
 *  - 仅 webvpn 兑换成功（校外 IP 门禁）→ madmodelBase=webvpn 包装、
 *    madmodelCookie=HttpClient jar 里 webvpn 会话头（Rust 请求原样带上，
 *    wengine 网关在校园网内替我们把流量送进 madmodel）。 */
export async function ensureMadModelToken(force = false): Promise<string> {
  if (pumping && !force) throw new Error("续期进行中");
  pumping = true;
  try {
    let token = "";
    let viaWebvpn = false;
    try {
      token = await mintDirect();
    } catch (e) {
      void logLine(`[MADMODEL] 直连签发失败（可能校外 IP 门禁）：${e instanceof Error ? e.message : e}`).catch(() => undefined);
    }
    if (!token) {
      const ticket = await ssoTicket();
      const r = await redeemTicket(ticket);
      token = r.token;
      viaWebvpn = r.viaWebvpn;
    }
    const rec = getPlugin(HARNESS_ID);
    const prev = rec?.settings ?? {};
    const next: Record<string, string> = {
      ...prev,
      madmodelToken: token,
      madmodelAt: String(Date.now()),
    };
    if (viaWebvpn) {
      const chatUrl = webvpnWrap(`${SITE}/v1/chat/completions`);
      next.madmodelBase = chatUrl.replace(/\/chat\/completions$/, "");
      next.madmodelCookie = http.cookieHeaderFor(chatUrl) ?? "";
      void logLine(`[MADMODEL] 走 webvpn 通道：base=${next.madmodelBase.slice(0, 80)}… cookie=${next.madmodelCookie ? "有" : "无"}`).catch(() => undefined);
    } else {
      next.madmodelBase = "";
      next.madmodelCookie = "";
    }
    updatePlugin(HARNESS_ID, { settings: next });
    void logLine(`[MADMODEL] token 已就位（len=${token.length}${viaWebvpn ? " · webvpn" : " · 直连"}）`).catch(() => undefined);
    return token;
  } finally {
    pumping = false;
  }
}

/** 续期泵：启动即试一枚 + 每 10 分钟巡检（到期才真拉） */
export function startMadModelPump(): void {
  const tick = (): void => {
    if (!madmodelDue()) return;
    void ensureMadModelToken().catch((e) =>
      void logLine(`[MADMODEL] ${e instanceof Error ? e.message : String(e)}`).catch(() => undefined),
    );
  };
  void tick();
  setInterval(tick, 10 * 60_000).unref?.();
}
