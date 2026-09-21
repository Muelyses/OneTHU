/**
 * 权限时机 + 设置页文案纪律护栏（2026-09-21 用户反馈）。
 *
 * 用户原话：「寻迹进入时主动寻求位置权限，为什么不在首次安装默认申请通知权限」
 * 「设置的语气太口语了，太奇怪了」「权限与系统设置里有重复的按钮」。
 *
 * [1] 通知权限一次性申请：首次运行/导览结束后触发，有标记不复发，无后端不写标记
 * [2] 导览接线：导览关闭后（而非开着时）才申请，避免两层弹窗
 * [3] 按钮不重复：通知权限行不得再出现语义重叠的「重新检测」
 * [4] 口语/工程黑话黑名单（这几处实录的原文不得回归）
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

/* ---------- [1] 一次性申请模块 ---------- */
const ask = read("apps/desktop/src/state/notifyPermissionAsk.ts");
assert.ok(/onethu\.notify\.asked\.v1/.test(ask), "必须有一次性的已问标记");
assert.ok(/fetchNotifyStatus\(true\)/.test(ask), "必须以 request=true 触发系统授权弹窗");
assert.ok(/backend === "none"/.test(ask), "无通知后端的平台不得写标记（换环境仍可询问）");
assert.ok(/notifyPermissionAsked\(\)\) return false/.test(ask), "已问过必须直接返回，不重复打扰");
assert.ok(/catch \{[\s\S]*return true;/.test(ask), "存储不可用时应视为已问，避免反复弹");

/* ---------- [2] 导览接线 ---------- */
const tour = read("apps/desktop/src/components/OnboardingTour.tsx");
assert.ok(tour.includes("askNotifyPermissionOnce"), "导览组件必须接线一次性申请");
assert.ok(/if \(open\) return;/.test(tour), "导览开着时先不弹（不得与导览叠窗）");
assert.ok(/useEffect/.test(tour.split("\n")[8] ?? "") || /import \{ useEffect/.test(tour), "必须引入 useEffect");

/* ---------- [3] 按钮不重复（按注释剔除后的代码判定：注释里提旧按钮名不算违规） ---------- */
const stripComments = (src) =>
  src
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");
const notifyRaw = read("apps/desktop/src/components/NotifySettingsSection.tsx");
const notify = stripComments(notifyRaw);
assert.ok(!notify.includes("重新检测"), "「重新检测」与「诊断」语义重叠，必须已合并");
assert.ok(notify.includes("发送测试通知"), "测试通知按钮须用完整说法");
assert.ok(notify.includes("通知权限"), "权限行标题须为「通知权限」");

/* ---------- [4] 口语/黑话黑名单 ---------- */
const FILES = [
  "apps/desktop/src/pages/Settings.tsx",
  "apps/desktop/src/components/NotifySettingsSection.tsx",
  "apps/desktop/src/components/WidgetSettingsSection.tsx",
];
const BANNED_COPY = [
  ["看到了就说明这条链通了", "口语解说"],
  ["投递失败，看日志", "口语化失败提示"],
  [">试一下<", "口语按钮"],
  [">自检<", "口语按钮"],
  ["反馈给我", "第一人称口语"],
  ["挤", "口语"],
  ["——请用桌面端", "口语句式"],
  ["还没登录", "口语（应为「尚未登录」）"],
  ["内容格式不对", "口语（应为「格式不正确」）"],
];
for (const f of FILES) {
  const src = read(f);
  const visible = stripComments(src); // 注释不算用户可见
  for (const [bad, why] of BANNED_COPY) {
    assert.ok(!visible.includes(bad), `${f} 出现口语/黑话「${bad}」（${why}）`);
  }
}

/* ---------- [5] 通知权限说明仍在（不得因精简丢掉状态可见性） ---------- */
assert.ok(/hint\.text/.test(notifyRaw), "权限状态必须如实展示");
assert.ok(notify.includes("openNotifySettings"), "必须保留跳系统设置的入口");

console.log("permission-and-copy-test: 全部断言通过（一次性申请 + 导览接线 + 按钮去重 + 文案纪律）");
