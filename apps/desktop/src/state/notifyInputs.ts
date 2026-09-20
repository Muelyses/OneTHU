/**
 * 通知计划的数据输入：把三处快照拍平成 notifyPlan 认识的最小形状。
 *
 * 单独成文件（而不是塞在 notifyRuntime 里）有两个理由：
 *   ① 运行时只该管「什么时候算」，取数属于数据层；
 *   ② 本文件拉的是 data/exthw（一路到 .tsx），Node 无法直跑；剥开之后 notifyRuntime
 *      就能在测试里注入假数据源，时机逻辑可断言。
 */
import { getCampusSnapshot, getLearnSnapshot } from "./data.js";
import { getExtHwSnapshot, toHomework } from "./exthw.js";
import type { PlanHomework, PlanScheduleEntry } from "./notifyPlan.js";

export function collectNotifyInputs(now = Date.now()): {
  schedule: PlanScheduleEntry[];
  homework: PlanHomework[];
} {
  const campus = getCampusSnapshot();
  const learn = getLearnSnapshot();
  const ext = getExtHwSnapshot();

  const schedule: PlanScheduleEntry[] = (campus?.schedule ?? []).map((e) => ({
    date: e.date,
    startTime: e.startTime ?? null,
    endTime: e.endTime ?? null,
    courseName: e.courseName,
    location: e.location ?? null,
    category: e.category ?? null,
  }));

  const homework: PlanHomework[] = [
    // 网络学堂：deadline 已是 "YYYY-MM-DD HH:MM"
    ...(learn?.homework ?? []).map((h) => ({
      id: h.id,
      title: h.title,
      deadline: h.deadline,
      submitted: h.submitted,
      courseName: (learn?.courses ?? []).find((c) => c.id === h.courseId)?.name ?? undefined,
    })),
    // 外部作业源（雨课堂 / TUOJ / Tyche / DSA OJ）：经 toHomework 统一形状后取同一批字段
    ...(ext?.items ?? []).map((e) => {
      const h = toHomework(e);
      return { id: h.id, title: h.title, deadline: h.deadline, submitted: h.submitted, courseName: h.courseName };
    }),
  ];

  return { schedule, homework };
}
