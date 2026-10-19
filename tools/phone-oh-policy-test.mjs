/**
 * 静态守卫：手机文字/排布统一策略 + OH 限额动作卡 + 面板内输入框已删。
 * （2026-10-19 用户点名：省略号回来了 / 左右挤 / 设置栏目 segment 不直观 /
 *   429 不要原文气泡 / 删掉 OH 自己的输入框）
 */
import fs from "node:fs";
import assert from "node:assert/strict";

const read = (p) => fs.readFileSync(new URL("../" + p, import.meta.url), "utf8");
const gui = read("packages/gui/src/gui.css");
const phone = read("packages/gui/src/styles/phone.css");
const appCss = read("apps/desktop/src/styles/global.css");
const chat = read("apps/desktop/src/plugins/ChatDock.tsx");
const ohCss = read("apps/desktop/src/styles/explorer-oh.css");
const settings = read("apps/desktop/src/pages/Settings.tsx");
const modeControl = read("apps/desktop/src/components/SimpleExperience.tsx");

/* 手机策略表最后加载，且覆盖行/设置行/键值对/页头 */
assert.ok(/@import "\.\/styles\/phone\.css";/.test(gui), "gui.css 必须最后 import phone.css");
assert.ok(/html:root\.is-phone \.og-row \{/.test(phone), "手机行布局规则缺失（.og-row）");
assert.ok(/html:root\.is-phone \.og-kv \{/.test(phone), "手机键值对改为上下排的规则缺失（.og-kv）");
assert.ok(/html:root\.is-phone \.og-settings-row \{/.test(phone), "手机设置行规则缺失");
assert.ok(/html:root\.is-phone \.og-pagehead-main \{ flex: 1 1 100%; \}/.test(phone), "手机页头上下排规则缺失");
assert.ok(/html:root\.is-phone \.row \{\s*flex-wrap: wrap !important;/.test(appCss), "旧版 .row 仍被钉成单行 nowrap");
assert.ok(/html:root\.is-phone \.row-title,[\s\S]{0,200}-webkit-line-clamp: 2/.test(appCss), "旧版 .row-title 手机端缺少两行截断规则");

/* 设置：手机栏目下拉；「使用模式」默认收起 */
assert.ok(/workbench-settings-phone-nav/.test(settings) && /aria-label="设置栏目"/.test(settings), "设置栏目手机下拉缺失");
assert.ok(/useState\(false\)/.test(modeControl) && /open\?<Stack/.test(modeControl), "「使用模式」应默认收起（open 初值 false）");

/* OH：429 动作卡 + 面板输入框删除 */
assert.ok(/notice\?: "madmodel-429"/.test(chat), "429 动作卡消息类型缺失");
assert.ok(/一键续签/.test(chat) && /设置自己的 API/.test(chat), "429 动作卡按钮缺失");
assert.ok(/ensureMadModelToken\(true\)/.test(chat), "「一键续签」没有调用 MadModel 续签");
assert.ok(/goOhRow\("模型 \/ MCP \/ 日志", "advanced"\)/.test(chat), "「设置自己的 API」没有跳到 OH 高级配置");
assert.ok(!/aria-label="给小OH发消息"/.test(chat), "OH 面板内不应再有独立输入框（胶囊是唯一输入口）");
assert.ok(/\.dock-notice \{/.test(ohCss), "429 动作卡样式缺失");

/* OH 高级配置也要有一键续签；自动续期泵确实存在 */
const ohSettings = read("apps/desktop/src/components/OhSettingsPage.tsx");
const mad = read("apps/desktop/src/state/madmodel.ts");
assert.ok(/一键续签/.test(ohSettings), "OH 设置里的 MadModel 行按钮应叫一键续签");
const advAt = ohSettings.indexOf("IM 通道（进阶）");
const madAt = ohSettings.indexOf("免费额度（MadModel）");
assert.ok(advAt > 0 && madAt > advAt, "OH 高级配置缺少 MadModel 一键续签行");
const loader = read("apps/desktop/src/plugins/loader.ts");
assert.ok(/startMadModelPump\(\);/.test(loader), "MadModel 自动续期泵没有启动");
assert.ok(/RENEW_BEFORE_EXP_MS/.test(mad) && /10 \* 60_000/.test(mad), "自动续签阈值/巡检间隔缺失");

/* 小 OH 模型源卡片：设置里能续签/选源；完整模式必须回 OH 页面调整 */
const sourceCard = read("apps/desktop/src/components/OhModelSourceCard.tsx");
assert.ok(/一键续签/.test(sourceCard) && /ensureMadModelToken\(true\)/.test(sourceCard), "设置里的模型源卡片缺少一键续签");
assert.ok(/学校 MadModel/.test(sourceCard) && /自己的 API/.test(sourceCard), "模型源卡片缺少 MadModel/自费 API 选择");
assert.ok(!/OhModelSourceCard/.test(read("apps/desktop/src/pages/Settings.tsx")), "完整模式设置不应再挂模型源卡片（续签/模型都在 OH 高级配置里调）");
assert.ok(/OhModelSourceCard/.test(read("apps/desktop/src/components/SimpleSettings.tsx")), "极简/实用模式设置未挂模型源卡片");

console.log("✓ 手机策略 + OH 限额卡静态守卫通过");
