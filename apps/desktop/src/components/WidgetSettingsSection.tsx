/**
 * 设置页「桌面小组件」区块：决定桌面上那块卡片显示什么。
 *
 * 三个可选内容来源：默认的「今天」（课程与截止）、某个收藏夹、某个收藏原子。
 * 收藏夹页里也能直接设（编辑态工具栏的「上桌面」），两处共写同一份配置
 * （state/widgetSettings.ts），改一处另一处立刻同步。
 *
 * 平台口径：小组件只有 Android 有承载，桌面端明确不做——非 Android 显示一行说明，
 * 不给假开关。
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AtomPickerModal } from "./Collect.js";
import { useFavs } from "../state/favs.js";
import type { FavsData } from "../state/favorites.js";
import { ensureWidgetRuntime } from "../state/notifySources.js";
import { useNotifyBackend } from "./useNotifyBackend.js";
import {
  describeWidgetSource, loadWidgetSettings, saveWidgetSettings, type WidgetSettings,
} from "../state/widgetSettings.js";
import { fetchWidgetStatus } from "../state/widgetBridge.js";
import { resolveAtom } from "../state/atoms.js";

/** 「点开哪个页面」的候选项；空值 = 跟随内容 */
const OPEN_PAGES: Array<[string, string]> = [
  ["", "跟随内容"],
  ["today", "今天"],
  ["schedule", "日程"],
  ["learn", "网络学堂"],
  ["info", "信息门户"],
  ["folder", "收藏夹"],
];

/** 收藏夹扁平列表（带层级缩进）：下拉里要能看清层级 */
function flatFolders(d: FavsData): Array<{ id: string; label: string }> {
  const out: Array<{ id: string; label: string }> = [];
  const walk = (ids: string[], depth: number): void => {
    for (const id of ids) {
      const f = d.folders[id];
      if (!f) continue;
      out.push({ id, label: `${"　".repeat(depth)}${f.title}` });
      walk(f.items.filter((it) => it.t === "f").map((it) => (it as { t: "f"; id: string }).id), depth + 1);
    }
  };
  walk(d.order, 0);
  // 未挂在根序里的（理论上不该有）：补进列表，避免配置里的夹选不出来
  for (const id of Object.keys(d.folders)) if (!out.some((o) => o.id === id)) out.push({ id, label: d.folders[id]!.title });
  return out;
}

export function WidgetSettingsSection(): ReactNode {
  const favs = useFavs();
  const backend = useNotifyBackend();
  const [s, setS] = useState<WidgetSettings>(() => loadWidgetSettings());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [placed, setPlaced] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const android = backend === "android";
  const folders = useMemo(() => flatFolders(favs.data), [favs.data]);

  const refreshPlaced = async (): Promise<void> => {
    const st = await fetchWidgetStatus();
    setPlaced(st ? st.hostPlaced : null);
  };

  useEffect(() => {
    if (android) void refreshPlaced();
  }, [android]);

  /** 落盘 + 立刻重推：不等下一次定时重算，用户改完抬头就能看到桌面变了 */
  const apply = (patch: Partial<WidgetSettings>): void => {
    setS(saveWidgetSettings(patch));
    setMsg("已更新");
    void (async () => {
      const rt = await ensureWidgetRuntime();
      await rt.syncNow();
      await refreshPlaced();
    })();
  };

  if (!android) {
    return (
      <div className="setting-row">
        <div>
          <div className="setting-title">桌面小组件</div>
          <div className="setting-desc">
            桌面小组件由 Android 版提供（显示课程、截止或收藏内容）；当前平台不支持。
          </div>
        </div>
      </div>
    );
  }

  const kind = s.source.kind;
  const folderId = s.source.folderId ?? "";
  const atomTitle = s.source.atom
    ? (resolveAtom({ kind: s.source.atom.kind, key: s.source.atom.key })?.title ?? "（已失效）")
    : "";
  const folderName = folders.find((f) => f.id === folderId)?.label.trim();
  const selectValue = kind === "today" ? "today" : kind === "folder" ? `folder:${folderId}` : "atom";

  return (
    <>
      <div className="setting-row">
        <div>
          <div className="setting-title">显示内容</div>
          <div className="setting-desc">
            桌面上那块卡片显示什么；选「收藏原子」会打开收藏搜索。
            {kind !== "today" ? <span style={{ color: "var(--text-3)" }}>　内容失效时自动回落到「今天」。</span> : null}
          </div>
        </div>
        <select
          className="input"
          style={{ width: 190 }}
          value={selectValue}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "__pick_atom") {
              setPickerOpen(true);
              return;
            }
            if (v === "today") apply({ source: { kind: "today" } });
            else if (v.startsWith("folder:")) apply({ source: { kind: "folder", folderId: v.slice(7) } });
          }}
        >
          <option value="today">今天（课程与截止）</option>
          {folders.map((f) => (
            <option key={f.id} value={`folder:${f.id}`}>
              收藏夹：{f.label}
            </option>
          ))}
          {/* 已选原子时保留一个占位项，否则下拉会显示不存在的选中值 */}
          {kind === "atom" ? <option value="atom">收藏原子：{atomTitle}</option> : null}
          <option value="__pick_atom">选择收藏原子…</option>
        </select>
      </div>

      <div className="setting-row">
        <div>
          <div className="setting-title">点开哪个页面</div>
          <div className="setting-desc">
            点小组件时打开哪里；默认跟随内容（今天 → 今日页，收藏夹 → 该收藏夹，原子 → 原子本身）。
          </div>
        </div>
        <select
          className="input"
          style={{ width: 190 }}
          value={s.openPage ?? ""}
          onChange={(e) => apply({ openPage: e.target.value === "" ? null : e.target.value })}
        >
          {OPEN_PAGES.map(([v, label]) => (
            <option key={v} value={v}>{label}</option>
          ))}
        </select>
      </div>

      <div className="setting-row">
        <div>
          <div className="setting-title">当前内容</div>
          <div className="setting-desc">
            {describeWidgetSource(s, { folder: folderName || folderId, atom: atomTitle })}
            {placed !== null && placed > 0 ? `　桌面已放置 ${placed} 个。` : "　桌面上还未放置小组件。"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flex: "none" }}>
          <button
            className="btn btn-ghost"
            onClick={() => {
              void (async () => {
                const rt = await ensureWidgetRuntime();
                const okNow = await rt.syncNow();
                await refreshPlaced();
                setMsg(okNow ? "已刷新桌面内容" : "刷新失败：原生未接受（详情见日志）");
              })();
            }}
          >
            立即刷新
          </button>
          <button className="btn btn-ghost" onClick={() => setPickerOpen(true)}>
            选收藏原子
          </button>
        </div>
      </div>

      {msg ? <div style={{ fontSize: "var(--text-sm)", color: "var(--text-3)", padding: "6px 2px" }}>{msg}</div> : null}

      {pickerOpen ? (
        <AtomPickerModal
          onPick={(atom) => {
            setPickerOpen(false);
            apply({ source: { kind: "atom", atom: { kind: atom.kind, key: atom.key } } });
          }}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </>
  );
}
