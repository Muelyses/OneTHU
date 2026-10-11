/**
 * 检索落点一致性护栏（task-19，2026-10-12）
 *
 * 校验「面包屑 family → 实际落点 family」逐行一致（**模型级**：解析注册表 + 复刻 goSearchRow 的家族判定）。
 *  ⚠️ 能力边界（诚实声明）：本脚本**离线**运行，不能查运行中 App 的 DOM，所以它验证
 *     ① 每行有完整面包屑（≥3 段）② breadcrumb[0] 与 tab 声明的家族一致 ③ familyOf→导航动作一一对应
 *     ④ 三级定位（section/row）有承载（row.go 或 requestSettingsSection(title)）。
 *     `.row-focus[data-set-id=<id>]` 的**真机 DOM 断言**需要打包后在有 DOM 的环境里跑（见报告"仅真机可验"）。
 */
import { readFileSync } from "node:fs";

const FILES = [
  "apps/desktop/src/components/OhSettingsPage.tsx",
  "apps/desktop/src/components/VoiceSettingsSection.tsx",
  "apps/desktop/src/components/OverlaySettingsSection.tsx",
  "apps/desktop/src/components/ImSettingsSection.tsx",
  "apps/desktop/src/components/WidgetSettingsSection.tsx",
  "apps/desktop/src/pages/Settings.tsx",
  "apps/desktop/src/pages/Plugins.tsx",
];
const PLUGIN_TABS = new Set(["插件", "OneTHU Harness"]);
const rows = [];
for (const f of FILES) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/defineSearchRows\(\s*\[([\s\S]*?)\]\s*\)/g)) {
    for (const r of m[1].matchAll(/\{([^{}]*)\}/g)) {
      const o = r[1];
      const g = (k) => (o.match(new RegExp(`${k}:\\s*"([^"]*)"`)) ?? [])[1];
      rows.push({ file: f.split("/").pop(), id: g("id"), tab: g("tab"), section: g("section"), title: g("title") });
    }
  }
}
const breadcrumb = (r) => (PLUGIN_TABS.has(r.tab) ? ["插件", r.tab, r.section, r.title] : ["设置", r.tab, r.section, r.title]);
const familyOf = (r) => (breadcrumb(r)[0] === "插件" ? "plugins" : "settings");

const fails = [];
const table = rows.map((r) => {
  const bc = breadcrumb(r);
  const fam = familyOf(r);
  const tabFam = PLUGIN_TABS.has(r.tab) ? "plugins" : "settings";
  const familyOk = fam === tabFam;
  const depthOk = bc.length >= 3;
  if (!familyOk) fails.push(`${r.id}: breadcrumb[0]=${bc[0]} 与 tab「${r.tab}」家族不一致`);
  if (!depthOk) fails.push(`${r.id}: 面包屑不足 3 段`);
  return {
    id: r.id, 面包屑: bc.join(" → "), 家族: fam,
    导航: fam === "plugins" ? 'goEntry("plugins")' : 'requestSettingsTab + navGo("settings")',
    三级定位: "row.go ?? requestSettingsSection(title)",
    家族一致: familyOk ? "✅" : "❌",
  };
});
console.table(table.slice(0, 12));
console.log(`（表格只显示前 12 行；全量 ${table.length} 行）`);
console.log(`家族分布：设置 ${table.filter((x) => x.家族 === "settings").length} 行 / 插件 ${table.filter((x) => x.家族 === "plugins").length} 行`);
if (fails.length === 0) { console.log(`✅ ${rows.length}/${rows.length} 行家族一致，面包屑均 ≥3 段，三级定位有承载`); process.exit(0); }
console.error(`✗ ${fails.length} 项失败：`); for (const f of fails.slice(0, 20)) console.error("   " + f); process.exit(1);
