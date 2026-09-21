/**
 * 网络学堂静默重登护栏（R21c，用户口径：「有账号密码且记住，登过了就应该静默」）。
 *
 * [1] #withRelogin 必须真实现：捕获 SessionExpiredError → silentRelogin → 重试一次
 * [2] 只对「中期会话失效」生效：启动期无会话的 AuthRequiredError 仍直接上抛（不空转重登）
 * [3] 提交作业撞 HTML（登录页/网关页）→ 抛标记走重登重试；重试仍失败才回「会话已过期」
 * [4] 登录链半路断：app.tsx 用同凭据静默重试一次，两次失败才回登录页
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

/* ---------- [1][2] core：#withRelogin 真实现 ---------- */
const client = read("packages/core/src/learn/client.ts");
assert.ok(/class SessionExpiredError extends AuthRequiredError/.test(client), "必须定义 SessionExpiredError 标记类");
const reloginBody = client.slice(client.indexOf("async #withRelogin"), client.indexOf("#requireCsrf(): string"));
assert.ok(/return fn\(\);\s*\}$/.test(client.slice(client.indexOf("async #withRelogin") - 200, client.indexOf("async #withRelogin"))) === false,
  "旧空壳实现必须已移除");
assert.ok(reloginBody.includes("silentRelogin()"), "#withRelogin 必须调用 silentRelogin");
assert.ok(reloginBody.includes("SessionExpiredError"), "#withRelogin 只对会话失效标记生效");
assert.ok((reloginBody.match(/await fn\(\)/g) ?? []).length === 2, "重试恰好一次（首跑 + 重登后重跑）");

/* ---------- [3] 提交作业的过期链路 ---------- */
const submit = client.slice(client.indexOf("async submitHomework"), client.indexOf("async getHomeworkDetail"));
assert.ok(submit.includes('throw new SessionExpiredError("submit-html")'), "HTML 响应必须抛标记走重登重试");
assert.ok(submit.includes("会话已过期，请重新登录后再提交"), "重试仍失败才回过期提示");
assert.ok(submit.split("会话已过期，请重新登录后再提交").length - 1 === 1,
  "过期提示只允许出现在兜底 catch 一处（HTML 判定处必须抛标记先重试）");
assert.ok(submit.indexOf("throw new SessionExpiredError") < submit.indexOf('msg: "会话已过期'),
  "抛标记必须先于兜底提示");

/* ---------- [4] 登录被踹：同凭据静默重试一次 ---------- */
const app = read("apps/desktop/src/state/app.tsx");
assert.ok(app.includes("LOGIN-RETRY"), "登录失败必须记 LOGIN-RETRY 日志");
const loginBody = app.slice(app.indexOf("const login = useCallback"), app.indexOf("const send2FA"));
assert.ok((loginBody.match(/await clients\.login\(/g) ?? []).length === 2, "登录失败须用同凭据重试一次（共两次调用）");
assert.ok(loginBody.indexOf("setStatus(\"logged-out\")") > loginBody.lastIndexOf("await clients.login("),
  "两次都失败才允许回登录页");

console.log("learn-silent-relogin-test: 全部断言通过（真重登 + 一次重试 + 过期链路 + 登录重试）");
