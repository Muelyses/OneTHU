/**
 * 白板页（P1）：只读渲染 + 编辑模式（含长按拖拽与实时预览）。
 *
 * 方案：docs/原子收藏-可行性与实现方案.md §6。
 * 已实现：右上「···」的「编辑」入口、编辑态点阵与组件略缩、编辑态点击弹组件菜单（删除标红/编辑/详情/固定）、
 * 文字属性抽屉、**长按先出菜单 → 位移升级为拖拽**、拖拽期实时预览让位、松手落库并**自动回正常态**。
 * 尚未实现：四边把手缩放（几何与夹取已备好）、其它组件的模糊渐出强度的逐帧调优。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Card, Empty, PageHead } from "../components/Layout.js";
import { WidgetHost, type WidgetRenderer } from "../components/WidgetHost.js";
import { TILE_GAP, TILE_H, activeBoard, cellsOf, loadBoard, saveBoard, systemBoard, type BoardDoc, type BoardItem, type Orientation } from "../state/board.js";
import { ensureNoOverlap } from "../state/boardReflow.js";
import { cardRendererKey } from "../state/liveCards.js";
import { addItemTo, cellFromResize, moveItem, placeItem, removeItem, repackBoard, repackItems, replaceCells, setItemProps, togglePin, type ResizeHandle } from "../state/boardEdit.js";
import { BOARD_TEMPLATES, templateItems } from "../state/boardTemplates.js";
import { cellFromSlots, edgeScrollSpeed, movedBeyond, previewItems, stickyIndex, type SlotRect } from "../state/boardDrag.js";
import { BOARD_COLS, colsForWidth } from "../state/boardCore.js";
import { BoardAddDrawer } from "../components/BoardAddDrawer.js";
import { atomRefFromKey } from "../state/favorites.js";
import { resolveAtom } from "../state/atoms.js";
import { BoardPenLayer, BoardPenToolbar } from "../components/BoardPenLayer.js";
import { PEN_COLORS, penKeyOf, strokesOf, undoStroke, clearStrokes } from "../state/boardPen.js";
import { useApp } from "../state/context.js";
import { defForSpec, isTierControlled, normalizeSize, widgetById, type WidgetDef } from "../state/widgetMeta.js";
import { allWidgetDefs, isListWidget } from "../state/widgets.js";
import { planForItem } from "../state/widgetRender.js";
import { cardRenderers, subscribeTodayCards } from "../state/todayCards.js";
import { liveRenderers, subscribeLiveCards } from "../state/liveCards.js";
import { BOARD_CARD_RENDERERS } from "../components/boardCards.js";
import { BoardItemPicker, type PickerItem } from "../components/BoardItemPicker.js";
import { useLearnData } from "../state/data.js";
import { ATOM_TEMPLATE_IDS } from "../state/widgets.js";
import { consumeEditOnOpen } from "../state/boardIntent.js";
import { useContextMenu, type CtxItem } from "../components/ContextMenu.js";
import { useIsPhone, useSheetSnap } from "../state/phoneSheets.js";
import { PhoneSheetGrip, useSheetDrag } from "../components/explorer/PhoneSheet.js";

/** 拖拽埋点：logcat 里按 BOARD-DRAG 过滤（松手竞态排查用，稳定后可降级为调试开关）。 */
const trace = (line: string): void => {
  console.log("BOARD-DRAG " + line);
};

/** 长按阈值与滚动取消距离：与仓库既有口径一致。 */
/** 诊断开关：localStorage["onethu.debug.drag"] = "1" 时打拖拽内部量。 */
function dragDebug(): boolean {
  try {
    return localStorage.getItem("onethu.debug.drag") === "1";
  } catch {
    return false;
  }
}

const LONG_PRESS_MS = 500;
const MOVE_CANCEL_PX = 8;

export function BoardPage({ chromeless = false }: { chromeless?: boolean } = {}): ReactNode {
  const { navigate } = useApp();
  const menu = useContextMenu();
  /* A6（手机档）：OnePage = seeking 底部抽屉——半屏起、可拉满（同抽屉手柄）。
     hooks 全部无条件声明（hook-order 门禁），首屏无头嵌嵌（chromeless）不走抽屉分流。 */
  const phoneUi = useIsPhone();
  const mobSnap = useSheetSnap("onepage");
  const onepageRef = useRef<HTMLDivElement | null>(null);
  const onepageSheet = useSheetDrag(onepageRef, { id: "onepage" });
  const defs = useMemo(() => allWidgetDefs(), []);
  const [doc, setDoc] = useState<BoardDoc>(() => loadBoard());
  const [editing, setEditing] = useState(false);
  /* 画笔（勾勒划线）：开 = 画布上的 SVG 层接管指针；颜色/撤销/清空在画布右上小浮条 */
  const [penOn, setPenOn] = useState(false);
  const [penColor, setPenColor] = useState<string>(PEN_COLORS[0]);
  /* 编辑态选中的组件：只有它显示缩放把手（霖 2026-10-10 定）。 */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /* 从今日页「编辑白板布局」进来时直接进编辑态（消费一次即清）。 */
  useEffect(() => {
    if (consumeEditOnOpen()) setEditing(true);
  }, []);
  /* OneGO / 星标 / 收藏星在别处改了板文档（onethu.boards.changed）→ 重读。
     没有这条时，OneGO 里新建 OnePage 再打开，板页还停在旧文档。 */
  useEffect(() => {
    const on = (): void => setDoc(loadBoard());
    window.addEventListener("onethu.boards.changed", on);
    return () => window.removeEventListener("onethu.boards.changed", on);
  }, []);
  /* 两份来源合并：今日页的注册表 + 其它页面发布的卡体（我的页数字卡等）。 */
  /* 合并顺序：**白板侧自足实现优先**（活数据、任何页面可渲染），其次是自足卡体，
     最后才是来源页发布的快照（离开来源页后不再刷新）。 */
  const mergeRenderers = (): Record<string, WidgetRenderer> => ({
    ...BOARD_CARD_RENDERERS,
    ...cardRenderers(),
    ...liveRenderers(),
  });
  const [renderers, setRenderers] = useState<Record<string, WidgetRenderer>>(() => mergeRenderers());
  const [drawer, setDrawer] = useState<BoardItem | null>(null);
  /** 模板组件：正在选择"显示哪一条具体项"（霖 2026-10-11 定）。 */
  const [pickerItem, setPickerItem] = useState<BoardItem | null>(null);
  const learn = useLearnData();
  const pickerItems: PickerItem[] = useMemo(() => {
    if (!pickerItem || pickerItem.spec.kind !== "custom") return [];
    const data = learn.data;
    if (pickerItem.spec.id === "learn-file") {
      const byCourse = new Map((data?.courses ?? []).map((c) => [c.id, c.name]));
      return [...(data?.files ?? [])]
        .sort((a, b) => String(b.uploadTime).localeCompare(String(a.uploadTime)))
        .map((f) => ({
          key: f.courseId + ":" + f.id,
          label: f.title || "课件 " + f.id,
          sub: (byCourse.get(f.courseId) ?? "") + " · " + String(f.uploadTime).slice(0, 10),
          props: { courseId: f.courseId, itemId: f.id, title: f.title },
        }));
    }
    return [];
  }, [pickerItem, learn.data]);
  const [addOpen, setAddOpen] = useState(false);
  /** 「改变大小」复用的对象：非空时抽屉切到 resize 模式，自动选中它当前档位。 */
  const [sizeItem, setSizeItem] = useState<BoardItem | null>(null);
  const [tplOpen, setTplOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState<string | null>(null);
  /** raw 是被拖项相对按下点的像素位移（跟手用）；fromEditing 记住拖拽从哪个模式发起（决定松手后回哪）。 */
  const [drag, setDrag] = useState<{ id: string; started: boolean; cell: { x: number; y: number; w?: number; h?: number }; raw?: { dx: number; dy: number }; fromEditing?: boolean } | null>(null);
  const [portrait] = useState<boolean>(() =>
    typeof window !== "undefined" ? window.matchMedia("(orientation: portrait)").matches : true,
  );
  const orientation: Orientation = portrait ? "portrait" : "landscape";
  /* 列数按**视口宽度**（霖 2026-10-11：为安卓平板适配；不是按平台）：窄屏 4 列、宽屏 8 列，
     断点与 boardCore.colsForWidth 一致（840px）。基准单位不变，所以同一份文档手机占满 4 格、平板占满 8 格。 */
  const [cols, setCols] = useState<number>(() => colsForWidth(typeof window !== "undefined" ? window.innerWidth : 0));
  useEffect(() => {
    const onResize = (): void => setCols(colsForWidth(window.innerWidth));
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);
  const gridRef = useRef<HTMLDivElement | null>(null);
  /** armed：长按成立后置真，之后手指移动才允许升级为拖拽（编辑态限定）。 */
  const pressRef = useRef<{ id: string; x: number; y: number; timer: number | null; armed?: boolean } | null>(null);
  /* 窗口级监听器需要读到最新的拖拽状态，state 在闭包里会过期，故用 ref 镜像。 */
  const dragRef = useRef<{ id: string; started: boolean; cell: { x: number; y: number; w?: number; h?: number }; raw?: { dx: number; dy: number }; fromEditing?: boolean } | null>(null);
  const storedRef = useRef<BoardItem[]>([]);
  /** 抓取偏移：手指按住组件内的哪个点，拖动时保持该点在手下方（与安卓桌面一致）。 */
  const grabRef = useRef<{ dx: number; dy: number } | null>(null);
  /** 冻结几何（按下那一刻的槽位矩形与行/列步距，内容坐标）：落点计算与让位 transform 脱钩 */
  /** 落点虚影节点（拖拽期间直接改它的 grid 位置，不触发渲染） */
  const ghostRef = useRef<HTMLDivElement | null>(null);
  /** 本次拖拽当前吸附的格位移（去抖用，跨移动保持）。 */
  const stickyRows = useRef(0);
  const stickyCols = useRef(0);
  const frozenRef = useRef<{ slots: (SlotRect & { id: string })[]; grid: { left: number; width: number }; colPitch: number; rowPitch: number; pressContentX: number; pressContentY: number } | null>(null);
  /** 拖拽过程中最后一次算出的目标格（只在内存里，不触发渲染；松手才写文档） */
  const liveCellRef = useRef<{ x: number; y: number; w?: number; h?: number } | null>(null);
  /** 拖拽起手点（屏幕坐标）：跟手位移与取消判据都用它。 */
  const dragOrigin = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const sync = (): void => setRenderers(mergeRenderers());
    const off1 = subscribeTodayCards(sync);
    const off2 = subscribeLiveCards(sync);
    return () => { off1(); off2(); };
  }, []);

  /* 渲染**当前板**（activeBoardId），不是写死系统板——收藏夹列表里选中的就是它。 */
  const board = activeBoard(doc);
  const boardId = board ? board.id : "";
  const penKey = penKeyOf(boardId, orientation);
  const penStrokes = strokesOf(penKey);
  const stored = board ? cellsOf(board, orientation) : [];

  /* 拖拽期渲染的是**预览**而不是文档：中途不落盘，松手才写。 */
  /* 只同步 stored（它是只读镜像）；drag 必须**在变更那一刻**写 ref，
     不能依赖渲染期赋值——实测：升级那一帧的 state 还没刷进渲染就松手，ref 仍是 null，
     结果第一次拖拽完全不落库（logcat 里 up drag=none）。 */
  storedRef.current = stored;
  const setDragNow = (next: { id: string; started: boolean; cell: { x: number; y: number; w?: number; h?: number }; raw?: { dx: number; dy: number }; fromEditing?: boolean } | null): void => {
    dragRef.current = next;
    setDrag(next);
  };

  const items = drag && drag.started ? previewItems(stored, drag.id, drag.cell, defs, cols) : stored;

  /**
   * **唯一写入口**：任何落库都必须无重叠。
   *
   * 这是一条**不变量**，不该由每个操作各自保证（霖 2026-10-11：重叠反复出现，逐个操作堵永远有漏）。
   * 放在这里意味着：无论哪个操作漏了让位，写进去的文档都不会重叠。
   */
  const apply = (next: BoardDoc): void => {
    const b = activeBoard(next);
    const cells = b ? cellsOf(b, orientation) : [];
    const safe = ensureNoOverlap(cells);
    const changed = safe.some((it, i) => !!cells[i] && it.cell.y !== cells[i]?.cell.y);
    const out = changed ? replaceCells(next, boardId, orientation, safe) : next;
    setDoc(out);
    saveBoard(out);
  };

  /* 桌面键盘标配（2026-10-13 鼠标修复同批）：编辑态方向键整格微调、Delete 删除、Esc 取消选中 */
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement | null)?.isContentEditable) return;
      if (e.key === "Escape") {
        setSelectedId(null);
        return;
      }
      if (!selectedId) return;
      const it = storedRef.current.find((x) => x.id === selectedId);
      if (!it) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        apply(removeItem(doc, boardId, orientation, selectedId));
        setSelectedId(null);
        return;
      }
      const delta: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
      };
      const d = delta[e.key];
      if (!d) return;
      e.preventDefault();
      /* Shift = 大步 5 格（tldraw GRID_INCREMENT×5 同款）；普通 = 1 格 */
      const step = e.shiftKey ? 5 : 1;
      const nx = Math.min(Math.max(0, it.cell.x + d[0] * step), Math.max(0, cols - it.cell.w));
      const ny = Math.max(0, it.cell.y + d[1] * step);
      if (nx === it.cell.x && ny === it.cell.y) return;
      apply(moveItem(doc, boardId, orientation, selectedId, { x: nx, y: ny }, cols));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, selectedId, doc, boardId, orientation, cols, apply]);

  const say = (text: string): void => {
    setNote(text);
    window.setTimeout(() => setNote(null), 1800);
  };

  const onOpen = (item: BoardItem): void => {
    if (item.spec.kind === "nav") {
      navigate(item.spec.page as never, item.spec.params as never);
      return;
    }
    /* atom-link（OnePage 收进来的原子入口）：键 → 原子视图 → 原位跳转 */
    if (item.spec.kind === "atom-link") {
      const ref = atomRefFromKey(item.spec.ref);
      if (!ref) return;
      const view = resolveAtom(ref);
      if (!view) {
        say("这条入口已失效，长按可移除");
        return;
      }
      view.open(navigate);
    }
  };

  /** 本次会话已拟合过的条目：避免反复测量-写入造成循环。 */
  const fittedRef = useRef<Set<string>>(new Set());
  const didArrangeRef = useRef(false);
  /** 上次整理时已发布的卡体数量：数量变了说明卡体刚到位，值得再整理一次。 */
  const arrangedStampRef = useRef(-1);
  /*
   * 首次进入白板（**非编辑态**）做一次版面整理：把内容高于格子的项按实测撑到刚好放下，再按列重排。
   *
   * 为什么必须只在非编辑态、且只做一次：这个副作用原来挂在 doc 上，于是**用户每拖一次都会重排一次**——
   * 组件被往下推、高度被改，表现就是「抽搐 / 错位 / 飞到最下面 / 手上的组件消失」（霖 2026-10-11 现场）。
   * 编辑期间绝不改写文档；一次会话只整理一次；整理的板取当前板（原来写死 systemBoard，用户板上会改错板）。
   */
  useEffect(() => {
    if (editing) return;
    /* 允许「卡体发布后再补一次」：首次整理时若卡体还没发布（显示降级壳、内容很短），
       拟合会把高度停在 1，与真实内容不符（霖 2026-10-11：列表组件看不出高度）。 */
    const stamp = Object.keys(renderers).length;
    if (didArrangeRef.current && stamp === arrangedStampRef.current) return;
    const el = gridRef.current;
    if (!el) return;
    didArrangeRef.current = true;
    if (arrangedStampRef.current !== stamp) {
      /* 卡体刚到位：清掉"已拟合"标记，让每项**重新量一次**。
         否则首次测量发生在降级壳阶段（高度是假的）后，就再也不会修正了
         ——霖 2026-10-11：校园卡视觉一行、预留却占三到五行。 */
      fittedRef.current.clear();
    }
    arrangedStampRef.current = stamp;
    const gs = getComputedStyle(el);
    const tile = parseFloat(gs.gridAutoRows) || TILE_H;
    const gap = parseFloat(gs.rowGap) || TILE_GAP;
    let next: BoardDoc | null = null;
    /* 先修重叠：文档里若已有重叠（历史遗留或某次落库异常），这里自动拆开。
       这是**不变量守卫**，不是排版偏好——霖 2026-10-11 现场就是放手后两个组件叠在一起。 */
    const nowB = activeBoard(doc);
    const nowC = nowB ? cellsOf(nowB, orientation) : [];
    const repaired = ensureNoOverlap(nowC);
    if (repaired.some((it, i) => !!nowC[i] && (repaired[i]?.cell.y ?? 0) !== nowC[i]?.cell.y)) {
      next = replaceCells(doc, boardId, orientation, repaired);
    }
    for (const node of Array.from(el.querySelectorAll(".board-slot"))) {
      const id = node.getAttribute("data-item-id") || "";
      if (!id || fittedRef.current.has(id)) continue;
      const it = storedRef.current.find((x) => x.id === id);
      if (!it) continue;
      fittedRef.current.add(id);
      /* 只对**已发布卡体**的项拟合：没有卡体时显示的是降级壳，量出来的高度是假的。 */
      const hasBody = !!renderers[cardRendererKey(it.spec.kind === "custom" ? it.spec.id : "")];
      if (!hasBody) continue;
      /* 用户手动设过尺寸的项**不参与拟合**：否则他在编辑态调好的高度，一退出就被改回去
         （霖 2026-10-11：正常模式复刻不了编辑模式的布局）。 */
      if (it.manual) continue;
      /* 挡位控制的组件「档位就是唯一尺寸」（霖 2026-10-11 定稿）：不参与按内容撑高的拟合，
         内容该在哪个档位放下多少，由该档位的专门排版负责，而不是由内容反推尺寸。 */
      if (isTierControlled(defForSpec(it.spec, defs))) continue;
      /* 量**内容**而不是槽位：槽位高度就是 h 行，它的 scrollHeight 不会小于自身，
         于是"缩不下去"（实测：校园卡内容 68px，槽位 280px，量槽位永远得到 3 行）。 */
      const inner = (node as HTMLElement).firstElementChild as HTMLElement | null;
      /* 量**内容**而不是量到的盒子：卡片外壳是"填充型"（高度 = 槽位高度），
         用 getBoundingClientRect 永远得到"刚好装得下"，于是卡片再空也缩不回去。
         改用 scrollHeight —— 填充盒的 scrollHeight 仍是内容的真实高度
         （霖 2026-10-11：入口型组件放上去只有一行内容，却撑五六行空白）。 */
      const need = (inner ? inner.scrollHeight : (node as HTMLElement).scrollHeight) + gap;
      const have = (node as HTMLElement).clientHeight;
      /* **可增可减**：曾经只在"装不下"时加高，导致内容变短后仍留着几行空白
         （霖 2026-10-11：校园卡视觉一行、预览却占五行）。 */
      const rows = Math.max(1, Math.min(8, Math.ceil((need + gap) / (tile + gap))));
      if (rows === it.cell.h) continue;
      /* 增与减都落库：placeItem 只在变高时才会推别人，变矮时自然留白由下一步重排收掉。 */
      next = placeItem(next ?? doc, boardId, orientation, id, { ...it.cell, h: rows }, defs, undefined, cols);
    }
    /* 拟合会把装不下的项往下推、留下大片空行；旧数据也可能本来就带空行。
       因此重排**不挂在拟合条件上**：只要当前排列有空行就重排一次（重排幂等，排好后再跑不写入）。 */
    const base = next ?? doc;
    const nowBoard = activeBoard(base);
    const nowCells = nowBoard ? cellsOf(nowBoard, orientation) : [];
    const packed = repackItems(nowCells);
    const hasGap = packed.some((it, i) => !!nowCells[i] && it.cell.y !== nowCells[i].cell.y);
    if (next || hasGap) apply(repackBoard(base, boardId, orientation));
  }, [doc, editing, boardId, orientation, defs, apply, renderers]);


  const openItemMenu = useCallback((item: BoardItem, x: number, y: number): void => {
    const plan = planForItem(item, defs);
    const def = defForSpec(item.spec, defs);
    /* 正常模式**不允许改变布局**（霖 2026-10-11 口径）：删除/改大小只在编辑态出现。
       尺寸入口收进菜单，选了才显示把手——不再"点一下组件就出把手"。 */
    const list: CtxItem[] = [];
    /* 模板组件（课程文件条目等）：选择显示哪一条具体项（霖 2026-10-11 定）。 */
    if (item.spec.kind === "custom" && ATOM_TEMPLATE_IDS.includes("custom:" + item.spec.id)) {
      const picked = !!item.spec.props && Object.keys(item.spec.props).length > 0;
      list.push({ key: "pick", label: picked ? "更换条目" : "选择条目", onSelect: () => setPickerItem(item) });
    }
    if (editing) {
      /* 尺寸入口分两路（霖 2026-10-11 定稿）：
         · 挡位控制：复用「添加组件」抽屉，自动选中当前档位，底部按钮是「修改大小」；
         · 自由控制（分割线 / 标题 / 入口按钮 / 列表）：沿用四边把手。 */
      const tierControlled = isTierControlled(def);
      list.push({
        key: "resize",
        label: tierControlled ? "改变大小" : "自由调整大小",
        onSelect: () => {
          if (tierControlled) {
            setSelectedId(null);
            setSizeItem(item);
          } else {
            setSelectedId(item.id);
          }
        },
      });
      list.push({ key: "remove", label: "删除", danger: true, onSelect: () => apply(removeItem(doc, boardId, orientation, item.id)) });
    }
    if (def && def.editableProps && def.editableProps.length) {
      list.push({ key: "edit", label: "编辑", onSelect: () => { setDrawer(item); setDraft(item.spec.kind === "text" ? item.spec.text : ""); } });
    }
    list.push({ key: "info", label: "详情", onSelect: () => say(def ? def.description : "这个组件已经不在组件目录里了。") });
    list.push({ key: "pin", label: item.pinned ? "取消固定" : "固定", onSelect: () => apply(togglePin(doc, boardId, orientation, item.id)) });
    menu.open({ x, y, title: plan.title, items: list });
  }, [doc, boardId, orientation, defs, menu, say, apply]);

  /** 按 id 取当前格（窗口监听器里用它作为拖拽起点）。 */
  const findCell = (id: string): { x: number; y: number } => {
    const it = storedRef.current.find((x) => x.id === id);
    return it ? { x: it.cell.x, y: it.cell.y } : { x: 0, y: 0 };
  };

  const cancelPress = (): void => {
    const p = pressRef.current;
    if (p && p.timer !== null) window.clearTimeout(p.timer);
    pressRef.current = null;
  };

  const saveDrawer = (): void => {
    if (!drawer) return;
    apply(setItemProps(doc, boardId, orientation, drawer.id, { text: draft }));
    setDrawer(null);
  };

  /** 「改变大小」的目标（目录 id + 当前档位）：抽屉据此自动展开到该组件并选中当前档位。 */
  const sizeTarget = ((): { defId: string; size: { w: number; h: number } } | null => {
    if (!sizeItem) return null;
    const d = defForSpec(sizeItem.spec, defs);
    if (!d) return null;
    return { defId: d.id, size: planForItem(sizeItem, defs).size };
  })();

  const body: ReactNode = (
    <>
      {/* 无头模式（首页嵌入）：不渲染页头，编辑/添加/画笔走右下浮动钮（首页有自己的固定层，不再叠一层页头） */}
      {chromeless ? (
        <div className="board-fab-col" role="toolbar" aria-label="白板操作">
          {editing ? (
            <>
              <button type="button" className="board-fab" title="添加组件" onClick={() => setAddOpen(true)}>＋</button>
              <button type="button" className="board-fab" title="套用模板" onClick={() => setTplOpen(true)}>模</button>
              <button type="button" className={"board-fab" + (penOn ? " is-on" : "")} title={penOn ? "画笔：关" : "画笔：开"} onClick={() => setPenOn((v) => !v)}>笔</button>
            </>
          ) : null}
          <button
            type="button"
            className={"board-fab is-primary" + (editing ? " is-on" : "")}
            title={editing ? "完成编辑" : "编辑白板"}
            aria-pressed={editing}
            onClick={() => { setEditing((v) => !v); setSelectedId(null); }}
          >
            {editing ? "完" : "编"}
          </button>
        </div>
      ) : (
        <PageHead
          title="白板"
          meta={editing ? "编辑中：长按组件出菜单，移动手指即可换位置" : "OnePage 的画布：这里的每个组件都能单独摆放，位置随文档走"}
          menu={[
            { key: "add-widget", label: "添加组件", onSelect: () => setAddOpen(true) },
            { key: "apply-tpl", label: "套用模板", onSelect: () => setTplOpen(true) },
            { key: "pen", label: penOn ? "画笔：关" : "画笔：开", onSelect: () => setPenOn((v) => !v) },
            { key: "all-boards", label: "所有 OnePage", onSelect: () => navigate("boards") },
            { key: "edit-board", label: editing ? "完成" : "编辑", onSelect: () => setEditing((v) => !v) },
          ]}
        />
      )}
      {stored.length === 0 ? (
        <Card>
          <Empty text="这块白板还是空的。可以从模板开始，或收藏一个组件。" />
          {/* 空板引导：三套预制排版，点一下就有东西可看（方案 §5.3）。 */}
          <div className="board-tpl-row">
            {BOARD_TEMPLATES.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                className="btn"
                data-template={tpl.id}
                onClick={() => {
                  apply(replaceCells(doc, boardId, orientation, templateItems(tpl)));
                  setEditing(true);
                  say("已套用模板：" + tpl.name);
                }}
              >
                {tpl.name}
              </button>
            ))}
          </div>
        </Card>
      ) : (
        <div
          ref={gridRef}
          className={"board-canvas" + (editing ? " is-editing" : "") + (drag && drag.started ? " is-dragging" : "")}
          /* 点画布空白处 = 取消选中（把手随之收起）。 */
          onClick={() => setSelectedId(null)}
          data-board={boardId}
          data-editing={editing ? "1" : "0"}
          data-dragging={drag && drag.started ? "1" : "0"}
        >
          {/* 落点虚影：拖拽时显示「松手后会落在哪」，虚线描边（霖 2026-10-11）。
              位置由 paintDrag 直接写 gridColumn/gridRow——拖拽期间不做 React 渲染。 */}
          {/* 落点虚影：**常驻**节点（拖拽第一帧就要能拿到 ref），显隐与位置由 paintDrag 直接写。 */}
          <div ref={ghostRef} className="board-ghost" aria-hidden="true" />
          {/* 画笔层：penOn 时接管指针画线，平时只渲染已有笔迹（不碰组件交互） */}
          <BoardPenLayer boardId={boardId} orientation={orientation} penOn={penOn} color={penColor} />
          {penOn ? (
            <BoardPenToolbar
              color={penColor}
              onColor={setPenColor}
              canUndo={penStrokes.length > 0}
              onUndo={() => undoStroke(penKey)}
              onClear={() => clearStrokes(penKey)}
            />
          ) : null}
          {items.map((item) => {
            const plan = planForItem(item, defs);
            const lifted = !!drag && drag.started && drag.id === item.id;
            /** 只有「移动」才有跟手位移；缩放没有，所以要吃预览格。 */
            const followFinger = lifted && !!drag?.raw;
            const wid = widgetById(item.spec.kind === "custom" ? "custom:" + item.spec.id : "", defs)?.id ?? "";
            /** 该条目的大小控制方式：只有自由控制才显示四边把手。 */
            const itemDef = defForSpec(item.spec, defs);
            const freeResize = !isTierControlled(itemDef);
            /* 档位吸附后的尺寸可能比文档里存的更宽（如旧的 h=1 rail 卡吸附到 2 宽），
               x 必须一起夹回列内，否则会画出画布右边去。 */
            const posCell = followFinger ? (stored.find((s) => s.id === item.id)?.cell ?? item.cell) : item.cell;
            const spanW = Math.min(plan.size.w, cols);
            const posX = Math.min(posCell.x, Math.max(0, cols - spanW));
            return (
              <div
                key={item.id}
                className={"board-slot" + (item.pinned ? " is-pinned" : "") + (lifted ? " is-lifted" : "")}
                data-item={item.spec.kind}
                data-item-id={item.id}
                data-widget={wid}
                /* 按尺寸排版的选择器钩子：组件可按 data-size（如 "2x2"）给不同档位写专门排版。 */
                data-size={plan.size.w + "x" + plan.size.h}
                data-size-control={freeResize ? "free" : "tiers"}
                style={{
                  /* 被拖的那张按**原格**摆放并叠加手指位移（跟手），其余项才按吸附结果让位——
                     否则它会只在跨格时跳一下，看起来"不跟手"。 */
                  /* 「按原格摆放 + 手指位移」只适用于**移动**（drag.raw 存在时）。
                     缩放没有跟手位移，必须用**预览格**——否则宽度来自预览、x/y 却来自原格，
                     表现就是「拖左边动右边」（霖 2026-10-11 现场）。 */
                  gridColumn: String(posX + 1) + " / span " + String(spanW),
                  gridRow: String(posCell.y + 1) + " / span " + String(plan.size.h),
                  transform: lifted && drag.raw ? "translate(" + drag.raw.dx + "px, " + drag.raw.dy + "px)" : undefined,
                }}
                onClick={(e) => {
                  if (!editing || (drag && drag.started)) return;
                  e.stopPropagation();
                  openItemMenu(item, e.clientX, e.clientY);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  openItemMenu(item, e.clientX, e.clientY);
                }}
                onPointerDown={(e) => {
                  /* 诊断：槽位被按下（若坐标本应命中把手却打到这里，就是命中问题）。 */
                  trace("slot-down id=" + item.id + " x=" + Math.round(e.clientX) + " y=" + Math.round(e.clientY) + " 目标=" + String((e.target as HTMLElement | null)?.className ?? "?"));
                  /* 正常模式的长按也要出快捷编辑菜单（需求原文：正常模式下长按一个组件可触发快捷编辑）；
                     固定只挡正常模式，编辑模式里仍可长按（需求原文）。 */
                  /* 鼠标（2026-10-13 桌面修复）：编辑态**按下即武装**（不等长按、不弹菜单），
                     位移超阈值直接升级拖拽；原地抬起 = 打开组件菜单（与点击语义一致）。
                     此前鼠标被整体排除（PR 55 纯触屏思路），桌面端没有任何移动手段。 */
                  if (e.pointerType === "mouse") {
                    if (!editing) return;
                    cancelPress();
                    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 窗口级监听兜底 */ }
                    pressRef.current = { id: item.id, x: e.clientX, y: e.clientY, timer: null, armed: true };
                    const boxM = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    grabRef.current = { dx: e.clientX - boxM.left, dy: e.clientY - boxM.top };
                    const onMUp = (): void => {
                      window.removeEventListener("pointerup", onMUp, true);
                      window.removeEventListener("pointercancel", onMCancel, true);
                      pressRef.current = null;
                      /* 菜单不在这里开：捕获释放后 click 事件仍落在槽位上，
                         槽位 onClick（编辑态且未拖拽）本来就开菜单——开两次会闪一下 */
                    };
                    const onMCancel = (): void => {
                      window.removeEventListener("pointerup", onMUp, true);
                      window.removeEventListener("pointercancel", onMCancel, true);
                    };
                    window.addEventListener("pointerup", onMUp, true);
                    window.addEventListener("pointercancel", onMCancel, true);
                    trace("down(mouse,armed) id=" + item.id);
                    return;
                  }
                  if (item.pinned && !editing) return;
                  cancelPress();
                  /* 指针捕获：菜单浮层会出现，不捕获的话后续 move 事件被浮层吃掉，
                     位移就永远升级不了拖拽（本单元第一版正因此失效）。 */
                  try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 捕获失败也有窗口级监听兜底 */ }
                  /* 侧栏拖拽内核的第二条不变量：拖拽期间**零 React 渲染**——
                     跟手与让位全部直接写 style.transform，松手那一下才改文档。
                     之前每移动一次就 setState，正是"抽搐 / 错位 / 组件消失"的来源。 */
                  const freezeSlots = (): void => {
                    const el2 = gridRef.current;
                    if (!el2) return;
                    const sp2 = scrollParent(el2);
                    const sTop = sp2 ? sp2.scrollTop : 0;
                    const sLeft = sp2 ? sp2.scrollLeft : 0;
                    const r2 = el2.getBoundingClientRect();
                    const slots2: (SlotRect & { id: string })[] = [...el2.querySelectorAll(".board-slot")].map((node) => {
                      const sr = node.getBoundingClientRect();
                      const wid = node.getAttribute("data-item-id") || "";
                      const it = storedRef.current.find((x) => x.id === wid);
                      return {
                        id: wid,
                        x: it ? it.cell.x : 0, y: it ? it.cell.y : 0, w: it ? it.cell.w : 1, h: it ? it.cell.h : 1,
                        left: sr.left + sLeft, top: sr.top + sTop, width: sr.width, height: sr.height,
                      };
                    });
                    const gs2 = getComputedStyle(el2);
                    const press = dragOrigin.current;
                    frozenRef.current = {
                      pressContentX: (press ? press.x : 0) + sLeft,
                      pressContentY: (press ? press.y : 0) + sTop,
                      slots: slots2,
                      grid: { left: r2.left + sLeft, width: r2.width },
                      colPitch: (r2.width + (parseFloat(gs2.columnGap) || TILE_GAP)) / cols,
                      rowPitch: (parseFloat(gs2.gridAutoRows) || TILE_H) + (parseFloat(gs2.rowGap) || TILE_GAP),
                    };
                  };
                  const paintDrag = (px: number, py: number, dx: number, dy: number): void => {
                    const el2 = gridRef.current;
                    const fz = frozenRef.current;
                    const dd = dragRef.current;
                    if (!el2 || !fz || !dd || !dd.started) return;
                    const cur2 = storedRef.current.find((it) => it.id === dd.id);
                    if (!cur2) return;
                    const sp2 = scrollParent(el2);
                    const sTop = sp2 ? sp2.scrollTop : 0;
                    const sLeft = sp2 ? sp2.scrollLeft : 0;
                    /* 目标格 = 原格 + **手指位移的整格数**。
                       为什么不用命中检测（把左上角对齐抓取点）：对大组件、抓在靠下位置时，
                       左上角离手指几百像素，手指动 30px 就可能跨过很上方的槽位边界 → 一下蹦好几行
                       （霖 2026-10-11：「向上稍微挪动直接蹦到顶」）。位移模型与瓷砖网格天然一致：
                       不满一格就不动，跨一格才挪一格；滚动也让内容跟着手指走（加上滚动增量）。 */
                    /* 去抖：越过约 0.62 格才换格，避免停在半格处来回翻（现场抽搐的真因）。 */
                    const dRows = stickyIndex((py + sTop - fz.pressContentY) / fz.rowPitch, stickyRows.current);
                    const dCols = stickyIndex((px + sLeft - fz.pressContentX) / fz.colPitch, stickyCols.current);
                    stickyRows.current = dRows;
                    stickyCols.current = dCols;
                    const cell = {
                      x: Math.min(Math.max(0, cur2.cell.x + dCols), Math.max(0, cols - cur2.cell.w)),
                      y: Math.max(0, cur2.cell.y + dRows),
                    };
                    liveCellRef.current = cell;
                    /* 把虚影挪到目标格：直接写样式，不触发渲染。 */
                    const gh = ghostRef.current;
                    if (gh) {
                      /* 虚影尺寸必须与**落库结果**一致：落库会按目录 sizeRange 夹一次，
                         虚影若直接用文档里的 h 就会「明显高于组件」（霖 2026-10-11）。 */
                      const gdef = defForSpec(cur2.spec, defs);
                      /* 虚影与落库同源：走 normalizeSize（挡位吸附 / 自由夹取）。 */
                      const gsz = normalizeSize(gdef, { w: cur2.cell.w, h: cur2.cell.h });
                      gh.style.display = "block";
                      gh.style.gridColumn = String(cell.x + 1) + " / span " + String(gsz.w);
                      gh.style.gridRow = String(cell.y + 1) + " / span " + String(gsz.h);
                    }
                    const preview = previewItems(storedRef.current, dd.id, cell, defs, cols);
                    /* 诊断用：把目标格与各项让位值打出来。抽搐的症状是这两个数**来回翻**，
                       只看 DOM 猜不出是哪一层，所以留一行紧凑埋点。 */
                    if (dragDebug()) {
                      const sig = storedRef.current
                        .filter((it) => it.id !== dd.id)
                        .map((it) => {
                          const p0 = preview.find((x) => x.id === it.id);
                          return p0 ? (p0.cell.y - it.cell.y) + "" + (p0.cell.x - it.cell.x) : "-";
                        })
                        .join(",");
                      trace("paint cell=" + cell.x + "," + cell.y + " shifts=" + sig);
                    }
                    for (const node of Array.from(el2.querySelectorAll<HTMLElement>(".board-slot"))) {
                      const id = node.getAttribute("data-item-id") || "";
                      if (id === dd.id) {
                        node.style.transform = "translate(" + dx + "px, " + dy + "px)";
                        continue;
                      }
                      const s0 = storedRef.current.find((x) => x.id === id);
                      const p0 = preview.find((x) => x.id === id);
                      const shx = s0 && p0 ? (p0.cell.x - s0.cell.x) * fz.colPitch : 0;
                      const shy = s0 && p0 ? (p0.cell.y - s0.cell.y) * fz.rowPitch : 0;
                      node.style.transform = shx === 0 && shy === 0 ? "" : "translate(" + shx + "px, " + shy + "px)";
                    }
                  };
                  const finishDrag = (commit: boolean): void => {
                    const el2 = gridRef.current;
                    if (el2) {
                      for (const node of Array.from(el2.querySelectorAll<HTMLElement>(".board-slot"))) node.style.transform = "";
                    }
                    if (ghostRef.current) ghostRef.current.style.display = "none";
                    const dd = dragRef.current;
                    const cell = liveCellRef.current;
                    frozenRef.current = null;
                    liveCellRef.current = null;
                    if (commit && dd && dd.started && cell) {
                      trace("drop id=" + dd.id + " to=" + cell.x + "," + cell.y);
                      apply(moveItem(doc, boardId, orientation, dd.id, cell, cols));
                    }
                    setDragNow(null);
                    /* 拖拽只可能在编辑态发起，因此松手后**仍在编辑态**（霖 2026-10-11 澄清）。 */
                  };
                  /* 窗口级监听：菜单浮层会盖住画布，只靠槽内 handler 收不到 move（WebView 96 上实测捕获未生效）。 */
                  const onWinMove = (ev2: PointerEvent): void => {
                    const press = pressRef.current;
                    if (press && !(dragRef.current && dragRef.current.started)) {
                      if (!movedBeyond({ x: press.x, y: press.y }, { x: ev2.clientX, y: ev2.clientY }, MOVE_CANCEL_PX)) return;
                      /* 只有**编辑态**、且已由**长按**武装（菜单已弹出）才升级为拖拽：
                         正常模式一律不改布局；编辑态也不再"一按就拖"，必须先长按（霖 2026-10-11 口径）。 */
                      if (!editing || !press.armed) { cancelPress(); return; }
                      cancelPress();
                      menu.close();
                      trace("upgrade id=" + press.id + " editing=1");
                      moveCount = 0;
                      stickyRows.current = 0;
                      stickyCols.current = 0;
                      setDragNow({ id: press.id, started: true, cell: findCell(press.id) });
                      dragOrigin.current = { x: press.x, y: press.y };
                      /* 冻结几何（侧栏拖拽内核的第一条不变量）：落点与让位都按**按下那一刻**的槽位矩形算，
                         否则让位 transform 会改变"活几何"，落点与自己的让位形成反馈环（抖动/跳位）。 */
                      freezeSlots();
                    }
                    const d = dragRef.current;
                    if (!d || !d.started) return;
                    const el = gridRef.current;
                    if (!el) return;
                    moveCount += 1;
                    if (moveCount <= 3) trace("move#" + moveCount + " x=" + Math.round(ev2.clientX));
                    const o = dragOrigin.current;
                    if (o) paintDrag(ev2.clientX, ev2.clientY, ev2.clientX - o.x, ev2.clientY - o.y);
                    kickScroll(ev2.clientX, ev2.clientY);
                  };
                  /* 边缘自动滚动：拖到上/下边缘慢慢滚，速度与靠近程度相关（霖 2026-10-10 口径）。 */
                  const scrollParent = (node: HTMLElement | null): HTMLElement | null => {
                    let el = node ? node.parentElement : null;
                    while (el) {
                      if (el.scrollHeight > el.clientHeight + 4) return el;
                      el = el.parentElement;
                    }
                    return null;
                  };
                  /* 边缘区取 96：底部 72px 往往与系统手势条重叠，手指贴到最底部会被系统吞掉
                     （表现为拖拽收到 pointercancel、根本不滚）。判据用**手指**的 clientY，与组件无关。 */
                  const EDGE_ZONE = 96;
                  const EDGE_MAX = 14;
                  let raf = 0;
                  let lastY = 0;
                  let moveCount = 0;
                  const tickScroll = (): void => {
                    raf = 0;
                    /* 判据取**滚动容器**的可见范围：原来用 window.innerHeight，而白板是内部容器在滚，
                       判据与执行不同源 → 拖到边缘根本不滚（霖 2026-10-11）。 */
                    const box0 = scrollParent(gridRef.current);
                    const bTop = box0 ? box0.getBoundingClientRect().top : 0;
                    const bBottom = box0 ? box0.getBoundingClientRect().bottom : window.innerHeight;
                    const sp = edgeScrollSpeed(lastY, bTop, bBottom, EDGE_ZONE, EDGE_MAX);
                    if (sp === 0) return;
                    const box = scrollParent(gridRef.current);
                    if (box) box.scrollTop += sp;
                    else window.scrollBy(0, sp);
                    /* 滚动后重算目标格：用最后一次指针位置。 */
                    onWinMove({ clientX: lastX, clientY: lastY } as PointerEvent);
                    raf = window.requestAnimationFrame(tickScroll);
                  };
                  let lastX = 0;
                  const kickScroll = (x: number, y: number): void => {
                    lastX = x; lastY = y;
                    const box1 = scrollParent(gridRef.current);
                    const bTop1 = box1 ? box1.getBoundingClientRect().top : 0;
                    const bBottom1 = box1 ? box1.getBoundingClientRect().bottom : window.innerHeight;
                    if (raf === 0 && edgeScrollSpeed(y, bTop1, bBottom1, EDGE_ZONE, EDGE_MAX) !== 0) {
                      raf = window.requestAnimationFrame(tickScroll);
                    }
                  };
                  const onWinUp = (): void => {
                    cancelPress();
                    if (raf) { window.cancelAnimationFrame(raf); raf = 0; }
                    const d = dragRef.current;
                    trace("up drag=" + (d ? String(d.started) : "none") + " live=" + String(liveCellRef.current ? liveCellRef.current.x + "," + liveCellRef.current.y : "none"));
                    /* 落点取内存里的目标格（拖拽期间没渲染过），由 finishDrag 一次性落库。 */
                    if (d && d.started) finishDrag(true);
                    window.removeEventListener("touchmove", stopNativeScroll);
                    window.removeEventListener("pointermove", onWinMove, true);
                    window.removeEventListener("pointerup", onWinUp, true);
                    /* 必须与注册端**同名同 capture**：注册的是 onWinCancel + capture=true。
                       写错移除不掉，监听会永久留在 window 上，全应用的指针事件都被它接管
                       （霖 2026-10-11：其他页面按钮点不动、下拉触发不了）。 */
                    window.removeEventListener("pointercancel", onWinCancel, true);
                  };
                  /* 取消 = 放弃：浏览器接管滚动、来电、手势打断都走这里，**绝不落库**。 */
                  const onWinCancel = (ev2?: PointerEvent): void => {
                    const t = ev2 && ev2.target ? (ev2.target as HTMLElement) : null;
                    trace("cancel drag=" + (dragRef.current ? String(dragRef.current.started) : "none")
                      + " moves=" + moveCount
                      + " type=" + String(ev2 ? ev2.pointerType : "?")
                      + " cancelable=" + String(ev2 ? ev2.cancelable : "?")
                      + " target=" + String(t ? (t.tagName + "." + String(t.className).slice(0, 24)) : "?"));
                    if (raf) { window.cancelAnimationFrame(raf); raf = 0; }
                    if (dragRef.current && dragRef.current.started) finishDrag(false);
                    cancelPress();
                    setDragNow(null);
                    /* 同上：注册时带 capture=true，移除也必须带。 */
                    window.removeEventListener("pointermove", onWinMove, true);
                    window.removeEventListener("pointerup", onWinUp, true);
                    window.removeEventListener("pointercancel", onWinCancel, true);
                  };
                  /* 非被动 touchmove + preventDefault：显式阻止浏览器/系统把手势接管过去
                     （实测：只有 touch-action: none 时，按住后第一次移动仍会收到 cancelable=false 的
                     pointercancel，拖拽当场作废）。必须在按压期间挂上，抬起即摘。 */
                  /* 只在「长按已武装」或「正在拖拽」时拦截原生滚动：
                     普通过拖组件翻页必须照常可用（霖 2026-10-11：落点在组件上就滑不动）。 */
                  const stopNativeScroll = (ev3: TouchEvent): void => {
                    const pr = pressRef.current;
                    const dd = dragRef.current;
                    if ((pr && pr.armed) || (dd && dd.started)) ev3.preventDefault();
                  };
                  window.addEventListener("touchmove", stopNativeScroll, { passive: false });
                  window.addEventListener("pointermove", onWinMove, true);
                  window.addEventListener("pointerup", onWinUp, true);
                  window.addEventListener("pointercancel", onWinCancel, true);
                  const id = item.id;
                  /* 菜单弹出后**保留**按压信息：需求原文要求「若产生了拖拽，则本次操作为调整位置」。 */
                  const timer = window.setTimeout(() => {
                    trace("menu id=" + id);
                    /* 注意：不要在这里改 touch-action——手势进行中改它会让浏览器取消该指针
                       （实测：升级成功后立刻收到 pointercancel，拖拽被丢弃）。改为画布槽位静态 none。 */
                    /* 长按成立 = 武装这次按压：之后手指移动才允许升级为拖拽（编辑态限定）。 */
                    const cur = pressRef.current;
                    if (cur) cur.armed = true;
                    openItemMenu(item, e.clientX, e.clientY);
                  }, LONG_PRESS_MS);
                  pressRef.current = { id, x: e.clientX, y: e.clientY, timer };
                  const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  grabRef.current = { dx: e.clientX - box.left, dy: e.clientY - box.top };
                  trace("down id=" + id + " p=" + e.pointerType);
                }}
              >
                {editing && freeResize && selectedId === item.id ? (
                  <>
                    {(["n", "s", "e", "w"] as ResizeHandle[]).filter((h) => {
                      /* 能调哪侧才显示哪侧（霖 2026-10-10 口径）：该维度没有可调空间时不显示对应把手。 */
                      const d = defForSpec(item.spec, defs);
                      const rg = d ? d.sizeRange : { minW: 1, minH: 1, maxW: 4, maxH: 3 };
                      if (h === "n" || h === "s") return item.cell.h > rg.minH || item.cell.h < rg.maxH;
                      return item.cell.w > rg.minW || item.cell.w < Math.min(rg.maxW, 4);
                    }).map((h) => (
                      <span
                        key={h}
                        className={"board-handle h-" + h}
                        data-handle={h}
                        onPointerDown={(ev) => {
                          ev.stopPropagation();
                          /* 诊断：抓到的是哪一侧的把手（现场「拖左边动右边」时用它确认命中）。 */
                          trace("handle-down h=" + h + " x=" + Math.round(ev.clientX) + " y=" + Math.round(ev.clientY));
                          /* 鼠标与触屏同管线（2026-10-13）：把手本就是「按下即调」，无长按语义 */
                          const el = gridRef.current;
                          if (!el) return;
                          const gr = el.getBoundingClientRect();
                          const colW = gr.width / cols;
                          const first = el.querySelector(".board-slot");
                          /* 步长取**基准瓦片 + 行距**（从计算样式读，CSS 改了这里自动跟随）。 */
                          const gs = el ? getComputedStyle(el) : null;
                          const rowH = (gs && parseFloat(gs.gridAutoRows) ? parseFloat(gs.gridAutoRows) : TILE_H) + (gs && parseFloat(gs.rowGap) ? parseFloat(gs.rowGap) : TILE_GAP);
                          const start = { x: ev.clientX, y: ev.clientY, cell: { ...item.cell } };
                          trace("resize-down id=" + item.id + " w=" + item.cell.w);
                          const move = (e2: PointerEvent): void => {
                            const next = cellFromResize(start.cell, h, e2.clientX - start.x, e2.clientY - start.y, colW, rowH, cols);
                            trace("resize-move h=" + h + " w=" + next.w + " x=" + next.x);
                            setDragNow({ id: item.id, started: true, cell: next });
                          };
                          const finish = (): void => {
                            window.removeEventListener("pointermove", move, true);
                            window.removeEventListener("pointerup", finish, true);
                            window.removeEventListener("pointercancel", finish, true);
                            const d = dragRef.current;
                            trace("resize-finish drag=" + (d ? String(d.started) + "@w" + String(d.cell.w) : "none"));
                            if (d && d.started) {
                              /* manual：这是**用户**设的尺寸，退出编辑态的拟合不许再改它。 */
                              const nextDoc = placeItem(doc, boardId, orientation, item.id, { x: d.cell.x, y: d.cell.y, w: d.cell.w ?? item.cell.w, h: d.cell.h ?? item.cell.h }, defs, { manual: true });
                              trace("resize-apply changed=" + String(nextDoc !== doc));
                              apply(nextDoc);
                            }
                            setDragNow(null);
                          };
                          window.addEventListener("pointermove", move, true);
                          window.addEventListener("pointerup", finish, true);
                          window.addEventListener("pointercancel", finish, true);
                        }}
                      />
                    ))}
                  </>
                ) : null}
                {editing && isListWidget(wid) ? (
                  /* 编辑态不渲染列表内容：只显示它是什么 + 一句标注（霖 2026-10-11 口径）。 */
                  /* 占位填满槽位：编辑态看到的高度就该等于该组件真实高度（霖 2026-10-11）。 */
                  <div className="wg-card" style={{ height: "100%" }}>
                    <div className="wg-card-shell">
                      <span className="wg-card-title">{plan.title}</span>
                      <span className="wg-card-hint">列表内容在退出编辑模式后显示</span>
                    </div>
                  </div>
                ) : (
                  <WidgetHost item={item} defs={defs} onOpen={onOpen} renderers={renderers} />
                )}
              </div>
            );
          })}
        </div>
      )}

      {tplOpen ? (
        <div className="board-sheet" role="dialog" aria-label="套用模板">
          <div className="board-sheet-head">
            <span className="board-sheet-title">套用模板</span>
            <button className="btn" onClick={() => setTplOpen(false)}>关闭</button>
          </div>
          <div className="board-sheet-list">
            {BOARD_TEMPLATES.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                className="board-sheet-row"
                data-template-option={tpl.id}
                onClick={() => {
                  apply(replaceCells(doc, boardId, orientation, templateItems(tpl)));
                  setTplOpen(false);
                  setEditing(true);
                  say("已套用模板：" + tpl.name);
                }}
              >
                <span className="board-sheet-row-title">{tpl.name}</span>
                <span className="board-sheet-row-desc">{tpl.description}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* 添加组件抽屉：常驻渲染（自己管退场动画），恒为半屏高并避让底栏。
          「改变大小」复用同一个抽屉：切到 resize 模式后自动展开到目标组件并选中当前档位。 */}
      <BoardAddDrawer
        open={addOpen || !!sizeItem}
        defs={defs}
        renderers={renderers}
        mode={sizeItem ? "resize" : "add"}
        target={sizeTarget}
        onAdd={(d, size) => {
          const r = addItemTo(doc, boardId, orientation, d.spec, defs, size);
          if (r.added) { apply(r.doc); say("已添加：" + d.title + " " + size.w + "×" + size.h); setAddOpen(false); setEditing(true); }
          else say(r.reason === "duplicate" ? "白板上已有这个组件" : "这个组件还不能添加");
        }}
        onResize={(_d, size) => {
          if (!sizeItem) return;
          const c = sizeItem.cell;
          /* 档位是用户选的：打 manual，且让位交给 placeItem + apply 的重叠不变量。 */
          apply(placeItem(doc, boardId, orientation, sizeItem.id, { x: c.x, y: c.y, w: size.w, h: size.h }, defs, { manual: true }, cols));
          setSizeItem(null);
          say("已改为 " + size.w + "×" + size.h);
        }}
        onClose={() => { setAddOpen(false); setSizeItem(null); }}
      />

      {/* 具体项选择器：列表 + 搜索框（模板组件用）。 */}
      <BoardItemPicker
        open={!!pickerItem}
        title="选择课程文件"
        searchHint="搜索课程或文件名"
        items={pickerItems}
        currentKey={
          pickerItem && pickerItem.spec.kind === "custom"
            ? String(pickerItem.spec.props?.courseId ?? "") + ":" + String(pickerItem.spec.props?.itemId ?? "")
            : undefined
        }
        onPick={(props) => {
          if (pickerItem) apply(setItemProps(doc, boardId, orientation, pickerItem.id, props));
          setPickerItem(null);
          say("已选择条目");
        }}
        onClose={() => setPickerItem(null)}
      />

      {drawer ? (
        <div className="board-drawer" role="dialog" aria-label="组件设置">
          <div className="board-drawer-title">{planForItem(drawer, defs).title}</div>
          <input className="board-drawer-input" value={draft} maxLength={32} placeholder="输入文字" onChange={(e) => setDraft(e.target.value)} />
          <div className="board-drawer-actions">
            <button className="btn" onClick={() => setDrawer(null)}>取消</button>
            <button className="btn btn-primary" onClick={saveDrawer}>保存</button>
          </div>
        </div>
      ) : null}

      {note ? <div className="board-note" role="status">{note}</div> : null}
    </>
  );

  /* A6（手机档）：OnePage 呈现为底部抽屉——从半屏起、可拉满（同抽屉手柄 0.6vh ⟷ 0.94vh）。
     首页的无头嵌入（chromeless）仍是整窗画布，不走这段分流。 */
  if (!phoneUi || chromeless) return body;
  return (
    <div
      ref={onepageRef}
      className={
        "onepage-sheet" +
        (onepageSheet.dragging ? " is-mob-drag" : mobSnap === "full" ? " is-mob-full" : " is-mob-half")
      }
      style={onepageSheet.dragH != null ? { height: `${onepageSheet.dragH}px` } : undefined}
    >
      <PhoneSheetGrip label="OnePage 面板：拖住改高度（半屏或全屏）" gripProps={onepageSheet.gripProps} />
      <div className="onepage-sheet-body">{body}</div>
    </div>
  );
}
