/** Home is the persisted system canvas, including clock, greeting and primary services. */
import { type ReactNode } from "react";
import { FreeBoard } from "../FreeBoard.js";
import { HOME_BOARD_ID, HOME_ORIENTATION } from "../../state/freeBoard.js";
import { HomeCoachMarks } from "../HomeCoachMarks.js";

export function HomeTab(): ReactNode {
  return (
    <div className="home-tab home-free">
      {/* 首次进入的首页导览标记（原先只挂在旧「今日页」上；白板接管首页后它一度整个丢了，
          2026-10-15 随旧页删除一并搬回新首页 —— onboarding-v3 守栏要的就是它在这里） */}
      <HomeCoachMarks />
      {/* 显式传系统板：首页是**一块**画布（不分朝向），与 OnePage 的按板读写成对称的两半 */}
      <FreeBoard boardId={HOME_BOARD_ID} orientation={HOME_ORIENTATION} />
    </div>
  );
}
