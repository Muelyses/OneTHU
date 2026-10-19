import { ExperienceModeControl } from "../components/SimpleExperience.js";
declare const __APP_VERSION__: string;
import { Btn, Inline, Input, List, Row, Segment, Select, SettingsList, SettingsRow, Stack, Tag, Text as OGText, TextArea } from "@onethu/gui";
import { defineSearchRows } from "../state/searchRows.js";
import {
  subscribeWallpaper,
  videoSoundSnapshot,
  setVideoSound,
} from "../state/wallpaper.js";
import { useExplorerState, allTabs } from "../state/explorer.js";
import { WallpaperLibrary } from "../components/explorer/WallpaperLibrary.js";
import { getGlassLevel, glassLevels, setGlassLevel, subscribeGlassLevel, type GlassLevel } from "../lib/glassLevel.js";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { loadTabLayout, saveTabLayout, type TabLayout } from "../lib/tabLayout.js";
import type { ReactNode } from "react";
import { Card, PageHead, SectionHead, Switch } from "../components/Layout.js";
import { setTabLayoutDefault, useTabLayoutDefault } from "../state/tabLayout.js";
import { SoftwareUpdateSection } from "../components/SoftwareUpdateSection.js";
import { ExtHwSettingsSection } from "../components/ExtHwSettingsSection.js";
import { TabManageModal } from "../components/TabManageModal.js";
import { NotifySettingsSection } from "../components/NotifySettingsSection.js";
import { WidgetSettingsSection } from "../components/WidgetSettingsSection.js";
import { OneShotSettings } from "../components/explorer/OneShot.js";
import { NameCardSection } from "../components/NameCardSection.js";
import { invoke } from "@tauri-apps/api/core";
import { showToast } from "../state/toast.js";
import { openUrl } from "@tauri-apps/plugin-opener";
import { clearRemembered, loadRemembered, session, isTauri } from "../lib/clients.js";
import { clearHomeLayout } from "../lib/homeCards.js";
import { useFavs } from "../state/favs.js";
import { activateTheme, deactivateTheme, setDayNightTheme, setFollowSystem, useThemes } from "../state/theme.js";
import { focusSettingsTarget } from "../components/Layout.js";
import { ExplorerPrefsSection } from "../components/ExplorerPrefsSection.js";
import { ThemeChoice } from "../components/ThemePickerModal.js";
import { consumeSettingsSectionRequest, consumeSettingsTabRequest, SETTINGS_TAB_ORDER, subscribeSettingsConsume } from "../state/settingsMode.js";
import { installedPlugins, subscribe as subscribePlugins } from "../plugins/loader.js";
import { requestPluginsView } from "./Plugins.js";
import { isThemeEntry } from "../lib/market.js";
import { ThemePickerModal } from "../components/ThemePickerModal.js";
import { HelpSection } from "../components/HelpSection.js";
import { parseFavs, resetFavs } from "../state/favorites.js";
import { confirmOk } from "../lib/confirm.js";
import { useApp } from "../state/context.js";
import { displayStudentId } from "../lib/privacy.js";
import { useCloudCal, configureCloudCal, disconnectCloudCal, syncCloudCal } from "../state/cloudCal.js";
import {
  useSystemCal,
  systemCalSupported,
  enableSystemCalendar,
  disableSystemCalendar,
  removeSystemCalendar,
  syncSystemCalendar,
} from "../state/systemCal.js";
import { APP_CODENAME } from "../lib/update.js";
import { YktQrPanel, YktWebLoginPanel } from "../components/ExtHwLoginModal.js";
import { YKT_WEB_LOGIN_AVAILABLE } from "../lib/yktWebview.js";
import {
  disableDynamicColor,
  enableDynamicColor,
  fetchSystemPalette,
  isDynamicEnabled,
} from "../lib/dynamicColor.js";
import { subscribeThemes } from "../state/theme.js";
import {
  clearTuojAutoStatus,
  clearTycheLogoutSuppress,
  consumeExtHwScrollRequest,
  ensureExtHwCredsLoaded,
  extHwLogin,
  removeExtHwCreds,
  runYktSessionCheck,
  saveExtHwCreds,
  refreshExtHw,
  useExternalHomework,
} from "../state/exthw.js";
import { buildYktCookieExportJson, parseYktCookieExportJson, SOURCE_CATEGORY_NAMES, SOURCE_NAMES } from "@onethu/core";
import type { ExtHwCreds, ExtHwSourceId, TuojSourceId } from "@onethu/core";
import { ErrorLine } from "../components/Details.js";
import { resetActiveOnboarding } from "../state/onboarding.js";

/** 按分节标题滚动定位（不改各分节标记本身，避免动到千行 JSX） */
function jumpToSection(titles: string[]): void {
  const nodes = Array.from(document.querySelectorAll(".section-head, .sec-title, h2, h3"));
  for (const t of titles) {
    const hit = nodes.find((el) => (el.textContent ?? "").trim().startsWith(t));
    if (hit) {
      hit.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
  }
}

/** 设置页的二级页签（与信息页 / 生活页同形态）：标题 → 页签分组 */
const SETTINGS_TAB_OF: Record<string, string> = {
  关于: "关于", 账户: "账号", 账号与绑定: "账号", 安全: "账号",
  云同步: "数据与同步", 外部作业源: "数据与同步",
  OneShot: "外观与布局", 首页布局: "外观与布局", 收藏夹: "外观与布局", 外观: "外观与布局",
  工作空间: "外观与布局", /* dev-explorer：缺键会让工作空间分节在所有页签恒显（用户实测「其他 设置多了个不动的分节/触发不一致」） */
  /* OneGUI Section 的 textContent 含 hint（「搜索与胶囊底栏胶囊…」），下面按最长前缀匹配 */
  搜索与胶囊: "外观与布局",
  极客模式: "桌面小组件",
  通知: "通知与提醒",
  /* 2026-10-11 重构：桌面小组件独立成栏；语音合成/悬浮球迁到 OH 页；插件改成独立入口 */
  桌面小组件: "桌面小组件",
  下载: "下载与存储", 帮助: "帮助",
};
/* 页签清单与高级页签定义已挪到 state/settingsMode.ts（命令面板与护栏共用同一份，见该文件注释） */


/* ── task-19：设置页各分节的设置行注册（声明式；与页签一一对应）── */
defineSearchRows([
  { id: "set-theme-board", tab: "外观与布局", section: "主题", title: "主题", aliases: ["换主题", "配色", "主题板", "暗色", "夜间"], desc: "只列已启用主题，点「应用」切换" , breadcrumb: ["设置", "外观与布局", "主题", "主题"] },
  { id: "set-theme-install", tab: "外观与布局", section: "主题", title: "安装主题", aliases: ["主题市场", "装主题"], desc: "打开插件市场的主题筛选" , breadcrumb: ["设置", "外观与布局", "主题", "安装主题"], go: () => requestPluginsView({ view: "market", category: "theme" }) },
  { id: "set-theme-manage", tab: "外观与布局", section: "主题", title: "管理主题", aliases: ["启用主题", "停用主题"], desc: "主题插件的启用 / 停用" , breadcrumb: ["设置", "外观与布局", "主题", "管理主题"], go: () => requestPluginsView({ view: "mine", category: "theme" }) },
  { id: "set-theme-follow", tab: "外观与布局", section: "主题", title: "跟随系统昼夜", aliases: ["昼夜", "白天主题", "黑夜主题", "自动切换"], desc: "亮色用白天主题，深色用黑夜主题" , breadcrumb: ["设置", "外观与布局", "主题", "跟随系统昼夜"] },
  { id: "set-appearance", tab: "外观与布局", section: "外观", title: "外观", aliases: ["密度", "字号", "圆角", "主题色"], desc: "主题、标签栏、玻璃程度、取色等外观项" , breadcrumb: ["设置", "外观与布局", "外观", "外观"] },
  { id: "set-wallpaper", tab: "外观与布局", section: "外观", title: "壁纸", aliases: ["墙纸", "背景", "背景图", "动态壁纸", "上传壁纸", "壁纸库"], desc: "全窗壁纸库、上传与动态壁纸声音" , breadcrumb: ["设置", "外观与布局", "外观", "壁纸"] },
  { id: "set-wallpaper-sound", tab: "外观与布局", section: "外观", title: "动态壁纸声音", aliases: ["视频壁纸声音", "壁纸静音"], desc: "视频壁纸有声时是否放开声音" , breadcrumb: ["设置", "外观与布局", "外观", "动态壁纸声音"] },
  { id: "set-tabbar-style", tab: "外观与布局", section: "外观", title: "标签栏样式", aliases: ["标签栏", "竖栏", "横栏", "标签栏默认"], desc: "横版顶部标签 / 竖版左侧标签" , breadcrumb: ["设置", "外观与布局", "外观", "标签栏样式"] },
  { id: "set-glass-level", tab: "外观与布局", section: "外观", title: "玻璃程度", aliases: ["玻璃", "材质", "毛玻璃", "透明", "透彻", "玻璃质感"], desc: "全站玻璃面材浓度四档" , breadcrumb: ["设置", "外观与布局", "外观", "玻璃程度"] },
  { id: "set-dyn-color", tab: "外观与布局", section: "外观", title: "跟随系统取色", aliases: ["动态取色", "壁纸取色", "系统取色", "动态颜色"], desc: "用壁纸颜色重算全站配色" , breadcrumb: ["设置", "外观与布局", "外观", "跟随系统取色"] },
  { id: "set-capsule-tap", tab: "外观与布局", section: "工作空间", title: "点击胶囊默认打开", aliases: ["胶囊", "胶囊默认动作", "搜索与胶囊", "底栏胶囊"], desc: "点胶囊默认进搜索还是 OH 对话" , breadcrumb: ["设置", "外观与布局", "工作空间", "点击胶囊默认打开"] },
  { id: "set-search-history", tab: "外观与布局", section: "工作空间", title: "最近搜索记录", aliases: ["搜索历史", "清空搜索记录"], desc: "保留最近 10 条搜索记录，可清空" , breadcrumb: ["设置", "外观与布局", "工作空间", "最近搜索记录"] },
  { id: "set-geek", tab: "桌面小组件", section: "极客模式", title: "极客模式（浏览器探索）", aliases: ["极客", "探索浏览器", "playwright", "浏览器自动化"], desc: "浏览器探索开关、环境下载与启动方式" , breadcrumb: ["设置", "桌面小组件", "极客模式", "极客模式（浏览器探索）"] },
  { id: "set-geek-download", tab: "桌面小组件", section: "极客模式", title: "探索浏览器环境", aliases: ["playwright 下载", "下载浏览器", "浏览器环境"], desc: "一键下载/检查 Playwright 浏览器与独立 profile" , breadcrumb: ["设置", "桌面小组件", "极客模式", "探索浏览器环境"], landOn: { section: "极客模式", note: "下载/检查在「极客模式（浏览器探索）」行下方的环境卡里；已带到「极客模式」分节。" } },
  { id: "set-home-layout", tab: "外观与布局", section: "首页布局", title: "首页布局", aliases: ["首页", "卡片顺序"], desc: "首页卡片显隐与排序" , breadcrumb: ["设置", "外观与布局", "首页布局", "首页布局"] },
  { id: "set-favs", tab: "外观与布局", section: "收藏夹", title: "收藏夹", aliases: ["收藏", "导入收藏", "导出收藏"], desc: "收藏夹管理与导入导出" , breadcrumb: ["设置", "外观与布局", "收藏夹", "收藏夹"] },
  { id: "set-cloud", tab: "数据与同步", section: "云同步", title: "云同步", aliases: ["同步", "云盘同步", "备份"], desc: "云盘同步与恢复" , breadcrumb: ["设置", "数据与同步", "云同步", "云同步"] },
  { id: "set-exthw", tab: "数据与同步", section: "外部作业源", title: "外部作业源", aliases: ["作业源", "OJ", "课件"], desc: "外部作业源登录与刷新" , breadcrumb: ["设置", "数据与同步", "外部作业源", "外部作业源"] },
  { id: "set-download", tab: "下载与存储", section: "下载", title: "下载", aliases: ["存储", "缓存", "清理"], desc: "下载目录与缓存清理" , breadcrumb: ["设置", "下载与存储", "下载", "下载"] },
  { id: "set-notify", tab: "通知与提醒", section: "通知", title: "通知", aliases: ["提醒", "推送"], desc: "通知与提醒设置" , breadcrumb: ["设置", "通知与提醒", "通知", "通知"] },
  { id: "set-account", tab: "账号", section: "账号与绑定", title: "账号与绑定", aliases: ["登录", "学号", "绑定"], desc: "清华账号登录与绑定" , breadcrumb: ["设置", "账号", "账号与绑定", "账号与绑定"] },
  { id: "set-security", tab: "账号", section: "安全", title: "安全", aliases: ["密码", "记住密码"], desc: "记住的密码与安全项" , breadcrumb: ["设置", "账号", "安全", "安全"] },
  { id: "set-about", tab: "关于", section: "关于", title: "关于", aliases: ["版本", "更新", "开源"], desc: "版本、更新与开源信息" , breadcrumb: ["设置", "关于", "关于", "关于"] },
  { id: "set-account-row", tab: "账号", section: "账户", title: "账户", aliases: ["已登录", "退出登录"], desc: "当前登录状态与退出" , breadcrumb: ["设置", "账号", "账户", "账户"] },
  { id: "set-saved-pwd", tab: "账号", section: "安全", title: "记住的密码", aliases: ["保存密码", "清除密码"], desc: "本机保存的登录密码（可清除）" , breadcrumb: ["设置", "账号", "安全", "记住的密码"] },
  { id: "set-tab-manage", tab: "关于", section: "关于", title: "管理栏目", aliases: ["栏目显隐", "页签排序"], desc: "设置栏目的显隐与排序" , breadcrumb: ["设置", "关于", "关于", "管理栏目"] },
  { id: "set-tour", tab: "关于", section: "关于", title: "导览", aliases: ["重新运行引导", "新手引导"], desc: "重新运行首次使用引导" , breadcrumb: ["设置", "关于", "关于", "导览"] },
  { id: "set-update", tab: "关于", section: "关于", title: "检查 OneTHU 更新", aliases: ["本体更新", "版本更新"], desc: "检查应用本体更新" , breadcrumb: ["设置", "关于", "关于", "检查 OneTHU 更新"] },
  { id: "set-cloud-reconnect", tab: "数据与同步", section: "云同步", title: "云盘重连", aliases: ["重新连接云盘", "token"], desc: "云盘连接失效时一键重连" , breadcrumb: ["设置", "数据与同步", "云同步", "云盘重连"], landOn: { section: "云同步", note: "云盘连接出问题在「日程云同步」那张卡上重试/重新授权；当前没有独立的「云盘重连」按钮（连接正常时用不上），已带到「云同步」分节。" } },
  { id: "set-exthw-creds", tab: "数据与同步", section: "外部作业源", title: "外部作业源登录", aliases: ["作业源凭据", "OJ 登录"], desc: "外部作业源账号登录与刷新" , breadcrumb: ["设置", "数据与同步", "外部作业源", "外部作业源登录"], landOn: { section: "外部作业源", note: "登录入口按作业源分卡：OJ 类收在「OJ 平台登录」折叠卡里，雨课堂等各卡有自己的登录入口；已带到「外部作业源」分节。" } },
  { id: "set-dl-dir", tab: "下载与存储", section: "下载", title: "下载目录 / 缓存清理", aliases: ["缓存", "存储占用", "清理"], desc: "下载目录位置与缓存清理" , breadcrumb: ["设置", "下载与存储", "下载", "下载目录 / 缓存清理"], landOn: { section: "下载", note: "下载目录=「下载位置」一行；缓存/诊断在「运行日志」「诊断摘要」行——已带到「下载」分节。" } },
  { id: "set-help", tab: "帮助", section: "帮助", title: "帮助", aliases: ["教程", "导览"], desc: "常用任务与引导" , breadcrumb: ["设置", "帮助", "帮助", "帮助"] },
]);

export function SettingsPage() {
  /** 当前二级页签（默认第一个栏目） */
  const [tab, setTab] = useState<string>(SETTINGS_TAB_ORDER[0] ?? "账号");
  /** 手机端判定：插件入口在「我的」页里也要有一份（与桌面侧栏同款框） */
  const settingsTabLayout: TabLayout = loadTabLayout("settings", SETTINGS_TAB_ORDER);
  const settingsTabHidden = settingsTabLayout.hidden;
  const [manageOpen, setManageOpen] = useState(false);
  const [tabLayout, setTabLayout] = useState<TabLayout>(() => settingsTabLayout);
  const applyTabLayout = (l: TabLayout): void => {
    setTabLayout(l);
    saveTabLayout("settings", l);
  };

  // R23（霖实测：跳过来还得自己找分区在哪）：引导横幅「去设置」→ **先切到外部作业源
  // 所在页签再滚动**。此前只在子组件里 scrollIntoView——分区在 display:none 的页签里，
  // 滚动无效，用户落在设置页顶部还要自己找。
  // task-22（检索收尾）：consume 逻辑抽成**稳定函数**，两个入口同吃——
  //   ① 挂载（跨页进设置的那一次，R23 的原始路径）② 订阅（命令面板/底栏检索在设置页
  // 内点行时**就地**消费——mount-only 的 consume 永远等不到那时落下的请求）。
  const consumePendingRequests = useCallback((): (() => void) | undefined => {
    const wantTab = consumeSettingsTabRequest();
    if (wantTab) setTab(wantTab);
    /* 分区子请求：等页签显隐 effect 跑完再滚动，并**短暂高亮**该分节（用户一眼看到） */
    const wantSec = consumeSettingsSectionRequest();
    if (wantSec) {
      const t = setTimeout(() => {
        if (focusSettingsTarget(wantSec)) return; // 行级直达优先（搜索落到"哪一行"）
        jumpToSection([wantSec]);
        /* 两族一起认：OneGUI 迁移后分节头是 .og-section（未迁页仍是 .section-head） */
        const heads = Array.from(document.querySelectorAll<HTMLElement>(".section-head, .og-section"));
        const hit = heads.find((el) => (el.textContent ?? "").trim().startsWith(wantSec));
        const card = hit?.nextElementSibling as HTMLElement | null;
        for (const el of [hit, card]) {
          if (!el) continue;
          el.classList.add("sec-focus");
          setTimeout(() => el.classList.remove("sec-focus"), 1800);
        }
      }, 160);
      return () => clearTimeout(t);
    }
    if (!consumeExtHwScrollRequest()) return;
    setTab(SETTINGS_TAB_OF["外部作业源"] ?? "数据与同步");
    const t2 = setTimeout(() => {
      document.getElementById("settings-exthw")?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 120); // 等页签显隐 effect（按 tab 切 display）先跑完
    return () => clearTimeout(t2);
  }, []);
  useEffect(() => {
    const off = consumePendingRequests();
    return () => off?.();
  }, [consumePendingRequests]);
  /* 页内新落下的请求（检索条 / 插件页 / OH 门面）就地消费 */
  useEffect(() => {
    const off = subscribeSettingsConsume(() => {
      const cleanup = consumePendingRequests();
      if (cleanup) window.setTimeout(cleanup, 0);
    });
    return off;
  }, [consumePendingRequests]);

  /**
   * 页签显隐。三个坑（2026-09-20 实测；③ 2026-10-14 补）：
   *  ① `hidden` 属性会被 app 里的 display 规则压过去 → 必须用行内 style.display；
   *  ② 各分节并非同一父节点的兄弟：外部作业源 / 下载 / 外观等分节渲染在子组件内部，
   *     因此必须逐个分节头在**各自父节点内**向后收拢其内容，不能只遍历首层兄弟。
   *  ③ 分节头现在是**两族**：OneGUI 迁移后是 .og-section（children 装在头节点内），
   *     未迁页面仍是 .section-head（内容是头后面的兄弟节点）——只认旧族会让
   *     显隐 effect 空转（querySelectorAll 找到 0 个），所有分节在**每个页签**下都可见
   *     （网格在 2026-10-14 用户实测「设置栏各自不对应了」——即为它）。 */
  useEffect(() => {
    const heads = Array.from(document.querySelectorAll<HTMLElement>(".section-head, .og-section"));
    for (const head of heads) {
      const title = (head.textContent ?? "").trim();
      /* 精确优先；OneGUI 的 .og-section textContent = 标题 + hint，按最长已注册前缀兜底。 */
      const prefix = Object.keys(SETTINGS_TAB_OF)
        .filter((k) => title.startsWith(k))
        .sort((a, b) => b.length - a.length)[0];
      const group = SETTINGS_TAB_OF[title] ?? (prefix ? SETTINGS_TAB_OF[prefix] : null) ?? (/课件|OJ/.test(title) ? "数据与同步" : null);
      if (!group) continue;
      const show = group === tab;
      /* show/hide 两支都必须走兄弟收拢：只收拢 hide 支时，先前隐藏轮留下的
         display:none 永远洗不掉（2026-10-14 实测：切成页签后外观/壁纸两卡消失）。 */
      const apply = (el: HTMLElement): void => {
        el.style.display = show ? "" : "none";
      };
      apply(head);
      let sib = head.nextElementSibling as HTMLElement | null;
      while (sib && !sib.classList.contains("section-head") && !sib.classList.contains("og-section")) {
        apply(sib);
        sib = sib.nextElementSibling as HTMLElement | null;
      }
    }
  }, [tab, tabLayout.hidden.join(",")]);

  // Keep the selected category fully visible in the horizontal phone strip.
  useEffect(() => {
    const row = document.querySelector<HTMLElement>(".workbench-settings-tabs");
    const active = row?.querySelector<HTMLElement>("[aria-selected=true]");
    if (!row || !active || row.scrollWidth <= row.clientWidth) return;
    const r = row.getBoundingClientRect(), a = active.getBoundingClientRect();
    row.scrollLeft += a.left - r.left - (r.width - a.width) / 2;
  }, [tab]);

  const { user, logout, navigate } = useApp();
  const favs = useFavs();
  const [favMsg, setFavMsg] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [hasSaved, setHasSaved] = useState(false);
  const [clearing, setClearing] = useState(false);
  // 首页布局恢复：点击后短暂显示「已恢复默认」，到点回位
  const [homeResetAt, setHomeResetAt] = useState(0);
  const [eidMsg, setEidMsg] = useState<string | null>(null);
  // 云同步（清华邮箱 CalDAV 日历）
  const cloud = useCloudCal();
  const [calEmail, setCalEmail] = useState("");
  const [calPass, setCalPass] = useState("");
  const [calBusy, setCalBusy] = useState(false);
  const [calMsg, setCalMsg] = useState<string | null>(null);
  // 系统日历原生同步（Android/macOS）
  const syscal = useSystemCal();
  const [sysSupported, setSysSupported] = useState<boolean | null>(null);
  const [sysBusy, setSysBusy] = useState(false);
  const [sysMsg, setSysMsg] = useState<string | null>(null);

  useEffect(() => {
    void systemCalSupported().then(setSysSupported);
  }, []);

  useEffect(() => {
    void loadRemembered().then((r) => setHasSaved(!!r));
  }, []);

  useEffect(() => {
    if (!homeResetAt) return;
    const t = setTimeout(() => setHomeResetAt(0), 2400);
    return () => clearTimeout(t);
  }, [homeResetAt]);

  const onClear = async () => {
    setClearing(true);
    try {
      await clearRemembered();
      setHasSaved(false);
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="workbench-settings">
      <PageHead
        title="设置"
        actions={
          <>
            <Btn variant="outline" onClick={() => {
                resetActiveOnboarding();
                location.reload();
              }} titleAttr="重新运行首次使用引导">导览
            </Btn>
            <Btn variant="outline" onClick={() => setManageOpen(true)} titleAttr="栏目显隐与排序">管理栏目
            </Btn>
          </>
        }
      />


      <ExperienceModeControl/>
      <div className="workbench-settings-layout">
      <nav className="workbench-settings-nav" aria-label="设置栏目">
      <div className="workbench-settings-tabs" role="tablist" aria-label="设置栏目" onKeyDown={event => {
        if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=tab]"));
        const index = tabs.indexOf(event.target as HTMLButtonElement);
        if (index < 0) return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
          : (index + (["ArrowUp", "ArrowLeft"].includes(event.key) ? -1 : 1) + tabs.length) % tabs.length;
        tabs[next]?.focus(); tabs[next]?.click();
      }}>
        {settingsTabLayout.order
          .filter((t) => SETTINGS_TAB_ORDER.includes(t) && !tabLayout.hidden.includes(t))
          .map((t) => (
            <Btn
              key={t}
              role="tab"
              aria-selected={tab === t}
              aria-controls="workbench-settings-panel"
              tabIndex={tab === t ? 0 : -1}
              className={tab === t ? "is-active" : ""}
              onClick={() => setTab(t)}
            >
              {t}
            </Btn>
          ))}
      </div>
      </nav>
      <div className="workbench-settings-content" id="workbench-settings-panel" role="tabpanel" aria-label={tab}>
      <div className="workbench-settings-title"><h2>{tab}</h2><p>按你的习惯，调整 OneTHU。</p></div>
      <SectionHead title="帮助" />
      <Card>
        <HelpSection />
      </Card>

      <SectionHead title="关于" />
      <SoftwareUpdateSection />
      <Card>
        <SettingsRow
          title={<>OneTHU {__APP_VERSION__} “{APP_CODENAME}”</>}
          sub="清华园随身工具箱 · 开源于 GitHub"
          control={<Btn variant="outline" size="sm" onClick={() => void openUrl("https://github.com/smartThise/OneTHU")}>GitHub 项目页</Btn>}
        />
        {/* 运行日志导出属开发者功能：正式版不显示（真机取证走 adb logcat -s onethu:V，
            或改用开发者构建的右上角面板导出）。要恢复成正式版也显示，去掉这层门控即可。 */}
        {__ONETHU_DEV__ ? <DebugLogRow /> : null}
        <DiagnosticsRow />
        {/* 首启流程灰度开关已随导览 v3 改版退役：播放统一走 OnboardingTourV3，
            「导览」按钮（页头）负责清 flow3 完成标记重新走一轮。 */}
      </Card>

      <SectionHead title="账户" />
      <Card>
        <SettingsRow
          title="统一认证"
          sub={user?.displayName || displayStudentId(user?.username) || "未登录"}
          control={<Btn variant="outline" size="sm" onClick={() => void logout()}>退出登录</Btn>}
        />
      </Card>


      <SectionHead title="账号与绑定" />
      <SettingsList>
        <SettingsRow
          title="清华电子身份（账号密码管理）"
          sub={
            <>
              在应用内的窗口打开清华统一身份认证，自动填入账号密码（有图形验证码时需手动输入）。
              <b>删除已保存的登录信息或修改密码，可能导致 OneTHU 退出登录</b>，需重新登录一次。
              {eidMsg ? <ErrorLine text={eidMsg} tone="quiet" /> : null}
            </>
          }
          control={<Btn variant="outline" size="sm" onClick={() => {
              const creds = session.getIdCredentials();
              if (!creds) {
                void openUrl("https://id.tsinghua.edu.cn/do/outoflogin/login/mainUi/login")
                  .then(() => setEidMsg("已在系统浏览器打开，请手动输入账号密码"))
                  .catch((e: unknown) => setEidMsg(`打开失败：${e instanceof Error ? e.message : String(e)}`));
                return;
              }
              const openInBrowser = () =>
                openUrl("https://id.tsinghua.edu.cn/do/outoflogin/login/mainUi/login")
                  .then(() => setEidMsg("已在系统浏览器打开（自动填入仅在桌面端可用）"))
                  .catch((e: unknown) => setEidMsg(`打开失败：${e instanceof Error ? e.message : String(e)}`));
              void invoke("open_eid_window", { username: creds.username, password: creds.password })
                .then(() => setEidMsg("电子身份窗口已打开，账号密码已自动填入"))
                .catch(() => void openInBrowser());
            }}>打开电子身份
          </Btn>
          }
        />
      </SettingsList>





      <SectionHead title="云同步" />
      <Card>
        <SettingsRow
          title={cloud.configured ? "日程云同步 · 已连接" : "日程云同步（清华邮箱日历）"}
          sub={
            cloud.configured ? (
              <>
                {cloud.email} · 通过清华邮箱日历（CalDAV）多设备同步日程；在「日程」页查看与编辑。
                {calMsg ? <ErrorLine text={calMsg} tone="quiet" /> : null}
              </>
            ) : (
              <>
                用清华邮箱的日历服务在多台设备间同步日程——OneTHU 里添加的日程会出现在系统日历 / 其他设备（添加同一账号）。
                授权码获取：网页版邮箱（mails.tsinghua.edu.cn）→ 设置 → 客户端专用密码。
                {calMsg ? <ErrorLine text={calMsg} tone="quiet" /> : null}
              </>
            )
          }
          control={
            cloud.configured ? (
              <Inline gap={2} wrap>
                <Btn variant="outline" onClick={() =>
                    void confirmOk(
                      "在 iPhone / iPad 上查看日程（可选）\n\n手机上没有 OneTHU 也没关系：日程已在你清华邮箱的云端日历里，在 iPhone/iPad 上添加同一邮箱即可看到：\n· 设置 → 日历 → 账户 → 添加账户 → 其他 → CalDAV 账户\n· 服务器地址：https://mails.tsinghua.edu.cn/coremail/dav/users/你的邮箱/\n· 用户名：完整邮箱；密码：客户端专用密码（与本页一致）\n\n本机不需要此设置——用下方「系统日历同步」一键开启即可，应用直接写系统日历。",
                    )
                  }>iPhone 上查看
                </Btn>
                <Btn variant="outline" disabled={calBusy || cloud.syncing} onClick={() => {
                    setCalBusy(true);
                    setCalMsg(null);
                    void syncCloudCal()
                      .then((r) => setCalMsg(`已同步：云端共 ${r.total} 个日程（新增 ${r.added}、更新 ${r.updated}、移除 ${r.removed}）。`))
                      .catch((e: unknown) => setCalMsg(`同步失败：${e instanceof Error ? e.message : String(e)}`))
                      .finally(() => setCalBusy(false));
                  }}>{calBusy || cloud.syncing ? "同步中…" : "立即同步"}</Btn>
                <Btn variant="outline" onClick={() =>
                    void disconnectCloudCal().then(() => {
                      setCalEmail("");
                      setCalPass("");
                      setCalMsg(null);
                    })
                  }>断开
                </Btn>
              </Inline>
            ) : null
          }
        />
        {cloud.configured ? null : (
          <div className="og-settings-row" style={{ alignItems: "stretch" }}>
            <span className="og-settings-row-main">
              <Inline gap={2} wrap>
                <div style={{ minWidth: 200, flex: "1 1 200px" }}><Input placeholder="完整邮箱地址（如 someone@mails.tsinghua.edu.cn）" value={calEmail} onChange={(value) => setCalEmail(value.trim())} /></div>
                <div style={{ minWidth: 140, flex: "1 1 140px" }}><Input type="password" placeholder="客户端专用密码" value={calPass} onChange={(value) => setCalPass(value)} /></div>
                <Btn variant="solid" tone="brand" disabled={!/.+@.+/.test(calEmail) || !calPass || calBusy} onClick={() => {
                    setCalBusy(true);
                    setCalMsg(null);
                    void configureCloudCal(calEmail, calPass)
                      .then((cals) => setCalMsg(`连接成功，发现日历：${cals.join("、")}。`))
                      .catch((e: unknown) => setCalMsg(`连接失败：${e instanceof Error ? e.message : String(e)}`))
                      .finally(() => setCalBusy(false));
                  }}>{calBusy ? "连接中…" : "保存并验证"}</Btn>
              </Inline>
            </span>
          </div>
        )}
      </Card>
      <Card>
        <SettingsRow
          title={sysSupported === false ? "系统日历同步" : syscal.enabled ? "系统日历同步 · 已开启" : "系统日历同步"}
          sub={
            sysSupported === false ? (
              "本平台不支持直写系统日历；可在「日程」页导出 .ics 再导入。"
            ) : syscal.enabled ? (
              <>
                日历「OneTHU 日程」· 上次同步 {syscal.lastSyncAt ? new Date(syscal.lastSyncAt).toLocaleString() : "—"} · {syscal.lastCount} 条。课表与日程变化后会自动更新（含提前 15 分钟的课程提醒）。
                {syscal.lastError ? <OGText as="div" slot="label" tone="error">最近一次同步失败：{syscal.lastError}</OGText> : null}
                {sysMsg ? <ErrorLine text={sysMsg} tone="quiet" /> : null}
              </>
            ) : (
              <>
                把课表与日程写入系统日历里的专属日历「OneTHU 日程」（不影响你已有的日历）。开启后自动保持最新：添加、修改、删除日程或刷新课表都会同步更新，课程与考试带提前 15 分钟提醒。无需配置任何账户，一键开启。
                {sysMsg ? <ErrorLine text={sysMsg} tone="quiet" /> : null}
              </>
            )
          }
          control={
            sysSupported === false ? null : syscal.enabled ? (
              <Inline gap={2} wrap>
                <Btn variant="outline" disabled={sysBusy || syscal.syncing} onClick={() => {
                    setSysBusy(true);
                    setSysMsg(null);
                    void syncSystemCalendar()
                      .then((r) =>
                        setSysMsg(r.skipped ? "内容无变化，系统日历已是最新" : `已同步：写入 ${r.added} 条（清理旧 ${r.removed} 条）。`),
                      )
                      .catch((e: unknown) => setSysMsg(`同步失败：${e instanceof Error ? e.message : String(e)}`))
                      .finally(() => setSysBusy(false));
                  }}>{sysBusy || syscal.syncing ? "同步中…" : "立即同步"}</Btn>
                <Btn variant="outline" disabled={sysBusy} onClick={() => {
                    void disableSystemCalendar()
                      .then(() => setSysMsg("已停止自动同步，已写入的日历与事件保留"))
                      .catch((e: unknown) => setSysMsg(String(e instanceof Error ? e.message : e)));
                  }}>停止自动同步
                </Btn>
                <Btn variant="outline" disabled={sysBusy} onClick={() => {
                    void confirmOk(
                      "确定删除系统日历里的「OneTHU 日程」日历？\n\n其中由 OneTHU 写入的全部事件将被移除；应用内的日程与云同步不受影响。",
                    ).then((yes) => {
                      if (!yes) return;
                      setSysBusy(true);
                      void removeSystemCalendar()
                        .then(() => setSysMsg("已删除系统日历「OneTHU 日程」。"))
                        .catch((e: unknown) => setSysMsg(`删除失败：${e instanceof Error ? e.message : String(e)}`))
                        .finally(() => setSysBusy(false));
                    });
                  }}>清除系统日历
                </Btn>
              </Inline>
            ) : (
              <Btn variant="solid" tone="brand" disabled={sysBusy || sysSupported === null} onClick={() => {
                  setSysBusy(true);
                  setSysMsg(null);
                  void enableSystemCalendar()
                    .then(() => setSysMsg("系统日历「OneTHU 日程」已写入，此后自动保持最新"))
                    .catch((e: unknown) => setSysMsg(`开启失败：${e instanceof Error ? e.message : String(e)}`))
                    .finally(() => setSysBusy(false));
                }}>{sysBusy ? "开启中…" : "开启并同步"}</Btn>
            )
          }
        />
      </Card>
      <SectionHead title="外部作业源" />
      <ExtHwSettingsSection />

      <DownloadSettings />

      <SectionHead title="首页布局" />
      <SettingsList>
        <SettingsRow
          title="恢复默认首页布局"
          sub="清除首页卡片的排列、折叠与隐藏记录，回到默认版式。"
          control={<Btn variant="outline" size="sm" onClick={() => { clearHomeLayout(); setHomeResetAt(Date.now()); }}>{homeResetAt ? "已恢复默认" : "恢复默认布局"}</Btn>}
        />
      </SettingsList>

      <SectionHead title="工作空间" />
      <ExplorerPrefsSection />

      <SectionHead title="收藏夹" />
      <SettingsList>
        <SettingsRow
          title="恢复默认收藏夹"
          sub={
            <>
              删除全部用户收藏夹与折叠记录（默认一级入口不受影响，永远在左侧栏）。
              各功能仍在原来的页面，收藏夹只是跳转入口。
              {favMsg ? <>　{favMsg}</> : null}
            </>
          }
          control={
            <Inline gap={2} wrap>
              <Btn variant="outline" onClick={() => {
                  const json = JSON.stringify(favs.data);
                  const clip = navigator.clipboard;
                  if (!clip?.writeText) {
                    setFavMsg("剪贴板不可用，请改用导入框核对");
                    return;
                  }
                  void clip
                    .writeText(json)
                    .then(() => setFavMsg("收藏夹已复制到剪贴板（" + favs.data.order.length + " 个根收藏夹）"))
                    .catch(() => setFavMsg("复制未成功，请改用下方的导入框核对"));
                }}>导出（复制 JSON）
              </Btn>
              <Btn variant="outline" onClick={() => { setImportOpen((o) => !o); setImportText(""); setFavMsg(null); }}>导入
              </Btn>
              <Btn variant="outline" onClick={() =>
                  void confirmOk("删除全部用户收藏夹并复位折叠记录？默认一级入口不受影响。").then((ok) => {
                    if (!ok) return;
                    favs.replaceAll(resetFavs());
                    setFavMsg("已恢复默认。");
                  })
                }>恢复默认
              </Btn>
            </Inline>
          }
        />
        {importOpen ? (
          <div className="og-settings-row" style={{ alignItems: "stretch" }}>
            <span className="og-settings-row-main">
              <TextArea placeholder={"粘贴收藏夹内容（另一台设备导出的）…"} value={importText} onChange={(value) => setImportText(value)} />
              <Inline gap={2}>
                <Btn variant="solid" tone="brand" disabled={!importText.trim()} onClick={() => {
                    const parsed = parseFavs(importText);
                    if (!parsed) {
                      setFavMsg("导入失败：格式不正确，请粘贴本应用导出的内容");
                      return;
                    }
                    favs.replaceAll(parsed);
                    setImportOpen(false);
                    setImportText("");
                    setFavMsg("已导入 " + parsed.order.length + " 个根收藏夹。");
                  }}>导入并覆盖
                </Btn>
                <Btn variant="ghost" onClick={() => setImportOpen(false)}>取消</Btn>
              </Inline>
            </span>
          </div>
        ) : null}
      </SettingsList>

      <SectionHead title="外观" />
      <SettingsList>
        <AppearanceSection />
      </SettingsList>
      <Card>
        <WallpaperSection />
      </Card>
      <SectionHead title="OneShot 快捷入口" />
      <SettingsList>
        <OneShotSettings />
      </SettingsList>
      <SectionHead title="通知" />
      <Card>
        <NotifySettingsSection />
      </Card>
      <SectionHead title="桌面小组件" />
      <Card>
        <WidgetSettingsSection />
      </Card>
      <SectionHead title="极客模式" />
      <GeekSection />
      {/* 2026-10-11（用户纠正）：OH **不是设置页的二级**，而是**插件页的二级子页面**
          （基础设置 / 高级配置）——分节与页签都已从这里移除，见 pages/Plugins.tsx 的 OH 入口。 */}
      <SectionHead title="安全" />
      <Card>
        <SettingsRow
          title="记住的密码"
          sub={hasSaved ? "已在本机保存，重启后自动登录" : "未保存；登录时勾选「记住密码」即可启用"}
          control={
            hasSaved ? (
              <Btn variant="outline" size="sm" disabled={clearing} onClick={() => void onClear()}>{clearing ? "清除中…" : "清除"}</Btn>
            ) : null
          }
        />
      </Card>
      </div>
      </div>
      <TabManageModal
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        title="管理设置栏目"
        tabs={SETTINGS_TAB_ORDER.map((id) => ({ id, label: id }))}
        layout={tabLayout}
        onApply={applyTabLayout}
        onReset={() => applyTabLayout({ order: SETTINGS_TAB_ORDER, hidden: [] })}
      />

    </div>
  );
}

/* ── 下载位置（网络学堂附件与云盘文件落盘处）──
 * 桌面端：系统文件夹选择器 + 本机保存；Android：SAF 目录树（见 onethu-mobile 插件）。
 * 这里只做「读当前值 / 让用户改」，真正的落盘判断在原生侧（downloads.rs / 插件）。 */
type DownloadDirectory = { path: string; isDefault: boolean };

function DownloadSettings() {
  const [available, setAvailable] = useState(isTauri);
  const [directory, setDirectory] = useState<DownloadDirectory | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!available) return;
    let active = true;
    void invoke<DownloadDirectory | null>("download_directory_get")
      .then((value) => {
        if (!active) return;
        setDirectory(value);
        if (!value) setAvailable(false);   // 该平台不支持（如未接入的形态）：不显示这一块
      })
      .catch((e: unknown) => {
        if (active) setMessage(`读取下载位置失败：${e instanceof Error ? e.message : String(e)}`);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [available]);

  const changeDirectory = async (reset: boolean): Promise<void> => {
    setBusy(true);
    setMessage(null);
    try {
      const value = await invoke<DownloadDirectory | null>(
        reset ? "download_directory_reset" : "download_directory_pick",
      );
      if (value) {
        setDirectory(value);
        setMessage(reset ? "已恢复默认下载位置。" : "下载位置已保存，下次下载时生效。");
      }
    } catch (e) {
      setMessage(`修改失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  if (!available) return null;
  return (
    <>
      <SectionHead title="下载" />
      <Card>
        <SettingsRow
          title="下载位置"
          sub={
            <>
              {loading ? "正在读取…" : directory?.path || "下载位置读取失败，请重新选择文件夹或恢复默认。"}
              <OGText slot="label" tone="faint">网络学堂附件与云盘文件存到这里；「另存为」可临时换地方。</OGText>
              {message ? <OGText slot="label" tone="quiet" as="span">{message}</OGText> : null}
            </>
          }
          control={
            <>
              <Btn variant="outline" size="sm" disabled={loading || busy} onClick={() => void changeDirectory(false)}>选择文件夹</Btn>
              <Btn variant="outline" size="sm" disabled={loading || busy || directory?.isDefault} onClick={() => void changeDirectory(true)}>恢复默认</Btn>
            </>
          }
        />
      </Card>
    </>
  );
}

/* ── 运行日志导出（真机问题取证：安卓日志落应用数据目录，一键转存系统下载）── */
function DebugLogRow() {
  const [busy, setBusy] = useState(false);
  const [where, setWhere] = useState<string | null>(null);
  const run = async (): Promise<void> => {
    setBusy(true);
    try {
      const path = await invoke<string>("debug_log_export");
      setWhere(path);
      showToast("日志已导出到系统下载");
    } catch (err) {
      showToast(String(err instanceof Error ? err.message : err).slice(0, 60));
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingsRow
      title="运行日志"
      sub={where ? `已导出：${where}` : "用于问题排查，导出到系统下载"}
      control={<Btn variant="outline" size="sm" disabled={busy} onClick={() => void run()}>{busy ? "导出中…" : "导出日志"}</Btn>}
    />
  );
}

/* ── 诊断摘要（2026-09-23）：反馈问题时一键复制，用户不必交出运行日志 ── */
function DiagnosticsRow() {
  const [busy, setBusy] = useState(false);
  const run = async (): Promise<void> => {
    setBusy(true);
    try {
      const { buildDiagnostics } = await import("../lib/diagnostics.js");
      await navigator.clipboard.writeText(await buildDiagnostics());
      showToast("诊断摘要已复制，可直接粘贴到反馈里");
    } catch (err) {
      showToast(String(err instanceof Error ? err.message : err).slice(0, 60));
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingsRow
      title="诊断摘要"
      sub="反馈问题时粘贴这段文字，不含学号等个人信息"
      control={<Btn variant="outline" size="sm" disabled={busy} onClick={() => void run()}>{busy ? "复制中…" : "复制摘要"}</Btn>}
    />
  );
}




/** 外观：昼夜主题调度——跟随系统暗/亮自动切日夜两档主题 */

/* ══════════ 壁纸（2026-10-14 定案：单一全屏档 + 壁纸库）══════════
   卡体 = 库面板（WallpaperLibrary panel）+ 动态壁纸声音开关：
   库网格（内置渐变 + 自收录）、点图=设为全屏、上传入库、删除、云盘同步/恢复
   （wallpsync）；「本页」档已随功能删除，壁纸只画在壳层、全窗共用。 */
function WallpaperSection(): ReactNode {
  const sound = useSyncExternalStore(subscribeWallpaper, videoSoundSnapshot, videoSoundSnapshot);
  return (
    <div className="wall-section" data-set-id="row-壁纸">
      <div className="setting-title">壁纸</div>
      <div className="setting-desc">全窗共用一张：画在壳层底，面板与栏体透出它。</div>
      <WallpaperLibrary variant="panel" />
      <div className="wall-sound-row" data-set-id="row-动态壁纸声音">
        <div>
          <div className="setting-title">动态壁纸声音</div>
          <div className="setting-desc">默认静音；视频壁纸有声时才需手势放开（浏览器自动播放策略）。</div>
        </div>
        <Switch on={sound} onChange={(v) => setVideoSound(v)} label="动态壁纸声音" />
      </div>
    </div>
  );
}

function AppearanceSection(): ReactNode {
  const snap = useThemes();
  const glass = useSyncExternalStore(subscribeGlassLevel, getGlassLevel, getGlassLevel);
  /* 手机端（dev-explorer 二轮 A1）：手机只有横标签页——横/竖栏选项不渲染（TabDrawer 分段同款） */
  const isPhone = typeof document !== "undefined" && document.documentElement.classList.contains("is-phone");
  const tabLayoutDefault = useTabLayoutDefault();
  /* 动态取色（§3.4）：原生探活一次决定开关是否可用。
     桌面与 Android < 12 都返回"不可用"——此时开关置灰而不是隐藏，让用户知道原因。 */
  const [dyn, setDyn] = useState(isDynamicEnabled());
  const [dynOk, setDynOk] = useState<boolean | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    void fetchSystemPalette().then((p) => {
      if (alive) setDynOk(!!p && Object.keys(p).length > 0);
    });
    return () => {
      alive = false;
    };
  }, []);
  /* 开关状态只认 local 偏好这一个真源：enable/disable 之后重新读，任何分支（含降级到清华紫、
     抛错）都不会留下"主题变了但开关还是关的"这种说谎状态。 */
  const toggleDyn = async (): Promise<void> => {
    try {
      if (isDynamicEnabled()) disableDynamicColor();
      else await enableDynamicColor();
    } finally {
      setDyn(isDynamicEnabled());
    }
  };
  // 别处（设置 → 外观 的主题列表）切主题会让取色退场：开关跟着回真
  useEffect(() => subscribeThemes(() => setDyn(isDynamicEnabled())), []);
  /* ① 主题规范（2026-10-11 用户拍板）：「外观与布局 → 主题」**只做切换**，
     且**只列已启用的主题**——数据源＝插件系统里 category==="theme" 且 enabled 的插件；
     未启用插件带来的主题直接不显示（不灰置、不占位）。启用/停用在「插件」页里做。 */
  const { navigate } = useApp();
  const allPl = useSyncExternalStore(subscribePlugins, installedPlugins);
  const enabledThemeOwners = new Set(
    allPl
      .filter((p) => isThemeEntry(p.manifest as { category?: string; themes?: unknown }) && p.enabled)
      .map((p) => p.manifest.id),
  );
  const visibleThemeDefs = snap.themes.filter(
    (t) => !t.owner || enabledThemeOwners.has(t.owner) || enabledThemeOwners.has(t.id),
  );
  const themes = [{ id: "", name: "石墨 · 默认" }, ...visibleThemeDefs.map((t) => ({ id: t.id, name: t.dark ? `${t.name}（暗色）` : t.name }))];
  return (
    <Stack gap={4}>
      {/* 标签栏默认样式：横版（顶部一排）｜竖版（左侧栏）；标签栏上的切换钮可随时改，这里定的是默认值。
          手机（A1）：手机只能横标签页（竖栏永不出现），这一行整块不渲染。 */}
      {isPhone ? null : (
        <SettingsRow
          title="标签栏样式"
          sub="横版：标签在顶部一排；竖版：标签在左侧栏。标签栏上的切换钮可随时改，这里设的是默认值。"
          control={
            <Segment
              size="sm"
              value={tabLayoutDefault}
              onChange={(v) => setTabLayoutDefault(v as "h" | "v")}
              options={[
                { value: "h", label: "横版" },
                { value: "v", label: "竖版" },
              ]}
            />
          }
        />
      )}
      {/* 玻璃程度：全站玻璃面材浓度四档（clear/balanced/rich/deep → data-glass 覆盖块） */}
      <SettingsRow
        title="玻璃程度"
        sub="默认档是无玻璃的中性面；其余三档是三种玻璃取向。"
        control={
          <Segment
            size="sm"
            value={glass}
            onChange={(v) => setGlassLevel(v as GlassLevel)}
            options={glassLevels().map((g) => ({ value: g.id, label: g.label }))}
          />
        }
      />
      {/* 主题（① 2026-10-11 用户拍板）：这里**只做切换**，且**只列已启用**的主题（未启用插件的不出现）；
          启用/停用在「插件」里，安装主题走右边那个按钮（跳市场 + 自动筛「主题」）。 */}
      <SettingsRow
        title="主题"
        sub={
          <>
            当前：{themes.find((th) => (snap.effectiveId ?? "") === th.id)?.name ?? "默认外观"}
            {dyn ? " · 系统取色生效中，换主题后会自动关闭" : ""}
            {"　启用 / 停用主题在「插件」页里。"}
          </>
        }
        control={
          <Inline gap={2}>
            {/* ③ 两个按钮并列、同一套胶囊口径：安装（市场 + 主题筛选）｜管理（主题插件的启用/停用） */}
            <Btn variant="solid" tone="brand" titleAttr="到插件市场安装主题（自动筛选「主题」类别）" onClick={() => {
                requestPluginsView({ view: "market", category: "theme" });
              }}>安装主题
            </Btn>
            <Btn variant="solid" tone="brand" titleAttr="管理主题插件的启用 / 停用（按新规范，启用与否只在这里管）" onClick={() => {
                /* 启用/停用界面＝插件页「我的插件 + 主题筛选」：那里每张主题卡都有开关语义 */
                requestPluginsView({ view: "mine", category: "theme" });
              }}>管理主题
            </Btn>
          </Inline>
        }
      />
      {/* ③ 主题板**恢复成原来那套**（用户给的旧图样式：色卡 + 名称 + 使用中/社区胶囊 + 应用按钮），
          只按新规范过滤掉未启用的主题；排版与 ThemePickerModal 里的板子保持一致。
          2026-10-14：手写选中框（内联边框+底色）→ List/Row 的 selected 状态层 + Tag 胶囊。 */}
      <div className="theme-choice-grid">
        <ThemeChoice name="石墨 · 默认" description="中性面阶、黑白主要动作与清晰文字层级" selected={!snap.effectiveId || snap.effectiveId === "onethu.theme.ivory"} onSelect={() => deactivateTheme()} themeId="onethu.theme.ivory" />
        {visibleThemeDefs.filter(t => t.id !== "onethu.theme.ivory").map(t => <ThemeChoice key={t.id} name={t.name} description={t.description} vars={t.vars} selected={snap.effectiveId === t.id} onSelect={() => { activateTheme(t.id); showToast("已应用「" + t.name + "」"); }} themeId={t.id} />)}
      </div>
      <SettingsRow
        title="跟随系统昼夜"
        sub={
          <>
            开启后按系统的深色模式自动切换：亮色用「白天主题」，深色用「黑夜主题」。
            {snap.followSystem ? <>（当前系统：{snap.systemDark ? "深色" : "浅色"}）</> : null}
          </>
        }
        control={<Switch on={snap.followSystem} onChange={() => setFollowSystem(!snap.followSystem)} label="跟随系统昼夜" />}
      />
      {snap.followSystem ? (
        <>
          <SettingsRow title="白天主题" control={<Select value={snap.dayThemeId ?? ""} onChange={(value) => setDayNightTheme(value || null, snap.nightThemeId)} disabled={dyn}>{themes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>} />
          <SettingsRow title="黑夜主题" control={<Select value={snap.nightThemeId ?? ""} onChange={(value) => setDayNightTheme(snap.dayThemeId, value || null)} disabled={dyn}>{themes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>} />
        </>
      ) : null}
      <SettingsRow
        title="跟随系统取色"
        sub={
          dynOk === false ? (
            dyn ? "系统取色暂不可用，已自动改用「清华紫」主题，稍后可在外观里手动更换。" : "当前系统不支持，开启后改用「清华紫」主题。"
          ) : "用壁纸的颜色重新计算全站配色，品牌色与背景色一起变。"
        }
        control={<Switch on={dyn} onChange={() => void toggleDyn()} label="跟随系统取色" />}
      />
      {dyn ? <OGText slot="label" tone="faint">生效中：关掉开关即恢复所选主题。</OGText> : null}
      <ThemePickerModal open={pickerOpen} onClose={() => setPickerOpen(false)} />
    </Stack>
  );
}


/* ══ 极客模式：浏览器探索（2026-10-13 用户点名；桌面 Only；风险自负明示）══
   能力：探测/一键下载 playwright 浏览器、独立登录态 profile 启停；CDP 读写（探索&自做插件）
   由 OH 的 geek_* 工具承载，本节只管「模式开关 + 环境就绪 + 风险提示」。 */

function GeekSection(): ReactNode {
  const st = useExplorerState();
  const at = allTabs().find((t) => t.id === st.activeId) ?? null;
  void at;
  const [probe, setProbe] = useState<{ browsers: string[]; playwrightReady: boolean; profileReady: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem("onethu.geek.on") === "1";
    } catch {
      return false;
    }
  });
  /* hooks 全部声明在前：早返回（isPhone）之前不得再挂 hook（hook-order 门禁） */
  const [mode, setMode] = useState<"system" | "playwright">("system");
  const isPhone = typeof document !== "undefined" && document.documentElement.classList.contains("is-phone");
  const refresh = useCallback(() => {
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("geek_browser_probe"))
      .then((r: unknown) => setProbe(r as { browsers: string[]; playwrightReady: boolean; profileReady: boolean }))
      .catch(() => setProbe(null));
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);
  if (isPhone) return null;
  const toggle = (): void => {
    const next = !on;
    try {
      localStorage.setItem("onethu.geek.on", next ? "1" : "0");
    } catch {
      /* 存不进就本次有效 */
    }
    setOn(next);
    if (next) showToast("极客模式已开启：设置里可下载探索浏览器（桌面端专属）");
  };
  const download = async (): Promise<void> => {
    setBusy("dl");
    setMsg(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const r = await invoke<string>("geek_playwright_install");
      setMsg(r || "下载完成");
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(null);
      refresh();
    }
  };
  const launch = async (): Promise<void> => {
    setBusy("launch");
    setMsg(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const r = await invoke<{ port?: number }>("geek_browser_launch", { mode });
      setMsg(r.port ? `探索浏览器已就绪（调试口 ${r.port}）；登录态在独立 profile` : "已启动");
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(null);
      refresh();
    }
  };
  return (
    <SettingsList>
      <SettingsRow
        title="极客模式（浏览器探索）"
        sub={
          <>
            高级选项，默认关闭；把不在 OneTHU 里的站点功能用登录态爬回来自己做插件。用独立登录态，和自己浏览器互不干扰。
            <OGText as="div" slot="label" tone="error">
              风险自负：探索动作可能被站点风控计入本人账号；不喜欢冒险可通过 OH 建议官方收录。
            </OGText>
          </>
        }
        control={<Switch on={on} onChange={toggle} label="极客模式" />}
      />
      {on ? (
        <SettingsRow
          title="探索浏览器"
          sub={
            probe
              ? probe.browsers.length > 0
                ? `本机可用浏览器 ${probe.browsers.length} 个；playwright 版${probe.playwrightReady ? "已下载" : "未下载"}`
                : "本机没有可直接用的浏览器，可一键下载专用版"
              : "探测中…"
          }
          control={
            <Inline gap={2}>
              <Btn variant="ghost" disabled={busy !== null} onClick={() => void download()}>{busy === "dl" ? "下载中…" : "下载专用版"}</Btn>
              <Btn variant="outline" disabled={busy !== null || !probe} onClick={() => void launch()}>{busy === "launch" ? "启动中…" : "启动探索"}</Btn>
            </Inline>
          }
        />
      ) : null}
      {on ? (
        <SettingsRow
          title="启动方式"
          sub="系统浏览器（复用本机 Chrome/Edge）或探索专用浏览器。"
          control={
            <Segment
              size="sm"
              value={mode}
              onChange={(v) => setMode(v as "system" | "playwright")}
              options={[{ value: "system", label: "系统浏览器" }, { value: "playwright", label: "专用版" }]}
            />
          }
        />
      ) : null}
      {msg ? <OGText as="div" slot="label" tone="faint">{msg}</OGText> : null}
    </SettingsList>
  );
}
