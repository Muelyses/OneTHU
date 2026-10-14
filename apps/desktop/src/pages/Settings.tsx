import { Select } from "@onethu/gui";
import { Btn } from "@onethu/gui";
declare const __APP_VERSION__: string;
import { defineSearchRows } from "../state/searchRows.js";
import {
  subscribeWallpaper,
  videoSoundSnapshot,
  setVideoSound,
} from "../state/wallpaper.js";
import { useExplorerState, allTabs } from "../state/explorer.js";
import { WallpaperLibrary } from "../components/explorer/WallpaperLibrary.js";
import { getGlassLevel, glassLevels, setGlassLevel, subscribeGlassLevel } from "../lib/glassLevel.js";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { loadTabLayout, saveTabLayout, type TabLayout } from "../lib/tabLayout.js";
import type { ReactNode } from "react";
import { Card, PageHead, SectionHead, SegmentedOverflow, Switch } from "../components/Layout.js";
import { setTabLayoutDefault, useTabLayoutDefault } from "../state/tabLayout.js";
import { SoftwareUpdateSection } from "../components/SoftwareUpdateSection.js";
import { TabManageModal } from "../components/TabManageModal.js";
import { NotifySettingsSection } from "../components/NotifySettingsSection.js";
import { WidgetSettingsSection } from "../components/WidgetSettingsSection.js";
import { invoke } from "@tauri-apps/api/core";
import { showToast } from "../state/toast.js";
import { openUrl } from "@tauri-apps/plugin-opener";
import { clearRemembered, loadRemembered, session, isTauri } from "../lib/clients.js";
import { clearHomeLayout } from "../lib/homeCards.js";
import { useFavs } from "../state/favs.js";
import { activateTheme, deactivateTheme, setDayNightTheme, setFollowSystem, useThemes } from "../state/theme.js";
import { LevelBox, focusSettingsTarget } from "../components/Layout.js";
import { ExplorerPrefsSection } from "../components/ExplorerPrefsSection.js";
import { ThemeSwatch } from "../components/ThemePickerModal.js";
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
  首页布局: "外观与布局", 收藏夹: "外观与布局", 外观: "外观与布局",
  工作空间: "外观与布局", /* dev-explorer：缺键会让工作空间分节在所有页签恒显（用户实测「其他 设置多了个不动的分节/触发不一致」） */
  通知: "通知与提醒",
  /* 2026-10-11 重构：桌面小组件独立成栏；语音合成/悬浮球迁到 OH 页；插件改成独立入口 */
  桌面小组件: "桌面小组件",
  下载: "下载与存储", 帮助: "帮助",
};
/* 页签清单与高级页签定义已挪到 state/settingsMode.ts（命令面板与护栏共用同一份，见该文件注释） */


/* ── task-19：设置页各分节的设置行注册（声明式；与页签一一对应）── */
defineSearchRows([
  { id: "set-theme-board", tab: "外观与布局", section: "主题", title: "主题", aliases: ["换主题", "配色", "主题板", "暗色", "夜间"], desc: "只列已启用主题，点「应用」切换" , breadcrumb: ["设置", "外观与布局", "主题", "主题"] },
  { id: "set-theme-install", tab: "外观与布局", section: "主题", title: "安装主题", aliases: ["主题市场", "装主题"], desc: "打开插件市场的主题筛选" , breadcrumb: ["设置", "外观与布局", "主题", "安装主题"] },
  { id: "set-theme-manage", tab: "外观与布局", section: "主题", title: "管理主题", aliases: ["启用主题", "停用主题"], desc: "主题插件的启用 / 停用" , breadcrumb: ["设置", "外观与布局", "主题", "管理主题"] },
  { id: "set-theme-follow", tab: "外观与布局", section: "主题", title: "跟随系统昼夜", aliases: ["昼夜", "白天主题", "黑夜主题", "自动切换"], desc: "亮色用白天主题，深色用黑夜主题" , breadcrumb: ["设置", "外观与布局", "主题", "跟随系统昼夜"] },
  { id: "set-appearance", tab: "外观与布局", section: "外观", title: "外观", aliases: ["密度", "字号", "圆角"], desc: "密度、字号、圆角等外观项" , breadcrumb: ["设置", "外观与布局", "外观", "外观"] },
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
  const isPhone = typeof document !== "undefined" && document.documentElement.classList.contains("is-phone");
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
        const heads = Array.from(document.querySelectorAll<HTMLElement>(".section-head"));
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
   * 页签显隐。两个坑（2026-09-20 实测）：
   *  ① `hidden` 属性会被 app 里的 display 规则压过去 → 必须用行内 style.display；
   *  ② 各分节并非同一父节点的兄弟：外部作业源 / 下载 / 外观等分节渲染在子组件内部，
   *     因此必须逐个 .section-head 在**各自父节点内**向后收拢其内容，不能只遍历首层兄弟。
   */
  useEffect(() => {
    const heads = Array.from(document.querySelectorAll<HTMLElement>(".section-head"));
    for (const head of heads) {
      const title = (head.textContent ?? "").trim();
      const group = SETTINGS_TAB_OF[title] ?? (/课件|OJ/.test(title) ? "数据与同步" : null);
      if (!group) continue;
      const show = group === tab;
      const apply = (el: HTMLElement): void => {
        el.style.display = show ? "" : "none";
      };
      apply(head);
      let sib = head.nextElementSibling as HTMLElement | null;
      while (sib && !sib.classList.contains("section-head")) {
        apply(sib);
        sib = sib.nextElementSibling as HTMLElement | null;
      }
    }
  }, [tab, tabLayout.hidden.join(",")]);

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
    <>
      <PageHead
        title="设置"
        actions={
          <>
            <button
              className="btn"
              onClick={() => {
                resetActiveOnboarding();
                location.reload();
              }}
              title="重新运行首次使用引导"
            >
              导览
            </button>
            <button className="btn" onClick={() => setManageOpen(true)} title="栏目显隐与排序">
              管理栏目
            </button>
          </>
        }
      />

      {/* ① 手机端「我的」页顶部：**三格齐全**（设置 | 插件 | OneTHU Harness），与插件页/子页同一个组件 */}
      {isPhone ? <LevelBox /> : null}

      <SegmentedOverflow ariaLabel="设置栏目" style={{ marginBottom: 14 }}>
        {settingsTabLayout.order
          .filter((t) => SETTINGS_TAB_ORDER.includes(t) && !tabLayout.hidden.includes(t))
          .map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className={tab === t ? "is-active" : ""}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
      </SegmentedOverflow>

      <SectionHead title="帮助" />
      <Card>
        <HelpSection />
      </Card>

      <SectionHead title="关于" />
      <SoftwareUpdateSection />
      <Card>
        <div className="setting-row">
          <div>
            <div className="setting-title">OneTHU {__APP_VERSION__} “{APP_CODENAME}”</div>
            <div className="setting-desc">清华园随身工具箱 · 开源于 GitHub</div>
          </div>
          <button className="btn" onClick={() => void openUrl("https://github.com/smartThise/OneTHU")}>
            GitHub 项目页
          </button>
        </div>
        {/* 运行日志导出属开发者功能：正式版不显示（真机取证走 adb logcat -s onethu:V，
            或改用开发者构建的右上角面板导出）。要恢复成正式版也显示，去掉这层门控即可。 */}
        {__ONETHU_DEV__ ? <DebugLogRow /> : null}
        <DiagnosticsRow />
        {/* 首启流程灰度开关已随导览 v3 改版退役：播放统一走 OnboardingTourV3，
            「导览」按钮（页头）负责清 flow3 完成标记重新走一轮。 */}
      </Card>

      <SectionHead title="账户" />
      <Card>
        <div className="setting-row">
          <div>
            <div className="setting-title">统一认证</div>
            <div className="setting-desc">{user?.displayName || displayStudentId(user?.username) || "未登录"}</div>
          </div>
          <button className="btn" onClick={() => void logout()}>
            退出登录
          </button>
        </div>
      </Card>


      <SectionHead title="账号与绑定" />
      <Card>
        <div className="setting-row" style={{ alignItems: "flex-start" }}>
          <div>
            <div className="setting-title">清华电子身份（账号密码管理）</div>
            <div className="setting-desc">
              在应用内的窗口打开清华统一身份认证，自动填入账号密码（有图形验证码时需手动输入）。
              <b>删除已保存的登录信息或修改密码，可能导致 OneTHU 退出登录</b>，需重新登录一次。
            </div>
            {eidMsg ? (
              <ErrorLine text={eidMsg} style={{ marginTop: 8, fontSize: 13, color: "var(--text-2)" }} />
            ) : null}
          </div>
          <button
            className="btn"
            onClick={() => {
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
            }}
          >
            打开电子身份
          </button>
        </div>
      </Card>


      <SectionHead title="云同步" />
      <Card>
        {cloud.configured ? (
          <div className="setting-row">
            <div>
              <div className="setting-title">日程云同步 · 已连接</div>
              <div className="setting-desc">
                {cloud.email} · 通过清华邮箱日历（CalDAV）多设备同步日程；在「日程」页查看与编辑。
                {calMsg ? <ErrorLine text={calMsg} style={{ marginTop: 6, color: "var(--text-2)" }} /> : null}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <button
                className="btn"
                onClick={() =>
                  void confirmOk(
                    "在 iPhone / iPad 上查看日程（可选）\n\n手机上没有 OneTHU 也没关系：日程已在你清华邮箱的云端日历里，在 iPhone/iPad 上添加同一邮箱即可看到：\n· 设置 → 日历 → 账户 → 添加账户 → 其他 → CalDAV 账户\n· 服务器地址：https://mails.tsinghua.edu.cn/coremail/dav/users/你的邮箱/\n· 用户名：完整邮箱；密码：客户端专用密码（与本页一致）\n\n本机不需要此设置——用下方「系统日历同步」一键开启即可，应用直接写系统日历。",
                  )
                }
              >
                iPhone 上查看
              </button>
              <button
                className="btn"
                disabled={calBusy || cloud.syncing}
                onClick={() => {
                  setCalBusy(true);
                  setCalMsg(null);
                  void syncCloudCal()
                    .then((r) => setCalMsg(`已同步：云端共 ${r.total} 个日程（新增 ${r.added}、更新 ${r.updated}、移除 ${r.removed}）。`))
                    .catch((e: unknown) => setCalMsg(`同步失败：${e instanceof Error ? e.message : String(e)}`))
                    .finally(() => setCalBusy(false));
                }}
              >
                {calBusy || cloud.syncing ? "同步中…" : "立即同步"}
              </button>
              <button
                className="btn"
                onClick={() =>
                  void disconnectCloudCal().then(() => {
                    setCalEmail("");
                    setCalPass("");
                    setCalMsg(null);
                  })
                }
              >
                断开
              </button>
            </div>
          </div>
        ) : (
          <div className="setting-row" style={{ alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="setting-title">日程云同步（清华邮箱日历）</div>
              <div className="setting-desc">
                用清华邮箱的日历服务在多台设备间同步日程——OneTHU 里添加的日程会出现在系统日历 / 其他设备（添加同一账号）。
                授权码获取：网页版邮箱（mails.tsinghua.edu.cn）→ 设置 → 客户端专用密码。
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <input
                  className="input"
                  style={{ minWidth: 200, flex: 1 }}
                  placeholder="完整邮箱地址（如 someone@mails.tsinghua.edu.cn）"
                  value={calEmail}
                  onChange={(e) => setCalEmail(e.target.value.trim())}
                />
                <input
                  className="input"
                  type="password"
                  style={{ minWidth: 140, flex: 1 }}
                  placeholder="客户端专用密码"
                  value={calPass}
                  onChange={(e) => setCalPass(e.target.value)}
                />
                <button
                  className="btn btn-primary"
                  disabled={!/.+@.+/.test(calEmail) || !calPass || calBusy}
                  onClick={() => {
                    setCalBusy(true);
                    setCalMsg(null);
                    void configureCloudCal(calEmail, calPass)
                      .then((cals) => setCalMsg(`连接成功，发现日历：${cals.join("、")}。`))
                      .catch((e: unknown) => setCalMsg(`连接失败：${e instanceof Error ? e.message : String(e)}`))
                      .finally(() => setCalBusy(false));
                  }}
                >
                  {calBusy ? "连接中…" : "保存并验证"}
                </button>
              </div>
              {calMsg ? <ErrorLine text={calMsg} style={{ marginTop: 8, fontSize: 13, color: "var(--text-2)" }} /> : null}
            </div>
          </div>
        )}
      </Card>
      <Card>
        {sysSupported === false ? (
          <div className="setting-row">
            <div>
              <div className="setting-title">系统日历同步</div>
              <div className="setting-desc">
                当前平台暂不支持直写系统日历；可在「日程」页用「存入系统日历」导出 .ics 文件，再由系统日历导入。
              </div>
            </div>
          </div>
        ) : syscal.enabled ? (
          <div className="setting-row" style={{ alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="setting-title">系统日历同步 · 已开启</div>
              <div className="setting-desc">
                日历「OneTHU 日程」· 上次同步 {syscal.lastSyncAt ? new Date(syscal.lastSyncAt).toLocaleString() : "—"} · {syscal.lastCount} 条。课表与日程变化后会自动更新（含提前 15 分钟的课程提醒）。
                {syscal.lastError ? (
                  <div style={{ marginTop: 6, color: "var(--red, #c04848)" }}>最近一次同步失败：{syscal.lastError}</div>
                ) : null}
                {sysMsg ? <ErrorLine text={sysMsg} style={{ marginTop: 6, color: "var(--text-2)" }} /> : null}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <button
                className="btn"
                disabled={sysBusy || syscal.syncing}
                onClick={() => {
                  setSysBusy(true);
                  setSysMsg(null);
                  void syncSystemCalendar()
                    .then((r) =>
                      setSysMsg(r.skipped ? "内容无变化，系统日历已是最新" : `已同步：写入 ${r.added} 条（清理旧 ${r.removed} 条）。`),
                    )
                    .catch((e: unknown) => setSysMsg(`同步失败：${e instanceof Error ? e.message : String(e)}`))
                    .finally(() => setSysBusy(false));
                }}
              >
                {sysBusy || syscal.syncing ? "同步中…" : "立即同步"}
              </button>
              <button
                className="btn"
                disabled={sysBusy}
                onClick={() => {
                  void disableSystemCalendar()
                    .then(() => setSysMsg("已停止自动同步，已写入的日历与事件保留"))
                    .catch((e: unknown) => setSysMsg(String(e instanceof Error ? e.message : e)));
                }}
              >
                停止自动同步
              </button>
              <button
                className="btn"
                disabled={sysBusy}
                onClick={() => {
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
                }}
              >
                清除系统日历
              </button>
            </div>
          </div>
        ) : (
          <div className="setting-row" style={{ alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="setting-title">系统日历同步</div>
              <div className="setting-desc">
                把课表与日程写入系统日历里的专属日历「OneTHU 日程」（不影响你已有的日历）。开启后自动保持最新：添加、修改、删除日程或刷新课表都会同步更新，课程与考试带提前 15 分钟提醒。无需配置任何账户，一键开启。
                {sysMsg ? <ErrorLine text={sysMsg} style={{ marginTop: 6, color: "var(--text-2)" }} /> : null}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <button
                  className="btn btn-primary"
                  disabled={sysBusy || sysSupported === null}
                  onClick={() => {
                    setSysBusy(true);
                    setSysMsg(null);
                    void enableSystemCalendar()
                      .then(() => setSysMsg("系统日历「OneTHU 日程」已写入，此后自动保持最新"))
                      .catch((e: unknown) => setSysMsg(`开启失败：${e instanceof Error ? e.message : String(e)}`))
                      .finally(() => setSysBusy(false));
                  }}
                >
                  {sysBusy ? "开启中…" : "开启并同步"}
                </button>
              </div>
            </div>
          </div>
        )}
      </Card>
      <SectionHead title="外部作业源" />
      <ExtHwSection />

      <DownloadSettings />

      <SectionHead title="首页布局" />
      <Card>
        <div className="setting-row">
          <div>
            <div className="setting-title">恢复默认首页布局</div>
            <div className="setting-desc">
              清除「今日」页卡片的排列、折叠与隐藏记录，下次打开首页回到默认版式（主栏：
              日程与提醒 / 未提交作业 / 最近通知；侧栏：校园卡余额 / 今日预约 /
              今日课程 / 订阅新闻；入口卡全部隐藏）。
            </div>
          </div>
          <button className="btn" onClick={() => { clearHomeLayout(); setHomeResetAt(Date.now()); }}>
            {homeResetAt ? "已恢复默认" : "恢复默认布局"}
          </button>
        </div>
      </Card>

      <SectionHead title="工作空间" />
      <ExplorerPrefsSection />

      <SectionHead title="收藏夹" />
      <Card>
        <div className="setting-row" style={{ alignItems: "flex-start" }}>
          <div>
            <div className="setting-title">恢复默认收藏夹</div>
            <div className="setting-desc">
              删除全部用户收藏夹与折叠记录（默认一级入口不受影响，永远在左侧栏）。
              各功能仍在原来的页面，收藏夹只是跳转入口。
            </div>
            {favMsg ? <div style={{ marginTop: 8, fontSize: 13, color: "var(--text-2)" }}>{favMsg}</div> : null}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button
              className="btn"
              onClick={() => {
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
              }}
            >
              导出（复制 JSON）
            </button>
            <button className="btn" onClick={() => { setImportOpen((o) => !o); setImportText(""); setFavMsg(null); }}>
              导入
            </button>
            <button
              className="btn"
              onClick={() =>
                void confirmOk("删除全部用户收藏夹并复位折叠记录？默认一级入口不受影响。").then((ok) => {
                  if (!ok) return;
                  favs.replaceAll(resetFavs());
                  setFavMsg("已恢复默认。");
                })
              }
            >
              恢复默认
            </button>
          </div>
        </div>
        {importOpen ? (
          <div style={{ marginTop: 12 }}>
            <textarea
              className="input"
              style={{ width: "100%", minHeight: 120, fontFamily: "var(--font-mono, monospace)", fontSize: 12 }}
              placeholder={"粘贴收藏夹内容（另一台设备导出的）…"}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button
                className="btn btn-primary"
                disabled={!importText.trim()}
                onClick={() => {
                  const parsed = parseFavs(importText);
                  if (!parsed) {
                    setFavMsg("导入失败：格式不正确，请粘贴本应用导出的内容");
                    return;
                  }
                  favs.replaceAll(parsed);
                  setImportOpen(false);
                  setImportText("");
                  setFavMsg("已导入 " + parsed.order.length + " 个根收藏夹。");
                }}
              >
                导入并覆盖
              </button>
              <Btn variant="ghost" onClick={() => setImportOpen(false)}>取消</Btn>
            </div>
          </div>
        ) : null}
      </Card>

      <SectionHead title="外观" />
      <Card>
        <AppearanceSection />
      </Card>
      <Card>
        <WallpaperSection />
      </Card>
      <SectionHead title="通知" />
      <Card>
        <NotifySettingsSection />
      </Card>
      <SectionHead title="桌面小组件" />
      <Card>
        <WidgetSettingsSection />
      </Card>
      <GeekSection />
      {/* 2026-10-11（用户纠正）：OH **不是设置页的二级**，而是**插件页的二级子页面**
          （基础设置 / 高级配置）——分节与页签都已从这里移除，见 pages/Plugins.tsx 的 OH 入口。 */}
      <SectionHead title="安全" />
      <Card>
        <div className="setting-row">
          <div>
            <div className="setting-title">记住的密码</div>
            <div className="setting-desc">
              {hasSaved
                ? "已在本机保存，重启后自动登录"
                : "未保存；登录时勾选「记住密码」即可启用"}
            </div>
          </div>
          {hasSaved ? (
            <button className="btn" disabled={clearing} onClick={() => void onClear()}>
              {clearing ? "清除中…" : "清除"}
            </button>
          ) : null}
        </div>
      </Card>
      <TabManageModal
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        title="管理设置栏目"
        tabs={SETTINGS_TAB_ORDER.map((id) => ({ id, label: id }))}
        layout={tabLayout}
        onApply={applyTabLayout}
        onReset={() => applyTabLayout({ order: SETTINGS_TAB_ORDER, hidden: [] })}
      />

    </>
  );
}

/** R15 20.3：OJ 源统一行范式 —— `源名 + 状态徽标 …… 主操作 + 「更多」折叠`。
 *  备选登录方式一律收进 more 折叠；行内只在需要用户动作时出现提示（会话失效 / 自动登录失败）。 */
function OjSourceRow({
  name,
  logged,
  via,
  primary,
  more,
  note,
  children,
}: {
  name: string;
  logged: boolean;
  /** 已登录方式（统一认证 / 账号密码），显示在徽标内 */
  via?: string;
  primary: ReactNode;
  more?: ReactNode;
  note?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="exthw-src">
      <div className="exthw-src-head">
        <span className="setting-title exthw-src-name">{name}</span>
        <span className={`exthw-badge${logged ? " is-on" : ""}`}>
          {logged ? `已登录${via ? `·${via}` : ""}` : "未登录"}
        </span>
        <span className="exthw-src-actions">
          {primary}
          {more}
        </span>
      </div>
      {note}
      {children}
    </div>
  );
}

/* ── 外部作业源（雨课堂 / TUOJ 系 / Tyche / DSA OJ）── */
function ExtHwSection() {
  const ext = useExternalHomework();
  // 雨课堂
  const [yktPhone, setYktPhone] = useState("");
  const [yktCookie, setYktCookie] = useState("");
  const [yktQrOpen, setYktQrOpen] = useState(false);
  // R18 24.2：官方网页登录（应用内 WebView，支持扫码 / 短信）
  const [yktWebOpen, setYktWebOpen] = useState(false);
  // TUOJ（AI 版）
  const [tuojUser, setTuojUser] = useState("");
  const [tuojPwd, setTuojPwd] = useState("");
  const [tuojCookie, setTuojCookie] = useState("");
  const [tuojVia, setTuojVia] = useState<"cas" | "password" | undefined>(undefined);
  const [tuojPwdOpen, setTuojPwdOpen] = useState(false);
  // TUOJ（经典版）
  const [classicUser, setClassicUser] = useState("");
  const [classicPwd, setClassicPwd] = useState("");
  const [classicCookie, setClassicCookie] = useState("");
  const [classicVia, setClassicVia] = useState<"cas" | "password" | undefined>(undefined);
  const [classicPwdOpen, setClassicPwdOpen] = useState(false);
  // Tyche
  const [tycheUser, setTycheUser] = useState("");
  const [tychePwd, setTychePwd] = useState("");
  const [tycheCookie, setTycheCookie] = useState("");
  const [tycheFormOpen, setTycheFormOpen] = useState(false);
  // R21-A：记住密码（勾选后 username+password 随凭据信封 AES-GCM 存本机；
  // 会话失效时用存档账密静默自动重登一次。tycheSavedPwd = 已存档密码的内存回填，
  // 与 tycheCookie 同性质：只在内存态用于组装保存，不显示明文）
  const [tycheRemember, setTycheRemember] = useState(false);
  const [tycheSavedPwd, setTycheSavedPwd] = useState("");
  // DSA OJ
  const [dsaUser, setDsaUser] = useState("");
  const [dsaPwd, setDsaPwd] = useState("");
  const [dsaCookie, setDsaCookie] = useState("");
  const [dsaFormOpen, setDsaFormOpen] = useState(false);
  const [days, setDays] = useState("30");
  const [advanced, setAdvanced] = useState(false);
  // R14 19.2：OJ 平台组默认折叠（展开态不持久化，符合需求下限）
  const [ojOpen, setOjOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  // R17 23.4：操作反馈「就近显示」——按触发区域归属，渲染在对应卡片内，
  // 而不是统一堆在页面底部（真机实测在屏幕外，用户以为什么都没发生）。
  const [msgArea, setMsgArea] = useState<"yuketang" | "oj" | "range">("range");
  const notify = (area: "yuketang" | "oj" | "range", text: string): void => {
    setMsgArea(area);
    setMsg(text);
  };

  // 凭据在 localStorage 里是密文：首次挂载异步解密后回填表单
  useEffect(() => {
    let alive = true;
    void ensureExtHwCredsLoaded().then((c) => {
      if (!alive) return;
      setYktPhone(c.yuketang?.phone ?? "");
      setYktCookie(c.yuketang?.cookie ?? "");
      setTuojUser(c.tuoj?.username ?? "");
      setTuojCookie(c.tuoj?.cookie ?? "");
      setTuojVia(c.tuoj?.via);
      setClassicUser(c.tuojClassic?.username ?? "");
      setClassicCookie(c.tuojClassic?.cookie ?? "");
      setClassicVia(c.tuojClassic?.via);
      setTycheUser(c.tyche?.username ?? "");
      setTycheCookie(c.tyche?.cookie ?? "");
      setTycheRemember(Boolean(c.tyche?.password));
      setTycheSavedPwd(c.tyche?.password ?? "");
      setDsaUser(c.dsa?.username ?? "");
      setDsaCookie(c.dsa?.cookie ?? "");
      setDays(String(c.days ?? 30));
    });
    return () => {
      alive = false;
    };
  }, []);

  // R11 16.3 的「滚动到本区」已上移 SettingsPage（R23：先切页签再滚动，否则分区在
  // display:none 里滚动无效）——此处不再重复消费标记。

  // R11 16.2：自动登录在本区打开后才完成时，把凭据回填到表单（否则状态 ✅ 与「未登录」打架）
  useEffect(() => {
    if (ext.tuojAuto.tuoj.kind !== "ok" && ext.tuojAuto.tuojClassic.kind !== "ok") return;
    let alive = true;
    void ensureExtHwCredsLoaded().then((c) => {
      if (!alive) return;
      setTuojCookie(c.tuoj?.cookie ?? "");
      setTuojVia(c.tuoj?.via);
      setClassicCookie(c.tuojClassic?.cookie ?? "");
      setClassicVia(c.tuojClassic?.via);
    });
    return () => {
      alive = false;
    };
  }, [ext.tuojAuto.tuoj.kind, ext.tuojAuto.tuojClassic.kind]);

  const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

  /** 组装待保存凭据；o.* 传入刚登录拿到的 Cookie（state 尚未刷新时用）。
   *  R21-A：o.tychePwd = 刚登录成功、且勾选「记住密码」时要存档的密码（随 AES-GCM
   *  信封加密落盘）；未勾选 → 不存密码（并清掉旧存档，即「取消记住」）。 */
  const credsWith = (
    o: {
      ykt?: string;
      tuoj?: string;
      tuojVia?: "cas" | "password";
      classic?: string;
      classicVia?: "cas" | "password";
      tyche?: string;
      tychePwd?: string;
      dsa?: string;
    } = {},
  ): ExtHwCreds => {
    const yk = (o.ykt ?? yktCookie).trim();
    const tj = (o.tuoj ?? tuojCookie).trim();
    const cj = (o.classic ?? classicCookie).trim();
    const tc = (o.tyche ?? tycheCookie).trim();
    const ds = (o.dsa ?? dsaCookie).trim();
    return {
      yuketang: yk ? { cookie: yk, phone: yktPhone.trim() || undefined } : undefined,
      tuoj: tj ? { cookie: tj, username: tuojUser.trim() || undefined, via: o.tuojVia ?? tuojVia } : undefined,
      tuojClassic: cj
        ? { cookie: cj, username: classicUser.trim() || undefined, via: o.classicVia ?? classicVia }
        : undefined,
      tyche: tc
        ? {
            cookie: tc,
            username: tycheUser.trim() || undefined,
            password: tycheRemember ? (o.tychePwd ?? (tycheSavedPwd || undefined)) : undefined,
          }
        : undefined,
      dsa: ds ? { cookie: ds, username: dsaUser.trim() || undefined } : undefined,
      days: Math.max(1, Number(days) || 30),
    };
  };

  const onSave = () => {
    void saveExtHwCreds(credsWith()).then(() => notify("range", "已保存到本机。"));
  };

  const onRefresh = () => {
    setBusy("refresh");
    setMsg(null);
    void saveExtHwCreds(credsWith())
      .then(() => refreshExtHw())
      .then(() => notify("range", "刷新完成。"))
      .catch((e: unknown) => notify("range", `刷新失败：${errMsg(e)}`))
      .finally(() => setBusy(null));
  };

  /* ── R21-B：雨课堂会话健康 + Cookie 导出/导入（侦查结论：服务端无续期端点，
   *    保活只能周期性轻量试探；失效只能重登；多设备迁移用导出/导入缓解）── */

  /** 手动触发一次会话健康检查（与 6h 心跳同款：GET basic-info） */
  const onYktCheckSession = () => {
    setBusy("ykt-check");
    setMsg(null);
    void runYktSessionCheck()
      .then((st) => {
        if (!st) {
          notify("yuketang", "未配置雨课堂登录状态——请先登录。");
          return;
        }
        if (st.alive === true) notify("yuketang", `会话有效${st.userName ? `（${st.userName}）` : ""}。`);
        else if (st.alive === false) notify("yuketang", `会话已失效（${st.reason ?? "未知原因"}）——可扫码重登，或导入其他设备导出的 Cookie。`);
        else notify("yuketang", "检查未成功：网络异常，登录状态未知");
      })
      .finally(() => setBusy(null));
  };

  /** 导出雨课堂 Cookie：文件即完整登录凭据（自带 sensitive 标注），仅存本机自选位置 */
  const onYktExportCookie = () => {
    setBusy("ykt-export");
    setMsg(null);
    void (async (): Promise<string> => {
      if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
        throw new Error("浏览器预览不支持导出，请在桌面端操作");
      }
      const c = await ensureExtHwCredsLoaded();
      if (!c.yuketang?.cookie?.trim()) throw new Error("尚未登录雨课堂，无可导出的登录状态");
      const json = buildYktCookieExportJson(c.yuketang);
      const { invoke } = await import("@tauri-apps/api/core");
      const date = new Date().toISOString().slice(0, 10);
      const path = await invoke<string | null>("save_text_file", {
        filename: `onethu-yuketang-cookie-${date}.json`,
        contents: json,
      });
      if (!path) return "已取消导出。";
      return `已导出到 ${path}。⚠️ 该文件等同账号凭据：勿放同步盘 / 群聊 / 仓库，导入完成后请删除。`;
    })()
      .then((m) => notify("yuketang", m))
      .catch((e: unknown) => notify("yuketang", `导出失败：${errMsg(e)}`))
      .finally(() => setBusy(null));
  };

  /** 导入另一台设备导出的 Cookie（免重新扫码）；导入后立即刷新外部作业 */
  const onYktImportCookie = () => {
    setBusy("ykt-import");
    setMsg(null);
    void (async (): Promise<string> => {
      if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
        throw new Error("浏览器预览不支持导入，请在桌面端操作");
      }
      const { open } = await import("@tauri-apps/plugin-dialog");
      const { invoke } = await import("@tauri-apps/api/core");
      const sel = await open({ multiple: false, filters: [{ name: "雨课堂登录状态", extensions: ["json"] }] });
      if (!sel || typeof sel !== "string") return "已取消导入。";
      const text = await invoke<string>("read_file_text", { path: sel });
      const parsed = parseYktCookieExportJson(text);
      const cur = await ensureExtHwCredsLoaded();
      await saveExtHwCreds({
        ...cur,
        yuketang: {
          cookie: parsed.cookie,
          uvId: parsed.uvId ?? cur.yuketang?.uvId,
          phone: parsed.phone ?? cur.yuketang?.phone,
        },
      });
      setYktCookie(parsed.cookie);
      if (parsed.phone) setYktPhone(parsed.phone);
      void refreshExtHw();
      return "已导入雨课堂登录状态，正在刷新外部作业。";
    })()
      .then((m) => notify("yuketang", m))
      .catch((e: unknown) => notify("yuketang", `导入失败：${errMsg(e)}`))
      .finally(() => setBusy(null));
  };

  /** TUOJ 系主路径：清华统一认证漫游（零凭据；AI 版 / 经典版仅 base 不同） */
  const onTuojCasLogin = (source: TuojSourceId) => {
    setBusy(`tuoj-cas-${source}`);
    setMsg(null);
    void extHwLogin
      .tuojCas(source)
      .then(async (r) => {
        if (source === "tuoj") {
          setTuojCookie(r.cookie);
          setTuojVia("cas");
        } else {
          setClassicCookie(r.cookie);
          setClassicVia("cas");
        }
        clearTuojAutoStatus(source);
        await saveExtHwCreds(
          source === "tuoj" ? credsWith({ tuoj: r.cookie, tuojVia: "cas" }) : credsWith({ classic: r.cookie, classicVia: "cas" }),
        );
        notify("oj", `${SOURCE_NAMES[source]} 已通过清华统一认证登录，已保存。`);
        void refreshExtHw();
      })
      .catch((e: unknown) => notify("oj", `${SOURCE_NAMES[source]} 登录失败：${errMsg(e)}`))
      .finally(() => setBusy(null));
  };

  /** TUOJ 系备选：账号密码登录（收在「更多」折叠内） */
  const onTuojPwdLogin = (source: TuojSourceId) => {
    const user = source === "tuoj" ? tuojUser : classicUser;
    const pwd = source === "tuoj" ? tuojPwd : classicPwd;
    setBusy(`tuoj-pwd-${source}`);
    setMsg(null);
    const run = source === "tuoj" ? extHwLogin.tuoj(user, pwd) : extHwLogin.tuojClassic(user, pwd);
    void run
      .then(async (r) => {
        if (source === "tuoj") {
          setTuojCookie(r.cookie);
          setTuojVia("password");
          setTuojPwd("");
        } else {
          setClassicCookie(r.cookie);
          setClassicVia("password");
          setClassicPwd("");
        }
        clearTuojAutoStatus(source);
        await saveExtHwCreds(
          source === "tuoj"
            ? credsWith({ tuoj: r.cookie, tuojVia: "password" })
            : credsWith({ classic: r.cookie, classicVia: "password" }),
        );
        notify("oj", `${SOURCE_NAMES[source]} 登录成功，已保存。`);
        void refreshExtHw();
      })
      .catch((e: unknown) => notify("oj", `${SOURCE_NAMES[source]} 登录失败：${errMsg(e)}`))
      .finally(() => setBusy(null));
  };

  const onTycheLogin = () => {
    setBusy("tyche-login");
    setMsg(null);
    const pwdNow = tychePwd; // async 回调前留档（下面 setTychePwd("") 会清空输入框）
    void extHwLogin
      .tyche(tycheUser, pwdNow)
      .then(async (r) => {
        setTycheCookie(r.cookie);
        // R21-A：勾选「记住密码」→ 把刚输的密码随凭据信封（AES-GCM）存档，会话失效时静默重登；
        // 未勾选 → 不存档（credsWith 里 password=undefined，同时覆盖清掉旧存档）
        if (tycheRemember) setTycheSavedPwd(pwdNow);
        // R21-A：手动登录成功 → 解除「显式退出」对自动重登的抑制
        clearTycheLogoutSuppress();
        setTychePwd("");
        setTycheFormOpen(false);
        await saveExtHwCreds(credsWith({ tyche: r.cookie, tychePwd: tycheRemember ? pwdNow : undefined }));
        notify("oj", tycheRemember ? "Tyche 登录成功，已记住密码" : "Tyche 登录成功，已保存。");
        void refreshExtHw();
      })
      .catch((e: unknown) => notify("oj", `Tyche 登录失败：${errMsg(e)}`))
      .finally(() => setBusy(null));
  };

  const onDsaLogin = () => {
    setBusy("dsa-login");
    setMsg(null);
    void extHwLogin
      .dsa(dsaUser, dsaPwd)
      .then(async (r) => {
        setDsaCookie(r.cookie);
        setDsaPwd("");
        setDsaFormOpen(false);
        await saveExtHwCreds(credsWith({ dsa: r.cookie }));
        notify("oj", "DSA OJ 登录成功，已保存。");
        void refreshExtHw();
      })
      .catch((e: unknown) => notify("oj", `DSA OJ 登录失败：${errMsg(e)}`))
      .finally(() => setBusy(null));
  };

  /** R12 17.2：单源退出登录 —— 确认后只清该源凭据，不影响其他源 */
  const onLogout = (source: ExtHwSourceId) => {
    const label = SOURCE_NAMES[source];
    void confirmOk(`确定退出${label}登录？将清除本机保存的${label}凭据，不影响其他源。`).then(
      async (ok) => {
        if (!ok) return;
        setBusy(`logout-${source}`);
        setMsg(null);
        try {
          await removeExtHwCreds(source);
          // 同步清空表单，避免随后点「保存」把旧 Cookie 又写回去
          if (source === "yuketang") {
            setYktCookie("");
          } else if (source === "tuoj") {
            setTuojCookie("");
            setTuojVia(undefined);
            setTuojPwd("");
          } else if (source === "tuojClassic") {
            setClassicCookie("");
            setClassicVia(undefined);
            setClassicPwd("");
          } else if (source === "tyche") {
            setTycheCookie("");
            setTychePwd("");
            // R21-A：退出 = 清掉「记住密码」态（removeExtHwCreds 已清存档并抑制自动重登）
            setTycheRemember(false);
            setTycheSavedPwd("");
          } else {
            setDsaCookie("");
            setDsaPwd("");
          }
          notify(source === "yuketang" ? "yuketang" : "oj", `已退出${label}登录。`);
          void refreshExtHw();
        } catch (e: unknown) {
          notify(source === "yuketang" ? "yuketang" : "oj", `退出${label}登录失败：${errMsg(e)}`);
        } finally {
          setBusy(null);
        }
      },
    );
  };

  const configured: Record<ExtHwSourceId, boolean> = {
    yuketang: Boolean(yktCookie.trim()),
    tuoj: Boolean(tuojCookie.trim()) || tuojVia === "cas" || ext.tuojAuto.tuoj.kind === "ok",
    tuojClassic: Boolean(classicCookie.trim()) || classicVia === "cas" || ext.tuojAuto.tuojClassic.kind === "ok",
    tyche: Boolean(tycheCookie.trim()),
    dsa: Boolean(dsaCookie.trim()),
  };
  /** R15 20.3：仅在需要用户动作时提示（会话失效 / 自动登录失败 / 无课程） */
  const tuojNote = (source: TuojSourceId): ReactNode => {
    const st = ext.tuojAuto[source];
    return (
      <>
        {ext.errors[source] ? <div className="exthw-note is-error">{ext.errors[source]}</div> : null}
        {st.kind === "failed" ? (
          <div className="exthw-note is-warn">
            自动登录未成功{st.message ? `（${st.message.slice(0, 160)}）` : ""}——可点「统一认证登录」重试。
          </div>
        ) : null}
        {st.kind === "no-courses" ? (
          <div className="exthw-note">统一认证已通过，未返回课程（可能未注册或未选课）。</div>
        ) : null}
      </>
    );
  };
  const taStyle = { width: "100%", minHeight: 64, fontFamily: "var(--font-mono, monospace)", fontSize: 12 } as const;
  const fieldStyle = { display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" } as const;
  const srcRows: Array<{ id: ExtHwSourceId; label: string; logged: boolean }> = (
    ["yuketang", "tuoj", "tuojClassic", "tyche", "dsa"] as const
  ).map((id) => ({ id, label: SOURCE_NAMES[id], logged: configured[id] }));

  return (
    <div id="settings-exthw">
      <div className="setting-desc" style={{ margin: "0 2px 6px" }}>
        把各平台作业 DDL 合并到「全部作业」与「今日」；只读拉取（标题 / 课程 / 截止时间），不提交、
        不抓题目。登录信息在本机加密保存，只用来读取作业。
      </div>

      {/* ── R14 19.1 / R15 20.3：雨课堂独立 Card，统一行范式 ── */}
      <SectionHead title={SOURCE_CATEGORY_NAMES.courseware} />
      <Card>
        <div className="exthw-src">
          <div className="exthw-src-head">
            <span className="setting-title exthw-src-name">雨课堂</span>
            <span className={`exthw-badge${configured.yuketang ? " is-on" : ""}`}>
              {configured.yuketang ? "已登录" : "未登录"}
            </span>
            <span className="exthw-src-actions">
              {configured.yuketang ? (
                <button className="btn" disabled={busy !== null} onClick={() => onLogout("yuketang")}>
                  {busy === "logout-yuketang" ? "退出中…" : "退出"}
                </button>
              ) : (
                <>
                  <button
                    className="btn btn-primary"
                    disabled={busy !== null}
                    onClick={() => {
                      setYktWebOpen(false);
                      setYktQrOpen((v) => !v);
                    }}
                  >
                    {yktQrOpen ? "收起扫码" : "微信扫码登录"}
                  </button>
                  {/* R18 24.2：官方网页登录通道（应用内 WebView，支持扫码 / 短信）
                      R18b 25.3.2：桌面端原生窗口实测白屏卡死 → 隐藏该入口（二维码可用），仅 Android 保留 */}
                  {YKT_WEB_LOGIN_AVAILABLE ? (
                    <button
                      className="btn"
                      disabled={busy !== null}
                      title="在应用内打开雨课堂官方登录页，支持扫码或手机号+图形验证码+短信登录"
                      onClick={() => {
                        setYktQrOpen(false);
                        setYktWebOpen((v) => !v);
                      }}
                    >
                      {yktWebOpen ? "收起网页登录" : "官方网页登录"}
                    </button>
                  ) : null}
                </>
              )}
              <button
                className="btn btn-ghost exthw-more"
                disabled
                title="雨课堂已启用图形验证码，短信登录暂不可用，请用微信扫码"
              >
                短信验证码（暂不可用）
              </button>
            </span>
          </div>
          {/* R17 23.2：官方登录页发短信前先取图形验证码（TencentCaptcha/hCaptcha），
              纯接口无法内嵌 → 直接短信通道停用；R18 24.2 起可在「官方网页登录」
              应用内网页里正常使用短信（图形验证码由官方页自己完成）。
              R18b 25.3.2：桌面端该入口隐藏，文案不再引导到它。 */}
          <div className="exthw-note">
            {YKT_WEB_LOGIN_AVAILABLE
              ? "雨课堂已开启图形验证码：请用微信扫码，或选「官方网页登录」。"
              : "雨课堂已启用图形验证码，直接短信登录暂不可用；请用微信或雨豆APP 扫码登录。"}
          </div>
          {msg && msgArea === "yuketang" ? (
            <div className="exthw-note" role="status">{msg}</div>
          ) : null}
          {ext.errors.yuketang ? <div className="exthw-note is-error">{ext.errors.yuketang}</div> : null}
          {/* R21-B：会话健康 + 保活状态 + 导出/导入（仅已登录时） */}
          {configured.yuketang ? (
            <>
              <div className="exthw-note">
                {ext.yktSession.checkedAt === null
                  ? "登录状态：尚未检查（应用启动后会自动检查，约每 6 小时一次，也可手动检查）。"
                  : ext.yktSession.alive === true
                    ? `会话健康：有效${ext.yktSession.userName ? `（${ext.yktSession.userName}）` : ""} · 检查于 ${new Date(ext.yktSession.checkedAt).toLocaleTimeString()}`
                    : ext.yktSession.alive === false
                      ? `会话健康：已失效（${ext.yktSession.reason}）· 检查于 ${new Date(ext.yktSession.checkedAt).toLocaleTimeString()}`
                      : "登录状态：未知（上次检查时网络异常，不判定为失效）"}
              </div>
              <div style={fieldStyle}>
                <button className="btn" disabled={busy !== null} onClick={onYktCheckSession}>
                  {busy === "ykt-check" ? "检查中…" : "检查登录状态"}
                </button>
                <button
                  className="btn"
                  disabled={busy !== null}
                  title="导出当前登录状态，供其他设备导入（免重复扫码）。文件等同账号绑定，用完请即删。"
                  onClick={onYktExportCookie}
                >
                  {busy === "ykt-export" ? "导出中…" : "导出登录状态"}
                </button>
                <button
                  className="btn"
                  disabled={busy !== null}
                  title="导入其他已登录设备导出的登录状态文件，免扫码直接恢复登录"
                  onClick={onYktImportCookie}
                >
                  {busy === "ykt-import" ? "导入中…" : "导入登录状态"}
                </button>
              </div>
              {ext.yktSession.alive === false ? (
                <div className="exthw-note is-error">
                  会话已失效：作业页将拉不到雨课堂数据。可「一键重登（扫码）」，或在其他已登录设备「导出
                  Cookie」后在此「导入 Cookie」恢复。
                  <div style={{ marginTop: 6 }}>
                    <button
                      className="btn btn-primary"
                      disabled={busy !== null}
                      onClick={() => {
                        setYktWebOpen(false);
                        setYktQrOpen(true);
                      }}
                    >
                      一键重登（扫码）
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
          {yktQrOpen ? (
            <YktQrPanel
              onCancel={() => setYktQrOpen(false)}
              onSuccess={(cookie) => {
                setYktCookie(cookie);
                setYktQrOpen(false);
                void saveExtHwCreds(credsWith({ ykt: cookie })).then(() => {
                  notify("yuketang", "雨课堂扫码登录成功，已保存。");
                  void refreshExtHw();
                });
              }}
            />
          ) : null}
          {yktWebOpen ? (
            <YktWebLoginPanel
              onCancel={() => setYktWebOpen(false)}
              onSuccess={(cookie) => {
                setYktCookie(cookie);
                setYktWebOpen(false);
                void saveExtHwCreds(credsWith({ ykt: cookie })).then(() => {
                  notify("yuketang", "雨课堂官方网页登录成功，已保存登录状态。");
                  void refreshExtHw();
                });
              }}
            />
          ) : null}
        </div>
      </Card>

      {/* ── R14 19.2 / R15 20.3：OJ 平台组默认折叠，标题行常显 4 源接入状态 ── */}
      <SectionHead title={SOURCE_CATEGORY_NAMES.oj} aside="按个人情况登录" />
      <Card>
        <button
          type="button"
          className="exthw-oj-head"
          aria-expanded={ojOpen}
          onClick={() => setOjOpen((v) => !v)}
        >
          <span className="exthw-oj-caret" aria-hidden="true">{ojOpen ? "▾" : "▸"}</span>
          <span className="setting-title">OJ 平台登录</span>
          <span className="exthw-oj-badges">
            {(["tuoj", "tuojClassic", "tyche", "dsa"] as const).map((id) => (
              <span key={id} className={`exthw-badge${configured[id] ? " is-on" : ""}`}>
                {SOURCE_NAMES[id]} {configured[id] ? "✅" : "未登录"}
              </span>
            ))}
          </span>
          <span className="exthw-oj-hint">{ojOpen ? "点击收起" : "点击展开登录"}</span>
        </button>
        {msg && msgArea === "oj" ? (
          <div className="exthw-note" role="status" style={{ margin: "6px 2px 0" }}>{msg}</div>
        ) : null}
        {ojOpen ? (
          <div className="exthw-oj-body">
            {/* TUOJ（AI 版）：主路径 = 清华统一认证漫游；账号密码收进「更多」 */}
            <OjSourceRow
              name={SOURCE_NAMES.tuoj}
              logged={configured.tuoj}
              via={
                tuojVia === "cas" || ext.tuojAuto.tuoj.kind === "ok"
                  ? "统一认证"
                  : tuojVia === "password"
                    ? "账号密码"
                    : undefined
              }
              primary={
                configured.tuoj ? (
                  <button className="btn" disabled={busy !== null} onClick={() => onLogout("tuoj")}>
                    {busy === "logout-tuoj" ? "退出中…" : "退出"}
                  </button>
                ) : (
                  <button className="btn btn-primary" disabled={busy !== null} onClick={() => onTuojCasLogin("tuoj")}>
                    {busy === "tuoj-cas-tuoj" ? "登录中…" : "统一认证登录"}
                  </button>
                )
              }
              more={
                <button className="btn btn-ghost exthw-more" onClick={() => setTuojPwdOpen((v) => !v)}>
                  {tuojPwdOpen ? "▾" : "▸"} 账号密码
                </button>
              }
              note={tuojNote("tuoj")}
            >
              {tuojPwdOpen ? (
                <div className="exthw-src-body">
                  <div style={fieldStyle}>
                    <input className="input" style={{ minWidth: 160, flex: 1 }} placeholder="用户名" value={tuojUser} onChange={(e) => setTuojUser(e.target.value.trim())} />
                    <input className="input" style={{ minWidth: 160, flex: 1 }} type="password" placeholder="密码" value={tuojPwd} onChange={(e) => setTuojPwd(e.target.value)} />
                    <button className="btn" disabled={busy !== null || !tuojUser.trim() || !tuojPwd} onClick={() => onTuojPwdLogin("tuoj")}>
                      {busy === "tuoj-pwd-tuoj" ? "登录中…" : "登录"}
                    </button>
                  </div>
                </div>
              ) : null}
            </OjSourceRow>

            {/* TUOJ（经典版）：同 AI 版范式，仅 base 不同 */}
            <OjSourceRow
              name={SOURCE_NAMES.tuojClassic}
              logged={configured.tuojClassic}
              via={
                classicVia === "cas" || ext.tuojAuto.tuojClassic.kind === "ok"
                  ? "统一认证"
                  : classicVia === "password"
                    ? "账号密码"
                    : undefined
              }
              primary={
                configured.tuojClassic ? (
                  <button className="btn" disabled={busy !== null} onClick={() => onLogout("tuojClassic")}>
                    {busy === "logout-tuojClassic" ? "退出中…" : "退出"}
                  </button>
                ) : (
                  <button className="btn btn-primary" disabled={busy !== null} onClick={() => onTuojCasLogin("tuojClassic")}>
                    {busy === "tuoj-cas-tuojClassic" ? "登录中…" : "统一认证登录"}
                  </button>
                )
              }
              more={
                <button className="btn btn-ghost exthw-more" onClick={() => setClassicPwdOpen((v) => !v)}>
                  {classicPwdOpen ? "▾" : "▸"} 账号密码
                </button>
              }
              note={tuojNote("tuojClassic")}
            >
              {classicPwdOpen ? (
                <div className="exthw-src-body">
                  <div style={fieldStyle}>
                    <input className="input" style={{ minWidth: 160, flex: 1 }} placeholder="用户名" value={classicUser} onChange={(e) => setClassicUser(e.target.value.trim())} />
                    <input className="input" style={{ minWidth: 160, flex: 1 }} type="password" placeholder="密码" value={classicPwd} onChange={(e) => setClassicPwd(e.target.value)} />
                    <button className="btn" disabled={busy !== null || !classicUser.trim() || !classicPwd} onClick={() => onTuojPwdLogin("tuojClassic")}>
                      {busy === "tuoj-pwd-tuojClassic" ? "登录中…" : "登录"}
                    </button>
                  </div>
                </div>
              ) : null}
            </OjSourceRow>

            {/* Tyche：用户名 + 密码（校内或 sslvpn）；R21-A 支持记住密码 + 会话失效静默自动重登 */}
            <OjSourceRow
              name={SOURCE_NAMES.tyche}
              logged={configured.tyche}
              primary={
                configured.tyche ? (
                  <button className="btn" disabled={busy !== null} onClick={() => onLogout("tyche")}>
                    {busy === "logout-tyche" ? "退出中…" : "退出"}
                  </button>
                ) : (
                  <button className="btn btn-primary" disabled={busy !== null} onClick={() => setTycheFormOpen((v) => !v)}>
                    {tycheFormOpen ? "收起" : "登录"}
                  </button>
                )
              }
              more={
                configured.tyche ? (
                  <button className="btn btn-ghost exthw-more" onClick={() => setTycheFormOpen((v) => !v)}>
                    {tycheFormOpen ? "▾" : "▸"} 重新登录
                  </button>
                ) : undefined
              }
              note={
                ext.errors.tyche ? (
                  <div className="exthw-note is-error">{ext.errors.tyche}</div>
                ) : tycheRemember && configured.tyche ? (
                  <div className="exthw-note">已记住密码，登录状态失效时自动重新登录。</div>
                ) : undefined
              }
            >
              {tycheFormOpen ? (
                <div className="exthw-src-body">
                  <div style={fieldStyle}>
                    <input className="input" style={{ minWidth: 160, flex: 1 }} placeholder="用户名" value={tycheUser} onChange={(e) => setTycheUser(e.target.value.trim())} />
                    <input className="input" style={{ minWidth: 160, flex: 1 }} type="password" placeholder="密码" value={tychePwd} onChange={(e) => setTychePwd(e.target.value)} />
                    <button className="btn btn-primary" disabled={busy !== null || !tycheUser.trim() || !tychePwd} onClick={onTycheLogin}>
                      {busy === "tyche-login" ? "登录中…" : "登录"}
                    </button>
                  </div>
                  {/* R21-A：记住密码 → 会话失效时用存档账密静默自动重登一次（同源 ≥10min、每进程 ≤3 次） */}
                  <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, fontSize: 12, opacity: 0.9 }}>
                    <input type="checkbox" checked={tycheRemember} onChange={(e) => setTycheRemember(e.target.checked)} />
                    记住密码（会话失效后自动重新登录）
                  </label>
                  <div style={{ marginTop: 4, fontSize: 12, opacity: 0.65 }}>
                    {tycheRemember
                      ? "密码以密文存在本机，不上传、不进日志；退出登录即清除。"
                      : "不勾选则只保存本次登录状态，失效后需手动重新登录。"}
                  </div>
                </div>
              ) : null}
            </OjSourceRow>

            {/* DSA OJ：邮箱 + 密码（无统一认证） */}
            <OjSourceRow
              name={SOURCE_NAMES.dsa}
              logged={configured.dsa}
              primary={
                configured.dsa ? (
                  <button className="btn" disabled={busy !== null} onClick={() => onLogout("dsa")}>
                    {busy === "logout-dsa" ? "退出中…" : "退出"}
                  </button>
                ) : (
                  <button className="btn btn-primary" disabled={busy !== null} onClick={() => setDsaFormOpen((v) => !v)}>
                    {dsaFormOpen ? "收起" : "登录"}
                  </button>
                )
              }
              more={
                configured.dsa ? (
                  <button className="btn btn-ghost exthw-more" onClick={() => setDsaFormOpen((v) => !v)}>
                    {dsaFormOpen ? "▾" : "▸"} 重新登录
                  </button>
                ) : undefined
              }
              note={ext.errors.dsa ? <div className="exthw-note is-error">{ext.errors.dsa}</div> : undefined}
            >
              {dsaFormOpen ? (
                <div className="exthw-src-body">
                  <div style={fieldStyle}>
                    <input className="input" style={{ minWidth: 160, flex: 1 }} type="email" placeholder="邮箱" value={dsaUser} onChange={(e) => setDsaUser(e.target.value.trim())} />
                    <input className="input" style={{ minWidth: 160, flex: 1 }} type="password" placeholder="密码" value={dsaPwd} onChange={(e) => setDsaPwd(e.target.value)} />
                    <button className="btn btn-primary" disabled={busy !== null || !dsaUser.trim() || !dsaPwd} onClick={onDsaLogin}>
                      {busy === "dsa-login" ? "登录中…" : "登录"}
                    </button>
                  </div>
                </div>
              ) : null}
            </OjSourceRow>
          </div>
        ) : null}
      </Card>

      {/* ── 共用：抓取范围 / 保存 / 刷新 / 高级（对所有源生效）── */}
      <Card style={{ marginTop: 18 }}>
        <div className="setting-row" style={{ alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="setting-title">抓取范围与刷新</div>
            <div className="setting-desc">对所有源生效；已过期的作业仍显示。</div>

            <div style={{ marginTop: 12, display: "grid", gap: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="setting-title" style={{ fontSize: 13 }}>只保留未来</span>
                <input className="input" style={{ width: 80 }} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/[^0-9]/g, ""))} />
                <span className="setting-desc">天（已过期的仍显示）</span>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Btn variant="solid" tone="brand" onClick={onSave}>保存</Btn>
                <button className="btn" disabled={busy !== null || ext.state === "loading"} onClick={onRefresh}>
                  {busy === "refresh" || ext.state === "loading" ? "刷新中…" : "立即刷新"}
                </button>
              </div>

              {/* 高级：手动粘贴浏览器登录信息（一般用户用不到） */}
              <div>
                <button className="btn btn-ghost" style={{ padding: "2px 0" }} onClick={() => setAdvanced((v) => !v)}>
                  {advanced ? "▾" : "▸"} 高级：手动粘贴浏览器登录信息
                </button>
                {advanced ? (
                  <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
                    <textarea className="input" style={taStyle} placeholder="雨课堂登录状态" value={yktCookie} onChange={(e) => setYktCookie(e.target.value)} />
                    <textarea className="input" style={taStyle} placeholder="TUOJ（AI 版）登录状态" value={tuojCookie} onChange={(e) => setTuojCookie(e.target.value)} />
                    <textarea className="input" style={taStyle} placeholder="TUOJ（经典版）登录状态" value={classicCookie} onChange={(e) => setClassicCookie(e.target.value)} />
                    <textarea className="input" style={taStyle} placeholder="Tyche Cookie（JSESSIONID / username / uid）" value={tycheCookie} onChange={(e) => setTycheCookie(e.target.value)} />
                    <textarea className="input" style={taStyle} placeholder="DSA OJ Cookie（PHPSESSID …）" value={dsaCookie} onChange={(e) => setDsaCookie(e.target.value)} />
                    <div className="setting-desc" style={{ marginTop: 0 }}>粘贴后点击上方「保存」生效。</div>
                  </div>
                ) : null}
              </div>

              <div style={{ display: "grid", gap: 4 }}>
                {srcRows.map(({ id, label, logged }) => {
                  const count = ext.items.filter((it) => it.source === id).length;
                  const err = ext.errors[id];
                  return (
                    <div key={id} style={{ fontSize: 13, color: "var(--text-2)" }}>
                      {label}：{logged ? "已登录" : "未登录"} ·{" "}
                      {err ? <span style={{ color: "var(--red, #c04848)" }}>需重新登录</span> : `${count} 条`}
                    </div>
                  );
                })}
                {msg && msgArea === "range" ? (
                  <div style={{ fontSize: 13, color: "var(--text-2)" }} role="status">{msg}</div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </Card>
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
        <div className="setting-row" style={{ flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 240px", minWidth: 0 }}>
            <div className="setting-title">下载位置</div>
            <div className="setting-desc" style={{ overflowWrap: "anywhere" }}>
              {loading ? "正在读取…" : directory?.path || "下载位置读取失败，请重新选择文件夹或恢复默认。"}
            </div>
            <div className="setting-desc">
              网络学堂附件与云盘文件将保存到这里，已下载的文件不会移动；单个文件也可以用「另存为」临时挑别处。
            </div>
            {message ? (
              <div role="status" style={{ marginTop: 8, fontSize: 13, color: "var(--text-2)", overflowWrap: "anywhere" }}>{message}</div>
            ) : null}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button className="btn" disabled={loading || busy} onClick={() => void changeDirectory(false)}>
              选择文件夹
            </button>
            <button className="btn" disabled={loading || busy || directory?.isDefault} onClick={() => void changeDirectory(true)}>
              恢复默认
            </button>
          </div>
        </div>
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
    <div className="setting-row">
      <div>
        <div className="setting-title">运行日志</div>
        <div className="setting-desc">{where ? `已导出：${where}` : "用于问题排查，导出到系统下载"}</div>
      </div>
      <button className="btn" disabled={busy} onClick={() => void run()}>
        {busy ? "导出中…" : "导出日志"}
      </button>
    </div>
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
    <div className="setting-row">
      <div>
        <div className="setting-title">诊断摘要</div>
        <div className="setting-desc">反馈问题时粘贴这段文字，不含学号等个人信息</div>
      </div>
      <button className="btn" disabled={busy} onClick={() => void run()}>
        {busy ? "复制中…" : "复制摘要"}
      </button>
    </div>
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
    <div className="wall-section">
      <div className="setting-title">壁纸</div>
      <div className="setting-desc">全窗共用一张：画在壳层底，面板与栏体透出它。</div>
      <WallpaperLibrary variant="panel" />
      <div className="wall-sound-row">
        <div>
          <div className="setting-title">动态壁纸声音</div>
          <div className="setting-desc">默认静音；视频壁纸有声时才需手势放开（浏览器自动播放策略）。</div>
        </div>
        <Switch on={sound} onChange={(v) => setVideoSound(v)} label="动态壁纸声音" />
      </div>
    </div>
  );
}

/** 玻璃程度四段选择（外观分节）：值与 <html data-glass> 都由 lib/glassLevel.ts 管
 *  （默认档均衡不落属性 = 走基座玻璃令牌；改档即时生效，存档键是该模块内部约定）。 */
function GlassLevelSegmented(): ReactNode {
  const level = useSyncExternalStore(subscribeGlassLevel, getGlassLevel, getGlassLevel);
  return (
    <div style={{ display: "flex", gap: 8, flex: "none" }}>
      {glassLevels().map((g) => (
        <button
          key={g.id}
          className={"btn " + (level === g.id ? "btn-primary" : "btn-ghost")}
          style={{ flex: "none" }}
          aria-pressed={level === g.id}
          onClick={() => setGlassLevel(g.id)}
        >
          {g.label}
        </button>
      ))}
    </div>
  );
}

function AppearanceSection(): ReactNode {
  const snap = useThemes();
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
  const themes = [{ id: "", name: "默认外观" }, ...visibleThemeDefs.map((t) => ({ id: t.id, name: t.dark ? `${t.name}（暗色）` : t.name }))];
  return (
    <div className="setting-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 10 }}>
      {/* 标签栏默认样式：横版（顶部一排）｜竖版（左侧栏）；标签栏上的切换钮可随时改，这里定的是默认值。
          手机（A1）：手机只能横标签页（竖栏永不出现），这一行整块不渲染。 */}
      {isPhone ? null : (
        <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
          <div>
            <div className="setting-title">标签栏样式</div>
            <div className="setting-desc">横版：标签在顶部一排；竖版：标签在左侧栏。标签栏上的切换钮可随时改，这里设的是默认值。</div>
          </div>
          <div style={{ display: "flex", gap: 8, flex: "none" }}>
            <button className={"btn " + (tabLayoutDefault === "h" ? "btn-primary" : "btn-ghost")} style={{ flex: "none" }} aria-pressed={tabLayoutDefault === "h"} onClick={() => setTabLayoutDefault("h")}>横版</button>
            <button className={"btn " + (tabLayoutDefault === "v" ? "btn-primary" : "btn-ghost")} style={{ flex: "none" }} aria-pressed={tabLayoutDefault === "v"} onClick={() => setTabLayoutDefault("v")}>竖版</button>
          </div>
        </div>
      )}
      {/* 玻璃程度：全站玻璃面材浓度四档（clear/balanced/rich/deep → data-glass 覆盖块） */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
        <div>
          <div className="setting-title">玻璃程度</div>
          <div className="setting-desc">清透更亮透，浓郁更深实；影响全站玻璃面材。</div>
        </div>
        <GlassLevelSegmented />
      </div>
      {/* 主题（① 2026-10-11 用户拍板）：这里**只做切换**，且**只列已启用**的主题（未启用插件的不出现）；
          启用/停用在「插件」里，安装主题走右边那个按钮（跳市场 + 自动筛「主题」）。 */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
        <div>
          <div className="setting-title">主题</div>
          <div className="setting-desc">
            当前：{themes.find((th) => (snap.activeId ?? "") === th.id)?.name ?? "默认外观"}
            {dyn ? " · 系统取色生效中，换主题后会自动关闭" : ""}
            <span style={{ color: "var(--text-3)" }}>　启用 / 停用主题在「插件」页里。</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flex: "none" }}>
          {/* ③ 两个按钮并列、同一套胶囊口径：安装（市场 + 主题筛选）｜管理（主题插件的启用/停用） */}
          <button
            className="btn btn-primary"
            style={{ flex: "none" }}
            title="到插件市场安装主题（自动筛选「主题」类别）"
            onClick={() => {
              requestPluginsView({ view: "market", category: "theme" });
            }}
          >
            安装主题
          </button>
          <button
            className="btn btn-primary"
            style={{ flex: "none" }}
            title="管理主题插件的启用 / 停用（按新规范，启用与否只在这里管）"
            onClick={() => {
              /* 启用/停用界面＝插件页「我的插件 + 主题筛选」：那里每张主题卡都有开关语义 */
              requestPluginsView({ view: "mine", category: "theme" });
            }}
          >
            管理主题
          </button>
        </div>
      </div>
      {/* ③ 主题板**恢复成原来那套**（用户给的旧图样式：色卡 + 名称 + 使用中/社区胶囊 + 应用按钮），
          只按新规范过滤掉未启用的主题；排版与 ThemePickerModal 里的板子保持一致。 */}
      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "minmax(0, 1fr)" }}>
        <div
          style={{
            display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
            border: "1px solid " + (snap.activeId ? "var(--border)" : "var(--accent)"),
            borderRadius: "var(--r-md)", background: snap.activeId ? "var(--surface)" : "var(--accent-soft)",
          }}
        >
          <ThemeSwatch vars={{}} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <b>默认外观</b>
              {snap.activeId ? null : <span className="chip" style={{ height: 16, fontSize: 9.5, padding: "0 6px" }}>使用中</span>}
            </div>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-3)", marginTop: 2 }}>不套用任何主题，使用应用自带配色</div>
          </div>
          {snap.activeId ? (
            <Btn variant="solid" tone="brand" onClick={() => deactivateTheme()}>应用</Btn>
          ) : null}
        </div>
        {visibleThemeDefs.map((t) => {
          const on = snap.activeId === t.id;
          return (
            <div
              key={t.id}
              style={{
                display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", minWidth: 0,
                border: "1px solid " + (on ? "var(--accent)" : "var(--border)"),
                borderRadius: "var(--r-md)", background: on ? "var(--accent-soft)" : "var(--surface)",
              }}
            >
              <ThemeSwatch vars={t.vars} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <b style={{ minWidth: 0, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</b>
                  {t.source === "plugin" ? <span className="chip" style={{ height: 16, fontSize: 9.5, padding: "0 6px" }}>社区</span> : null}
                  {on ? <span className="chip" style={{ height: 16, fontSize: 9.5, padding: "0 6px" }}>使用中</span> : null}
                </div>
                <div style={{ fontSize: "var(--text-xs)", color: "var(--text-3)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {t.description ?? t.id}
                </div>
              </div>
              {on ? null : (
                <Btn variant="solid" tone="brand" onClick={() => activateTheme(t.id)}>应用</Btn>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
        <div>
          <div className="setting-title">跟随系统昼夜</div>
          <div className="setting-desc">
            开启后按系统的深色模式自动切换：亮色用「白天主题」，深色用「黑夜主题」。
            {snap.followSystem ? `（当前系统：${snap.systemDark ? "深色" : "浅色"}）` : ""}
          </div>
        </div>
        <button
          className={"switch" + (snap.followSystem ? " on" : "")}
          role="switch"
          aria-checked={snap.followSystem}
          aria-label="跟随系统昼夜"
          onClick={() => setFollowSystem(!snap.followSystem)}
        />
      </div>
      {snap.followSystem ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
            <div className="setting-title" style={{ flex: "none" }}>白天主题</div>
            <Select value={snap.dayThemeId ?? ""} onChange={(value) => setDayNightTheme(value || null, snap.nightThemeId)} disabled={dyn}>{themes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
            <div className="setting-title" style={{ flex: "none" }}>黑夜主题</div>
            <Select value={snap.nightThemeId ?? ""} onChange={(value) => setDayNightTheme(snap.dayThemeId, value || null)} disabled={dyn}>{themes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
          </div>
        </>
      ) : (
        <div className="setting-desc" style={{ color: "var(--text-3)" }}>
          想昼夜自动切换就打开上面的开关；单独换主题点上面的「主题」。
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
        <div>
          <div className="setting-title">跟随系统取色</div>
          {dynOk === false ? (
            <div className="setting-desc">
              {dyn ? "系统取色暂不可用，已自动改用「清华紫」主题，稍后可在外观里手动更换。" : "当前系统不支持，开启后改用「清华紫」主题。"}
            </div>
          ) : (
            <div className="setting-desc">用壁纸的颜色重新计算全站配色，品牌色与背景色一起变。</div>
          )}
        </div>
        <button
          className={"switch" + (dyn ? " on" : "")}
          role="switch"
          aria-checked={dyn}
          aria-label="跟随系统取色"
          onClick={() => void toggleDyn()}
        />
      </div>
      {dyn ? (
        <div className="setting-desc" style={{ color: "var(--text-3)" }}>
          生效中：关掉开关即恢复所选主题。
        </div>
      ) : null}
      <ThemePickerModal open={pickerOpen} onClose={() => setPickerOpen(false)} />
    </div>
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
    <div className="setting-group-wrap">
      <div className="setting-row">
        <div>
          <div className="setting-title">极客模式（浏览器探索）</div>
          <div className="setting-desc">
            高级选项，默认关闭；把不在 OneTHU 里的站点功能用登录态爬回来自己做插件。用独立登录态，和自己浏览器互不干扰。
          </div>
          <div className="setting-desc" style={{ color: "var(--md-sys-color-error)" }}>
            风险自负：探索动作可能被站点风控计入本人账号；不喜欢冒险可通过 OH 建议官方收录。
          </div>
        </div>
        <Switch on={on} onChange={toggle} label="极客模式" />
      </div>
      {on ? (
        <div className="setting-row">
          <div>
            <div className="setting-title">探索浏览器</div>
            <div className="setting-desc">
              {probe
                ? probe.browsers.length > 0
                  ? `本机可用浏览器 ${probe.browsers.length} 个；playwright 版${probe.playwrightReady ? "已下载" : "未下载"}`
                  : "本机没有可直接用的浏览器，可一键下载专用版"
                : "探测中…"}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flex: "none" }}>
            <button className="btn btn-ghost" disabled={busy !== null} onClick={() => void download()}>
              {busy === "dl" ? "下载中…" : "下载专用版"}
            </button>
            <button className="btn" disabled={busy !== null || !probe} onClick={() => void launch()}>
              {busy === "launch" ? "启动中…" : "启动探索"}
            </button>
          </div>
        </div>
      ) : null}
      {on ? (
        <div className="setting-row">
          <div>
            <div className="setting-title">启动方式</div>
            <div className="setting-desc">系统浏览器（复用本机 Chrome/Edge）或探索专用浏览器。</div>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, flex: "none" }}>
            <input type="radio" checked={mode === "system"} onChange={() => setMode("system")} /> 系统浏览器
            <input type="radio" checked={mode === "playwright"} onChange={() => setMode("playwright")} /> 专用版
          </label>
        </div>
      ) : null}
      {msg ? <div className="exthw-note">{msg}</div> : null}
    </div>
  );
}
