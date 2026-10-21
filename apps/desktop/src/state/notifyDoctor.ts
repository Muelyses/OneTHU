import { t as i18n } from "../i18n/index.js";
/**
 * 通知与小组件自检（编排可测，副作用全部注入）。
 *
 * 存在的理由很实际：这套链路横跨 JS 调度、原生桥、系统权限、系统设置四层，
 * 出问题时用户只能描述「没收到」，而排查需要知道「卡在哪一层」。这个自检把每一层
 * 单独探一遍并给出结论，用户点一下就能把结果贴回来——把「真机验证」从一轮对话
 * 压缩成一次截图。
 *
 * 顺序刻意如此：先探不需要用户操作的前提（后端、授权），再做会真正弹出通知的投递
 * 测试；未授权时立即停止并只讲「先授权」，不拿一串注定失败的结果淹没用户。
 */
import type { NativeNotifyStatus } from "./notifyBridge.js";
import type { NativeWidgetStatus } from "./widgetBridge.js";

export interface DoctorStep {
  id: string;
  label: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

export interface DoctorReport {
  ok: boolean;
  steps: DoctorStep[];
  /** 一句话结论（含通过/警告/失败计数） */
  summary: string;
}

export interface NotifyDoctorDeps {
  status: (request: boolean) => Promise<NativeNotifyStatus>;
  scheduleProbe: (probe: { id: string; at: number; title: string; body: string }) => Promise<{ ok: boolean; reason?: string }>;
  pending: () => Promise<string[]>;
  cancel: (ids: string[]) => Promise<void>;
  testSend: () => Promise<boolean>;
  /** 桌面端没有小组件：注入方返回 null 时跳过该步 */
  widgetStatus?: () => Promise<NativeWidgetStatus | null>;
  now?: () => number;
}

/** 探针 id：既不是插件 id 空间（plugin:），也不与宿主计划 id 撞（<kind>:<key>:<offset>） */
export const DOCTOR_PROBE_ID = "doctor:probe";
/** 探针时刻：给足余量，确保写进去时不会因为「已过时刻」被原生拒绝 */
const PROBE_LEAD_MS = 120_000;

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export async function runNotifyDoctor(deps: NotifyDoctorDeps): Promise<DoctorReport> {
  const now = (deps.now ?? Date.now)();
  const steps: DoctorStep[] = [];
  const push = (id: string, label: string, status: DoctorStep["status"], detail: string): void => {
    steps.push({ id, label, status, detail });
  };
  const finish = (): DoctorReport => {
    const failed = steps.filter((s) => s.status === "fail").length;
    const warned = steps.filter((s) => s.status === "warn").length;
    const ok = failed === 0;
    const summary = ok
      ? i18n("state.notifydoctor.c273c2086a0d", { length: String(steps.length), value: String(warned ? i18n("state.notifydoctor.6726f815e5dd", { warned: String(warned) }) : "") })
      : i18n("state.notifydoctor.7941c9adf8cc", { failed: String(failed), value: String(warned ? i18n("state.notifydoctor.91e36d30a350", { warned: String(warned) }) : "") });
    return { ok, steps, summary };
  };

  /* ① 平台后端 */
  const st = await deps.status(false);
  if (!st.backend || st.backend === "none") {
    push("backend", i18n("state.notifydoctor.3712f8280c0c"), "fail", i18n("state.notifydoctor.42ab62b890f5"));
    return finish();
  }
  push("backend", i18n("state.notifydoctor.3712f8280c0c"), "ok", st.backend);

  /* ② 授权 */
  if (!st.granted) {
    push("permission", i18n("state.notifydoctor.6dfd9883ec6d"), "fail", i18n("state.notifydoctor.d9540c4fcc17"));
    return finish();
  }
  push("permission", i18n("state.notifydoctor.6dfd9883ec6d"), "ok", i18n("state.notifydoctor.521e65ffc7d0"));

  /* ③ 精确提醒（仅 Android 有此概念） */
  if (st.backend === "android") {
    push(
      "exact",
      i18n("state.notifydoctor.89f5f5eed848"),
      st.exact ? "ok" : "warn",
      st.exact ? i18n("state.notifydoctor.cafc3774b86b") : i18n("state.notifydoctor.c8b5af17e6d2"),
    );
  }

  /* ④ 小组件快照与落地（仅 Android；桌面端注入方返回 null 即跳过） */
  if (deps.widgetStatus) {
    const ws = await deps.widgetStatus().catch(() => null);
    if (ws) {
      const placed = ws.hostPlaced + Object.values(ws.slotsPlaced).reduce((a, b) => a + b, 0);
      const slotInfo = Object.entries(ws.slotsPlaced)
        .map(([k, v]) => i18n("state.notifydoctor.60d7f4ea2680", { k: String(k), v: String(v) }))
        .join(" ");
      const titles = Object.entries(ws.slotTitles).map(([k, t]) => i18n("state.notifydoctor.5e0a3ee20f6b", { k: String(k), t: String(t) })).join("；");
      const providerInfo =
        ws.providersRegistered.length === 0
          ? i18n("state.notifydoctor.f8cd5feb5360")
          : i18n("state.notifydoctor.76e3238d6fee", { length: String(ws.providersRegistered.length), value: String(ws.providersRegistered.join("、")) });
      const widgetStatus: DoctorStep["status"] = ws.providersRegistered.length === 0 ? "fail" : ws.hasSnapshot ? "ok" : "warn";
      push(
        "widget",
        i18n("state.notifydoctor.e8898c88f026"),
        widgetStatus,
        [
          providerInfo,
          ws.hasSnapshot ? i18n("state.notifydoctor.f1e21a111247", { value: String(fmtTime(ws.snapshotAt)) }) : i18n("state.notifydoctor.0b1efad5cf18"),
          placed > 0 ? i18n("state.notifydoctor.962a6e0b8f61", { placed: String(placed), hostPlaced: String(ws.hostPlaced), slotInfo: String(slotInfo) }) : i18n("state.notifydoctor.f088b81ae9c7"),
          titles || i18n("state.notifydoctor.a7320eda2464"),
        ].join("；"),
      );
    }
  }

  /* ⑤ 排程写入 + 回读（证明原生真的收下了） */
  let probeScheduled = false;
  try {
    const r = await deps.scheduleProbe({
      id: DOCTOR_PROBE_ID,
      at: now + PROBE_LEAD_MS,
      title: i18n("state.notifydoctor.3d485e1438c5"),
      body: "这条是自检写入的探针，稍后会被撤销。",
    });
    probeScheduled = r.ok;
    if (!r.ok) {
      push("schedule", i18n("state.notifydoctor.34fa93f1c10b"), "fail", i18n("state.notifydoctor.18be67a09527", { value: String(r.reason ?? i18n("state.notifydoctor.a1a9da9ee6ed")) }));
    } else {
      const ids = await deps.pending().catch(() => [] as string[]);
      const seen = ids.includes(DOCTOR_PROBE_ID);
      push(
        "schedule",
        i18n("state.notifydoctor.34fa93f1c10b"),
        seen ? "ok" : "warn",
        seen ? i18n("state.notifydoctor.09acfa2e9fc5") : i18n("state.notifydoctor.3644e9a2e134"),
      );
    }
  } catch (e) {
    push("schedule", i18n("state.notifydoctor.34fa93f1c10b"), "fail", i18n("state.notifydoctor.b28333fd00e3", { value: String(String(e).slice(0, 100)) }));
  } finally {
    // 无论成败都撤掉探针，不给用户留垃圾通知
    await deps.cancel([DOCTOR_PROBE_ID]).catch(() => undefined);
    push("cleanup", i18n("state.notifydoctor.b1a8b45ace8b"), "ok", probeScheduled ? i18n("state.notifydoctor.ad16c86b6da1") : i18n("state.notifydoctor.0c9fc2c91156"));
  }

  /* ⑥ 真实投递（会弹一条通知，放最后） */
  const sent = await deps.testSend().catch(() => false);
  push("deliver", i18n("state.notifydoctor.a14a16f450ae"), sent ? "ok" : "fail", sent ? i18n("state.notifydoctor.58f371818c4f") : i18n("state.notifydoctor.3edfd112e604"));

  return finish();
}
