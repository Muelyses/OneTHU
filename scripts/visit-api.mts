/**
 * 临时来访报备（visit.tsinghua.edu.cn）接口面扫描：拿 visit-probe 打出的 token，
 * 在正确的 /visitor/mbpm 前缀下逐个试端点，确定「读/写」两面的真实路径。
 * 用法：VISIT_TOKEN=xxx pnpm exec tsx scripts/visit-api.mts
 */
import { DEFAULT_USER_AGENT } from "../packages/core/src/index.js";

const SITE = "https://visit.tsinghua.edu.cn";
const BASE = `${SITE}/visitor/mbpm`;
const token = process.env.VISIT_TOKEN ?? "";
if (!token) throw new Error("需要 VISIT_TOKEN");

async function call(method: string, path: string, body?: unknown, json = true) {
  const headers: Record<string, string> = { "User-Agent": DEFAULT_USER_AGENT, token };
  let payload: string | undefined;
  if (body !== undefined) {
    if (json) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
    else { headers["Content-Type"] = "application/x-www-form-urlencoded"; payload = new URLSearchParams(body as Record<string, string>).toString(); }
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  const text = await res.text();
  return { status: res.status, text };
}

const gets = [
  "/identity/getUserInfo",
  "/identity/userInfo",
  "/identity/getInfo",
  "/user/getUserInfo",
  "/app/getAppInfo",
  "/app/getAppList",
  "/app/getMenu",
  "/menu/getMenu",
  "/permission/getPermission",
  "/permission/getRouters",
  "/mexform/getFormModel",
  "/mexform/getFormList",
  "/formModel/list",
  "/queryList/list",
  "/query/getQueryList",
  "/dashboard/getData",
  "/index/getIndexData",
  "/visitorList/list",
  "/visitor/list",
  "/record/list",
  "/apply/list",
  "/personalCenter/getUserInfo",
];
console.log("=== GET 扫描 ===");
for (const p of gets) {
  try {
    const r = await call("GET", p);
    console.log(`  ${p} -> ${r.status} ${r.text.slice(0, 200).replace(/\s+/g, " ")}`);
  } catch (e) { console.log(`  ${p} -> ERR ${String(e).slice(0, 80)}`); }
}

console.log("\n=== 带常见 appId 的应用信息（POST，前端登录后会拉）===");
for (const body of [
  { clientId: "04655f71b042b9d2d8d10cd566bd9c39" },
  { id: "campusAppointment" },
]) {
  for (const p of ["/app/getAppInfo", "/app/getAppInfoById"]) {
    const r = await call("POST", p, body, false);
    console.log(`  POST ${p} ${JSON.stringify(body)} -> ${r.status} ${r.text.slice(0, 260).replace(/\s+/g, " ")}`);
  }
}
console.log("\n=== token 自证 ===");
const self = await call("GET", "/identity/getUserInfo");
console.log(`  identity/getUserInfo -> ${self.status} ${self.text.slice(0, 400)}`);
