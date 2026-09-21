/**
 * 导览的「场景 ↔ 首页卡片」映射（纯数据 + 纯函数）。
 *
 * 单独成模块的原因：`state/onboarding.ts` 会 import HOME_CARD_META（→ Icons.tsx），
 * node 测试跑不动 .tsx；把判定部分留在这里，`tools/onboarding-cards-test.mjs` 就能直接
 * 钉住「今日概览永远保留」「场景与卡片是同一份判定」这两条，无需浏览器环境。
 */
import type { HomeCardId, HomeCol, HomeLayoutItem } from "./homeCards.js";

/** 卡片最小元数据（HOME_CARD_META 满足；测试可传桩） */
export interface CardPlan {
  id: HomeCardId;
  defaultCol: HomeCol;
}

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

/**
 * 由「留哪些卡」算出新布局（纯函数，便于测试；applyTodayCards 只是它的落盘壳）。
 *
 * 关键规则（事故原型 2026-09-20：导览里明明"留了"最近使用/猜你喜欢，首页依旧空白）：
 *   · 留下的卡若当前是 `off`（上一轮被收起过），**必须按注册表默认栏位放回可见位置**——
 *     只"保留 it"等于什么都没做，卡还在 off 里躺着；
 *   · 没留的卡一律 off + 折叠；
 *   · 结果全 off 视为无效（宁可给一份默认布局，也不交出空白首页）。
 */
export function planTodayCards(
  keep: HomeCardId[],
  saved: HomeLayoutItem[],
  defs: CardPlan[],
): { items: HomeLayoutItem[]; empty: boolean } {
  const safe = keep.length > 0 ? keep : (["today-overview"] as HomeCardId[]);
  const keepSet = new Set(safe);
  const defById = new Map(defs.map((d) => [d.id, d] as const));
  const seen = new Set<HomeCardId>();
  const items: HomeLayoutItem[] = [];
  for (const it of saved) {
    const def = defById.get(it.id);
    if (!def || seen.has(it.id)) continue;
    seen.add(it.id);
    if (keepSet.has(it.id)) {
      const wasOff = it.col === "off";
      items.push({ id: it.id, col: wasOff ? def.defaultCol : it.col, collapsed: wasOff ? false : it.collapsed });
    } else {
      items.push({ id: it.id, col: "off", collapsed: true });
    }
  }
  // 注册表里有、但存储里还没有的卡（新版本新增的）：按是否保留决定栏位
  for (const def of defs) {
    if (seen.has(def.id)) continue;
    seen.add(def.id);
    items.push(
      keepSet.has(def.id)
        ? { id: def.id, col: def.defaultCol, collapsed: false }
        : { id: def.id, col: "off", collapsed: true },
    );
  }
  const visible = items.some((i) => i.col !== "off");
  return { items, empty: !visible };
}
