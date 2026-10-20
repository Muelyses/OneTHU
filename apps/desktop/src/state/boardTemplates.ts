/**
 * 起步模板（P2.5，纯逻辑）：给空板一套预制排版，避免用户面对"一块什么都没有的白板"。
 *
 * 方案：docs/原子收藏-可行性与实现方案.md §5.3（起步模板）。
 * 模板直接使用自由画布的像素坐标；cell 仅是插件/OH 的兼容镜像，不能再用它反推显示尺寸。
 * 基准宽度与默认首页相同（1104px），列表保留阅读空间，超出首屏的内容由页面纵向滚动承接。
 */
import { cellFromRect, homeStarterItems, type BoardItem, type BoardRect, type WidgetSpec } from "./boardCore.js";
import { ensureNoOverlap } from "./boardReflow.js";

export interface TemplateItem {
  spec: WidgetSpec;
  cell: { x: number; y: number; w: number; h: number };
  rect: BoardRect;
  /** 明确固定过尺寸的预设继续尊重其尺寸；未指定的内容沿用按内容拟合。 */
  manual?: boolean;
}

export interface BoardTemplate {
  id: string;
  name: string;
  description: string;
  /** 原生像素版式；用户套用后仍可任意移动、缩放或重叠。 */
  items: TemplateItem[];
}

function tile(spec: WidgetSpec, x: number, y: number, w: number, h: number): TemplateItem {
  const rect = { x, y, w, h };
  return { spec, rect, cell: cellFromRect(rect) };
}

/** 四套起步排版只在用户主动选择时应用，不迁移已经保存的自由布局。 */
export const BOARD_TEMPLATES: readonly BoardTemplate[] = [
  {id: "tpl-home", name: "默认首页", description: "时钟、问候语、一级功能区与今日四件套。", items: homeStarterItems().map(it => ({spec: it.spec, cell: it.cell, rect: it.rect!, manual: it.manual}))},
  {
    id: "tpl-today",
    name: "今日速览",
    description: "课表与待办并排，下面接通知、下一节课和余额。",
    items: [
      tile({ kind: "custom", id: "classes" }, 0, 0, 540, 480),
      tile({ kind: "custom", id: "homework" }, 564, 0, 540, 480),
      tile({ kind: "custom", id: "notices" }, 0, 504, 540, 392),
      tile({ kind: "custom", id: "next-class" }, 564, 504, 540, 192),
      tile({ kind: "custom", id: "balance-strip" }, 564, 720, 540, 176),
    ],
  },
  {
    id: "tpl-learn",
    name: "学习为主",
    description: "全部作业、通知与课程文件，适合考试周盯着进度。",
    items: [
      tile({ kind: "custom", id: "learn-assignments" }, 0, 0, 540, 480),
      tile({ kind: "custom", id: "learn-notices" }, 564, 0, 540, 480),
      tile({ kind: "custom", id: "learn-files" }, 0, 504, 540, 440),
      tile({ kind: "custom", id: "classes" }, 564, 504, 540, 440),
    ],
  },
  {
    id: "tpl-min",
    name: "极简",
    description: "一个标题、一张课表、一条余额，先跑起来再慢慢加。",
    items: [
      tile({ kind: "text", text: "今天，从容一点。", variant: "title" }, 0, 0, 1104, 132),
      tile({ kind: "custom", id: "classes" }, 0, 156, 740, 480),
      tile({ kind: "custom", id: "balance-strip" }, 764, 156, 340, 176),
    ],
  },
];

export function templateById(id: string): BoardTemplate | null {
  return BOARD_TEMPLATES.find((t) => t.id === id) ?? null;
}

/** 每次生成独立条目；仅修复兼容 cell 的重叠，绝不改变作者给出的像素坐标。 */
export function templateItems(tpl: BoardTemplate, now = Date.now()): BoardItem[] {
  return ensureNoOverlap(tpl.items.map((it, i) => ({
    id: "it." + tpl.id + "." + String(i) + "." + now.toString(36),
    spec: structuredClone(it.spec),
    cell: { ...it.cell },
    rect: { ...it.rect },
    ...(it.manual === undefined ? {} : { manual: it.manual }),
  })));
}
