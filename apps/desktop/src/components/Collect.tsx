import { Input } from "@onethu/gui";
import { Btn } from "@onethu/gui";
/**
 * 收藏星标 + 收藏弹层 + 收藏项搜索添加弹层（万物收藏项化 UI 件）。
 * - CollectStar：行尾/卡头星标按钮，点亮态 = 已收进任意用户收藏夹；
 *   点击弹「收藏到…」多选弹层（可当场新建收藏夹），再点即取消。
 * - AtomPickerModal：收藏夹页「添加」按钮的搜索栏——搜功能页面/今日组件/
 *   本机已见过的实体收藏项（课程/作业/文件/通知/新闻/楼栋/场馆…），
 *   搜索只查静态注册表 + 本机缓存，绝不主动请求校内服务。
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useExitPhase } from "../lib/useExitPhase.js";
import { Empty } from "./Layout.js";
import { IconChevron, IconFolderPlus, IconSearch, IconStar } from "./Icons.js";
import { useFavs } from "../state/favs.js";
import { atomKeyOf } from "../state/favorites.js";
import { createOnePageForAtom, onePagesWithAtom, removeOnePage } from "../state/onePage.js";
import { pageAtomRef, resolveAtom, searchAtoms, tabAtomKey, type AtomHit } from "../state/atoms.js";
import { confirmOk } from "../lib/confirm.js";
import type { AtomRef } from "../state/favorites.js";

/** 星标按钮（2026-10-13 起 = OnePage 一星，统一走白板；旧的「收藏到…多选收藏夹」弹层随旧体系退役） */
export function CollectStar({ atom, title }: { atom: AtomRef; title?: string }) {
  const view = resolveAtom(atom);
  const { lit, toggle } = useOnePageStar(atom, view?.title ?? title ?? "OnePage", view?.sub ?? title ?? "");
  return (
    <button
      type="button"
      className={"collect-star" + (lit ? " is-on" : "")}
      aria-label={(lit ? "已收藏为 OnePage，点击取消" : "收藏为 OnePage") + (title ? "：" + title : "")}
      title={lit ? "已收藏 · 点击取消" : "收藏为 OnePage"}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        void toggle();
      }}
    >
      <IconStar width={14} height={14} />
    </button>
  );
}

/** 「收藏到…」弹层：多选收藏夹 + 当场新建 */
/**
 * 一星 OnePage（页头 / 标签共用语义，用户定案 2026-10-12）：
 * - 未收录 → 新建以名字命名的独立 OnePage，并把该原子放进去；
 * - 已收录 → 先用应用内确认弹窗（window.confirm 在 Tauri 下静默 false，不可用）再删除该 OnePage 本体。
 */
export function useOnePageStar(ref: AtomRef | null, name: string, full: string): { lit: boolean; toggle: () => Promise<void> } {
  const key = ref ? atomKeyOf(ref) : null;
  const [tick, setTick] = useState(0);
  /* 板文档没有订阅器：听全局变更事件 + 手动 bump（星标是低频操作，够用） */
  useEffect(() => {
    const on = (): void => setTick((t) => t + 1);
    window.addEventListener("onethu.boards.changed", on);
    return () => window.removeEventListener("onethu.boards.changed", on);
  }, []);
  const board = key ? onePagesWithAtom(key)[0] : undefined;
  void tick;
  const toggle = async (): Promise<void> => {
    if (!ref || !key) return;
    if (!board) {
      createOnePageForAtom(name, key);
      return;
    }
    const ok = await confirmOk(
      `确定删除 OnePage「${name}」（${full}）？\n这块白板和其中的内容都会永久消失！`,
    );
    if (ok) removeOnePage(board.id);
  };
  return { lit: board !== undefined, toggle };
}

/** 一星按钮：点亮 = 已有独立 OnePage 收录该页 */
export function OnePageStar({ atom, name, full, title }: { atom: AtomRef | null; name: string; full: string; title?: string }) {
  const { lit, toggle } = useOnePageStar(atom, name, full);
  if (!atom) return null;
  return (
    <button
      type="button"
      className={"collect-star" + (lit ? " is-on" : "")}
      aria-label={(lit ? "取消星标" : "收藏为 OnePage") + (title ? "：" + title : "")}
      aria-pressed={lit}
      title={lit ? "取消星标：删除该 OnePage" : "一星：把当前页面收藏成 OnePage"}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        void toggle();
      }}
    >
      <IconStar width={14} height={14} />
    </button>
  );
}

/** 页头页面收藏项星标（一级页面本体）：key 命中 PAGE_ATOMS 才渲染 */
export function PageAtomStar({ atomKey, title }: { atomKey: string; title: string }) {
  const ref = pageAtomRef(atomKey);
  const view = ref ? resolveAtom(ref) : null;
  if (!ref) return null;
  return <OnePageStar atom={ref} name={view?.title ?? title} full={view?.sub ?? title} title={title} />;
}

/** 一级页面（无具体子栏目参数）的页头星标：收藏的是页面本体，不是当前子栏目 */
export function RootPageStar({ page, title }: { page: string; title: string }) {
  const ref: AtomRef = { kind: "tab", key: tabAtomKey(page) };
  return <OnePageStar atom={ref} name={title} full={title} title={title} />;
}

export function CollectModal({ atom, onClose }: { atom: AtomRef; onClose: () => void }) {
  const favs = useFavs();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const view = resolveAtom(atom);
  const roots = favs.data.order;
  /* 全树行：根收藏夹常显，子层折叠展开（收藏时可直达任意层；深度由建夹侧 FAVS_MAX_DEPTH 限制） */
  const parentOf = new Map<string, string | null>();
  /* 子收藏夹 id 只在 folders 平铺表（挂在父夹 items 里），不在 order——遍历必须走 folders */
  for (const id of Object.keys(favs.data.folders)) {
    const f = favs.data.folders[id]!;
    if (!parentOf.has(id)) parentOf.set(id, null);
    for (const it of f.items) if (it.t === "f") parentOf.set(it.id, id);
  }
  /* 初始展开：已收藏该收藏项的路径（一眼看到它现在在哪个子夹里），其余默认折叠 */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => {
    const seed = new Set<string>();
    for (const [id, f] of Object.entries(favs.data.folders)) {
      if (!f.items.some((it) => it.t === "a" && it.atom.kind === atom.kind && it.atom.key === atom.key)) continue;
      let cur = parentOf.get(id) ?? null;
      while (cur) {
        seed.add(cur);
        cur = parentOf.get(cur) ?? null;
      }
    }
    return seed;
  });
  const toggleExpand = (id: string): void =>
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const childrenOf = (pid: string | null): string[] =>
    pid === null
      ? favs.data.order.filter((id) => (parentOf.get(id) ?? null) === null)
      : Object.keys(favs.data.folders)
          .filter((id) => parentOf.get(id) === pid)
          .sort((a, b) => (favs.data.folders[a]!.createdAt || 0) - (favs.data.folders[b]!.createdAt || 0));
  const treeRows: ReactNode[] = [];
  const walk = (pid: string | null, depth: number): void => {
    for (const id of childrenOf(pid)) {
      const f = favs.data.folders[id];
      if (!f) continue;
      const kids = childrenOf(id);
      const checked = f.items.some((it) => it.t === "a" && it.atom.kind === atom.kind && it.atom.key === atom.key);
      const open = expanded.has(id);
      treeRows.push(
        <label key={id} className="collect-row" style={depth > 0 ? { paddingLeft: 14 + depth * 18 } : undefined}>
          {kids.length > 0 ? (
            <button
              type="button"
              className="collect-fold"
              aria-label={open ? "收起子收藏夹" : "展开子收藏夹"}
              aria-expanded={open}
              onClick={(e) => {
                /* 在 label 内点折叠钮：拦掉 label 默认行为，避免顺带勾选/取消勾选 */
                e.preventDefault();
                e.stopPropagation();
                toggleExpand(id);
              }}
            >
              <IconChevron width={12} height={12} style={{ transform: open ? undefined : "rotate(-90deg)" }} />
            </button>
          ) : (
            <span className="collect-fold-spacer" aria-hidden />
          )}
          <input
            type="checkbox"
            checked={checked}
            onChange={() => favs.toggleAtomIn(id, atom)}
          />
          <span className="collect-row-icon"><IconFolderPlus width={15} height={15} style={{ opacity: 0.5 }} /></span>
          <span className="collect-row-text">
            <span className="collect-row-title">{f.title}</span>
            <span className="collect-row-sub">{f.items.length} 项</span>
          </span>
        </label>,
      );
      if (open) walk(id, depth + 1);
    }
  };
  walk(null, 0);

  const [closing, requestClose] = useExitPhase(onClose);
  useEffect(() => {
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const createAndAdd = () => {
    const id = favs.create(name, null);
    if (id) {
      favs.toggleAtomIn(id, atom);
      setName("");
      setCreating(false);
    }
  };

  return createPortal(
    <div className={"home-modal-mask" + (closing ? " is-closing" : "")} onClick={requestClose}>
      <div className={"home-modal collect-modal" + (closing ? " is-closing" : "")} role="dialog" aria-modal="true" aria-label="收藏到收藏夹" onClick={(e) => e.stopPropagation()}>
        <div className="home-modal-head">
          <h3>收藏到…</h3>
          <Btn variant="ghost" onClick={requestClose}>关闭</Btn>
        </div>
        <div className="home-modal-body">
          <div className="home-modal-hint">
            「{view?.title ?? "收藏项"}」可同时收进多个收藏夹；收藏夹只是跳转入口，原功能始终锚定在默认页面。
          </div>
          {roots.length === 0 && !creating ? (
            <Empty text="还没有收藏夹——在左侧栏「新建收藏夹」，或点下方直接建一个。" />
          ) : (
            treeRows
          )}
          {creating ? (
            <div className="collect-new">
              <Input autoFocus placeholder="收藏夹名称…" value={name} onChange={(value) => setName(value)} onKeyDown={(e) => {
                  if (e.key === "Enter") createAndAdd();
                  if (e.key === "Escape") setCreating(false);
                }} />
              <Btn variant="solid" tone="brand" disabled={!name.trim()} onClick={createAndAdd}>建并收藏</Btn>
              <Btn variant="ghost" onClick={() => setCreating(false)}>取消</Btn>
            </div>
          ) : (
            <Btn variant="outline" onClick={() => setCreating(true)}><IconFolderPlus width={14} height={14} />新建收藏夹
            </Btn>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** 收藏项搜索添加弹层（收藏夹页「添加」） */
export function AtomPickerModal({ onPick, onClose, title = "添加到收藏夹", hint }: {
  onPick: (atom: AtomRef) => void;
  onClose: () => void;
  /** 标题与说明可覆盖：收藏夹「添加收藏项」与小组件「选一个收藏项」共用同一个搜索层 */
  title?: string;
  hint?: string;
}) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<AtomRef | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo<AtomHit[]>(() => searchAtoms(q), [q]);

  const [closing, requestClose] = useExitPhase(onClose);
  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className={"home-modal-mask" + (closing ? " is-closing" : "")} onClick={requestClose}>
      <div className={"home-modal collect-modal" + (closing ? " is-closing" : "")} role="dialog" aria-modal="true" aria-label="搜索并添加收藏项" onClick={(e) => e.stopPropagation()}>
        <div className="home-modal-head">
          <h3>{title}</h3>
          <Btn variant="ghost" onClick={requestClose}>关闭</Btn>
        </div>
        <div className="home-modal-body">
          <div className="collect-search">
            <IconSearch width={15} height={15} />
            <input
              ref={inputRef}
              className="input"
              placeholder="搜索任意收藏项：页面 / 组件 / 课程 / 作业 / 新闻 / 楼栋 / 场馆…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          {q.trim() === "" ? (
            <div className="home-modal-hint">
              {hint ? <>{hint}<br /></> : null}
              支持搜索：全部功能页面与今日组件；本机已见过的实体（课程、作业、文件、通知、新闻、洗衣机楼栋、教学楼、体育场馆、研讨间类型、图书馆）——先打开过对应页面，具体实体才会进入搜索。
            </div>
          ) : results.length === 0 ? (
            <Empty
              text="没有匹配的收藏项——试试更短的关键词，或先去对应页面打开一次。"
              action={<Btn variant="ghost" onClick={() => setQ("")}>清空关键词</Btn>}
            />
          ) : (
            results.map((h) => {
              const Icon = h.icon;
              return (
                <button
                  key={h.kind + "|" + h.key}
                  className={"home-modal-row collect-hit" + (picked && picked.kind === h.kind && picked.key === h.key ? " is-picked" : "")}
                  onClick={() => {
                    setPicked({ kind: h.kind, key: h.key });
                    onPick({ kind: h.kind, key: h.key });
                  }}
                >
                  <span className="home-entry-icon"><Icon width={17} height={17} /></span>
                  <div className="home-modal-text">
                    <div className="home-entry-name">{h.title}</div>
                    {h.sub ? <div className="home-entry-hint">{h.sub}</div> : null}
                  </div>
                  <span className="collect-hit-group">{h.group}</span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
