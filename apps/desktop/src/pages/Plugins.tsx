/**
 * 插件页（侧栏一级入口「插件」）：
 * 三区信息架构——电表概览条 / 模块卡（开关·设置·日志·删除 + 命令）/ 安装面板。
 * 设置与运行日志走底部 Sheet：设置显式「保存」+ 已保存回执（不再静默落盘）；
 * 日志全高终端（时间戳 + 方法符着色 + 自动贴底 + 打断/清空）。
 */
import { compareVersions, fetchEntryFromMarket, fetchEntryFromRepo, fetchRegistry, fetchStarMap, normalizeRepoUrl, parseRepoInput, type MarketEntry } from "../lib/market.js";
import { useSyncExternalStore, useEffect, useRef, useState, type ReactNode } from "react";
import { PageHead } from "../components/Layout.js";
import { PluginLogo } from "../components/PluginLogo.js";
import {
  commandsSnapshot, disablePlugin, enablePlugin, installedPlugins,
  isLive, runCommand, subscribe, subscribeCommands, uninstallPlugin,
} from "../plugins/loader.js";
import { addRustPlugin, updatePlugin } from "../plugins/registry.js";
import { clearPluginEvents, pluginEvents, subscribePluginEvents } from "../plugins/events.js";
import { notifyRust } from "../plugins/rust.js";
import { PLUGIN_PERMISSIONS } from "../plugins/types.js";
import { activateTheme, deactivateTheme, removeTheme, restoreBuiltins, useThemes } from "../state/theme.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** 模块卡左上的双字母针脚：取名称词首字母，退化为 id 尾段 */
function monogram(name: string, id: string): string {
  const ascii = name
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .replace(/[^A-Za-z0-9]/g, "");
  if (ascii.length >= 2) return ascii.slice(0, 2).toUpperCase();
  if (ascii.length === 1) return ascii.toUpperCase();
  return (id.split(".").pop() ?? "pk").slice(0, 2).toUpperCase();
}

export function PluginsPage(): ReactNode {
  const allPlugins = useSyncExternalStore(subscribe, installedPlugins);
  const cmds = useSyncExternalStore(subscribeCommands, commandsSnapshot);
  const [view, setView] = useState<"mine" | "market">("mine");
  const [cat, setCat] = useState<"all" | "theme" | "general">("all");
  const [instOpen, setInstOpen] = useState(false);
  const themesSnap = useThemes();
  const plugins = cat === "all" ? allPlugins : allPlugins.filter((p) => (p.manifest.category ?? "general") === cat);
  const [sheet, setSheet] = useState<{ id: string; mode: "settings" | "log" } | null>(null);
  const liveCount = plugins.filter((p) => p.enabled && isLive(p.manifest.id)).length;
  const coreCount = plugins.filter((p) => p.embedded).length;

  return (
    <div className="plg-page">
      <PageHead
        title="插件"
        meta={
          <span>
            经 <code className="plg-code">onethu.*</code> 公共接口扩展 OneTHU——权限门禁、会话自愈、
            45s 超时由宿主统一承担
          </span>
        }
        actions={
          <div className="seg-track">
            {([["mine", "我的插件"], ["market", "插件市场"]] as const).map(([k, lbl]) => (
              <button key={k} className={"seg-item" + (view === k ? " is-active" : "")} onClick={() => setView(k)}>
                {lbl}
              </button>
            ))}
          </div>
        }
      />

      {/* 电表概览条 */}
      <div className="plg-stats">
        <div className="plg-stat">
          <span className="plg-stat-n">{String(plugins.length).padStart(2, "0")}</span>
          <span className="plg-stat-l">已安装</span>
        </div>
        <div className="plg-stat">
          <span className="plg-stat-n">
            <i className={"plg-led" + (liveCount > 0 ? " is-run" : "")} />
            {String(liveCount).padStart(2, "0")}
          </span>
          <span className="plg-stat-l">运行中</span>
        </div>
        <div className="plg-stat">
          <span className="plg-stat-n">{String(cmds.length).padStart(2, "0")}</span>
          <span className="plg-stat-l">可用命令</span>
        </div>
        <div className="plg-stat">
          <span className="plg-stat-n">{String(coreCount).padStart(2, "0")}</span>
          <span className="plg-stat-l">内置核心</span>
        </div>
      </div>


      {/* 主题管理区：主题即插件，管理面就在插件页（主题页签下展开；用户定案
          2026-09-13：设置页不放，避免双头管理） */}
      {view === "market" ? (
        <MarketView />
      ) : (
        <>
      {instOpen ? <InstallPanel onClose={() => setInstOpen(false)} /> : null}

      {/* 我的插件 · 工具行：类别页签 + 安装入口（归拢一行；主切换只留视图级） */}
      <div className="plg-toolbar">
        <div className="seg-track">
          {([["all", `全部 ${allPlugins.length}`], ["theme", `主题 ${themesSnap.themes.length}`], ["general", `通用 ${allPlugins.filter((p) => (p.manifest.category ?? "general") === "general").length}`]] as const).map(([k, lbl]) => (
            <button key={k} className={"seg-item" + (cat === k ? " is-active" : "")} onClick={() => setCat(k)}>
              {lbl}
            </button>
          ))}
        </div>
        <button className="btn btn-ghost plg-install-toggle" onClick={() => setInstOpen((o) => !o)}>
          {instOpen ? "收起安装" : "安装插件"}
        </button>
      </div>

      {cat === "theme" || cat === "all" ? <ThemeManagerSection /> : null}

      {plugins.length === 0 && cat !== "theme" ? (
        <div className="plg-empty">
          <div className="plg-empty-mark">[ · ]</div>
          <div className="plg-empty-t">机架空空如也</div>
          <div className="plg-empty-d">安装第一个插件，为 OneTHU 挂上新的能力模块。</div>
          <button className="btn btn-primary" onClick={() => setInstOpen(true)}>
            安装插件
          </button>
        </div>
      ) : plugins.length === 0 && cat === "theme" ? (
        <div style={{ fontSize: "var(--text-sm)", color: "var(--text-3)", padding: "6px 2px" }}>
          暂无主题插件——上方主题区即全部可用主题（内置可删可恢复）。
        </div>
      ) : (
        <div className="plg-rack">
          {plugins.map((p, i) => (
            <PluginCard key={p.manifest.id} id={p.manifest.id} index={i} onOpenSheet={setSheet} />
          ))}
        </div>
      )}

      {sheet ? <PluginSheet id={sheet.id} mode={sheet.mode} onClose={() => setSheet(null)} /> : null}
        </>
      )}
    </div>
  );
}

/** 主题色卡：从 vars 抽 accent/soft/bg 三色出预览（缺省回退令牌默认） */
function ThemeSwatch({ vars }: { vars: Record<string, string> }): ReactNode {
  const accent = vars["--accent"] ?? "#4176e6";
  const soft = vars["--accent-soft"] ?? "#edf3fe";
  const bg = vars["--bg"] ?? "#ffffff";
  return (
    <span className="theme-swatch" style={{ background: soft, display: "inline-flex", gap: 3, padding: 3, borderRadius: 6, flex: "none" }}>
      <i style={{ width: 14, height: 14, borderRadius: 4, background: accent }} />
      <i style={{ width: 14, height: 14, borderRadius: 4, background: bg, boxShadow: "inset 0 0 0 1px rgba(0,0,0,.08)" }} />
    </span>
  );
}

/** 主题管理区（插件页 · 主题页签）：内置主题 + 插件安装的主题一页全管 */
function ThemeManagerSection(): ReactNode {
  const snap = useThemes();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div
      style={{
        border: "1px solid var(--border)", borderRadius: "var(--r-lg)",
        background: "var(--surface)", padding: "10px 12px", marginBottom: 10,
      }}
    >
      {msg ? (
        <div style={{ fontSize: "var(--text-sm)", color: "var(--accent)", marginBottom: 8 }}>{msg}</div>
      ) : null}
      {snap.themes.length === 0 ? (
        <div style={{ fontSize: "var(--text-sm)", color: "var(--text-3)" }}>机架空空——所有主题都被删掉了。</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 8 }}>
          {snap.themes.map((t) => {
            const on = snap.activeId === t.id;
            return (
              <div
                key={t.id}
                style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
                  border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
                  borderRadius: "var(--r-md)", background: on ? "var(--accent-soft)" : "var(--surface)",
                }}
              >
                <ThemeSwatch vars={t.vars} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <b style={{ fontSize: "var(--text-base)" }}>{t.name}</b>
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--text-3)" }}>v{t.version}</span>
                    {t.source === "plugin" ? (
                      <span className="chip" style={{ height: 16, fontSize: 9.5, padding: "0 6px" }}>插件</span>
                    ) : null}
                  </div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--text-3)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {t.description ?? t.id}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 4, flex: "none" }}>
                  {on ? (
                    <button className="btn btn-ghost" onClick={() => { deactivateTheme(); setMsg(`已停用「${t.name}」`); }}>
                      停用
                    </button>
                  ) : (
                    <button className="btn btn-primary" onClick={() => { activateTheme(t.id); setMsg(`已应用「${t.name}」`); }}>
                      应用
                    </button>
                  )}
                  <button className="btn btn-ghost" title="删除主题（内置同权可删）" onClick={() => { removeTheme(t.id); setMsg(`已删除「${t.name}」`); }}>
                    删除
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {snap.deletedBuiltins.length > 0 ? (
        <div style={{ marginTop: 8 }}>
          <button className="btn" onClick={() => setMsg(`已恢复 ${restoreBuiltins()} 个内置主题`)}>
            恢复内置主题（{snap.deletedBuiltins.length} 个已删）
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** 主题插件卡上的「应用/撤下主题」动作（主题管理在设置页·主题区，此处快捷） */
function ThemeApplyButton({ themePluginId, onMsg }: { themePluginId: string; onMsg: (s: string) => void }): ReactNode {
  const snap = useThemes();
  const applied = snap.activeId === themePluginId;
  return (
    <button
      className={"btn " + (applied ? "btn-ghost" : "btn-primary")}
      onClick={() => {
        if (applied) {
          deactivateTheme();
          onMsg("已撤下主题，回到默认配色");
        } else if (activateTheme(themePluginId)) {
          onMsg("主题已应用（设置 → 主题 可管理全部主题）");
        } else {
          onMsg("主题定义尚未注册（插件未启用？）");
        }
      }}
    >
      {applied ? "撤下主题" : "应用主题"}
    </button>
  );
}

/* ═══════════════ 模块卡 ═══════════════ */

function PluginCard({
  id,
  index,
  onOpenSheet,
}: {
  id: string;
  index: number;
  onOpenSheet: (s: { id: string; mode: "settings" | "log" }) => void;
}): ReactNode {
  const plugins = useSyncExternalStore(subscribe, installedPlugins);
  const rec = plugins.find((p) => p.manifest.id === id);
  const cmds = useSyncExternalStore(subscribeCommands, commandsSnapshot).filter((c) => c.pluginId === id);
  const [open, setOpen] = useState(false);
  const [runMsg, setRunMsg] = useState<string | null>(null);
  const [input, setInput] = useState("");
  if (!rec) return null;
  const m = rec.manifest;
  const active = rec.enabled && isLive(id);
  const failed = rec.enabled && !isLive(id);
  const stateText = active ? "运行中" : failed ? "加载失败" : "已停用";

  const doRun = async (cmdId: string): Promise<void> => {
    setRunMsg("执行中…");
    try {
      const r = await runCommand(id, cmdId, input);
      setRunMsg(r == null ? "完成" : String(typeof r === "string" ? r : JSON.stringify(r)).slice(0, 400));
    } catch (e) {
      setRunMsg(`失败：${String(e instanceof Error ? e.message : e).slice(0, 300)}`);
    }
  };

  return (
    <article
      className={"plg-card" + (active ? " is-on" : failed ? " is-err" : "")}
      style={{ animationDelay: `${Math.min(index, 8) * 55}ms` }}
    >
      <div className="plg-card-top">
        <div className={"plg-pin" + (m.id === "onethu.harness" ? " is-oh" : rec.embedded ? " is-core" : "")} aria-hidden>
          <PluginLogo id={m.id} fallback={monogram(m.name, m.id)} />
        </div>
        <div className="plg-card-id">
          <div className="plg-title">
            <b className="plg-name">{m.name}</b>
            <span className="plg-ver">v{m.version}</span>
            <span className="plg-kind">{m.kind === "rust" ? "RUST" : "JS"}</span>
            {m.category === "theme" ? <span className="plg-core" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>主题</span> : null}
            {rec.embedded ? <span className="plg-core" title="Rust 核心已编进 App，无需二进制">内置</span> : null}
          </div>
          <div className={"plg-state" + (active ? " is-run" : failed ? " is-err" : "")}>
            <i className={"plg-led" + (active ? " is-run" : failed ? " is-err" : "")} />
            {stateText}
            <span className="plg-state-sub">{m.id}</span>
          </div>
        </div>
        <div className="plg-ops">
          {rec.repo ? (
            <button
              className="plg-repo-btn"
              title={`打开源码仓库：${rec.repo}`}
              aria-label="打开源码仓库"
              onClick={() => void (async () => {
                try {
                  const { openUrl } = await import("@tauri-apps/plugin-opener");
                  await openUrl(rec.repo!);
                } catch {
                  window.open(rec.repo!, "_blank");
                }
              })()}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
              </svg>
            </button>
          ) : null}
          {m.category === "theme" ? <ThemeApplyButton themePluginId={m.id} onMsg={setRunMsg} /> : null}
          <Switch on={rec.enabled} label={rec.enabled ? "停用" : "启用"} onToggle={() => void (rec.enabled ? disablePlugin(id) : enablePlugin(id)).catch((e: unknown) => setRunMsg(String(e)))} />
          <button className="btn btn-ghost" onClick={() => onOpenSheet({ id, mode: "settings" })}>
            设置
          </button>
          {m.kind === "rust" ? (
            <button className="btn btn-ghost" onClick={() => onOpenSheet({ id, mode: "log" })}>
              日志
            </button>
          ) : null}
          {rec.embedded || rec.builtin ? null : (
            <button className="btn btn-ghost plg-danger" onClick={() => void uninstallPlugin(id)}>
              删除
            </button>
          )}
        </div>
      </div>

      {m.description ? <p className="plg-desc">{m.description}</p> : null}

      <div className="plg-perms">
        {m.permissions.map((p) => {
          const meta = PLUGIN_PERMISSIONS.find((x) => x.id === p);
          return (
            <span key={p} className="plg-perm" title={meta?.desc ?? p}>
              {meta?.label ?? p}
            </span>
          );
        })}
      </div>

      {cmds.length > 0 ? (
        <>
          <button className="plg-cmds-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? "收起命令" : `命令（${cmds.length}）`}
            <i className={"plg-caret" + (open ? " is-open" : "")} />
          </button>
          <div className={"plg-detail" + (open ? " is-open" : "")}>
            <div className="plg-detail-in">
              <div className="plg-cmds">
                {cmds.map((c) => (
                  <div key={c.id} className="plg-cmd">
                    <div className="plg-cmd-t">{c.title}</div>
                    {c.inputLabel ? (
                      <textarea
                        className="input"
                        rows={2}
                        placeholder={c.inputPlaceholder ?? ""}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                      />
                    ) : null}
                    <button className="btn btn-primary" onClick={() => void doRun(c.id)}>
                      执行
                    </button>
                    {runMsg ? <div className="plg-runmsg">{runMsg}</div> : null}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      ) : null}

      {runMsg && cmds.length === 0 ? <div className="plg-runmsg">{runMsg}</div> : null}
    </article>
  );
}

/** 启停小开关 */
function Switch({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }): ReactNode {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} title={label} className={"plg-switch" + (on ? " is-on" : "")} onClick={onToggle}>
      <i />
    </button>
  );
}

/* ═══════════════ 底部 Sheet：设置（显式保存）/ 日志（全高终端） ═══════════════ */

function PluginSheet({
  id,
  mode,
  onClose,
}: {
  id: string;
  mode: "settings" | "log";
  onClose: () => void;
}): ReactNode {
  const plugins = useSyncExternalStore(subscribe, installedPlugins);
  const rec = plugins.find((p) => p.manifest.id === id);
  if (!rec) return null;
  return (
    <div className="plg-mask" onClick={onClose}>
      <section
        className="plg-sheet"
        role="dialog"
        aria-label={mode === "settings" ? `${rec.manifest.name} 设置` : `${rec.manifest.name} 运行日志`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="plg-sheet-head">
          <b>{mode === "settings" ? "设置" : "运行日志"} · {rec.manifest.name}</b>
          <button className="btn btn-ghost" onClick={onClose}>
            关闭
          </button>
        </div>
        {mode === "settings" ? (
          <SettingsBody id={id} rec={rec} />
        ) : (
          <LogBody id={id} />
        )}
      </section>
    </div>
  );
}

/** 设置：本地草稿 + 显式保存 + 已保存回执（设置在插件下一轮运行时实时读取） */
function SettingsBody({ id, rec }: { id: string; rec: any }): ReactNode {
  const fields = rec.manifest.settings ?? [];
  const [draft, setDraft] = useState<Record<string, string>>({ ...rec.settings });
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const save = (): void => {
    setSaving(true);
    try {
      updatePlugin(id, { settings: { ...draft } });
      setSavedAt(new Date().toLocaleTimeString("zh-CN", { hour12: false }));
    } finally {
      setSaving(false);
    }
  };

  if (fields.length === 0) {
    return (
      <>
        <div className="plg-sheet-body">
          <div className="plg-empty" style={{ padding: "26px 12px" }}>
            <div className="plg-empty-d">该插件没有可配置项</div>
          </div>
        </div>
        <div className="plg-sheet-foot">
          <span className="plg-hint">—</span>
          <button className="btn btn-ghost" onClick={() => (document.querySelector(".plg-mask") as HTMLElement | null)?.click()}>
            关闭
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="plg-sheet-body">
        <div className="plg-settings is-sheet">
          {fields.map((f: any) => (
            <label key={f.key} className="plg-setting">
              <span>{f.label}</span>
              {f.type === "select" ? (
                <select
                  className="input"
                  value={draft[f.key] ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                >
                  {(f.options ?? []).map((o: { value: string; label: string }) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              ) : f.type === "textarea" ? (
                <textarea
                  className="input"
                  rows={3}
                  placeholder={f.placeholder ?? ""}
                  value={draft[f.key] ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                />
              ) : (
                <input
                  className="input"
                  type={f.type === "password" ? "password" : "text"}
                  placeholder={f.placeholder ?? ""}
                  value={draft[f.key] ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                />
              )}
            </label>
          ))}
        </div>
        <div className="plg-hint">设置在插件下一轮运行时生效（每轮实时读取）。</div>
      </div>
      <div className="plg-sheet-foot">
        {savedAt ? (
          <span className="plg-saved">
            <i className="plg-led is-run" /> 已保存 {savedAt}
          </span>
        ) : (
          <span className="plg-hint">修改后点「保存」才会生效</span>
        )}
        <span className="plg-sheet-foot-ops">
          <button className="btn btn-ghost" onClick={() => setDraft({ ...rec.settings })}>
            撤销修改
          </button>
          <button className="btn btn-primary" disabled={saving} onClick={save}>
            保存
          </button>
        </span>
      </div>
    </>
  );
}

/** 运行日志：全高终端 + 打断/清空 + 自动贴底 */
function LogBody({ id }: { id: string }): ReactNode {
  const events = useSyncExternalStore(subscribePluginEvents, () => pluginEvents(id));
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  // delta/think 是逐 token 流（已进 dock 思考/回答链展示），进日志只会刷屏——只留进度/工具/日志/系统行
  const lines = events
    .filter((e) => !(e.method === "progress" && (e.kind === "delta" || e.kind === "think")))
    .slice(-400);
  return (
    <>
      <div className="plg-sheet-body">
        <div className="plg-term is-tall" ref={bodyRef}>
          {lines.length === 0 ? (
            <span className="plg-term-empty">— 尚无输出 · 发一次对话或执行一条命令试试 —</span>
          ) : (
            lines.map((e, i) => {
              const isLog = e.kind === "log";
              const tag = isLog ? "·" : e.kind === "tool" ? "🔧" : e.method === "progress" ? "▶" : e.method === "exit" ? "■" : "…";
              return (
                <div key={i} className={"plg-ev plg-ev-" + e.method + (isLog ? " is-log" : "")}>
                  <span className="plg-ev-t">{new Date(e.at).toLocaleTimeString("zh-CN", { hour12: false })}</span>
                  <span className="plg-ev-tag">{tag}</span>
                  <span className="plg-ev-text">
                    {e.text || e.method}
                    {e.step != null ? `（${e.step}${e.total != null ? "/" + e.total : ""}）` : ""}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
      <div className="plg-sheet-foot">
        <span className="plg-hint">{events.length} 条事件 · 最多保留 300 条</span>
        <span className="plg-sheet-foot-ops">
          <button className="btn btn-ghost" onClick={() => void notifyRust(id, "interrupt").catch(() => undefined)}>
            打断运行
          </button>
          <button className="btn btn-ghost" onClick={() => clearPluginEvents(id)}>
            清空
          </button>
        </span>
      </div>
    </>
  );
}

/* ═══════════════ 插件市场视图：热度排序 · 搜索 · 一键安装 ═══════════════ */

function MarketView(): ReactNode {
  const installed = useSyncExternalStore(subscribe, installedPlugins);
  const installedMap = new Map(installed.map((p) => [p.manifest.id, p.manifest.version]));
  const [items, setItems] = useState<MarketEntry[] | null>(null);
  const [stars, setStars] = useState<Record<string, number | null>>({});
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<"stars" | "name">("stars");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = async (force = false): Promise<void> => {
    setBusy(true);
    setMsg(null);
    try {
      const reg = await fetchRegistry(force);
      setItems(reg.plugins);
      setLoaded(true);
      // star 数动态拉取（失败沉底），不阻塞列表展示
      fetchStarMap(reg.plugins).then(setStars).catch(() => setStars({}));
    } catch (e) {
      setMsg(`市场名单拉取失败：${String(e instanceof Error ? e.message : e).slice(0, 200)}`);
    } finally {
      setBusy(false);
    }
  };

  const install = async (item: MarketEntry): Promise<void> => {
    setBusy(true);
    setMsg(null);
    try {
      const text = await fetchEntryFromMarket(item);
      const { installPlugin } = await import("../plugins/loader.js");
      const m = await installPlugin(text, { repo: normalizeRepoUrl(item.repo) });
      setMsg(`已安装并激活：${m.name} v${m.version}——切回「我的插件」查看。`);
    } catch (e) {
      setMsg(`安装失败：${String(e instanceof Error ? e.message : e).slice(0, 200)}`);
    } finally {
      setBusy(false);
    }
  };

  const q = query.trim().toLowerCase();
  const hits = (items ?? [])
    .filter((x) => !q || [x.name, x.description, x.author, ...(x.tags ?? [])].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)))
    .slice()
    .sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      const sa = stars[a.id] ?? -1;
      const sb = stars[b.id] ?? -1;
      if (sa !== sb) return sb - sa; // star 缺失（null）沉底
      return a.name.localeCompare(b.name);
    });

  return (
    <section className="market-view">
      <div className="market-bar">
        <input
          className="input market-search"
          placeholder="搜索插件名称 / 描述 / 标签"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="seg-track">
          {([["stars", "按热度"], ["name", "按名称"]] as const).map(([k, lbl]) => (
            <button key={k} className={"seg-item" + (sortBy === k ? " is-active" : "")} onClick={() => setSortBy(k)}>
              {lbl}
            </button>
          ))}
        </div>
        <button className="btn" disabled={busy} onClick={() => void load(true)}>
          {busy ? "刷新中…" : "刷新"}
        </button>
      </div>

      {msg ? <div className="plg-runmsg">{msg}</div> : null}

      {!loaded && !msg ? (
        <div className="plg-empty">
          <div className="plg-empty-mark">[ ⇩ ]</div>
          <div className="plg-empty-t">插件市场</div>
          <div className="plg-empty-d">浏览社区插件，按仓库热度排序；收录经人工审查。</div>
          <button className="btn btn-primary" disabled={busy} onClick={() => void load()}>
            {busy ? "加载中…" : "加载市场名单"}
          </button>
        </div>
      ) : null}

      {loaded && !hits.length ? <div className="plg-hint">无匹配条目。</div> : null}

      {hits.length ? (
        <div className="market-grid">
          {hits.map((item) => {
            const st = stars[item.id];
            return (
              <div key={item.id} className="market-card">
                <div className="market-card-head">
                  <span className="market-card-name">
                    {item.name}
                    {installedMap.has(item.id) ? <span className="market-installed-badge">已安装</span> : null}
                  </span>
                  <span className="market-card-stars" title="GitHub Stars">★ {typeof st === "number" ? String(st) : "—"}</span>
                </div>
                <div className="market-card-meta">
                  v{item.version}
                  {item.author ? ` · ${item.author}` : ""}
                </div>
                <div className="market-card-desc">{item.description || item.repo}</div>
                {item.tags?.length ? (
                  <div className="market-card-tags">
                    {item.tags.map((t) => (
                      <span key={t} className="market-tag">{t}</span>
                    ))}
                  </div>
                ) : null}
                <div className="market-card-foot">
                  <button
                    className="market-repo-link"
                    title={`在浏览器打开仓库：${normalizeRepoUrl(item.repo)}`}
                    onClick={() => void (async () => {
                      const url = normalizeRepoUrl(item.repo);
                      try {
                        const { openUrl } = await import("@tauri-apps/plugin-opener");
                        await openUrl(url);
                      } catch {
                        window.open(url, "_blank");
                      }
                    })()}
                  >
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
                    </svg>
                    {item.repo}
                  </button>
                  {(() => {
                    const local = installedMap.get(item.id);
                    if (local && compareVersions(item.version, local) <= 0) {
                      return (
                        <button className="btn" disabled title={`本地 v${local}，已是最新`}>
                          已安装
                        </button>
                      );
                    }
                    const updating = !!local;
                    return (
                      <button
                        className="btn btn-primary"
                        disabled={busy}
                        title={updating ? `本地 v${local} → 市场 v${item.version}` : undefined}
                        onClick={() => void install(item)}
                      >
                        {busy ? "…" : updating ? "更新" : "安装"}
                      </button>
                    );
                  })()}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="plg-hint" style={{ marginTop: 10 }}>
        想上架你的插件？向 OneTHU-Market 仓库提交 Pull Request——流程见
        {" "}<a href="https://github.com/smartThise/OneTHU-Market" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>市场仓库</a>
        与插件开发文档 §7。
      </div>
    </section>
  );
}

/* ═══════════════ 安装面板：三路安装（粘贴 JS / JS 文件 / Rust 插件） ═══════════════ */

function InstallPanel({ onClose }: { onClose: () => void }): ReactNode {
  const [tab, setTab] = useState<"paste" | "jsfile" | "rust" | "github">("paste");
  const [repoInput, setRepoInput] = useState("");
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const install = async (text: string): Promise<void> => {
    if (!text.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const { installPlugin } = await import("../plugins/loader.js");
      const m = await installPlugin(text);
      setMsg(`已安装并激活：${m.name} v${m.version}`);
      setCode("");
    } catch (e) {
      setMsg(`安装失败：${String(e instanceof Error ? e.message : e).slice(0, 200)}`);
    } finally {
      setBusy(false);
    }
  };

  const installFromRepoText = async (input: string, entry?: string): Promise<void> => {
    const ref = parseRepoInput(input);
    const text = await fetchEntryFromRepo(ref, entry);
    const { installPlugin } = await import("../plugins/loader.js");
    const m = await installPlugin(text, { repo: normalizeRepoUrl(input) });
    setMsg(`已安装并激活：${m.name} v${m.version}`);
    setRepoInput("");
  };

  const installRust = async (): Promise<void> => {
    setBusy(true);
    setMsg(null);
    try {
      // Tauri v2 的 webview File 对象没有 .path（v1 特权已移除）——必须走系统文件对话框
      if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
        throw new Error("浏览器预览装不了 Rust 插件——请用 pnpm --filter @onethu/desktop tauri:dev 桌面壳");
      }
      const { open } = await import("@tauri-apps/plugin-dialog");
      const { invoke } = await import("@tauri-apps/api/core");
      // R10：整包导入（zip 优先，兼容文件夹）——manifest + 二进制 + logo 整包随行
      const mode = await new Promise<"zip" | "dir" | null>((res) => {
        const z = window.confirm("确定=选择 .zip 插件包；取消=选择插件文件夹");
        res(z ? "zip" : "dir");
      });
      if (!mode) return;
      if (mode === "zip") {
        const sel = await open({
          multiple: false,
          directory: false,
          title: "选择插件压缩包（manifest.json + 二进制 + logo.svg）",
          filters: [{ name: "插件包", extensions: ["zip"] }],
        });
        if (!sel) return;
        const out = await invoke<{ kind: string; manifest: any; binPath?: string; code?: string }>(
          "plugin_dir_import_zip",
          { zipPath: typeof sel === "string" ? sel : String(sel) },
        );
        if (out.kind !== "rust" || !out.binPath) throw new Error("压缩包不是 rust 插件（缺 kind=rust/bin）");
        addRustPlugin(out.manifest, out.binPath);
        const { enablePlugin } = await import("../plugins/loader.js");
        await enablePlugin(out.manifest.id);
        setMsg(`已安装 Rust 插件：${out.manifest.name} v${out.manifest.version}`);
        return;
      }
      // 文件夹形态：选 manifest.json，整目录复制
      const sel = await open({
        multiple: false,
        directory: false,
        title: "选择插件文件夹内的 manifest.json",
        filters: [{ name: "manifest.json", extensions: ["json"] }],
      });
      if (!sel) return; // 用户取消
      const mpath = typeof sel === "string" ? sel : String(sel);
      const manifest = JSON.parse(await invoke<string>("read_file_text", { path: mpath }));
      if (!manifest?.id || !manifest?.name) throw new Error("manifest.json 缺 id/name");
      if (manifest.kind !== "rust" || !manifest.bin) throw new Error("manifest.kind 须为 rust 且声明 bin");
      const mdir = mpath.replace(/[^/\\]+$/, "");
      const newBin = await invoke<string>("plugin_dir_install_rust", {
        id: String(manifest.id),
        manifestDir: mdir,
        bin: String(manifest.bin),
      });
      addRustPlugin(manifest, newBin);
      const { enablePlugin } = await import("../plugins/loader.js");
      await enablePlugin(manifest.id);
      setMsg(`已安装 Rust 插件：${manifest.name} v${manifest.version}`);
    } catch (e) {
      setMsg(`安装失败：${String(e instanceof Error ? e.message : e).slice(0, 200)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="plg-install">
      <div className="plg-install-tabs" role="tablist">
        {(
          [
            ["paste", "粘贴 JS 模块"],
            ["jsfile", "选择 .js 文件"],
            ["rust", "Rust 骨干插件"],
            ["github", "GitHub 仓库"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            className={"plg-tab" + (tab === k ? " is-on" : "")}
            onClick={() => {
              setTab(k);
              setMsg(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "paste" ? (
        <div className="plg-install-body">
          <textarea
            className="input plg-paste"
            rows={5}
            placeholder={"export const manifest = { id: \"my.plugin\", name: \"…\", version: \"0.1.0\", permissions: [\"info:read\"] };\nexport default async (ctx) => { /* ctx.onethu.* */ }"}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <div className="plg-install-foot">
            <span className="plg-hint">粘贴完整模块代码，安装即激活。</span>
            <button className="btn btn-primary" disabled={busy || !code.trim()} onClick={() => void install(code)}>
              {busy ? "安装中…" : "安装"}
            </button>
          </div>
        </div>
      ) : null}

      {tab === "jsfile" ? (
        <div className="plg-install-body">
          <label className="plg-filebox">
            <input
              type="file"
              accept=".js,.mjs,text/javascript"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void f.text().then(install);
                e.target.value = "";
              }}
            />
            <span className="plg-filebox-t">点击选择 .js / .mjs 插件文件</span>
            <span className="plg-filebox-d">读取文件内容后与「粘贴安装」走同一校验管线</span>
          </label>
        </div>
      ) : null}

      {tab === "rust" ? (
        <div className="plg-install-body">
          <button type="button" className="plg-filebox" disabled={busy} onClick={() => void installRust()}>
            <span className="plg-filebox-t">{busy ? "打开系统对话框…" : "选择 manifest.json（系统文件对话框）"}</span>
            <span className="plg-filebox-d">二进制须与 manifest.json 同目录（桌面端 sidecar 形态；Android 内置核心无需安装）</span>
          </button>
        </div>
      ) : null}

      {tab === "github" ? (
        <div className="plg-install-body">
          <input
            className="input"
            placeholder="user/repo 或 https://github.com/user/repo（可 @branch 或 /tree/branch）"
            value={repoInput}
            onChange={(e) => setRepoInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy && repoInput.trim()) void installFromRepoText(repoInput).catch((e2: unknown) => setMsg(`安装失败：${String(e2 instanceof Error ? e2.message : e2).slice(0, 200)}`));
            }}
          />
          <div className="plg-install-foot">
            <span className="plg-hint">从仓库根目录拉取 plugin.js（或 index.js / main.js），与粘贴安装同一校验管线。</span>
            <button className="btn btn-primary" disabled={busy || !repoInput.trim()} onClick={() => void installFromRepoText(repoInput).catch((e2: unknown) => setMsg(`安装失败：${String(e2 instanceof Error ? e2.message : e2).slice(0, 200)}`))}>
              {busy ? "安装中…" : "安装"}
            </button>
          </div>
        </div>
      ) : null}


      <div className="plg-install-foot plg-install-msg">
        {msg ? <span className="plg-msg">{msg}</span> : <span className="plg-hint">安装即代表信任该代码并授予其声明的权限。</span>}
        <button className="btn btn-ghost" onClick={onClose}>
          完成
        </button>
      </div>
    </section>
  );
}
