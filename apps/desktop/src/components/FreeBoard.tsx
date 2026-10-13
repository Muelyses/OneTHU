/**
 * 自由图层白板（2026-10-13 定稿，霖：要可以互相重叠盖住的高级白板）。
 *
 * 交互（**常态即所即**，没有编辑模式）：
 *   - 拖动：按住组件直接拖（4px 阈值区分点击），鼠标触屏同管线；
 *   - 缩放：选中后四角 + 右/下把手，自由拉（下限 120×64）；
 *   - 点选：浮出迷你条（置顶 / 折叠（便笺）/ 删除），Delete 删、Esc 取消、方向键微调；
 *   - 图层：选中/拖动即置顶；数组序 = 图层序，后放的在上；
 *   - 右键空白 / 「＋」浮钮：添加组件（放在指针处）；双击空白：快速建便笺；
 *   - 画笔：恒在**最高图层**（z 90，组件盖不住、拖不走），RGB 色板任意取色 + 撤销/清空。
 *
 * 渲染复用旧卡体注册表（BOARD_CARD_RENDERERS）：px 尺寸近似映射成档位提示
 * （{w,h} 取整档），卡内分档排版能力保留；重叠/盖住是特性，不再有推挤。
 */
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  addItem,
  addNote,
  bringToFront,
  freeBoardSnapshot,
  MIN_H,
  MIN_W,
  moveItem,
  raiseAboveOverlapping,
  removeItem,
  setItemFolded,
  sizeItem,
  subscribeFreeBoard,
  updateItemProps,
  type FreeItem,
} from "../state/freeBoard.js";
import { allWidgetDefs } from "../state/widgets.js";
import type { WidgetDef } from "../state/widgetMeta.js";
import { BOARD_CARD_RENDERERS } from "./boardCards.js";
import { cardRendererKey } from "../state/liveCards.js";
import { resolveAtom } from "../state/atoms.js";
import { atomRefFromKey } from "../state/favorites.js";
import { useApp } from "../state/context.js";
import { loadBoard } from "../state/board.js";
import { openOnePage } from "../state/onePage.js";
import { openWorkspace, explorerSnapshot, subscribeExplorer } from "../state/explorer.js";
import { FolderIcon, IconChevron } from "./Icons.js";
import { NAV } from "./Layout.js";
import { PEN_COLORS, addStroke, penSnapshot, strokesOf, subscribePen, undoStroke, clearStrokes, penKeyOf } from "../state/boardPen.js";
import { sanitizeUserHtml, widgetById as userWidgetById } from "../state/userext.js";
import { BoardPenLayer } from "./BoardPenLayer.js";
import { IconPen, IconPlus, IconTrash, IconX } from "./Icons.js";

const DRAG_THRESHOLD = 4;
const PEN_KEY = penKeyOf("free:home", "default");
type Rect = { x: number; y: number; w: number; h: number };

/** px 尺寸 → 档位提示（卡体分档排版用；只是提示，不约束） */
function sizeHint(r: Rect): { w: number; h: number } {
  return {
    w: Math.max(1, Math.min(4, Math.round(r.w / 110))),
    h: Math.max(1, Math.min(4, Math.round(r.h / 72))),
  };
}

function useFreeBoard(): FreeItem[] {
  useSyncExternalStore(subscribeFreeBoard, freeBoardSnapshot, freeBoardSnapshot);
  return freeBoardSnapshot().items;
}

/** 单个组件体：spec → JSX（复用旧注册表 + 原子入口运行时解析） */
function ItemBody({ item, sizeHint, onFolderAdd }: { item: FreeItem; sizeHint: { w: number; h: number }; onFolderAdd?: () => void }): ReactNode {
  const { navigate } = useApp();
  const spec = item.spec;
  if (spec.kind === "text") {
    return spec.variant === "title"
      ? <h3 className="wg-title">{spec.text}</h3>
      : <p className="wg-label">{spec.text}</p>;
  }
  if (spec.kind === "divider") return <hr className="wg-divider" />;
  if (spec.kind === "atom-link") {
    const ref = atomRefFromKey(spec.ref);
    const view = ref ? resolveAtom(ref) : null;
    return (
      <button type="button" className="wg-entry" onClick={() => view?.open(navigate)}>
        <span className="wg-entry-title">{view?.title ?? "入口已失效"}</span>
        <span className="wg-entry-arrow" aria-hidden="true">›</span>
      </button>
    );
  }
  if (spec.kind === "nav") {
    return (
      <button type="button" className="wg-entry" onClick={() => navigate(spec.page as never, spec.params as never)}>
        <span className="wg-entry-title">{spec.label ?? spec.page}</span>
        <span className="wg-entry-arrow" aria-hidden="true">›</span>
      </button>
    );
  }
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
                if (item.id) updateItemProps(item.id, { ...spec.props, entries: next });
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
  if (spec.kind === "custom") {
    const r = BOARD_CARD_RENDERERS[cardRendererKey(spec.id)];
    /* 便笺空内容：自由白板上没有「属性」菜单，提示改为双击编辑 */
    const props =
      spec.id === "note"
        ? { ...spec.props, text: typeof spec.props?.text === "string" && spec.props.text ? spec.props.text : "双击便笺写内容" }
        : spec.props;
    if (r) {
      const out = r(props, sizeHint);
      if (out) return out;
    }
    return (
      <div className="wg-card-shell">
        <span className="wg-card-title">{spec.id}</span>
        <span className="wg-card-hint">暂无内容</span>
      </div>
    );
  }
  return (
    <div className="wg-card-shell">
      <span className="wg-card-hint">内容由原页面提供</span>
    </div>
  );
}

export function FreeBoard(): ReactNode {
  const items = useFreeBoard();
  const { navigate } = useApp();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState<{ x: number; y: number } | null>(null);
  const itemMenuState = useState<{ id: string; x: number; y: number } | null>(null);
  const itemMenu = itemMenuState[0];
  const [penOn, setPenOn] = useState(false);
  const [penColor, setPenColor] = useState<string>(PEN_COLORS[0]);
  const [noteEdit, setNoteEdit] = useState<string | null>(null);
  const [folderPicker, setFolderPicker] = useState<{ itemId: string } | null>(null);
  const wsSnap = useSyncExternalStore(subscribeExplorer, explorerSnapshot, explorerSnapshot);
  const penSnap = useSyncExternalStore(subscribePen, penSnapshot, penSnapshot);
  const penStrokes = strokesOf(PEN_KEY);

  /** 拖动/缩放的**进行时**覆盖（不落库，松手才 commit——localStorage 经不起每帧写） */
  const [live, setLive] = useState<{ id: string; rect: Rect } | null>(null);
  const liveRef = useRef(live);
  liveRef.current = live;

  const rectOf = (it: FreeItem): Rect =>
    live && live.id === it.id ? live.rect : { x: it.x, y: it.y, w: it.w, h: it.h };

  useEffect(() => {
    const onBoards = (): void => setMenuOpen(null);
    window.addEventListener("onethu.boards.changed", onBoards);
    return () => window.removeEventListener("onethu.boards.changed", onBoards);
  }, []);

  /* 键盘：Delete 删除选中、Esc 取消、方向键 8px 微调（输入框内不劫持） */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement | null)?.isContentEditable) return;
      if (e.key === "Escape") {
        setSelected(null);
        setMenuOpen(null);
        return;
      }
      if (!selected) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removeItem(selected);
        setSelected(null);
        return;
      }
      const it = freeBoardSnapshot().items.find((x) => x.id === selected);
      if (!it) return;
      const delta: Record<string, [number, number]> = {
        ArrowLeft: [-8, 0], ArrowRight: [8, 0], ArrowUp: [0, -8], ArrowDown: [0, 8],
      };
      const d = delta[e.key];
      if (!d) return;
      e.preventDefault();
      moveItem(selected, it.x + d[0], it.y + d[1]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  /** 拖动/缩放共用指针管线：按下 → 窗口 move（rAF 不必，直接写 live）→ up 落库 */
  const beginPointer = (
    e: React.PointerEvent,
    id: string,
    mode: "move" | "se" | "ne" | "sw" | "nw" | "e" | "s",
  ): void => {
    if (penOn) return; // 画笔开启时组件不可拖（画笔最高层）
    const it = freeBoardSnapshot().items.find((x) => x.id === id);
    if (!it) return;
    e.stopPropagation();
    /* 不用 setPointerCapture：捕获会把 click 重定向到容器，组件内的入口按钮/链接全被吞。
       拖拽与点击的区分交给「4px 阈值 + 窗口级 click 抑制」（武装后吞一次 click）。 */
    setSelected(id);
    /* 拖动即浮到与自己重叠的那簇之上（不惊动无关组件的图层序） */
    raiseAboveOverlapping(id);
    const orig: Rect = { x: it.x, y: it.y, w: it.w, h: it.h };
    const sx = e.clientX;
    const sy = e.clientY;
    const m: string = mode; // string 别名：避免 TS 对字面量联合做过强收窄
    let armed = false;
    const onMove = (ev: PointerEvent): void => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      if (!armed) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        armed = true;
        /* 拖拽武装后吞掉本次手势派生的 click（capture 相位，先于一切目标）：
           否则拖完松手会误触组件内的按钮/链接。 */
        window.addEventListener("click", killClick, true);
      }
      if (m === "move") {
        setLive({ id, rect: { ...orig, x: orig.x + dx, y: orig.y + dy } });
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
        setLive({ id, rect: { x, y, w, h } });
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
      /* click 在 pointerup 之后派发：延迟一拍再摘抑制器 */
      window.setTimeout(() => window.removeEventListener("click", killClick, true), 0);
      const cur = liveRef.current;
      if (cur && cur.id === id) {
        if (mode === "move") moveItem(id, Math.round(cur.rect.x), Math.round(cur.rect.y));
        else sizeItem(id, Math.round(cur.rect.w), Math.round(cur.rect.h), Math.round(cur.rect.x), Math.round(cur.rect.y));
      }
      setLive(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  /** 画布空白右键 / ＋浮钮：添加组件菜单（放在指针处） */
  const [addAt, setAddAt] = useState<{ x: number; y: number } | null>(null);
  const defs = allWidgetDefs();
  const placeDef = (d: WidgetDef): void => {
    const at = addAt ?? { x: 40, y: 300 };
    const spec = d.spec.kind === "custom"
      ? { kind: "custom" as const, id: d.spec.id, props: d.spec.props }
      : JSON.parse(JSON.stringify(d.spec));
    addItem(spec, at.x, at.y, Math.max(MIN_W, d.defaultSize.w * 110), Math.max(MIN_H, d.defaultSize.h * 72));
    setAddAt(null);
  };

  const canvasPos = (clientX: number, clientY: number): { x: number; y: number } => {
    const r = hostRef.current?.getBoundingClientRect();
    return r ? { x: clientX - r.left, y: clientY - r.top } : { x: 40, y: 300 };
  };

  return (
    <div
      className="freeboard"
      ref={hostRef}
      onPointerDown={(e) => {
        /* 空白处按下 = 取消选中（组件自身会 stopPropagation） */
        if (e.target === e.currentTarget) setSelected(null);
      }}
      onDoubleClick={(e) => {
        if (e.target !== e.currentTarget) return;
        const p = canvasPos(e.clientX, e.clientY);
        addNote(p.x - 110, p.y - 80);
      }}
      onContextMenu={(e) => {
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        setAddAt(canvasPos(e.clientX, e.clientY));
      }}
    >
      {items.map((it) => {
        const r = rectOf(it);
        const isSel = selected === it.id;
        const isNote = it.spec.kind === "custom" && it.spec.id === "note";
        return (
          <div
            key={it.id}
            className={"free-item" + (isSel ? " is-selected" : "") + (penOn ? " is-penlocked" : "") + (live && live.id === it.id ? " is-live" : "")}
            style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
            onPointerDown={(e) => {
              if (penOn) return;
              if ((e.target as HTMLElement).closest(".free-handle, .free-toolbar, textarea, input, button.free-note-toggle")) return;
              beginPointer(e, it.id, "move");
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (isNote) {
                setSelected(it.id);
                setNoteEdit(it.id);
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (penOn) return;
              setSelected(it.id);
              bringToFront(it.id);
              setItemMenu({ id: it.id, x: e.clientX, y: e.clientY });
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
            {/* 便笺：内容可就地编辑（双击进入） */}
            {isNote && noteEdit === it.id ? (
              <textarea
                className="free-note-editor"
                autoFocus
                defaultValue={it.spec.kind === "custom" && typeof it.spec.props?.text === "string" ? it.spec.props.text : ""}
                onBlur={(e) => {
                  if (it.spec.kind === "custom") updateItemProps(it.id, { ...it.spec.props, text: e.target.value });
                  setNoteEdit(null);
                }}
              />
            ) : (
              <ItemBody item={it} sizeHint={sizeHint(r)} onFolderAdd={() => setFolderPicker({ itemId: it.id })} />
            )}
            </>
            )}

            {/* 选中浮条：置顶 / 折叠（便笺）/ 删除 */}
            {isSel && !penOn ? (
              <div className="free-toolbar" onPointerDown={(e) => e.stopPropagation()}>
                <button type="button" title="图层置顶（只压过与它重叠的组件）" onClick={() => raiseAboveOverlapping(it.id)}>⤒</button>
                {isNote ? (
                  <button
                    type="button"
                    title={it.folded ? "展开" : "折叠"}
                    className="free-note-toggle"
                    onClick={() => setItemFolded(it.id, !it.folded)}
                  >
                    {it.folded ? " 展开" : "折叠"}
                  </button>
                ) : null}
                <button type="button" title="删除" className="is-danger" onClick={() => { removeItem(it.id); setSelected(null); }}>
                  <IconTrash width={13} height={13} />
                </button>
              </div>
            ) : null}

            {/* 把手：四角 + 右/下（选中才出现；画笔层在更上面） */}
            {isSel && !penOn
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

      {/* 画笔层：恒在最高层（组件盖不住）；开启时接管指针绘画 */}
      <BoardPenLayer boardId="free:home" orientation="default" penOn={penOn} color={penColor} />

      {/* 浮动按钮列：添加 / 画笔（含 RGB 色板与撤销清空） */}
      <div className="free-fab-col">
        <button type="button" className="free-fab" title="添加组件" aria-label="添加组件" onClick={() => setAddAt({ x: 60, y: 300 })}>
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
            <button type="button" onClick={() => undoStroke(PEN_KEY)} disabled={penStrokes.length === 0}>撤销</button>
            <button type="button" onClick={() => clearStrokes(PEN_KEY)} disabled={penStrokes.length === 0}>清空</button>
          </div>
        ) : null}
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
                      const at = addAt ?? { x: 60, y: 300 };
                      addItem({ kind: "custom", id: "folder", props: { title: "文件夹", entries: [] } }, at.x, at.y, 180, 180);
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
                          const at = addAt ?? { x: 60, y: 300 };
                          addItem({ kind: "custom", id: "onepage", props: { boardId: b.id } }, at.x, at.y, 150, 84);
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
                  const target = freeBoardSnapshot().items.find((x) => x.id === folderPicker.itemId);
                  if (!target || target.spec.kind !== "custom") return null;
                  const entries = target.spec.kind === "custom" && Array.isArray(target.spec.props?.entries)
                    ? (target.spec.props?.entries as Array<{ kind: string; page?: string; label?: string; boardId?: string; wsId?: string }>)
                    : [];
                  const append = (en: { kind: string; page?: string; label?: string; boardId?: string; wsId?: string }): void => {
                    if (target.spec.kind === "custom") updateItemProps(folderPicker.itemId, { ...target.spec.props, entries: [...entries, en] });
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

      {/* 组件右键菜单 */}
      {itemMenu
        ? createPortal(
            <div className="hs-more-mask" onClick={() => setItemMenu(null)} onContextMenu={(e) => { e.preventDefault(); setItemMenu(null); }}>
              <div className="hs-more hs-menu" role="menu" style={{ position: "fixed", left: itemMenu.x, top: itemMenu.y }} onClick={(e) => e.stopPropagation()}>
                <button type="button" className="hs-op-item" role="menuitem" onClick={() => { raiseAboveOverlapping(itemMenu.id); setItemMenu(null); }}>置顶（压过重叠组件）</button>
                <button type="button" className="hs-op-item" role="menuitem" onClick={() => { const it = freeBoardSnapshot().items.find((x) => x.id === itemMenu.id); if (it) setNoteEdit(it.id); setItemMenu(null); }}>编辑内容</button>
                <button type="button" className="hs-op-item is-danger" role="menuitem" onClick={() => { removeItem(itemMenu.id); setSelected(null); setItemMenu(null); }}>删除</button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );

  function setItemMenu(v: { id: string; x: number; y: number } | null): void {
    itemMenuState[1](v);
  }
}
