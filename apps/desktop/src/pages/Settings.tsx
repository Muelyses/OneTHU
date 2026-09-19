declare const __APP_VERSION__: string;
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Card, PageHead, SectionHead } from "../components/Layout.js";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { clearRemembered, loadRemembered, session } from "../lib/clients.js";
import { clearHomeLayout } from "../lib/homeCards.js";
import { useFavs } from "../state/favs.js";
import { parseFavs, resetFavs } from "../state/favorites.js";
import { confirmOk } from "../lib/confirm.js";
import { useApp } from "../state/context.js";
import { useCloudCal, configureCloudCal, disconnectCloudCal, syncCloudCal } from "../state/cloudCal.js";
import {
  useSystemCal,
  systemCalSupported,
  enableSystemCalendar,
  disableSystemCalendar,
  removeSystemCalendar,
  syncSystemCalendar,
} from "../state/systemCal.js";
import {
  APP_CODENAME, fetchLatestRelease, isNewer, currentVersion,
  isDismissed, dismissTag, type ReleaseInfo,
} from "../lib/update.js";
import { runProbeMatrix, type ProbeResult } from "./probe.js";
import { YktQrPanel } from "../components/ExtHwLoginModal.js";
import {
  clearTuojAutoStatus,
  consumeExtHwScrollRequest,
  ensureExtHwCredsLoaded,
  extHwLogin,
  removeExtHwCreds,
  saveExtHwCreds,
  refreshExtHw,
  useExternalHomework,
} from "../state/exthw.js";
import type { ExtHwCreds, ExtHwSourceId } from "@onethu/core";

export function SettingsPage() {
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
  // dev2 管线验收探针（lib 单管线 DoD）
  const [probeRunning, setProbeRunning] = useState(false);
  const [probeResults, setProbeResults] = useState<ProbeResult[] | null>(null);
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
      <PageHead title="设置" />

      <SectionHead title="关于" />
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
        <UpdateRow />
      </Card>

      <SectionHead title="账户" />
      <Card>
        <div className="setting-row">
          <div>
            <div className="setting-title">统一认证</div>
            <div className="setting-desc">{user?.displayName || user?.username || "未登录"}</div>
          </div>
          <button className="btn" onClick={() => void logout()}>
            退出登录
          </button>
        </div>
      </Card>

      <SectionHead title="管线验收（dev2 移植）" />
      <Card>
        <div className="setting-row" style={{ alignItems: "flex-start" }}>
          <div>
            <div className="setting-title">thu-info-lib 单管线验收矩阵</div>
            <div className="setting-desc">
              登录后运行：逐项调用 thu-info-lib 公开 API（个人信息/校历/课表/图书馆/新闻/校园卡），
              每项都走「包装域 + wengine SSO + 共享 jar」完整管线。任何一项红 = 该链路适配有缺口。
            </div>
            {probeResults ? (
              <div style={{ marginTop: 10, fontSize: 13, display: "grid", gap: 4 }}>
                {probeResults.map((r) => (
                  <div key={r.name} style={{ display: "flex", gap: 8 }}>
                    <span style={{ color: r.ok ? "#2e9e5b" : "#d0453c", fontWeight: 600 }}>{r.ok ? "✓" : "✗"}</span>
                    <span style={{ color: "var(--text-1)" }}>{r.name}</span>
                    <span style={{ color: "var(--text-2)", marginLeft: "auto", whiteSpace: "nowrap" }}>
                      {r.detail} · {r.ms}ms
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <button
            className="btn"
            disabled={probeRunning}
            onClick={() => {
              setProbeRunning(true);
              void runProbeMatrix()
                .then(setProbeResults)
                .finally(() => setProbeRunning(false));
            }}
          >
            {probeRunning ? "运行中…" : "运行验收"}
          </button>
        </div>
      </Card>

      <SectionHead title="账户设置" />
      <Card>
        <div className="setting-row" style={{ alignItems: "flex-start" }}>
          <div>
            <div className="setting-title">清华电子身份（信任因子 / 密码管理）</div>
            <div className="setting-desc">
              在原生窗口打开 id.tsinghua.edu.cn，自动填入账号密码（有图形验证码时需手动输入）。
              <b>注意：删除信任因子或修改密码可能导致 OneTHU 退出登录</b>，需重新登录一次。
            </div>
            {eidMsg ? (
              <div style={{ marginTop: 8, fontSize: 13, color: "var(--text-2)" }}>{eidMsg}</div>
            ) : null}
          </div>
          <button
            className="btn"
            onClick={() => {
              const creds = session.getIdCredentials();
              if (!creds) {
                void openUrl("https://id.tsinghua.edu.cn/do/outoflogin/login/mainUi/login")
                  .then(() => setEidMsg("已在系统浏览器打开电子身份，请手动输入账号密码。"))
                  .catch((e: unknown) => setEidMsg(`打开失败：${e instanceof Error ? e.message : String(e)}`));
                return;
              }
              const openInBrowser = () =>
                openUrl("https://id.tsinghua.edu.cn/do/outoflogin/login/mainUi/login")
                  .then(() => setEidMsg("已在系统浏览器打开电子身份（多窗口自动填入仅桌面端支持）"))
                  .catch((e: unknown) => setEidMsg(`打开失败：${e instanceof Error ? e.message : String(e)}`));
              void invoke("open_eid_window", { username: creds.username, password: creds.password })
                .then(() => setEidMsg("已打开电子身份窗口（账号密码已自动填入）"))
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
                {calMsg ? <div style={{ marginTop: 6, color: "var(--text-2)" }}>{calMsg}</div> : null}
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
                  {calBusy ? "连接中…" : "保存并测试"}
                </button>
              </div>
              {calMsg ? <div style={{ marginTop: 8, fontSize: 13, color: "var(--text-2)" }}>{calMsg}</div> : null}
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
                  <div style={{ marginTop: 6, color: "var(--danger, #c04848)" }}>最近一次同步失败：{syscal.lastError}</div>
                ) : null}
                {sysMsg ? <div style={{ marginTop: 6, color: "var(--text-2)" }}>{sysMsg}</div> : null}
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
                      setSysMsg(r.skipped ? "内容无变化，系统日历已是最新。" : `已同步：写入 ${r.added} 条（清理旧 ${r.removed} 条）。`),
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
                    .then(() => setSysMsg("已停止自动同步；已写入的日历与事件保留。"))
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
                {sysMsg ? <div style={{ marginTop: 6, color: "var(--text-2)" }}>{sysMsg}</div> : null}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <button
                  className="btn btn-primary"
                  disabled={sysBusy || sysSupported === null}
                  onClick={() => {
                    setSysBusy(true);
                    setSysMsg(null);
                    void enableSystemCalendar()
                      .then(() => setSysMsg("已开启：系统日历「OneTHU 日程」写入完成，此后自动保持最新。"))
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

      <SectionHead title="首页" />
      <Card>
        <div className="setting-row">
          <div>
            <div className="setting-title">恢复默认首页布局</div>
            <div className="setting-desc">
              清除「今日」页卡片的排列、折叠与隐藏记录（onethu.home.layout /
              onethu.home.defaults 两个本地键），下次打开首页回到默认版式（主栏：
              日程与提醒 / 未提交作业 / 最近通知；侧栏：校园卡余额 / 今日预约 /
              今日课程 / 订阅新闻；入口卡全部隐藏）。
            </div>
          </div>
          <button className="btn" onClick={() => { clearHomeLayout(); setHomeResetAt(Date.now()); }}>
            {homeResetAt ? "已恢复默认" : "恢复默认布局"}
          </button>
        </div>
      </Card>

      <SectionHead title="收藏夹" />
      <Card>
        <div className="setting-row" style={{ alignItems: "flex-start" }}>
          <div>
            <div className="setting-title">恢复默认收藏夹</div>
            <div className="setting-desc">
              删除全部用户收藏夹与折叠记录（默认一级入口不受影响，永远在左侧栏）。
              各功能原子仍锚定在原位页面，收藏夹只是跳转入口层。
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
                  setFavMsg("剪贴板不可用——请用「导入」框核对，或截图反馈。");
                  return;
                }
                void clip
                  .writeText(json)
                  .then(() => setFavMsg("收藏夹 JSON 已复制到剪贴板（" + favs.data.order.length + " 个根收藏夹）"))
                  .catch(() => setFavMsg("复制失败：剪贴板被拒绝，可改用导入框反向核对。"));
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
              style={{ width: "100%", minHeight: 120, fontFamily: "var(--mono, monospace)", fontSize: 12 }}
              placeholder={"粘贴收藏夹 JSON（设置页导出的格式）…"}
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
                    setFavMsg("导入失败：JSON 结构不合法（需要 onethu.favs.v1 导出格式）。");
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
              <button className="btn btn-ghost" onClick={() => setImportOpen(false)}>取消</button>
            </div>
          </div>
        ) : null}
      </Card>

      <SectionHead title="插件" />
      <Card>
        <div className="setting-row">
          <div>
            <div className="setting-title">插件管理</div>
            <div className="setting-desc">Rust 骨干与 JS 模块的安装、启停、权限与运行轨迹</div>
          </div>
          <button className="btn" onClick={() => navigate("plugins")}>
            进入插件页
          </button>
        </div>
      </Card>
      <SectionHead title="安全" />
      <Card>
        <div className="setting-row">
          <div>
            <div className="setting-title">记住的密码</div>
            <div className="setting-desc">
              {hasSaved
                ? "已在本机保存；刷新/重启后自动登录。"
                : "未保存。登录页勾选「记住密码」即可启用。"}
            </div>
          </div>
          {hasSaved ? (
            <button className="btn" disabled={clearing} onClick={() => void onClear()}>
              {clearing ? "清除中…" : "清除"}
            </button>
          ) : null}
        </div>
      </Card>
    </>
  );
}

/* ── 外部作业源（雨课堂 / TUOJ / Tyche）── */
function ExtHwSection() {
  const ext = useExternalHomework();
  const [yktPhone, setYktPhone] = useState("");
  const [yktCode, setYktCode] = useState("");
  const [yktCookie, setYktCookie] = useState("");
  const [yktQrOpen, setYktQrOpen] = useState(false);
  const [yktSmsOpen, setYktSmsOpen] = useState(false);
  const [tuojUser, setTuojUser] = useState("");
  const [tuojPwd, setTuojPwd] = useState("");
  const [tuojCookie, setTuojCookie] = useState("");
  const [tuojVia, setTuojVia] = useState<"cas" | "password" | undefined>(undefined);
  const [tuojPwdOpen, setTuojPwdOpen] = useState(false);
  const [tycheUser, setTycheUser] = useState("");
  const [tychePwd, setTychePwd] = useState("");
  const [tycheCookie, setTycheCookie] = useState("");
  const [days, setDays] = useState("30");
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

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
      setTycheUser(c.tyche?.username ?? "");
      setTycheCookie(c.tyche?.cookie ?? "");
      setDays(String(c.days ?? 30));
    });
    return () => {
      alive = false;
    };
  }, []);

  // R11 16.3：引导横幅「去设置」跳转后，把本区滚动到视野（一次性标记）
  useEffect(() => {
    if (!consumeExtHwScrollRequest()) return;
    const t = setTimeout(() => {
      document.getElementById("settings-exthw")?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 0);
    return () => clearTimeout(t);
  }, []);

  // R11 16.2：自动登录在本区打开后才完成时，把凭据回填到表单（否则状态 ✅ 与「未登录」打架）
  useEffect(() => {
    if (ext.tuojAuto.kind !== "ok") return;
    let alive = true;
    void ensureExtHwCredsLoaded().then((c) => {
      if (!alive) return;
      setTuojCookie(c.tuoj?.cookie ?? "");
      setTuojVia(c.tuoj?.via);
    });
    return () => {
      alive = false;
    };
  }, [ext.tuojAuto.kind]);

  const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

  /** 组装待保存凭据；o.* 传入刚登录拿到的 Cookie（state 尚未刷新时用） */
  const credsWith = (o: { ykt?: string; tuoj?: string; tuojVia?: "cas" | "password"; tyche?: string } = {}): ExtHwCreds => {
    const yk = (o.ykt ?? yktCookie).trim();
    const tj = (o.tuoj ?? tuojCookie).trim();
    const tc = (o.tyche ?? tycheCookie).trim();
    return {
      yuketang: yk ? { cookie: yk, phone: yktPhone.trim() || undefined } : undefined,
      tuoj: tj ? { cookie: tj, username: tuojUser.trim() || undefined, via: o.tuojVia ?? tuojVia } : undefined,
      tyche: tc ? { cookie: tc, username: tycheUser.trim() || undefined } : undefined,
      days: Math.max(1, Number(days) || 30),
    };
  };

  const onSave = () => {
    void saveExtHwCreds(credsWith()).then(() => setMsg("已保存到本机。"));
  };

  const onRefresh = () => {
    setBusy("refresh");
    setMsg(null);
    void saveExtHwCreds(credsWith())
      .then(() => refreshExtHw())
      .then(() => setMsg("刷新完成。"))
      .catch((e: unknown) => setMsg(`刷新失败：${errMsg(e)}`))
      .finally(() => setBusy(null));
  };

  const onYktSend = () => {
    setBusy("ykt-send");
    setMsg(null);
    void extHwLogin
      .yuketangSendSms(yktPhone)
      .then(() => setMsg("验证码已发送，请查收短信（若收不到，可能被风控拦截）。"))
      .catch((e: unknown) => setMsg(`发送验证码失败：${errMsg(e)}`))
      .finally(() => setBusy(null));
  };

  const onYktLogin = () => {
    setBusy("ykt-login");
    setMsg(null);
    void extHwLogin
      .yuketangVerify(yktPhone, yktCode)
      .then(async (r) => {
        setYktCookie(r.cookie);
        setYktCode("");
        await saveExtHwCreds(credsWith({ ykt: r.cookie }));
        setMsg("雨课堂登录成功，已保存。");
        void refreshExtHw();
      })
      .catch((e: unknown) => setMsg(`雨课堂登录失败：${errMsg(e)}`))
      .finally(() => setBusy(null));
  };

  /** TUOJ 主路径：清华统一认证漫游（零凭据） */
  const onTuojCasLogin = () => {
    setBusy("tuoj-cas");
    setMsg(null);
    void extHwLogin
      .tuojCas()
      .then(async (r) => {
        setTuojCookie(r.cookie);
        setTuojVia("cas");
        clearTuojAutoStatus();
        await saveExtHwCreds(credsWith({ tuoj: r.cookie, tuojVia: "cas" }));
        setMsg("TUOJ 已通过清华统一认证登录，已保存。");
        void refreshExtHw();
      })
      .catch((e: unknown) => setMsg(`TUOJ 登录失败：${errMsg(e)}`))
      .finally(() => setBusy(null));
  };

  const onTuojLogin = () => {
    setBusy("tuoj-login");
    setMsg(null);
    void extHwLogin
      .tuoj(tuojUser, tuojPwd)
      .then(async (r) => {
        setTuojCookie(r.cookie);
        setTuojVia("password");
        setTuojPwd("");
        clearTuojAutoStatus();
        await saveExtHwCreds(credsWith({ tuoj: r.cookie, tuojVia: "password" }));
        setMsg("TUOJ 登录成功，已保存。");
        void refreshExtHw();
      })
      .catch((e: unknown) => setMsg(`TUOJ 登录失败：${errMsg(e)}`))
      .finally(() => setBusy(null));
  };

  const onTycheLogin = () => {
    setBusy("tyche-login");
    setMsg(null);
    void extHwLogin
      .tyche(tycheUser, tychePwd)
      .then(async (r) => {
        setTycheCookie(r.cookie);
        setTychePwd("");
        await saveExtHwCreds(credsWith({ tyche: r.cookie }));
        setMsg("Tyche 登录成功，已保存。");
        void refreshExtHw();
      })
      .catch((e: unknown) => setMsg(`Tyche 登录失败：${errMsg(e)}`))
      .finally(() => setBusy(null));
  };

  /** R12 17.2：单源退出登录 —— 确认后只清该源凭据，不影响其他源 */
  const onLogout = (source: ExtHwSourceId) => {
    const label = source === "yuketang" ? "雨课堂" : source === "tuoj" ? "TUOJ" : "Tyche";
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
          } else {
            setTycheCookie("");
            setTychePwd("");
          }
          setMsg(`已退出${label}登录。`);
          void refreshExtHw();
        } catch (e: unknown) {
          setMsg(`退出${label}登录失败：${errMsg(e)}`);
        } finally {
          setBusy(null);
        }
      },
    );
  };

  const yktConfigured = Boolean(yktCookie.trim());
  const tuojConfigured = Boolean(tuojCookie.trim()) || tuojVia === "cas" || ext.tuojAuto.kind === "ok";
  const tycheConfigured = Boolean(tycheCookie.trim());
  const srcRows: Array<{ id: "yuketang" | "tuoj" | "tyche"; label: string; logged: boolean }> = [
    { id: "yuketang", label: "雨课堂", logged: yktConfigured },
    { id: "tuoj", label: "TUOJ", logged: tuojConfigured },
    { id: "tyche", label: "Tyche", logged: tycheConfigured },
  ];
  const taStyle = { width: "100%", minHeight: 64, fontFamily: "var(--mono, monospace)", fontSize: 12 } as const;
  const fieldStyle = { display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" } as const;

  return (
    <div id="settings-exthw">
      <Card>
        <div className="setting-row" style={{ alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="setting-title">外部作业源</div>
          <div className="setting-desc">
            把雨课堂 / TUOJ / Tyche 的作业 DDL 合并到「全部作业」与「今日」。只读拉取（标题 + 课程 +
            截止时间），不提交、不抓题目。用各平台账号登录即可，凭据以 AES-GCM 加盐混淆后存本机
            localStorage。
          </div>

          <div style={{ marginTop: 12, display: "grid", gap: 14 }}>
            {/* 雨课堂：主路径 = 微信 / 雨豆APP 扫码；短信为折叠备选 */}
            <div>
              <div className="setting-title" style={{ fontSize: 13 }}>
                雨课堂 <span className="setting-desc" style={{ display: "inline" }}>（微信 / 雨豆APP 扫码）</span>
              </div>
              <div style={fieldStyle}>
                <button className="btn btn-primary" disabled={busy !== null} onClick={() => setYktQrOpen((v) => !v)}>
                  {yktQrOpen ? "收起扫码登录" : "微信扫码登录"}
                </button>
                <span className="setting-desc" style={{ alignSelf: "center" }}>
                  {yktQrOpen ? "打开微信或雨豆APP 扫描二维码" : yktCookie.trim() ? "已登录" : "未登录"}
                </span>
                {yktConfigured ? (
                  <button
                    className="btn"
                    disabled={busy !== null}
                    onClick={() => onLogout("yuketang")}
                  >
                    {busy === "logout-yuketang" ? "退出中…" : "退出登录"}
                  </button>
                ) : null}
              </div>
              {yktQrOpen ? (
                <YktQrPanel
                  onCancel={() => setYktQrOpen(false)}
                  onSuccess={(cookie) => {
                    setYktCookie(cookie);
                    setYktQrOpen(false);
                    void saveExtHwCreds(credsWith({ ykt: cookie })).then(() => {
                      setMsg("雨课堂扫码登录成功，已保存。");
                      void refreshExtHw();
                    });
                  }}
                />
              ) : null}
              <div>
                <button className="btn btn-ghost" style={{ padding: "2px 0", marginTop: 4 }} onClick={() => setYktSmsOpen((v) => !v)}>
                  {yktSmsOpen ? "▾" : "▸"} 备选：手机号 + 短信验证码
                </button>
                {yktSmsOpen ? (
                  <>
                    <div style={fieldStyle}>
                      <input className="input" style={{ minWidth: 160, flex: 1 }} inputMode="tel" placeholder="手机号" value={yktPhone} onChange={(e) => setYktPhone(e.target.value.trim())} />
                      <button className="btn" disabled={busy !== null || !yktPhone.trim()} onClick={onYktSend}>
                        {busy === "ykt-send" ? "发送中…" : "发送验证码"}
                      </button>
                    </div>
                    <div style={fieldStyle}>
                      <input className="input" style={{ minWidth: 160, flex: 1 }} inputMode="numeric" placeholder="短信验证码" value={yktCode} onChange={(e) => setYktCode(e.target.value.trim())} />
                      <button className="btn btn-primary" disabled={busy !== null || !yktPhone.trim() || !yktCode.trim()} onClick={onYktLogin}>
                        {busy === "ykt-login" ? "登录中…" : "登录"}
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            </div>

            {/* TUOJ：主路径 = 清华统一认证漫游（一键，零凭据）；账号密码为折叠备选 */}
            <div>
              <div className="setting-title" style={{ fontSize: 13 }}>
                TUOJ <span className="setting-desc" style={{ display: "inline" }}>（清华统一认证，一键登录）</span>
              </div>
              <div style={fieldStyle}>
                <button className="btn btn-primary" disabled={busy !== null} onClick={onTuojCasLogin}>
                  {busy === "tuoj-cas" ? "登录中…" : "用清华统一认证登录"}
                </button>
                <span className="setting-desc" style={{ alignSelf: "center" }}>
                  {tuojConfigured
                    ? `已登录${tuojVia === "cas" || ext.tuojAuto.kind === "ok" ? "（统一认证）" : "（账号密码）"}`
                    : "未登录"}
                </span>
                {tuojConfigured ? (
                  <button className="btn" disabled={busy !== null} onClick={() => onLogout("tuoj")}>
                    {busy === "logout-tuoj" ? "退出中…" : "退出登录"}
                  </button>
                ) : null}
              </div>
              {/* R11 16.2：统一认证自动登录结果（成功 ✅ / 无账号提示 / 失败引导手动） */}
              {ext.tuojAuto.kind === "ok" ? (
                <div className="setting-desc" style={{ marginTop: 4 }}>统一认证自动登录 ✅</div>
              ) : ext.tuojAuto.kind === "no-courses" ? (
                <div className="setting-desc" style={{ marginTop: 4 }}>
                  统一认证已通过，但 TUOJ 未返回课程（可能未注册/未选课）。
                </div>
              ) : ext.tuojAuto.kind === "failed" ? (
                <div className="setting-desc" style={{ marginTop: 4 }}>
                  自动登录未成功{ext.tuojAuto.message ? `（${ext.tuojAuto.message.slice(0, 160)}）` : ""}
                  ——可点上方「用清华统一认证登录」手动重试。
                </div>
              ) : null}
              <div>
                <button
                  className="btn btn-ghost"
                  style={{ padding: "2px 0", marginTop: 4 }}
                  onClick={() => setTuojPwdOpen((v) => !v)}
                >
                  {tuojPwdOpen ? "▾" : "▸"} 备选：TUOJ 账号密码登录
                </button>
                {tuojPwdOpen ? (
                  <div style={fieldStyle}>
                    <input className="input" style={{ minWidth: 160, flex: 1 }} placeholder="用户名" value={tuojUser} onChange={(e) => setTuojUser(e.target.value.trim())} />
                    <input className="input" style={{ minWidth: 160, flex: 1 }} type="password" placeholder="密码" value={tuojPwd} onChange={(e) => setTuojPwd(e.target.value)} />
                    <button className="btn" disabled={busy !== null || !tuojUser.trim() || !tuojPwd} onClick={onTuojLogin}>
                      {busy === "tuoj-login" ? "登录中…" : "登录"}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            {/* Tyche：用户名 + 密码 */}
            <div>
              <div className="setting-title" style={{ fontSize: 13 }}>
                Tyche <span className="setting-desc" style={{ display: "inline" }}>（用户名 + 密码；校内或 sslvpn，勿用 webvpn）</span>
              </div>
              <div style={fieldStyle}>
                <input className="input" style={{ minWidth: 160, flex: 1 }} placeholder="用户名" value={tycheUser} onChange={(e) => setTycheUser(e.target.value.trim())} />
                <input className="input" style={{ minWidth: 160, flex: 1 }} type="password" placeholder="密码" value={tychePwd} onChange={(e) => setTychePwd(e.target.value)} />
                <button className="btn btn-primary" disabled={busy !== null || !tycheUser.trim() || !tychePwd} onClick={onTycheLogin}>
                  {busy === "tyche-login" ? "登录中…" : "登录"}
                </button>
                {tycheConfigured ? (
                  <button className="btn" disabled={busy !== null} onClick={() => onLogout("tyche")}>
                    {busy === "logout-tyche" ? "退出中…" : "退出登录"}
                  </button>
                ) : null}
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="setting-title" style={{ fontSize: 13 }}>只保留未来</span>
              <input className="input" style={{ width: 80 }} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/[^0-9]/g, ""))} />
              <span className="setting-desc">天（已过期的仍显示）</span>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn btn-primary" onClick={onSave}>保存</button>
              <button className="btn" disabled={busy !== null || ext.state === "loading"} onClick={onRefresh}>
                {busy === "refresh" || ext.state === "loading" ? "刷新中…" : "立即刷新"}
              </button>
            </div>

            {/* 高级：手动粘贴 Cookie（一般用户用不到） */}
            <div>
              <button className="btn btn-ghost" style={{ padding: "2px 0" }} onClick={() => setAdvanced((v) => !v)}>
                {advanced ? "▾" : "▸"} 高级：手动粘贴 Cookie
              </button>
              {advanced ? (
                <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
                  <textarea className="input" style={taStyle} placeholder="雨课堂 Cookie（sessionid / csrftoken / uv_id …）" value={yktCookie} onChange={(e) => setYktCookie(e.target.value)} />
                  <textarea className="input" style={taStyle} placeholder="TUOJ Cookie（session / session.sig）" value={tuojCookie} onChange={(e) => setTuojCookie(e.target.value)} />
                  <textarea className="input" style={taStyle} placeholder="Tyche Cookie（JSESSIONID / username / uid）" value={tycheCookie} onChange={(e) => setTycheCookie(e.target.value)} />
                  <div className="setting-desc" style={{ marginTop: 0 }}>粘贴后点上方「保存」生效。</div>
                </div>
              ) : null}
            </div>

            <div style={{ display: "grid", gap: 4 }}>
              {srcRows.map(({ id, label, logged }) => {
                const count = ext.items.filter((it) => it.source === id).length;
                const err = ext.errors[id];
                return (
                  <div key={id} style={{ fontSize: 13, color: "var(--text-2)" }}>
                    {label}：{logged ? "已登录" : "未登录"} · {err ? <span style={{ color: "var(--danger, #c04848)" }}>错误 · {err}</span> : `${count} 条`}
                  </div>
                );
              })}
              {msg ? <div style={{ fontSize: 13, color: "var(--text-2)" }}>{msg}</div> : null}
            </div>
          </div>
        </div>
      </div>
      </Card>
    </div>
  );
}

/* ── 版本更新检查（GitHub Releases）── */
function UpdateRow() {
  const [checking, setChecking] = useState(false);
  const [rel, setRel] = useState<ReleaseInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const run = async (): Promise<void> => {
    setChecking(true);
    setFailed(false);
    const r = await fetchLatestRelease();
    setChecking(false);
    if (!r) {
      setFailed(true);
      return;
    }
    setRel(r);
    setDismissed(isDismissed(r.tag));
  };

  const hasNew = rel != null && isNewer(rel.tag, currentVersion());
  return (
    <div className="setting-row">
      <div>
        <div className="setting-title">
          更新检查
          {hasNew ? <span className="update-badge">有新版本</span> : null}
        </div>
        <div className="setting-desc">
          {checking
            ? "正在检查…"
            : rel == null
              ? failed
                ? "检查失败（网络不可达或 GitHub 限流），可稍后重试"
                : "当前版本自动与 GitHub Releases 比对"
              : hasNew
                ? `当前 v${currentVersion()} · 最新 ${rel.name}${dismissed ? "（已忽略此版本的启动提醒）" : ""}`
                : `已是最新版本（v${currentVersion()}）`}
        </div>
      </div>
      {hasNew ? (
        <>
          <button className="btn btn-primary" onClick={() => void openUrl(rel.url)}>
            查看新版本
          </button>
          <button className="btn" onClick={() => { dismissTag(rel.tag); setDismissed(true); }}>
            忽略此版本
          </button>
        </>
      ) : (
        <button className="btn" disabled={checking} onClick={() => void run()}>
          {checking ? "检查中…" : "检查更新"}
        </button>
      )}
    </div>
  );
}


