#!/usr/bin/env node
/** 实际状态模块回归：显式恢复默认首页不触碰其他板，也不让旧自由板再合并回来。 */
import "./board-test-env.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const board = await import("../apps/desktop/src/state/board.ts");
const core = await import("../apps/desktop/src/state/boardCore.ts");
const views = await import("../apps/desktop/src/state/boardView.ts");
const { ensureNoOverlap } = await import("../apps/desktop/src/state/boardReflow.ts");
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks += 1; };
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks += 1; };

localStorage.clear();
views.resetViewCache();
const custom = core.pxBoardItem("my-note", { kind: "text", text: "我的自定义布局", variant: "body" },
  { x: 137, y: 253, w: 319, h: 183 }, { folded: true, opacity: 0.75 });
const saved = {
  v: 1, homeLayoutVersion: 2, activeBoardId: "my-onepage",
  order: { mode: "manual", edited: true, order: ["classes", "homework"] },
  boards: [
    { id: core.SYSTEM_BOARD_ID, kind: "system", name: "首页", icon: "home", cells: {
      portrait: [structuredClone(custom)], landscape: [{ ...structuredClone(custom), id: "wide-note" }],
    } },
    { id: "my-onepage", kind: "user", name: "保留的研究板", icon: "fist", cells: {
      portrait: [{ ...structuredClone(custom), id: "onepage-note" }],
      landscape: [{ ...structuredClone(custom), id: "onepage-wide", rect: { x: 1901, y: 1317, w: 723, h: 276 } }],
    } },
  ],
};
board.saveBoard(saved);
const before = board.loadBoard();
eq(board.loadBoard(), before, "正常读取已有v2布局不自动重排或换模板");
const legacyKeys = ["onethu.home.layout", "onethu.home.layout.portrait", "onethu.home.layout.landscape", "onethu.home.defaults"];
for (const key of legacyKeys) localStorage.setItem(key, "[]");
const oldFreeBoard = JSON.stringify({ v: 1, items: [
  { id: "legacy-only", spec: { kind: "text", text: "不得复活的旧便笺" }, x: 77, y: 88, w: 220, h: 160 },
] });
localStorage.setItem("onethu.freeboard.home.v1", oldFreeBoard);
for (const orientation of ["portrait", "landscape"]) {
  views.setView(views.boardViewKey(core.SYSTEM_BOARD_ID, orientation), { z: 5 });
  views.setView(views.boardViewKey(core.SYSTEM_BOARD_ID, orientation) + "|phone", { z: 3 });
}
const otherViewKey = views.boardViewKey("my-onepage", "portrait");
views.setView(otherViewKey, { z: 2.5 });
let changed = 0;
let reset = 0;
addEventListener("onethu.boards.changed", () => changed++);
addEventListener(board.HOME_BOARD_RESET_EVENT, () => reset++);

board.resetHomeBoard();
const after = board.loadBoard();
const home = core.systemBoard(after);
const expected = JSON.parse(JSON.stringify(ensureNoOverlap(core.homeStarterItems())));
eq(home.cells.portrait, expected, "真实首页portrait恢复默认组件/尺寸/位置，而非只清旧layout键");
eq(home.cells.landscape, expected, "横屏首页同时恢复默认");
eq(after.boards.find(b => b.kind === "user"), before.boards.find(b => b.kind === "user"), "其他OnePage及自由位置、折叠、透明度保持原样");
eq(after.activeBoardId, before.activeBoardId, "不改变当前OnePage选择");
eq(after.order, before.order, "不改变排序偏好");
eq(after.homeLayoutVersion, 2, "保持当前迁移版本，不会再次注入首页头部");
eq(legacyKeys.map(key => localStorage.getItem(key)), [null, null, null, null], "清理旧布局与折叠偏好");
eq(localStorage.getItem("onethu.freeboard.home.v1"), oldFreeBoard, "保留历史自由板数据作为回退资料");
eq(localStorage.getItem("onethu.freeboard.merged.v1"), "1", "重置后标记旧自由板已处理，防延迟迁移回灌");
eq({ changed, reset }, { changed: 1, reset: 1 }, "通知数据刷新并单独通知显式视图复位");
for (const orientation of ["portrait", "landscape"]) {
  const key = views.boardViewKey(core.SYSTEM_BOARD_ID, orientation);
  eq(views.viewOf(key).z, 1, `${orientation}的首页倍率归100%`);
  eq(views.viewOf(key + "|phone").z, 1, `${orientation}的手机自由画布倍率归100%`);
}
eq(views.viewOf(otherViewKey).z, 2.5, "其他OnePage的缩放保持原值");

// 第一次打开首页发生在设置重置之后：驱动真迁移与真快照，旧便笺不能复活。
const free = await import("../apps/desktop/src/state/freeBoard.ts");
eq(free.freeBoardSnapshot().items.map(it => it.id), expected.map(it => it.id), "首次打开首页不回灌历史自由板");
check(!free.migrateLegacyHomeOnce(), "显式恢复默认后旧迁移为幂等no-op");
const homePortrait = home.cells.portrait;
homePortrait[0].rect.x = 999;
homePortrait[0].spec.kind = "divider";
eq(home.cells.landscape, expected, "两个朝向的组件不共享可变对象");

let observed = 0;
const unsubscribe = free.subscribeFreeBoard(() => observed++);
const note = free.freeBoardOps().add({ kind: "text", text: "后来加的内容" }, 200, 200, 300, 180);
check(free.freeBoardSnapshot().items.some(it => it.id === note), "重置后仍能正常添加自由组件");
board.resetHomeBoard();
check(observed > 0, "已挂载的白板订阅者能收到重置");
eq(free.freeBoardSnapshot().items.map(it => it.id), expected.map(it => it.id), "重置使已缓存快照立即失效");
unsubscribe();

const settings = readFileSync("apps/desktop/src/pages/Settings.tsx", "utf8");
const canvas = readFileSync("apps/desktop/src/components/FreeBoard.tsx", "utf8");
check(/onClick=\{\(\) => \{ resetHomeBoard\(\); setHomeResetAt/.test(settings), "设置按钮调用真实首页重置");
check(/addEventListener\(HOME_BOARD_RESET_EVENT, resetLayoutView\)/.test(canvas) && /if \(boardId !== HOME_BOARD_ID\) return/.test(canvas),
  "已挂载的系统首页单独重设参考宽度，不监听普通存档重排用户画布");
console.log(`board reset: ${checks} checks passed`);
