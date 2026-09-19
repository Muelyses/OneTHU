/**
 * 雨课堂扫码登录状态机单测（离线，不联网）。
 *
 * 运行：node tools/ykt-qr-test.mjs
 *
 * 覆盖：
 *  - 未完成态（服务端明确返回 code≠0）
 *  - 单次长轮询超时 → 自动重发（同一 token）
 *  - 取消（AbortSignal）→ 立即中止、不再发请求
 *  - token 过期 → 自动重建二维码（重取 pre-info）
 *  - 成功 → 解析 Set-Cookie 并补齐清华固定字段
 *
 * 说明：core 源码内部用 `.js` 扩展名互相引用（TS bundler 解析），Node 类型剥离
 * 不能把 `.js` 映射到 `.ts` —— 这里注册一个同步 resolve 钩子做重映射后再动态 import。
 */
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.endsWith(".js") && context.parentURL?.endsWith(".ts")) {
        try {
          return next(specifier.slice(0, -3) + ".ts", context);
        } catch {
          /* 继续抛原始错误 */
        }
      }
      throw err;
    }
  },
});

const { runYuketangQrLogin, yuketangQrPoll, yuketangQrStart } = await import(
  "../packages/core/src/exthw/yuketangQr.ts"
);

/* ── 断言小工具 ── */
let failed = 0;
function ok(cond, name, extra = "") {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${extra ? " — " + extra : ""}`);
  }
}

/* ── 造一个 JWT（exp 为秒）── */
const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
const makeJwt = (expSeconds) => `${b64url({ typ: "JWT", alg: "HS256" })}.${b64url({ iat: 0, exp: expSeconds })}.sig`;

const preInfoBody = (qrContent, token) => JSON.stringify({ code: 0, msg: "", data: { qrContent, qrImage: "", token } });

/** 造响应：body 为对象 → JSON；setCookies 走传输层自定义头 */
function resp(bodyObj, setCookies) {
  const headers = {};
  if (setCookies) headers["x-onethu-set-cookie"] = JSON.stringify(setCookies);
  return new Response(typeof bodyObj === "string" ? bodyObj : JSON.stringify(bodyObj), { headers });
}

/**
 * 假 fetch：
 *  - pre-info：返回 qrContent=qrN、token=JWT(exp 由 ttlMs/虚拟时钟决定)
 *  - login：按 mode 行为（hang=长轮询挂起 / pending=返回 code≠0 / ok=Set-Cookie 成功）
 * 每次 login 调用推进虚拟时钟 stepMs（模拟长轮询耗时）。
 */
function makeFake({ ttlMs = 60_000, stepMs = 30_000, mode = "hang", limit = Infinity, ac } = {}) {
  const st = { preInfoCalls: 0, loginCalls: 0, clock: 0, qrSeq: 0 };
  const fetchLike = (url, init) => {
    const signal = init?.signal;
    if (url.includes("app-web-pre-info")) {
      st.preInfoCalls++;
      const exp = Math.round((st.clock + ttlMs) / 1000);
      return Promise.resolve(resp(JSON.parse(preInfoBody(`QR-${++st.qrSeq}`, makeJwt(exp)))));
    }
    if (url.includes("app-web-login")) {
      st.loginCalls++;
      if (st.loginCalls >= limit) ac?.abort(); // 触顶后主动取消
      if (mode === "ok") {
        return Promise.resolve(resp({ code: 0, data: {} }, ["sessionid=SESS123; Path=/", "csrftoken=CSRF456"]));
      }
      if (mode === "pending") {
        st.clock += stepMs;
        return Promise.resolve(resp({ code: 1, msg: "未扫码" }));
      }
      // hang：长轮询挂起，直到被 abort
      return new Promise((_, reject) => {
        const onAbort = () => {
          st.clock += stepMs;
          reject(new DOMException("aborted", "AbortError"));
        };
        if (signal?.aborted) return onAbort();
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    }
    return Promise.reject(new Error(`unexpected url ${url}`));
  };
  return { fetchLike, st };
}

/* ── ① 单次长轮询：超时返回 timedOut ── */
console.log("[1] 单次长轮询超时");
{
  const { fetchLike } = makeFake({ mode: "hang" });
  const r = await yuketangQrPoll(fetchLike, "tok", { timeoutMs: 20 });
  ok(r.done === false && r.timedOut === true, "未扫码挂起 → timedOut（正常，应重发）", JSON.stringify(r));
}

/* ── ② 单次长轮询：服务端明确未完成 → message ── */
console.log("[2] 服务端明确未完成");
{
  const { fetchLike } = makeFake({ mode: "pending" });
  const r = await yuketangQrPoll(fetchLike, "tok", { timeoutMs: 500 });
  ok(r.done === false && !r.timedOut && r.message === "未扫码", "code≠0 → done:false + 服务端 msg", JSON.stringify(r));
}

/* ── ③ 成功：解析 Set-Cookie + 补齐固定字段 ── */
console.log("[3] 成功取回会话");
{
  const { fetchLike } = makeFake({ mode: "ok" });
  const r = await yuketangQrPoll(fetchLike, "tok", { timeoutMs: 500 });
  ok(r.done === true, "code=0 + Set-Cookie → done:true");
  ok(!!r.cookie && r.cookie.includes("sessionid=SESS123") && r.cookie.includes("csrftoken=CSRF456"), "会话 Cookie 取回", r.cookie);
  ok(!!r.cookie && r.cookie.includes("xtbz=ykt") && r.cookie.includes("uv_id=2598") && r.cookie.includes("university_id=2598"), "补齐清华固定字段");
}

/* ── ④ 状态机：未完成态（超时重发）+ token 过期重建 ── */
console.log("[4] 状态机：超时重发 + 过期重建");
{
  const ac = new AbortController();
  const { fetchLike, st } = makeFake({ ttlMs: 60_000, stepMs: 30_000, mode: "hang", limit: 5, ac });
  const phases = [];
  const r = await runYuketangQrLogin({
    fetchLike,
    signal: ac.signal,
    pollTimeoutMs: 5,
    now: () => st.clock,
    onPhase: (p) => phases.push(p.phase),
  });
  const qrCount = phases.filter((p) => p === "qr").length;
  const expiredCount = phases.filter((p) => p === "expired").length;
  ok(r.aborted === true, "触顶取消 → aborted", JSON.stringify(r));
  ok(st.loginCalls === 5, "单次超时后自动重发（同 token 多次轮询）", `loginCalls=${st.loginCalls}`);
  ok(expiredCount >= 2 && qrCount >= 3 && st.preInfoCalls >= 3, "过期后自动重建二维码", `qr=${qrCount} expired=${expiredCount} preInfo=${st.preInfoCalls}`);
}

/* ── ⑤ 状态机：取消（卸载）立即中止，不再发请求 ── */
console.log("[5] 状态机：取消");
{
  const ac = new AbortController();
  const { fetchLike, st } = makeFake({ ttlMs: 600_000, mode: "hang" });
  setTimeout(() => ac.abort(), 30);
  const r = await runYuketangQrLogin({ fetchLike, signal: ac.signal, pollTimeoutMs: 5000, now: () => st.clock });
  ok(r.aborted === true, "取消 → aborted", JSON.stringify(r));
  ok(st.loginCalls === 1, "取消后不再发新请求", `loginCalls=${st.loginCalls}`);
}

/* ── ⑥ 状态机：成功即返回 ── */
console.log("[6] 状态机：成功");
{
  const ac = new AbortController();
  const { fetchLike, st } = makeFake({ mode: "ok" });
  const phases = [];
  const r = await runYuketangQrLogin({
    fetchLike,
    signal: ac.signal,
    pollTimeoutMs: 500,
    now: () => st.clock,
    onPhase: (p) => phases.push(p.phase),
  });
  ok(r.done === true && !!r.cookie && r.cookie.includes("sessionid=SESS123"), "扫码确认 → 返回 cookie", JSON.stringify(r));
  ok(phases[0] === "qr", "先推 qr 阶段");
}

/* ── ⑦ yuketangQrStart：解析 JWT exp ── */
console.log("[7] pre-info 解析（含 JWT exp）");
{
  const expSec = Math.floor(Date.now() / 1000) + 120; // 未来 2 分钟（< 5 分钟兜底，不被封顶）
  const fake = () => Promise.resolve(resp(JSON.parse(preInfoBody("https://x/qr", makeJwt(expSec)))));
  const info = await yuketangQrStart(fake);
  ok(info.qrContent === "https://x/qr" && info.token.startsWith("eyJ"), "返回 qrContent + token");
  ok(info.expireAt === expSec * 1000, "expireAt 取自 JWT exp", `expireAt=${info.expireAt}`);
}

/* ── ⑧ 传输层超时 → 继续轮询（R17 23.1）── */
console.log("[8] 传输层超时 → 继续轮询");
{
  // 8a：yuketangQrPoll 必须把传输层超时放大到「本地轮询 + 10s」，
  // 否则 tauriFetch/Rust http_request 会先于 AbortSignal 抢跑（扫码必失败根因）。
  let seenTimeoutMs;
  const fetchLike = (url, init) => {
    if (url.includes("app-web-pre-info")) {
      return Promise.resolve(resp(JSON.parse(preInfoBody("QR-T", makeJwt(Math.floor(Date.now() / 1000) + 120)))));
    }
    seenTimeoutMs = init?.timeoutMs;
    return Promise.resolve(resp({ code: 1, msg: "未扫码" }));
  };
  await yuketangQrPoll(fetchLike, "tok", { timeoutMs: 28_000 });
  ok(seenTimeoutMs === 38_000, "传输层超时 = 本地轮询 + 10s", `timeoutMs=${seenTimeoutMs}`);
}
{
  // 8b：传输层抛超时（reqwest `operation timed out` / JS 兜底「请求超时」）
  // → 归为 timedOut（未扫码），交由状态机重发，而非当硬错误退出。
  const boom = () =>
    Promise.reject(
      new Error(
        "网络错误: error sending request for url (https://pro.yuketang.cn/api/v3/user/login/app-web-login): operation timed out",
      ),
    );
  const r = await yuketangQrPoll(boom, "tok", { timeoutMs: 500 });
  ok(r.done === false && r.timedOut === true, "传输层超时 → timedOut（继续轮询）", JSON.stringify(r));
}
{
  // 8c：状态机：第一次传输超时、第二次成功 —— 不得因传输超时退出。
  let loginCalls = 0;
  const fetchLike = (url) => {
    if (url.includes("app-web-pre-info")) {
      return Promise.resolve(resp(JSON.parse(preInfoBody("QR-T", makeJwt(Math.floor(Date.now() / 1000) + 120)))));
    }
    loginCalls++;
    if (loginCalls === 1) {
      return Promise.reject(
        new Error(
          "网络错误: error sending request for url (https://pro.yuketang.cn/api/v3/user/login/app-web-login): operation timed out",
        ),
      );
    }
    return Promise.resolve(resp({ code: 0, data: {} }, ["sessionid=SESS123"]));
  };
  const r = await runYuketangQrLogin({ fetchLike, pollTimeoutMs: 1000, now: () => 0 });
  ok(r.done === true && !!r.cookie, "传输超时后继续轮询 → 最终成功", JSON.stringify(r));
  ok(loginCalls === 2, "传输超时被重发（非硬错误退出）", `loginCalls=${loginCalls}`);
}

console.log(failed === 0 ? "\n全部通过 ✅" : `\n${failed} 项失败 ❌`);
process.exit(failed === 0 ? 0 : 1);
