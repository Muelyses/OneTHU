/**
 * R20-B2：雨课堂原生作业详情页的纯判定 / 展示函数（零依赖，无 JSX / 无 React /
 * 无 Tauri —— tools/ykt-detail-ui-test.mjs 用 Node 直引做回归测试，约定同
 * ./androidHost.ts）。
 *
 * 范围（B2 只读）：
 *  - 入口分流：移动端（Android 宿主）雨课堂条目 → 原生详情页；其余保持 R20-A 现状
 *    （openExternalHomework 内部分流：Android → 桌面模式 WebView，桌面 → 系统浏览器）；
 *  - 展示口径：单题批改徽标、整卷批改/得分汇总、题型文案、作答附件文案。
 *
 * 红线（写死在本模块注释与页面实现里）：B2 无任何提交 UI；试卷（exam / type 6 / 20）
 * 不渲染提交入口（B2 整页本就没有提交区，天然满足，仍明确不引入）；题型 9 只显示外链跳转。
 */
import type { YkAttachment, YkMyStatus, YkProblem } from "@onethu/core";

/* ── 入口分流 ── */

/** 入口分流所需的最小行数据（Homework 的结构化子集，测试可传普通对象） */
export interface YktEntryRow {
  source?: string;
  /** core R20-B2 透出：get_exercise_list 路径段（缺失 → 没法拉详情，回退网页打开） */
  externalLeafTypeId?: string;
  externalClassroomId?: string;
}

/** 原生详情页入口判定（纯函数）：
 *  - "native"：Android 宿主（tauri + isAndroidNavigator 多信号，与 R20-A 同口径）
 *    且是雨课堂条目且详情参数齐备 → 直达 learn-ykt-detail 原生页；
 *  - "external"：桌面端 / 浏览器预览 / 非雨课堂 / 参数缺失 → 保持 R20-A 现状
 *    （openExternalHomework：Android 走应用内 WebView 桌面模式，桌面走系统浏览器）。 */
export function pickYktDetailEntry(androidHost: boolean, row: YktEntryRow): "native" | "external" {
  return androidHost && row.source === "yuketang" && Boolean(row.externalLeafTypeId) && Boolean(row.externalClassroomId)
    ? "native"
    : "external";
}

/* ── 展示口径 ── */

/** 分数文案：数字直转（JS Number 不保留尾零：2 → "2"、2.5 → "2.5"、30.00 → "30"）。
 *  独立成函数是给后续分数舍入规则留缝，B2 原样展示。 */
export function yktScoreText(n: number): string {
  return String(n);
}

/** 单题批改徽标：已批改（蓝，有分带分数）/ 已交未批（绿）/ 未作答（灰） */
export function yktStatusChip(p: { myStatus: YkMyStatus; myScore?: number }): { text: string; cls: string } {
  if (p.myStatus === "graded") {
    return p.myScore !== undefined
      ? { text: `已批 ${yktScoreText(p.myScore)} 分`, cls: "chip-blue" }
      : { text: "已批改", cls: "chip-blue" };
  }
  if (p.myStatus === "submitted") return { text: "已交未批", cls: "chip-green" };
  return { text: "未作答", cls: "chip-gray" };
}

/** 整卷批改/得分汇总（详情页头部用） */
export interface YktExerciseSummary {
  total: number;
  /** 已作答题数（submitted + graded） */
  answered: number;
  /** 已批改题数 */
  graded: number;
  /** 已批题目得分合计（无一题透出得分时为 undefined，避免 0 分误导） */
  scoreSum?: number;
  /** 整卷批改状态徽标 */
  chip: { text: string; cls: string };
}

/** 整卷汇总（纯函数）：B2 只读口径，只统计 problems[] 里归一化好的三态与得分 */
export function yktExerciseSummary(problems: ReadonlyArray<YkProblem>): YktExerciseSummary {
  const total = problems.length;
  let answered = 0;
  let graded = 0;
  let scoreSum: number | undefined;
  for (const p of problems) {
    if (p.myStatus !== "unanswered") answered++;
    if (p.myStatus === "graded") {
      graded++;
      if (p.myScore !== undefined) scoreSum = (scoreSum ?? 0) + p.myScore;
    }
  }
  const chip = (() => {
    if (total === 0) return { text: "无题目", cls: "chip-gray" };
    if (answered === 0) return { text: "未作答", cls: "chip-gray" };
    if (graded >= total) return { text: "已批改", cls: "chip-blue" };
    if (graded > 0) return { text: `已批 ${graded}/${total} 题`, cls: "chip-blue" };
    return { text: "已交未批", cls: "chip-green" };
  })();
  return { total, answered, graded, ...(scoreSum !== undefined ? { scoreSum } : {}), chip };
}

/** 题型文案：typeText 缺失时按 ProblemType 兜底（docs 28.1：1 单选 2 多选 3 判断 4 填空 5 主观 9 外链） */
export function yktTypeText(p: Pick<YkProblem, "type" | "typeText">): string {
  const t = (p.typeText ?? "").trim();
  if (t) return t;
  const fallback: Record<number, string> = {
    1: "单选题",
    2: "多选题",
    3: "判断题",
    4: "填空题",
    5: "主观题",
    6: "试卷",
    9: "外链题",
  };
  return fallback[p.type] ?? "题目";
}

/** 题型 9（外链 OJ）：B2 只显示外链跳转，不渲染作答区（红线） */
export function yktIsExternalLinkProblem(p: Pick<YkProblem, "type">): boolean {
  return p.type === 9;
}

/** 作答附件 → 一行文案（"a.png、b.pdf"；无附件 → ""）。B2 只读展示文件名，下载属 R20-C。 */
export function yktAttachmentsText(atts: ReadonlyArray<YkAttachment> | undefined): string {
  if (!atts || atts.length === 0) return "";
  return atts
    .map((a) => (a.name ?? "").trim() || (a.url ?? "").trim() || "附件")
    .join("、");
}
