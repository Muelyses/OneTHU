/**
 * 插件页 / OH 子页的「检索直达」请求通道（2026-10-12 检索收尾）。
 *
 * 对应设置页的 requestSettingsSection：**外部（命令面板 / 底栏检索 / OH 的 nav.searchRow）
 * 只写请求，不碰 DOM**；页面本体（PluginsPage）挂载或已挂载时消费：
 *   ① 重试拿锚点（等视图切换 / install 面板 / OH 档位这几次 re-render 落定）；
 *   ② scrollIntoView({ block: "center" }) + .row-focus 短暂高亮（复用设置行那套 token）；
 *   ③ 找不到目标 → 落 **fallbackTarget**（分节根 / 档位根），仍失败且有 note → toast 一句解释。
 * 红线：不许静默把分节头当命中——找不到就明说，note 由调用方/本通道转述。
 */
export interface PluginsFocusSpec {
  /** 主锚点：`[data-set-id="<target>"]`（与 Layout.slugOf 同一套 id 口径） */
  target?: string;
  /**
   * 主锚点不存在时的退路锚点：**只写裸 slug，解析器自己会补前缀**。
   * ⚠️ 2026-10-15 血案（7 处结构性腐坏）：`focusSettingsTarget` 内部按
   * `row-<slug>` / `sec-<slug>` 拼 `[data-set-id]`，调用方若自带 "sec-"/"row-"
   * 就会拼成 `sec-sec-…` / `row-oh-tier-…` —— **永不命中、且不报错**（用户侧=点了没反应）。
   * 正确写法是裸 slug：`fallbackTarget: "我的插件"` / `"高级配置"`（档位按钮的 data-set-id
   * 就是裸 `oh-tier-advanced` 或字面量 `row-高级配置`，见 TierSwitch）。
   * 已有静态护栏扫全仓 target/fallbackTarget/root 字面量，自带前缀即红
   * （tools/board-nav-bridge-test.mjs 第 ⑨ 组）。
   */
  fallbackTarget?: string;
  /** 目标整段找不到时给用户的一句话解释 */
  note?: string;
  /** 锚点可能随视图切换才出现：总尝试时长（默认 2.2s，重试间隔 180ms） */
  waitMs?: number;
}

let pendingFocus: PluginsFocusSpec | null = null;
const focusListeners = new Set<() => void>();

export function requestPluginsFocus(spec: PluginsFocusSpec): void {
  pendingFocus = { ...(pendingFocus ?? {}), ...spec };
  for (const f of focusListeners) f();
}

export function takePluginsFocus(): PluginsFocusSpec | null {
  const s = pendingFocus;
  pendingFocus = null;
  return s;
}

export function subscribePluginsFocus(f: () => void): () => void {
  focusListeners.add(f);
  return () => {
    focusListeners.delete(f);
  };
}
