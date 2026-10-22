/**
 * 双端断点护栏（§2.8.1）：断点必须**只有一个来源** state/platform.ts。
 *
 * 背景：改造期断点散落成 860（移动端）/ 861（任务页限宽）/ 1080（宽屏双栏）三套，
 * 组件还各自 matchMedia（Layout / Today / TasksPage），改一处必漏三处。
 * 2026-09-25 M1 收尾统一为 compact <600 / medium 600-840 / expanded >=840。
 *
 * 钉住四件事：
 *   [1] platformOf 的档位边界
 *   [2] CSS 里不再有 860/861 旧断点，且媒体查询数值与 BP 一致
 *   [3] 禁止组件自写「宽度类」matchMedia（只允许 state/usePlatformLayout.ts）
 *   [4] medium 档规则存在（过渡态不破）
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { BP, platformOf, isPhoneViewport, touchInteractionOf } from "../apps/desktop/src/state/platform.ts";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");

/* [1] 档位边界 */
assert.equal(platformOf(320), "compact");
assert.equal(platformOf(BP.medium - 1), "compact");
assert.equal(platformOf(BP.medium), "medium");
assert.equal(platformOf(BP.expanded - 1), "medium");
assert.equal(platformOf(BP.expanded), "expanded");
assert.equal(platformOf(1440), "expanded");

/* 扫源码 */
const SRC = new URL("../apps/desktop/src/", import.meta.url);
const files = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = new URL(name, dir);
    if (statSync(full).isDirectory()) walk(new URL(name + "/", dir));
    else if (name.endsWith(".ts") || name.endsWith(".tsx") || name.endsWith(".css")) {
      files.push([full.pathname, readFileSync(full, "utf8")]);
    }
  }
}
walk(SRC);
assert.ok(files.length > 50, "源码扫描数量异常：" + files.length);

/* [2] 旧断点不得复活 */
const legacy = [];
for (const [path, text] of files) {
  if (text.includes("(max-width: 860px)") || text.includes("(min-width: 861px)")) {
    legacy.push(path.slice(path.indexOf("apps/desktop/src/")));
  }
}
assert.deepEqual(legacy, [], "旧的 860/861 断点复活了：" + legacy.join(", "));

const css = read("apps/desktop/src/styles/global.css");
const maxMobile = (BP.expanded - 0.02).toFixed(2) + "px";
assert.ok(css.includes("@media (max-width: " + maxMobile + ")"), "CSS 缺少移动端断点 " + maxMobile);
assert.ok(css.includes("@media (min-width: " + BP.expanded + "px)"), "CSS 缺少 expanded 断点");
assert.ok(
  css.includes("@media (min-width: " + BP.medium + "px) and (max-width: " + maxMobile + ")"),
  "CSS 缺少 medium 档（600-840）规则",
);

/* [3] 宽度类 matchMedia 只允许出现在 usePlatformLayout.ts */
const allow = "apps/desktop/src/state/usePlatformLayout.ts";
const offenders = [];
for (const [path, text] of files) {
  if (!path.endsWith(".ts") && !path.endsWith(".tsx")) continue;
  const rel = path.slice(path.indexOf("apps/desktop/src/"));
  if (rel === allow) continue;
  let i = text.indexOf("matchMedia(");
  while (i >= 0) {
    const arg = text.slice(i + 11, text.indexOf(")", i));
    if (arg.indexOf("width") >= 0) offenders.push(rel + ": " + arg.trim());
    i = text.indexOf("matchMedia(", i + 1);
  }
}
assert.deepEqual(offenders, [], "组件自写宽度断点（应改用 usePlatformLayout）：" + offenders.join(", "));

/* [5] 手机形态判定：窄窗/横屏手机算手机；被压矮的桌面窗（1256×596）必须是桌面 */
const cases = [
  [1256, 596, false, "压矮的桌面窗（用户的 1256×596）：桌面形态"],
  [1280, 520, false, "宽而矮的桌面窗：桌面形态"],
  [1000, 560, false, "超过横屏手机宽度上限的矮窗：桌面形态"],
  [1440, 900, false, "常规桌面窗：桌面形态"],
  [744, 1133, false, "平板竖屏（宽高都不窄）：桌面形态"],
  [390, 844, true, "竖屏手机：手机形态"],
  [320, 568, true, "窄手机：手机形态"],
  [844, 390, false, "横屏手机（iPhone 15）：直接桌面形态（2026-10-19 用户拍板）"],
  [932, 430, false, "横屏手机（15 Pro Max）：桌面形态"],
  [915, 412, false, "横屏手机（Pixel 8 Pro）：桌面形态"],
  [900, 560, false, "宽窗压矮：桌面形态"],
];
const realWindow = globalThis.window;
for (const [w, h, want, label] of cases) {
  globalThis.window = { innerWidth: w, innerHeight: h };
  assert.equal(isPhoneViewport(), want, `${label}（${w}×${h}）`);
}
globalThis.window = realWindow;
assert.equal(isPhoneViewport(), false, "无 window 环境不崩");

// Expanded geometry and editing capability are separate. Test Android's actual
// spoofed UA, iPad desktop mode, and desktop machines with secondary touch input.
const windowsUa = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/79";
for (const [signals, coarse, expected, label] of [
  [{ userAgent: windowsUa, platform: "Linux aarch64", maxTouchPoints: 5 }, false, true, "Android native host remains touch-safe even with a mouse"],
  [{ userAgent: windowsUa, platform: "Linux armv8l" }, false, true, "Android native platform fallback"],
  [{ userAgent: windowsUa, userAgentData: { platform: "Android" } }, false, true, "Android UA-CH fallback"],
  [{ userAgent: "Mozilla/5.0 (Linux; Android 15)", platform: "Linux x86_64" }, false, true, "Android browser"],
  [{ userAgent: "Mozilla/5.0 (Macintosh)", platform: "MacIntel", maxTouchPoints: 5 }, false, true, "iPad desktop UA with attached mouse"],
  [{ userAgent: "Mozilla/5.0 (iPhone)", platform: "iPhone" }, false, true, "iPhone browser"],
  [{ userAgent: windowsUa, platform: "Win32", maxTouchPoints: 5 }, true, true, "touch-first Windows tablet"],
  [{ userAgent: windowsUa, platform: "Win32", maxTouchPoints: 5 }, false, false, "mouse-first Windows laptop"],
  [{ platform: "MacIntel", maxTouchPoints: 0 }, false, false, "macOS desktop"],
  [undefined, false, false, "server environment"],
]) assert.equal(touchInteractionOf(signals, coarse), expected, label);

console.log("双端断点：单源 " + BP.medium + "/" + BP.expanded + "；旧断点 0 处；自写宽度 matchMedia 0 处；medium 档在册；手机形态 " + cases.length + " 例、触摸策略 10 例全对 ✓");
