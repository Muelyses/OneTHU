import { readFileSync } from "node:fs";

/* 护栏：导航壳（B4）。移动端底栏 = MD3 navigation bar；PC 侧栏 = MD3 navigation drawer/rail。
   底栏：5 目的地、单个滑动胶囊（secondary-container，复用蓝条那套共享的导航运动）、
   图标压在胶囊上、安全区、无描边、无横向蓝条。
   侧栏：宽度 ≤ 240px、激活项整行胶囊、分区小标题令牌化、旧竖条指示器退役、折叠钮无描边。 */
const CSS = readFileSync("apps/desktop/src/styles/global.css", "utf8");
const MOTION = readFileSync("apps/desktop/src/styles/motion.css", "utf8");
const TOKENS = readFileSync("packages/ui/src/tokens.css", "utf8");
const LAYOUT = readFileSync("apps/desktop/src/components/Layout.tsx", "utf8");
const MOTION_TS = readFileSync("apps/desktop/src/lib/motion.ts", "utf8");
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };

/* 从 from 起找 selector 的规则体（同名规则可能有多处，媒体查询里的才是真身） */
function block(selector, from = 0) {
  const i = CSS.indexOf(selector, from);
  if (i < 0) return null;
  const j = CSS.indexOf("}", i);
  return CSS.slice(i, j);
}

/* --- 移动端导航：MD3 五 Tab 底栏与 PC sidebar 均已退役（2026-10-12 explorer 壳合流，
   2026-10-18 底栏改三入口标签页 | OH | OneGO）——旧断言随实现一起删除，改钉新壳不变量。 --- */
/* explorer 壳（2026-10-12 合流更新）：固定 5 目的地 MD3 底栏已被 explorer/BottomBar.tsx
   的工作空间导航取代（标签页抽屉 + OneGO）。护栏改为钉新壳的真实不变量：
   nav 语义、两个抽屉入口的 aria-expanded/aria-label，胶囊运动常量仍归 motion.ts 管。 */
const BBAR = readFileSync("apps/desktop/src/components/explorer/BottomBar.tsx", "utf8");
ok(/<nav className="ex-bbar" aria-label=/.test(BBAR), "explorer 底栏缺 nav 语义（aria-label）");
/* 2026-10-18：桌面这颗按钮是「我的」→ 设置浮层（OneGO 收藏栏上移到地址栏下方），
   只有手机才是 OneGO 抽屉，所以 aria-expanded 只在该平台有意义。 */
ok(/aria-expanded={drawerOpen}/.test(BBAR) && /aria-expanded={phone \? onegoOpen : undefined}/.test(BBAR), "explorer 底栏抽屉入口缺 aria-expanded");
ok(/aria-label=/.test(BBAR) && /标签页/.test(BBAR) && /OneGO!/.test(BBAR), "explorer 底栏入口缺可读名称");
const hook = MOTION_TS ? /export function useBottomNavPill[\s\S]*$/.exec(MOTION_TS) : null;
if (hook) {
  ok(/NAV_EASE/.test(hook[0]) && /NAV_APEX/.test(hook[0]) && /NAV_BOUNCE_MS/.test(hook[0]), "胶囊运动未复用共享常量（会与蓝条那套分叉）");
  ok(/translateX\([\s\S]{0,120}scaleX\([\s\S]{0,60}scaleY\(/.test(hook[0]), "位置与形变不在同一条 transform 里（会各走一条线程而错位）");
}

/* PC sidebar / .nav-item 已随 explorer 壳退役（DOM 不再渲染），原断言一并删除。 */
/* --- 顶部大标题（MD3 large top app bar）--- */
ok(/html\.is-phone \.page-head-title\s*\{[^}]*headline-medium-size/.test(CSS), "手机端页标题未走 headline-medium 大标题令牌");
ok(!/html\.is-phone \.page-head-title\s*\{[^}]*font-size:\s*20px/.test(CSS), "手机端页标题仍是 20px（未升为大标题）");

if (fails.length) {
  console.error("导航壳护栏：不通过");
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("导航壳护栏：explorer 底栏 nav 语义 + 抽屉入口 aria ✓ 胶囊运动复用共享常量 ✓ 手机页标题走大标题令牌 ✓");
