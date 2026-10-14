/**
 * 插件页（侧栏一级入口「插件」）：
 * 三区信息架构——电表概览条 / 模块卡（开关·设置·日志·删除 + 命令）/ 安装面板。
 * 设置与运行日志走底部 Sheet：设置显式「保存」+ 已保存回执（不再静默落盘）；
 * 日志全高终端（时间戳 + 方法符着色 + 自动贴底 + 打断/清空）。
 *
 * 2026-10-14 OneGUI 换血（判例 7a1805de 云盘 / 3c73347c 图书馆 / 59b3657b 选课）：
 * 电表条 StatTile；视图/类别/排序/安装页签 Segment；模块卡 Card+Row+Tag（状态/类别徽标
 * 走 Tag tone 语义）；启停 OG Switch；公告/市场结果 Banner；命令区 AccordionItem；
 * 结构化结果 Surface sunken+KeyValue+Card list；设置/MCP/日志三合一 OG Sheet
 * （遮罩按下判定与 dirty 确认流原样保留；草稿保存/回执行为零改动）；市场格 Grid+Card
 * flush interactive+Row（详情按钮 / 仓库链接 / 安装梯队全保留）；安装面板 Card+Segment
 * +TextArea（文件选择走隐藏 input + Btn 触发，与 Forum 同款模式）。行为/数据零改动。
 */
import {
  AccordionItem, Avatar, Banner, Btn, Card, Chip, EmptyState, Field, Grid, Grow, IconBtn,
  IconFile, IconGithub, IconPlug, IconStar, Inline, Input, KeyValue, List, LoadingBlock,
  Row, Segment, Select, SettingsRow, Sheet, Spacer, Stack, StatTile, Surface, Switch, Tag,
  TextArea, Text,
} from "@onethu/gui";
import { defineSearchRows } from "../state/searchRows.js";
import { compareVersions, fetchEntryFromMarket, fetchEntryFromRepo, fetchLiveVersion, fetchRemoteManifestFromRepoRef, fetchRegistry, fetchStarMap, normalizeRepoUrl, parseRepoInput, type MarketEntry } from "../lib/market.js";
import type { CommandResult } from "../plugins/types.js";
import { loadMcpServers, saveMcpServers, type McpServerEntry } from "../lib/mcpStore.js";
import { openFormModal } from "../lib/formModal.js";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useSyncExternalStore, useEffect, useRef, useState, type ReactNode } from "react";
import { confirmOk } from "../lib/confirm.js";
import { Card as LayoutCard, LevelBox, PageHead, focusSettingsTarget, goEntry, useEntry } from "../components/Layout.js";
import { requestPluginsFocus, subscribePluginsFocus, takePluginsFocus, type PluginsFocusSpec } from "../state/pluginsFocus.js";
import { showToast } from "../state/toast.js";
import { useApp } from "../state/context.js";
import { navGo } from "../plugins/bridges.js";
import { requestSettingsSection, requestSettingsTab } from "../state/settingsMode.js";
import { OhSettingsPage } from "../components/OhSettingsPage.js";
import { openImageViewer } from "../components/ImageViewer.js";
import { isThemeEntry, resolveAssetUrl } from "../lib/market.js";
import { useExitHold } from "../lib/motion.js";
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

/** 消息 → Banner 语气（安装/拉取的结果语义色，判例 3c73347c 成败同屏分色） */
function msgTone(msg: string): "success" | "error" | "info" {
  if (msg.startsWith("已安装") || msg.includes("已是最新")) return "success";
  if (msg.startsWith("失败") || msg.includes("失败")) return "error";
  return "info";
}

/* ── ④ 跨页「带参数打开插件页」请求（**只带筛选参数**；入口态一律走 Layout 的 goEntry）──
   外部（外观与布局的「安装主题」等）写请求 → 插件页挂载或已挂载时消费：
     requestPluginsView({ view: "market", category: "theme" })
   ⑤ 筛选状态同时做**模块级记忆**（同一会话内），返回再进不会丢。 */
export type PluginsViewReq = { view?: "mine" | "market"; category?: "all" | "theme" | "general"; install?: boolean };

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


/* task-19/22：插件页动作行的声明式注册（「检查更新」「去切换主题」等）。
   go 完成插件家族的二级/三级：切视图（我的插件 / 市场 / 主题筛选）→ 展开安装面板 → 落行滚动高亮；
   条件隐藏行（当前没有可检查更新的卡）→ 落「我的插件」分节根 + 一句解释，不冒充命中。 */
defineSearchRows([
  {
    id: "plg-check-update", tab: "插件", section: "我的插件", title: "检查更新", aliases: ["更新", "检查新版本"], desc: "从插件本体仓库检查最新版" , breadcrumb: ["插件", "我的插件", "检查更新"], displayRoot: "插件",
    /* 按钮只出现在「来自仓库且非内置核心」的插件卡上；整页没有这类卡 = 隐藏行 */
    visible: () => installedPlugins().some((p) => p.repo && p.manifest.kind !== "rust" && !p.embedded && !p.builtin && p.manifest.id !== "onethu.harness"),
    fallbackNote: "「检查更新」按钮在每个来自仓库的插件卡上；当前列表没有这类卡，已带到「我的插件」视图。",
    root: "sec-我的插件",
    go: () => {
      requestPluginsFocus({ target: "row-检查更新", fallbackTarget: "sec-我的插件", note: "「检查更新」按钮在每个来自仓库的插件卡上；当前列表没有这类卡，已带到「我的插件」视图。" });
    },
  },
  { id: "plg-switch-theme", tab: "插件", section: "我的插件", title: "去切换主题", aliases: ["切换主题", "换主题"], desc: "到「外观与布局 → 主题」切换（会高亮那一节）" , breadcrumb: ["插件", "我的插件", "去切换主题"], displayRoot: "插件", go: () => gotoAppearanceTheme() },
  {
    id: "plg-detail", tab: "插件", section: "插件市场", title: "详情", aliases: ["插件详情", "简介图", "readme"], desc: "查看插件详情（简介图 + 详情正文）" , breadcrumb: ["插件", "插件市场", "详情"], displayRoot: "插件",
    go: () => {
      requestPluginsView({ view: "market" });
      requestPluginsFocus({ target: "row-详情", fallbackTarget: "sec-插件市场" });
    },
  },
  {
    id: "plg-mine-market", tab: "插件", section: "我的插件", title: "我的插件 / 插件市场", aliases: ["插件列表", "插件市场"], desc: "插件页两个视图切换" , breadcrumb: ["插件", "我的插件", "我的插件 / 插件市场"], displayRoot: "插件",
    go: () => {
      requestPluginsView({ view: "mine" });
      requestPluginsFocus({ target: "sec-视图切换", fallbackTarget: "sec-我的插件" });
    },
  },
  {
    id: "plg-install", tab: "插件", section: "我的插件", title: "安装插件", aliases: ["装插件", "从仓库安装"], desc: "从仓库 / 市场安装插件" , breadcrumb: ["插件", "我的插件", "安装插件"], displayRoot: "插件",
    go: () => {
      requestPluginsView({ view: "mine", install: true });
      requestPluginsFocus({ target: "row-安装插件", fallbackTarget: "sec-我的插件" });
    },
  },
]);

/** 检索直达的落点器（提外函数，不碰 Hook）：等视图 / 档位 / 安装面板这几次 re-render 落定后定位。
 *  先追主锚点（窗口 ~2.2s），超时落分节根，再不行就 toast 一句解释——绝不静默冒充命中。 */
function schedulePluginsFocus(spec: PluginsFocusSpec | null): void {
  if (!spec) return;
  const total = spec.waitMs ?? 2200;
  const started = Date.now();
  const main = spec.target ?? "";
  const step = (): void => {
    if (main && focusSettingsTarget(main)) return;
    if (Date.now() - started < total) {
      window.setTimeout(step, 180);
      return;
    }
    if (spec.fallbackTarget && focusSettingsTarget(spec.fallbackTarget)) return;
    if (spec.note) showToast(spec.note);
  };
  window.setTimeout(step, 180);
}

export function PluginsPage({ embedded = false }: { embedded?: boolean } = {}): ReactNode {
  const allPlugins = useSyncExternalStore(subscribe, installedPlugins);
  const cmds = useSyncExternalStore(subscribeCommands, commandsSnapshot);
  const [view, setView] = useState<"mine" | "market">(lastPluginsView); // ⑤ 恢复上次的筛选
  const [cat, setCat] = useState<"all" | "theme" | "general">(lastPluginsCat);
  const [instOpen, setInstOpen] = useState(false);
  const themesSnap = useThemes();
  /* ② 用户拍板：OH（onethu.harness）是**特殊插件**，不出现在普通插件页的卡片区
     ——它的模型/MCP/日志/权限全部搬进「OneTHU Harness」子页的高级配置里就地渲染。 */
  const listPlugins = allPlugins.filter((p) => p.manifest.id !== "onethu.harness");
  /** 分类判定**单一真源**：category==="theme" 或带非空 themes 数组（见 lib/market.ts isThemeEntry） */
  const isTheme = (m: { category?: string; themes?: unknown }): boolean => isThemeEntry(m as { category?: string; themes?: unknown });
  const plugins = cat === "all"
    ? listPlugins
    : listPlugins.filter((p) => (cat === "theme" ? isTheme(p.manifest as { category?: string; themes?: unknown }) : !isTheme(p.manifest as { category?: string; themes?: unknown })));
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

  /* R23（霖实测）口径保留：视图切换是「我的插件 / 插件市场」的唯一入口，全站同一套分段控件。
     §4.4b：嵌进设置页时保留这个切换器，只去掉页面级大标题。
     data-set-id 锚点给检索直达的落点（sec-视图切换）—— OG Segment 不透传任意属性，走外框承载。 */
  const viewSwitch = (
    <div data-set-id="sec-视图切换">
      <Segment
        size="md"
        value={view}
        onChange={(v) => setView(v as "mine" | "market")}
        options={[{ value: "mine", label: "我的插件" }, { value: "market", label: "插件市场" }]}
      />
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
        if (req.install) setInstOpen(true); // 检索直达「安装插件」：顺路把安装面板展开
      }
      /* 入口态由 requestPluginsView 自己走 goEntry（见该函数）；这里不再有旗标消费 */
    };
    /* 检索聚焦通道：挂载时先取走一次挂起的请求（跨页直达），此后订阅即时生效 */
    const focusApply = (): void => schedulePluginsFocus(takePluginsFocus());
    focusApply();
    const offFocus = subscribePluginsFocus(focusApply);
    apply();
    pluginsViewListeners.add(apply);
    /* ① 「插件」格请求：显式关子页（这就是"点完 OH 回不到插件"的根因） */
      return () => {
      pluginsViewListeners.delete(apply);
      offFocus();
    };
  }, []);
  const isPhone = typeof document !== "undefined" && document.documentElement.classList.contains("is-phone");
  /* ① 用户拍板：三个并列（设置 / 插件 / OneTHU Harness），**用共享组件 LevelBox**——
     任何页面同一个容器、同高、三格齐全；每页自己的大标题照旧保留（框是框、标题是标题）。 */
  const dualEntry = isPhone ? <LevelBox /> : null;
  /** ⑤「安装插件」按层级归位：放页头右侧，不再挤在类别筛选那一行里 */
  const installBtn = (
    <Btn variant="ghost" data-set-id="row-安装插件" onClick={() => setInstOpen((o) => !o)}>
      {instOpen ? "收起安装" : "安装插件"}
    </Btn>
  );
  /* ② OH 的模型/MCP/日志**就地**渲染在子页高级配置里（复用同一批面板实现，不跳 sheet、不复制） */
  const ohRec = allPlugins.find((p) => p.manifest.id === "onethu.harness");
  const ohCmds = cmds.filter((c) => c.pluginId === "onethu.harness");
  const ohPerms = (ohRec?.manifest.permissions ?? []) as string[];
  const ohAdvancedPanels = (
    <Stack gap={3} fill>
      {/* ② 权限胶囊 + 命令清单：原来长在插件页的 OH 卡片上，现在**就地**放高级配置（卡片区已不许出现 OH） */}
      <SettingsRow title={`权限（${ohPerms.length}）`} sub={ohPerms.length > 0 ? ohPerms.map((p) => PLUGIN_PERMISSIONS.find((x) => x.id === p)?.label ?? p).join(" · ") : "未声明额外权限"} />
      <SettingsRow title={`命令清单（${ohCmds.length}）`} sub={ohCmds.length > 0 ? ohCmds.map((c) => c.id).join(" · ") : "暂无命令"} />
      {ohRec ? <SettingsBody id="onethu.harness" rec={ohRec} onClose={() => undefined} dirtyRef={ohDirtyRef} /> : null}
      <McpBody />
      <LogBody id="onethu.harness" />
    </Stack>
  );

  if (ohOpen) {
    return (
      <Stack gap={3}>
        {/* 标题「OH」+ 一行副标题；返回靠顶部那格里选「插件」（不再有第二个返回入口） */}
        {/* ① 主标题必须写全名「OneTHU Harness」（用户点名不许用 OH 简称），副标题保留两档说明 */}
        <PageHead
          title="OneTHU Harness"
          meta={<span>基础设置 / 高级配置</span>}
        />
                {/* 子页也带三格框（第三格高亮由子状态推导，不再传死 active） */}
        {isPhone ? <LevelBox /> : null}
        <LayoutCard>
          <OhSettingsPage advancedPanels={ohAdvancedPanels} />
        </LayoutCard>
      </Stack>
    );
  }

  return (
    <Stack gap={3}>
      {dualEntry}
      {embedded ? (
        <Inline gap={2} wrap>{viewSwitch}{installBtn}</Inline>
      ) : (
        <PageHead
          title="插件"
          meta={
            <span>
              经 <code className="plg-code">onethu.*</code> 公共接口扩展 OneTHU——权限门禁、会话自愈、
              45s 超时由宿主统一承担
            </span>
          }
          actions={
            <Inline gap={2} wrap>
              {viewSwitch}
              {installBtn}
            </Inline>
          }
        />
      )}

      {/* 电表概览条：StatTile 四格（判例 59b3657同款；LED 脉冲让位于语义） */}
      <Grid min="sm">
        <StatTile label="已安装" value={String(plugins.length).padStart(2, "0")} />
        <StatTile label="运行中" value={String(liveCount).padStart(2, "0")} hint={liveCount > 0 ? "有模块在跑" : "空闲"} />
        <StatTile label="可用命令" value={String(cmds.length).padStart(2, "0")} />
        <StatTile label="内置核心" value={String(coreCount).padStart(2, "0")} />
      </Grid>


      {/* 主题管理区（安装/卸载）：主题即插件，安装面在插件页。
          切换主题在 设置 → 外观（唯一入口）——2026-02 用户反馈切换入口错位到插件页；
          2026-09-13 原定案「设置页不放」针对的是管理面，与切换入口不冲突。 */}
      {view === "market" ? (
        <MarketView cat={cat} setCat={setCat} />
      ) : (
        <>
      {instOpen ? <InstallPanel onClose={() => setInstOpen(false)} /> : null}

      {/* 我的插件 · 工具行：类别页签（Segment，判例「全部/主题/通用」同口径） */}
      <div data-set-id="sec-我的插件">
        <Segment
          size="sm"
          value={cat}
          onChange={(v) => setCat(v as "all" | "theme" | "general")}
          options={[
            { value: "all", label: `全部 ${listPlugins.length}` },
            { value: "theme", label: `主题 ${listPlugins.filter((p) => isTheme(p.manifest as { category?: string; themes?: unknown })).length}` },
            { value: "general", label: `通用 ${listPlugins.filter((p) => !isTheme(p.manifest as { category?: string; themes?: unknown })).length}` },
          ]}
        />
      </div>


      {plugins.length === 0 && cat !== "theme" ? (
        <EmptyState
          icon={<IconPlug size="lg" />}
          title="机架空空如也"
          hint="安装第一个插件，为 OneTHU 挂上新的能力模块。"
          action={<Btn variant="solid" tone="brand" onClick={() => setInstOpen(true)}>安装插件</Btn>}
        />
      ) : plugins.length === 0 && cat === "theme" ? (
        <Text as="p" slot="subtitle" tone="quiet">
          还没有启用中的主题插件。换主题在「外观与布局 → 主题」；启用 / 停用走那里的「管理主题」；
          安装走那里的「安装主题」（会打开插件市场的主题筛选）。
        </Text>
      ) : (
        <Stack gap={2}>
          {plugins.map((p) => (
            <PluginCard key={p.manifest.id} id={p.manifest.id} onOpenSheet={setSheet} marketVersion={marketVersions[p.manifest.id]} onGoMarket={() => setView("market")} />
          ))}
        </Stack>
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
    </Stack>
  );
}

/* ═══════════════ 模块卡 ═══════════════ */

/** 结构化命令结果渲染：markdown（GFM）+ 条目列表 + 键值对 */
function ResultBlock({ result }: { result: CommandResult }): ReactNode {
  if (!result.markdown && !result.items?.length && !result.kv?.length) return null;
  return (
    <Surface sunken pad="sm">
      <Stack gap={2} fill>
        {result.markdown ? (
          /* react-markdown 任意 HTML 是排印视口豁免（判例 .gitlab-md / .dock-md；.market-readme 同族保留） */
          <div className="market-readme">
            <Markdown remarkPlugins={[remarkGfm]}>{result.markdown}</Markdown>
          </div>
        ) : null}
        {result.kv?.length ? (
          <KeyValue rows={result.kv.map((x) => ({ k: x.k, v: x.v }))} />
        ) : null}
        {result.items?.length ? (
          <Card flush>
            <List divided>
              {result.items.slice(0, 30).map((it, i) => (
                <Row key={i} flush title={it.title} sub={it.subtitle} meta={it.meta} />
              ))}
            </List>
          </Card>
        ) : null}
      </Stack>
    </Surface>
  );
}

function PluginCard({
  id,
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

  const checkLine = repoCheck.msg ?? checkMsg ?? null;

  return (
    <Card>
      <Stack gap={2} fill>
        {/* 卡头：针脚 + 名称/徽标/状态 */}
        <Inline gap={3} align="start" fill>
          {/* .plg-pin/.plg-logo 是 PluginLogo 的尺寸槽（共享保留）；内置核心的青蓝框在这里借 is-core 檔位 */}
          <span className={"plg-pin" + (rec.embedded ? " is-core" : "")} aria-hidden="true">
            <PluginLogo id={m.id} fallback={<Text slot="micro" mono weight="bold">{monogram(m.name, m.id)}</Text>} />
          </span>
          <Stack gap={0} fill>
            <Inline gap={2} vAlign="center" wrap>
              <Text slot="subtitle" weight="semibold" nowrap>{m.name}</Text>
              <Text slot="micro" tone="faint" mono>v{m.version}</Text>
              <Tag>{m.kind === "rust" ? "RUST" : "JS"}</Tag>
              {isThemeEntry(m) ? <Tag tone="brand">主题</Tag> : null}
              {widgetSlots.length > 0 ? (
                <span
                  title={`桌面小组件：把「OneTHU 插件小组件 ${widgetSlots.map((x) => x.slot).join(" / ")}」放到桌面即可看到本插件的内容`}
                >
                  <Tag tone="brand">小组件 {widgetSlots.map((x) => x.slot).join("/")}</Tag>
                </span>
              ) : null}
              {rec.embedded ? <span title="Rust 核心已编进 App，无需二进制"><Tag>内置</Tag></span> : null}
            </Inline>
            <Inline gap={2} vAlign="center" wrap>
              <Tag tone={active ? "success" : failed ? "warning" : "neutral"}>{stateText}</Tag>
              <Text slot="micro" tone="faint" mono nowrap>{m.id}</Text>
            </Inline>
          </Stack>
        </Inline>

        {/* 操作梯队：仓库 / 启停 / 设置 / 日志 / 更新 / 删除 */}
        <Inline gap={1} wrap>
          {rec.repo ? (
            <IconBtn
              variant="ghost"
              size="sm"
              label="打开源码仓库"
              aria-label="打开源码仓库"
              titleAttr={rec.repo}
              icon={<IconGithub size="sm" />}
              onClick={() => void (async () => {
                try {
                  const { openUrl } = await import("@tauri-apps/plugin-opener");
                  await openUrl(rec.repo!);
                } catch {
                  window.open(rec.repo!, "_blank");
                }
              })()}
            />
          ) : null}
          <Switch
            checked={rec.enabled}
            aria-label={rec.enabled ? "停用" : "启用"}
            onChange={() => void (rec.enabled ? disablePlugin(id) : enablePlugin(id)).catch((e: unknown) => setRunMsg(String(e)))}
          />
          {id === "onethu.harness" ? (
            <Btn variant="ghost" titleAttr="管理 MCP 服务器" onClick={() => onOpenSheet({ id, mode: "mcp" })}>MCP</Btn>
          ) : null}
          {/* 主题类插件：动作行里一处（与检查更新/设置/删除同为纯文字） */}
          {isThemeEntry(m) ? (
            <Btn variant="ghost" titleAttr="到「外观与布局 → 主题」里切换（会高亮那一节）" onClick={() => gotoAppearanceTheme()}>去切换主题</Btn>
          ) : null}
          {rec.repo && m.kind !== "rust" && !rec.embedded && !rec.builtin && id !== "onethu.harness" ? (
            <Btn variant="ghost" titleAttr={`从 ${rec.repo} 检查最新版（本体仓库优先，市场兜底）`} disabled={checkBusy || repoCheck.busy} onClick={() => { onCheckUpdate?.(); void checkUpdate().catch(() => undefined); }}>{checkBusy || repoCheck.busy ? "检查中…" : "检查更新"}</Btn>
          ) : null}
          {(repoCheck.remote || repoRemote) && compareVersions(repoCheck.remote ?? "", m.version) > 0 ? (
            <Btn variant="solid" tone="brand" titleAttr={`从插件本体仓库更新到 v${repoCheck.remote || repoRemote}（与安装同一管线，覆盖更新并重新激活）`} disabled={repoCheck.busy || checkBusy} onClick={() => {
                const v = repoCheck.remote || repoRemote;
                if (v) void updateNow(v).catch(() => undefined);
              }}>{repoCheck.busy ? "更新中…" : `更新至仓库版 v${repoCheck.remote || repoRemote}`}</Btn>
          ) : null}
          {!repoCheck.remote && !repoRemote && marketVersion && compareVersions(marketVersion, m.version) > 0 ? (
            <Btn variant="ghost" titleAttr={`市场已有 v${marketVersion}`} onClick={() => onGoMarket?.()}>可更新 ↑</Btn>
          ) : null}
          <Btn variant="ghost" onClick={() => onOpenSheet({ id, mode: "settings" })}>设置</Btn>
          {m.kind === "rust" ? (
            <Btn variant="ghost" onClick={() => onOpenSheet({ id, mode: "log" })}>日志</Btn>
          ) : null}
          {rec.embedded || rec.builtin || m.id === "onethu.harness" ? null : (
            <Btn variant="solid" tone="error" onClick={() => void uninstallPlugin(id)}>删除</Btn>
          )}
        </Inline>

        {m.description ? <Text as="p" slot="subtitle" tone="quiet" clamp={2}>{m.description}</Text> : null}

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
            <Banner
              tone="info"
              title="📢 插件公告"
              action={<Btn variant="ghost" size="sm" onClick={ack}>知道了</Btn>}
            >
              <Text as="p" slot="micro" tone="quiet">{rec.notice.text.slice(0, 1600)}</Text>
            </Banner>
          );
        })()}

        {checkLine ? (
          <Text as="p" slot="micro" tone={(checkLine.startsWith("失败") || checkLine.includes("失败")) ? "error" : "quiet"}>
            {checkLine}
          </Text>
        ) : null}

        {m.permissions.length > 0 ? (
          <Inline gap={1} wrap>
            {m.permissions.map((p) => {
              const meta = PLUGIN_PERMISSIONS.find((x) => x.id === p);
              return (
                <span key={p} title={meta?.desc ?? p}>
                  <Tag>{meta?.label ?? p}</Tag>
                </span>
              );
            })}
          </Inline>
        ) : null}

        {cmds.length > 0 ? (
          /* 命令舱段：AccordionItem（展开态本地 state，与原 plg-cmds-toggle/caret 行为一致） */
          <AccordionItem
            id="cmds"
            title={open ? "收起命令" : `命令（${cmds.length}）`}
            open={open}
            onToggle={() => setOpen((o) => !o)}
          >
            <Stack gap={3} fill>
              {cmds.map((c) => (
                <Stack key={c.id} gap={1} fill>
                  <Text slot="subtitle" weight="medium">{c.title}</Text>
                  {c.inputLabel ? (
                    <TextArea
                      rows={2}
                      placeholder={c.inputPlaceholder ?? ""}
                      value={input}
                      onChange={(value) => setInput(value)}
                    />
                  ) : null}
                  <Inline gap={2} wrap>
                    <Btn variant="solid" tone="brand" onClick={() => void doRun(c.id)}>执行</Btn>
                  </Inline>
                  {runMsg ? <Text as="p" slot="micro" mono tone="quiet" nowrap={false}>{runMsg}</Text> : null}
                  {runResult && (runResult.markdown || runResult.items?.length || runResult.kv?.length) ? (
                    <ResultBlock result={runResult} />
                  ) : null}
                </Stack>
              ))}
            </Stack>
          </AccordionItem>
        ) : null}

        {runMsg && cmds.length === 0 ? <Text as="p" slot="micro" mono tone="quiet">{runMsg}</Text> : null}
      </Stack>
    </Card>
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
  /** 退场相位：truthy 时 Sheet open=false 播完退场再由父级卸载（useExitHold 保持挂载） */
  closing: boolean;
  onClose: () => void;
}): ReactNode {
  const plugins = useSyncExternalStore(subscribe, installedPlugins);
  const rec = plugins.find((p) => p.manifest.id === id);
  // R23（霖实测：设置卡片外误点一下直接关闭丢修改）：
  //  ① 拖拽出界不算点遮罩——OneGUI 的 Shell 已内置「遮罩上按下、遮罩上抬起才关」的原判定；
  //  ② 设置草稿有改动时关闭前 confirmOk，绝不静默丢弃（onClose 的三个出口都过这里）。
  const dirtyRef = useRef(false);
  const requestClose = (): void => {
    if (!dirtyRef.current) return onClose();
    void confirmOk("设置有未保存的修改，关闭将丢失。确定关闭？").then((ok) => {
      if (ok) onClose();
    });
  };
  /* 日志模式的事件计数（贴底回执行由 Sheet foot 承载，状态一只） */
  const evtCount = useSyncExternalStore(subscribePluginEvents, () => pluginEvents(id)).length;
  if (!rec) return null;
  const title = mode === "settings" ? "设置" : mode === "mcp" ? "MCP 服务器" : "运行日志";
  return (
    <Sheet
      open={!closing}
      onClose={requestClose}
      title={`${title} · ${rec.manifest.name}`}
      size="md"
      foot={mode === "log" ? (
        <Inline gap={2} wrap>
          <Text slot="micro" tone="faint">{evtCount} 条事件 · 最多保留 300 条</Text>
          <Spacer />
          <Btn variant="ghost" onClick={() => void notifyRust(id, "interrupt").catch(() => undefined)}>打断运行</Btn>
          <Btn variant="ghost" onClick={() => clearPluginEvents(id)}>清空</Btn>
        </Inline>
      ) : undefined}
    >
      {mode === "settings" ? (
        <SettingsBody id={id} rec={rec} onClose={onClose} dirtyRef={dirtyRef} sheet />
      ) : mode === "mcp" ? (
        <McpBody />
      ) : (
        <LogBody id={id} />
      )}
    </Sheet>
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
    <Stack gap={2} fill>
      <Text as="p" slot="micro" tone="faint">
        每条为一个 stdio MCP server；OH 对话时其工具以 <code className="plg-code">mcp_&lt;名称&gt;_&lt;工具&gt;</code> 注入。
      </Text>
      {list.length === 0 ? (
        <Text as="p" slot="micro" tone="faint">尚未添加。点「添加 MCP 服务器」开始。</Text>
      ) : (
        <Card flush>
          <List divided>
            {list.map((sv, i) => (
              <Row
                key={`${sv.name}:${i}`}
                flush
                title={sv.name}
                sub={<code className="plg-code">{sv.command} {sv.args.join(" ")}</code>}
                trailing={
                  <Inline gap={1}>
                    <Btn variant="ghost" size="sm" onClick={() => void edit(i)}>编辑</Btn>
                    <Btn variant="solid" tone="error" size="sm" onClick={() => void del(i)}>删除</Btn>
                  </Inline>
                }
              />
            ))}
          </List>
        </Card>
      )}
      <Btn variant="ghost" onClick={() => void edit(-1)}>＋ 添加 MCP 服务器</Btn>
    </Stack>
  );
}

/** 设置：本地草稿 + 显式保存 + 已保存回执（设置在插件下一轮运行时实时读取）。
 *  R23：dirtyRef 上报未保存改动（Sheet 关闭前据此确认）；onClose 供无配置项分支直接关闭。
 *  sheet=true（Sheet 内）走单列；inline（OH 高级面板）走 Grid 两列，foot 随内容流。 */
export function SettingsBody({
  id, rec, onClose, dirtyRef, sheet = false,
}: { id: string; rec: any; onClose: () => void; dirtyRef: { current: boolean }; sheet?: boolean }): ReactNode {
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
      <Stack gap={2} fill>
        <EmptyState title="该插件没有可配置项" />
        <Inline gap={2} wrap>
          <Text slot="micro" tone="faint">—</Text>
          <Spacer />
          <Btn variant="ghost" onClick={onClose}>关闭</Btn>
        </Inline>
      </Stack>
    );
  }

  const fmap = fields.map((f: any) => (
    <Field key={f.key} label={f.label}>
      {f.auto ? (
        /* 自动维护：只读展示实时值（不受草稿影响），避免手改与误覆盖 */
        <Input readOnly value={liveSettings[f.key] ?? ""} placeholder="（尚未签发）" />
      ) : f.type === "select" ? (
        <Select value={draft[f.key] ?? ""} onChange={(value) => editDraft((d) => ({ ...d, [f.key]: value }))}>{optionsFor(f, liveSettings).map((o: { value: string; label: string }) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}</Select>
      ) : f.type === "textarea" ? (
        <TextArea rows={3} placeholder={f.placeholder ?? ""} value={draft[f.key] ?? ""} onChange={(value) => editDraft((d) => ({ ...d, [f.key]: value }))} />
      ) : (
        <Input type={f.type === "password" ? "password" : "text"} placeholder={f.placeholder ?? ""} value={draft[f.key] ?? ""} onChange={(value) => editDraft((d) => ({ ...d, [f.key]: value }))} />
      )}
    </Field>
  ));
  const hintNode = <Text as="p" slot="micro" tone="faint">设置在插件下一轮运行时生效（每轮实时读取）。</Text>;
  const footNode = (
    <Inline gap={2} wrap>
      {savedAt ? (
        <Inline gap={1}>
          <Tag tone="success">已保存</Tag>
          <Text slot="micro" tone="faint">{savedAt}</Text>
        </Inline>
      ) : (
        <Text slot="micro" tone="faint">修改后点「保存」才会生效</Text>
      )}
      <Spacer />
      <Btn variant="ghost" onClick={() => setDraft({ ...rec.settings })}>撤销修改</Btn>
      <Btn variant="solid" tone="brand" disabled={saving} onClick={save}>保存</Btn>
    </Inline>
  );
  return sheet ? (
    <Stack gap={2} fill>
      {fmap}
      {hintNode}
      {footNode}
    </Stack>
  ) : (
    <Stack gap={2} fill>
      <Grid min="sm">{fmap}</Grid>
      {hintNode}
      {footNode}
    </Stack>
  );
}

/** 运行日志：终端面（时间戳 + 方法符着色 + 语义色）+ 自动贴底（滚动锚点） */
export function LogBody({ id }: { id: string }): ReactNode {
  const events = useSyncExternalStore(subscribePluginEvents, () => pluginEvents(id));
  const endRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [events.length]);

  // delta/think 是逐 token 流（已进 dock 思考/回答链展示），进日志只会刷屏——只留进度/工具/日志/系统行
  const lines = events
    .filter((e) => !(e.method === "progress" && (e.kind === "delta" || e.kind === "think")))
    .slice(-400);
  return (
    <Stack gap={2} fill>
      <Surface sunken pad="sm">
        <Stack gap={1} fill>
          {lines.length === 0 ? (
            <Text as="span" slot="micro" tone="faint" nowrap={false}>— 尚无输出 · 发一次对话或执行一条命令试试 —</Text>
          ) : (
            lines.map((e, i) => {
              const isLog = e.kind === "log";
              const tag = isLog ? "·" : e.kind === "tool" ? "🔧" : e.method === "progress" ? "▶" : e.method === "exit" ? "■" : "…";
              const tone: "error" | "brand" | "faint" | "quiet" = e.method === "exit" ? "error" : e.method === "progress" ? "brand" : isLog ? "faint" : "quiet";
              return (
                <Inline key={i} gap={2} vAlign="start">
                  <Text slot="micro" tone="faint" mono nowrap>{new Date(e.at).toLocaleTimeString("zh-CN", { hour12: false })}</Text>
                  <Text slot="micro" tone={e.method === "exit" || e.method === "progress" ? tone : "faint"} nowrap aria-hidden="true">{tag}</Text>
                  <Stack gap={0} fill>
                    <Text as="span" slot="micro" tone={e.method === "exit" ? "error" : "quiet"} mono={isLog} nowrap={false}>
                      {e.text || e.method}
                      {e.step != null ? `（${e.step}${e.total != null ? "/" + e.total : ""}）` : ""}
                    </Text>
                  </Stack>
                </Inline>
              );
            })
          )}
          <span ref={endRef} aria-hidden="true" />
        </Stack>
      </Surface>
    </Stack>
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
    .filter((x) => cat === "all" || (cat === "theme" ? isThemeEntry(x) : !isThemeEntry(x)))
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
      <Stack gap={3}>
        <Inline gap={3} align="start" wrap fill>
          <Btn variant="ghost" onClick={() => setDetail(null)}>返回</Btn>
          <Avatar name={detail.name} src={head || undefined} tone="neutral" />
          <Stack gap={0} fill>
            <Inline gap={2} vAlign="center" wrap>
              <Text slot="title" weight="bold">{detail.name}</Text>
              {installedMap.has(detail.id) ? <Tag tone="success">已安装</Tag> : null}
              {typeof stars[detail.id] === "number" ? (
                <Inline gap={1} vAlign="center">
                  <IconStar size="sm" />
                  <Text slot="micro" tone="faint">{String(stars[detail.id])}</Text>
                </Inline>
              ) : null}
            </Inline>
            <Text slot="micro" tone="faint">
              v{detail.version}
              {detail.author ? ` · ${detail.author}` : ""}
              {detail.license ? ` · ${detail.license}` : ""}
              {isThemeEntry(detail) ? " · 主题" : ""}
            </Text>
          </Stack>
          <Inline gap={2} wrap>
            {detail.homepage ? (
              <Btn variant="ghost" onClick={() => void (async () => {
                  try {
                    const { openUrl } = await import("@tauri-apps/plugin-opener");
                    await openUrl(detail.homepage!);
                  } catch {
                    window.open(detail.homepage!, "_blank");
                  }
                })()}>主页</Btn>
            ) : null}
            {/* ④ 主题类插件：详情里直接启用/停用（沿用卡片开关语义） */}
            {rec && isThemeEntry(detail) ? (
              <Btn variant="ghost" onClick={() => void (on ? disablePlugin(detail.id) : enablePlugin(detail.id)).catch((e: unknown) => setMsg(String(e)))}>{on ? "停用主题" : "启用主题"}</Btn>
            ) : null}
            {!installedMap.has(detail.id) ? (
              <Btn variant="solid" tone="brand" disabled={busy} onClick={() => void install(detail)}>安装</Btn>
            ) : null}
          </Inline>
        </Inline>

        {shots.length > 0 ? (
          <Grid min="sm">
            {shots.map((src, i) => (
              <Surface key={i} interactive pad="none" radius="sm" role="button" tabIndex={0} onClick={() => openImageViewer(src, `${detail.name} 简介图 ${i + 1}`)}>
                <img src={src} alt={`${detail.name} 简介图 ${i + 1}`} loading="lazy" />
              </Surface>
            ))}
          </Grid>
        ) : null}

        {detail.readme || detail.description ? (
          <div className="market-readme">
            <Markdown remarkPlugins={[remarkGfm]}>{detail.readme ?? detail.description ?? ""}</Markdown>
          </div>
        ) : null}

        <Text as="p" slot="micro" tone="faint">
          仓库：{normalizeRepoUrl(detail.repo)}
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap={2}>
      <Inline gap={2} wrap fill data-set-id="sec-插件市场">
        <Grow>
          <Input placeholder="搜索插件名称 / 描述 / 标签" value={query} onChange={(value) => setQuery(value)} />
        </Grow>
        {/* ④ 排序：与全站同一套分段控件口径 */}
        <Segment size="sm" value={sortBy} onChange={(v) => setSortBy(v as "stars" | "latest")} options={[{ value: "stars", label: "star" }, { value: "latest", label: "最新" }]} />
        <Btn variant="outline" disabled={busy} onClick={() => void load(true)}>{busy ? "刷新中…" : "刷新"}</Btn>
      </Inline>
      {/* ④ 市场自己的类别筛选：与「我的插件」同一套分段口径 */}
      <Segment size="sm" value={cat} onChange={(v) => setCat(v as "all" | "theme" | "general")} options={[{ value: "all", label: "全部" }, { value: "theme", label: "主题" }, { value: "general", label: "通用" }]} />

      {!loaded ? (
        msg ? (
          <Banner tone="error" action={<Btn variant="outline" size="sm" disabled={busy} onClick={() => void load(true)}>重试</Btn>}>
            {msg}
          </Banner>
        ) : busy ? (
          <LoadingBlock rows={3} />
        ) : (
          <Text as="p" slot="subtitle" tone="quiet">准备中…</Text>
        )
      ) : msg ? (
        <Banner tone={msgTone(msg)}>{msg}</Banner>
      ) : null}

      {loaded && !hits.length ? <EmptyState title="无匹配条目" /> : null}

      {hits.length ? (
        <Grid min="md">
          {hits.map((item) => {
            const st = stars[item.id];
            return (
              <Card
                key={item.id}
                flush
                interactive
                role="button"
                tabIndex={0}
                onClick={() => setDetail(item)}
                onKeyDown={(ev) => { if (ev.key === "Enter") setDetail(item); }}
              >
                <Stack gap={1} fill>
                  <Row
                    flush
                    leading={<Avatar name={item.name} src={resolveAssetUrl(item.thumbnail ?? item.logo, item.repo) || undefined} tone="neutral" />}
                    title={item.name}
                    /* 版本/作者走 Row 的第二行（sub），不再与 title 挤同一条 flex 行：
                       实测窄卡片下 title 只分到 49px 而它需要 94px（截成「Hello …」）、
                       连 meta 也被截（「v2.1.1 · …」）——头行三样（title/meta/trailing）
                       争一条行宽，用户点名「有点挤」。sub 是这套 Row 本来就有的第二行。 */
                    sub={<>{`v${item.version}`}{item.author ? ` · ${item.author}` : ""}</>}
                    trailing={
                      <Inline gap={1} vAlign="center">
                        <IconStar size="sm" />
                        <Text slot="micro" tone="faint">{typeof st === "number" ? String(st) : "—"}</Text>
                        {installedMap.has(item.id) ? <Tag tone="success">已安装</Tag> : null}
                      </Inline>
                    }
                  />
                  <Text as="p" slot="subtitle" tone="quiet" clamp={2}>{item.description || item.repo}</Text>
                  {item.tags?.length ? (
                    <Inline gap={1} wrap>
                      {item.tags.map((t) => (
                        <Chip key={t} size="sm">{t}</Chip>
                      ))}
                    </Inline>
                  ) : null}
                  {/* 操作行：用 Inline 的 justify="between" 把主操作推到行尾，**不用 Spacer**
                      ——.og-spacer 是 flex:1 的真 flex item，行一折行它就独占一整行空白
                      （实测窄卡片下操作区折成 4 行、其中第 3 行是空行 = 用户说的「挤」）。
                      space-between 零额外 item：折行时只会 2 行，不会出现幽灵空行。 */}
                  <Inline gap={2} wrap justify="between">
                    <Btn variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); setDetail(item); }}>详情</Btn>
                    {/* 仓库 = 图标钮（repo 全串走 tooltip / aria-label / 详情页）。
                        原来把 `smartThise/OneTHU-plugin-hello` 当按钮文字：实测这个按钮
                        宽 233~243px，**比整张卡的内容区（176~240px）还宽** → 操作行必然折成
                        3 行（旁边那行还只有「详情」两个字），是"挤"的最大来源。 */}
                    <Btn
                      variant="ghost"
                      size="sm"
                      icon={<IconGithub size="sm" />}
                      aria-label={`打开仓库 ${item.repo}`}
                      titleAttr={`在浏览器打开仓库：${normalizeRepoUrl(item.repo)}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void (async () => {
                          const url = normalizeRepoUrl(item.repo);
                          try {
                            const { openUrl } = await import("@tauri-apps/plugin-opener");
                            await openUrl(url);
                          } catch {
                            window.open(url, "_blank");
                          }
                        })();
                      }}
                    />
                    {(() => {
                      const local = installedMap.get(item.id);
                      if (local && compareVersions(item.version, local) <= 0) {
                        return (
                          <Btn variant="outline" size="sm" disabled titleAttr={`本地 v${local}，已是最新`}>已安装</Btn>
                        );
                      }
                      const updating = !!local;
                      return (
                        <Btn variant="solid" tone="brand" size="sm" disabled={busy} titleAttr={updating ? `本地 v${local} → 市场 v${item.version}` : undefined} onClick={(e) => { e.stopPropagation(); void install(item); }}>{busy ? "…" : updating ? "更新" : "安装"}</Btn>
                      );
                    })()}
                  </Inline>
                </Stack>
              </Card>
            );
          })}
        </Grid>
      ) : null}

      <Text as="p" slot="micro" tone="faint">
        想上架你的插件？向 OneTHU-Market 仓库提交 Pull Request——流程见
        {" "}<a href="https://github.com/smartThise/OneTHU-Market" target="_blank" rel="noreferrer">市场仓库</a>
        与插件开发文档 §7。
      </Text>
    </Stack>
  );
}

/* ═══════════════ 安装面板：三路安装（粘贴 JS / JS 文件 / Rust 插件） ═══════════════ */

function InstallPanel({ onClose }: { onClose: () => void }): ReactNode {
  const [tab, setTab] = useState<"paste" | "jsfile" | "rust" | "github">("paste");
  const [repoInput, setRepoInput] = useState("");
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

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
    <Card pad="md">
      <Stack gap={3} fill>
        <Segment
          size="sm"
          value={tab}
          onChange={(nv) => {
            setTab(nv as typeof tab);
            setMsg(null);
          }}
          options={[
            { value: "paste", label: "粘贴 JS 模块" },
            { value: "jsfile", label: "选择 .js 文件" },
            { value: "rust", label: "Rust 骨干插件" },
            { value: "github", label: "GitHub 仓库" },
          ]}
        />

        {tab === "paste" ? (
          <Stack gap={2} fill>
            <TextArea
              mono
              rows={5}
              placeholder={"export const manifest = { id: \"my.plugin\", name: \"…\", version: \"0.1.0\", permissions: [\"info:read\"] };\nexport default async (ctx) => { /* ctx.onethu.* */ }"}
              value={code}
              onChange={(value) => setCode(value)}
            />
            <Inline gap={2} wrap>
              <Text slot="micro" tone="faint">粘贴完整模块代码，安装即激活。</Text>
              <Spacer />
              <Btn variant="solid" tone="brand" disabled={busy || !code.trim()} loading={busy} onClick={() => void install(code)}>{busy ? "安装中…" : "安装"}</Btn>
            </Inline>
          </Stack>
        ) : null}

        {tab === "jsfile" ? (
          <Stack gap={2} fill>
            <Btn variant="outline" block icon={<IconFile size="md" />} onClick={() => fileRef.current?.click()}>
              点击选择 .js / .mjs 插件文件
            </Btn>
            {/* 裸 file input 仅此一处（触发层换 Btn，读取管线原样）；同 Forum/壁纸库既有模式 */}
            <input
              ref={fileRef}
              type="file"
              accept=".js,.mjs,text/javascript"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void f.text().then(install);
                e.target.value = "";
              }}
            />
            <Text as="p" slot="micro" tone="faint">读取文件内容后与「粘贴安装」走同一校验管线</Text>
          </Stack>
        ) : null}

        {tab === "rust" ? (
          <Stack gap={2} fill>
            <Btn variant="outline" block loading={busy} onClick={() => void installRust()}>
              {busy ? "打开系统对话框…" : "选择 manifest.json（系统文件对话框）"}
            </Btn>
            <Text as="p" slot="micro" tone="faint">二进制须与 manifest.json 同目录（桌面端 sidecar 形态；Android 内置核心无需安装）</Text>
          </Stack>
        ) : null}

        {tab === "github" ? (
          <Stack gap={2} fill>
            <Input
              placeholder="user/repo 或 https://github.com/user/repo（可 @branch 或 /tree/branch）"
              value={repoInput}
              onChange={(value) => setRepoInput(value)}
              onEnter={() => {
                if (!busy && repoInput.trim()) void installFromRepoText(repoInput).catch((e2: unknown) => setMsg(`安装失败：${String(e2 instanceof Error ? e2.message : e2).slice(0, 200)}`));
              }}
            />
            <Inline gap={2} wrap>
              <Text slot="micro" tone="faint">从仓库根目录拉取 plugin.js（或 index.js / main.js），与粘贴安装同一校验管线。</Text>
              <Spacer />
              <Btn variant="solid" tone="brand" disabled={busy || !repoInput.trim()} loading={busy} onClick={() => void installFromRepoText(repoInput).catch((e2: unknown) => setMsg(`安装失败：${String(e2 instanceof Error ? e2.message : e2).slice(0, 200)}`))}>{busy ? "安装中…" : "安装"}</Btn>
            </Inline>
          </Stack>
        ) : null}

        <Inline gap={2} wrap>
          {msg ? (
            <Text as="p" slot="subtitle" tone={msgTone(msg) === "error" ? "error" : msgTone(msg) === "success" ? "success" : "default"}>{msg}</Text>
          ) : (
            <Text as="p" slot="micro" tone="faint">安装即代表信任该代码并授予其声明的权限。</Text>
          )}
          <Spacer />
          <Btn variant="ghost" onClick={onClose}>完成</Btn>
        </Inline>
      </Stack>
    </Card>
  );
}
