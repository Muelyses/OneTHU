/**
 * 首启导览（2026-09-20 群反馈定案）：功能多是卖点，但**同时呈现**对非技术同学是负担。
 * 导览不删功能，只做两件事：① 按场景把用不到的首页卡片收起来（复用既有 homeCards 布局）；
 * ② 教会"收藏夹"这一次性动作（原子收藏是立身之本，但没人主动用）。
 *
 * 只写既有存储（onethu.home.layout.* / onethu.home.defaults），不新增机制、不动数据模型。
 */
import {
  HOME_CARD_META,
  loadCollapsedDefaults,
  loadLayout,
  saveCollapsedDefaults,
  saveLayout,
  type HomeCardId,
  type HomeLayoutItem,
  type HomeOrientation,
} from "../lib/homeCards.js";

const KEY = "onethu.onboarded.v1";

export function hasOnboarded(): boolean {
  try {
    return globalThis.localStorage?.getItem(KEY) === "1";
  } catch {
    return true; // 存不下时别反复弹
  }
}

export function markOnboarded(): void {
  try {
    globalThis.localStorage?.setItem(KEY, "1");
  } catch {
    /* ignore */
  }
}

/** 设置页「重新导览」：清标志即可下次自动弹（导览本身幂等、可重复走） */
export function resetOnboarding(): void {
  try {
    globalThis.localStorage?.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export interface Scenario {
  id: string;
  label: string;
  hint: string;
  /** 选了这个场景 → 这些卡片保持可见（其余收进右栏或关闭） */
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

/** 应用场景：未选的卡片进右栏（rail），右栏也放不下的关闭（off）；选中的置回主栏 */
export function applyScenarios(scenarioIds: string[], orientation: HomeOrientation): void {
  const keep = new Set<HomeCardId>(["today-overview"]);
  for (const s of SCENARIOS) if (scenarioIds.includes(s.id)) for (const id of s.keep) keep.add(id);

  const meta = HOME_CARD_META;
  const saved = loadLayout(orientation) ?? [];
  const byId = new Map(saved.map((it) => [it.id, it] as const));
  const items: HomeLayoutItem[] = meta.map((def) => {
    const prev = byId.get(def.id);
    const col: HomeLayoutItem["col"] = keep.has(def.id)
      ? (def.defaultCol === "main" ? "main" : "rail")
      : "off";
    return { id: def.id, col, collapsed: prev?.collapsed ?? !keep.has(def.id) };
  });
  saveLayout(items, orientation);

  // 被收起的卡片默认折叠，回到首页时不会又把一屏塞满
  const collapsed = { ...loadCollapsedDefaults() };
  for (const def of meta) if (!keep.has(def.id)) collapsed[def.id] = true;
  saveCollapsedDefaults(collapsed);
}


/** 预算好的使用场景预设（导览首屏二选一：自行选择 / 按场景预设）。
 *  选预设后仍可返回上一步改选，或改完再进"自行选择"逐项微调。 */
export interface Preset {
  id: string;
  label: string;
  hint: string;
  /** 保留在侧栏（展开）的页面；未列出的一律折叠 */
  pages: string[];
  /** 二级页签保留项：key → 保留的 tab id（未列出的隐藏） */
  tabs: Record<string, string[]>;
  /** 首页保留的场景（走 applyScenarios） */
  cards: string[];
}

const ALL_PAGES = [
  "today", "learn", "schedule", "trace", "mail", "cloud", "thubook",
  "info", "life", "reserve", "thos", "otherinfo",
];
const ALL_TABS = {
  info: ["report", "fitness", "exams", "evaluation", "calendar", "news", "profile", "courseinfo"],
  life: ["dorm", "washer", "hygiene", "card", "invoice", "payroll", "gradincome", "network"],
};

export const PRESETS: Preset[] = [
  {
    id: "complete",
    label: "完整",
    hint: "所有功能都在侧栏，适合想一次看全的人",
    pages: ALL_PAGES,
    tabs: ALL_TABS,
    cards: ["learn", "life", "schedule", "extend"],
  },
  {
    id: "minimal",
    label: "极简",
    hint: "只留今日、网络学堂、信息、生活、在线服务",
    pages: ["today", "learn", "info", "life", "thos"],
    tabs: { info: ["report", "exams", "profile"], life: ["card", "dorm", "washer"] },
    cards: ["learn"],
  },
  {
    id: "reserve",
    label: "预约狂人",
    hint: "日程、预约、场馆与宿舍设备为主",
    pages: ["today", "schedule", "reserve", "life", "thos"],
    tabs: { info: ["calendar"], life: ["dorm", "washer", "hygiene", "card"] },
    cards: ["schedule", "life"],
  },
  {
    id: "info",
    label: "信息大师",
    hint: "成绩、考试、学籍、新闻与网络学堂全在",
    pages: ["today", "learn", "info", "schedule", "thos", "otherinfo"],
    tabs: { info: ALL_TABS.info, life: ["card", "network"] },
    cards: ["learn", "schedule", "extend"],
  },
];

/** 应用预设：页面折叠 + 页签显隐 + 首页卡片，与手动路径写同一批存储 */
export function applyPreset(
  preset: Preset,
  foldPage: (page: string) => boolean,
  openPage: (page: string) => boolean,
): void {
  for (const p of ALL_PAGES) {
    if (preset.pages.includes(p)) openPage(p);
    else foldPage(p);
  }
  void applyScenarios(preset.cards, "portrait");
}

/** 预设与手动路径共用的页签 id 全集（供导览展示与对账） */
export const TAB_IDS_BY_KEY: Record<string, string[]> = ALL_TABS;
