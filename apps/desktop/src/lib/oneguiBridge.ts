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
}

/** 安装一次：立即同步 + 观察 html 上的 data-scheme / data-glass / data-theme 变化 */
export function installOneGUIBridge(): () => void {
  syncFromLegacy();
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      const attr = r.attributeName ?? "";
      if (attr === "data-scheme" || attr === "data-glass" || attr === "data-theme") {
        syncFromLegacy();
        return;
      }
    }
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-scheme", "data-glass", "data-theme"] });
  return () => observer.disconnect();
}
