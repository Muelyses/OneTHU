#!/usr/bin/env node
/**
 * **旧键迁移守栏**（2026-10-15，oh-wire）：首页自由板键 → 系统板；画笔旧键 → 系统板笔键。
 * 两份都是"升级路径的一次性数据手术"，坏一次就是用户摆位/手写批注再也回不来，所以都要守。
 * （画笔那份是 board-rig 用真浏览器一次性取证过的，但一次性取证会随代码漂移失效——
 *   这里把它固化成守栏：真模块 + 真 localStorage + 严格对齐真 schema，不造桩 schema。）
 *
 * 为什么有这条：`onethu.freeboard.home.v1`（旧首页自由板）只读一次并进系统板，标志位
 * `onethu.freeboard.merged.v1`。这是一次性**数据手术**：跑错一次就是用户摆位错乱/卡片复活/长双份，
 * 而且没有第二次机会（迁移完标志位就落了）。所以这里只用**脏数据**打它（board-rig 点名要的）：
 *
 *   dup       旧键内同 spec 两份 + 与系统板同 spec + today.* 陈迹 + 收藏到首页的原子混放
 *             + 负坐标/小数/超宽/过矮 + folded/opacity 越界 + NaN/Infinity + 无 id/无 spec
 *   malformed 旧键是坏 JSON；v2 旧键版本不符 → 一条不并、原板不动、照样写标志位（不反复重试）
 *   defense   板里**已有 px 条目** → 整条防御：旧键一律不并
 *   idem      重复读不重复并；标志位丢失后重跑也不长双份（防御兜住）
 *   pen-migrate / pen-both / pen-none / pen-junk / pen-empty
 *             画笔 `onethu.board.pen.v1`：旧键 `free:home|default` → `board.today|portrait`
 *
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/board-legacy-merge-test.mjs
 *   （父进程按场景 spawn 自己；每个场景独立进程——freeBoard 的"只并一次"是模块级状态，
 *    同进程里跑不了第二个场景。）
 */
import "./board-test-env.mjs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCENARIO = process.argv[2] ?? "";

if (SCENARIO.startsWith("pen-")) {
  /* ── 子进程模式：画笔旧键迁移（boardPen 的 load() 跑在模块顶层，必须先种存储再 import） ── */
  const KEY = "onethu.board.pen.v1";
  const stroke = (id) => ({ id, color: "#f00", w: 2, pts: [10, 20, 30, 40] }); /* 真 schema：pts 扁平千分比点集 */
  const seed = (raw) => { if (raw === null) globalThis.localStorage.removeItem(KEY); else globalThis.localStorage.setItem(KEY, raw); };
  if (SCENARIO === "pen-migrate") seed(JSON.stringify({ v: 1, boards: { "free:home|default": [stroke("s1"), stroke("s2")] } }));
  if (SCENARIO === "pen-both") seed(JSON.stringify({ v: 1, boards: { "free:home|default": [stroke("old")], "board.today|portrait": [stroke("new")] } }));
  if (SCENARIO === "pen-none") seed(null);
  if (SCENARIO === "pen-junk") seed(JSON.stringify({ v: 1, boards: { "free:home|default": ["垃圾", { id: "坏点集", pts: [1] }], "board.today|portrait": [stroke("keep")] } }));
  if (SCENARIO === "pen-empty") seed(JSON.stringify({ v: 1, boards: { "free:home|default": [] } }));

  const pen = await import("../apps/desktop/src/state/boardPen.ts");
  const fails = [];
  const ok = (c, m) => { if (c) console.log("  ✓ " + m); else fails.push(m); };
  const stored = () => JSON.parse(globalThis.localStorage.getItem(KEY) ?? '{"v":1,"boards":{}}').boards;
  const keys = (o) => Object.keys(o).sort().join(",");
  const doc = pen.penSnapshot();
  console.log(`—— ${SCENARIO}：内存键 [${keys(doc.boards)}] / 存储键 [${keys(stored())}]`);

  if (SCENARIO === "pen-migrate") {
    ok(keys(doc.boards) === "board.today|portrait", "内存：旧键 → 系统板键");
    ok((doc.boards["board.today|portrait"] ?? []).length === 2, "两条笔画都搬过去（老用户的手写批注不能丢）");
    ok(keys(stored()) === "board.today|portrait", "**已落盘**（不是只在内存里搬）");
    ok(pen.strokesOf(pen.penKeyOf("board.today", "portrait")).length === 2, "按新键取得到（渲染路径同键）");
    ok(pen.strokesOf("free:home|default").length === 0, "旧键取不到东西了");
    ok(keys(stored()) === "board.today|portrait", "再读一次不复制不回落（幂等）");
  }
  if (SCENARIO === "pen-both") {
    ok(keys(doc.boards) === "board.today|portrait,free:home|default", "两边都有笔迹：旧键原样留着、不合并（覆盖新笔迹比留老笔迹更糟）");
    ok((doc.boards["board.today|portrait"] ?? []).length === 1, "新键不被覆盖");
    ok((doc.boards["free:home|default"] ?? []).length === 1, "旧键不被删（盘上留作审计/回退）");
  }
  if (SCENARIO === "pen-none") ok(keys(doc.boards) === "" && keys(stored()) === "", "没有旧键时不造键（新用户干净）");
  if (SCENARIO === "pen-junk") {
    ok(keys(doc.boards) === "board.today|portrait", "旧键里全是垃圾：sanitize 先挡住 → 不搬进新键、也不平白造键");
    ok((doc.boards["board.today|portrait"] ?? []).length === 1, "新键的笔迹保留");
  }
  if (SCENARIO === "pen-empty") {
    ok(keys(doc.boards) === "", "空旧键不触发迁移（sanitize 丢掉空数组，内存不留键）");
    ok(keys(stored()) === "free:home|default", "存储里的空旧键不清理（无害残留，不写盘）");
  }

  console.log(fails.length ? `✗ ${SCENARIO} ${fails.length} 项失败` : `✅ ${SCENARIO} 通过`);
  for (const f of fails) console.error("   ✗ " + f);
  process.exit(fails.length ? 1 : 0);
}

if (SCENARIO) {
  /* ── 子进程模式：跑一个场景 ── */
  const freeBoard = await import("../apps/desktop/src/state/freeBoard.ts");
  const { loadBoard, saveBoard } = await import("../apps/desktop/src/state/board.ts");
  const core = await import("../apps/desktop/src/state/boardCore.ts");
  const be = await import("../apps/desktop/src/state/boardEdit.ts");

  const fails = [];
  const ok = (c, m) => { if (c) console.log("  ✓ " + m); else fails.push(m); };
  const sys = core.systemBoard(loadBoard());
  const specDup = { kind: "custom", id: "balance-strip" };
  const existing = [
    { id: "today.homework", spec: { kind: "custom", id: "today.homework" }, cell: { x: 0, y: 0, w: 2, h: 1 } },
    { id: "it.seeded-balance", spec: specDup, cell: { x: 0, y: 1, w: 2, h: 1 }, folded: true },
    { id: "it.collected", spec: { kind: "atom-link", ref: "course:12345" }, cell: { x: 2, y: 1, w: 2, h: 1 } },
  ];
  if (SCENARIO === "defense") existing.push(core.pxBoardItem("it.px", { kind: "text", text: "已有 px" }, { x: 30, y: 40, w: 200, h: 100 }));
  saveBoard(be.replaceCells(loadBoard(), sys.id, "portrait", existing));

  const legacyItems = [
    { id: "free.balance", spec: specDup, x: 40, y: 60, w: 260, h: 140 },
    { id: "free.balance2", spec: specDup, x: -50, y: -9, w: 300, h: 160 },
    { id: "free.note", spec: { kind: "text", text: "手写便签" }, x: 12.7, y: 20.2, w: 99999, h: 8 },
    { id: "free.folded", spec: { kind: "text", text: "折叠+半透明" }, x: 100, y: 200, w: 240, h: 120, folded: true, opacity: 0.05 },
    { id: "free.ghost", spec: { kind: "text", text: "透明度过大" }, x: NaN, y: Infinity, w: null, h: undefined, opacity: 3 },
    { id: "free.nospec", x: 10, y: 10, w: 100, h: 100 },
    { id: "", spec: { kind: "text", text: "无 id" }, x: 1, y: 1, w: 10, h: 10 },
  ];
  globalThis.localStorage.setItem("onethu.freeboard.home.v1",
    SCENARIO === "malformed" ? "{不是 JSON" : JSON.stringify(SCENARIO === "v2" ? { v: 2, items: legacyItems } : { v: 1, items: legacyItems }));

  freeBoard.freeBoardSnapshot();   /* 第一次读 → 触发 migrateLegacyHomeOnce */
  const board = loadBoard().boards.find((b) => b.id === sys.id);
  const items = core.cellsOf(board, "portrait");
  const ids = items.map((i) => i.id);
  const rect = (id) => items.find((i) => i.id === id)?.rect;
  const flag = globalThis.localStorage.getItem("onethu.freeboard.merged.v1");
  console.log(`—— ${SCENARIO}：合并后 ${items.length} 条：${ids.join(", ")}`);

  const base = SCENARIO === "defense" ? 4 : 3;
  if (SCENARIO === "dup" || SCENARIO === "idem") {
    ok(ids.includes("free.balance") && ids.includes("free.balance2"), "旧键内同 spec 两份都保留（旧布局是事实来源，自由画布允许重复）");
    ok(!ids.includes("it.seeded-balance"), "系统板同 spec 的那份让位（不长双份）");
    ok(!ids.includes("today.homework"), "旧「今日」页网格陈迹被剔除（用户删掉的卡片不会复活）");
    ok(ids.includes("it.collected"), "旧键里没有的（收藏到首页的原子）原样留下");
    ok(ids.indexOf("free.balance") < ids.indexOf("it.collected"), "旧键条目排在前面（保留原图层序）");
    ok(flag === "1", "合并标志位已写（只并一次）");
    const b2 = rect("free.balance2");
    ok(!!b2 && b2.x >= 0 && b2.y >= 0, `负坐标夹到 ≥0（实得 ${b2?.x},${b2?.y}）`);
    const n = rect("free.note");
    ok(!!n && n.x === 13, `小数取整（12.7 → ${n?.x}）`);
    ok(!!n && n.h >= core.RECT_MIN_H, `过矮夹到下限（8 → ${n?.h}）`);
    const f = items.find((i) => i.id === "free.folded");
    ok(f?.folded === true, "folded 透传");
    ok(typeof f?.opacity === "number" && f.opacity >= 0.25, `透明度下限夹到 0.25（实得 ${f?.opacity}）`);
    const g = items.find((i) => i.id === "free.ghost");
    ok(!!g && Number.isFinite(g.rect.x) && g.rect.x >= 0, `NaN/Infinity 兜底成有限非负（实得 ${g?.rect?.x}）`);
    ok(g?.opacity === 1, `透明度上限夹到 1（实得 ${g?.opacity}）`);
    ok(!ids.includes("free.nospec"), "无 spec 的脏条目被丢弃");
    if (typeof core.RECT_MAX_W === "number") ok(!!n && n.w <= core.RECT_MAX_W, `超宽夹到上限 RECT_MAX_W=${core.RECT_MAX_W}（实得 ${n?.w}）`);
    else console.log("   ⚠ 参照：矩形无上限夹取（RECT_MAX_W 未定义）——w=99999 会渲染成占满屏的大件（脏数据路径）");
  }
  if (SCENARIO === "malformed" || SCENARIO === "v2") {
    ok(items.length === base, `坏数据/版本不符：一条不并、原板不动（${items.length} 条 = 原 ${base} 条）`);
    ok(flag === "1", "即便如此也写标志位（不每次启动重试解析）");
  }
  if (SCENARIO === "defense") {
    ok(items.length === base, `板里已有 px 条目：防御生效，旧键不并进来（${items.length} 条 = 原 ${base} 条）`);
    ok(!ids.includes("free.balance"), "旧键条目确实没被并进");
    ok(flag === "1", "防御路径也写标志位");
  }
  if (SCENARIO === "idem") {
    const first = items.length;
    freeBoard.freeBoardSnapshot();
    ok(core.cellsOf(loadBoard().boards.find((b) => b.id === sys.id), "portrait").length === first, `重复读不重复合并（${first} 条不变）`);
    globalThis.localStorage.removeItem("onethu.freeboard.merged.v1");
    freeBoard.migrateLegacyHomeOnce();
    ok(core.cellsOf(loadBoard().boards.find((b) => b.id === sys.id), "portrait").length === first, `标志位丢失后重跑也不长双份（${first} 条不变）`);
  }

  console.log(fails.length ? `✗ ${SCENARIO} ${fails.length} 项失败` : `✅ ${SCENARIO} 通过`);
  for (const f of fails) console.error("   ✗ " + f);
  process.exit(fails.length ? 1 : 0);
}

/* ── 父进程模式：逐场景 spawn 自己（模块级"只并一次"状态必须隔离） ── */
const self = fileURLToPath(import.meta.url);
const scenarios = ["dup", "malformed", "v2", "defense", "idem", "pen-migrate", "pen-both", "pen-none", "pen-junk", "pen-empty"];
let bad = 0;
for (const sc of scenarios) {
  try {
    const out = execFileSync(process.execPath, ["--import", "./tools/ts-resolve-register.mjs", self, sc], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    process.stdout.write(out.split("\n").filter((l) => l.trim() && !/UNDICI|trace-warnings/.test(l)).join("\n") + "\n");
  } catch (e) {
    bad += 1;
    process.stdout.write((e.stdout ?? "") + (e.stderr ?? ""));
    console.error(`✗ 场景 ${sc} 失败（exit ${e.status}）`);
  }
}
console.log(bad ? `\n✗ 旧键迁移守栏：${bad}/${scenarios.length} 个场景失败` : `\n✅ 旧键迁移守栏：${scenarios.length} 个场景全绿（首页自由板 5 + 画笔 5；脏数据口径）`);
process.exit(bad ? 1 : 0);
