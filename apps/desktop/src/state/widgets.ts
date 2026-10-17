/**
 * 组件目录的应用侧适配器：把今日页的卡片注册表变成白板可用的组件条目。
 *
 * 方案：docs/原子收藏-可行性与实现方案.md §4.4（七项定义）与 §7（判定表）。
 * 本文件会（经 homeCards）引入 .tsx 图标，因此只给应用用；纯核心在 state/widgetMeta.ts。
 * 昂贵档口径（霖 2026-10-09 定）：本轮先复用现有卡壳，卡片本体抽取留到后续批次。
 */
import { HOME_CARD_META, type HomeCardDef } from "../lib/homeCards.js";
import { BOARD_UNITS, PRESET_WIDGETS, type SizeRange, type SizeTier, type WidgetDef } from "./widgetMeta.js";

/** 主栏卡默认 3 单位宽、侧栏卡 1 单位宽：与今日页现状的两栏比例一致。 */
function defaultWidth(def: HomeCardDef): number {
  return def.defaultCol === "rail" ? 1 : 3;
}

/**
 * 尺寸范围：宽度可调（1..4 基准单位），高度暂不开放。
 *
 * 原因：本仓库白板的网格行高由内容决定（卡片可高达数百像素），高度单位因此没有可用的基准——
 * 把高度从 1 调到 2 会让卡片跨两行、高度跳到两张卡之和。要让高度可调，先得给画布定一个
 * 基准瓦片高（卡片内部滚动或裁剪），这是待霖定的事（见文档 30.21 末段）。
 * 界面侧已按「能调哪侧才显示哪侧」隐藏南北把手，两者口径一致。
 */
function rangeFor(_def: HomeCardDef): SizeRange {
  return { minW: 1, minH: 1, maxW: BOARD_UNITS, maxH: 8 };
}

/* ══════════ 尺寸档位（霖 2026-10-11 口径）══════════
 *
 * 「自由控制」只留给四类特殊组件：分割线 / 标题（文字）/ 入口按钮 / 列表。
 * 其余组件一律**挡位控制**：每个档位一套专门排版，用户不能拖出档位以外的尺寸。
 *
 * 下面这张表就是「需要逐个设计不同大小排版的组件」清单的机读形态（人读版见
 * docs/白板组件尺寸档清单.md）。tiers 为提案档位，待逐个设计排版后调整。
 */

/** 数字卡（一个主数值 + 小标签）的通用档位。 */
const STAT_TIERS: readonly SizeTier[] = [{ w: 1, h: 1 }, { w: 2, h: 1 }, { w: 2, h: 2 }];
/** 学生卡（姓名 / 学号 / 院系三行）的档位。 */
const STUDENT_TIERS: readonly SizeTier[] = [{ w: 2, h: 1 }, { w: 4, h: 1 }, { w: 4, h: 2 }];

export interface SizePlan {
  /** 档位清单（有序、由小到大）。 */
  tiers: readonly SizeTier[];
  /** 从「添加组件」加入时的推荐档位，必须落在 tiers 里。 */
  def: SizeTier;
}

/**
 * 挡位控制组件的档位提案表。键为组件目录 id 去掉 "custom:" 前缀后的卡片 id；
 * 页面自带组件（我的四张数字卡、成绩四张统计卡）也在此登记。
 */
export const SIZE_PLANS: Record<string, SizePlan> = {
  /* —— 卡片类（今日页注册表）—— */
  /* —— 环境/时钟三件套（2026-10-13）—— */
  clock: { tiers: [{ w: 2, h: 1 }, { w: 2, h: 2 }], def: { w: 2, h: 1 } },
  date: { tiers: [{ w: 2, h: 1 }, { w: 4, h: 1 }], def: { w: 2, h: 1 } },
  weather: { tiers: [{ w: 2, h: 2 }, { w: 4, h: 2 }], def: { w: 2, h: 2 } },
  "balance-strip": { tiers: [{ w: 4, h: 1 }, { w: 4, h: 2 }], def: { w: 4, h: 1 } },
  "today-overview": { tiers: [{ w: 4, h: 1 }, { w: 4, h: 2 }, { w: 4, h: 4 }], def: { w: 4, h: 1 } },
  agenda: { tiers: [{ w: 4, h: 2 }, { w: 4, h: 4 }], def: { w: 4, h: 2 } },
  "next-class": { tiers: [{ w: 1, h: 1 }, { w: 2, h: 1 }, { w: 4, h: 2 }], def: { w: 1, h: 1 } },
  cardEntry: { tiers: [{ w: 1, h: 1 }, { w: 2, h: 1 }, { w: 2, h: 2 }], def: { w: 1, h: 1 } },
  resv: { tiers: [{ w: 1, h: 1 }, { w: 2, h: 1 }, { w: 4, h: 2 }], def: { w: 1, h: 1 } },
  news: { tiers: [{ w: 1, h: 1 }, { w: 2, h: 1 }, { w: 4, h: 2 }], def: { w: 1, h: 1 } },
  /* —— 我的页数字卡 —— */
  "mine-balance": { tiers: STAT_TIERS, def: { w: 1, h: 1 } },
  "mine-credit": { tiers: STAT_TIERS, def: { w: 1, h: 1 } },
  "mine-gpa": { tiers: STAT_TIERS, def: { w: 1, h: 1 } },
  "mine-student": { tiers: STUDENT_TIERS, def: { w: 2, h: 1 } },
  /* —— 成绩元素级拆分里的四张统计卡（成绩明细是列表，保留自由控制）—— */
  "report-done": { tiers: STAT_TIERS, def: { w: 2, h: 2 } },
  "report-credit": { tiers: STAT_TIERS, def: { w: 2, h: 2 } },
  "report-overall": { tiers: STAT_TIERS, def: { w: 2, h: 2 } },
  "report-latest": { tiers: STAT_TIERS, def: { w: 2, h: 2 } },
};

/**
 * 逐卡的用户可见描述（长按菜单「详情」的正文）。
 * 要求：用户读得懂、并讲清它需要什么上下文（多数卡片需要登录）。
 */
export const CARD_DESCRIPTIONS: Record<string, string> = {
  services: "首页一级功能区，可自选服务入口，也可移动、调整大小或删除。",
  clock: "本地时间，每秒走字；大一号的档位会带上日期与星期。不需要登录。",
  date: "今天的日期与星期；宽档位会带上年份。不需要登录。",
  weather: "清华园实时天气与未来三天预报，开放数据半小时一更。不需要登录。",
  "balance-strip": "显示校园卡余额，点进去可看流水与充值。需要登录。",
  classes: "今天的课程与上课时间地点。需要登录并已同步课表。",
  homework: "还没提交的作业清单，按截止时间排列。需要登录。",
  notices: "最近的教学通知，点开可看正文。需要登录。",
  "for-you": "根据你的使用习惯推荐的入口。需要登录。",
  "today-overview": "今天剩余日程与待办的概览。需要登录。",
  agenda: "日程与提醒，含作业截止与课程冲突。需要登录。",
  "next-class": "距离下一节课的倒计时与上课地点。需要登录并已同步课表。",
  resv: "今天已经预约的场馆与座位。需要登录。",
  news: "你订阅的校内新闻。需要登录。",
  xk: "选课入口与选课时间提示。需要登录。",
  "learn-assignments": "网络学堂的全部作业（含外部作业源）。需要登录。",
  "learn-notices": "网络学堂的全部通知。需要登录。",
  "learn-files": "网络学堂的课程文件。需要登录。",
  "info-news": "信息门户的订阅新闻。需要登录。",
  "info-report": "历年成绩与平均绩点。需要登录。",
  "info-exams": "考试安排与考场。需要登录。",
  "info-profile": "个人信息（学号、院系、邮箱）。需要登录。",
  "life-dorm": "宿舍电费、订水与相关缴费。需要登录。",
  "life-washer": "洗衣机状态与预约。需要登录。",
  "life-card": "校园卡余额、流水与充值。需要登录。",
  "reserve-lib": "图书馆座位预约。需要登录。",
  "reserve-room": "研讨间预约。需要登录。",
  "learn-semester": "切换当前学期。需要登录。",
  "learn-search": "在网络学堂范围内搜索。需要登录。",
  "life-invoice": "电子发票的开具与查询。需要登录。",
  "life-payroll": "银行代发记录。需要登录。",
  "life-gradincome": "研究生收入记录。需要登录。",
  "life-hygiene": "宿舍卫生成绩。需要登录。",
  "info-fitness": "体测成绩。需要登录。",
  "info-evaluation": "待完成的教学评估。需要登录。",
  "info-calendar": "校历：学期周次与假期。需要登录。",
  "reserve-classroom": "空教室查询。需要登录。",
  "life-network": "校园网账号与流量。需要登录。",
  "reserve-sports": "体育场馆预约。需要登录。",
  "reserve-kongjian": "公共空间预约。需要登录。",
};

/**
 * 卡片是否保留自由控制：入口按钮（kind === "entry"）与列表型组件（LIST_WIDGET_IDS）。
 * 其余卡片走挡位控制。
 */
function isFreeSizeCard(def: HomeCardDef): boolean {
  return def.id === "services" || def.kind === "entry" || LIST_WIDGET_IDS.includes("custom:" + String(def.id));
}

/** 便笺（白板随手写字；可收起）。放应用侧而非 PRESET：widgetMeta 的 preset 列表
 *  必须保持「无 custom 条目」，否则 defForSpec 的按-kind 兜底会把未知 custom 全部
 *  误解析成它（widget-render 护栏钉的就是这条）。 */
export const NOTE_WIDGET: WidgetDef = {
  id: "custom:note",
  spec: { kind: "custom", id: "note" },
  title: "便笺",
  description: "一张随手写的小纸条，可以折起来只留标题条。长按组件选「属性」改字与颜色。",
  defaultSize: { w: 2, h: 2 },
  sizeRange: { minW: 1, minH: 1, maxW: BOARD_UNITS, maxH: 4 },
  sizeControl: "free",
  editableProps: [
    { key: "text", label: "内容", kind: "text", maxLength: 200, placeholder: "写点什么…" },
    { key: "tone", label: "纸色", kind: "select", options: [{ value: "yellow", label: "黄" }, { value: "pink", label: "粉" }, { value: "blue", label: "蓝" }, { value: "green", label: "绿" }] },
  ],
};

/** 卡片的组件目录条目：spec 用 custom + 卡片 id（与今日页白板文档同构）。 */
export function cardWidgetDefs(): WidgetDef[] {
  return HOME_CARD_META.map((def) => {
    const id = String(def.id);
    const w = defaultWidth(def);
    const free = isFreeSizeCard(def);
    const plan: SizePlan = SIZE_PLANS[id] ?? { tiers: [{ w, h: 1 }], def: { w, h: 1 } };
    return {
      id: "custom:" + id,
      spec: { kind: "custom", id },
      title: def.title,
      description: CARD_DESCRIPTIONS[id] ?? "",
      defaultSize: id === "services" ? { w: 4, h: 3 } : id === "homework" ? { w: 4, h: 4 } : free ? { w, h: 2 } : { ...plan.def },
      sizeRange: rangeFor(def),
      sizeControl: free ? "free" : "tiers",
      sizeTiers: free ? undefined : plan.tiers,
    } satisfies WidgetDef;
  });
}

/**
 * 页面自己发布的组件（不是今日页卡片）：目前是「我的」页的三张数字卡。
 * 它们在白板上靠 state/liveCards.ts 的卡体渲染，因此必须在此登记，否则会被判为「未知组件」。
 */
export const PAGE_WIDGETS: readonly WidgetDef[] = [
  {
    id: "custom:mine-student",
    spec: { kind: "custom", id: "mine-student" },
    title: "学生卡",
    description: "来自「我的」页的学生卡：姓名、学号与院系。",
    defaultSize: { w: 3, h: 2 },
    sizeRange: { minW: 1, minH: 1, maxW: BOARD_UNITS, maxH: 3 },
  },
  {
    id: "custom:mine-balance",
    spec: { kind: "custom", id: "mine-balance" },
    title: "校园卡余额",
    description: "来自「我的」页的余额数字，点击可进校园卡。",
    defaultSize: { w: 1, h: 1 },
    sizeRange: { minW: 1, minH: 1, maxW: BOARD_UNITS, maxH: 2 },
  },
  {
    id: "custom:mine-credit",
    spec: { kind: "custom", id: "mine-credit" },
    title: "学分",
    description: "来自「我的」页的已修学分，需要登录后才有数。",
    defaultSize: { w: 1, h: 1 },
    sizeRange: { minW: 1, minH: 1, maxW: BOARD_UNITS, maxH: 2 },
  },
  {
    id: "custom:mine-gpa",
    spec: { kind: "custom", id: "mine-gpa" },
    title: "GPA",
    description: "来自「我的」页的平均绩点，需要登录后才有数。",
    defaultSize: { w: 1, h: 1 },
    sizeRange: { minW: 1, minH: 1, maxW: BOARD_UNITS, maxH: 2 },
  },
  {
    id: "custom:info-report",
    spec: { kind: "custom", id: "info-report" },
    title: "成绩栏目",
    description: "信息页成绩栏目的全部数据：每学期加权平均、学分与逐条成绩。",
    defaultSize: { w: 3, h: 4 },
    sizeRange: { minW: 1, minH: 1, maxW: BOARD_UNITS, maxH: 8 },
  },
  {
    id: "custom:info-fitness",
    spec: { kind: "custom", id: "info-fitness" },
    title: "体测栏目",
    description: "信息页体测栏目的数据卡。",
    defaultSize: { w: 3, h: 4 },
    sizeRange: { minW: 1, minH: 1, maxW: BOARD_UNITS, maxH: 8 },
  },
  {
    id: "custom:info-exams",
    spec: { kind: "custom", id: "info-exams" },
    title: "考试栏目",
    description: "信息页考试安排栏目的数据卡。",
    defaultSize: { w: 3, h: 4 },
    sizeRange: { minW: 1, minH: 1, maxW: BOARD_UNITS, maxH: 8 },
  },
  {
    id: "custom:info-evaluation",
    spec: { kind: "custom", id: "info-evaluation" },
    title: "教学评估栏目",
    description: "信息页教学评估栏目的数据卡。",
    defaultSize: { w: 3, h: 4 },
    sizeRange: { minW: 1, minH: 1, maxW: BOARD_UNITS, maxH: 8 },
  },
  {
    id: "custom:info-calendar",
    spec: { kind: "custom", id: "info-calendar" },
    title: "校历栏目",
    description: "信息页校历栏目的数据卡。",
    defaultSize: { w: 3, h: 4 },
    sizeRange: { minW: 1, minH: 1, maxW: BOARD_UNITS, maxH: 8 },
  },
  {
    id: "custom:info-news",
    spec: { kind: "custom", id: "info-news" },
    title: "新闻栏目",
    description: "信息页新闻栏目的数据卡。",
    defaultSize: { w: 3, h: 4 },
    sizeRange: { minW: 1, minH: 1, maxW: BOARD_UNITS, maxH: 8 },
  },
  {
    id: "custom:info-profile",
    spec: { kind: "custom", id: "info-profile" },
    title: "个人信息栏目",
    description: "信息页个人信息栏目的数据卡。",
    defaultSize: { w: 3, h: 4 },
    sizeRange: { minW: 1, minH: 1, maxW: BOARD_UNITS, maxH: 8 },
  },
  {
    id: "custom:info-courseinfo",
    spec: { kind: "custom", id: "info-courseinfo" },
    title: "课程信息栏目",
    description: "信息页课程信息栏目的数据卡。",
    defaultSize: { w: 3, h: 4 },
    sizeRange: { minW: 1, minH: 1, maxW: BOARD_UNITS, maxH: 8 },
  },
];

/**
 * 列表型组件：编辑态下**不实时渲染内容**，改显示占位与文字标注。
 *
 * 原因（霖 2026-10-11 口径）：这类组件的内容与高度随数据变化，编辑时满屏列表既看不清布局、
 * 又容易让人误以为在编辑列表内容。退出编辑模式后照常显示真实内容。
 */
export const LIST_WIDGET_IDS: readonly string[] = [
  "custom:homework",
  "custom:notices",
  "custom:classes",
  "custom:for-you",
  "custom:learn-assignments",
  "custom:learn-notices",
  "custom:learn-files",
  "custom:info-report",
  "custom:info-fitness",
  "custom:info-exams",
  "custom:info-evaluation",
  "custom:info-calendar",
  "custom:info-news",
  "custom:info-profile",
  "custom:info-courseinfo",
];

/**
 * 元素级拆分的成绩组件（霖 2026-10-11 定口径 B：复合卡片拆到元素级）。
 *
 * 「全部成绩」原本是一张复合卡（4 块统计 + 明细列表）。按元素拆开后：
 * 四张统计卡各占 2×2，明细列表占 4×4——用户可以只放"总学分"或只放"明细"。
 */
export const REPORT_ELEMENT_WIDGETS: readonly WidgetDef[] = [
  {
    id: "custom:report-done",
    spec: { kind: "custom", id: "report-done" },
    title: "已修课程",
    description: "成绩单里的课程门数。需要登录。",
    defaultSize: { w: 2, h: 2 },
    sizeRange: { minW: 1, minH: 1, maxW: BOARD_UNITS, maxH: 3 },
  },
  {
    id: "custom:report-credit",
    spec: { kind: "custom", id: "report-credit" },
    title: "总学分",
    description: "成绩单里的学分合计。需要登录。",
    defaultSize: { w: 2, h: 2 },
    sizeRange: { minW: 1, minH: 1, maxW: BOARD_UNITS, maxH: 3 },
  },
  {
    id: "custom:report-overall",
    spec: { kind: "custom", id: "report-overall" },
    title: "全部学年加权",
    description: "全部学年的加权平均分。需要登录。",
    defaultSize: { w: 2, h: 2 },
    sizeRange: { minW: 1, minH: 1, maxW: BOARD_UNITS, maxH: 3 },
  },
  {
    id: "custom:report-latest",
    spec: { kind: "custom", id: "report-latest" },
    title: "最新学期加权",
    description: "最近一个学期的加权平均分。需要登录。",
    defaultSize: { w: 2, h: 2 },
    sizeRange: { minW: 1, minH: 1, maxW: BOARD_UNITS, maxH: 3 },
  },
  {
    id: "custom:report-list",
    spec: { kind: "custom", id: "report-list" },
    title: "成绩明细",
    description: "按学期分组的成绩与绩点。需要登录。",
    defaultSize: { w: 4, h: 4 },
    sizeRange: { minW: 2, minH: 2, maxW: BOARD_UNITS, maxH: 8 },
  },
];

/**
 * "具体项"模板组件（霖 2026-10-11 定）：这类条目**个数不可数**（课程文件、通知、作业…每一学期都不一样），
 * 因此每一类做成**一个模板组件**，具体显示哪一条由**编辑界面里的列表 + 搜索框**选择，
 * 选择结果写进条目的 `spec.props`（渲染器据此取数）。
 *
 * 与 `REPORT_ELEMENT_WIDGETS` 的区别：那些是"固定的统计块"，这些是"同类中的某一条"。
 */
export const ATOM_TEMPLATE_WIDGETS: readonly WidgetDef[] = [
  {
    id: "custom:learn-file",
    spec: { kind: "custom", id: "learn-file" },
    title: "课程文件条目",
    description: "选一条课程文件常驻显示。需要登录。",
    defaultSize: { w: 4, h: 1 },
    sizeRange: { minW: 2, minH: 1, maxW: BOARD_UNITS, maxH: 3 },
  },
];

/** 模板组件的 id 集合（编辑界面据此提供「选择条目」入口）。 */
export const ATOM_TEMPLATE_IDS: readonly string[] = ATOM_TEMPLATE_WIDGETS.map((d) => d.spec.kind === "custom" ? "custom:" + d.spec.id : d.id);

export function isListWidget(id: string): boolean {
  return LIST_WIDGET_IDS.includes(id);
}

/**
 * 页面自带组件的大小控制登记：SIZE_PLANS 里有 = 挡位控制（并采用提案档位与推荐档位），
 * 没有 = 自由控制（列表条目这类内容自适应的组件）。已经登记过的原样返回。
 */
function withSizeControl(def: WidgetDef): WidgetDef {
  if (def.sizeControl) return def;
  const key = def.id.startsWith("custom:") ? def.id.slice("custom:".length) : def.id;
  const plan = SIZE_PLANS[key];
  if (plan) return { ...def, defaultSize: { ...plan.def }, sizeControl: "tiers", sizeTiers: plan.tiers };
  return { ...def, sizeControl: "free" };
}

/** 保留自由控制的组件目录 id 全集（分割线 / 文字 / 入口按钮 / 列表 + 行级条目）。 */
export function freeSizeWidgetIds(): readonly string[] {
  const ids = new Set<string>(["divider", "text-title", "text-label", "custom:learn-file"]);
  for (const id of LIST_WIDGET_IDS) ids.add(id);
  for (const def of HOME_CARD_META) if (def.kind === "entry") ids.add("custom:" + String(def.id));
  return [...ids];
}

/** 应用侧全部条目（预制 + 卡片 + 页面自带组件）。 */
export function appWidgetDefs(): WidgetDef[] {
  return [
    ...cardWidgetDefs(),
    NOTE_WIDGET,
    ...PAGE_WIDGETS.map(withSizeControl),
    ...REPORT_ELEMENT_WIDGETS.map(withSizeControl),
    ...ATOM_TEMPLATE_WIDGETS.map(withSizeControl),
  ];
}

/**
 * 目录总表（预制 + 应用侧），**按 id 去重**（保留第一条）。
 *
 * 信息页栏目既作为入口卡（HOME_CARD_META）登记，又作为页面自带组件（PAGE_WIDGETS）登记，
 * 两者 id 相同、spec 相同，是同一个白板组件；不去重会让「添加组件」出现两张同名卡片。
 */
export function allWidgetDefs(): WidgetDef[] {
  const out: WidgetDef[] = [];
  const seen = new Set<string>();
  for (const d of [...PRESET_WIDGETS, ...appWidgetDefs()]) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    out.push(d);
  }
  return out;
}

/** 挡位控制的组件目录 id 全集（需要逐个设计不同大小排版的组件）。 */
export function tierWidgetIds(defs: readonly WidgetDef[] = allWidgetDefs()): readonly string[] {
  const free = new Set(freeSizeWidgetIds());
  return defs.filter((d) => !free.has(d.id) && d.sizeControl !== "free").map((d) => d.id);
}
