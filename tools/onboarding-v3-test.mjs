/**
 * 首启导览护栏（2026-10-19 起：模式向导 flow4）。
 *
 * 背景：导览已从「V3 七步玻璃卡 + 拖拽演练 + 粒子」整体换成**模式向导**——
 * 第一步选极简/实用/完整，之后按所选模式走各自课程，最后可选接入。
 * 旧 V1/V2/V3/手机版播放端全部退役（文件可留，但 App 不再引用）。
 *
 * 本护栏钉：挂载唯一入口、flow4 完成标记与旧标记兼容、三种模式课程齐、
 * 结束/跳过/回退的 affordance、OneGUI Modal 语义、重放/重置链路。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const app = read("apps/desktop/src/App.tsx");
const tour = read("apps/desktop/src/components/OnboardingTour.tsx");
const state = read("apps/desktop/src/state/onboarding.ts");
const picker = read("apps/desktop/src/components/ExperienceModePicker.tsx");
const settings = read("apps/desktop/src/pages/Settings.tsx");

/* ---------- ① 挂载：只认新向导 ---------- */
assert.ok(/OnboardingTour as OnboardingTourGate/.test(app) && /<OnboardingTourGate \/>/.test(app), "App 必须挂 OnboardingTour 门（新向导）");
assert.ok(!/OnboardingTourV3|OnboardingTourMobile|OnboardingTourV2/.test(app), "App 不得再引已退役的 V2/V3/手机版播放端");

/* ---------- ② 偏好键：flow4 + 旧标记兼容 + 重放事件 ---------- */
assert.ok(tour.includes('const KEY="onethu.onboarded.flow4"'), "完成标记应为 onethu.onboarded.flow4");
assert.ok(/onethu\.onboarded\.flow3/.test(tour) && /onethu\.onboarded\.phone/.test(tour), "shouldStart 要兼容 flow3 / phone 旧标记（老用户不重复弹）");
assert.ok(/const REPLAY="onethu\.onboarding\.replay"/.test(tour) && /export function replayOnboarding\(\)\{window\.dispatchEvent/.test(tour), "重放走事件 onethu.onboarding.replay");
assert.ok(/addEventListener\(REPLAY,replay\)/.test(tour), "向导要订阅重放事件（设置页「导览」按钮用）");
assert.ok(/localStorage\.removeItem\("onethu\.onboarded\.flow4"\)/.test(state), "resetActiveOnboarding 要清 flow4（否则「导览」按钮点了不重来）");
assert.ok(settings.includes("resetActiveOnboarding();"), "设置页保留「导览」重走入口");

/* ---------- ③ 三种模式 × 各自课程 ---------- */
assert.ok(/ExperienceModePicker/.test(tour), "第一步要有模式选择器");
for (const s of ["极简模式", "实用模式", "完整模式"]) assert.ok(picker.includes(s), "模式选择器缺 " + s);
assert.ok(/chosen==="simple"\?SIMPLE_LESSONS:chosen==="practical"\?PRACTICAL_LESSONS:FULL_LESSONS/.test(tour), "三种模式必须各走自己的课程");
for (const t of ["白板，把常用内容放到手边", "暂存箱，先收起来再处理", "一个短口令，传递一组内容", "碰一碰，让内容接力", "组织，把人和事情放在一起"]) {
  assert.ok(tour.includes(t), "完整模式缺一课：" + t);
}
for (const t of ["首页，只关心今天", "五个入口，直接到达"]) assert.ok(tour.includes(t), "极简模式缺一课：" + t);
for (const t of ["更多功能，一屏展开", "四个入口，随你安排"]) assert.ok(tour.includes(t), "实用模式缺一课：" + t);

/* ---------- ④ 结束/跳过/回退 + 弹层语义 + 演练返回 ---------- */
assert.ok(/localStorage\.setItem\(KEY,"1"\)/.test(tour), "结束必须写完成标记（否则下次启动又弹）");
for (const t of ["跳过导览", "上一步", "开始使用", "按此模式开始"]) assert.ok(tour.includes(t), "导览缺少「" + t + "」");
assert.ok(/<Modal open/.test(tour) && /aria-label="OneTHU 使用导览"/.test(tour), "导览卡走 OneGUI Modal + 可读名");
assert.ok(/tour-resume/.test(tour) && /继续导览/.test(tour) && /正在体验/.test(tour), "演练态要有「继续导览」返回条");

/* ---------- ⑤ 设置页模式卡片 ---------- */
assert.ok(/ExperienceModeControl/.test(settings), "设置页要有「使用模式」卡片");

console.log("首启导览护栏：flow4 模式向导 ✓ 三模式课程 ✓ 重放/重置链路 ✓ OneGUI 弹层 ✓ 演练返回 ✓");
