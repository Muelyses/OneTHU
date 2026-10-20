/** Render-time translation of persisted library failures; external school messages stay verbatim. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { localizeLibraryError } from "../apps/desktop/src/pages/info/libraryErrorText.ts";
import { setLocale, localeTable } from "../apps/desktop/src/i18n/index.ts";

const recovery = "图书馆登录状态未能恢复，请先重试；若仍失败，请在设置中重新登录";
const unavailable = "图书馆座位系统会话未能建立（现场: lib-token 未提取）";
const expired = "图书馆会话已失效，请重试。请重新登录后再试。";
const legacy = "图书馆 access_token 获取失败（首页无 token；抓取页 URL: https://seat.lib.tsinghua.edu.cn/home/web/f_second）。建议：退出 OneTHU";
const external = "学校提示：今日取消次数已用完";
setLocale("zh-CN");
assert.equal(localizeLibraryError(recovery), recovery);
setLocale("en-US");
assert.match(localizeLibraryError(recovery), /^Your library session could not be restored\./);
assert.match(localizeLibraryError(unavailable), /^Your library account could not be connected\./);
assert.equal(localizeLibraryError(legacy), localizeLibraryError(recovery));
assert.equal(localizeLibraryError(expired), "Your library session has expired. Please try again.");
assert.equal(localizeLibraryError(external), external);
setLocale("zh-CN");
assert.equal(localizeLibraryError(recovery), recovery, "same stored raw error follows a later language change");
const seed = JSON.parse(fs.readFileSync(new URL("../docs/i18n/library-seat-seed.json", import.meta.url), "utf8")).messages;
for (const [key, values] of Object.entries(seed)) for (const locale of ["zh-CN", "en-US"]) {
  assert.equal(localeTable(locale)[key], values[locale], "seed and runtime dictionary agree: " + key);
}
const page = fs.readFileSync(new URL("../apps/desktop/src/pages/info/LibraryTab.tsx", import.meta.url), "utf8");
for (const value of ["libError", "seatError", "bookError", "action.text", "recError"]) {
  assert.ok(page.includes("localizeLibraryError(" + value), "every error presentation re-resolves on render: " + value);
}
console.log("Library seat errors: live locale switching, external reasons, five presentation points and three bilingual seed keys passed");
