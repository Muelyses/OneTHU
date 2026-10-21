#!/usr/bin/env node
/**
 * 白板深链守栏（2026-10-15，oh-wire）。
 *
 * 为什么有这条：白板接入④把 `case "board"` 的渲染面从 BoardPage 换成 OnePageSurface（FreeBoard），
 * 深链是**最容易被顺手带坏**的东西——页面 id 还是 `board`、hash 还是 `#/board/<板 id>`，
 * 但"恢复哪块板/标题取谁/hash 要不要改写"全靠 explorer 那条链。本守栏走**真函数**
 * `openTabFromBootHash`（App 启动时调它）与 `initExplorerHashBridge` 注册的 hashchange 回调
 * （浏览器前进/后退走它），不碰替身逻辑。
 *
 * 断言：① `#/board/<板 id>` → 活动标签是白板页 + 该板成为当前板 + 标题=板名 + hash 不被改写；
 *      ② `#/boards` → 「所有白板」列表页；
 *      ③ 未知板 id → 不抛异常、且**不许把当前板改坏**（静默切到别的板上是更坏的行为）；
 *      ④ hashchange（返回/前进）路径与冷启动同一结论；
 *      ⑤ 回归：`#/learn` 仍开课程页（别把普通页带坏）。
 *
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/board-deeplink-test.mjs
 */
import "./board-test-env.mjs";

const onePage = await import("../apps/desktop/src/state/onePage.ts");
const explorer = await import("../apps/desktop/src/state/explorer.ts");
const { loadBoard } = await import("../apps/desktop/src/state/board.ts");

const fails = [];
const ok = (c, m) => { if (c) console.log("  ✓ " + m); else fails.push(m); };
const activeTab = () => {
  const s = explorer.explorerSnapshot();
  return s.tabs.find((t) => t.id === s.activeId);
};

/* ① 冷启动 #/board/<板 id> */
const id = onePage.createOnePage("深链守栏板");
ok(!!id, `建板成功：${id}`);
globalThis.location.hash = `#/board/${id}`;
explorer.openTabFromBootHash();
ok(activeTab()?.page === "board", `深链后活动标签是白板页（实得 ${activeTab()?.page}）`);
ok(loadBoard().activeBoardId === id, "深链把该板设成当前板（画布渲染的就是它）");
ok(activeTab()?.title === "深链守栏板", `标签标题取板名（实得「${activeTab()?.title}」）`);
ok(globalThis.location.hash === `#/board/${id}`, `hash 保持不动（实得 ${globalThis.location.hash}）`);

/* ② #/boards */
globalThis.location.hash = "#/boards";
explorer.openTabFromBootHash();
ok(explorer.explorerSnapshot().tabs.some((t) => t.page === "boards"), "「所有白板」列表页可深链打开");

/* ③ 未知板 id：不抛、且当前板不许被改坏 */
const before = loadBoard().activeBoardId;
let threw = "";
try {
  globalThis.location.hash = "#/board/board.不存在";
  explorer.openTabFromBootHash();
} catch (e) { threw = String(e?.message ?? e); }
ok(threw === "", `未知板 id 深链不抛异常（${threw.slice(0, 40) || "无异常"}）`);
ok(loadBoard().activeBoardId === before, `未知板 id 不改当前板（仍是 ${before}）`);

/* ④ hashchange（浏览器返回/前进）与冷启动同一结论 */
const off = explorer.initExplorerHashBridge();
globalThis.location.hash = `#/board/${id}`;
globalThis.dispatchEvent({ type: "hashchange", newURL: `file:///app/tabs#/board/${id}` });
ok(explorer.explorerSnapshot().tabs.some((t) => t.page === "board"), "hashchange 路径也能打开白板（前进/后退可用）");
off();

/* ⑤ 回归：普通页没被带坏 */
globalThis.location.hash = "#/learn";
explorer.openTabFromBootHash();
ok(activeTab()?.page === "learn", "普通页深链没被带坏（#/learn → 课程页）");

console.log(fails.length ? `\n✗ 白板深链守栏 ${fails.length} 项失败` : "\n✅ 白板深链守栏全绿");
for (const f of fails) console.error("   ✗ " + f);
process.exit(fails.length ? 1 : 0);
