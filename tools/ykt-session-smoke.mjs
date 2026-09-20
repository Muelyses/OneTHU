/**
 * R21-B 雨课堂会话健康真连冒烟（实验载体，非离线单测）。
 *
 * 用法（凭据走环境变量，绝不打印 Cookie 本体）：
 *   source ~/.onethu-creds.env && node tools/ykt-session-smoke.mjs
 *
 * 做什么：
 *  1) checkSession：GET /api/v3/user/basic-info —— 会话存活判定（alive/reason/归属人）
 *  2) 若存活：GET /v2/api/web/courses/list?identity=2 —— 轻量已授权请求（保活心跳载体），
 *     并报告本轮响应是否携带 Set-Cookie 透传头（Node 直连无 OneTHU 传输层，读的是
 *     原生 set-cookie；用于「服务端是否在常规 GET 上轮换」的实验观察）
 *  3) 输出一条可直接粘进 docs 的结论行（不含任何凭据）
 *
 * 实验协议（docs 三十节）：对同一会话每 6h 跑一次本脚本并记录 checkedAt/alive，
 * 观察 sessionid 自然存活时长是否显著超过「不访问 ~24h 失效」基线 → 判定保活有效性。
 */
import { createYuketangSource, isYktSessionError } from "../packages/core/src/exthw/yuketang.ts";

const cookie = process.env.YKT_COOKIE ?? "";
if (!cookie.trim()) {
  console.log("未设置 YKT_COOKIE——先 source 凭据文件再运行。");
  process.exit(1);
}
console.log(`会话串字段：${cookie.split(";").map((p) => p.split("=")[0]?.trim()).filter(Boolean).join(" / ")}（值不打印）`);

/** Node 直连（无 OneTHU 传输层）：观察原生 set-cookie 是否出现 */
const observing = [];
const fetchLike = async (url, init = {}) => {
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers ?? {}), "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.130 Safari/537.36" },
  });
  const sc = res.headers.getSetCookie?.() ?? [];
  observing.push({ url: String(url).replace(/\?.*$/, ""), setCookie: sc.map((s) => `${s.split("=")[0]}=<…>`) });
  return res;
};

const src = createYuketangSource({ cookie, uvId: process.env.YKT_UV || "2598" }, fetchLike, 30);
const h = await src.checkSession();
const at = new Date(h.checkedAt).toLocaleString("zh-CN", { hour12: false });
if (h.alive === true) {
  console.log(`[${at}] 会话有效${h.userName ? `（${h.userName}）` : ""} —— 心跳载体可用`);
  for (const o of observing) {
    console.log(`  ${o.url} → Set-Cookie ${o.setCookie.length ? o.setCookie.join(", ") : "（无）"}`);
  }
  console.log(`docs 结论行：${new Date(h.checkedAt).toISOString()} 会话有效（basic-info）`);
} else if (h.alive === false) {
  console.log(`[${at}] 会话已失效（reason=${h.reason}）——需要重新登录`);
  console.log(`docs 结论行：${new Date(h.checkedAt).toISOString()} 会话已失效（${h.reason}）`);
} else {
  console.log(`[${at}] 网络异常，会话状态未知（不判失效）`);
  process.exit(2);
}
void isYktSessionError; // 保留引用：判定口径与 core 一致（checkSession 内部已归一）
