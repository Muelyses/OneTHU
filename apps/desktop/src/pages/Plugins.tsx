/**
 * 插件页（侧栏一级入口「插件」）：
 * 三区信息架构——电表概览条 / 模块卡（开关·设置·日志·删除 + 命令）/ 安装面板。
 * 设置与运行日志走底部 Sheet：设置显式「保存」+ 已保存回执（不再静默落盘）；
 * 日志全高终端（时间戳 + 方法符着色 + 自动贴底 + 打断/清空）。
 */
import { compareVersions, fetchEntryFromMarket, fetchEntryFromRepo, fetchLiveVersion, fetchRemoteManifestFromRepoRef, fetchRegistry, fetchStarMap, normalizeRepoUrl, parseRepoInput, type MarketEntry } from "../lib/market.js";
import { IconGithub } from "../components/Icons";
import { createPortal } from "react-dom";
import type { CommandResult } from "../plugins/types.js";
import { loadMcpServers, saveMcpServers, type McpServerEntry } from "../lib/mcpStore.js";
import { openFormModal } from "../lib/formModal.js";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useSyncExternalStore, useEffect, useRef, useState, type ReactNode } from "react";
import { confirmOk } from "../lib/confirm.js";
import { Card, LevelBox, PageHead, goEntry, useEntry } from "../components/Layout.js";
import { useApp } from "../state/context.js";
import { navGo } from "../plugins/bridges.js";
import { requestSettingsSection, requestSettingsTab } from "../state/settingsMode.js";
import { OhSettingsPage } from "../components/OhSettingsPage.js";
import { openImageViewer } from "../components/ImageViewer.js";
import { resolveAssetUrl } from "../lib/market.js";
import { useExitHold, useSegPill } from "../lib/motion.js";
import { PluginLogo } from "../components/PluginLogo.js";
import {
  commandsSnapshot, disablePlugin, enablePlugin, installedPlugins,
  isLive, runCommand, subscribe, subscribeCommands, uninstallPlugin,
} from "../plugins/loader.js";
import { addRustPlugin, updatePlugin } from "../plugins/registry.js";
import { clearPluginEvents, pluginEvents, subscribePluginEvents } from "../plugins/events.js";
import { notifyRust } from "../plugins/rust.js";
import { PLUGIN_PERMISSIONS } from "../plugins/types.js";
import { collectWidgetSlots } from "../plugins/pluginWidgets.js";
import { useThemes } from "../state/theme.js";

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

/** 动态选项（optionsFrom）：设置里存 JSON 数组（如 madmodelModels 实时名单）；
 *  合并静态兜底项（空值/默认），解析失败退静态。 */
function optionsFor(f: any, live: Record<string, string>): Array<{ value: string; label: string }> {
  const raw = f.optionsFrom ? live[f.optionsFrom] : "";
  const statik: Array<{ value: string; label: string }> = f.options ?? [];
  if (!raw) return statik;
  try {
    const ids: unknown = JSON.parse(raw);
    if (Array.isArray(ids) && ids.length) {
      const base = statik.filter((o) => !o.value);
      return [...base, ...ids.map((id) => ({ value: String(id), label: String(id) }))];
    }
  } catch {
    /* 退静态 */
  }
  return statik;
}

/* ── ④ 跨页「带参数打开插件页」请求（**只带筛选参数**；入口态一律走 Layout 的 goEntry）──
   外部（外观与布局的「安装主题」等）写请求 → 插件页挂载或已挂载时消费：
     requestPluginsView({ view: "market", category: "theme" })
   ⑤ 筛选状态同时做**模块级记忆**（同一会话内），返回再进不会丢。 */
export type PluginsViewReq = { view?: "mine" | "market"; category?: "all" | "theme" | "general" };

/** 插件页 →「外观与布局 → 主题」的反向跳转（用户点名那条：主题卡片上的按钮原来是死的）。
 *  三级请求一起下：页签 + 分区（滚动并高亮）+ 导航；手机端设置就是「我的」页，同一条路径。 */
export function gotoAppearanceTheme(): void {
  requestSettingsSection("主题");
  requestSettingsTab("外观与布局");
  goEntry("settings"); // 入口态唯一来源
}
let pendingPluginsView: PluginsViewReq | null = null;
const pluginsViewListeners = new Set<() => void>();
let lastPluginsView: "mine" | "market" = "mine";
let lastPluginsCat: "all" | "theme" | "general" = "all";

/* 视图/类别的"筛选参数"仍走一次性（这本来就不是入口态）；**入口态一律走状态机** */
export function requestPluginsView(req: PluginsViewReq): void {
  pendingPluginsView = { ...req };
  for (const f of pluginsViewListeners) f();
  goEntry("plugins");
}
function takePluginsView(): PluginsViewReq | null {
  const v = pendingPluginsView;
  pendingPluginsView = null;
  return v;
}

export function PluginsPage({ embedded = false }: { embedded?: boolean } = {}): ReactNode {
  const allPlugins = useSyncExternalStore(subscribe, installedPlugins);
  const cmds = useSyncExternalStore(subscribeCommands, commandsSnapshot);
  const [view, setView] = useState<"mine" | "market">(lastPluginsView); // ⑤ 恢复上次的筛选
  const [segRef, pillRef] = useSegPill();
  const [cat, setCat] = useState<"all" | "theme" | "general">(lastPluginsCat);
  const [instOpen, setInstOpen] = useState(false);
  const themesSnap = useThemes();
  /* ② 用户拍板：OH（onethu.harness）是**特殊插件**，不出现在普通插件页的卡片区
     ——它的模型/MCP/日志/权限全部搬进「OneTHU Harness」子页的高级配置里就地渲染。 */
  const listPlugins = allPlugins.filter((p) => p.manifest.id !== "onethu.harness");
  const plugins = cat === "all" ? listPlugins : listPlugins.filter((p) => (p.manifest.category ?? "general") === cat);
  const [sheet, setSheet] = useState<{ id: string; mode: "settings" | "log" | "mcp" } | null>(null);
  /* 插件设置 / MCP / 运行日志 Sheet：关闭时多挂 240ms 播完退场，而不是瞬间消失 */
  const sheetHold = useExitHold(sheet, 240);
  /** 市场名单版本（5 分钟缓存内零开销；用于已装卡片「可更新」提示） */
  const [marketVersions, setMarketVersions] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    void (async () => {
      let map: Record<string, string> = {};
      try {
        const reg = await fetchRegistry();
        if (!alive) return;
        for (const it of reg.plugins) map[it.id] = it.version;
        setMarketVersions(map);
      } catch { /* 名单不可用时维持快照空表 */ }
      // 实时版本：对已安装、有仓库来源的插件逐个拉本地最新 manifest
      // 失败的插件保留名单快照值（网站的说明同步了这一点）
      for (const p of allPlugins) {
        if (!alive) break;
        if (p.manifest.kind === "rust" || p.embedded || p.builtin || p.manifest.id === "onethu.harness") continue;
        if (!p.repo) continue;
        try {
          const ref = parseRepoInput(p.repo);
          const entry = (p.manifest as unknown as { entry?: string }).entry;
          const v = await fetchLiveVersion(ref, entry);
          if (!alive) break;
          if (v) setMarketVersions((prev) => ({ ...prev, [p.manifest.id]: v }));
        } catch { /* 单点失败不阻塞下一项 */ }
      }
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [view]);
  const liveCount = plugins.filter((p) => p.enabled && isLive(p.manifest.id)).length;
  const coreCount = plugins.filter((p) => p.embedded).length;

  /* R23：视图切换回归全局 .segmented 药丸口径（此前误用 seg-track 滚动条样式，
      全宽拉伸 + 抓手光标 + 11px 小字，与整体 UI 明显不符——霖实测）。
      §4.4b：嵌进设置页时保留这个切换器（它是「我的插件 / 插件市场」的唯一入口），只去掉页面级大标题。 */
  const viewSwitch = (
    <div className="segmented" ref={segRef} style={{ marginBottom: 0 }}>
      <span className="seg-pill" ref={pillRef} aria-hidden="true" />
      {([["mine", "我的插件"], ["market", "插件市场"]] as const).map(([k, lbl]) => (
        <button key={k} className={view === k ? "is-active" : ""} onClick={() => setView(k)}>
          {lbl}
        </button>
      ))}
    </div>
  );

  /* ── D（2026-10-11 用户纠正）：OH 是**插件页的二级子页面**（基础设置 / 高级配置），
        不再挂在设置页签下。这里是最小接入：旗标落下 → 同一页壳渲染 OH 子页 + 返回按钮。
        （task-17 抽出 PluginSettingsForm 后，OH 高级档直接接在那边，本段不用再动。） ── */
  const { navigate } = useApp();
  /* ① 唯一状态机：ohOpen **不再是独立 state**，而是由 entry 派生（entry === "oh"）。
     高亮、页面、子页三者同一个来源，不存在"颜色/状态对不上"的可能。 */
  const entry = useEntry();
  const ohOpen = entry === "oh";
  /** OH 内联设置面板的「草稿有改动」标记（就地渲染时不再弹确认窗，标记仅为兼容其 props） */
  const ohDirtyRef = useRef(false);

  /* ⑤ 记住筛选状态（会话内）：离开插件页再回来不丢 */
  useEffect(() => {
    lastPluginsView = view;
  }, [view]);
  useEffect(() => {
    lastPluginsCat = cat;
  }, [cat]);
  /* ④ 消费跨页请求：挂载时补一次 + 订阅（已挂载时由订阅即时生效） */
  useEffect(() => {
    const apply = (): void => {
      const req = takePluginsView();
      if (req) {
        if (req.view) setView(req.view);
        if (req.category) setCat(req.category);
      }
      /* 入口态由 requestPluginsView 自己走 goEntry（见该函数）；这里不再有旗标消费 */
    };
    apply();
    pluginsViewListeners.add(apply);
    /* ① 「插件」格请求：显式关子页（这就是"点完 OH 回不到插件"的根因） */
      return () => {
      pluginsViewListeners.delete(apply);
    };
  }, []);
  const isPhone = typeof document !== "undefined" && document.documentElement.classList.contains("is-phone");
  /* ① 用户拍板：三个并列（设置 / 插件 / OneTHU Harness），**用共享组件 LevelBox**——
     任何页面同一个容器、同高、三格齐全；每页自己的大标题照旧保留（框是框、标题是标题）。 */
  const dualEntry = isPhone ? <LevelBox /> : null;
  /** ⑤「安装插件」按层级归位：放页头右侧，不再挤在类别筛选那一行里 */
  const installBtn = (
    <button className="btn btn-ghost plg-install-toggle" onClick={() => setInstOpen((o) => !o)}>
      {instOpen ? "收起安装" : "安装插件"}
    </button>
  );
  /* ② OH 的模型/MCP/日志**就地**渲染在子页高级配置里（复用同一批面板实现，不跳 sheet、不复制） */
  const ohRec = allPlugins.find((p) => p.manifest.id === "onethu.harness");
  const ohCmds = cmds.filter((c) => c.pluginId === "onethu.harness");
  const ohPerms = (ohRec?.manifest.permissions ?? []) as string[];
  const ohAdvancedPanels = (
    <>
      {/* ② 权限胶囊 + 命令清单：原来长在插件页的 OH 卡片上，现在**就地**放高级配置（卡片区已不许出现 OH） */}
      <div className="setting-row is-copy">
        <div>
          <div className="setting-title">权限（{ohPerms.length}）</div>
          <div className="setting-desc">
            {ohPerms.length > 0 ? ohPerms.map((p) => PLUGIN_PERMISSIONS.find((x) => x.id === p)?.label ?? p).join(" · ") : "未声明额外权限"}
          </div>
        </div>
      </div>
      <div className="setting-row is-copy">
        <div>
          <div className="setting-title">命令清单（{ohCmds.length}）</div>
          <div className="setting-desc">{ohCmds.length > 0 ? ohCmds.map((c) => c.id).join(" · ") : "暂无命令"}</div>
        </div>
      </div>
      {ohRec ? <SettingsBody id="onethu.harness" rec={ohRec} onClose={() => undefined} dirtyRef={ohDirtyRef} /> : null}
      <McpBody />
      <LogBody id="onethu.harness" />
    </>
  );

  if (ohOpen) {
    return (
      <div className="plg-page">
        {/* 标题「OH」+ 一行副标题；返回靠顶部那格里选「插件」（不再有第二个返回入口） */}
        {/* ① 主标题必须写全名「OneTHU Harness」（用户点名不许用 OH 简称），副标题保留两档说明 */}
        <PageHead
          title="OneTHU Harness"
          meta={<span>基础设置 / 高级配置</span>}
        />
                {/* 子页也带三格框（第三格高亮由子状态推导，不再传死 active） */}
        {isPhone ? <LevelBox /> : null}
        <Card>
          <OhSettingsPage advancedPanels={ohAdvancedPanels} />
        </Card>
      </div>
    );
  }

  return (
    <div className="plg-page">
      {dualEntry}
      {embedded ? (
        <div className="plg-embed-bar" style={{ marginBottom: 12 }}>{viewSwitch}{installBtn}</div>
      ) : (
        <PageHead
          title="插件"
          meta={
            <span>
              经 <code className="plg-code">onethu.*</code> 公共接口扩展 OneTHU——权限门禁、会话自愈、
              45s 超时由宿主统一承担
            </span>
          }
          actions={<>{viewSwitch}{installBtn}</>}
        />
      )}

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


      {/* 主题管理区（安装/卸载）：主题即插件，安装面在插件页。
          切换主题在 设置 → 外观（唯一入口）——2026-02 用户反馈切换入口错位到插件页；
          2026-09-13 原定案「设置页不放」针对的是管理面，与切换入口不冲突。 */}
      {view === "market" ? (
        <MarketView cat={cat} setCat={setCat} />
      ) : (
        <>
      {instOpen ? <InstallPanel onClose={() => setInstOpen(false)} /> : null}

      {/* 我的插件 · 工具行：类别页签 + 安装入口（归拢一行；主切换只留视图级） */}
      <div className="plg-toolbar">
        <div className="segmented" style={{ marginBottom: 0 }}>
          {([["all", `全部 ${listPlugins.length}`], ["theme", `主题 ${themesSnap.themes.length}`], ["general", `通用 ${listPlugins.filter((p) => (p.manifest.category ?? "general") === "general").length}`]] as const).map(([k, lbl]) => (
            <button key={k} className={cat === k ? "is-active" : ""} onClick={() => setCat(k)}>
              {lbl}
            </button>
          ))}
        </div>
      </div>


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
          还没有启用中的主题插件。换主题在「外观与布局 → 主题」；启用 / 停用走那里的「管理主题」；
          安装走那里的「安装主题」（会打开插件市场的主题筛选）。
        </div>
      ) : (
        <div className="plg-rack">
          {plugins.map((p, i) => (
            <PluginCard key={p.manifest.id} id={p.manifest.id} index={i} onOpenSheet={setSheet} marketVersion={marketVersions[p.manifest.id]} onGoMarket={() => setView("market")} />
          ))}
        </div>
      )}

      {sheetHold.mounted && sheetHold.held ? (
        <PluginSheet
          id={sheetHold.held.id}
          mode={sheetHold.held.mode}
          closing={sheetHold.closing}
          onClose={() => setSheet(null)}
        />
      ) : null}
        </>
      )}
    </div>
  );
}

/* ═══════════════ 模块卡 ═══════════════ */

/** 结构化命令结果渲染：markdown（GFM）+ 条目列表 + 键值对 */
function ResultBlock({ result }: { result: CommandResult }): ReactNode {
  if (!result.markdown && !result.items?.length && !result.kv?.length) return null;
  return (
    <div className="plg-result">
      {result.markdown ? (
        <div className="plg-result-md">
          <Markdown remarkPlugins={[remarkGfm]}>{result.markdown}</Markdown>
        </div>
      ) : null}
      {result.kv?.length ? (
        <div className="plg-result-kv">
          {result.kv.map((x, i) => (
            <div key={i} className="plg-result-kvrow">
              <span className="plg-result-kvk">{x.k}</span>
              <span className="plg-result-kvv">{x.v}</span>
            </div>
          ))}
        </div>
      ) : null}
      {result.items?.length ? (
        <div className="plg-result-items">
          {result.items.slice(0, 30).map((it, i) => (
            <div key={i} className="plg-result-item">
              <div className="plg-result-item-t">{it.title}</div>
              {it.subtitle ? <div className="plg-result-item-s">{it.subtitle}</div> : null}
              {it.meta ? <div className="plg-result-item-m">{it.meta}</div> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PluginCard({
  id,
  index,
  onOpenSheet,
  marketVersion,
  onGoMarket,
  checkBusy,
  checkMsg,
  repoRemote,
  onCheckUpdate,
  onUpdateNow,
}: {
  id: string;
  index: number;
  onOpenSheet: (s: { id: string; mode: "settings" | "log" | "mcp" }) => void;
  /** 市场名单里该插件的版本（有新版时卡片显示「可更新」徽标；本仓检查出更新后以本仓为准，市场徽标隐藏） */
  marketVersion?: string;
  onGoMarket?: () => void;
  /** 「检查更新」进行中 */
  checkBusy?: boolean;
  /** 检查/更新结果的一行反馈（贴在按钮下方） */
  checkMsg?: string | null;
  /** 本体仓库检查出的最新版本（>本机 解锁「更新」按钮；存在时市场徽标让位） */
  repoRemote?: string | null;
  onCheckUpdate?: () => void;
  onUpdateNow?: (remoteVersion: string) => void;
}): ReactNode {
  const [repoCheck, setRepoCheck] = useState<{ busy: boolean; msg: string | null; remote: string | null }>({ busy: false, msg: null, remote: null });
  /** 公告「知道了」后的重渲染计票器（持久化状态在 localStorage，这里只重载 UI） */
  const [noticeTick, setNoticeTick] = useState(0);
  const plugins = useSyncExternalStore(subscribe, installedPlugins);
  const rec = plugins.find((p) => p.manifest.id === id);
  const cmds = useSyncExternalStore(subscribeCommands, commandsSnapshot).filter((c) => c.pluginId === id);
  const [open, setOpen] = useState(false);
  const [runMsg, setRunMsg] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<CommandResult | null>(null);
  const [input, setInput] = useState("");
  if (!rec) return null;
  const m = rec.manifest;
  /** 本插件声明的小组件所占槽位（卡片上标出来，用户才知道该放哪个「OneTHU 插件小组件 N」） */
  const widgetSlots = collectWidgetSlots().filter((x) => x.pluginId === id);
  const active = rec.enabled && isLive(id);
  const failed = rec.enabled && !isLive(id);
  const stateText = active ? "运行中" : failed ? "加载失败" : "已停用"; // ui-copy-lint-ok: 状态标签，同一行操作区就有「日志」按钮

  /** 从插件本体仓库读最新 manifest（本体仓库优先；失败给出面向用户的一行反馈） */
  const checkUpdate = async (): Promise<void> => {
    if (!rec || !rec.repo || m.kind === "rust") return;
    setRepoCheck({ busy: true, msg: "正在从插件本体仓库获取最新版本…", remote: null });
    try {
      const ref = parseRepoInput(rec.repo);
      const entry = (m as unknown as { entry?: string }).entry;
      const remote = await fetchRemoteManifestFromRepoRef(ref, entry);
      if (remote.id !== m.id) {
        setRepoCheck({ busy: false, msg: "失败：仓库里是另一个 id 的插件（可能仓库被复用），请检查来源", remote: null });
        return;
      }
      if (compareVersions(remote.version, m.version) > 0) {
        setRepoCheck({ busy: false, msg: `插件仓库有新版本 v${remote.version}（本机 v${m.version}）`, remote: remote.version });
      } else {
        setRepoCheck({ busy: false, msg: `已是最新（仓库版本 v${remote.version}）`, remote: remote.version });
      }
    } catch (e) {
      setRepoCheck({ busy: false, msg: `失败：${String(e instanceof Error ? e.message : e).slice(0, 160)}`, remote: null });
    }
  };
  /** 一键更新：与安装同一管线，覆盖安装并重新激活 */
  const updateNow = async (remoteVersion: string): Promise<void> => {
    setRepoCheck({ busy: true, msg: `正在从本体仓库更新到 v${remoteVersion}…`, remote: remoteVersion });
    try {
      const ref = parseRepoInput(rec!.repo!);
      const entry = (m as unknown as { entry?: string }).entry;
      const text = await fetchEntryFromRepo(ref, entry);
      const { installPlugin } = await import("../plugins/loader.js");
      const nm = await installPlugin(text, { repo: normalizeRepoUrl(rec!.repo!) });
      setRepoCheck({ busy: false, msg: `已更新并重新激活：${nm.name} v${nm.version}`, remote: null });
    } catch (e) {
      setRepoCheck({ busy: true, msg: `更新失败：${String(e instanceof Error ? e.message : e).slice(0, 160)}`, remote: remoteVersion });
    }
  };

  const doRun = async (cmdId: string): Promise<void> => {
    setRunMsg("执行中…");
    setRunResult(null);
    try {
      const r = (await runCommand(id, cmdId, input)) as CommandResult | string | null;
      if (r == null) {
        setRunMsg("完成");
      } else if (typeof r === "string") {
        setRunMsg(r.slice(0, 400));
      } else if (typeof r === "object") {
        setRunResult(r);
        setRunMsg(typeof r.text === "string" ? r.text.slice(0, 200) : null);
      } else {
        setRunMsg(String(r).slice(0, 400));
      }
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
            {widgetSlots.length > 0 ? (
              <span
                className="plg-core"
                style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
                title={`桌面小组件：把「OneTHU 插件小组件 ${widgetSlots.map((x) => x.slot).join(" / ")}」放到桌面即可看到本插件的内容`}
              >
                小组件 {widgetSlots.map((x) => x.slot).join("/")}
              </span>
            ) : null}
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
              <IconGithub width={16} height={16} />
            </button>
          ) : null}
          <Switch on={rec.enabled} label={rec.enabled ? "停用" : "启用"} onToggle={() => void (rec.enabled ? disablePlugin(id) : enablePlugin(id)).catch((e: unknown) => setRunMsg(String(e)))} />
          {id === "onethu.harness" ? (
            <button className="btn btn-ghost" title="管理 MCP 服务器" onClick={() => onOpenSheet({ id, mode: "mcp" })}>
              MCP
            </button>
          ) : null}
          {/* 主题类插件：动作行里一处（**与检查更新/设置/删除同为纯文字**，不再用 chip 胶囊） */}
          {m.category === "theme" ? (
            <button className="btn btn-ghost" title="到「外观与布局 → 主题」里切换（会高亮那一节）" onClick={() => gotoAppearanceTheme()}>
              去切换主题
            </button>
          ) : null}
          {rec.repo && m.kind !== "rust" && !rec.embedded && !rec.builtin && id !== "onethu.harness" ? (
            <button className="btn btn-ghost" title={`从 ${rec.repo} 检查最新版（本体仓库优先，市场兜底）`} disabled={checkBusy || repoCheck.busy} onClick={() => { onCheckUpdate?.(); void checkUpdate().catch(() => undefined); }}>
              {checkBusy || repoCheck.busy ? "检查中…" : "检查更新"}
            </button>
          ) : null}
          {(repoCheck.remote || repoRemote) && compareVersions(repoCheck.remote ?? "", m.version) > 0 ? (
            <button
              className="btn btn-primary"
              title={`从插件本体仓库更新到 v${repoCheck.remote || repoRemote}（与安装同一管线，覆盖更新并重新激活）`}
              disabled={repoCheck.busy || checkBusy}
              onClick={() => {
                const v = repoCheck.remote || repoRemote;
                if (v) void updateNow(v).catch(() => undefined);
              }}
            >
              {repoCheck.busy ? "更新中…" : `更新至仓库版 v${repoCheck.remote || repoRemote}`}
            </button>
          ) : null}
          {!repoCheck.remote && !repoRemote && marketVersion && compareVersions(marketVersion, m.version) > 0 ? (
            <button className="btn btn-ghost plg-update-flag" title={`市场已有 v${marketVersion}`} onClick={() => onGoMarket?.()}>
              可更新 ↑
            </button>
          ) : null}
          <button className="btn btn-ghost" onClick={() => onOpenSheet({ id, mode: "settings" })}>
            设置
          </button>
          {m.kind === "rust" ? (
            <button className="btn btn-ghost" onClick={() => onOpenSheet({ id, mode: "log" })}>
              日志
            </button>
          ) : null}
          {rec.embedded || rec.builtin || m.id === "onethu.harness" ? null : (
            <button className="btn btn-ghost plg-danger" onClick={() => void uninstallPlugin(id)}>
              删除
            </button>
          )}
        </div>
      </div>

      {m.description ? <p className="plg-desc">{m.description}</p> : null}

      {(() => {
        if (!rec?.notice?.text) return null;
        const seen = (() => {
          try {
            const acks = JSON.parse(localStorage.getItem("onethu.plugin.notice.ack") ?? "{}") as Record<string, string>;
            return acks[m.id] === rec.notice!.digest;
          } catch { return false; }
        })();
        if (seen) return null;
        const ack = () => {
          try {
            const acks = JSON.parse(localStorage.getItem("onethu.plugin.notice.ack") ?? "{}") as Record<string, string>;
            acks[m.id] = rec.notice!.digest;
            localStorage.setItem("onethu.plugin.notice.ack", JSON.stringify(acks));
            setNoticeTick((v) => v + 1);
          } catch { /* noop */ }
        };
        return (
          <div className="plg-notice" style={{ background: "var(--surface-2)", border: "1px solid var(--accent-border)", borderRadius: "var(--r-md)", padding: "10px 12px", margin: "8px 0 4px" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "baseline", justifyContent: "space-between" }}>
              <b style={{ color: "var(--accent)" }}>📢 插件公告</b>
              <button className="btn btn-ghost" onClick={ack}>知道了</button>
            </div>
            <div style={{ whiteSpace: "pre-wrap", marginTop: 6, maxHeight: 132, overflow: "auto", color: "var(--text-1)", fontSize: 12.5, lineHeight: 1.5 }}>
              {rec.notice.text.slice(0, 1600)}
            </div>
          </div>
        );
      })()}

      {(repoCheck.msg || checkMsg) ? (
        <p className="plg-desc" style={{ color: (repoCheck.msg ?? checkMsg ?? "").startsWith("失败") || (repoCheck.msg ?? checkMsg ?? "").includes("失败") ? "var(--red)" : "var(--text-2)" }}>
          {repoCheck.msg ?? checkMsg}
        </p>
      ) : null}

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
                    {runResult && (runResult.markdown || runResult.items?.length || runResult.kv?.length) ? (
                      <ResultBlock result={runResult} />
                    ) : null}
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
  closing,
  onClose,
}: {
  id: string;
  mode: "settings" | "log" | "mcp";
  /** 退场相位：真值时挂 .is-closing 播完退场再由父级卸载 */
  closing: boolean;
  onClose: () => void;
}): ReactNode {
  const plugins = useSyncExternalStore(subscribe, installedPlugins);
  const rec = plugins.find((p) => p.manifest.id === id);
  // R23（霖实测：设置卡片外误点一下直接关闭丢修改）：
  //  ① 拖拽出界不算点遮罩——按下起点在遮罩上才允许 onClick 关闭（浏览器把
  //     「卡内按下、遮罩抬起」的 click 派发到二者公共祖先 = 遮罩，旧判定误关）；
  //  ② 设置草稿有改动时关闭前 confirmOk，绝不静默丢弃。
  const downOnMask = useRef(false);
  const dirtyRef = useRef(false);
  const requestClose = (): void => {
    if (!dirtyRef.current) return onClose();
    void confirmOk("设置有未保存的修改，关闭将丢失。确定关闭？").then((ok) => {
      if (ok) onClose();
    });
  };
  if (!rec) return null;
  const title = mode === "settings" ? "设置" : mode === "mcp" ? "MCP 服务器" : "运行日志";
  return createPortal(
    <div
      className={"plg-mask" + (closing ? " is-closing" : "")}
      onPointerDown={(e) => {
        downOnMask.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (downOnMask.current && e.target === e.currentTarget) requestClose();
      }}
    >
      <section
        className={"plg-sheet" + (closing ? " is-closing" : "")}
        role="dialog"
        aria-label={`${title} · ${rec.manifest.name}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="plg-sheet-head">
          <b>{title} · {rec.manifest.name}</b>
          <button className="btn btn-ghost" onClick={requestClose}>
            关闭
          </button>
        </div>
        {mode === "settings" ? (
          <SettingsBody id={id} rec={rec} onClose={onClose} dirtyRef={dirtyRef} />
        ) : mode === "mcp" ? (
          <McpBody />
        ) : (
          <LogBody id={id} />
        )}
      </section>
    </div>
    ,
    document.body,
  );
}

/** MCP 服务器管理：逐条增删改（表单弹窗），存宿主侧结构化存储，OH 启动对话时经 settings 注入 */
export function McpBody(): ReactNode {
  const [list, setList] = useState<McpServerEntry[]>(() => loadMcpServers());
  const save = (next: McpServerEntry[]): void => {
    setList(next);
    saveMcpServers(next);
  };
  const edit = async (idx: number): Promise<void> => {
    const cur = list[idx];
    const f = await openFormModal(idx === -1 ? "添加 MCP 服务器" : `编辑 MCP 服务器 · ${cur?.name ?? ""}`, [
      { key: "name", label: "名称（工具前缀 mcp_<name>_）", required: true, default: cur?.name ?? "" },
      { key: "command", label: "启动命令", required: true, default: cur?.command ?? "", placeholder: "npx / uvx / /usr/bin/node …" },
      { key: "args", label: "参数（空格分隔，含引号的项用单引号包裹）", kind: "textarea", default: cur?.args.join(" ") ?? "", placeholder: '-y @modelcontextprotocol/server-filesystem /Users/me/docs' },
      { key: "env", label: "环境变量（KEY=VALUE，空格分隔多个）", default: Object.entries(cur?.env ?? {}).map(([k, v]) => `${k}=${v}`).join(" ") },
    ]);
    if (!f) return;
    const parseSpaceList = (v: string): string[] =>
      (v.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []).map((x) => x.replace(/^["']|["']$/g, ""));
    const env: Record<string, string> = {};
    for (const pair of parseSpaceList(f.env ?? "")) {
      const i = pair.indexOf("=");
      if (i > 0) env[pair.slice(0, i)] = pair.slice(i + 1);
    }
    const entry: McpServerEntry = { name: f.name?.trim() ?? "", command: f.command?.trim() ?? "", args: parseSpaceList(f.args ?? ""), env };
    const next = list.slice();
    if (idx === -1) next.push(entry);
    else next[idx] = entry;
    save(next);
  };
  const del = async (idx: number): Promise<void> => {
    const { confirmOk } = await import("../lib/confirm.js");
    const target = list[idx];
    if (!target) return;
    if (!(await confirmOk(`删除 MCP 服务器「${target.name}」？`))) return;
    save(list.filter((_, i) => i !== idx));
  };
  return (
    <div className="mcp-body">
      <div className="plg-hint" style={{ marginBottom: 8 }}>
        每条为一个 stdio MCP server；OH 对话时其工具以 <code className="plg-code">mcp_&lt;名称&gt;_&lt;工具&gt;</code> 注入。
      </div>
      {!list.length ? <div className="plg-hint">尚未添加。点「添加 MCP 服务器」开始。</div> : null}
      {list.map((sv, i) => (
        <div key={`${sv.name}:${i}`} className="mcp-item">
          <div className="mcp-item-main">
            <div className="mcp-item-name">{sv.name}</div>
            <code className="plg-code">{sv.command} {sv.args.join(" ")}</code>
          </div>
          <div style={{ display: "flex", gap: 4, flex: "none" }}>
            <button className="btn btn-ghost" onClick={() => void edit(i)}>编辑</button>
            <button className="btn btn-ghost plg-danger" onClick={() => void del(i)}>删除</button>
          </div>
        </div>
      ))}
      <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={() => void edit(-1)}>
        ＋ 添加 MCP 服务器
      </button>
    </div>
  );
}

/** 设置：本地草稿 + 显式保存 + 已保存回执（设置在插件下一轮运行时实时读取）。
 *  R23：dirtyRef 上报未保存改动（Sheet 关闭前据此确认）；onClose 供无配置项分支直接关闭。 */
export function SettingsBody({
  id, rec, onClose, dirtyRef,
}: { id: string; rec: any; onClose: () => void; dirtyRef: { current: boolean } }): ReactNode {
  const fields = rec.manifest.settings ?? [];
  const [draft, setDraft] = useState<Record<string, string>>({ ...rec.settings });
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  /** 草稿改动标记：editDraft 置 true，保存成功复位 */
  const editDraft = (fn: (d: Record<string, string>) => Record<string, string>): void => {
    dirtyRef.current = true;
    setDraft(fn);
  };

  // 自动维护字段（MadModel token 等）永远以**当前实时值**保存：草稿是打开面板那一刻的
  // 快照，泵在此之后签发的 token 会被陈旧草稿覆盖成空 → 免费档静默失效（用户实录 2026-09-20）
  const liveSettings: Record<string, string> = { ...(rec.settings ?? {}) };

  const save = (): void => {
    setSaving(true);
    try {
      const payload: Record<string, string> = { ...draft };
      for (const f of fields as any[]) if (f.auto) payload[f.key] = liveSettings[f.key] ?? "";
      updatePlugin(id, { settings: payload });
      dirtyRef.current = false;
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
          <button className="btn btn-ghost" onClick={onClose}>
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
              {f.auto ? (
                /* 自动维护：只读展示实时值（不受草稿影响），避免手改与误覆盖 */
                <input className="input" type="text" readOnly value={liveSettings[f.key] ?? ""} placeholder="（尚未签发）" />
              ) : f.type === "select" ? (
                <select
                  className="input"
                  value={draft[f.key] ?? ""}
                  onChange={(e) => editDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                >
                  {optionsFor(f, liveSettings).map((o: { value: string; label: string }) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              ) : f.type === "textarea" ? (
                <textarea
                  className="input"
                  rows={3}
                  placeholder={f.placeholder ?? ""}
                  value={draft[f.key] ?? ""}
                  onChange={(e) => editDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                />
              ) : (
                <input
                  className="input"
                  type={f.type === "password" ? "password" : "text"}
                  placeholder={f.placeholder ?? ""}
                  value={draft[f.key] ?? ""}
                  onChange={(e) => editDraft((d) => ({ ...d, [f.key]: e.target.value }))}
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
export function LogBody({ id }: { id: string }): ReactNode {
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

function MarketView({
  cat,
  setCat,
}: {
  cat: "all" | "theme" | "general";
  setCat: (c: "all" | "theme" | "general") => void;
}): ReactNode {
  const installed = useSyncExternalStore(subscribe, installedPlugins);
  const installedMap = new Map(installed.map((p) => [p.manifest.id, p.manifest.version]));
  const [items, setItems] = useState<MarketEntry[] | null>(null);
  const [stars, setStars] = useState<Record<string, number | null>>({});
  /** ③ 详情页：点卡片进入（就地渲染，不用弹层） */
  const [detail, setDetail] = useState<MarketEntry | null>(null);
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<"stars" | "latest">("stars"); // ② 默认按 star；可切「最新」
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

  // 进入市场视图即自动加载：缓存命中（5 分钟内）立即展示，否则拉网络
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const q = query.trim().toLowerCase();
  const hits = (items ?? [])
    /* ④ 类别筛选也作用于市场：外观与布局的「安装主题」落到 view=market&category=theme 时，
       这里必须真的只列主题条目 */
    .filter((x) => cat === "all" || (cat === "theme" ? (x.category ?? "general") === "theme" : (x.category ?? "general") === "general"))
    .filter((x) => !q || [x.name, x.description, x.author, ...(x.tags ?? [])].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)))
    .slice()
    .sort((a, b) => {
      if (sortBy === "latest") return 0; // 「最新」= 市场名单原序（registry 里就是按收录时间倒序维护）
      const sa = stars[a.id] ?? -1;
      const sb = stars[b.id] ?? -1;
      if (sa !== sb) return sb - sa; // star 缺失（null）沉底
      return a.name.localeCompare(b.name);
    });

  /* ③ 详情页（就地渲染，不用弹层）：作者上传的全部简介图 + 详情正文（markdown）+ 主题开关 */
  if (detail) {
    const shots = (detail.screenshots ?? []).map((x) => resolveAssetUrl(x, detail.repo)).filter(Boolean);
    const head = resolveAssetUrl(detail.thumbnail ?? detail.logo, detail.repo);
    const rec = installed.find((p) => p.manifest.id === detail.id);
    const on = !!rec?.enabled;
    return (
      <section className="market-view">
        <div className="market-detail-head">
          <button className="btn btn-ghost" onClick={() => setDetail(null)}>返回</button>
          {head ? (
            <img className="market-detail-logo" src={head} alt="" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
          ) : (
            <span className="market-card-logo is-mono">{monogram(detail.name, detail.id)}</span>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <b style={{ fontSize: 16 }}>{detail.name}</b>
              {installedMap.has(detail.id) ? <span className="market-installed-badge">已安装</span> : null}
              {typeof stars[detail.id] === "number" ? <span className="market-card-stars">★ {String(stars[detail.id])}</span> : null}
            </div>
            <div className="market-card-meta">
              v{detail.version}
              {detail.author ? ` · ${detail.author}` : ""}
              {detail.license ? ` · ${detail.license}` : ""}
              {detail.category === "theme" ? " · 主题" : ""}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flex: "none", alignItems: "center" }}>
            {detail.homepage ? (
              <button
                className="btn btn-ghost"
                onClick={() => void (async () => {
                  try {
                    const { openUrl } = await import("@tauri-apps/plugin-opener");
                    await openUrl(detail.homepage!);
                  } catch {
                    window.open(detail.homepage!, "_blank");
                  }
                })()}
              >
                主页
              </button>
            ) : null}
            {/* ④ 主题类插件：详情里直接启用/停用（沿用卡片开关语义） */}
            {rec && detail.category === "theme" ? (
              <button
                className="btn btn-ghost"
                onClick={() => void (on ? disablePlugin(detail.id) : enablePlugin(detail.id)).catch((e: unknown) => setMsg(String(e)))}
              >
                {on ? "停用主题" : "启用主题"}
              </button>
            ) : null}
            {!installedMap.has(detail.id) ? (
              <button className="btn btn-primary" disabled={busy} onClick={() => void install(detail)}>
                安装
              </button>
            ) : null}
          </div>
        </div>

        {shots.length > 0 ? (
          <div className="market-shots">
            {shots.map((src, i) => (
              <button key={i} className="market-shot" onClick={() => openImageViewer(src, `${detail.name} 简介图 ${i + 1}`)}>
                <img src={src} alt={`${detail.name} 简介图 ${i + 1}`} loading="lazy" />
              </button>
            ))}
          </div>
        ) : null}

        {detail.readme || detail.description ? (
          <div className="market-readme">
            <Markdown remarkPlugins={[remarkGfm]}>{detail.readme ?? detail.description ?? ""}</Markdown>
          </div>
        ) : null}

        <div className="plg-hint" style={{ marginTop: 10 }}>
          仓库：{normalizeRepoUrl(detail.repo)}
        </div>
      </section>
    );
  }

  return (
    <section className="market-view">
      <div className="market-bar">
        <input
          className="input market-search"
          placeholder="搜索插件名称 / 描述 / 标签"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {/* ④ 排序：与全站同一套 .segmented 胶囊口径（原来是灰底方框 + 描边的 seg-track） */}
        <div className="segmented" style={{ marginBottom: 0 }}>
          {([["stars", "star"], ["latest", "最新"]] as const).map(([k, lbl]) => (
            <button key={k} className={sortBy === k ? "is-active" : ""} onClick={() => setSortBy(k)}>
              {lbl}
            </button>
          ))}
        </div>
        <button className="btn" disabled={busy} onClick={() => void load(true)}>
          {busy ? "刷新中…" : "刷新"}
        </button>
      </div>
      {/* ④ 市场自己的类别筛选：与「我的插件」同一套 .segmented 口径 */}
      <div className="segmented" style={{ margin: "0 0 10px", flexWrap: "wrap" }}>
        {([["all", "全部"], ["theme", "主题"], ["general", "通用"]] as const).map(([k, lbl]) => (
          <button key={k} className={cat === k ? "is-active" : ""} onClick={() => setCat(k)}>
            {lbl}
          </button>
        ))}
      </div>

      {msg ? <div className="plg-runmsg">{msg}</div> : null}

      {!loaded ? (
        msg ? (
          <div className="plg-hint" style={{ color: "var(--red)" }}>
            {msg}
            <button className="btn" style={{ marginLeft: 10 }} disabled={busy} onClick={() => void load(true)}>
              重试
            </button>
          </div>
        ) : (
          <div className="plg-hint">{busy ? "正在拉取市场名单…" : "准备中…"}</div>
        )
      ) : null}

      {loaded && !hits.length ? <div className="plg-hint">无匹配条目。</div> : null}

      {hits.length ? (
        <div className="market-grid">
          {hits.map((item) => {
            const st = stars[item.id];
            return (
              <div key={item.id} className="market-card">
                <div className="market-card-head">
                  {(() => {
                    /* ② 作者 logo / 缩略图；缺失回落既有 monogram（老条目零变化） */
                    const src = resolveAssetUrl(item.thumbnail ?? item.logo, item.repo);
                    return src ? (
                      <img
                        className="market-card-logo"
                        src={src}
                        alt=""
                        loading="lazy"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : (
                      <span className="market-card-logo is-mono">{monogram(item.name, item.id)}</span>
                    );
                  })()}
                  <button className="market-card-name" style={{ background: "none", border: 0, padding: 0, textAlign: "left", cursor: "pointer" }} onClick={() => setDetail(item)}>
                    {item.name}
                    {installedMap.has(item.id) ? <span className="market-installed-badge">已安装</span> : null}
                  </button>
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
                  <button className="btn btn-ghost" style={{ flex: "none" }} onClick={() => setDetail(item)}>详情</button>
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
                    <IconGithub width={16} height={16} />
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
