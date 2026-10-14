import { Btn } from "@onethu/gui";
/**
 * 工作区编辑弹窗：名字 / 颜色 / logo / 内容（成员增删）。
 * 入口：标签栏工作区底板右键「编辑工作区」、OneGO 工作区列表的「编辑」。
 * 成员 = 标签的 workspaceId 归属；移出即退组（标签本身保留），与「关闭标签」规则一致。
 */
import { useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { addSavedWorkspaceTab, patchLiveWorkspace, removeSavedWorkspaceTab, setTabWorkspace, useExplorerState, WORKSPACE_COLORS, WORKSPACE_ICONS } from "../../state/explorer.js";
import { resolveTabTitle } from "../../state/tabTitles.js";
import { WS_ICON_GLYPH } from "./TabStrip.js";
import { IconFolder } from "../Icons.js";

let editingId: string | null = null;
const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach((f) => f());
const subscribe = (f: () => void): (() => void) => {
  listeners.add(f);
  return () => listeners.delete(f);
};
const snapshot = (): string | null => editingId;

export function openWorkspaceEditor(id: string): void {
  editingId = id;
  emit();
}

export function closeWorkspaceEditor(): void {
  if (editingId === null) return;
  editingId = null;
  emit();
}

export function WorkspaceEditorHost(): ReactNode {
  const id = useSyncExternalStore(subscribe, snapshot, snapshot);
  const { workspaces } = useExplorerState();
  const ws = id ? workspaces.find((w) => w.id === id) ?? null : null;
  if (!id || !ws) return null;
  return <WorkspaceEditorDialog key={ws.id} wsId={ws.id} />;
}

function WorkspaceEditorDialog({ wsId }: { wsId: string }): ReactNode {
  const { workspaces, tabs } = useExplorerState();
  const ws = workspaces.find((w) => w.id === wsId);
  const [name, setName] = useState(ws?.name ?? "");
  const [color, setColor] = useState<string>(ws?.color ?? WORKSPACE_COLORS[0]);
  const [icon, setIcon] = useState<string>(ws?.icon ?? WORKSPACE_ICONS[0]);
  if (!ws) return null;

  // 活工作区：成员 = 实时标签（归属）；已解散/已保存：成员 = 快照（ws.tabs）
  const live = ws.live === true;
  const liveMembers = tabs.filter((t) => t.kind === "page" && t.workspaceId === ws.id);
  const snapshot = ws.tabs;
  const memberCount = live ? liveMembers.length : snapshot.length;
  const free = tabs.filter((t) => t.kind === "page" && t.workspaceId === null);

  const save = (): void => {
    const n = name.trim();
    patchLiveWorkspace(ws.id, { name: n || ws.name, color, icon });
    closeWorkspaceEditor();
  };

  const row: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "4px 0", fontSize: 13 };
  const small: CSSProperties = { fontSize: 12, opacity: 0.7, margin: "10px 0 6px" };

  return createPortal(
    <div
      className="ws-create-mask"
      style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,.25)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) closeWorkspaceEditor();
      }}
    >
      <div
        role="dialog"
        aria-label="编辑工作区"
        style={{ background: "var(--dsw-alias-bg-base, #fff)", color: "var(--dsw-alias-label-primary, inherit)", borderRadius: 14, padding: 18, width: 340, maxHeight: "80vh", overflow: "auto", boxShadow: "0 12px 40px rgba(0,0,0,.25)" }}
      >
        <div style={{ fontWeight: 600, marginBottom: 12 }}>编辑工作区</div>
        <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="工作区名字" style={{ width: "100%" }} />
        <div style={small}>底板颜色</div>
        <div style={{ display: "flex", gap: 8 }}>
          {WORKSPACE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={"颜色 " + c}
              aria-pressed={color === c}
              onClick={() => setColor(c)}
              style={{ width: 22, height: 22, borderRadius: "50%", border: color === c ? "2px solid var(--dsw-alias-label-primary, #000)" : "1px solid transparent", background: c, cursor: "pointer" }}
            />
          ))}
        </div>
        <div style={small}>logo</div>
        <div style={{ display: "flex", gap: 6 }}>
          {WORKSPACE_ICONS.map((k) => {
            const G = WS_ICON_GLYPH[k] ?? IconFolder;
            return (
              <button
                key={k}
                type="button"
                aria-label={"logo " + k}
                aria-pressed={icon === k}
                onClick={() => setIcon(k)}
                style={{ width: 30, height: 30, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 8, border: icon === k ? "2px solid var(--dsw-alias-label-primary, #000)" : "1px solid transparent", background: "transparent", cursor: "pointer" }}
              >
                <G width={14} height={14} />
              </button>
            );
          })}
        </div>

        <div style={small}>成员（{memberCount}）</div>
        {memberCount === 0 ? <div style={{ fontSize: 12, opacity: 0.6 }}>暂无标签页</div> : null}
        {live
          ? liveMembers.map((t) => (
              <div key={t.id} style={row}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{resolveTabTitle(t.page, t.params).label}</span>
                <Btn variant="outline" onClick={() => setTabWorkspace(t.id, null)}>移出</Btn>
              </div>
            ))
          : snapshot.map((e, i) => (
              <div key={i} style={row}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.title || resolveTabTitle(e.page, e.params).label}</span>
                <Btn variant="outline" onClick={() => removeSavedWorkspaceTab(ws.id, i)}>移出</Btn>
              </div>
            ))}

        {free.length > 0 ? (
          <>
            <div style={small}>可加入的标签页</div>
            {free.map((t) => (
              <div key={t.id} style={row}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{resolveTabTitle(t.page, t.params).label}</span>
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    live
                      ? setTabWorkspace(t.id, ws.id)
                      : addSavedWorkspaceTab(ws.id, { page: t.page, params: t.params, title: resolveTabTitle(t.page, t.params).label })
                  }
                >
                  加入
                </button>
              </div>
            ))}
          </>
        ) : null}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <Btn variant="outline" onClick={closeWorkspaceEditor}>取消</Btn>
          <button type="button" className="btn" style={{ borderColor: color, color }} onClick={save}>保存</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
