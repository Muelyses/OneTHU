/**
 * thu-info-lib 平台接线层（dev2 管线移植 2026-09-16）。
 *
 * 架构定案（docs/INFOLIB-PIPELINE-REVIEW.md）：WebVPN 即网络。lib 的登录链
 * （SM2 + 2FA hooks + roam-id）建立唯一 webvpn 会话；Cookie 经 tauriFetch 逐跳
 * 记账回灌共享 http.jar —— lib 与 OneTHU 自有客户端（learn/info/zhjwxk/venue）
 * 从此共用同一会话命名空间，双通道互踢在物理上不可能发生。
 *
 * 本文件职责：
 * - platformFetch 注入（tauriFetch：连接池 + 重定向逐跳 + 每跳 cookie 供应）
 *   并把每跳 Set-Cookie 回灌 http.jar（单一会话事实源）
 * - SM2 加密器注入（@onethu/core 的 encryptPassword，OneTHU 自有实现）
 * - 2FA futures：lib 的同步 hooks 桥接 OneTHU 的两段式 UI（选方式→发码→输码）
 * - 登录/验证/登出/会话守卫（libEnsureSession：lib verifyAndReLogin 语义）
 */
import { tauriFetch } from "./transport.js";
import { http } from "./clients.js";
import { setPlatformFetch, setPlatformClearCookies } from "@onethu/info-lib/network";
import { setSm2Encryptor } from "@onethu/info-lib/utils/sm2";
import { InfoHelper } from "@onethu/info-lib";
import { sm2crypto, makeFingerprint, type TwoFactorMethod } from "@onethu/core";

let initialized = false;

async function log(line: string): Promise<void> {
  const { logLine } = await import("./clients.js");
  await logLine(line).catch(() => undefined);
}

/** 注入平台传输（幂等） */
export function initInfoLib(): InfoHelper {
  if (!initialized) {
    setPlatformFetch(async (url, init) => {
      const res = await tauriFetch(url, {
        method: init.method ?? "GET",
        body: init.body,
        headers: init.headers as Record<string, string> | undefined,
      });
      // 每跳 Set-Cookie 回灌共享 jar（x-onethu-set-cookie-hops 由 tauriFetch 逐跳
      // 记录；jar.setFromResponse 消费同名头并按真实域分桶）——lib 会话进 jar，
      // OneTHU 客户端即刻可见；反之旧会话 cookie 也随 hopCookieProvider 供应给 lib。
      try {
        const finalUrl = res.headers.get("x-onethu-final-url") ?? res.url ?? url;
        http.jar.setFromResponse(new URL(finalUrl), res);
      } catch {
        /* 忽略畸形 URL */
      }
      // lib uFetch 契约：image/pdf/octet-stream 以 base64 文本回传
      const ctype = res.headers.get("content-type") ?? "";
      let text: string;
      if (/image\/|pdf|octet-stream/.test(ctype)) {
        const buf = await res.arrayBuffer();
        let bin = "";
        const u8 = new Uint8Array(buf);
        for (let i = 0; i < u8.length; i += 0x8000) {
          bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
        }
        text = btoa(bin);
      } else {
        text = await res.text();
      }
      void log(`ILIB ${init.method ?? "GET"} ${res.status} ${url.slice(0, 90)} → ${text.slice(0, 120).replace(/\s+/g, " ")}`);
      return {
        status: res.status,
        headers: Array.from(res.headers.entries()),
        text,
        finalUrl: res.headers.get("x-onethu-final-url") ?? res.url ?? url,
      };
    });
    setPlatformClearCookies(() => {
      http.jar.clear();
    });
    // SM2 密码加密（OneTHU 自有实现；未注入时 lib 回退明文=上游 MIT 边界原行为）
    setSm2Encryptor((password, publicKey) => sm2crypto.encryptPassword(password, publicKey));
    initialized = true;
  }
  return helper;
}

/** InfoHelper 单例（userId/password/fingerGenPrint 驻留内存，供静默重登免 2FA） */
export const helper = new InfoHelper();

/* ═══════════════ 2FA futures：lib 同步 hooks ⇄ OneTHU 两段式 UI ═══════════════ */

const METHOD_NAMES: { [k in "wechat" | "mobile" | "totp"]: string } = {
  wechat: "企业微信",
  mobile: "手机短信",
  totp: "TOTP 验证器",
};

let methodsNotify: ((methods: TwoFactorMethod[]) => void) | null = null;
let resolveMethod: ((t: "wechat" | "mobile" | "totp") => void) | null = null;
let resolveCode: ((code: string) => void) | null = null;
let pendingTrust = false;

helper.twoFactorMethodHook = (hasWeChatBool, phone, hasTotp) => {
  const methods: TwoFactorMethod[] = [];
  if (hasWeChatBool) methods.push({ type: "wechat", name: METHOD_NAMES.wechat });
  if (phone) methods.push({ type: "mobile", name: METHOD_NAMES.mobile, detail: phone });
  if (hasTotp) methods.push({ type: "totp", name: METHOD_NAMES.totp });
  void log("2FA need-methods: " + methods.map((m) => m.type).join(","));
  return new Promise((resolve) => {
    methodsNotify?.(methods);
    resolveMethod = (t) => {
      resolveMethod = null;
      resolve(t);
    };
  });
};

helper.twoFactorAuthHook = () =>
  new Promise<string>((resolve) => {
    resolveCode = (code) => {
      resolveCode = null;
      resolve(code);
    };
  });

helper.trustFingerprintHook = async () => pendingTrust;
helper.trustFingerprintNameHook = async () => "OneTHU";
helper.twoFactorAuthLimitHook = async () => {
  void log("2FA 受信设备数达上限（登录继续，本次未信任）");
};

/* ═══════════════ 登录链 ═══════════════ */

interface InflightLogin {
  p: Promise<void>;
  settled: boolean;
  username: string;
  password: string;
}
let inflight: InflightLogin | null = null;

/** 启动 lib 登录链（不等待完成）。methodsPromise 在进入 2FA 时 resolve。 */
function startLoginRaw(username: string, password: string): {
  p: Promise<void>;
  methodsPromise: Promise<TwoFactorMethod[]>;
} {
  helper.fingerGenPrint = sessionFinger3 ?? "";
  let methodsResolve!: (m: TwoFactorMethod[]) => void;
  const methodsPromise = new Promise<TwoFactorMethod[]>((res) => (methodsResolve = res));
  methodsNotify = (m) => {
    methodsNotify = null;
    methodsResolve(m);
  };
  const p = helper.login({ userId: username, password });
  const entry: InflightLogin = { p, settled: false, username, password };
  inflight = entry;
  void p.finally(() => {
    entry.settled = true;
  });
  return { p, methodsPromise };
}

/** finger3 注入口（clients.ts 持久层回填；受信凭据 → 静默重登免 2FA） */
let sessionFinger3: string | null = null;
export function setLibFinger3(finger3: string): void {
  sessionFinger3 = finger3;
  helper.fingerGenPrint = finger3;
}

export type LibLoginResult =
  | { state: "ready" }
  | { state: "need-2fa"; methods: TwoFactorMethod[] };

/** 登录：ready 或 need-2fa（lib 链挂起等待 futures；verify2FA 续完） */
export async function libLogin(
  username: string,
  password: string,
  fingerprint: string,
): Promise<LibLoginResult> {
  helper.fingerprint = fingerprint || makeFingerprint();
  const { p, methodsPromise } = startLoginRaw(username, password);
  const settled = await Promise.race([
    p.then(
      () => "ready" as const,
      (e) => {
        throw e;
      },
    ),
    methodsPromise.then(() => "2fa" as const),
  ]);
  if (settled === "ready") return { state: "ready" };
  // 等 method hook 真正登记完成（methodsNotify 先于 resolveMethod）
  const methods = await methodsPromise;
  return { state: "need-2fa", methods };
}

/** 用户选定验证方式（lib 收到后自行 SEND_CODE）
 *  重发场景：lib 的两段 hooks 均为一次性——重复点击时静默忽略（UI 的验证码
 *  仍有效；过期则 verify 报错后自动重启链重走 2FA）。 */
export async function libSend2FA(type: string): Promise<void> {
  const r = resolveMethod;
  if (r) {
    r(type as "wechat" | "mobile" | "totp");
    return;
  }
  void log("2FA 方式已选定（重复发送忽略）: " + type);
}

''/** 提交验证码（+是否信任设备）。lib 链在此续完：VERITY → SAVE_FINGER → 落地 → roam-id。
 *  验证码错误时 lib 单发链已死：自动用内存凭据重启链并自动应答方式选择，
 *  用户下一次提交直接可用（UI 无需返回重选）。 */
export async function libVerify2FA(type: string, code: string, trust: boolean): Promise<void> {
  if (!inflight || inflight.settled) {
    const username = inflight?.username ?? "";
    const password = inflight?.password ?? "";
    const { p, methodsPromise } = startLoginRaw(username, password);
    void methodsPromise.then(() => {
      resolveMethod?.(type as "wechat" | "mobile" | "totp");
    });
  }
  if (!inflight) throw new Error("登录会话不存在");
  resolveMethod?.(type as "wechat" | "mobile" | "totp");
  pendingTrust = trust;
  resolveCode?.(code);
  await inflight.p;
  // 成功：SAVE_FINGER 的受信凭据已写入 helper.fingerGenPrint（本次 trust=true 时）
}

/** 登出（lib 链 + 共享 jar） */
export async function libLogout(): Promise<void> {
  try {
    await helper.logout();
  } catch {
    /* 网络层失败不阻断本地登出 */
  }
  http.jar.clear();
}

/** 会话守卫（lib verifyAndReLogin 语义，供 InfoClient renewers / auth-dance 重连）：
 *  探测门户会话；死且内存有凭据 → 完整重登（受信凭据在 → 免 2FA）。 */
export async function libEnsureSession(): Promise<boolean> {
  try {
    const probe = await tauriFetch(
      "https://webvpn.tsinghua.edu.cn/wengine-vpn/cookie?method=get&host=info2021.tsinghua.edu.cn&scheme=https&path=/f/info/gxfw_fg/common/index",
      { method: "GET" },
    );
    const body = await probe.text();
    if (probe.status === 200 && /XSRF-TOKEN=/.test(body)) {
      try {
        http.jar.setFromResponse(new URL("https://webvpn.tsinghua.edu.cn/"), probe);
      } catch {
        /* ignore */
      }
      return true;
    }
  } catch {
    /* 网络失败按死会话处理 */
  }
  if (!inflight || inflight.settled) {
    if (!inflight?.username || !inflight?.password) return false;
    const r = await libLogin(inflight.username, inflight.password, helper.fingerprint).catch(() => null);
    if (r?.state === "ready") return true;
    return false; // need-2fa：静默重登撞墙，等人工
  }
  await inflight.p.catch(() => undefined);
  return true;
}

/** 内存凭据访问（静默重登用） */
export function libCredentials(): { username: string; password: string } | null {
  if (!inflight?.username || !inflight?.password) return null;
  return { username: inflight.username, password: inflight.password };
}
