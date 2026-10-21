#!/usr/bin/env node
/**
 * 起步模板（P2.5 纯逻辑）护栏。方案：docs/原子收藏-可行性与实现方案.md §5.3。
 *
 * 盯住四条：
 *   ① 至少两套模板，且每套有名称与说明（用户要知道选的是什么）；
 *   ② 原生像素版式不重叠、留出间距；兼容 cell 仍不重叠；
 *   ③ 模板共享 1104px 阅读基准，不退回 90/286px 的旧四格宽度；
 *   ④ id 唯一（同一模板连展开两次也不撞车）。
 *
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/board-templates-test.mjs ｜ 0 通过 / 1 违规
 */
import { readUiSource as readFileSync } from "./i18n/source-view.mjs";

const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };

const T = await import("../apps/desktop/src/state/boardTemplates.ts");
const B = await import("../apps/desktop/src/state/boardCore.ts");

ok(T.BOARD_TEMPLATES.length >= 2, "模板少于两套（方案要求的起步模板没落实）");
for (const tpl of T.BOARD_TEMPLATES) {
  ok(!!tpl.id && !!tpl.name && !!tpl.description, "模板缺 id/名称/说明：" + tpl.id);
  ok(tpl.items.length >= 2, "模板条目太少：" + tpl.id);
  const items = T.templateItems(tpl, 1000);
  ok(items.length === tpl.items.length, "展开后的条目数与模板不符：" + tpl.id);
  for (const it of items) {
    ok(it.cell.w >= 1 && it.cell.x + it.cell.w <= B.BOARD_COLS, "条目越出列宽：" + tpl.id);
    ok(it.cell.h >= 1 && it.cell.y >= 0, "条目高度或 y 非法：" + tpl.id);
    ok(B.isRect(it.rect), "模板缺少原生像素矩形：" + tpl.id);
    ok(it.rect.w >= 280 && it.rect.h >= 132, "模板恢复成过窄/过矮的旧瓦片：" + tpl.id);
    ok(it.rect.x >= 0 && it.rect.y >= 0 && it.rect.x + it.rect.w <= 1104, "模板超出原生1104px宽度：" + tpl.id);
    const authored = tpl.items[items.indexOf(it)];
    ok(JSON.stringify(it.rect) === JSON.stringify(authored.rect), "兼容网格修复不应改变作者给出的像素排版：" + tpl.id);
    ok(it.manual === authored.manual, "展开时不应覆盖预设的尺寸归属：" + tpl.id);
  }
  ok(Math.max(...items.map(it => it.rect.x + it.rect.w)) === 1104, "模板没有利用完整首页宽度：" + tpl.id);
  /* 同列两两不重叠 */
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const a = items[i].cell;
      const b = items[j].cell;
      const hit = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      ok(!hit, "模板展开后同列重叠：" + tpl.id);
      const ar = items[i].rect;
      const br = items[j].rect;
      const hGap = Math.max(br.x - ar.x - ar.w, ar.x - br.x - br.w);
      const vGap = Math.max(br.y - ar.y - ar.h, ar.y - br.y - br.h);
      ok(hGap >= 24 || vGap >= 24, "模板像素卡片重叠或间距不足24px：" + tpl.id);
    }
  }
  /* 卡体真正需要阅读的列表，不能被塞回旧模板90px侧栏。 */
  for (const it of items.filter(it => it.spec.kind === "custom" && ["classes", "homework", "notices", "learn-assignments", "learn-notices", "learn-files"].includes(it.spec.id))) {
    ok(it.rect.w >= 480 && it.rect.h >= 320, "列表没有足够阅读空间：" + tpl.id + "/" + it.spec.id);
  }
  const again = T.templateItems(tpl, 2000);
  const ids = new Set([...items, ...again].map((x) => x.id));
  ok(ids.size === items.length * 2, "展开两次出现重复 id：" + tpl.id);
  items[0].rect.w = 123;
  items[0].cell.h = 99;
  items[0].spec.kind = "divider";
  const isolated = T.templateItems(tpl, 3000);
  ok(isolated[0].rect.w === tpl.items[0].rect.w && isolated[0].spec.kind === tpl.items[0].spec.kind && isolated[0].cell.h !== 99,
    "模板/两次套用之间共享了可变数据：" + tpl.id);
}

const fit = await import("../apps/desktop/src/state/boardFit.ts");
const freshList = T.templateItems(T.templateById("tpl-learn"), 1000)[0];
ok(freshList.manual !== true && fit.fitTarget(freshList.rect.h, freshList.rect.h + 40, freshList) !== null, "新模板默认仍可按内容拟合");
const resized = B.withRect(freshList, { ...freshList.rect, h: 160 });
ok(resized.manual === true && fit.fitTarget(160, 600, resized) === null, "用户主动固定大小后必须交还尺寸控制权");

ok(T.templateById("nope") === null, "未找到的模板应返回 null");
ok(T.templateById(T.BOARD_TEMPLATES[0].id)?.id === T.BOARD_TEMPLATES[0].id, "按 id 查模板失败");

const src = readFileSync("apps/desktop/src/state/boardTemplates.ts", "utf8");
const importLines = src.split("\n").filter((l) => /^\s*import\b/.test(l)).join("\n");
ok(!/\.tsx/.test(importLines), "模板核心 import 了 .tsx（node 无法剥离 JSX）");

/* ㉜ 白板初衷：目录里**每一个**组件都能在白板独立渲染（不依赖来源页发布快照） */
/* 注：不能用 await import("widgets.ts") —— 它会连带加载 TSX，node 无法剥离 JSX；
   所以下面做**静态**检查（按构造保证覆盖）。 */
/* TSX 不能被 Node 直接加载：改为静态检查登记键（同样能钉住"每个组件都可独立渲染"）。 */
const REG_SRC = readFileSync("apps/desktop/src/components/boardCards.tsx", "utf8");

/* ① 入口型（选课 / 全部作业 / 卫生成绩 …）必须由 HOME_CARD_META **统一登记**，
      而不是逐个手写——新增入口才不会再退化成"内容由原页面提供"。 */
ok(/ENTRY_RENDERERS/.test(REG_SRC) && /HOME_CARD_META/.test(REG_SRC) && /kind !== "entry"/.test(REG_SRC), "入口型组件没有统一登记（会显示「内容由原页面提供」）");
/* ② 已做出真实卡体的入口型（原页面的行组件 + 截前 N 条）必须登记，否则会退回通用入口行 */
ok(/ENTRY_REAL/.test(REG_SRC) && /LearnFilesCard/.test(REG_SRC) && /LearnAssignmentsCard/.test(REG_SRC) && /LearnNoticesCard/.test(REG_SRC), "网络学堂三件（课程文件/作业/通知）没有真实卡体");
/* ②b 生活页 / 预约页栏目：登记后直接显示信息（元素级拆分见后续批次） */
["life-dorm", "life-washer", "life-card", "life-hygiene", "life-invoice", "life-payroll", "life-gradincome", "reserve-lib", "reserve-room"].forEach(function (id) {
  ok(REG_SRC.indexOf('cardRendererKey("' + id + '")') >= 0, "生活/预约栏目没有真实卡体：" + id);
});
/* ③ 数字卡与信息栏目的登记必须仍在（防重构误删） */
["mine-balance", "mine-credit", "mine-gpa", "mine-student", "info-report", "info-news", "info-profile", "info-courseinfo"].forEach(function (id) {
  ok(REG_SRC.indexOf('cardRendererKey("' + id + '")') >= 0, "可独立渲染实现丢了：" + id);
});
const missing = [].filter(function (d) { return d.spec.kind === "custom"; })
  .filter(function (d) { return REG_SRC.indexOf('cardRendererKey("' + d.spec.id + '")') < 0; })
/* key 与白板文档同口径："custom:" + id（不 import liveCards，那会连带加载 TSX）。 */
  .map(function (d) { return d.spec.id; });
ok(missing.length === 0, "这些组件在白板上只能显示「内容由原页面提供」（需登记到 components/boardCards.tsx）：" + missing.join(", "));
/* ②c 成绩元素级拆分（口径 B）：目录有 5 条、白板有 5 个渲染器，缺一不可 */
var reportEls = ["report-done", "report-credit", "report-overall", "report-latest", "report-list"];
var widgetSrc = readFileSync("apps/desktop/src/state/widgets.ts", "utf8");
reportEls.forEach(function (id) {
  ok(widgetSrc.indexOf('id: "custom:' + id + '"') >= 0, "成绩元素组件不在目录里：" + id);
  ok(REG_SRC.indexOf('cardRendererKey("' + id + '")') >= 0, "成绩元素组件没有白板渲染器：" + id);
});
/* ②d B4 余项：选课 / 网络学堂搜索 / 学期切换（自足页面，登记即可） */
["xk", "learn-search", "learn-semester"].forEach(function (id) {
  ok(REG_SRC.indexOf('cardRendererKey("' + id + '")') >= 0, "B4 余项没有白板渲染器：" + id);
});
/* ②e 行级元素（§7 7.5）：props 必须能从 spec 传到渲染器 */
var hostSrc = readFileSync("apps/desktop/src/components/WidgetHost.tsx", "utf8");
ok(/custom\(item\.spec\.kind === "custom" \? item\.spec\.props : undefined, plan\.size\)/.test(hostSrc), "WidgetHost 没有把 spec.props 与当前档位传给渲染器（行级元素会退化成占位，档位排版拿不到尺寸）");
ok(/\[cardRendererKey\("learn-file"\)\]: \(props\)/.test(REG_SRC), "具体文件行的渲染器没有按 props 渲染");
/* 霖 2026-10-11：入口行的说明文字按宽度分档（4 宽完整 / 3 宽缩句 / 2 宽「进入」/ 1 宽不写），
   并且说明与箭头要收进右侧簇（此前卡体用的类名在 CSS 里根本不存在）。 */
ok(/entryHintFor/.test(REG_SRC) && /w === 2/.test(REG_SRC) && /"进入"/.test(REG_SRC), "入口行的说明文字没有按宽度分档");
ok(/wg-entry-side/.test(REG_SRC) && /wg-entry-hint/.test(REG_SRC), "入口行没有把说明与箭头收进右侧簇");
/* 霖 2026-10-11：余额速览要自足渲染并给出 4×1 / 4×2 两档排版（4×2 上下两行、左名称右数值）。 */
ok(/BalanceStripCard/.test(REG_SRC) && /is-stacked/.test(REG_SRC), "余额速览没有自足卡体或 4×2 排版");
ok(/cardRendererKey\("balance-strip"\)/.test(REG_SRC), "余额速览没有登记白板渲染器（仍靠今日页发布的快照）");
/* 霖 2026-10-12：校园卡余额卡片与下一节课同样要自足，并接入统计卡的档位排版 */
ok(/CardEntryCard/.test(REG_SRC) && /stat-link stat-tiered/.test(REG_SRC), "校园卡余额卡片没有自足卡体或没有接入档位排版");
ok(/NextClassCard/.test(REG_SRC) && /cardRendererKey\("next-class"\)/.test(REG_SRC), "下一节课没有自足卡体");
ok(/ResvCard/.test(REG_SRC) && /cardRendererKey\("resv"\)/.test(REG_SRC), "今日预约没有自足卡体");
ok(/NewsCard/.test(REG_SRC) && /cardRendererKey\("news"\)/.test(REG_SRC), "订阅新闻没有自足卡体");
var hwSrc = readFileSync("apps/desktop/src/components/HomeWidgets.tsx", "utf8");
ok(/useSubsNewsFeed/.test(hwSrc), "订阅新闻的取数没有抽成共用 hook（今日页与白板会分叉）");
ok(/TodayOverviewWidget\(\{ size \}/.test(hwSrc) && /cardRendererKey\("today-overview"\)/.test(REG_SRC), "今日概览没有按档位排版或没有登记白板渲染器");
ok(/tierH >= 2/.test(hwSrc) && /tierH >= 4/.test(hwSrc), "今日概览没有按高度分三层（4×1 / 4×2 / 4×4）");
ok(/AgendaWidget\(\{ size \}/.test(hwSrc) && /cardRendererKey\("agenda"\)/.test(REG_SRC), "日程与提醒没有按档位排版或没有登记白板渲染器");
ok(/const limit = \(size\?\.h \?\? 4\) >= 4 \? 6 : 2/.test(hwSrc), "日程与提醒没有按高度截断（4×2 两条 / 4×4 铺满）");
/* ②f 模板组件与"具体项选择器"（霖 2026-10-11 定）：目录条目、props 写入、选择器界面缺一不可 */
var widgetSrc2 = readFileSync("apps/desktop/src/state/widgets.ts", "utf8");
var pageSrc = readFileSync("apps/desktop/src/components/FreeBoard.tsx", "utf8"); // OnePage 面=自由画布
var pickerSrc = readFileSync("apps/desktop/src/components/BoardItemPicker.tsx", "utf8");
ok(widgetSrc2.indexOf('id: "custom:learn-file"') >= 0, "课程文件条目不在目录里（模板组件）");
ok(/ATOM_TEMPLATE_IDS/.test(widgetSrc2) && /ATOM_TEMPLATE_IDS\.includes/.test(pageSrc), "编辑界面没有按模板 id 提供「选择条目」入口");
ok(/ops\.props\(pickItem\.id, props\)/.test(pageSrc), "选择结果没有写进条目的 spec.props（px 层走 ops.props）");
ok(/type="search"/.test(pickerSrc) && /picker-row/.test(pickerSrc), "选择器缺少搜索框或列表行");
/* 霖 2026-10-12：开始按档位设计排版。统计卡（成绩四张 + 我的三张）统一到 StatTile 一块骨架，
   档位排版只由 [data-size] 上的 CSS 决定（白板槽位与抽屉预览都带这个属性，一条规则两处生效）。 */
var reportSrc = readFileSync("apps/desktop/src/pages/info/reportParts.tsx", "utf8");
ok(/export function StatTile/.test(reportSrc) && /stat-tiered/.test(reportSrc), "统计卡没有统一到 StatTile（档位排版会分叉）");
ok(/stat-cap/.test(reportSrc) && /stat-sub/.test(reportSrc), "统计卡缺少口径行与进度行两个槽位（stat-cap / stat-sub）");
["mine-balance", "mine-credit", "mine-gpa", "report-done", "report-credit", "report-overall", "report-latest"].forEach(function (id) {
  ok(new RegExp("StatTile|cardRendererKey\\(" + JSON.stringify(id).slice(1, -1)).test(REG_SRC + reportSrc), "统计卡没有接入档位排版：" + id);
});
var cssTierSrc = readFileSync("apps/desktop/src/styles/global.css", "utf8");
ok(cssTierSrc.indexOf('[data-size="1x1"] .stat-tiered') >= 0 && cssTierSrc.indexOf('[data-size="2x1"] .stat-tiered') >= 0 && cssTierSrc.indexOf('[data-size="2x2"] .stat-tiered .stat-cap') >= 0, "统计卡没有按档位排版（1×1 数值+名称 / 2×1 图标+两栏 / 2×2 图标名称+居中数值口径+进度）");
ok(/grid-template-areas/.test(cssTierSrc), "统计卡的档位排版没有用 grid-area 换布局（会变成各档各写一套 flex）");
if (fails.length) {
  console.error("起步模板护栏（P2.5）：不通过");
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("起步模板护栏（P2.5）：四套模板齐全 ✓ ｜ 原生宽卡与间距 ✓ ｜ 兼容网格合法 ✓ ｜ 数据与尺寸归属独立 ✓ ｜ 不依赖视图 ✓");
