import { t as i18n, rich as i18nRich, useLocale as useUiLocale, msg as i18nMsg } from "../i18n/index.js";
import { Btn } from "@onethu/gui";
/**
 * OnePage 列表页（P2，方案 §7.9；2026-10-13 起话语从「收藏夹」切换为 OnePage）：多块白板的入口。
 *
 * 每项长按/右键菜单：重命名 / 改图标 / 设为当前 OnePage / 上移 / 下移 / 删除（标红）；系统板不可删。
 * 点击一项 = 把它设为当前板并进入白板页。
 *
 * ⚠️ 2026-10-17 数据丢失修复：这里以前拿挂载时的 doc 快照改完整文档再 saveBoard()，
 * 会覆盖 OneGO / OH / 收藏其他入口刚新建或改名的板。现在一律走 mutateBoards（读最新 doc →
 * 改 → 存 → 广播），并订阅 onethu.boards.changed 保持列表实时。
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Card, Empty, PageHead } from "../components/Layout.js";
import { useContextMenu, type CtxItem } from "../components/ContextMenu.js";
import { loadBoard, type BoardDoc } from "../state/board.js";
import { boardSummary, createBoard, deleteBoard, moveBoard, renameBoard, setActiveBoard } from "../state/boardOps.js";
import { mutateBoards } from "../state/onePage.js";
import { useApp } from "../state/context.js";
import { openFormModal } from "../lib/formModal.js";
import { openFolderIconPicker } from "../components/explorer/FolderIconPicker.js";

export function BoardListPage(): ReactNode {
  const uiLocale = useUiLocale();

  const { navigate } = useApp();
  const menu = useContextMenu();
  const [doc, setDoc] = useState<BoardDoc>(() => loadBoard());
  const [note, setNote] = useState<string | null>(null);
  /* 其他入口（OneGO/OH/收藏）改板后，这份列表不能停在旧快照上。 */
  useEffect(() => {
    const on = (): void => setDoc(loadBoard());
    window.addEventListener("onethu.boards.changed", on);
    return () => window.removeEventListener("onethu.boards.changed", on);
  }, []);
  /* 系统板（「首页」）不是一块 OnePage：首页有自己的入口（顶栏 Logo / 程序坞）。列在这里的话，
     点「首页」会被当成"把首页当白板打开"（用户实测原话：「点击首页回首页，你回的还是旧的一套」）。 */
  const rows = useMemo(() => boardSummary(doc).filter((b) => b.kind !== "system"), [uiLocale, doc]);

  const say = (text: string): void => {
    setNote(text);
    window.setTimeout(() => setNote(null), 1800);
  };

  const rename = async (id: string, name: string): Promise<void> => {
    const f = await openFormModal(i18nMsg("pages.boardlistpage.0c898fe25ba6"), [{ key: "name", label: i18nMsg("pages.boardlistpage.6773310492a9"), required: true, default: name }]);
    if (!f) return;
    mutateBoards((d) => renameBoard(d, id, f.name ?? name));
    say(i18n("pages.boardlistpage.5cb3b8029a6e") + (f.name ?? name));
  };

  const openMenu = (id: string, name: string, x: number, y: number): void => {
    const items: CtxItem[] = [
      { key: "rename", label: i18n("pages.boardlistpage.ec4cd05f5147"), onSelect: () => void rename(id, name) },
      { key: "icon", label: i18n("pages.boardlistpage.9201642820f0"), onSelect: () => openFolderIconPicker(id) },
      { key: "current", label: i18n("pages.boardlistpage.3a32f6df621a"), onSelect: () => { mutateBoards((d) => setActiveBoard(d, id)); say(i18n("pages.boardlistpage.3732febb39ac") + name); } },
      { key: "up", label: i18n("pages.boardlistpage.f853a70b1204"), onSelect: () => mutateBoards((d) => moveBoard(d, id, "up")) },
      { key: "down", label: i18n("pages.boardlistpage.e75e8b4e5c97"), onSelect: () => mutateBoards((d) => moveBoard(d, id, "down")) },
      { key: "remove", label: i18n("pages.boardlistpage.2f9daa828907"), danger: true, onSelect: () => {
        const reason = mutateBoards((d) => {
          const r = deleteBoard(d, id);
          if (r.reason) {
            say(r.reason === "system-board" ? i18n("pages.boardlistpage.fcd1b76ca897") : r.reason === "last-board" ? i18n("pages.boardlistpage.ef42f401cbad") : i18n("pages.boardlistpage.11de1b40f9d8"));
            return null;
          }
          say(i18n("pages.boardlistpage.35ac50715f79") + name);
          return r.doc;
        });
        void reason;
      } },
    ];
    menu.open({ x, y, title: name, items });
  };

  return (
    <>
      <PageHead title="OnePage" meta={i18n("pages.boardlistpage.644bb757108b")} />
      {rows.length === 0 ? (
        <Card>
          <Empty text={i18n("pages.boardlistpage.88e6da1b7129")} />
        </Card>
      ) : (
        <div className="board-list" data-boards={String(rows.length)}>
          {rows.map((b) => (
            <button
              key={b.id}
              type="button"
              className={"board-list-row" + (b.active ? " is-active" : "")}
              data-board-id={b.id}
              onClick={() => { mutateBoards((d) => setActiveBoard(d, b.id)); navigate("board"); }}
              onContextMenu={(e) => { e.preventDefault(); openMenu(b.id, b.name, e.clientX, e.clientY); }}
            >
              <span className="board-list-name">{b.name}</span>
              <span className="board-list-meta">{i18nRich("pages.boardlistpage.00d53679d665", { value: b.kind === "system" ? i18n("pages.boardlistpage.97778650b3ab") : "OnePage", count: b.count, value2: b.active ? i18n("pages.boardlistpage.a983d701044a") : "" })}</span>
            </button>
          ))}
        </div>
      )}
      <div className="board-list-actions">
        <Btn variant="outline" onClick={() => {
            let created = "";
            mutateBoards((d) => {
              const r = createBoard(d, i18n("pages.boardlistpage.9b3dcd2cedd1") + String(rows.length + 1));
              created = r.board.id;
              return r.doc;
            });
            if (created) {
              say(i18n("pages.boardlistpage.3250dd5a9f03"));
              mutateBoards((d) => setActiveBoard(d, created));
              navigate("board");
            }
          }}>{i18n("pages.boardlistpage.8b9db911f1d9")}</Btn>
      </div>

      {note ? <div className="board-note" role="status">{note}</div> : null}
    </>
  );
}
