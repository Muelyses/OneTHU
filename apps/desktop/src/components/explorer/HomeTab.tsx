/**
 * 首页标签页（2026-10-13 定稿）：**整个首页就是一块白板**。
 *
 * - 固定层（HomeChrome）：居中大时间 + 时间下的一级功能区 + 「更多功能」「详细功能」。
 *   不可移动、不可删除，可调不透明度（调低透出下面的组件）。
 * - 自由层：BoardPage 以无头模式嵌入（chromeless）——活跃 OnePage 的画布，
 *   时间/日期/天气/卡片/便笺/画笔全部是自由白板组件，右下「编」进编辑态拖摆。
 *
 * 旧的「继续上次」条与 TodayPage 直渲染随本次定稿退役（工作区恢复在 OneGO/标签抽屉里）。
 */
import type { ReactNode } from "react";
import { BoardPage } from "../../pages/BoardPage.js";
import { HomeChrome } from "./HomeSpheres.js";

export function HomeTab(): ReactNode {
  return (
    <div className="home-tab home-free">
      {/* 固定层：大时间 + 功能区（浮在画布上方，透明度可调；z 序在自由组件之上，
          但时钟区不拦截指针事件之外的部分——组件放上去即被点中） */}
      <HomeChrome />
      {/* 自由层：活跃 OnePage 的白板画布（无头模式，右下浮动钮进编辑） */}
      <div className="home-free-canvas">
        <BoardPage chromeless />
      </div>
    </div>
  );
}
