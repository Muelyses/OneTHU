/**
 * 首页（2026-10-13 二次定稿）：**自由图层白板**。
 *
 * - 固定层（HomeChrome）：居中大时间 + 一级功能区 + 更多功能/详细功能，
 *   不可移动、不可删除、可调不透明度；
 * - 自由层（FreeBoard）：组件可互相重叠盖住、常态直接拖动/缩放（无编辑模式）、
 *   选中浮条删除/置顶、右键与「＋」添加、双击空白建便笺；
 * - 画笔恒在最高图层（组件盖不住），RGB 色板随时取色 + 撤销/清空。
 *
 * 2026-10-15：首页画布 = **系统板**（board.today）的自由层——画布与 OnePage 从此走
 * 同一份数据（BoardDoc）与同一个组件（FreeBoard 参数化）。旧键
 * onethu.freeboard.home.v1 的摆位由 px 层一次性并进系统板（state/freeBoard.ts 的
 * migrateLegacyHomeOnce），这里不再有 seeding 这一步。
 */
import { type ReactNode } from "react";
import { FreeBoard } from "../FreeBoard.js";
import { HOME_BOARD_ID, HOME_ORIENTATION } from "../../state/freeBoard.js";
import { HomeChrome } from "./HomeSpheres.js";
import { HomeCoachMarks } from "../HomeCoachMarks.js";

export function HomeTab(): ReactNode {
  return (
    <div className="home-tab home-free">
      {/* Workbench 页头与服务区在文档流中；自由层从其后起，原有世界坐标不变 */}
      <HomeChrome />
      {/* 首次进入的首页导览标记（原先只挂在旧「今日页」上；白板接管首页后它一度整个丢了，
          2026-10-15 随旧页删除一并搬回新首页 —— onboarding-v3 守栏要的就是它在这里） */}
      <HomeCoachMarks />
      {/* 显式传系统板：首页是**一块**画布（不分朝向），与 OnePage 的按板读写成对称的两半 */}
      <FreeBoard boardId={HOME_BOARD_ID} orientation={HOME_ORIENTATION} />
    </div>
  );
}
