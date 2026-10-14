/**
 * 起步模板（P2.5，纯逻辑）：给空板一套预制排版，避免用户面对"一块什么都没有的白板"。
 *
 * 方案：docs/原子收藏-可行性与实现方案.md §5.3（起步模板）。
 * 高度按**瓦片**估算；套用后白板的「一次性拟合」会把装不下的项再撑高，因此这里取保守值即可。
 */
import { BOARD_COLS, type BoardItem, type WidgetSpec } from "./boardCore.js";

export interface TemplateItem {
  spec: WidgetSpec;
  cell: { x: number; y: number; w: number; h: number };
}

export interface BoardTemplate {
  id: string;
  name: string;
  description: string;
  /** 按顺序给出条目；y 由调用方按 h 紧凑排布（模板里只写列与高，避免手工算 y 出错）。 */
  items: TemplateItem[];
}

const MAIN = 3;

/** 三套起步排版：今日速览 / 学习 / 极简。 */
export const BOARD_TEMPLATES: readonly BoardTemplate[] = [
  {
    id: "tpl-today",
    name: "今日速览",
    description: "课表、作业、通知与余额，与「首页」同构。",
    items: [
      { spec: { kind: "custom", id: "classes" }, cell: { x: 0, y: 0, w: MAIN, h: 5 } },
      { spec: { kind: "custom", id: "homework" }, cell: { x: 0, y: 0, w: MAIN, h: 5 } },
      { spec: { kind: "custom", id: "notices" }, cell: { x: 0, y: 0, w: MAIN, h: 4 } },
      { spec: { kind: "custom", id: "balance-strip" }, cell: { x: 0, y: 0, w: MAIN, h: 1 } },
      { spec: { kind: "custom", id: "next-class" }, cell: { x: MAIN, y: 0, w: BOARD_COLS - MAIN, h: 1 } },
    ],
  },
  {
    id: "tpl-learn",
    name: "学习为主",
    description: "全部作业、通知与课程文件，适合考试周盯着进度。",
    items: [
      { spec: { kind: "custom", id: "learn-assignments" }, cell: { x: 0, y: 0, w: MAIN, h: 5 } },
      { spec: { kind: "custom", id: "learn-notices" }, cell: { x: 0, y: 0, w: MAIN, h: 4 } },
      { spec: { kind: "custom", id: "learn-files" }, cell: { x: 0, y: 0, w: MAIN, h: 3 } },
      { spec: { kind: "custom", id: "classes" }, cell: { x: MAIN, y: 0, w: BOARD_COLS - MAIN, h: 4 } },
    ],
  },
  {
    id: "tpl-min",
    name: "极简",
    description: "一个标题、一张课表、一条余额，先跑起来再慢慢加。",
    items: [
      { spec: { kind: "text", text: "我的白板", variant: "title" }, cell: { x: 0, y: 0, w: BOARD_COLS, h: 1 } },
      { spec: { kind: "custom", id: "classes" }, cell: { x: 0, y: 0, w: MAIN, h: 5 } },
      { spec: { kind: "custom", id: "balance-strip" }, cell: { x: 0, y: 0, w: MAIN, h: 1 } },
    ],
  },
];

export function templateById(id: string): BoardTemplate | null {
  return BOARD_TEMPLATES.find((t) => t.id === id) ?? null;
}

/** 把模板展开成条目：主列/侧栏各自按 h 紧凑排布（模板只写列与高，y 在这里算）。 */
export function templateItems(tpl: BoardTemplate, now = Date.now()): BoardItem[] {
  const cursor: Record<string, number> = { main: 0, rail: 0 };
  return tpl.items.map((it, i) => {
    const key = it.cell.x >= MAIN ? "rail" : "main";
    const y = cursor[key] ?? 0;
    cursor[key] = y + Math.max(1, it.cell.h);
    return {
      id: "it." + tpl.id + "." + String(i) + "." + now.toString(36),
      spec: it.spec,
      cell: { x: it.cell.x, y, w: it.cell.w, h: Math.max(1, it.cell.h) },
    };
  });
}
