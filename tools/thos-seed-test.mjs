/**
 * 应用内官方页「共享登录态」的种票护栏（源码级断言）。
 *
 * 两次事故原型（都是同一处）：
 *   ① 种票不带 Domain → wry 的 set_cookie 静默丢弃（返回 Ok、计数照涨），
 *      日志显示「已种 8 条会话票」而窗口里仍是登录页；
 *   ② 该修复只存在于工作区、没入库 → 重建二进制后悄悄回归。
 * 所以这里直接把「必须带域」钉死在源码上，谁改回去谁红。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lib = readFileSync(new URL("../apps/desktop/src-tauri/src/lib.rs", import.meta.url), "utf8");
const kt = readFileSync(
  new URL("../apps/desktop/src-tauri/plugins/onethu-mobile/android/src/main/java/app/onethu/mobile/OnethuMobilePlugin.kt", import.meta.url),
  "utf8",
);

// ① 在线服务（桌面独立窗口）：按 base 域逐组种，禁止再出现「域走默认」
const thosWindow = lib.slice(lib.indexOf("async fn thos_portal_window"), lib.indexOf("#[tauri::command]\nasync fn thos_open_portal"));
assert.ok(thosWindow.includes("Domain={host}"), "THOS 独立窗口种票必须带 Domain={host}");
assert.ok(!thosWindow.includes("let _ = base;"), "不能再用默认域（域走默认 = 静默丢弃）");
assert.ok(thosWindow.includes("url::Url::parse(base)"), "Domain 必须取自每个 base 的 host");

// ② 场馆官方窗口：sports 域显式种票
assert.ok(lib.includes("Domain=www.sports.tsinghua.edu.cn"), "场馆窗口种票必须带 sports 域");

// ③ 雨课堂作答窗口：一样要有域
assert.ok(lib.includes("Domain=.yuketang.cn"), "雨课堂窗口种票必须带 yuketang 域");

// ④ Android：全屏 WebView 的 cookie 归属域由 cookieUrl 决定（在线服务传目标 origin）
assert.ok(lib.includes('"cookieUrl": target_origin'), "Android 在线服务种票必须传目标 origin 作为归属域");
assert.ok(kt.includes("cm.setCookie(seedUrl"), "Kotlin 侧必须用 seedUrl 种票（带归属域）");
assert.ok(kt.includes("cookieUrl.ifBlank"), "cookieUrl 为空时应回落到目标 url 的 origin");

console.log("结果：应用内官方页种票带域 ✓（7 组断言）");
