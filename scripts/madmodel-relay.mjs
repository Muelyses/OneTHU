#!/usr/bin/env node
/* MadModel 校外中继（自用奇技）：跑在校园网内的 Mac/PC 上，把任意设备
 * （手机流量/Tailscale/局域网）发来的 OpenAI 兼容请求转发到 madmodel，
 * 自动维护 6h token（直接复用本仓库 state/madmodel.ts 的阶梯语义）。
 * 用法：node scripts/madmodel-relay.mjs [端口，默认 8787]
 * 手机侧：OH 设置 → 模型源=自费 API → baseUrl=http://<Mac的IP>:8787/v1
 *         model=DeepSeek-V4-Flash-0731，Key 随便填（中继注入真 token）。
 */
import http from "node:http";

const SITE = "https://madmodel.cs.tsinghua.edu.cn";
const PORT = Number(process.argv[2] || 8787);
let token = "", at = 0;
const FRESH = 5 * 3600e3 + 50 * 60e3;

async function mint() {
  if (token && Date.now() - at < FRESH) return token;
  const r = await (await fetch(`${SITE}/model-api/auth-login/check`)).json();
  if (r.success !== true || typeof r.data !== "string") throw new Error("madmodel mint 失败");
  token = r.data; at = Date.now();
  console.log(`[relay] token 续期 ok（${token.length}B）`);
  return token;
}
await mint().catch((e) => { console.error("[relay] 首签失败（确认在校园网内）:", e.message); process.exit(1); });

http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const path = req.url.replace(/^\/v1/, "");
  try {
    const t = await mint();
    const up = await fetch(`${SITE}/v1${path}`, {
      method: req.method,
      headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
      body: ["GET", "HEAD"].includes(req.method) ? undefined : body,
    });
    res.writeHead(up.status, { "Content-Type": up.headers.get("content-type") ?? "application/json" });
    if (up.body) for await (const c of up.body) res.write(c); // SSE 透传
    res.end();
  } catch (e) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: String(e) } }));
  }
}).listen(PORT, () => console.log(`[relay] http://0.0.0.0:${PORT}/v1 —— 手机 baseUrl 填 http://<本机IP>:${PORT}/v1`));
