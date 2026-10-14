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

/* ── 主题强调色 → OneGUI accent 轴（2026-10-14 用户点名#1 修复）─────────────
 * 旧桥只喂了 skin/scheme，**从不喂 theme 轴** → OG 全组件的强调色永远停在
 * 库默认（--og-ref-brand-40 = 清华紫）——换什么主题、开不开动态取色都没用。
 *
 * 单一来源选 **System 层的 --md-sys-color-secondary**（tokens.css 的业务蓝）：
 *   ① 默认（象牙/无主题）= tokens.css 的业务蓝 #4176e6 —— 修「默认也一片紫」；
 *   ② 主题生效时 = theme.ts 注入 --primary 镜像（COMPAT_TO_SYSTEM）——各主题自己的色；
 *   ③ 动态取色时 = 取色调色板的 System 角色 —— 跟随壁纸。
 * 其它候选都要走各自特例，只有这一条对三条通路都是"当前生效值"。
 * 换值判等防环：og.set 会改写 --og-accent，但 --md-sys-color-secondary 的写入方
 * 只有主题注入/取色/底色令牌，不会被采样值回写（ivory 无注入 = 底色蓝恒定）。 */
let lastAccent = "";

function syncAccent(): void {
  const root = document.documentElement;
  const themeId = root.dataset.theme ?? "";
  const dynamicOn = root.dataset.dynamic === "on";
  /* 采样三态（判等防环）：
     - 动态取色：html:root[data-dynamic=on] (0,2,1) 压过本桥 html:root (0,1,1)，
       computed System secondary 就是取色板真值；
     - 主题：:root[data-theme] (0,2,0) 同压过本桥，--accent 即主题强调色；
     - 象牙/裸基座：**绝不采样**——本桥把 md-secondary 指回了 --og-accent-quiet，
       采样=自吸（默认紫就是在这一步烧进去的），恒喂 tokens.css 的业务蓝 #4176e6。 */
  let id: string;
  let accent: string;
  if (dynamicOn) {
    accent = getComputedStyle(root).getPropertyValue("--md-sys-color-secondary").trim();
    id = "dynamic";
  } else if (themeId && themeId !== "onethu.theme.ivory") {
    accent = getComputedStyle(root).getPropertyValue("--accent").trim();
    id = themeId;
  } else {
    id = "app-base";
    accent = "#4176e6";
  }
  if (!accent || accent === lastAccent) return;
  lastAccent = accent;
  og.set({ theme: { id, accent } }, { persist: false });
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
