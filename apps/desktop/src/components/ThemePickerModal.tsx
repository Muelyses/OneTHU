import { t as i18n, useLocale as useUiLocale } from "../i18n/index.js";
import { Input } from "@onethu/gui";
import { Btn } from "@onethu/gui";
/**
 * 「更改主题」二级菜单（设置 → 外观）。
 *
 * 布局：上「已安装」、下「主题市场」，共用顶部搜索（套用插件市场的匹配口径：名称/描述/作者/标签）。
 * 已安装的社区主题同时出现在两栏（市场栏显示「已安装」，不可重复安装）。
 * 骨架沿用 TabManageModal：portal + mask/panel，PC 右推面板、手机底部抽屉（B3b），同款退场动画。
 * 横向纪律（用户实锤：右侧「应用/卸载」被推出屏幕，要手动横滑）：网格列一律 minmax(0,1fr)、
 * 网格项 min-width:0，且不渲染不可断行的裸仓库地址——否则子项 min-content 会把列撑开，
 * 整个正文容器横向溢出，所有行的右侧按钮一起被推出可视区。
 * 高度纪律：面板自身 maxHeight 封顶，正文容器 flex:1 + min-height:0 才能内部滚动——
 * 少了 min-height:0，列向 flex 子项默认 min-height:auto，内容会把面板撑出屏幕（用户实锤）。
 */
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useExitPhase } from "../lib/useExitPhase.js";
import { useExpanded } from "../state/usePlatformLayout.js";
import { activateTheme, deactivateTheme, removeTheme, restoreBuiltins, useThemes, type ThemeDef } from "../state/theme.js";
import { fetchEntryFromMarket, fetchRegistry, normalizeRepoUrl, type MarketEntry } from "../lib/market.js";
import { installedPlugins, subscribe, uninstallPlugin } from "../plugins/loader.js";
import { confirmOk } from "../lib/confirm.js";

const maskStyle: React.CSSProperties = { animation: "m-fade var(--dur-2) var(--ease-out) both", position: "fixed", inset: 0, background: "var(--og-scrim)", zIndex: 1000, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 0 };
const panelStyle: React.CSSProperties = { animation: "m-sheet-up 260ms var(--md-sys-motion-easing-emphasized-decelerate, ease-out) both", width: "100%", minWidth: 0, overflow: "hidden", maxWidth: "100%", maxHeight: "92dvh", display: "flex", flexDirection: "column", background: "var(--og-fill-overlay)", color: "var(--og-content-1)", borderRadius: "var(--md-sys-shape-corner-large) var(--md-sys-shape-corner-large) 0 0", paddingBottom: "env(safe-area-inset-bottom)", boxShadow: "var(--og-elev-menu)" };
const maskOut: React.CSSProperties = { animation: "m-fade-out var(--dur-2) var(--md-sys-motion-easing-emphasized-accelerate) both" };
const panelOut: React.CSSProperties = { animation: "m-pop-out var(--dur-2) var(--md-sys-motion-easing-emphasized-accelerate) both" };
const maskStylePc: React.CSSProperties = { ...maskStyle, background: "color-mix(in srgb, var(--og-scrim) 40%, transparent)", alignItems: "center", justifyContent: "flex-end", padding: 0 };
const panelStylePc: React.CSSProperties = { ...panelStyle, animation: "m-slide-right var(--dur-3) var(--ease-ios) both", width: "min(460px, 44vw)", maxWidth: "none", maxHeight: "none", height: "100%", borderRadius: 0, paddingBottom: 0, borderLeft: "1px solid var(--og-line-1)", boxShadow: "var(--og-elev-3)" };

/** 主题色卡：从 vars 抽 accent / accent-soft / bg 三色出预览（缺省回退令牌默认）。
 *  只显示名字看不出样式，所以每一行都带这块色卡。 */
export function ThemeSwatch({ vars }: { vars: Record<string, string> }): ReactNode {
  const uiLocale = useUiLocale();

  return <span className="theme-swatch" aria-hidden="true" style={{
    "--theme-preview-accent": vars["--og-accent"] ?? vars["--accent"] ?? "var(--og-ref-neutral-950)",
    "--theme-preview-paper": vars["--og-surface-1"] ?? vars["--surface"] ?? vars["--bg"] ?? "var(--og-ref-neutral-0)",
    "--theme-preview-canvas": vars["--og-surface-0"] ?? vars["--bg"] ?? "var(--og-ref-neutral-50)",
  } as React.CSSProperties}><i /><i /><i /></span>;
}

export function ThemeChoice({ name, description, vars = {}, selected, onSelect, extra, themeId }: {
  name: string; description?: string; vars?: Record<string, string>; selected: boolean; onSelect: () => void; extra?: ReactNode;
  /** 主题 id（进暂存箱/分享用；缺省时仍可看不可再应用） */
  themeId?: string;
}): ReactNode {
  const uiLocale = useUiLocale();

  return <div
    className={"theme-choice" + (selected ? " is-selected" : "")}
    data-vault-catch={themeId ? JSON.stringify({ type: "payload", title: name, sub: description, payload: { kind: "theme", themeId }, source: "主题" }) : undefined}
  >
    <Btn variant="ghost" className="theme-choice-main" aria-pressed={selected} onClick={onSelect}>
      <ThemeSwatch vars={vars} />
      <span className="theme-choice-copy"><strong>{name}</strong><span>{description}</span></span>
      <span className="theme-choice-status">{selected ? i18n("components.themepickermodal.7dcf1f288aa3") : i18n("components.themepickermodal.63c73c4730f4")}</span>
    </Btn>{extra}
  </div>;
}

export function ThemePickerModal({ open, onClose }: { open: boolean; onClose: () => void }): ReactNode {
  const uiLocale = useUiLocale();

  const expanded = useExpanded();
  const snap = useThemes();
  const plugins = useSyncExternalStore(subscribe, installedPlugins);
  const [closing, requestClose] = useExitPhase(onClose, open);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<MarketEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  /* Esc 关闭 */
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") requestClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, requestClose]);

  const load = async (force = false): Promise<void> => {
    setBusy(true);
    setMsg(null);
    try {
      const reg = await fetchRegistry(force);
      /* 只留主题条目：市场名单（MarketEntry）没有 category 字段，主题条目以 tags 含「主题」为准
         （如 onethu.theme.barbie），id 形如 *.theme.* 的兜底一次。 */
      setItems(reg.plugins.filter((x) => (x.tags ?? []).includes("主题") || /[.]theme[.]/.test(x.id)));
    } catch (e) {
      setMsg(i18n("components.themepickermodal.97ba287f80fd") + String(e instanceof Error ? e.message : e).slice(0, 160));
    } finally {
      setBusy(false);
    }
  };

  /* 打开时拉一次；缓存命中（5 分钟内）立即返回 */
  useEffect(() => {
    if (open && !items) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const q = query.trim().toLowerCase();
  const hit = (fields: Array<string | undefined>): boolean =>
    !q || fields.filter(Boolean).some((v) => String(v).toLowerCase().includes(q));

  const installedThemes = snap.themes.filter((t) => hit([t.name, t.description, t.author]));
  const marketHits = (items ?? []).filter((x) => hit([x.name, x.description, x.author, ...(x.tags ?? [])]));
  const pluginIds = new Set(plugins.map((p) => p.manifest.id));
  const hasInMarket = (x: MarketEntry): boolean =>
    pluginIds.has(x.id) || snap.themes.some((t) => t.id === x.id || t.owner === x.id);

  /* 主题所属插件：优先安装时写入的 owner，退化到「主题 id 与插件 id 同名」约定
     （与插件页原逻辑一致：只删定义会留下孤儿插件卡）。 */
  const ownerOf = (t: ThemeDef): string | null => {
    if (t.owner && pluginIds.has(t.owner)) return t.owner;
    if (pluginIds.has(t.id)) return t.id;
    return null;
  };

  const delTheme = async (t: ThemeDef): Promise<void> => {
    const owner = ownerOf(t);
    if (!owner) {
      removeTheme(t.id);
      setMsg(i18n("components.themepickermodal.14f80dfb3d98") + t.name + "」");
      return;
    }
    const yes = await confirmOk(i18n("components.themepickermodal.093197238318") + t.name + i18n("components.themepickermodal.a28cbce49ad9") + owner + i18n("components.themepickermodal.75b15e92ecf7"));
    if (!yes) return;
    try {
      await uninstallPlugin(owner);
      setMsg(i18n("components.themepickermodal.14f80dfb3d98") + t.name + i18n("components.themepickermodal.f71d14f528ee") + owner + "」");
    } catch (e) {
      setMsg(i18n("components.themepickermodal.0580fcee37e0") + String(e).slice(0, 100));
    }
  };

  const install = async (item: MarketEntry): Promise<void> => {
    setBusy(true);
    setMsg(null);
    try {
      const text = await fetchEntryFromMarket(item);
      const { installPlugin } = await import("../plugins/loader.js");
      const m = await installPlugin(text, { repo: normalizeRepoUrl(item.repo) });
      setMsg(i18n("components.themepickermodal.6a644ac83c43") + m.name + i18n("components.themepickermodal.6644799ba0ab"));
    } catch (e) {
      setMsg(i18n("components.themepickermodal.316fe39d4c6f") + String(e instanceof Error ? e.message : e).slice(0, 160));
    } finally {
      setBusy(false);
    }
  };

  const secHead = (text: string, extra?: ReactNode): ReactNode => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "12px 0 6px" }}>
      <b style={{ fontSize: "var(--text-sm)" }}>{text}</b>
      <span style={{ flex: 1 }} />
      {extra}
    </div>
  );

  return createPortal(
    <div
      className="theme-pick-mask"
      style={closing ? { ...(expanded ? maskStylePc : maskStyle), ...maskOut } : expanded ? maskStylePc : maskStyle}
      onClick={requestClose}
    >
      <div
        className="theme-pick-panel"
        style={closing ? { ...(expanded ? panelStylePc : panelStyle), ...panelOut } : expanded ? panelStylePc : panelStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: "1px solid var(--border, #eee)", flex: "none" }}>
          <b>{i18n("components.themepickermodal.8e3513d1f479")}</b>
          <span style={{ flex: 1 }} />
          <Btn variant="outline" onClick={requestClose}>✕</Btn>
        </div>

        <div style={{ padding: "10px 16px 16px", overflowY: "auto", overflowX: "hidden", flex: 1, minHeight: 0, minWidth: 0 }}>
          <Input placeholder={i18n("components.themepickermodal.b0192c6c705a")} value={query} onChange={(value) => setQuery(value)} />
          {msg ? <div className="plg-runmsg" style={{ marginTop: 8 }}>{msg}</div> : null}

          {secHead(
            i18n("components.themepickermodal.a8b6c39dcabf"),
            <Btn variant="ghost" onClick={() => setMsg(i18n("components.themepickermodal.744b48e64720") + restoreBuiltins() + i18n("components.themepickermodal.a68af2113d77"))}>{i18n("components.themepickermodal.61e80772a4e6")}</Btn>,
          )}
          {installedThemes.length === 0 ? <div className="plg-hint">{i18n("components.themepickermodal.1cdf519489b5")}</div> : null}
          <div className="theme-choice-grid">
            {hit([i18n("components.themepickermodal.708c97df7bec"), i18n("components.themepickermodal.844b8cc8dff7")]) ? <ThemeChoice name={i18n("components.themepickermodal.78c3900fe08f")} description={i18n("components.themepickermodal.e0ad632058d7")} selected={!snap.effectiveId || snap.effectiveId === "onethu.theme.ivory"} onSelect={() => deactivateTheme()} themeId="onethu.theme.ivory" /> : null}
            {installedThemes.filter(t => t.id !== "onethu.theme.ivory").map(t => <ThemeChoice key={t.id} name={t.name} description={t.description} vars={t.vars} selected={snap.effectiveId === t.id} onSelect={() => { activateTheme(t.id); setMsg(i18n("components.themepickermodal.e9b593117599") + t.name + "」"); }} themeId={t.id}
              extra={ownerOf(t) ? <Btn variant="ghost" onClick={() => void delTheme(t)}>{i18n("components.themepickermodal.06bc14b60f35")}</Btn> : undefined} />)}
          </div>

          {secHead(
            i18n("components.themepickermodal.5df274b078ee"),
            <Btn variant="ghost" disabled={busy} onClick={() => void load(true)}>{busy ? i18n("components.themepickermodal.7f3c8312816f") : i18n("components.themepickermodal.aee887434131")}</Btn>,
          )}
          {!items && busy ? <div className="plg-hint">{i18n("components.themepickermodal.0ad01e8954e9")}</div> : null}
          {items && !marketHits.length ? <div className="plg-hint">{i18n("components.themepickermodal.7fad67d470dc")}</div> : null}
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "minmax(0, 1fr)" }}>
            {marketHits.map((x) => {
              const has = hasInMarket(x);
              return (
                <div key={x.id} className="market-card" style={{ margin: 0, minWidth: 0, maxWidth: "100%" }}>
                  <div className="market-card-head">
                    <span className="market-card-name">
                      {x.name}
                      {has ? <span className="market-installed-badge">{i18n("components.themepickermodal.a8b6c39dcabf")}</span> : null}
                    </span>
                  </div>
                  <div className="market-card-meta">v{x.version}{x.author ? " · " + x.author : ""}</div>
                  <div className="market-card-desc" style={{ overflowWrap: "anywhere" }}>{x.description || x.repo}</div>
                  {x.tags?.length ? (
                    <div className="market-card-tags">
                      {x.tags.map((tag) => <span key={tag} className="market-tag">{tag}</span>)}
                    </div>
                  ) : null}
                  <div className="market-card-foot">
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--text-3)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.repo}</span>
                    <Btn variant="solid" tone="brand" disabled={busy || has} onClick={() => void install(x)}>{has ? i18n("components.themepickermodal.a8b6c39dcabf") : busy ? "…" : i18n("components.themepickermodal.e8f88f51ccb0")}</Btn>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="plg-hint" style={{ marginTop: 10 }}>{i18n("components.themepickermodal.a4195ac97a28")}</div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
