/** Settings own the axes; OneGUI owns their complete resolved injection. */
import { og, themeFromVars } from "@onethu/gui";
import { effectiveTheme, subscribeThemes } from "../state/theme.js";

export function installOneGUIBridge(): () => void {
  let last = "";
  const sync = (): void => {
    const root = document.documentElement;
    const scheme = root.dataset.scheme === "dark" ? "dark" : "light";
    const def = effectiveTheme();
    const dynamic = root.dataset.dynamic === "on";
    let theme = def && def.id !== "onethu.theme.ivory" ? themeFromVars(def.id, def.vars, scheme, def.fonts) : null;
    if (dynamic) {
      // Read the producer's raw declarations, never computed bridge aliases.
      const sheet = (document.getElementById("onethu-dynamic-color") as HTMLStyleElement | null)?.sheet;
      const rule = sheet?.cssRules[scheme === "dark" ? 1 : 0] as CSSStyleRule | undefined;
      const vars: Record<string, string> = {};
      if (rule) for (const key of Array.from(rule.style)) vars[key] = rule.style.getPropertyValue(key).trim();
      theme = themeFromVars("dynamic", vars, scheme);
    }
    const glass = root.dataset.glass;
    const patch = {scheme, skin: glass ? "glass" : "neutral", skinLevel: glass ?? "base", theme} as const;
    const signature = JSON.stringify(patch);
    if (signature === last) return;
    last = signature;
    og.set(patch, {persist: false});
  };
  sync();
  const off = subscribeThemes(sync);
  const observer = new MutationObserver(sync);
  observer.observe(document.documentElement, {attributes: true, attributeFilter: ["data-scheme", "data-glass", "data-theme", "data-dynamic"]});
  window.addEventListener("onethu:dynamic-palette", sync);
  return () => { off(); observer.disconnect(); window.removeEventListener("onethu:dynamic-palette", sync); };
}
