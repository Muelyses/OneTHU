/**
 * OH 独立页（设置 →「OH」页签）：**普通配置 / 高级配置** 两档。
 *
 * 2026-10-11 设置重构（用户拍板）：
 *  - 「高级模式」分层整体退役 → 分档改为**页面自己分**：日常项进普通档，进阶项进高级档；
 *  - 语音合成（音色/语调/语速）与悬浮球开关**从设置页搬到这里**（普通档）；
 *  - IM 通道从设置页搬到这里（完整配置进高级档）；
 *  - OH 自己的模型配置（provider/apiKey/baseUrl/model/thinking/multimodal/预算）由**插件清单**
 *    驱动，渲染在插件页的设置面板里（`pages/Plugins.tsx` 的 settings sheet）——那是 task-17 的域，
 *    这里只给一行状态与跳转入口，不重复实现表单（避免两份真相）。
 *
 * 只做信息架构与入口，不改任何功能语义。
 */
import { useEffect, useState, type ReactNode } from "react";
import { useApp } from "../state/context.js";
import { VoiceSettingsSection } from "./VoiceSettingsSection.js";
import { OverlaySettingsSection } from "./OverlaySettingsSection.js";
import { ImSettingsSection } from "./ImSettingsSection.js";
import { isAndroidNavigator } from "../lib/androidHost.js";
import { forceRemint, preflightMadModel } from "../state/madmodel.js";

const isAndroid = isAndroidNavigator(typeof navigator !== "undefined" ? navigator : undefined);

/* ── 页面外的「档位请求」：对话坞的朗读设置深链要停在普通档 ──
   设置页里的 OH 分节是**常驻挂载**的（页签只靠 display 收放），所以不能用"挂载时取一次"，
   必须做成可订阅的小 store：请求到达 → 通知已挂载的实例 → 取走并切档。 */
export type OhTier = "basic" | "advanced";
let pendingTier: OhTier | null = null;
const tierListeners = new Set<() => void>();

/** 请求 OH 页切到某一档（配合 settingsMode 的 requestSettingsTab("OH") 一起用） */
export function requestOhTier(t: OhTier): void {
  pendingTier = t;
  for (const f of tierListeners) f();
}
function subscribeOhTier(f: () => void): () => void {
  tierListeners.add(f);
  return () => {
    tierListeners.delete(f);
  };
}
function takeTier(): OhTier | null {
  const t = pendingTier;
  pendingTier = null;
  return t;
}

/* ── 「打开 OH 设置」请求：OH 现在是**插件页的二级子页面**（2026-10-11 用户纠正），
   插件页与对话面板的深链都先写这个旗标，再 navigate("plugins")。 ── */
let pendingEntry = false;
/** 粘性愿望位：**点过**第三格就置位，只有用户自己点「插件」格才清——避免"旗标被消费过一次就再也进不去" */
let ohEntryWanted = false;
const entryListeners = new Set<() => void>();

export function ohEntryWantedNow(): boolean {
  return ohEntryWanted;
}

export function clearOhEntryWanted(): void {
  ohEntryWanted = false;
}

/** 请求打开插件页里的 OH 设置子页（tier 可选：直接进基础/高级档） */
export function requestOhEntry(tier?: OhTier): void {
  pendingEntry = true;
  ohEntryWanted = true;
  if (tier) pendingTier = tier;
  for (const f of entryListeners) f();
}

/** 插件页订阅它：旗标落下 → 切到 OH 子页并消费掉 */
export function subscribeOhEntry(f: () => void): () => void {
  entryListeners.add(f);
  return () => {
    entryListeners.delete(f);
  };
}

export function consumeOhEntry(): boolean {
  const v = pendingEntry;
  pendingEntry = false;
  return v;
}

/** 档位切换条（分段控件，与设置页页签同形态但更轻） */
function TierSwitch({ tier, onChange }: { tier: "basic" | "advanced"; onChange: (t: "basic" | "advanced") => void }): ReactNode {
  const item = (id: "basic" | "advanced", label: string): ReactNode => (
    <button
      className={"nav-item" + (tier === id ? " is-active" : "")}
      role="tab"
      aria-selected={tier === id}
      style={{ flex: 1, justifyContent: "center" }}
      onClick={() => onChange(id)}
    >
      {label}
    </button>
  );
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 4, padding: 4, marginBottom: 12,
        border: "1px solid var(--border)", borderRadius: "var(--md-sys-shape-corner-large, 12px)",
        background: "var(--md-sys-color-surface-container-lowest)",
      }}
      role="tablist"
      aria-label="OH 配置档位"
    >
      {item("basic", "基础设置")}
      {item("advanced", "高级配置")}
    </div>
  );
}

/** 小节标题：**刻意不用 SectionHead**——设置页的页签显隐是按 `.section-head` 走的，
 *  这里再塞一个会被当成新分节被显隐逻辑收走。 */
function SubHead({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="setting-title" style={{ marginTop: 4, marginBottom: 8, fontWeight: 600 }}>
      {children}
    </div>
  );
}

/** MadModel 免费档：状态 + 一键重新签（token 逻辑全在 state/madmodel.ts，这里只调用） */
function MadModelRow(): ReactNode {
  const [warn, setWarn] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    let alive = true;
    void preflightMadModel().then((w) => {
      if (alive) setWarn(w);
    });
    return () => {
      alive = false;
    };
  }, [done]);
  return (
    <div className="setting-row">
      <div>
        <div className="setting-title">MadModel 免费档</div>
        <div className="setting-desc">
          {busy ? "正在重新签…" : warn ? warn : "免费额度可用；额度不足或过期时点右侧重新签一次。"}
        </div>
      </div>
      <button
        className="btn"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void forceRemint()
            .catch(() => undefined)
            .finally(() => {
              setBusy(false);
              setDone((v) => !v);
            });
        }}
      >
        重新签
      </button>
    </div>
  );
}

/**
 * 高级档里**预留给插件设置表单**的位置（task-17 会把 `pages/Plugins.tsx` 的 settings sheet
 * 抽成可复用组件，例如 `components/PluginSettingsForm.tsx` / `PluginSettingsSheet.tsx`）。
 *
 * 接法（task-17 抽出后，这里只改一处）：
 *   `<PluginSettingsForm id="onethu.harness" />`   // 渲染 OH 的 provider/apiKey/baseUrl/model/
 *                                                  // thinking/maxContext/stream + multimodal + 预算
 * 在那之前保留「打开插件设置」按钮，功能不缺口。
 */
function OhAdvancedSlot(): ReactNode {
  const { navigate } = useApp();
  return (
    <div className="setting-row">
      <div>
        <div className="setting-title">OH 模型配置 / 预算</div>
        <div className="setting-desc">
          待接插件设置表单（task-17 抽出 PluginSettingsForm 后挂到这里）；当前从插件页的 OH 卡片「设置」进入。
        </div>
      </div>
      <button className="btn" onClick={() => navigate("plugins")}>
        打开插件设置
      </button>
    </div>
  );
}

/** 保活指引（华为 / 荣耀）：文案 + 跳系统应用设置（安卓才显示按钮，桌面只留说明） */
function KeepAliveRow(): ReactNode {
  const [jumped, setJumped] = useState(false);
  return (
    <div className="setting-row">
      <div>
        <div className="setting-title">后台保活（华为 / 荣耀）</div>
        <div className="setting-desc">
          系统设置 → 应用 → 应用启动管理 → OneTHU 设「手动管理」，并允许自启动、关联启动、后台活动；
          再把 OneTHU 加入电池优化白名单。设置完悬浮球与语音在后台才不会被系统掐掉。
          {jumped ? "（已跳转系统应用设置页）" : ""}
        </div>
      </div>
      {isAndroid ? (
        <button
          className="btn"
          onClick={() => {
            void import("@tauri-apps/api/core")
              .then((m) => m.invoke("open_app_settings"))
              .catch(() => undefined);
            setJumped(true);
          }}
        >
          打开系统设置
        </button>
      ) : null}
    </div>
  );
}

export function OhSettingsPage({ advancedPanels }: { advancedPanels?: ReactNode } = {}): ReactNode {
  const { navigate } = useApp();
  const [tier, setTier] = useState<"basic" | "advanced">("basic");

  // 页面外请求切档（如对话坞长按朗读图标 → 插件页 → OH → 基础设置）
  useEffect(() => subscribeOhTier(() => {
    const want = takeTier();
    if (want) setTier(want);
  }), []);

  return (
    <>
      <TierSwitch tier={tier} onChange={setTier} />

      {tier === "basic" ? (
        <>
          <SubHead>语音</SubHead>
          <VoiceSettingsSection />

          <SubHead>悬浮球</SubHead>
          <OverlaySettingsSection />

          <SubHead>免费额度</SubHead>
          <MadModelRow />

          <SubHead>模型与多模态</SubHead>
          <div className="setting-row">
            <div>
              <div className="setting-title">OH 模型 / 多模态开关</div>
              <div className="setting-desc">
                模型来源、Key、模型名与「多模态（图片输入）」都在插件自己的设置面板里——
                打开插件页，在 OH 卡片上点「设置」。
              </div>
            </div>
            <button className="btn" onClick={() => navigate("plugins")}>
              打开插件设置
            </button>
          </div>

          <SubHead>IM 基础（扫码绑定 / 解绑）</SubHead>
          {/* 同一份 ImSettingsSection 的 basic 档：扫码创建应用 + 绑定主人（生成码/解绑）+ 连接状态 */}
          <ImSettingsSection tier="basic" />

          <SubHead>保活</SubHead>
          <KeepAliveRow />
        </>
      ) : (
        <>
          <SubHead>IM 通道（进阶）</SubHead>
          {/* 同一份实现的 advanced 档：通道开关、手工凭据、微信灰置说明 */}
          <ImSettingsSection tier="advanced" />

          <SubHead>模型 / MCP / 日志（插件自己的面板，就地渲染）</SubHead>
          {advancedPanels ?? <OhAdvancedSlot />}
        </>
      )}
    </>
  );
}
