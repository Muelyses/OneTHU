/**
 * 自由图层白板（2026-10-13 定稿，霖：要可以互相重叠盖住的高级白板）。
 *
 * **一块板一份数据**（2026-10-15）：组件按 `{ boardId, orientation }` 参数化，读写的就是
 * BoardDoc 里那块板那个朝向（state/freeBoard.ts 的 px 层）。首页 = 系统板（HomeTab 显式传入），
 * OnePage = 用户板（OnePageSurface 传 activeBoardId）——**首页与 OnePage 从此是同一块画布**，
 * 「假白板」（4/8 列网格 + 编辑态）那条线整体退役。
 *
 * 交互（**常态即所即**，没有编辑模式）：
 *   - 拖动：按住组件直接拖（4px 阈值区分点击），鼠标触屏同管线；固定的组件拖动被挡；
 *   - 缩放：选中后四角 + 右/下把手，自由拉（下限 120×64）；
 *   - 点选：浮出迷你条（置顶 / 折叠（便笺）/ 透明度 / 固定 / 删除），Delete 删、Esc 取消、方向键微调；
 *   - 图层：选中/拖动即浮到与自己重叠的那簇之上；数组序 = 图层序，后放的在上；
 *   - 右键 / 长按组件：七项菜单（选择条目 / 改变大小 / 编辑 / 固定 / 置顶 / 详情 / 删除）；
 *   - 右键空白 / 「＋」浮钮：添加组件（放在指针处）；双击空白：快速建便笺；
 *   - 双击便笺或文字：就地编辑；画笔恒在最高图层（z 90），RGB 取色 + 撤销/清空。
 *
 * 组件体走 WidgetHost（与旧白板页同一套渲染语义：divider / 文字 / 跳转 / 原子入口 / 卡片 /
 * 自定义 + 降级壳），渲染器 = 白板自足实现 + 各页面发布的卡体 + 活数据三层合并
 * （列表类组件因此在任何页面都能显示真实内容，而不是离开来源页就变空壳）。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { ActionSheet, Btn } from "@onethu/gui";
import { createPortal } from "react-dom";
import {
  freeBoardOps,
  freeBoardSnapshot,
  HOME_BOARD_ID,
  HOME_ORIENTATION,
  MIN_H,
  MIN_W,
  subscribeFreeBoard,
  type FreeItem,
} from "../state/freeBoard.js";
import { ATOM_TEMPLATE_IDS, allWidgetDefs } from "../state/widgets.js";
import { defForSpec, isTierControlled, type WidgetDef, type WidgetSize } from "../state/widgetMeta.js";
import { planForItem } from "../state/widgetRender.js";
import { BOARD_TEMPLATES, templateItems, type BoardTemplate } from "../state/boardTemplates.js";
import { WidgetHost, type WidgetRenderer } from "./WidgetHost.js";
import { BoardAddDrawer } from "./BoardAddDrawer.js";
import { BoardItemPicker, type PickerItem } from "./BoardItemPicker.js";
import { BOARD_CARD_RENDERERS } from "./boardCards.js";
import { cardRendererKey, liveRenderers, subscribeLiveCards } from "../state/liveCards.js";
import { cardRenderers, subscribeTodayCards } from "../state/todayCards.js";
import { resolveAtom } from "../state/atoms.js";
import { atomRefFromKey } from "../state/favorites.js";
import { useApp } from "../state/context.js";
import { activeBoard, cellFromRect, loadBoard, rectFromCell, type BoardDoc, type BoardItem, type Orientation } from "../state/board.js";
import { openOnePage } from "../state/onePage.js";
import { openWorkspace, explorerSnapshot, subscribeExplorer } from "../state/explorer.js";
import { FolderIcon } from "./Icons.js";
import { Card, Empty, NAV, PageHead } from "./Layout.js";
import { PEN_COLORS, penKeyOf, penSnapshot, strokesOf, subscribePen, undoStroke, clearStrokes } from "../state/boardPen.js";
import { sanitizeUserHtml, widgetById as userWidgetById } from "../state/userext.js";
import { BoardPenLayer } from "./BoardPenLayer.js";
import { useContextMenu, type CtxItem } from "./ContextMenu.js";
import { useIsPhone, useSheetSnap } from "../state/phoneSheets.js";
import { PhoneSheetGrip, useSheetDrag } from "./explorer/PhoneSheet.js";
import { useLearnData } from "../state/data.js";
import { IconPen, IconPlus, IconTrash, IconX } from "./Icons.js";

const DRAG_THRESHOLD = 4;
/** 长按出菜单（与全站口径一致：ContextMenu 的 LONG_PRESS_MS 同为 500）。 */
const LONG_PRESS_MS = 500;
type Rect = { x: number; y: number; w: number; h: number };

/** 与数据层同口径的夹取（视觉必须等于落库：否则拖到画布外松手会"弹回去"）。 */
function clampRect(r: Rect): Rect {
  return {
    x: Math.max(0, Math.round(r.x)),
    y: Math.max(0, Math.round(r.y)),
    w: Math.max(MIN_W, Math.round(r.w)),
    h: Math.max(MIN_H, Math.round(r.h)),
  };
}

/**
 * px 矩形 → 板条目视图：WidgetHost / planForItem / 档位抽屉都吃 BoardItem，
 * cell 由 px 反算（4 列基准 + 基准瓦片），于是「档位提示」与画布上的真实大小对得上。
 */
function viewOf(item: FreeItem): BoardItem {
  return { id: item.id, spec: item.spec, cell: cellFromRect({ x: item.x, y: item.y, w: item.w, h: item.h }) };
}

/** 档位（格单位）→ px 尺寸：抽屉选的是档位，画布要的是像素。 */
function pxSizeOf(size: WidgetSize): { w: number; h: number } {
  const r = rectFromCell({ x: 0, y: 0, w: size.w, h: size.h });
  return { w: r.w, h: r.h };
}

/**
 * 三层渲染器合并：白板自足实现（BOARD_CARD_RENDERERS）→ 各页面发布的卡体 → 活数据。
 * （旧白板页的处理，2026-10-15 搬进自由画布：首页与 OnePage 共用同一份。）
 */
function mergeRenderers(): Record<string, WidgetRenderer> {
  return { ...BOARD_CARD_RENDERERS, ...cardRenderers(), ...liveRenderers() };
}

function useRenderers(): Record<string, WidgetRenderer> {
  const [renderers, setRenderers] = useState<Record<string, WidgetRenderer>>(mergeRenderers);
  useEffect(() => {
    const sync = (): void => setRenderers(mergeRenderers());
    const off1 = subscribeTodayCards(sync);
    const off2 = subscribeLiveCards(sync);
    return () => {
      off1();
      off2();
    };
  }, []);
  return renderers;
}

function useFreeBoard(boardId: string, orientation: Orientation): FreeItem[] {
  const snap = useCallback(() => freeBoardSnapshot(boardId, orientation), [boardId, orientation]);
  return useSyncExternalStore(subscribeFreeBoard, snap, snap).items;
}

/**
 * 单个组件体：spec → JSX。
 *
 * 自由层专属的「组合组件」（目录里查不到的：OnePage 入口 / 文件夹 / 用户生成）自己画，
 * 其余一律交给 WidgetHost —— 与旧白板页同一套渲染语义，降级壳与空态文案也一致。
 */
function ItemBody({ item, defs, renderers, onOpen, onFolderAdd, onProps }: {
  item: FreeItem;
  defs: readonly WidgetDef[];
  renderers: Record<string, WidgetRenderer>;
  onOpen: (item: BoardItem) => void;
  onFolderAdd?: () => void;
  onProps?: (props: Record<string, unknown> | undefined) => void;
}): ReactNode {
  const { navigate } = useApp();
  const spec = item.spec;
  /* OnePage 入口（组合组件之一）：把另一块 OnePage 钉在画布上，点击即打开 */
  if (spec.kind === "custom" && spec.id === "onepage") {
    const boardId = typeof spec.props?.boardId === "string" ? spec.props.boardId : "";
    const b = loadBoard().boards.find((x) => x.id === boardId);
    if (!b) {
      return (
        <div className="wg-empty" role="note">
          <span className="wg-empty-title">这个 OnePage 已删除</span>
        </div>
      );
    }
    return (
      <button
        type="button"
        className="wg-entry"
        onClick={() => {
          openOnePage(b.id);
          navigate("board");
        }}
      >
        <span className="wg-entry-title">{b.name}</span>
        <span className="wg-entry-arrow" aria-hidden="true">›</span>
      </button>
    );
  }
  /* 文件夹组合组件：圆形 logo 网格，组织一级入口 / OnePage / 工作区 */
  if (spec.kind === "custom" && spec.id === "folder") {
    const entries = Array.isArray(spec.props?.entries)
      ? (spec.props.entries as Array<{ kind: string; page?: string; label?: string; params?: unknown; boardId?: string; wsId?: string }>)
      : [];
    const openEntry = (en: { kind: string; page?: string; boardId?: string; wsId?: string }): void => {
      if (en.kind === "page" && en.page) navigate(en.page as never);
      else if (en.kind === "onepage" && en.boardId) {
        openOnePage(en.boardId);
        navigate("board");
      } else if (en.kind === "ws" && en.wsId) openWorkspace(en.wsId);
    };
    const iconFor = (en: { kind: string; page?: string; boardId?: string }): ReactNode => {
      if (en.kind === "onepage" && en.boardId) {
        const b = loadBoard().boards.find((x) => x.id === en.boardId);
        return <FolderIcon name={b?.icon ?? "star"} width={18} height={18} />;
      }
      if (en.kind === "ws") return <FolderIcon name="folder" width={18} height={18} />;
      if (en.kind === "page") {
        const n = NAV.find((x) => x.page === (en.page as never));
        if (n) {
          const I = n.icon as (p: { width?: number; height?: number }) => ReactNode;
          return <I width={18} height={18} />;
        }
      }
      return <FolderIcon name="fist" width={18} height={18} />;
    };
    const labelFor = (en: { kind: string; page?: string; label?: string; boardId?: string; wsId?: string }): string => {
      if (en.label) return en.label;
      if (en.kind === "onepage" && en.boardId) return loadBoard().boards.find((x) => x.id === en.boardId)?.name ?? "OnePage";
      if (en.kind === "ws" && en.wsId) return explorerSnapshot().workspaces.find((w) => w.id === en.wsId)?.name ?? "工作区";
      if (en.kind === "page") return NAV.find((x) => x.page === (en.page as never))?.label ?? String(en.page);
      return "?";
    };
    return (
      <div className="free-folder">
        <div className="free-folder-grid">
          {entries.map((en, i) => (
            <button
              key={String(i) + (en.page ?? en.boardId ?? en.wsId ?? "")}
              type="button"
              className="free-folder-cell"
              title={labelFor(en)}
              onClick={() => openEntry(en)}
              onContextMenu={(ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                const next = entries.filter((_, j) => j !== i);
                if (onProps) onProps({ ...spec.props, entries: next });
              }}
            >
              <span className="free-folder-ball">{iconFor(en)}</span>
              <span className="free-folder-label">{labelFor(en)}</span>
            </button>
          ))}
          <button
            type="button"
            className="free-folder-cell is-add"
            title="添加入口"
            onClick={(ev) => {
              ev.stopPropagation();
              onFolderAdd?.();
            }}
          >
            <span className="free-folder-ball is-add">＋</span>
            <span className="free-folder-label">添加</span>
          </button>
        </div>
      </div>
    );
  }
  /* 用户生成组件（OH 元工具创建）：无色 tint 底 + 净化后的 HTML 片段 */
  if (spec.kind === "custom" && spec.id.startsWith("usergen:")) {
    const uid = spec.id.slice("usergen:".length);
    const w = userWidgetById(uid);
    if (!w) {
      return (
        <div className="wg-empty" role="note">
          <span className="wg-empty-title">这个生成组件已被删除</span>
        </div>
      );
    }
    return (
      <div
        className="free-usergen"
        // 净化器已剥 script/事件属性/javascript: 链接（state/userext.ts sanitizeUserHtml）
        dangerouslySetInnerHTML={{ __html: sanitizeUserHtml(w.html) }}
      />
    );
  }
  /* 其余（分隔线 / 文字 / 跳转 / 原子入口 / 卡片 / 目录里的自定义组件）走统一宿主 */
  return <WidgetHost item={viewOf(item)} defs={defs} onOpen={onOpen} renderers={renderers} />;
}

/** 「选择条目」子层：只在真要挑具体项时才挂载——顺带才去取网络学堂数据，首页不受牵连。 */
function TemplateItemPicker({ item, onPick, onClose }: {
  item: FreeItem;
  onPick: (props: Record<string, unknown>) => void;
  onClose: () => void;
}): ReactNode {
  const learn = useLearnData();
  const items: PickerItem[] = useMemo(() => {
    if (item.spec.kind !== "custom") return [];
    const data = learn.data;
    if (item.spec.id === "learn-file") {
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
  }, [item, learn.data]);
  const currentKey = item.spec.kind === "custom"
    ? String(item.spec.props?.courseId ?? "") + ":" + String(item.spec.props?.itemId ?? "")
    : undefined;
  return (
    <BoardItemPicker
      open
      title="选择课程文件"
      searchHint="搜索课程或文件名"
      items={items}
      currentKey={currentKey}
      onPick={onPick}
      onClose={onClose}
    />
  );
}

/**
 * 自由画布。`chrome` 给了就同时渲染页头（标题 + 页面菜单）——那是 OnePage 页面的形态；
 * 首页不传（首页的固定层由 HomeChrome 负责，画布是满幅的）。
 */
export function FreeBoard({ boardId = HOME_BOARD_ID, orientation = HOME_ORIENTATION, chrome }: {
  boardId?: string;
  orientation?: Orientation;
  chrome?: { title: string };
} = {}): ReactNode {
  const ops = useMemo(() => freeBoardOps(boardId, orientation), [boardId, orientation]);
  const items = useFreeBoard(boardId, orientation);
  /* 事件回调（窗口级键盘、浮层菜单）要读到最新的条目：state 在闭包里会过期，故用 ref 镜像。 */
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const { navigate } = useApp();
  const menu = useContextMenu();
  const defs = useMemo(() => allWidgetDefs(), []);
  const renderers = useRenderers();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [penOn, setPenOn] = useState(false);
  const [penColor, setPenColor] = useState<string>(PEN_COLORS[0]);
  /** 就地编辑中的条目（便笺 / 文字组件）。 */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [folderPicker, setFolderPicker] = useState<{ itemId: string } | null>(null);
  /** 简易添加菜单（右键空白 / ＋ 浮钮）：保留自由画布的「就地放一个」。 */
  const [addAt, setAddAt] = useState<{ x: number; y: number } | null>(null);
  /* ── 从旧白板页搬过来的三件能力 ── */
  /** 档位抽屉：addOpen = 添加组件；resizeFor 非空 = 「改变大小」。 */
  const [addOpen, setAddOpen] = useState(false);
  const [resizeFor, setResizeFor] = useState<{ id: string; defId: string; size: WidgetSize } | null>(null);
  /** 模板选择（空板引导之外的第二条入口）。 */
  const [tplOpen, setTplOpen] = useState(false);
  /** 「选择条目」的目标条目 id（模板组件用）。 */
  const [pickFor, setPickFor] = useState<string | null>(null);
  /** 一次性提示（「详情」与添加失败的原因）。 */
  const [note, setNote] = useState<string | null>(null);
  const wsSnap = useSyncExternalStore(subscribeExplorer, explorerSnapshot, explorerSnapshot);
  /* 笔迹变化要跟着重渲染（快照本身不用取：下面按笔键直接读） */
  useSyncExternalStore(subscribePen, penSnapshot, penSnapshot);
  const penKey = penKeyOf(boardId, orientation);
  const penStrokes = strokesOf(penKey);

  /** 拖动/缩放的**进行时**覆盖（不落库，松手才 commit——localStorage 经不起每帧写） */
  const [live, setLive] = useState<{ id: string; rect: Rect } | null>(null);
  const liveRef = useRef(live);
  liveRef.current = live;

  const rectOf = (it: FreeItem): Rect =>
    live && live.id === it.id ? live.rect : { x: it.x, y: it.y, w: it.w, h: it.h };

  const say = useCallback((text: string): void => {
    setNote(text);
    window.setTimeout(() => setNote(null), 1800);
  }, []);

  /* 从今日页「编辑白板布局」进来时直接开添加抽屉（自由画布没有编辑态，落地动作就是"加东西"）。 */
  useEffect(() => {
  }, [chrome]);

  /* 画布高度跟着内容长：条目被拖到折叠线以下时外层滚动容器要能滚到它。
     （绝对定位的孩子不撑父盒；首页的 .freeboard 是 inset:0 的整页画布，天然有这个问题。） */
  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const box = el.parentElement;
    const bottom = items.reduce((m, it) => Math.max(m, it.y + it.h), 0) + 96;
    const base = box ? box.clientHeight : 0;
    el.style.minHeight = bottom > base ? `${bottom}px` : "";
  }, [items]);

  /* 键盘：Delete 删除选中、Esc 取消、方向键 8px 微调（输入框内不劫持） */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement | null)?.isContentEditable) return;
      if (e.key === "Escape") {
        setSelected(null);
        setEditingId(null);
        return;
      }
      if (!selected) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        ops.remove(selected);
        setSelected(null);
        return;
      }
      const it = itemsRef.current.find((x) => x.id === selected);
      if (!it) return;
      const delta: Record<string, [number, number]> = {
        ArrowLeft: [-8, 0], ArrowRight: [8, 0], ArrowUp: [0, -8], ArrowDown: [0, 8],
      };
      const d = delta[e.key];
      if (!d) return;
      e.preventDefault();
      ops.move(selected, it.x + d[0], it.y + d[1]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, ops]);

  /** 条目右键 / 长按菜单（旧白板页的 openItemMenu，2026-10-15 搬到自由画布）。 */
  const openItemMenu = useCallback((item: FreeItem, x: number, y: number): void => {
    const view = viewOf(item);
    const plan = planForItem(view, defs);
    const def = defForSpec(item.spec, defs);
    const list: CtxItem[] = [];
    /* 模板组件（课程文件条目等）：选择显示哪一条具体项 */
    if (item.spec.kind === "custom" && ATOM_TEMPLATE_IDS.includes("custom:" + item.spec.id)) {
      const picked = !!item.spec.props && Object.keys(item.spec.props).length > 0;
      list.push({ key: "pick", label: picked ? "更换条目" : "选择条目", onSelect: () => setPickFor(item.id) });
    }
    /* 尺寸入口分两路：挡位控制 → 复用添加抽屉选档位；自由控制 → 选中出把手。 */
    if (def && isTierControlled(def)) {
      const defId = def.id;
      list.push({ key: "resize", label: "改变大小", onSelect: () => { setSelected(null); setResizeFor({ id: item.id, defId, size: plan.size }); } });
    } else {
      list.push({ key: "resize", label: "自由调整大小", onSelect: () => setSelected(item.id) });
    }
    if (def && def.editableProps && def.editableProps.length) {
      list.push({ key: "edit", label: "编辑", onSelect: () => setEditingId(item.id) });
    }
    list.push({ key: "pin", label: item.pinned ? "取消固定" : "固定", onSelect: () => ops.pin(item.id) });
    list.push({ key: "front", label: "置顶", onSelect: () => ops.raise(item.id) });
    list.push({ key: "info", label: "详情", onSelect: () => say(def ? def.description : "这个组件已经不在组件目录里了。") });
    list.push({ key: "remove", label: "删除", danger: true, onSelect: () => { ops.remove(item.id); setSelected(null); } });
    menu.open({ x, y, title: plan.title, items: list });
  }, [defs, menu, ops, say]);

  /** 拖动/缩放共用指针管线：按下 → 窗口 move（直接写 live）→ up 落库；长按不动则出菜单。 */
  const beginPointer = (
    e: React.PointerEvent,
    id: string,
    mode: "move" | "se" | "ne" | "sw" | "nw" | "e" | "s",
  ): void => {
    if (penOn) return; // 画笔开启时组件不可拖（画笔最高层）
    const it = itemsRef.current.find((x) => x.id === id);
    if (!it) return;
    e.stopPropagation();
    /* 不用 setPointerCapture：捕获会把 click 重定向到容器，组件内的入口按钮/链接全被吞。
       拖拽与点击的区分交给「4px 阈值 + 窗口级 click 抑制」（武装后吞一次 click）。 */
    setSelected(id);
    const sx = e.clientX;
    const sy = e.clientY;
    let armed = false;
    let longFired = false;
    let timer: number | null = null;
    /* 固定的组件：位置锁定（挡拖动/缩放），但仍可长按出菜单取消固定——否则就锁死了。 */
    if (it.pinned && mode === "move") {
      timer = window.setTimeout(() => openItemMenu(it, sx, sy), LONG_PRESS_MS);
      const onUpPinned = (): void => {
        window.removeEventListener("pointerup", onUpPinned);
        window.removeEventListener("pointercancel", onUpPinned);
        if (timer !== null) window.clearTimeout(timer);
      };
      window.addEventListener("pointerup", onUpPinned);
      window.addEventListener("pointercancel", onUpPinned);
      return;
    }
    /* 长按不动 = 出快捷菜单（与全站长按口径一致）；一旦位移超过阈值就收回菜单并转成拖动。 */
    timer = window.setTimeout(() => {
      longFired = true;
      openItemMenu(it, sx, sy);
    }, LONG_PRESS_MS);
    /* 拖动即浮到与自己重叠的那簇之上（不惊动无关组件的图层序） */
    ops.raise(id);
    const orig: Rect = { x: it.x, y: it.y, w: it.w, h: it.h };
    const m: string = mode; // string 别名：避免 TS 对字面量联合做过强收窄
    const onMove = (ev: PointerEvent): void => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      if (!armed) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        armed = true;
        if (timer !== null) window.clearTimeout(timer);
        if (longFired) menu.close();
        /* 拖拽武装后吞掉本次手势派生的 click（capture 相位，先于一切目标）：
           否则拖完松手会误触组件内的按钮/链接。 */
        window.addEventListener("click", killClick, true);
      }
      if (m === "move") {
        /* 跟手的矩形也要夹（与 clampRect/落库同口径）：拖出画布时视觉停在边界上，
           松手才不会"弹回去"——数据层的 x/y 夹取见 boardCore.withRect 的坐标口径。 */
        setLive({ id, rect: clampRect({ ...orig, x: orig.x + dx, y: orig.y + dy }) });
      } else {
        let { x, y, w, h } = orig;
        const west = m === "nw" || m === "sw" || m === "w";
        const north = m === "nw" || m === "n";
        if (m === "se" || m === "e" || west) w = orig.w + (west ? -dx : dx);
        if (m === "se" || m === "s" || north) h = orig.h + (north ? -dy : dy);
        w = Math.max(MIN_W, w);
        h = Math.max(MIN_H, h);
        if (west) x = orig.x + orig.w - w;
        if (north) y = orig.y + orig.h - h;
        setLive({ id, rect: { x: Math.max(0, x), y: Math.max(0, y), w, h } });
      }
    };
    const killClick = (ev: MouseEvent): void => {
      ev.stopPropagation();
      ev.preventDefault();
    };
    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (timer !== null) window.clearTimeout(timer);
      /* click 在 pointerup 之后派发：延迟一拍再摘抑制器 */
      window.setTimeout(() => window.removeEventListener("click", killClick, true), 0);
      const cur = liveRef.current;
      if (cur && cur.id === id) {
        const r = clampRect(cur.rect);
        if (mode === "move") ops.move(id, r.x, r.y);
        else ops.resize(id, r);
      }
      setLive(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  /** 画布空白右键 / ＋浮钮：添加组件菜单（放在指针处） */
  const placeDef = (d: WidgetDef): void => {
    const at = dropAt();
    const spec = d.spec.kind === "custom"
      ? { kind: "custom" as const, id: d.spec.id, props: d.spec.props }
      : JSON.parse(JSON.stringify(d.spec));
    const size = pxSizeOf(d.defaultSize);
    ops.add(spec, at.x, at.y, size.w, size.h);
    setAddAt(null);
  };

  /** 新条目的落点：右键/＋记下的位置优先，否则放在现有内容下方。 */
  const dropAt = (): { x: number; y: number } => {
    if (addAt) return addAt;
    return { x: 24, y: items.reduce((m, it) => Math.max(m, it.y + it.h), 80) + 24 };
  };

  const applyTemplate = (tpl: BoardTemplate): void => {
    /* 模板给的是格单位排版，落到自由画布上要映成 px（rectFromCell 同一套换算）。 */
    const next: BoardItem[] = templateItems(tpl).map((it) => {
      const rect = rectFromCell(it.cell);
      return { id: it.id, spec: it.spec, cell: it.cell, rect, manual: true };
    });
    if (freeBoardOps(boardId, orientation).replace(next)) {
      setTplOpen(false);
      setAddAt(null);
      setSelected(null);
      say("已套用模板：" + tpl.name);
    }
  };

  const canvasPos = (clientX: number, clientY: number): { x: number; y: number } => {
    const r = hostRef.current?.getBoundingClientRect();
    return r ? { x: clientX - r.left, y: clientY - r.top } : { x: 40, y: 300 };
  };

  /** 组件的「打开」语义（与旧白板页一致）：跳转页 / 原子入口。 */
  const onOpen = (boardItem: BoardItem): void => {
    const spec = boardItem.spec;
    if (spec.kind === "nav") {
      navigate(spec.page as never, spec.params as never);
      return;
    }
    if (spec.kind === "atom-link") {
      const ref = atomRefFromKey(spec.ref);
      const view = ref ? resolveAtom(ref) : null;
      if (!view) {
        say("这条入口已失效，可从右键菜单移除");
        return;
      }
      view.open(navigate);
    }
  };

  const pickItem = pickFor ? itemsRef.current.find((x) => x.id === pickFor) : undefined;
  const resizeDef = useMemo(
    () => (resizeFor ? defs.find((d) => d.id === resizeFor.defId) ?? null : null),
    [resizeFor, defs],
  );

  return (
    <div className="freeboard-wrap" data-coach="home-canvas">
      {chrome ? (
        <PageHead
          title={chrome.title}
          meta="自由画布：拖动摆放、四角缩放，组件可以互相重叠盖住"
          menu={[
            { key: "add-widget", label: "添加组件", onSelect: () => setAddOpen(true) },
            { key: "apply-tpl", label: "套用模板", onSelect: () => setTplOpen(true) },
            { key: "pen", label: penOn ? "画笔：关" : "画笔：开", onSelect: () => setPenOn((v) => !v) },
            /* 「所有 OnePage」：删掉旧白板页之后，这里是列表页在 UI 里的入口（另一条通路是 OneGO） */
            { key: "all-boards", label: "所有 OnePage", onSelect: () => navigate("boards") },
          ]}
        />
      ) : null}
      {chrome && items.length === 0 ? (
        <Card>
          <Empty text="这块白板还是空的。可以从模板开始，或从「＋」添加一个组件。" />
          {/* 空板引导：三套预制排版，点一下就有东西可看 */}
          <div className="board-tpl-row">
            {BOARD_TEMPLATES.map((tpl) => (
              <Btn key={tpl.id} variant="outline" data-template={tpl.id} onClick={() => applyTemplate(tpl)}>
                {tpl.name}
              </Btn>
            ))}
          </div>
        </Card>
      ) : null}
      <div
        className={"freeboard" + (chrome ? " is-page" : "")}
        ref={hostRef}
        onPointerDown={(e) => {
          /* 空白处按下 = 取消选中（组件自身会 stopPropagation） */
          if (e.target === e.currentTarget) setSelected(null);
        }}
        onDoubleClick={(e) => {
          if (e.target !== e.currentTarget) return;
          const p = canvasPos(e.clientX, e.clientY);
          ops.addNote(Math.max(0, p.x - 110), Math.max(0, p.y - 80));
        }}
        onContextMenu={(e) => {
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          setAddAt(canvasPos(e.clientX, e.clientY));
        }}
      >
        {items.map((it) => {
          const r = rectOf(it);
          /* 档位排版钩子：CSS 是**无作用域**的 [data-size=...] 选择器（抽屉预览与画布同一条规则），
             所以自由画布上的条目也要带上它——统计卡/入口行的分档排版才不会只在抽屉里生效。 */
          const plan = planForItem(viewOf(it), defs);
          const isSel = selected === it.id;
          const isNote = it.spec.kind === "custom" && it.spec.id === "note";
          const isText = it.spec.kind === "text";
          const editingNow = editingId === it.id && (isNote || isText);
          return (
            <div
              key={it.id}
              data-item-id={it.id}
              data-item={it.spec.kind}
              data-size={plan.size.w + "x" + plan.size.h}
              className={"free-item" + (isSel ? " is-selected" : "") + (penOn ? " is-penlocked" : "") + (live && live.id === it.id ? " is-live" : "") + (it.pinned ? " is-pinned" : "")}
              style={{ left: r.x, top: r.y, width: r.w, height: r.h, opacity: it.opacity ?? 1 }}
              onPointerDown={(e) => {
                if (penOn) return;
                if ((e.target as HTMLElement).closest(".free-handle, .free-toolbar, textarea, input, button.free-note-toggle")) return;
                beginPointer(e, it.id, "move");
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (isNote || isText) {
                  setSelected(it.id);
                  setEditingId(it.id);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (penOn) return;
                setSelected(it.id);
                ops.bringToFront(it.id);
                openItemMenu(it, e.clientX, e.clientY);
              }}
            >
              {/* 折叠态：只留标题条（toolbar 的「展开」还原） */}
              {it.folded ? (
                <div className="free-folded" title="已折叠（浮条里可展开）">
                  <span className="free-note-dot" aria-hidden="true" />
                  <span>便笺</span>
                </div>
              ) : (
              <>
              {/* 便笺与文字：内容可就地编辑（双击进入） */}
              {editingNow ? (
                <textarea
                  className="free-note-editor"
                  autoFocus
                  defaultValue={isNote
                    ? (it.spec.kind === "custom" && typeof it.spec.props?.text === "string" ? it.spec.props.text : "")
                    : (it.spec.kind === "text" ? it.spec.text : "")}
                  onBlur={(e) => {
                    const text = e.target.value;
                    if (it.spec.kind === "custom") ops.props(it.id, { ...it.spec.props, text });
                    else ops.props(it.id, { text });
                    setEditingId(null);
                  }}
                />
              ) : (
                <ItemBody
                  item={it}
                  defs={defs}
                  renderers={renderers}
                  onOpen={onOpen}
                  onFolderAdd={() => setFolderPicker({ itemId: it.id })}
                  onProps={(props) => ops.props(it.id, props)}
                />
              )}
              </>
              )}

              {/* 选中浮条：置顶 / 折叠（便笺）/ 透明度 / 固定 / 删除 */}
              {isSel && !penOn ? (
                <div className="free-toolbar" onPointerDown={(e) => e.stopPropagation()}>
                  <button type="button" title="图层置顶（只压过与它重叠的组件）" onClick={() => ops.raise(it.id)}>⤒</button>
                  {isNote ? (
                    <button
                      type="button"
                      title={it.folded ? "展开" : "折叠"}
                      className="free-note-toggle"
                      onClick={() => ops.fold(it.id, !it.folded)}
                    >
                      {it.folded ? " 展开" : "折叠"}
                    </button>
                  ) : null}
                  {[1, 0.75, 0.5, 0.3].map((v) => (
                    <button
                      key={v}
                      type="button"
                      title={`透明 ${Math.round(v * 100)}%`}
                      className={"free-op" + ((it.opacity ?? 1) === v ? " is-on" : "")}
                      onClick={() => ops.opacity(it.id, v)}
                    >
                      {Math.round(v * 100)}%
                    </button>
                  ))}
                  <button type="button" title={it.pinned ? "取消固定" : "固定位置"} className={"free-op free-pin" + (it.pinned ? " is-on" : "")} onClick={() => ops.pin(it.id)}>钉</button>
                  <button type="button" title="删除" className="is-danger" onClick={() => { ops.remove(it.id); setSelected(null); }}>
                    <IconTrash width={13} height={13} />
                  </button>
                </div>
              ) : null}

              {/* 把手：四角 + 右/下（选中才出现；固定的组件不出把手） */}
              {isSel && !penOn && !it.pinned
                ? (["nw", "ne", "sw", "se", "e", "s"] as const).map((h) => (
                    <span
                      key={h}
                      className={"free-handle fh-" + h}
                      onPointerDown={(ev) => beginPointer(ev, it.id, h)}
                    />
                  ))
                : null}
            </div>
          );
        })}

        {/* 画笔层：恒在最高层（组件盖不住）；开启时接管指针绘画。
            笔迹按「板 id + 朝向」分键（penKeyOf），所以每块 OnePage 各画各的。 */}
        <BoardPenLayer
          boardId={boardId}
          orientation={orientation}
          penOn={penOn}
          color={penColor}
        />

        {/* 浮动按钮列：添加 / 画笔（含 RGB 色板与撤销清空） */}
        <div className="free-fab-col">
          <button type="button" className="free-fab" data-coach="home-add" title="添加组件" aria-label="添加组件" onClick={() => setAddAt({ x: 60, y: 300 })}>
            <IconPlus width={18} height={18} />
          </button>
          <button
            type="button"
            className={"free-fab" + (penOn ? " is-on" : "")}
            title={penOn ? "画笔：关" : "画笔：开（最高图层）"}
            aria-pressed={penOn}
            onClick={() => setPenOn((v) => !v)}
          >
            <IconPen width={18} height={18} />
          </button>
          {penOn ? (
            <div className="free-pen-panel">
              <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(penColor) ? penColor : "#3a3f4a"} onChange={(e) => setPenColor(e.target.value)} aria-label="画笔颜色（RGB）" />
              <button type="button" onClick={() => undoStroke(penKey)} disabled={penStrokes.length === 0}>撤销</button>
              <button type="button" onClick={() => clearStrokes(penKey)} disabled={penStrokes.length === 0}>清空</button>
            </div>
          ) : null}
        </div>
      </div>

      {/* 添加组件菜单（居中；右键空白时记住落点） */}
      {addAt
        ? createPortal(
            <div className="hs-more-mask" onClick={() => setAddAt(null)}>
              <div className="hs-more" role="dialog" aria-label="添加组件" onClick={(e) => e.stopPropagation()}>
                <div className="hs-more-head">
                  <span>添加组件</span>
                  <button type="button" className="hs-close" aria-label="关闭" onClick={() => setAddAt(null)}>
                    <IconX width={14} height={14} />
                  </button>
                </div>
                <div className="free-add-list">
                  <div className="hs-detail-group-name">常用</div>
                  {defs
                    .filter((d) => ["custom:note", "text-title", "text-label", "divider"].includes(d.id))
                    .map((d) => (
                      <button key={d.id} type="button" className="hs-detail-row" title={d.description} onClick={() => placeDef(d)}>
                        <span>{d.title}</span>
                      </button>
                    ))}
                  <div className="hs-detail-group-name">组合</div>
                  <button
                    type="button"
                    className="hs-detail-row"
                    title="圆形 logo 网格（手机文件夹式）：可收纳一级入口、OnePage 与工作区"
                    onClick={() => {
                      const at = dropAt();
                      ops.add({ kind: "custom", id: "folder", props: { title: "文件夹", entries: [] } }, at.x, at.y, 180, 180);
                      setAddAt(null);
                    }}
                  >
                    <span>文件夹</span>
                  </button>
                  <div className="hs-detail-group-name">OnePage</div>
                  {loadBoard()
                    .boards.filter((b) => b.kind === "user")
                    .map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        className="hs-detail-row"
                        title="把这块 OnePage 钉到画布上（点击即打开）"
                        onClick={() => {
                          const at = dropAt();
                          ops.add({ kind: "custom", id: "onepage", props: { boardId: b.id } }, at.x, at.y, 150, 84);
                          setAddAt(null);
                        }}
                      >
                        <span>{b.name}</span>
                      </button>
                    ))}
                  <div className="hs-detail-group-name">卡片与入口</div>
                  {defs
                    .filter((d) => !["custom:note", "text-title", "text-label", "divider"].includes(d.id))
                    .map((d) => (
                      <button key={d.id} type="button" className="hs-detail-row" title={d.description} onClick={() => placeDef(d)}>
                        <span>{d.title}</span>
                      </button>
                    ))}
                  {/* 全部组件 + 尺寸档位（旧白板页的抽屉）：自由画布上也能挑档位落一个 */}
                  <div className="hs-detail-group-name">更多</div>
                  <button
                    type="button"
                    className="hs-detail-row"
                    title="打开组件抽屉：逐个预览、可选尺寸档位"
                    onClick={() => {
                      setAddOpen(true);
                      setAddAt(null);
                    }}
                  >
                    <span>全部组件与尺寸…</span>
                  </button>
                </div>
                <div className="hs-op-hint">会放在空白处右键/＋号的位置；拖动与缩放随时可调</div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {/* 文件夹入口选择器：一级功能 / OnePage / 工作区 */}
      {folderPicker
        ? createPortal(
            <div className="hs-more-mask" onClick={() => setFolderPicker(null)}>
              <div className="hs-more" role="dialog" aria-label="添加入口" onClick={(e) => e.stopPropagation()}>
                <div className="hs-more-head">
                  <span>添加入口到文件夹</span>
                  <button type="button" className="hs-close" aria-label="关闭" onClick={() => setFolderPicker(null)}>
                    <IconX width={14} height={14} />
                  </button>
                </div>
                {(() => {
                  const target = itemsRef.current.find((x) => x.id === folderPicker.itemId);
                  if (!target || target.spec.kind !== "custom") return null;
                  const entries = Array.isArray(target.spec.props?.entries)
                    ? (target.spec.props?.entries as Array<{ kind: string; page?: string; label?: string; boardId?: string; wsId?: string }>)
                    : [];
                  const baseProps = target.spec.props as Record<string, unknown> | undefined;
                  const append = (en: { kind: string; page?: string; label?: string; boardId?: string; wsId?: string }): void => {
                    ops.props(folderPicker.itemId, { ...baseProps, entries: [...entries, en] });
                  };
                  return (
                    <div className="free-add-list">
                      <div className="hs-detail-group-name">一级功能</div>
                      {NAV.map((n) => (
                        <button
                          key={n.page}
                          type="button"
                          className="hs-detail-row"
                          onClick={() => append({ kind: "page", page: n.page, label: n.label })}
                        >
                          <span>{n.label}</span>
                        </button>
                      ))}
                      <div className="hs-detail-group-name">OnePage</div>
                      {loadBoard()
                        .boards.filter((b) => b.kind === "user")
                        .map((b) => (
                          <button key={b.id} type="button" className="hs-detail-row" onClick={() => append({ kind: "onepage", boardId: b.id, label: b.name })}>
                            <span>{b.name}</span>
                          </button>
                        ))}
                      <div className="hs-detail-group-name">工作区</div>
                      {wsSnap.workspaces.length === 0 ? (
                        <div className="hs-op-hint">还没有工作区（标签右键可把标签编入工作区）</div>
                      ) : (
                        wsSnap.workspaces.map((w) => (
                          <button key={w.id} type="button" className="hs-detail-row" onClick={() => append({ kind: "ws", wsId: w.id, label: w.name })}>
                            <span>{w.name}</span>
                          </button>
                        ))
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>,
            document.body,
          )
        : null}

      {/* 套用模板（空板引导之外的第二条入口，同一份纯逻辑） */}
      <ActionSheet
        open={tplOpen}
        title="套用模板"
        items={BOARD_TEMPLATES.map((tpl) => ({
          id: tpl.id,
          label: tpl.name + " · " + tpl.description,
          onSelect: () => applyTemplate(tpl),
        }))}
        onClose={() => setTplOpen(false)}
      />

      {/* 添加组件抽屉：常驻渲染（自己管退场动画）；「改变大小」复用同一个抽屉（自动选中当前档位） */}
      <BoardAddDrawer
        open={addOpen || !!resizeFor || !!resizeDef}
        defs={defs}
        renderers={renderers}
        mode={resizeFor ? "resize" : "add"}
        target={resizeFor ? { defId: resizeFor.defId, size: resizeFor.size } : null}
        onAdd={(d, size) => {
          const at = dropAt();
          const key = JSON.stringify(d.spec);
          if (itemsRef.current.some((it) => JSON.stringify(it.spec) === key)) {
            say("白板上已有这个组件");
            return;
          }
          const px = pxSizeOf(size);
          const spec = d.spec.kind === "custom"
            ? { kind: "custom" as const, id: d.spec.id, props: d.spec.props }
            : JSON.parse(JSON.stringify(d.spec));
          ops.add(spec, at.x, at.y, px.w, px.h);
          say("已添加：" + d.title + " " + size.w + "×" + size.h);
          setAddOpen(false);
          setAddAt(null);
        }}
        onResize={(_d, size) => {
          if (!resizeFor) return;
          const cur = itemsRef.current.find((it) => it.id === resizeFor.id);
          if (!cur) return;
          const px = pxSizeOf(size);
          ops.resize(resizeFor.id, { x: cur.x, y: cur.y, w: px.w, h: px.h });
          setResizeFor(null);
          say("已改为 " + size.w + "×" + size.h);
        }}
        onClose={() => {
          setAddOpen(false);
          setResizeFor(null);
        }}
      />

      {/* 「选择条目」：模板组件（课程文件等）选一条具体项，定位参数写进 spec.props */}
      {pickItem ? (
        <TemplateItemPicker
          item={pickItem}
          onPick={(props) => {
            ops.props(pickItem.id, props);
            setPickFor(null);
            say("已选择条目");
          }}
          onClose={() => setPickFor(null)}
        />
      ) : null}

      {note ? <div className="board-note" role="status">{note}</div> : null}
    </div>
  );
}

/**
 * OnePage 页面壳：页头 + 自由画布（+ 手机档的底部抽屉）。
 *
 * 取代已退役的 pages/BoardPage.tsx —— 页面 id 仍是 `board`（深链 #/board/<板 id> 照旧），
 * 画布换成与首页同一块自由白板；「所有 OnePage」入口在页头菜单里（另一条通路是 OneGO）。
 */
/** 临时几何探针（仅 dev，2026-10-15，取证后删）：OnePage「截断」要看**真 app** 的逐层数字。
 *  每 3s 报一条：视口/面板（高、scrollHeight、overflowY、maxHeight、类名）/画布（高、scrollHeight、
 *  内联 minHeight）/最底部与最顶部条目（含负数）/画笔层 —— 拖完组件我就能立刻知道是哪一层在裁。 */
function useOnePageLayoutProbe(_boardKey: string | null | undefined): void {
  useEffect(() => {
    if (!import.meta.env.DEV) return; // 生产不跑
    const report = (): void => {
      /* 只看**可见**那个面板/画布：非活跃标签的面板是 display:none（高 0），此前探针全测到 0，
         等于一条有效数据都没有（仓库里 ExplorerPreview 用的是同款选择器）。 */
      const panel = document.querySelector<HTMLElement>(".explorer-panel:not([style*='display: none'])");
      const canvas = panel?.querySelector<HTMLElement>(".freeboard") ?? null;
      if (!panel || !canvas) return;
      const pen = canvas.querySelector<HTMLElement>(".board-pen");
      const items = Array.from(canvas.querySelectorAll<HTMLElement>(".free-item"));
      const pcs = getComputedStyle(panel);
      /* 每个条目报"盒子 h"与"卡体内容 sh"：sh > h 就是**内容被切**（含内部可滚与否）。 */
      const rows = items.map((it) => {
        const r = it.getBoundingClientRect();
        const inner = it.querySelector<HTMLElement>(".wg-card") ?? it.firstElementChild;
        const ish = inner ? inner.scrollHeight : 0;
        const ih = inner ? Math.round(inner.getBoundingClientRect().height) : 0;
        return `${it.dataset.itemId ?? "?"}[${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)} card=${ih}/${ish}${ish > ih + 2 ? "!!CUT" : ""}]`;
      });
      const line = [
        "[onepage-layout]",
        `win=${innerWidth}x${innerHeight}`,
        `panel[h=${Math.round(panel.getBoundingClientRect().height)} ch=${panel.clientHeight} sh=${panel.scrollHeight} oy=${pcs.overflowY} maxH=${pcs.maxHeight} top=${Math.round(panel.getBoundingClientRect().top)} cls="${panel.className}"]`,
        `canvas[h=${Math.round(canvas.getBoundingClientRect().height)} sh=${canvas.scrollHeight} minH="${canvas.style.minHeight || ""}"]`,
        pen ? `pen[h=${Math.round(pen.getBoundingClientRect().height)}]` : "pen=null",
        `items=${items.length}`,
        `boxes=[${rows.join(" ")}]`,
      ].join(" ");
      void import("@tauri-apps/api/core").then((m) => m.invoke("log_debug", { line: new Date().toISOString() + " | " + line })).catch(() => undefined);
    };
    const iv = window.setInterval(report, 3000);
    report();
    return () => window.clearInterval(iv);
  }, []);
}

export function OnePageSurface(): ReactNode {
  const [doc, setDoc] = useState<BoardDoc>(() => loadBoard());
  useOnePageLayoutProbe(doc.activeBoardId); // 临时探针（仅 dev）：定时上报，见函数头注释
  /* OneGO / 收藏星 / 星标在别处改了板文档 → 重读（否则刚新建的 OnePage 打不开） */
  useEffect(() => {
    const on = (): void => setDoc(loadBoard());
    window.addEventListener("onethu.boards.changed", on);
    return () => window.removeEventListener("onethu.boards.changed", on);
  }, []);
  const board = activeBoard(doc);
  /* 朝向按设备：平板横竖屏各有一套布局（与旧白板页同一口径；缺 landscape 时回落 portrait）。 */
  const [portrait] = useState<boolean>(() =>
    typeof window !== "undefined" ? window.matchMedia("(orientation: portrait)").matches : true,
  );
  const orientation: Orientation = portrait ? "portrait" : "landscape";
  const phoneUi = useIsPhone();
  const mobSnap = useSheetSnap("onepage");
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const sheet = useSheetDrag(sheetRef, { id: "onepage" });

  const body: ReactNode = board
    ? <FreeBoard boardId={board.id} orientation={orientation} chrome={{ title: board.name }} />
    : (
      <Card>
        <Empty text="这块 OnePage 已经不存在了。" />
      </Card>
    );
  if (!phoneUi) return body;
  return (
    <div
      ref={sheetRef}
      className={
        "onepage-sheet" +
        (sheet.dragging ? " is-mob-drag" : mobSnap === "full" ? " is-mob-full" : " is-mob-half")
      }
      style={sheet.dragH != null ? { height: `${sheet.dragH}px` } : undefined}
    >
      <PhoneSheetGrip label="OnePage 面板：拖住改高度（半屏或全屏）" gripProps={sheet.gripProps} />
      <div className="onepage-sheet-body">{body}</div>
    </div>
  );
}
