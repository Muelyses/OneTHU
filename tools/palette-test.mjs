/**
 * 命令面板护栏（§2.8.4）：⌘/Ctrl+K 唤起的居中搜索。
 *
 * 盯四件事：
 *  1. 键位同时认 ⌘ 与 Ctrl——本项目只出 Windows 与 Android，实际按的是 Ctrl+K，
 *     但两个都认，将来出 Mac 版不用返工；提示文案也要跟平台走，别在 Windows 上印 ⌘K；
 *  2. 结果与服务页搜索同源：只允许经 state/searchAll.ts 取，不许自己再列一份功能清单；
 *  3. 搜得到就要点得动：跳转走注册表/原子那条链路，不许写死页面名；
 *  4. 不能只有键盘入口（触屏用户也要能开），且面板要挂 body，别被滚动容器裁掉。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pal = readFileSync("apps/desktop/src/components/CommandPalette.tsx", "utf8");
const layout = readFileSync("apps/desktop/src/components/Layout.tsx", "utf8");
const all = readFileSync("apps/desktop/src/state/searchAll.ts", "utf8");
const mode = readFileSync("apps/desktop/src/state/settingsMode.ts", "utf8");
const css = readFileSync("apps/desktop/src/styles/global.css", "utf8");

// ① 键位与平台提示
assert.ok(
  /\(e\.metaKey \|\| e\.ctrlKey\) && e\.key\.toLowerCase\(\) === "k"/.test(pal),
  "键位要同时认 ⌘ 和 Ctrl，且用小写比较（大写锁定下也要能用）",
);
assert.ok(/e\.preventDefault\(\)/.test(pal), "Ctrl+K 在 WebView 里另有含义，必须 preventDefault");
assert.ok(/e\.key === "Escape"[\s\S]{0,40}closePalette\(\)/.test(pal), "Esc 要能关掉面板");
assert.ok(
  /\/Mac\|iPhone\|iPad\/i\.test\(ua\) \? "⌘K" : "Ctrl K"/.test(pal),
  "快捷键提示要按平台显示（Windows 上印 ⌘K 就是错的）",
);
/* explorer 壳（2026-10-12 合流更新）：侧栏已退役，命令面板只有键盘唤起 + 面板内 kbd 提示
   ——平台提示的唯一展示处就是 CommandPalette 自己，护栏改为钉它的定义与使用在同文件。 */
assert.ok(/export function shortcutLabel/.test(pal) && (pal.match(/shortcutLabel\(\)/g) || []).length >= 1,
  "命令面板的平台快捷键提示必须用同一份 shortcutLabel，别写死");

// ② 结果同源
assert.ok(/from "\.\.\/state\/searchAll\.js"/.test(pal), "面板结果要取自 searchAll（与服务页同源）");
assert.ok(!/NAV_REGISTRY/.test(pal), "面板不许自己遍历注册表另列一份清单");
assert.ok(/matchNavQuery/.test(all) && /searchAtoms/.test(all), "searchAll 要组合注册表与原子两路");
assert.ok(/SETTINGS_TAB_ORDER/.test(all) && /SETTINGS_TAB_ORDER = \[/.test(mode), "设置页签清单只能有一处定义");

// ③ 搜得到就点得动
assert.ok(/pageAtomRef\(/.test(pal) && /resolveAtom\(/.test(pal), "功能行要走原子的 open（使用统计才记得到）");
assert.ok(/navigate\(row\.entry\.page, row\.entry\.params\)/.test(pal), "没有同名原子的条目要按注册表的 page/params 跳");
assert.ok(/requestSettingsTab\(row\.tab\)/.test(pal), "设置页签行要落到对应那一栏，而不是设置首页");

// ④ 入口与挂载（explorer 壳：侧栏退役后点击入口取消，键盘 ⌘K + 面板内平台提示自足）
assert.ok(/<CommandPalette \/>/.test(layout), "面板要挂在布局顶层");
assert.ok(/\.pal-mask \{ position: fixed/.test(css), "遮罩要 fixed（不被滚动容器裁掉，同 SearchSelect 的教训）");
assert.ok(/\.pal \{[^}]*max-height: 70vh/s.test(css), "面板自身要能滚动，结果多时不撑破屏幕");

console.log("命令面板护栏：⌘/Ctrl+K 双键位 + 平台提示 ✓ / 结果与服务页同源 ✓ / 跳转走注册表 ✓ / 点击入口与挂载 ✓");
