import { Btn } from "@onethu/gui";
/**
 * OnePage 列表页（P2，方案 §7.9；2026-10-13 起话语从「收藏夹」切换为 OnePage）：多块白板的入口。
 *
 * 每项长按/右键菜单：作为今日页 / 上移 / 下移 / 删除（标红）；系统板不可删。
 * 点击一项 = 把它设为当前主页并进入白板页（v1 的「进入某个收藏夹」就这样表达）。
 */
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Card, Empty, PageHead } from "../components/Layout.js";
import { useContextMenu, type CtxItem } from "../components/ContextMenu.js";
import { loadBoard, saveBoard, type BoardDoc } from "../state/board.js";
import { boardSummary, createBoard, deleteBoard, moveBoard, setActiveBoard } from "../state/boardOps.js";
import { useApp } from "../state/context.js";

export function BoardListPage(): ReactNode {
  const { navigate } = useApp();
  const menu = useContextMenu();
  const [doc, setDoc] = useState<BoardDoc>(() => loadBoard());
  const [note, setNote] = useState<string | null>(null);
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
        if (r.reason) say(r.reason === "system-board" ? "系统板不能删除" : "至少保留一块 OnePage");
        else { apply(r.doc); say("已删除：" + name); }
      } },
    ];
    menu.open({ x, y, title: name, items });
  };

  return (
    <>
      <PageHead title="OnePage" meta="每一块都是一张可随意摆放组件的白板" />
      {rows.length === 0 ? (
        <Card>
          <Empty text="还没有 OnePage。新建一块，把常用的组件摆上去。" />
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
        <Btn variant="outline" onClick={() => {
            const r = createBoard(doc, "新 OnePage " + String(rows.length));
            apply(r.doc);
            say("已新建：" + r.board.name);
          }}>新建收藏夹
        </Btn>
      </div>

      {note ? <div className="board-note" role="status">{note}</div> : null}
    </>
  );
}
