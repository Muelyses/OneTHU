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
import { defineSearchRows } from "../state/searchRows.js";
import { useEffect, useState, type ReactNode } from "react";
import { useApp } from "../state/context.js";
import { goEntry, slugOf } from "./Layout.js";
import { requestPluginsFocus } from "../state/pluginsFocus.js";
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

/* ── task-19：本页**独有**的设置行注册（模块加载时执行，不依赖 DOM/是否可见）。
   注意：语音/悬浮球/IM 的行由**它们各自的 section 组件**注册（单一真源），这里不再重复注册
   —— 重复���册会让"搜到的是哪一条"出现歧义（护栏最初就是被这一点抓红的）。 ── */
defineSearchRows([
  { id: "oh-madmodel", tab: "OneTHU Harness", section: "免费额度", title: "MadModel 免费档", aliases: ["免费额度", "额度", "重新签", "token"], desc: "额度不足或过期时点重新签一次" , breadcrumb: ["插件", "OneTHU Harness", "基础设置", "免费额度", "MadModel 免费档"], displayRoot: "设置", go: () => goOhRow("MadModel 免费档", "basic") },
  { id: "oh-multimodal", tab: "OneTHU Harness", section: "模型与多模态", title: "OH 模型 / 多模态开关", aliases: ["多模态", "图片输入", "模型", "provider", "apiKey", "baseUrl", "maxContext", "stream"], desc: "模型来源、Key、模型名与多模态（图片输入）" , breadcrumb: ["插件", "OneTHU Harness", "基础设置", "模型与多模态", "OH 模型 / 多模态开关"], displayRoot: "设置", go: () => goOhRow("OH 模型 / 多模态开关", "basic") },
  { id: "oh-contextmode", tab: "OneTHU Harness", section: "模型与多模态", title: "上下文记忆模式", aliases: ["上下文", "记忆", "压缩", "历史", "要点", "压缩内容制"], desc: "历史超长自动收成要点清单，重要内容不再丢" , breadcrumb: ["插件", "OneTHU Harness", "基础设置", "模型与多模态", "上下文记忆模式"], displayRoot: "设置", go: () => goOhRow("上下文记忆模式", "basic") },
  { id: "oh-keepalive", tab: "OneTHU Harness", section: "保活", title: "后台保活（华为 / 荣耀）", aliases: ["保活", "自启动", "电池优化", "后台"], desc: "应用启动管理设手动管理并允许自启动/关联启动/后台活动" , breadcrumb: ["插件", "OneTHU Harness", "基础设置", "保活", "后台保活（华为 / 荣耀）"], displayRoot: "设置", go: () => goOhRow("后台保活（华为 / 荣耀）", "basic") },
  { id: "oh-adv-plugins", tab: "OneTHU Harness", section: "模型 / MCP / 日志", title: "模型 / 配额预算 / MCP / 命令与日志 / 权限", aliases: ["MCP", "配额", "预算", "日志", "权限", "命令"], desc: "插件自己的面板，就地渲染" , breadcrumb: ["插件", "OneTHU Harness", "高级配置", "模型 / MCP / 日志", "模型 / 配额预算 / MCP / 命令与日志 / 权限"], displayRoot: "设置", go: () => { requestOhTier("advanced"); requestPluginsFocus({ target: "sec-模型MCP日志", fallbackTarget: "oh-tier-advanced", waitMs: 1400 }); } },
]);

/* task-22：OH 行级直达的**本地快捷**（三段式的 ②+③）：切档 + 滚到行（找不到行时落档位根）。+
   语音/悬浮球/IM 的行注册也走它（单一实现，避免四处手写切档请求）。 */
export function goOhRow(title: string, tier: OhTier, note?: string): void {
  requestOhTier(tier);
  requestPluginsFocus({ target: "row-" + slugOf(title), fallbackTarget: `oh-tier-${tier}`, note });
}

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

/* 2026-10-11 用户要求「彻查，给个状态机」：OH 子页的入口态统一由
   components/Layout.tsx 的 goEntry()/useEntry() 管理——这里**不再有任何入口旗标或订阅**。 */

/** 档位切换条（分段控件，与设置页页签同形态但更轻） */
function TierSwitch({ tier, onChange }: { tier: "basic" | "advanced"; onChange: (t: "basic" | "advanced") => void }): ReactNode {
  const item = (id: "basic" | "advanced", label: string): ReactNode => (
    <button
      className={"nav-item" + (tier === id ? " is-active" : "")}
      role="tab"
      aria-selected={tier === id}
      /* task-22：档位根锚点——检索直达「找不到行」时落这里再解释（分节根口径） */
      data-set-id={`oh-tier-${id}`}
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
function SubHead({ children, id }: { children: ReactNode; id?: string }): ReactNode {
  return (
    /* ② 与 .setting-row 同一左内边距（16px）与层级——用户截图里「悬浮球」标题顶在最左边。
       id（task-22 检索直达）：显式锚点 data-set-id，供 goSearchRow 的离家行 / 无行控件落地。 */
    <div className="setting-title" data-set-id={id} style={{ margin: "4px 0 8px", padding: "0 16px", fontWeight: 600 }}>
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
 * 高级档里**预留给插件设置表单**的位置（task-17 抽出 `pages/Plugins.tsx` 的 settings sheet）。
 *
 * 现在 task-17 已落地：`pages/Plugins.tsx` 组装 advancedPanels 传入（SettingsBody + MCP + 日志），
 * 这个回落分支只在没传时兜底——文案对齐 2026-10-11 的信息架构（插件子页就地配置）。
 */
function OhAdvancedSlot(): ReactNode {
  const { navigate } = useApp();
  return (
    <div className="setting-row">
      <div>
        <div className="setting-title">OH 模型配置 / 花费上限</div>
        <div className="setting-desc">
          模型 / 花费上限 / MCP / 日志在插件子页就地配置——插件页 → OneTHU Harness → 高级配置。
        </div>
      </div>
      <button className="btn" onClick={() => goEntry("plugins")}>
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
                模型来源、自费 Key、模型名与「多模态（图片输入）」在插件的
                设置面板里就地配置——插件页 → OneTHU Harness → 高级配置。
              </div>
            </div>
            <button className="btn" onClick={() => goEntry("plugins")}>
              打开插件设置
            </button>
          </div>

          {/* 2026-10-13 压缩内容制（fa54a9c）：给一行机制说明——历史超长不再裸丢。
              这行只是说明，没有可切换项（机制永远开启；预算大小在插件设置里调）。 */}
          <div className="setting-row">
            <div>
              <div className="setting-title">上下文记忆模式</div>
              <div className="setting-desc">
                历史超长自动收成要点清单，重要内容不再丢
              </div>
            </div>
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

          <SubHead id="sec-模型MCP日志">模型 / MCP / 日志（插件自己的面板，就地渲染）</SubHead>
          {advancedPanels ?? <OhAdvancedSlot />}
        </>
      )}
    </>
  );
}
