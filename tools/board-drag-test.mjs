#!/usr/bin/env node
/**
 * 白板拖拽几何（P1 纯逻辑）护栏。方案：docs/atom 收藏 §6.2 / §6.5。
 *
 * 盯住四件事：
 *   ① 指针 → 目标格：边界处夹回列内（不许把组件拖出画布右边）；
 *   ② 预览：被压到的向下推、**不许有重叠**、且**不改动原文档**（预览与落库分离）；
 *   ③ 位移判据：超过阈值才算拖拽（这是「长按先出菜单、位移才升级」的判据）；
 *   ④ 预览与真实落库用同一套推让规则（同一函数）。
 *
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/board-drag-test.mjs ｜ 0 通过 / 1 违规
 */
import { readFileSync } from "node:fs";

const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };

const cssSrc = readFileSync("apps/desktop/src/styles/global.css", "utf8");
const B = await import("../apps/desktop/src/state/boardCore.ts");
const pageR = readFileSync("apps/desktop/src/pages/BoardPage.tsx", "utf8");
const D = await import("../apps/desktop/src/state/boardDrag.ts");
const R = await import("../apps/desktop/src/state/boardReflow.ts");
const E = await import("../apps/desktop/src/state/boardEdit.ts");

const item = (id, x, y, w, h) => ({ id, spec: { kind: "custom", id }, cell: { x, y, w, h } });
const docOf = (items) => ({
  v: 1, order: {}, activeBoardId: "b1",
  boards: [{ id: "b1", name: "板", icon: "today", kind: "system", cells: { portrait: items } }],
});

/* ① 指针 → 目标格（画布 400x400、4 列、10 行 → 列宽 100、行高 40） */
const rect = { left: 0, top: 0, width: 400, rowHeight: 40 };
ok(JSON.stringify(D.cellFromPoint(0, 0, rect, { w: 1, h: 1 })) === JSON.stringify({ x: 0, y: 0 }), "左上角应落在 (0,0)");
ok(JSON.stringify(D.cellFromPoint(150, 90, rect, { w: 1, h: 1 })) === JSON.stringify({ x: 2, y: 2 }), "换算列/行不对（150/100→2，90/40→2）");
ok(D.cellFromPoint(9999, 0, rect, { w: 2, h: 1 }).x === 2, "右越界没有夹回（宽 2 时最大 x=2）");
ok(D.cellFromPoint(-50, -50, rect, { w: 1, h: 1 }).x === 0 && D.cellFromPoint(-50, -50, rect, { w: 1, h: 1 }).y === 0, "左/上越界没有夹到 0");
ok(D.cellFromPoint(0, 0, { left: 0, top: 0, width: 0, rowHeight: 0 }, { w: 1, h: 1 }).x === 0, "零尺寸画布不应产生 NaN/负值");

/* ② 预览：向下推、无重叠、且不改原文档 */
const items = [item("a", 0, 0, 2, 1), item("b", 2, 0, 2, 1)];
const before = JSON.stringify(items);
const preview = D.previewItems(items, "a", { x: 2, y: 0 });
ok(JSON.stringify(items) === before, "预览不该改动传入的条目（应为不可变）");
/* 口径于 2026-10-11 反转：让位改为「区间整体平移你移动的那几行」，不再推到被移项下方。 */
ok(!D.previewHasOverlap(preview), "预览出现重叠（兜底让位没生效）");
ok(preview.find((x) => x.id === "a").cell.x === 2, "预览没有落在目标格");
ok(preview.find((x) => x.id === "b").cell.y === 1, "被压到的邻居没有让位（被拖项应停在目标格，对方下移一格）");
ok(preview.find((x) => x.id === "a").cell.y === 0, "被拖项没有停在指针指定的格上");
ok(D.previewItems(items, "nope", { x: 0, y: 0 }).length === items.length, "预览不存在的条目应原样返回");
const doc = docOf(items);
const pdoc = D.previewDoc(doc, "b1", "portrait", preview);
ok(doc.boards[0].cells.portrait[0].cell.x === 0, "预览文档不该改动原文档");
ok(pdoc.boards[0].cells.portrait.find((x) => x.id === "a").cell.x === 2, "预览文档没有写入预览结果");

/* ③ 位移判据 */
ok(D.movedBeyond({ x: 0, y: 0 }, { x: 20, y: 0 }, 8) === true, "超过阈值应判为位移");
ok(D.movedBeyond({ x: 0, y: 0 }, { x: 4, y: 4 }, 8) === false, "阈值内不该判为位移（避免误升级为拖拽）");

/* ④ 预览与落库同一套推让规则（源码层：都从 collectable 引入 pushDown） */
const src = readFileSync("apps/desktop/src/state/boardDrag.ts", "utf8");
ok(/import \{[^}]*pushDown[^}]*\} from "\.\/collectable\.js"/.test(src), "预览没有复用落库那套 pushDown（两套规则会不一致）");

/* ⑤ 拖拽接线（页面是 .tsx → 静态判定）：长按先出菜单、位移才升级、拖拽期预览、松手落库并回正常态 */
const page = readFileSync("apps/desktop/src/pages/BoardPage.tsx", "utf8");
ok(/LONG_PRESS_MS = 500/.test(page), "长按阈值与仓库口径不一致");
ok(/openItemMenu\(item, e\.clientX, e\.clientY\)/.test(page) && /setTimeout/.test(page), "长按没有先弹菜单");
ok(/movedBeyond\(/.test(page) && /setDragNow\(\{ id: press\.id, started: true/.test(page), "位移后没有升级为拖拽");
ok(/menu\.close\(\)/.test(page), "升级为拖拽时没有收回长按菜单");
ok(/previewItems\(stored, drag\.id, drag\.cell/.test(page), "拖拽期没有用预览渲染（会每帧落盘）");
/* 口径于 2026-10-11 反转：行高统一为 88px 后，**位移模型**是精确的，
   而命中检测对大组件会「一下蹦好几行」（抓在靠下位置时左上角离手指几百像素）。 */
ok(/stickyIndex\(\(py \+ sTop - fz\.pressContentY\)/.test(page) && /fz\.rowPitch/.test(page), "拖拽没有按手指位移的整格数换算目标格（会蹦行）");
ok(!/cellFromSlots\(/.test(page), "页面又在用命中检测算目标格（大组件会蹦）");
ok(/apply\(moveItem\(doc, boardId, orientation, dd\.id, cell/.test(page), "松手没有落库（位置会丢）");
/* 口径于 2026-10-11 反转：拖拽只可能在编辑态发起，松手后**留在编辑态**（霖澄清）。 */
ok(/\u2026|drop id=/.test(page) && !/\(!d\.fromEditing\) setEditing\(false\);/.test(page), "松手后去留的旧口径还在（会把用户从编辑态踢出去）");
ok(/if \(item\.pinned && !editing\) return/.test(page), "固定的组件在**正常模式**下仍能长按（固定语义失效）；编辑模式里应仍可长按");
ok(/onPointerCancel|addEventListener\("pointercancel"/.test(page), "缺少指针取消处理（来电/手势打断后会卡在拖拽态）");

ok(/setPointerCapture/.test(page), "长按没有做指针捕获——菜单浮层会吃掉后续 move 事件，位移永远升级不了拖拽");
ok(!/setTimeout\(\(\) => \{\s*pressRef\.current = null/.test(page), "长按定时器里清掉了按压信息——菜单弹出后位移就无法升级为拖拽");
ok(/const setDragNow = /.test(page), "拖拽状态没有 eager setter——ref 依赖渲染期赋值会读到旧值（实测第一次拖拽完全不落库）");
ok(!/\n  dragRef\.current = drag;/.test(page), "仍在渲染期同步 dragRef（应改为变更那一刻直接写 ref）");
ok(/touch-action: none/.test(readFileSync("apps/desktop/src/styles/global.css", "utf8")), "编辑态可拖拽项没有 touch-action: none——垂直拖动会被浏览器当滚动接管（实测：整页滑动、组件不动）");
ok(/onWinCancel/.test(page), "缺少「取消即放弃」的处理（浏览器接管滚动时不该落库）");
/* ⑤b 边缘自动滚动（霖 2026-10-10 口径：速度与靠近边缘的程度相关） */
ok(D.edgeScrollSpeed(500, 0, 1000, 72, 14) === 0, "画面中部不该滚动");
ok(D.edgeScrollSpeed(20, 0, 1000, 72, 14) < 0, "靠近上边缘应向上滚（负速度）");
ok(D.edgeScrollSpeed(980, 0, 1000, 72, 14) > 0, "靠近下边缘应向下滚（正速度）");
ok(Math.abs(D.edgeScrollSpeed(40, 0, 1000, 72, 14)) > Math.abs(D.edgeScrollSpeed(65, 0, 1000, 72, 14)), "上边缘速度没有随靠近程度增大（越靠边应越快；断言必须是严格大于，否则恒定速度也能蒙过）");
ok(Math.abs(D.edgeScrollSpeed(960, 0, 1000, 72, 14)) > Math.abs(D.edgeScrollSpeed(935, 0, 1000, 72, 14)), "下边缘速度没有随靠近程度增大（严格大于）");
ok(Math.abs(D.edgeScrollSpeed(5, 0, 1000, 72, 14)) <= 14, "边缘速度没有封顶");
ok(D.edgeScrollSpeed(-50, 0, 1000, 72, 14) === -14 && D.edgeScrollSpeed(1200, 0, 1000, 72, 14) === 14, "拖出视口外应保持封顶速度（否则拖到屏幕外就停了）");
const page2 = readFileSync("apps/desktop/src/pages/BoardPage.tsx", "utf8");
ok(/requestAnimationFrame/.test(page2) && /tickScroll/.test(page2), "边缘滚动没有用 rAF 循环（滚动会断断续续）");
/* 边缘带于 2026-10-11 由 72 加深到 96：底部 72px 与系统手势条重叠，手指贴底会被系统吞掉。 */
ok(/const EDGE_ZONE = 96/.test(page) && /const EDGE_MAX = 14/.test(page), "边缘带宽度或速度上限没有按口径设置");
ok(/cancelAnimationFrame/.test(page2), "拖拽结束没有停掉 rAF（会一直滚下去）");
ok(/scrollParent/.test(page2), "边缘滚动没有找到真正的滚动容器（滚错元素等于不滚）");
/* ⑪ 霖 2026-10-10 的四条现场 bug 的防回归 */
ok(/\(e\.pointerType === "mouse"\) return;/.test(page) && !/\(!editing \|\| e\.pointerType/.test(page), "正常模式下长按被整体禁用（需求原文要求正常模式长按可触发快捷编辑）");
ok(/press\.armed/.test(page), "升级为拖拽没有要求「已由长按武装」（编辑态会一按就拖）");
ok(page.indexOf("if (!editing || !press.armed) { cancelPress(); return; }") >= 0, "升级没有限定「编辑态 + 长按武装」双条件（正常模式会改布局）");
ok(/transform: lifted && drag\.raw \? "translate\("/.test(page), "被拖项没有按手指位移平移（会只在跨格时跳一下）");
ok(!/style\.touchAction/.test(page), "在手势进行中改 touch-action——浏览器会取消该指针，拖拽当场被丢弃（实测过）");
/* 口径于 2026-10-11 反转：槽位改成 pan-y（拖组件也要能翻页），
   拦截改用「长按武装后才 preventDefault」的非被动 touchmove（霖：落点在组件上滑不动）。 */
ok(/\.board-canvas \.board-slot \{ touch-action: pan-y/.test(readFileSync("apps/desktop/src/styles/global.css", "utf8")), "槽位没允许纵向滚动（拖组件翻页会失效）");
ok(/pr && pr\.armed/.test(page) && /stopNativeScroll/.test(page), "touchmove 拦截没有限定在「长按武装后」（会把翻页一并挡死）");
/* 预览必须保持数组顺序（否则 React 重排会移动 DOM 节点，触摸的隐式指针捕获随之被取消） */
const order = [item("a", 0, 0, 2, 1), item("b", 2, 0, 2, 1), item("c", 0, 1, 2, 1)];
const pv = D.previewItems(order, "a", { x: 2, y: 1 });
ok(pv.map((x) => x.id).join(",") === "a,b,c", "预览改变了数组顺序（会让被拖的 DOM 节点被移动 → 浏览器取消指针）");
ok(pv.find((x) => x.id === "a").cell.x === 2 && pv.find((x) => x.id === "a").cell.y === 1, "预览没有把被拖项放到目标格");
/* ⑰ 临界滚动：判据必须取滚动容器范围（霖 2026-10-11：拖到边缘不滚） */
ok(/scrollParent\(gridRef\.current\)/.test(page) && /getBoundingClientRect\(\)\.bottom/.test(page), "临界滚动没有按滚动容器的可见范围判定（用 window 会与执行不同源）");
ok(!/edgeScrollSpeed\([^)]*window\.innerHeight/.test(page), "临界滚动仍在用 window.innerHeight 作判据（白板是内部容器在滚）");
/* ⑲ 落点换算必须把被拖项算进去（只排除它作为障碍，不排除它作为当前位置） */
const gA = { left: 0, width: 400 };
const mk = (id, x, y, w, h, top, height) => ({ id, x, y, w, h, left: 0, top, width: 100, height });
const slotsA = [mk("above", 0, 0, 4, 2, 0, 200), mk("me", 0, 2, 4, 3, 200, 300), mk("below", 0, 5, 4, 2, 500, 200)];
const hit = D.cellFromSlots(200, 300, slotsA, gA, 4, { w: 4, h: 3 }, "me");
ok(hit.y === 3, "指针落在被拖项自己身上时没有按它自身换算（实际 y=" + hit.y + "，应为 3；跳到下面那个槽位就是「松手向下跳一大截」）");
const hit2 = D.cellFromSlots(200, 520, slotsA, gA, 4, { w: 4, h: 3 }, "me");
ok(hit2.y === 5, "指针落在下方槽位时没有取该槽位的 y（实际 " + hit2.y + "）");
/* ⑳ 落点虚影 */
ok(/board-ghost/.test(page), "缺少落点虚影节点（拖拽时看不到松手会落在哪）");
ok(/ghostRef/.test(page) && /style\.gridRow/.test(page), "虚影位置没有在拖拽中直接更新（会跟着 React 渲染抖动）");
ok(/\.board-ghost[^}]*border: 2px dashed/.test(readFileSync("apps/desktop/src/styles/global.css", "utf8")), "虚影没有虚线描边");
ok(/\.board-ghost[^}]*pointer-events: none/.test(readFileSync("apps/desktop/src/styles/global.css", "utf8")), "虚影会拦截指针（拖拽会被它挡住）");
/* ㉑ 虚影尺寸必须按落库同一口径夹取（否则「虚影明显高于组件」） */
ok(/const gsz = normalizeSize\(gdef/.test(page) && /normalizeSize\(gdef, \{ w: cur2\.cell\.w, h: cur2\.cell\.h \}\)/.test(page), "虚影尺寸没有走与落库相同的 normalizeSize（挡位组件会预览出档位外的尺寸）");
ok(/String\(gsz\.w\)/.test(page) && /String\(gsz\.h\)/.test(page), "虚影跨度没有用夹取后的尺寸");
/* ㉒ 让位必须按「移动的那几行」平移，而不是把邻居推到被移项下方（霖 2026-10-11：大组件挪一格邻居被弹开 8 行） */
const tall = [item("tall", 0, 4, 4, 8), item("up1", 0, 0, 4, 2), item("up2", 0, 2, 4, 2), item("down1", 0, 12, 4, 1)];
const r1 = R.reflowForMove(tall, "tall", { x: 0, y: 3 });
ok(r1.find((x) => x.id === "tall").cell.y === 3, "被移项没有落在目标格");
ok(r1.find((x) => x.id === "down1").cell.y === 12, "落点下方的条目被波及了（大组件让位不该动下方）");
const r0 = R.reflowForMove(tall, "tall", { x: 0, y: 4 });
ok(r0.map((x) => x.cell.y).join(",") === tall.map((x) => x.cell.y).join(","), "拾起瞬间（位移 0）就有条目被移动了——这正是「拿起来就挤开一大块」的来源");
const overlapsAny = (arr) => arr.some((a, i) => arr.some((b, j) => i !== j && D.overlaps ? D.overlaps(a.cell, b.cell) : false));
ok(!overlapsAny(r1), "平移后出现重叠");
/* 落库与预览必须一致（同一个函数） */
const docM = E.moveItem(docOf(tall), "b1", "portrait", "tall", { x: 0, y: 3 });
const cellsM = docM.boards[0].cells.portrait.map((c) => c.id + "@" + c.cell.x + "," + c.cell.y).sort().join("|");
const prevM = r1.map((c) => c.id + "@" + c.cell.x + "," + c.cell.y).sort().join("|");
ok(cellsM === prevM, "落库与预览不一致：\n  落库 " + cellsM + "\n  预览 " + prevM);
/* ㉓ 重叠兜底与"可增可减的拟合"（霖 2026-10-11：放手后叠在一起 / 校园卡预览占五行） */
const messy = [item("a", 0, 0, 4, 4), item("b", 0, 2, 4, 4), item("c", 0, 6, 4, 4)];
const fixed = R.ensureNoOverlap(messy);
ok(!fixed.some((x, i) => fixed.some((y, j) => i !== j && x.cell.x < y.cell.x + y.cell.w && y.cell.x < x.cell.x + x.cell.w && x.cell.y < y.cell.y + y.cell.h && y.cell.y < x.cell.y + x.cell.h)), "ensureNoOverlap 没有拆开重叠");
ok(fixed.find((x) => x.id === "a").cell.y === 0, "ensureNoOverlap 把最上面的项也移动了");
ok(R.ensureNoOverlap(messy)[0].cell.y === 0 && messy[1].cell.y === 2, "ensureNoOverlap 不该改动入参（应为不可变）");
ok(/ensureNoOverlap\(nowC\)/.test(page), "加载时没有做重叠修复（历史重叠会一直留着）");
ok(/可增可减/.test(page) && !/if \(rows > it\.cell\.h\) next =/.test(page), "拟合仍然只会加高（内容变短后留着空白行）");
ok(/const hasBody = \!\!renderers\[cardRendererKey/.test(page), "拟合没有排除「无卡体」的项（降级壳的高度是假的）");
/* ㉔ 吸附去抖：半格处不许翻（霖 2026-10-11 现场抽搐的真因） */
ok(D.stickyIndex(0.5, 0) === 0, "停在半格处就换格了（±几像素抖动会导致来回翻 → 抽搐）");
ok(D.stickyIndex(0.45, 0) === 0 && D.stickyIndex(0.55, 0) === 0, "半格附近的小抖动仍会换格");
ok(D.stickyIndex(-0.5, 0) === 0 && D.stickyIndex(-0.55, 0) === 0, "向上方向的半格处仍会换格");
ok(D.stickyIndex(0.7, 0) === 1 && D.stickyIndex(-0.7, 0) === -1, "越过死区后没有换格（会拖不动）");
ok(D.stickyIndex(0.45, 1) === 1 && D.stickyIndex(0.62, 1) === 1 && D.stickyIndex(0.75, 1) === 1, "从 1 往回退时也应当要求越过死区");
ok(/stickyIndex\(/.test(page) && /stickyRows\.current = dRows/.test(page), "页面没有使用吸附去抖");
ok(/stickyRows\.current = 0/.test(page), "拖拽开始时没有重置吸附锚点");
/* ㉕ 兜底让位在「上方无空间」时必须改让下方（霖 2026-10-11：三个组件叠在一起） */
const tight = [item("classes", 0, 0, 4, 5), item("notices", 0, 1, 4, 5)];
const noOv = (arr) => !arr.some((x, i) => arr.some((y, j) => i !== j && x.cell.x < y.cell.x + y.cell.w && y.cell.x < x.cell.x + x.cell.w && x.cell.y < y.cell.y + y.cell.h && y.cell.y < x.cell.y + x.cell.h));
ok(noOv(R.ensureNoOverlap(tight)), "ensureNoOverlap 没能拆开「上方已满」的重叠（夹到 0 后仍重叠）");
const moved2 = R.reflowForMove(tight, "notices", { x: 0, y: 1 });
ok(noOv(moved2), "reflowForMove 在上方无空间时留下了重叠（被拖项要停在目标格，对方应改往下方让）");
ok(moved2.find((x) => x.id === "notices").cell.y === 1, "被拖项没有停在目标格");
ok(moved2.find((x) => x.id === "classes").cell.y >= 6, "对方没有改往下方让（实际 " + moved2.find((x) => x.id === "classes").cell.y + "）");
/* 写入口不变量 */
ok(/const safe = ensureNoOverlap\(cells\)/.test(page), "唯一写入口 apply 没有跑重叠不变量");
/* ㉖ 把手命中区必须完全落在槽位内部（霖 2026-10-11：拖左边动右边、拖上边动下边） */
ok(!/\.board-handle\.h-[nsew] \{[^}]*(^|[; ])(top|bottom|left|right): -[0-9]+px/.test(cssSrc), "把手命中区跨出了槽位（四边定位出现负值 → 与相邻槽位的把手重叠）");
ok(/\.board-handle\.h-n \{[^}]*top: 0/.test(cssSrc) && /\.board-handle\.h-s \{[^}]*bottom: 0/.test(cssSrc), "上下把手没有贴齐槽位内侧边缘");
ok(/\.board-handle\.h-e \{[^}]*right: 0/.test(cssSrc) && /\.board-handle\.h-w \{[^}]*left: 0/.test(cssSrc), "左右把手没有贴齐槽位内侧边缘");
/* ㉗ 「跟手」分支只能用于移动：缩放吃原格会导致「拖左边动右边」 */
ok(/const followFinger = lifted && !!drag\?\.raw/.test(page), "跟手分支没有限定在移动（缩放预览会丢 x）");
ok(/followFinger \? \(stored\.find/.test(page), "槽位摆放没有用 followFinger 判定（缩放会按原格摆放）");
ok(/previewResize/.test(readFileSync("apps/desktop/src/state/boardReflow.ts", "utf8")), "缩放预览没有与落库共用同一套夹取");
/* ㉘ 拖拽观感（霖 2026-10-11）：手拿的半透明 + 让位走侧栏同款弹簧 */
ok(/is-dragging \.board-slot\.is-lifted \{[^}]*opacity: 0\.6/.test(cssSrc), "被拖项不半透明（看不清它盖住的内容）");
ok(/is-lifted \{[^}]*transition: none/.test(cssSrc), "被拖项有过渡（会不跟手，侧栏内核的第一条坑）");
ok(/is-dragging \.board-slot:not\(\.is-lifted\) \{[^}]*transition: transform var\(--dur-2\) var\(--ease-spring\)/.test(cssSrc), "让位没有用侧栏同款弹簧过渡（位移会变瞬移）");
ok(!/is-dragging \.board-slot:not\(\.is-lifted\) \{[^}]*transition: opacity[^,}]/.test(cssSrc), "让位的过渡只写了 opacity（把 transform 的弹簧过渡吃掉了——侧栏注释里点名过的坑）");
/* ㉛ 列数按宽窄屏（霖 2026-10-11：为安卓平板适配；不是按平台） */
ok(B.colsForWidth(400) === 4 && B.colsForWidth(1200) === 8 && B.colsForWidth(840) === 8, "colsForWidth 断点不对（840 起应为 8 列）");
ok(B.BOARD_COLS === 4 && B.BOARD_COLS_WIDE === 8, "列数常量不对（窄 4 / 宽 8）");
const cssWide = readFileSync("apps/desktop/src/styles/global.css", "utf8");
ok(/repeat\(var\(--board-cols, 4\)/.test(cssWide), "画布列数没有走 --board-cols 变量");
ok(/@media \(min-width: 840px\) \{[^}]*--board-cols: 8/.test(cssWide), "宽屏没有切到 8 列（平板适配落空）");
ok(/colsForWidth/.test(pageR) && /const \[cols, setCols\]/.test(pageR), "白板页没有按视口宽度维护列数");
ok(!/\/ 4;/.test(pageR) || !/gr\.width \/ 4/.test(pageR), "页面里还有写死的 4 列换算");
/* ㉝ 全局监听必须「同名同 capture」地移除：写错会永久泄漏，接管全应用的指针事件
   （霖 2026-10-11：其他页面按钮点不动、下拉触发不了，根因就是这里三次移除写法不匹配）。 */
const adds = [...page.matchAll(/addEventListener\("(\w+)", (\w+)(, true)?\)/g)].map((m) => m[2] + "|" + String(!!m[3]));
const removes = [...page.matchAll(/removeEventListener\("(\w+)", (\w+)(, true)?\)/g)].map((m) => m[2] + "|" + String(!!m[3]));
const leak = adds.filter((a) => !removes.includes(a));
ok(leak.length === 0, "有全局监听注册了却没按同样 capture 移除（会泄漏并接管全应用事件）：" + leak.join(", "));
if (fails.length) {
  console.error("白板拖拽护栏（P1）：不通过");
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("白板拖拽护栏（P1）：指针换格（含边界夹取与零尺寸保护）✓ ｜ 预览推让无重叠且不改原文档 ✓ ｜ 位移判据 ✓ ｜ 预览复用落库的推让规则 ✓");
