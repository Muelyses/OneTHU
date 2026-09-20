/**
 * 导览的「场景 ↔ 首页卡片」映射（纯数据 + 纯函数）。
 *
 * 单独成模块的原因：`state/onboarding.ts` 会 import HOME_CARD_META（→ Icons.tsx），
 * node 测试跑不动 .tsx；把判定部分留在这里，`tools/onboarding-cards-test.mjs` 就能直接
 * 钉住「今日概览永远保留」「场景与卡片是同一份判定」这两条，无需浏览器环境。
 */
import type { HomeCardId } from "./homeCards.js";

export interface Scenario {
  id: string;
  label: string;
  hint: string;
  /** 该场景要保留的卡片 */
  keep: HomeCardId[];
}

/** 场景按"你要干什么"分组，而不是让用户对着一堆页面逐个勾 */
export const SCENARIOS: Scenario[] = [
  {
    id: "learn",
    label: "学习",
    hint: "作业、通知、课程文件、成绩",
    keep: ["today-overview", "homework", "notices", "learn-assignments", "learn-notices", "learn-files", "info-report"],
  },
  {
    id: "life",
    label: "校园生活",
    hint: "校园卡、电费、洗衣机、预约",
    keep: ["today-overview", "cardEntry", "resv", "life-dorm", "life-washer"],
  },
  {
    id: "schedule",
    label: "日程与课表",
    hint: "今日课程、日程提醒、课表",
    keep: ["today-overview", "agenda", "classes"],
  },
  {
    id: "extend",
    label: "插件与更多",
    hint: "插件市场、订阅新闻、选课",
    keep: ["today-overview", "news", "xk", "info-news"],
  },
];

/** 某组场景下应保留的卡片（导览先预览再落盘，与 applyScenarios 共用同一份判定） */
export function cardsForScenarios(scenarioIds: string[]): HomeCardId[] {
  const keep = new Set<HomeCardId>(["today-overview"]);
  for (const s of SCENARIOS) if (scenarioIds.includes(s.id)) for (const id of s.keep) keep.add(id);
  return [...keep];
}

/** 某个场景包含哪些卡片（导览里「收起这个场景」= 取消这些卡） */
export function cardsOfScenario(scenarioId: string): HomeCardId[] {
  return SCENARIOS.find((s) => s.id === scenarioId)?.keep ?? [];
}
