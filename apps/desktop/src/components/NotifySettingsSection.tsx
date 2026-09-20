/**
 * 设置页「通知」区块：提醒开关、提前量、静默时段、权限状态与「试一下」。
 *
 * 设计口径：
 *   · 一切改动立即落盘并立刻重排（不等用户点保存）——提醒这类东西改了没生效最恼人；
 *   · 权限状态如实展示，不假装可用：macOS 未授权 / Android 精确闹钟被拒时把原因与
 *     去处理的方式写清楚（Android 14 起精确闹钟默认拒绝，这条是常态不是异常）；
 *   · 计划预览给出「即将提醒什么」，让用户能自证调度链真的在工作。
 */
import { useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Switch } from "./Layout.js";
import { loadNotifySettings, saveNotifySettings } from "../state/notifySettings.js";
import { ensureNotifyRuntime } from "../state/notifySources.js";
import type { NotifyPlanItem, NotifySettings } from "../state/notifyPlan.js";

/** 常用提前量（分钟）；0 = 不提醒课程 */
const CLASS_LEADS: Array<[number, string]> = [
  [0, "不提醒"],
  [5, "5 分钟"],
  [10, "10 分钟"],
  [15, "15 分钟"],
  [30, "30 分钟"],
];

/** 早报时刻候选；null = 关闭 */
const BRIEFING_OPTIONS: Array<[string | null, string]> = [
  [null, "关闭"],
  ["07:00", "07:00"],
  ["07:30", "07:30"],
  ["08:00", "08:00"],
  ["12:00", "12:00"],
];

const QUIET_FROM = ["21:00", "22:00", "23:00", "00:00"];
const QUIET_TO = ["06:00", "07:00", "08:00", "09:00"];

function fmtAt(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  const today = new Date();
  const sameDay = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  return `${sameDay ? "今天" : `${d.getMonth() + 1}/${d.getDate()}`} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function NotifySettingsSection(): ReactNode {
  const [s, setS] = useState<NotifySettings>(() => loadNotifySettings());
  const [backend, setBackend] = useState<string>("checking");
  const [perm, setPerm] = useState<{ granted: boolean; exact: boolean } | null>(null);
  const [plan, setPlan] = useState<NotifyPlanItem[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const patch = (p: Partial<NotifySettings>): void => {
    const next = saveNotifySettings(p);
    setS(next);
    // 开启提醒时顺带请求授权（此时用户意图明确，弹框不唐突）
    if (p.enabled === true) void invoke("notify_permission", { request: true }).then(() => refreshStatus()).catch(() => undefined);
    // 改动即重排：关掉总开关时运行时内部会「撤干净」而不是留着旧排程
    void (async () => {
      const rt = await ensureNotifyRuntime();
      const r = await rt.syncNow();
      setPlan(rt.plan());
      setMsg(r.error ? `重排失败：${r.error}` : `已更新（排程 ${r.scheduled} 条 / 撤销 ${r.cancelled} 条）`);
    })();
  };

  const refreshStatus = async (): Promise<void> => {
    try {
      const b = await invoke<string>("notify_backend");
      setBackend(b);
      if (b === "none") return;
      const p = (await invoke<Record<string, unknown>>("notify_permission", { request: false })) as {
        ok?: boolean; granted?: boolean; exact?: boolean;
      };
      setPerm({ granted: p?.granted === true, exact: p?.exact !== false });
    } catch {
      setBackend("none");
    }
  };

  useEffect(() => {
    void refreshStatus();
    void (async () => {
      const rt = await ensureNotifyRuntime();
      await rt.syncNow();
      setPlan(rt.plan());
    })().catch(() => undefined);
  }, []);

  const onTest = async (): Promise<void> => {
    setBusy(true);
    try {
      // 测试即用户主动行为：顺带补一次授权请求（未授权时先弹系统框）
      await invoke("notify_permission", { request: true }).catch(() => undefined);
      const r = (await invoke<Record<string, unknown>>("notify_test")) as { ok?: boolean; reason?: string };
      setMsg(r?.ok ? "已发出测试通知——看到了就说明这条链通了" : `测试失败：${r?.reason ?? "未知原因"}`);
      void refreshStatus();
    } catch (e) {
      setMsg(`测试失败：${String(e).slice(0, 80)}`);
    } finally {
      setBusy(false);
    }
  };

  const backendLabel: Record<string, string> = {
    android: "Android（通知渠道 + 定时闹钟）",
    macos: "macOS（系统通知中心）",
    windows: "Windows（系统通知）",
    none: "本平台暂未接入",
    checking: "检测中…",
  };

  return (
    <>
      <div className="setting-row">
        <div>
          <div className="setting-title">提醒</div>
          <div className="setting-desc">
            把日程上的事推到系统通知：课程与考试开课前、作业 DDL 到期前，另有每日早报。
            投递走后端：{backendLabel[backend] ?? backend}。
          </div>
        </div>
        <Switch on={s.enabled} onChange={(v) => patch({ enabled: v })} label="提醒总开关" />
      </div>

      <div className="setting-row">
        <div>
          <div className="setting-title">课程与考试提前量</div>
          <div className="setting-desc">按课表与考试安排提前提醒；静默时段内的提醒会顺延到时段结束。</div>
        </div>
        <select
          className="input"
          style={{ width: 140 }}
          value={s.classLead}
          onChange={(e) => patch({ classLead: Number(e.target.value) })}
        >
          {CLASS_LEADS.map(([v, label]) => (
            <option key={v} value={v}>{label}</option>
          ))}
        </select>
      </div>

      <div className="setting-row">
        <div>
          <div className="setting-title">作业 DDL 提醒</div>
          <div className="setting-desc">
            提前量沿用网络学堂首页「DDL 提醒」的设置（全局默认 + 单作业覆盖）；
            截止时刻落在静默时段且已来不及顺延时，改在静默开始前发出——不会因为静默把提醒吞掉。
          </div>
        </div>
        <Switch on={s.ddl} onChange={(v) => patch({ ddl: v })} label="作业 DDL 提醒" />
      </div>

      <div className="setting-row">
        <div>
          <div className="setting-title">每日早报</div>
          <div className="setting-desc">当天有课或有截止时才发；空日不打扰。</div>
        </div>
        <select
          className="input"
          style={{ width: 140 }}
          value={s.briefingAt ?? ""}
          onChange={(e) => patch({ briefingAt: e.target.value === "" ? null : e.target.value })}
        >
          {BRIEFING_OPTIONS.map(([v, label]) => (
            <option key={label} value={v ?? ""}>{label}</option>
          ))}
        </select>
      </div>

      <div className="setting-row">
        <div>
          <div className="setting-title">静默时段</div>
          <div className="setting-desc">这段时间内不打扰（跨夜为常态）；落在其中的提醒顺延到时段结束。</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <select className="input" style={{ width: 96 }} value={s.quietFrom} onChange={(e) => patch({ quietFrom: e.target.value })}>
            {QUIET_FROM.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <span style={{ color: "var(--text-3)" }}>—</span>
          <select className="input" style={{ width: 96 }} value={s.quietTo} onChange={(e) => patch({ quietTo: e.target.value })}>
            {QUIET_TO.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
      </div>

      <div className="setting-row">
        <div>
          <div className="setting-title">权限状态</div>
          <div className="setting-desc">
            {perm === null
              ? "检测中…"
              : perm.granted
                ? backend === "android" && !perm.exact
                  ? "通知已授权；精确提醒未授权——系统会允许少量延迟（不影响送达）。可在系统设置的「闹钟与提醒」里允许精确提醒。"
                  : "通知已授权。"
                : "通知未授权：提醒发不出来。请在系统设置里为本应用打开通知权限。"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" disabled={busy || backend === "none"} onClick={() => void onTest()}>
            试一下
          </button>
          <button className="btn btn-ghost" onClick={() => void refreshStatus()}>
            重新检测
          </button>
        </div>
      </div>

      <div className="setting-row">
        <div>
          <div className="setting-title">即将提醒</div>
          <div className="setting-desc">
            {!s.enabled
              ? "总开关已关闭（不会发出任何提醒）。"
              : plan.length === 0
                ? "未来几天没有需要提醒的事项。"
                : plan.slice(0, 3).map((it) => `${fmtAt(it.at)} ${it.title}`).join("；") +
                  (plan.length > 3 ? ` …共 ${plan.length} 条` : "")}
          </div>
        </div>
        <button
          className="btn btn-ghost"
          onClick={() => {
            void (async () => {
              const rt = await ensureNotifyRuntime();
              const r = await rt.syncNow();
              setPlan(rt.plan());
              setMsg(r.error ? `重排失败：${r.error}` : `已重排（排程 ${r.scheduled} 条 / 撤销 ${r.cancelled} 条）`);
            })();
          }}
        >
          立即应用
        </button>
      </div>

      {msg ? (
        <div style={{ fontSize: "var(--text-sm)", color: "var(--text-3)", padding: "6px 2px" }}>{msg}</div>
      ) : null}
    </>
  );
}
