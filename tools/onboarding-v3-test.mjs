/**
 * 首启导览 v3 护栏（2026-10-13 桌面导览改版）。
 *
 * v1（逐项问界面 + 账号接入 11 步）与 v2（三问灰度）已删除，播放统一走 OnboardingTourV3。
 * 这份护栏钉住改版最容易被做歪的几处：
 *  ① 旧体系确实删干净：旧文件不在、App 只挂 V3、流程选择器/灰度开关不再存在；
 *  ② 偏好体系沿用既有键：flow 字段默认 "v3"（旧存档兼容不清除）、完成标记 flow3 家族；
 *  ③ 七步结构与可跳过：欢迎 → 标签页 → 白板 → 横竖栏 → OnePage → 市场与搜索 → OH 进化；
 *  ④ 第二步真实拖拽演练：卡片让位 + 底栏锚点胶囊（--explorer-bar-h），不是只会说不会做；
 *  ⑤ 压轴粒子步：prefers-reduced-motion 只出文案、canvas 键色全走令牌（不注入颜色）；
 *  ⑥ 通知权限接线保留：导览关掉后才一次性申请（不与导览叠窗）。
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync, readdirSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const exists = (p) => existsSync(new URL(`../${p}`, import.meta.url));

/* ---------- ① 删干净：旧播放端与旧灰度护栏退场 ---------- */
assert.ok(!exists("apps/desktop/src/components/OnboardingTour.tsx"), "旧 OnboardingTour.tsx（v1/v2 分发）应已删除");
assert.ok(!exists("apps/desktop/src/components/OnboardingTourV2.tsx"), "旧 OnboardingTourV2.tsx 应已删除");
assert.ok(!exists("tools/onboarding-v2-test.mjs"), "旧 v2 灰度护栏应已删除");
assert.ok(!exists("tools/onboarding-account-steps-test.mjs"), "旧 v1 账号步骤护栏应已删除（其步骤随 v1 退役）");
const app = read("apps/desktop/src/App.tsx");
assert.ok(app.includes("<OnboardingTourV3 />"), "App 挂载点必须换成 OnboardingTourV3");
assert.ok(!app.includes("./components/OnboardingTour.js"), "App 不得再引旧 OnboardingTour");
assert.ok(!app.includes("OnboardingTourV2"), "App 不得再引旧 OnboardingTourV2");

/* HomeCoachMarks 由 Today 页自用（help-coach 护栏另钉），导览不再引用它 */
assert.ok(app.includes("OnboardingTourV3") && read("apps/desktop/src/pages/Today.tsx").includes("<HomeCoachMarks />"),
  "Today 页的 HomeCoachMarks 保留，导览与它解耦");
const v3 = read("apps/desktop/src/components/OnboardingTourV3.tsx");
assert.ok(!v3.includes("HomeCoachMarks"), "V3 导览不挂 HomeCoachMarks（它属首页，不属导览）");

/* ---------- ② 偏好键：flow 默认 v3 + flow3 完成标记，选择机制收编 ---------- */
const state = read("apps/desktop/src/state/onboarding.ts");
assert.ok(state.includes('const FLOW_KEY = "onethu.onboarding.flow";'), "flow 字段沿用 onethu.onboarding.flow");
assert.ok(state.includes('const KEY_V3 = "onethu.onboarded.flow3";'), "完成标记接 flow3（v2 flow2 家族命名）");
assert.ok(/export type OnboardingFlow = "v3";/.test(state), "流程类型收敛为 v3（v1/v2 流程文件已删）");
assert.ok(/export const ONBOARDING_FLOW_DEFAULT: OnboardingFlow = "v3";/.test(state), "流程默认值必须是 v3");
assert.ok(/export function getOnboardingFlow\(\): OnboardingFlow \{[\s\S]{0,400}ONBOARDING_FLOW_DEFAULT/.test(state),
  "getOnboardingFlow 应返回 v3 默认值");
assert.ok(/老存档|旧存档/.test(state) && /不清除|不迁移/.test(state), "旧存档兼容口径必须写进注释（沿字段不清除）");
assert.ok(!state.includes("useOnboardingFlow"), "流程订阅 hook 应随灰度开关退役");
assert.ok(!state.includes('"v1" | "v2"'), "不应再出现 v1/v2 流程枚举");
for (const fn of ["hasOnboardedV3", "markOnboardedV3", "resetOnboardingV3", "resetActiveOnboarding"]) {
  assert.ok(state.includes(`function ${fn}`), `state 缺 ${fn}`);
}
assert.ok(/export function resetActiveOnboarding\(\): void \{[\s\S]{0,120}resetOnboardingV3\(\);/.test(state),
  "「导览」按钮要能清 flow3 重新走一轮");

const settings = read("apps/desktop/src/pages/Settings.tsx");
assert.ok(settings.includes("resetActiveOnboarding();"), "设置页保留「导览」重走入口");
assert.ok(!settings.includes("setOnboardingFlow"), "设置页灰度开关应已移除（v2 退役）");
assert.ok(!settings.includes("useOnboardingFlow"), "设置页不再订阅流程");

const appState = read("apps/desktop/src/state/app.tsx");
assert.ok(appState.includes('localStorage.setItem("onethu.onboarded.flow3", "1")'), "视觉自检要写 flow3（否则预览会被导览糊脸）");
assert.ok(appState.includes('"onethu.onboarding.flow", "v3"'), "视觉自检的 flow 字段值应写 v3");
assert.ok(!appState.includes("onethu.onboarded.v3") && !appState.includes("onethu.onboarded.flow2"), "自检不再写 v1/v2 完成键");

/* ---------- ③ 七步结构与可跳过 ---------- */
assert.ok(/const STEPS = 7;/.test(v3), "步骤数写死为 7");
for (const t of [
  "欢迎使用 OneTHU",
  "标签页与工作区",
  "首页是一张自由白板",
  "横竖两副骨架",
  "OnePage：你的一页",
  "装插件、找一切",
  "OH：说一句，长一样本领",
]) assert.ok(v3.includes(t), "导览缺少一步：" + t);
/* 玻璃卡必须是 menu tier（浮层材质 + rim 三件套全令牌） */
for (const tk of ["--glass-menu-fill", "--glass-menu-blur", "--glass-rim-top", "--glass-rim-hairline", "--glass-rim-bottom", "--glass-border", "--glass-shadow"]) {
  assert.ok(v3.includes(tk), "导览卡缺玻璃令牌 " + tk);
}
assert.ok(/m-fade var\(--dur-2\)/.test(v3) && /m-spring-in var\(--dur-3\)/.test(v3), "遮罩淡入 + 卡片弹簧（动效纪律）");
assert.ok(v3.includes('role="dialog"') && v3.includes('aria-modal="true"'), "导览卡要有对话框语义");
/* 可跳过（× 关一次 + Esc）与「不再显示」（完成标记）双 affordance */
assert.ok(v3.includes("不再显示") && v3.includes("markOnboardedV3"), "「不再显示」必须写 flow3 完成标记");
assert.ok(v3.includes('aria-label="关闭本次导览"') && v3.includes("Escape"), "×/Esc 关闭只关这一次，不写偏好");
assert.ok(v3.includes("上一步") && v3.includes("下一步"), "步骤可回走");

/* ---------- ④ 第二步真实拖拽演练：让位胶囊 + 内容口径 ---------- */
assert.ok(/setPractice/.test(v3) && v3.includes("自己拖一次"), "第二步要有「自己拖一次」入口");
assert.ok(v3.includes("--explorer-bar-h"), "演练胶囊要锚在底栏上方（--explorer-bar-h），别盖住工作区");
assert.ok(v3.includes("把一张标签拖到另一张上"), "演练文案要点出真实手势");
assert.ok(v3.includes("回到导览"), "演练后要有明确的返回点");
assert.ok(v3.includes("灰框"), "演练与步骤都要提到组合灰框（真实反馈信号）");

/* ---------- ⑤ 压轴粒子步 ---------- */
const particles = read("apps/desktop/src/components/OnboardingTourParticles.tsx");
assert.ok(v3.includes("<TourParticles />") && v3.includes("OnboardingTourParticles"), "第七步要接粒子舞台组件");
assert.ok(particles.includes("prefers-reduced-motion"), "粒子必须响应 prefers-reduced-motion");
assert.ok(/matchMedia\("?\(prefers-reduced-motion: reduce\)"?\)/.test(particles), "reduced 判定用 matchMedia 标准写法");
assert.ok(/{ if \(reduced\) return null; }|if \(reduced\) return null;/.test(particles), "reduced 时组件直接不渲染（只见文案）");
assert.ok(particles.includes("<canvas") && particles.includes("requestAnimationFrame") && particles.includes("cancelAnimationFrame"), "canvas + rAF 主循环（并随卸载收掉）");
assert.ok(particles.includes("getPropertyValue"), "画布颜色必须从令牌读取");
{
  /* 不注入颜色：剥离注释后不得有 hex 字面量、不得有 rgb(a, 数字) 字面量 */
  const code = particles.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(code), "粒子画布不得出现 hex 颜色字面量");
  assert.ok(!/rgba?\(\s*\d/.test(code), "粒子画布不得出现 rgb(a) 颜色字面量（一律 rgb(c.r,c.g,c.b) 组装）");
}
const particleLines = particles.split("\n").length;
assert.ok(particleLines <= 400, `粒子组件应 ≤400 行（实际 ${particleLines}）`);

/* ---------- ⑥ 通知权限接线（沿用一次性申请口径） ---------- */
assert.ok(v3.includes("askNotifyPermissionOnce"), "导览组件要接线一次性申请");
assert.ok(/if \(open\) \{[\s\S]{0,80}return;/.test(v3), "导览开着时先不弹（不得与导览叠窗）");

/* ------------------------------------------------------------------ */
console.log("首启 v3 护栏：旧体系删净 ✓ / 偏好键沿用（flow=v3 + flow3）✓ / 七步结构 ✓ / 拖拽演练 ✓ / 粒子纪律 ✓ / 权限接线 ✓");
