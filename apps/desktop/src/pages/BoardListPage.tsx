/**
 * 收藏夹列表页（P2，方案 §7.9）：多块白板的入口。
 *
 * 每项长按/右键菜单：作为今日页 / 上移 / 下移 / 删除（标红）；系统板不可删。
 * 点击一项 = 把它设为当前主页并进入白板页（v1 的「进入某个收藏夹」就这样表达）。
 */
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Card, Empty, PageHead } from "../components/Layout.js";
import { useContextMenu, type CtxItem } from "../components/ContextMenu.js";
import { loadBoard, saveBoard, type BoardDoc } from "../state/board.js";
import { boardSummary, createBoard, deleteBoard, moveBoard, setActiveBoard } from "../state/boardOps.js";
import { addBoardSlot, loadNavPrefs, moveSlot, resolveSlots, saveNavPrefs, setSlotHidden, MINE_SLOT_ID, type NavPrefs } from "../state/navPrefs.js";
import { useApp } from "../state/context.js";

export function BoardListPage(): ReactNode {
  const { navigate } = useApp();
  const menu = useContextMenu();
  const [doc, setDoc] = useState<BoardDoc>(() => loadBoard());
  const [note, setNote] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [prefs, setPrefs] = useState<NavPrefs>(() => loadNavPrefs());
  const applyPrefs = useCallback((next: NavPrefs): void => { setPrefs(next); saveNavPrefs(next); }, []);
  const rows = useMemo(() => boardSummary(doc), [doc]);

  const say = (text: string): void => {
    setNote(text);
    window.setTimeout(() => setNote(null), 1800);
  };
  const apply = useCallback((next: BoardDoc): void => {
    setDoc(next);
    saveBoard(next);
  }, []);

  const openMenu = (id: string, name: string, x: number, y: number, isSystem: boolean): void => {
    const items: CtxItem[] = [
      { key: "as-today", label: "作为今日页", onSelect: () => { apply(setActiveBoard(doc, id)); say("已设为今日页：" + name); } },
      { key: "up", label: "上移", onSelect: () => apply(moveBoard(doc, id, "up")) },
      { key: "down", label: "下移", onSelect: () => apply(moveBoard(doc, id, "down")) },
      { key: "remove", label: "删除", danger: true, disabled: isSystem, onSelect: () => {
        const r = deleteBoard(doc, id);
        if (r.reason) say(r.reason === "system-board" ? "系统板不能删除" : "至少保留一块收藏夹");
        else { apply(r.doc); say("已删除：" + name); }
      } },
    ];
    menu.open({ x, y, title: name, items });
  };

  return (
    <>
      <PageHead title="收藏夹" meta="每块收藏夹都是一张白板，可以随意摆放组件" />
      {rows.length === 0 ? (
        <Card>
          <Empty text="还没有收藏夹。新建一块，把常用的组件摆上去。" />
        </Card>
      ) : (
        <div className="board-list" data-boards={String(rows.length)}>
          {rows.map((b) => (
            <button
              key={b.id}
              type="button"
              className={"board-list-row" + (b.active ? " is-active" : "")}
              data-board-id={b.id}
              onClick={() => { apply(setActiveBoard(doc, b.id)); navigate("board"); }}
              onContextMenu={(e) => { e.preventDefault(); openMenu(b.id, b.name, e.clientX, e.clientY, b.kind === "system"); }}
            >
              <span className="board-list-name">{b.name}</span>
              <span className="board-list-meta">
                {b.kind === "system" ? "系统板" : "自定义"} · {b.count} 个组件{b.active ? " · 当前今日页" : ""}
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="board-list-actions">
        <button
          className="btn"
          onClick={() => {
            const r = createBoard(doc, "新收藏夹 " + String(rows.length));
            apply(r.doc);
            say("已新建：" + r.board.name);
          }}
        >
          新建收藏夹
        </button>
        <button className="btn" onClick={() => setNavOpen(true)}>编辑导航栏</button>
      </div>

      {navOpen ? (
        <div className="board-sheet" role="dialog" aria-label="编辑导航栏">
          <div className="board-sheet-head">
            <span className="board-sheet-title">编辑导航栏</span>
            <button className="btn" onClick={() => setNavOpen(false)}>关闭</button>
          </div>
          <div className="board-sheet-list">
            {resolveSlots(prefs).map((slot, i) => (
              <div key={slot.id} className="nav-edit-row" data-nav-slot={slot.id}>
                <span className="nav-edit-name">{slot.label}{slot.id === MINE_SLOT_ID ? "（固定）" : ""}</span>
                <button type="button" className="btn" disabled={i === 0} onClick={() => applyPrefs(moveSlot(prefs, slot.id, "left"))}>←</button>
                <button type="button" className="btn" disabled={i === resolveSlots(prefs).length - 1} onClick={() => applyPrefs(moveSlot(prefs, slot.id, "right"))}>→</button>
                <button
                  type="button"
                  className="btn"
                  disabled={slot.id === MINE_SLOT_ID}
                  onClick={() => applyPrefs(setSlotHidden(prefs, slot.id, !slot.hidden))}
                >
                  {slot.hidden ? "显示" : "隐藏"}
                </button>
              </div>
            ))}
          </div>
          {rows.filter((b) => b.kind === "user" && !resolveSlots(prefs).some((s) => s.boardId === b.id)).length ? (
            <div className="board-sheet-list">
              <div className="board-sheet-title">把收藏夹放进导航栏</div>
              {rows.filter((b) => b.kind === "user" && !resolveSlots(prefs).some((s) => s.boardId === b.id)).map((b) => (
                <button
                  key={b.id}
                  type="button"
                  className="board-sheet-row"
                  data-nav-add={b.id}
                  onClick={() => { applyPrefs(addBoardSlot(prefs, b.id, b.name, b.icon)); say("已放进导航栏：" + b.name); }}
                >
                  <span className="board-sheet-row-title">{b.name}</span>
                  <span className="board-sheet-row-desc">作为底栏入口，点击直达这块板</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {note ? <div className="board-note" role="status">{note}</div> : null}
    </>
  );
}
