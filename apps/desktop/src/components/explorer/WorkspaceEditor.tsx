import { t as i18n, rich as i18nRich, useLocale as useUiLocale } from "../../i18n/index.js";
import { Input, Text } from "@onethu/gui";
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
  const uiLocale = useUiLocale();

  const id = useSyncExternalStore(subscribe, snapshot, snapshot);
  const { workspaces } = useExplorerState();
  const ws = id ? workspaces.find((w) => w.id === id) ?? null : null;
  if (!id || !ws) return null;
  return <WorkspaceEditorDialog key={ws.id} wsId={ws.id} />;
}

function WorkspaceEditorDialog({ wsId }: { wsId: string }): ReactNode {
  const uiLocale = useUiLocale();

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
      style={{ position: "fixed", inset: 0, zIndex: "var(--og-z-modal)" as unknown as number, background: "var(--og-scrim)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) closeWorkspaceEditor();
      }}
    >
      <div
        role="dialog"
        aria-label={i18n("components.explorer.workspaceeditor.8777428f135c")}
        style={{ background: "var(--og-surface-overlay)", color: "var(--og-content-1)", borderRadius: "var(--og-radius-xl)", padding: 18, width: 340, maxHeight: "80vh", overflow: "auto", boxShadow: "var(--og-elev-menu)" }}
      >
        <div style={{ marginBottom: 12 }}><Text as="div" weight="semibold">{i18n("components.explorer.workspaceeditor.8777428f135c")}</Text></div>
        <Input autoFocus value={name} onChange={(value) => setName(value)} placeholder={i18n("components.explorer.workspaceeditor.b2a947fe366c")} />
        <div style={small}>{i18n("components.explorer.workspaceeditor.126e112774d5")}</div>
        <div style={{ display: "flex", gap: 8 }}>
          {WORKSPACE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={i18n("components.explorer.workspaceeditor.4b8b25735e9b") + c}
              aria-pressed={color === c}
              onClick={() => setColor(c)}
              style={{ width: 22, height: 22, borderRadius: "50%", border: color === c ? "2px solid var(--og-content-1)" : "1px solid transparent", background: c, cursor: "pointer" }}
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
                style={{ width: 30, height: 30, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 8, border: icon === k ? "2px solid var(--og-content-1)" : "1px solid var(--og-line-2)", background: "transparent", cursor: "pointer" }}
              >
                <G width={14} height={14} />
              </button>
            );
          })}
        </div>

        <div style={small}>{i18nRich("components.explorer.workspaceeditor.95d820310c3e", { memberCount: memberCount })}</div>
        {memberCount === 0 ? <Text slot="label" tone="faint">{i18n("components.explorer.workspaceeditor.5d8f0c9f8493")}</Text> : null}
        {live
          ? liveMembers.map((t) => (
              <div key={t.id} style={row}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{resolveTabTitle(t.page, t.params).label}</span>
                <Btn variant="outline" onClick={() => setTabWorkspace(t.id, null)}>{i18n("components.explorer.workspaceeditor.95861c4b5cd6")}</Btn>
              </div>
            ))
          : snapshot.map((e, i) => (
              <div key={i} style={row}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.title || resolveTabTitle(e.page, e.params).label}</span>
                <Btn variant="outline" onClick={() => removeSavedWorkspaceTab(ws.id, i)}>{i18n("components.explorer.workspaceeditor.95861c4b5cd6")}</Btn>
              </div>
            ))}

        {free.length > 0 ? (
          <>
            <div style={small}>{i18n("components.explorer.workspaceeditor.7a593e8801f2")}</div>
            {free.map((t) => (
              <div key={t.id} style={row}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{resolveTabTitle(t.page, t.params).label}</span>
                <Btn variant="outline" onClick={() =>
                    live
                      ? setTabWorkspace(t.id, ws.id)
                      : addSavedWorkspaceTab(ws.id, { page: t.page, params: t.params, title: resolveTabTitle(t.page, t.params).label })
                  }>{i18n("components.explorer.workspaceeditor.451755e3831f")}</Btn>
              </div>
            ))}
          </>
        ) : null}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <Btn variant="outline" onClick={closeWorkspaceEditor}>{i18n("components.explorer.workspaceeditor.2cd0f3be8738")}</Btn>
          <Btn variant="outline" onClick={save}>{i18n("components.explorer.workspaceeditor.a3030bf8f16d")}</Btn>
        </div>
      </div>
    </div>,
    document.body,
  );
}
