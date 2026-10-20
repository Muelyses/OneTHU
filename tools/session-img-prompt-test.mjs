/**
 * 正文图片因登录状态失效加载失败时的弹窗护栏。
 *
 * 背景（2026-09-25 实录）：PC 上通知正文的图片全部变成半透明碎图，用户无从推断原因。
 * 真机/PC 现场查下去是登录态失效——原生 `fetch_binary` 拿回登录页时**直接抛字符串**
 * 「会话已失效，需要重新登录」，而 `RichContent` 的 `catch {` 不接错误、只把图调暗，
 * 数据页那条「登录状态已失效」提示链又完全不覆盖这条旁路。
 * 2026-10-12 用户令：别用会自己消失的中央提示，改成带按钮的弹窗——复用
 * `lib/confirm` 的非危险档（`confirmChoice`）：主按钮「重新登录」，次按钮「忽略」。
 *
 * [1] isSessionExpiredError 判定（字符串错误 / Error / 其他失败不得误报）
 * [2] 接线守卫：catch 接住错误、会话类才弹、两个按钮、去重窗口、「重新登录」的去向
 *
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/session-img-prompt-test.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { isSessionExpiredError, rawErrorText } = await import("../apps/desktop/src/lib/sessionErrors.ts");

/* ---------- [1] 判定 ---------- */

// 原生 fetch_binary 抛的就是字符串
assert.equal(isSessionExpiredError("会话已失效，需要重新登录"), true, "原生字符串错误必须认出来");
assert.equal(isSessionExpiredError(new Error("会话已失效，需要重新登录")), true, "core 的 SessionExpiredError 必须认出来");
assert.equal(isSessionExpiredError("未登录"), true, "「未登录」同类");
assert.equal(isSessionExpiredError({ message: "需要重新登录" }), true, "带 message 的对象错误也要认");
// 不能误报：图片失败有一堆别的原因，只有登录态那一类才该弹「请重新登录」
assert.equal(isSessionExpiredError("too-large:9000000:8388608"), false, "文件过大不是登录态问题");
assert.equal(isSessionExpiredError("图片直连响应非图片（mime=text/css bytes=120）"), false, "响应非图片不等于登录态失效");
assert.equal(isSessionExpiredError("网络超时：请确认校园网 / WebVPN 可达。"), false, "网络超时不是登录态问题");
assert.equal(isSessionExpiredError(""), false, "空原因不弹");
assert.equal(isSessionExpiredError(undefined), false, "undefined 不弹");
assert.equal(rawErrorText("abc"), "abc", "rawErrorText 对字符串原样返回（判定复用它的口径）");

/* ---------- [2] 接线守卫 ---------- */

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const shared = read("apps/desktop/src/pages/learn/shared.tsx");
const confirm = read("apps/desktop/src/lib/confirm.tsx");
const settingsMode = read("apps/desktop/src/state/settingsMode.ts");

// catch 必须接住错误：`catch {` 会把原因整个丢掉（这正是当时查不出原因的直接原因）
assert.ok(/catch \(e\) \{/.test(shared), "RichContent 的 catch 必须接住错误变量");
assert.ok(!/catch \{\s*\n\s*if \(!cancelled\)/.test(shared), "不许再回到不接错误变量的裸 catch");
assert.ok(shared.includes("isSessionExpiredError(e)"), "登录态类失败必须走判定函数");
assert.ok(shared.includes("${reason.slice(0, 120)}"), "log_debug 行必须带上失败原因，不再只有 URL");
assert.ok(shared.includes('img.setAttribute("title"'), "碎图要能悬停看到原因");

// 弹窗（不是 toast）：文案、两个按钮、复用既有确认弹窗
assert.ok(!shared.includes("state/toast.js"), "本文件不再依赖轻提示（改弹窗）");
assert.ok(shared.includes("promptImagesNeedLogin("), "登录态类失败必须走弹窗接线");
assert.ok(shared.includes("CONFIRM_IMG_RELOGIN"), "必须复用 lib/confirm 的场景预设");
assert.ok(
  /confirmChoice\(IMG_RELOGIN_MSG,\s*CONFIRM_IMG_RELOGIN\)/.test(shared),
  "弹窗必须走 confirmChoice（非危险档：没有「不可撤销」的红色警告）",
);
assert.ok(shared.includes("登录状态可能已失效"), "说明文案必须在位");
assert.ok(
  shared.includes("sessionPromptOpen") && /lastSessionPromptAt/.test(shared) && shared.includes("SESSION_PROMPT_GAP_MS"),
  "去重：弹窗开着不叠加 + 10s 窗口（一页十几张图会一起失败）",
);

// 主按钮的去向：设置页「账号」页签（统一认证的退出/重登都在那儿）
assert.ok(
  shared.includes('requestSettingsTab("账号")') && shared.includes('navigate("settings")'),
  "「重新登录」必须落到设置页账号区",
);
assert.ok(
  settingsMode.includes("export function requestSettingsTab") && settingsMode.includes('"账号"'),
  "必须复用既有的设置页签深链，而不是自己另造一套跳转",
);

// 组件侧：非危险档（confirmChoice）的两个按钮文案都由场景给，组件只兜底（R21c 同款道理）
const choiceFn = confirm.slice(
  confirm.indexOf("export function confirmChoice("),
  confirm.indexOf("export function answerConfirm("),
);
assert.ok(confirm.includes("export function confirmChoice("), "confirmChoice 必须在位（非危险档入口）");
assert.ok(!/danger/.test(choiceFn), "confirmChoice 不得落进危险档（用户令：不要那套红色警告）");
assert.ok(
  /confirmChoice\(\s*msg: string,\s*opts: \{ title\?: string; confirmText: string; cancelText: string \},?\s*\)/.test(confirm),
  "两个按钮文案必须必填——「取消 / 确定」在二选一里等于没说",
);
assert.ok(
  confirm.includes('{shown?.cancelText ?? "取消"}') && confirm.includes('{shown?.confirmText ?? (shown?.danger ? "确认执行" : "确定")}'),
  "非危险档要真的渲染两个自定义文案（不能只加字段不用）",
);
assert.ok(/confirmText: "重新登录", cancelText: "忽略"/.test(confirm), "预设必须是「重新登录 / 忽略」两个按钮");
// 危险档（退选/忽略作业）不该被这次改动碰到：仍固定「取消」，不引入可自定义的次按钮
const dangerFn = confirm.slice(confirm.indexOf("export function confirmDanger("),confirm.indexOf("export function confirmChoice("));
assert.ok(!dangerFn.includes("cancelText") && confirm.includes('{shown?.cancelText ?? "取消"}'), "危险档不接收自定义次按钮，仍使用「取消」兜底");

/* ---------- [3] 取数形态守卫（2026-10-12 真机根因：直连 learn 域没有会话） ----------
 * 同一 URL 实测：直连 → 69 字节 `location.href="/"` 跳转页；webvpn 包装 + 原生通道 →
 * 200 image/jpeg。故图片必须走「包装域 + nativeFetch」，不得回头用 fetch_binary
 * （那条自带 Mac UA + 只吃 JS 侧 cookie，wengine 按 UA 指纹校验会判票无效）。 */
const clients = read("apps/desktop/src/lib/clients.ts");
const targetFn = clients.slice(
  clients.indexOf("export function sessionUrl("),
  clients.indexOf("export function bytesToBase64("),
);
assert.ok(targetFn.length > 0, "sessionUrl 必须在位（图片/附件 URL 归一 + 分流包装）");
assert.ok(
  targetFn.includes("normalizeWebvpnUrl") && targetFn.includes("http.webVPNEncoder") && targetFn.includes("withLearnCsrf"),
  "URL 必须先归一双重包装、再按 host 分流换成包装形态、最后补 learn 的 _csrf",
);
const imgFn = clients.slice(
  clients.indexOf("async function fetchImageDataUrl"),
  clients.indexOf("export async function fetchImageAsDataUrl"),
);
assert.ok(imgFn.length > 0, "取图必须收进 fetchImageDataUrl（单一实现）");
assert.ok(imgFn.includes("nativeFetch(") && imgFn.includes("sessionUrl("), "图片必须走「包装域 + 原生通道」（与数据链同一会话世界）");
assert.ok(!/invoke<[^>]*>\("fetch_binary"/.test(imgFn), "图片不得再走 fetch_binary（Mac UA + JS 侧 cookie 会被判票无效）");
assert.ok(imgFn.includes("会话已失效，需要重新登录"), "登录墙/跳转页必须归类成「登录态失效」，否则提示链断掉");
assert.ok(imgFn.includes("IMG_MAX_BYTES") && imgFn.includes("图片响应非图片"), "mime 与大小守卫必须保留（防把登录页塞进 <img>）");
assert.ok(
  /export async function fetchImageAsDataUrl\(url: string\): Promise<string> \{\s*return fetchImageDataUrl\(url, false\);/.test(clients) &&
    /export async function fetchImageByUrl\(url: string, forceWrap = false\): Promise<string> \{\s*return fetchImageDataUrl\(url, forceWrap\);/.test(clients),
  "两个对外入口都必须委托同一实现（不再各写一份取数）",
);
// 同类根因：附件二进制预览（FilePreview）也必须同走这一套，不得各留一份 fetch_binary 取数
const preview = read("apps/desktop/src/components/FilePreview.tsx");
const previewFn = preview.slice(
  preview.indexOf("async function fetchBinary"),
  preview.indexOf("/* ---------- Office 本地解析"),
);
assert.ok(previewFn.length > 0, "FilePreview.fetchBinary 必须在位");
assert.ok(previewFn.includes("sessionUrl(") && previewFn.includes("nativeFetch("), "附件预览必须同走「包装域 + 原生通道」");
assert.ok(!/invoke<[^>]*>\("fetch_binary"/.test(previewFn), "附件预览不得再用 fetch_binary（同一根因：Mac UA + JS 侧 cookie）");
assert.ok(previewFn.includes("too-large:"), "预览大小闸门的错误格式必须保留（errMsg 认它给出「下载/另存为」出路）");
assert.ok(previewFn.includes("会话已失效，需要重新登录"), "附件预览的登录墙也要给出「请重新登录」而不是解析失败");
// 下载路径（第三处同族）：JS 两个入口走 sessionUrl；Rust fetch_attachment 用 SESSION_UA + 合并原生仓 cookie
const dlFn = clients.slice(
  clients.indexOf("export async function saveLearnUrlAs"),
  clients.indexOf("export async function fetchImageAsDataUrl"),
);
assert.ok(dlFn.length > 0, "saveLearnUrlAs / downloadLearnUrl 必须在位");
assert.ok((dlFn.match(/sessionUrl\(/g) ?? []).length >= 2, "两个下载入口都必须走 sessionUrl（归一 + host 分流包装）");
assert.ok(!/withLearnCsrf\(normalizeWebvpnUrl/.test(dlFn), "下载入口不得只做归一（直连 learn 域没有会话）");
const rustLib = read("apps/desktop/src-tauri/src/lib.rs");
const attachFn = rustLib.slice(
  rustLib.indexOf("pub(crate) async fn fetch_attachment"),
  rustLib.indexOf("async fn download_file"),
);
assert.ok(attachFn.length > 0, "Rust fetch_attachment 必须在位（download_file / save_file_as 共用）");
assert.ok(!/Macintosh/.test(attachFn), "fetch_attachment 不得再写死 Mac UA（与主 webview 不一致的票会被判无效）");
assert.ok(attachFn.includes("SESSION_UA"), "fetch_attachment 必须用与主 webview 一致的 SESSION_UA");
assert.ok(
  attachFn.includes("merge_session_cookies(url, cookies)"),
  "fetch_attachment 必须合并原生仓 cookie（同名以原生仓为准；JS 侧仓只有半份票）",
);
assert.ok(
  /const SESSION_UA: &str = "Mozilla\/5\.0 \(Windows NT 10\.0; Win64; x64\)/.test(rustLib) &&
    /\.user_agent\(SESSION_UA\)/.test(rustLib),
  "SESSION_UA 必须是主 webview 那个 UA，且原生通道也复用它（单一真源）",
);
assert.ok(/fn merge_session_cookies\(url: &str, js_cookies: &str\)/.test(rustLib), "merge_session_cookies 必须在位");

console.log("session-img-prompt-test: 全部断言通过（登录态判定 10 态 + 弹窗接线 + 取数形态守卫）");
