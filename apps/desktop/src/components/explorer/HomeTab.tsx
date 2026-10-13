/**
 * 首页（2026-10-13 二次定稿）：**自由图层白板**。
 *
 * - 固定层（HomeChrome）：居中大时间 + 一级功能区 + 更多功能/详细功能，
 *   不可移动、不可删除、可调不透明度；
 * - 自由层（FreeBoard）：组件可互相重叠盖住、常态直接拖动/缩放（无编辑模式）、
 *   选中浮条删除/置顶、右键与「＋」添加、双击空白建便笺；
 * - 画笔恒在最高图层（组件盖不住），RGB 色板随时取色 + 撤销/清空。
 */
import { useEffect, type ReactNode } from "react";
import { FreeBoard } from "../FreeBoard.js";
import { HomeChrome } from "./HomeSpheres.js";
import { activeBoard, cellsOf, loadBoard } from "../../state/board.js";
import { seedFromLegacyOnce } from "../../state/freeBoard.js";

/** 首次进入自由白板：把旧网格系统板的内容搬进来一次（之后各管各的，互不同步） */
function useSeedFromLegacy(): void {
  useEffect(() => {
    const doc = loadBoard();
    const b = activeBoard(doc);
    if (!b) return;
    const items = cellsOf(b, "portrait").map((it) => ({ id: it.id, spec: it.spec }));
    seedFromLegacyOnce(items);
  }, []);
}

export function HomeTab(): ReactNode {
  useSeedFromLegacy();
  return (
    <div className="home-tab home-free">
      <HomeChrome />
      <FreeBoard />
    </div>
  );
}
