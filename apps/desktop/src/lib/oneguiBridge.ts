/**
 * OneGUI 过渡桥（TEMP，换血完成后删除）：把应用**已有的**设置通道接到 OneGUI 的轴上。
 *
 * 现在应用里有两套"开关"在各自驱动外观：
 *   · 旧的：state/theme.ts 写 html[data-scheme] 与主题注入；lib/glassLevel.ts 写 html[data-glass]
 *   · 新的：OneGUI 管线写 html[data-og-*]
 * 不接线的话，用户选了「深色 + 玻璃」，OneGUI 侧仍是「跟随系统 + 中性」，页面就一半新一半旧。
 *
 * 这里只做一件事：**跟随旧通道**（谁改了我跟着改），不反向写回 —— 设置页把开关写进旧通道，
 * 旧通道变化 → 这里同步到 OneGUI。等页面迁完，旧通道连同本文件一起删。
 */
import { og } from "@onethu/gui";

/** 旧玻璃档位名 → OneGUI 皮肤档位（旧 balanced = 新 base） */
const GLASS_LEVEL: Record<string, string> = {
  clear: "clear",
  balanced: "base",
  base: "base",
  rich: "rich",
  deep: "deep",
};

function schemeOf(root: HTMLElement): "light" | "dark" {
  return root.dataset.scheme === "dark" ? "dark" : "light";
}

/* User themes provide an accent; primary actions and surfaces stay in OneGUI.
 * Read installed themes directly, and dynamic colors from the existing producer.
 * The default palette is scheme-aware CSS and must clear the previous theme. */
let lastAccent = "";
/** 当前主题的强调色（主题定义直取；模块未加载时回落空串） */
let themeAccentRaw = "";
let themeAccentOf = (): string => themeAccentRaw;
void import("../state/theme.js").then((m) => {
  themeAccentOf = () => m.activeThemeAccent();
  syncAccent(); // 模块到位后立刻重采一次
});

function syncAccent(): void {
  const root = document.documentElement;
  const themeId = root.dataset.theme ?? "";
  const dynamicOn = root.dataset.dynamic === "on";
  /* 采样三态（判等防环）——默认外观由 OneGUI 语义层提供，
     本桥把 md-secondary 指回了 --og-accent-quiet，残采样=自吸（默认紫当初就是这一步烧进去的）。
     - 动态取色：html:root[data-dynamic=on] (0,2,1) 压过本桥 (0,1,1)，System secondary=调色板真值；
     - 主题：:root[data-theme] (0,2,0) 同压，--accent=主题强调色；
     - 象牙/空：跳过喂食。 */
  let id: string;
  let accent: string;
  if (dynamicOn) {
    accent = getComputedStyle(root).getPropertyValue("--md-sys-color-secondary").trim();
    id = "dynamic";
  } else if (themeId && themeId !== "onethu.theme.ivory") {
    /* 从主题定义直取（不经 DOM）：桥把 --accent / --md-sys-color-secondary 都重指成
       var(--og-accent…) 且特异度更高（0,2,1 > 0,2,0），读变量＝读自己的输出 → 永远默认蓝。 */
    accent = themeAccentOf();
    if (!accent) accent = getComputedStyle(root).getPropertyValue("--accent").trim();
    id = themeId;
  } else {
    // Returning to default must clear the previous theme's runtime overrides.
    lastAccent = "";
    og.set({ theme: null }, { persist: false });
    return;
  }
  if (!accent || `${id}:${accent}` === lastAccent) return;
  lastAccent = `${id}:${accent}`;
  og.set({ theme: { id, accent } }, { persist: false });
  /* 留痕：这条一旦出现，说明主题色确实喂进了 OneGUI 管线（用户看不清时靠它判） */
  void import("@tauri-apps/api/core")
    .then((m) => m.invoke("log_debug", { line: new Date().toISOString() + " | [THEME] 喂给 OneGUI id=" + id + " accent=" + accent }))
    .catch(() => undefined);
}

function syncFromLegacy(): void {
  const root = document.documentElement;
  const glass = root.dataset.glass;
  const patch: Parameters<typeof og.set>[0] = {
    // 明暗：旧通道写 data-scheme，我们跟着走（不跟系统自动，避免两套同时改）
    scheme: schemeOf(root),
    // 皮肤：有 data-glass 就是玻璃皮肤（档位照旧映射），没有就是中性基准
    skin: glass ? "glass" : "neutral",
  };
  if (glass) patch.skinLevel = GLASS_LEVEL[glass] ?? "base";
  og.set(patch, { persist: false });
  syncAccent();
}

/** 安装一次：立即同步 + 观察 html 上的 data-scheme / data-glass / data-theme / data-dynamic 变化，
 *  再挂主题订阅（theme.ts 注入的是 <style> 文本，不走属性——data-theme/dynamic 挡不住取色板换季）。 */
export function installOneGUIBridge(): () => void {
  syncFromLegacy();
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      const attr = r.attributeName ?? "";
      if (attr === "data-scheme" || attr === "data-glass" || attr === "data-theme" || attr === "data-dynamic") {
        syncFromLegacy();
        return;
      }
    }
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-scheme", "data-glass", "data-theme", "data-dynamic"] });
  // 主题文本注入（style.textContent 替换）不改属性 → 用 theme.ts 的订阅再采一次
  void import("../state/theme.js").then(({ subscribeThemes }) => {
    subscribeThemes(() => syncAccent());
  });
  const headObserver = new MutationObserver(() => syncAccent());
  headObserver.observe(document.head, { childList: true, subtree: true, characterData: true });
  return () => {
    observer.disconnect();
    headObserver.disconnect();
  };
}
