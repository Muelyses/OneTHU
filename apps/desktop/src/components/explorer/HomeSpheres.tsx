/**
 * 首页球型功能目录（霖 2026-10-12 需求）。
 *
 * 右上角常驻圆形 logo → 点开向左下展开 0.10 风格小窗（圆球 logo + 底下名字的网格）；
 * 「··· 详情」在小窗内切换成详细功能目录（分类列表，即原首页目录卡的内容）；
 * 「更多功能」球弹出全量一级页清单；球可拖出小窗落到白板上（loose），外置球可拖动
 * 摆放，任何拖动过程右下角出现红色垃圾桶，拖入即删。布局与持久化在 state/homeSpheres.ts。
 *
 * 拖拽是自包含的 pointer 实现（抓取后续跟、8px 位移判据、松手命中测试），不引库、
 * 不碰白板编辑态的拖拽内核——两套语义不同（这是「图标拖放」，那是「布局重排」）。
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  allSphereEntries,
  dockSphere,
  loosenSphere,
  moveLooseSphere,
  removeSphere,
  reorderDocked,
  spheresSnapshot,
  sphereEntry,
  sphereIdOf,
  subscribeSpheres,
  type SpheresDoc,
  type SphereNavEntry,
} from "../../state/homeSpheres.js";
import { byCategory, NAV_CATEGORIES } from "../../state/navigation.js";
import { openTab } from "../../state/explorer.js";
import { IconMore, IconTrash, IconX } from "../Icons.js";

const DRAG_THRESHOLD = 8; // px，超过才算拖（点一下仍是打开/收起）

/** NAV 的 icon 签名是 (p: object) => ReactNode，包一层拿到带尺寸的组件 */
function SphereIcon({ entry, size }: { entry: SphereNavEntry; size: number }): ReactNode {
  const Icon = entry.icon as (p: { width?: number; height?: number }) => ReactNode;
  return <Icon width={size} height={size} />;
}

/** 一颗球（圆 logo + 底下名字） */
function Sphere({
  entry,
  isDragging,
  size = "md",
}: {
  entry: SphereNavEntry;
  onPointerDown?: (e: React.PointerEvent) => void;
  isDragging?: boolean;
  size?: "md" | "lg";
}) {
  return (
    <button
      type="button"
      className={"sphere" + (size === "lg" ? " sphere-lg" : "") + (isDragging ? " is-dragging" : "")}
      data-sphere-id={sphereIdOf(entry)}
      title={entry.label}
    >
      <span className="sphere-ball">
        <SphereIcon entry={entry} size={size === "lg" ? 24 : 20} />
      </span>
      <span className="sphere-name">{entry.label}</span>
    </button>
  );
}

export function HomeSpheres(): ReactNode {
  const doc: SpheresDoc = useSyncExternalStore(subscribeSpheres, spheresSnapshot, spheresSnapshot);
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null); // 首页内容区（loose 百分比坐标的参照）
  const winRef = useRef<HTMLDivElement | null>(null); // 展开的小窗
  const trashRef = useRef<HTMLDivElement | null>(null);

  /** 拖拽态：id + 起点 + 当前指针 + 是否已过阈值；ghost 直接复用原球元素加 .is-dragging（跟手用 fixed 定位副本） */
  const [drag, setDrag] = useState<{
    id: string;
    from: "dock" | "loose";
    index: number;
    x: number;
    y: number;
    moved: boolean;
    grabDx: number;
    grabDy: number;
  } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;

  const startDrag = useCallback(
    (e: React.PointerEvent, id: string, from: "dock" | "loose", index: number) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const el = e.currentTarget as HTMLElement;
      const r = el.getBoundingClientRect();
      setDrag({
        id,
        from,
        index,
        x: e.clientX,
        y: e.clientY,
        moved: false,
        grabDx: e.clientX - r.left - r.width / 2,
        grabDy: e.clientY - r.top - r.height / 2,
      });
    },
    [],
  );

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent): void => {
      const d = dragRef.current;
      if (!d) return;
      const moved = d.moved || Math.hypot(e.clientX - d.x, e.clientY - d.y) > DRAG_THRESHOLD;
      setDrag({ ...d, x: e.clientX, y: e.clientY, moved });
    };
    const onUp = (e: PointerEvent): void => {
      const d = dragRef.current;
      setDrag(null);
      if (!d) return;
      if (!d.moved) {
        // 原地松手 = 点击：打开对应页
        const entry = sphereEntry(d.id);
        if (entry) openTab(entry.page, null, { title: entry.label });
        setOpen(false);
        return;
      }
      // 命中测试：垃圾桶 > 小窗内重排 > 拖出/挪位
      const t = trashRef.current?.getBoundingClientRect();
      if (t && e.clientX >= t.left && e.clientX <= t.right && e.clientY >= t.top && e.clientY <= t.bottom) {
        removeSphere(d.id);
        return;
      }
      const win = winRef.current?.getBoundingClientRect();
      const inWin = win && e.clientX >= win.left && e.clientX <= win.right && e.clientY >= win.top && e.clientY <= win.bottom;
      if (d.from === "dock") {
        if (inWin && !detail) {
          // 小窗内换位：找最近的球槽位
          const balls = Array.from(winRef.current?.querySelectorAll<HTMLElement>("[data-sphere-id]") ?? []);
          let best = d.index;
          let bestDist = Infinity;
          balls.forEach((b, i) => {
            const r = b.getBoundingClientRect();
            const dist = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
            if (dist < bestDist) {
              bestDist = dist;
              best = i;
            }
          });
          reorderDocked(d.index, best);
        } else {
          // 拖出小窗 → 落到白板（相对首页内容区的百分比坐标）
          const root = rootRef.current?.getBoundingClientRect();
          if (root) {
            const x = Math.min(96, Math.max(0, ((e.clientX - root.left) / root.width) * 100));
            const y = Math.min(96, Math.max(0, ((e.clientY - root.top) / root.height) * 100));
            loosenSphere(d.id, { x, y });
          }
        }
      } else {
        const root = rootRef.current?.getBoundingClientRect();
        if (root) {
          const x = Math.min(96, Math.max(0, ((e.clientX - root.left) / root.width) * 100));
          const y = Math.min(96, Math.max(0, ((e.clientY - root.top) / root.height) * 100));
          moveLooseSphere(d.id, { x, y });
        }
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag, detail]);

  const dockedEntries: SphereNavEntry[] = doc.docked
    .map((id) => sphereEntry(id))
    .filter((e): e is SphereNavEntry => e !== null);
  const draggedEntry = drag ? sphereEntry(drag.id) : null;

  /** 更多功能弹窗里：未停靠的一级页（已停靠/外置的标已加） */
  const dockedSet = new Set(doc.docked);
  const looseSet = new Set(doc.loose.map((s) => s.id));

  return (
    <div className="hs-root" ref={rootRef}>
      {/* 外置球层：绝对定位在首页内容区上，pointer 命中只落在球本身 */}
      {doc.loose.map((s) => {
        const entry = sphereEntry(s.id);
        if (!entry) return null;
        const isDrag = drag?.id === s.id && drag.moved;
        return (
          <div
            key={s.id}
            className="hs-loose-slot"
            style={{ left: s.pos.x + "%", top: s.pos.y + "%" }}
          >
            <div
              onPointerDown={(e) => startDrag(e, s.id, "loose", -1)}
              style={isDrag ? { opacity: 0.35 } : undefined}
            >
              <Sphere entry={entry} size="lg" />
            </div>
          </div>
        );
      })}

      {/* 右上角锚点：sticky 挂在首页滚动流顶部，随滚动保持可见 */}
      <div className="hs-anchor-row">
        <button
          type="button"
          className={"hs-logo" + (open ? " is-open" : "")}
          aria-expanded={open}
          aria-label="功能目录"
          title={open ? "收起功能目录" : "展开功能目录"}
          onClick={() => setOpen((o) => !o)}
        >
          <IconMore width={20} height={20} />
        </button>
      </div>

      {/* 展开的小窗：transform-origin 右上 → 向左下展开 */}
      {open ? (
        <div className={"hs-window" + (detail ? " is-detail" : "")} ref={winRef} role="dialog" aria-label="功能目录">
          <div className="hs-window-head">
            <button
              type="button"
              className={"hs-detail-btn" + (detail ? " is-on" : "")}
              aria-pressed={detail}
              title={detail ? "回到球阵" : "详情：完整功能目录"}
              onClick={() => setDetail((d) => !d)}
            >
              <IconMore width={14} height={14} />
              <span>详情</span>
            </button>
            <span className="hs-window-title">{detail ? "功能目录 · 全部" : "功能目录"}</span>
            <button type="button" className="hs-close" aria-label="收起" onClick={() => setOpen(false)}>
              <IconX width={14} height={14} />
            </button>
          </div>

          {detail ? (
            /* 详情模式：原首页目录卡的分组列表原样搬进小窗 */
            <div className="hs-detail-body">
              {NAV_CATEGORIES.map((cat) => {
                const entries = byCategory(cat);
                if (entries.length === 0) return null;
                return (
                  <div key={cat} className="hs-detail-group">
                    <div className="hs-detail-group-name">{cat}</div>
                    {entries.map((e) => (
                      <button
                        key={e.id}
                        type="button"
                        className="hs-detail-row"
                        title={e.note ? e.name + "：" + e.note : e.name}
                        onClick={() => {
                          openTab(e.page, e.params, { title: e.name });
                          setOpen(false);
                        }}
                      >
                        <span>{e.name}</span>
                        <IconMore width={12} height={12} className="hs-detail-caret" />
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="hs-grid">
              {dockedEntries.map((entry, i) => (
                <div
                  key={sphereIdOf(entry)}
                  onPointerDown={(e) => startDrag(e, sphereIdOf(entry), "dock", i)}
                  style={drag?.id === sphereIdOf(entry) && drag.moved ? { opacity: 0.35 } : undefined}
                >
                  <Sphere entry={entry} />
                </div>
              ))}
              {/* 更多功能球（常驻末位，不可拖） */}
              <button
                type="button"
                className="sphere sphere-more"
                title="更多功能：全部一级页面"
                onClick={() => setMoreOpen(true)}
              >
                <span className="sphere-ball is-accent">
                  <IconMore width={20} height={20} />
                </span>
                <span className="sphere-name">更多</span>
              </button>
            </div>
          )}
        </div>
      ) : null}

      {/* 拖动中的幽灵球（跟手） */}
      {drag?.moved && draggedEntry ? (
        <div className="hs-ghost" style={{ left: drag.x - drag.grabDx, top: drag.y - drag.grabDy }}>
          <span className="sphere-ball">
            <SphereIcon entry={draggedEntry} size={22} />
          </span>
        </div>
      ) : null}

      {/* 红色垃圾桶：任何拖动过程出现（拖入即删） */}
      {drag?.moved ? (
        <div className="hs-trash" ref={trashRef} aria-label="拖到这里删除">
          <IconTrash width={22} height={22} />
          <span>删除</span>
        </div>
      ) : null}

      {/* 更多功能弹窗：全部一级页 */}
      {moreOpen
        ? createPortal(
            <div className="hs-more-mask" onClick={() => setMoreOpen(false)}>
              <div className="hs-more" role="dialog" aria-label="更多功能" onClick={(e) => e.stopPropagation()}>
                <div className="hs-more-head">
                  <span>全部功能</span>
                  <button type="button" className="hs-close" aria-label="关闭" onClick={() => setMoreOpen(false)}>
                    <IconX width={14} height={14} />
                  </button>
                </div>
                <div className="hs-more-list">
                  {allSphereEntries().map((entry) => {
                    const id = sphereIdOf(entry);
                    const placed = dockedSet.has(id) || looseSet.has(id);
                    return (
                      <div key={id} className="hs-more-row">
                        <button
                          type="button"
                          className="hs-more-go"
                          title={entry.label}
                          onClick={() => {
                            openTab(entry.page, null, { title: entry.label });
                            setMoreOpen(false);
                            setOpen(false);
                          }}
                        >
                          <span className="sphere-ball is-sm">
                            <SphereIcon entry={entry} size={16} />
                          </span>
                          <span className="hs-more-name">{entry.label}</span>
                        </button>
                        <button
                          type="button"
                          className="hs-more-add"
                          title={placed ? "已在外面的球阵里" : "加进首页球阵"}
                          disabled={placed}
                          onClick={() => dockSphere(id)}
                        >
                          {placed ? "已加" : "加上"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
