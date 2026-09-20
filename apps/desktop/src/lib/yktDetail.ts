/**
 * R20-B2：雨课堂原生作业详情页的纯判定 / 展示函数（零依赖，无 JSX / 无 React /
 * 无 Tauri —— tools/ykt-detail-ui-test.mjs 用 Node 直引做回归测试，约定同
 * ./androidHost.ts）。
 *
 * 范围：
 *  - 入口分流（R20-B2b 默认原生）：作业行点击统一三态判定 pickHomeworkRoute ——
 *    雨课堂 + 详情参数齐备 → 原生详情页（**全平台默认**，不再限 Android 宿主，PC 同样
 *    直达原生页）；其余外部源 / 参数缺失 → external（openExternalHomework 内部分流：
 *    Android → 桌面模式 WebView，桌面 → 系统浏览器）；无 source 的内部作业 → internal
 *    （learn-assignment-detail）。真实导航/打开动作收在 ./homeworkEntry.ts（薄执行层）；
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

/** 作业行点击的统一路由三态（R20-B2b：所有点击入口共用同一条判定） */
export type HomeworkRowRoute =
  | "ykt-native" // 雨课堂 + 详情参数齐备 → learn-ykt-detail 原生页（全平台默认）
  | "external-web" // 其余外部源 / 雨课堂参数缺失 → openExternalHomework（R20-A 分流）
  | "internal"; // 无 source 的网络学堂作业 → learn-assignment-detail

/** 作业行点击统一分流（纯函数，零依赖；真实导航/打开动作在 ./homeworkEntry.ts）：
 *  - "ykt-native"：雨课堂条目且 leafTypeId/classroomId 齐备 → 直达 learn-ykt-detail。
 *    R20-B2b 起**不再看宿主**：Android / 桌面（PC）一律默认原生，官方页降为页内
 *    「浏览器打开」备用出口（真机反馈：Android 上仍落 R20-A WebView，桌面原生页
 *    同样可用，故收敛为同一默认）；参数缺失才回退 external（详情拉不了，别把用户
 *    带进死页）；
 *  - "external-web"：非雨课堂外部源（TUOJ/Tyche…）或雨课堂参数缺失 → 保持 R20-A
 *    现状（openExternalHomework：Android 应用内 WebView 桌面模式，桌面系统浏览器）；
 *  - "internal"：无 source 的网络学堂作业 → learn-assignment-detail。 */
export function pickHomeworkRoute(row: YktEntryRow): HomeworkRowRoute {
  if (row.source === "yuketang" && Boolean(row.externalLeafTypeId) && Boolean(row.externalClassroomId)) {
    return "ykt-native";
  }
  return row.source ? "external-web" : "internal";
}

/** 雨课堂原生详情页入口判定（R20-B2 两态口径，pickHomeworkRoute 的投影，
 *  保留给旧调用点/测试：native ⇔ pickHomeworkRoute(row) === "ykt-native"）。 */
export function pickYktDetailEntry(row: YktEntryRow): "native" | "external" {
  return pickHomeworkRoute(row) === "ykt-native" ? "native" : "external";
}

/* ── 展示口径 ── */

/** 分数文案：数字直转（JS Number 不保留尾零：2 → "2"、2.5 → "2.5"、30.00 → "30"）。
 *  独立成函数是给后续分数舍入规则留缝，B2 原样展示。 */
export function yktScoreText(n: number): string {
  return String(n);
}

/** 入口行分数文案（R9 考试口径；R20-B3 起已批改雨课堂作业共用同一函数同一显示位）：
 *  已提交且带分 → "X/Y"（有卷面满分）/ "X"；未提交 / 无分（未出分 / 未批改）→ "" 不显示。
 *  「何时有分」由 core 决定（作业仅整卷已批改合计透出、试卷仅已出分透出），这里只管显示——
 *  两端（PC/移动）共用 HomeworkRow，一套 UI 自动生效。 */
export function homeworkEntryScoreText(h: { submitted?: boolean; score?: number; totalScore?: number }): string {
  if (!h.submitted || h.score === undefined) return "";
  return h.totalScore !== undefined ? `${yktScoreText(h.score)}/${yktScoreText(h.totalScore)}` : yktScoreText(h.score);
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

/* ── 老师评语去重（R20-B3 fix，2026-09-20 霖 PC 实测：详情页同一评语渲染两次） ──
 *
 * 现象：详情页老师评语区出现两处相同内容——「老师评语：…」（remark 渲染）与
 * 「盛洁：…」（批注 comment[] 渲染，批注人名 + 相同内容）。
 * 排查（2026-09-20）：详情接口同一端点（get_exercise_list）的
 * `problems[].user{ remark, comment[]{content,index,name,avatar,attachment} }` 两个
 * 结构化字段在已批改题上会被雨课堂写成同文（R16 21.1 实测判别器已证 comment[] 在
 * status 4 题上是教师评语；本机 YKT_COOKIE 已失效 401000 无法再拉新快照，按既有
 * 实测字段表 + 霖所见「批注人名 + 同文」形状定位：两处分别来自 remark 与 comment[]，
 * my_answer.content 无批注人名形态可排除「作答内嵌批注块」假设）。core 保持数据
 * 忠实（不丢字段，R20-C 提交链路 / 未来导出仍要原始两字段），去重收敛在展示层。
 *
 * 口径：同文（忽略空白差异；批注人名按「名：内容」嵌名形态并比，冒号全半角折叠）
 * 只渲染一处，**优先保留具名批注行**（含批注人 = 渲染信息更全的规整口径）；无名批注
 * 与 remark 同文时两者渲染形态相同，保留 remark、丢批注。不同文的评语一律原样保留
 * （总评 + 逐条批注并存的合法形态不受影响）；remark 缺失时批注之间自身去重（首条优先）。
 */

/** 评语去重的最小输入（core YkProblem 的 remark / comments 子集，测试可传普通对象） */
export interface YktRemarkLike {
  /** 老师总评（user.remark） */
  remark?: string;
  /** 老师批注（user.comment[]，core 已滤空 content） */
  comments?: ReadonlyArray<{ content: string; name?: string; index?: number }>;
}

/** 去重后的渲染口径：remark / comments 缺省 = 该层不渲染（评语区整体隐藏） */
export interface YktRemarkView {
  remark?: string;
  comments?: Array<{ content: string; name?: string; index?: number }>;
}

/** 同文判定键：折叠所有空白 + 冒号全半角归一（"好" ≈ " 好 "；"盛洁：好" ≈ "盛洁:好"） */
function yktRemarkKey(s: string): string {
  return s.replace(/\s+/gu, "").replace(/[:：]/gu, ":");
}

/** 老师评语去重（纯函数）：同文评语只保留一处（详见上方口径说明）。
 *  返回值不含空数组/空串——调用方按「字段缺省 = 不渲染该层」处理。 */
export function dedupeYktRemarks(p: YktRemarkLike): YktRemarkView {
  const comments = (p.comments ?? []).filter((c) => typeof c.content === "string" && c.content.trim() !== "");
  const remark = typeof p.remark === "string" && p.remark.trim() !== "" ? p.remark : undefined;
  const remarkKey = remark !== undefined ? yktRemarkKey(remark) : "";
  // 与总评同文的具名批注（含「盛洁：好」嵌名形态）→ 保留批注行（批注人信息更全），总评不再单独渲染
  const namedDup =
    remarkKey !== ""
      ? comments.find(
          (c) =>
            c.name !== undefined &&
            (yktRemarkKey(c.content) === remarkKey || yktRemarkKey(`${c.name}：${c.content}`) === remarkKey),
        )
      : undefined;
  const dropRemark = namedDup !== undefined;
  const seen = new Set<string>();
  // 总评保留时先占同文键：后续与总评同文的（无名）批注自然被滤掉
  if (remark !== undefined && !dropRemark) seen.add(remarkKey);
  const out: NonNullable<YktRemarkView["comments"]> = [];
  for (const c of comments) {
    const key = yktRemarkKey(c.content);
    // 与总评 / 已收批注同文 → 丢（同文只渲染一处；不同文的批注原样保留）
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return {
    ...(remark !== undefined && !dropRemark ? { remark } : {}),
    ...(out.length > 0 ? { comments: out } : {}),
  };
}
