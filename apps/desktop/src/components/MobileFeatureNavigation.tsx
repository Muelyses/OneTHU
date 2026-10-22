import { useEffect, useState, useSyncExternalStore } from "react";
import { Btn, Drawer, IconBtn } from "@onethu/gui";
import { t, useLocale } from "../i18n/index.js";
import { NAV } from "./Layout.js";
import { IconMenu, IconPlug } from "./Icons.js";
import { useIsPhone } from "../state/phoneSheets.js";
import { useMobileNavigation } from "../state/mobileLayout.js";
import { compactPageAllowed, useExperienceMode, useSimpleRoute } from "../state/experienceMode.js";
import { openSettings, openTab, useExplorerState } from "../state/explorer.js";
import { DEFAULT_ONESHOT, useQuickEntries, openQuickEntry } from "../state/quickAccess.js";
import { useOverlayBack } from "../state/navStack.js";
import { topLevelPage } from "../state/app.js";
import { pluginTabsSnapshot, subscribePluginTabs } from "../plugins/tabs.js";
import { showToast } from "../state/toast.js";

/** Legacy-style feature list in a temporary overlay; replaces only OneShot. */
export function MobileFeatureNavigation() {
  useLocale();
  const mode = useExperienceMode(), phone = useIsPhone(), layout = useMobileNavigation(mode);
  const enabled = phone && layout === "side";
  const [open, setOpen] = useState(false);
  const explorer = useExplorerState(), simple = useSimpleRoute();
  const { entries } = useQuickEntries();
  const plugins = useSyncExternalStore(subscribePluginTabs, pluginTabsSnapshot, pluginTabsSnapshot);
  const page = mode === "full" ? explorer.tabs.find(tab => tab.id === explorer.activeId)?.page ?? "homepage" : simple.page;
  const active = topLevelPage(page);
  useEffect(() => { setOpen(false); }, [enabled, mode, page]);
  useOverlayBack("mobile-feature-navigation", enabled && open, () => setOpen(false));
  if (!enabled) return null;
  const choose = (entry: typeof NAV[number]): void => {
    setOpen(false);
    if (mode === "practical" && !compactPageAllowed(entry.page)) {
      openSettings("settings");
      showToast(t("mobile.nav.fullHint", { name: entry.label }));
      return;
    }
    openTab(entry.page, null, { title: entry.label });
  };
  return <>
    <IconBtn className="mobile-nav-trigger" label={t("mobile.nav.open")} icon={<IconMenu width={20} height={20}/>} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}/>
    <Drawer open={open} onClose={() => setOpen(false)} side="left" title={t("mobile.nav.title")} aria-label={t("mobile.nav.title")} className="mobile-feature-drawer">
      <nav className="mobile-feature-list" aria-label={t("mobile.nav.title")}>
        {mode === "simple" ? DEFAULT_ONESHOT.map(id => {
          const entry = entries.find(item => item.id === id);
          if (!entry) return null;
          const Icon = NAV.find(item => item.page === entry.page)?.icon ?? IconMenu;
          return <Btn key={id} className="mobile-feature-link" variant={active === entry.page ? "tonal" : "ghost"} block icon={<Icon/>} aria-current={active === entry.page ? "page" : undefined} onClick={() => { setOpen(false); openQuickEntry(entry); }}>{entry.title}</Btn>;
        }) : NAV.map(entry => {
          const Icon = entry.icon, restricted = mode === "practical" && !compactPageAllowed(entry.page);
          return <Btn key={entry.page} className="mobile-feature-link" variant={active === entry.page ? "tonal" : "ghost"} block icon={<Icon/>} aria-label={entry.label} aria-current={active === entry.page ? "page" : undefined} onClick={() => choose(entry)}><span>{entry.label}</span>{restricted ? <small>{t("mobile.nav.fullOnly")}</small> : null}</Btn>;
        })}
        {mode === "full" && plugins.length ? <>
          <div className="mobile-feature-group">{t("mobile.nav.plugins")}</div>
          {plugins.map(entry => <Btn key={entry.pageKey} className="mobile-feature-link" variant={page === entry.pageKey ? "tonal" : "ghost"} block icon={<IconPlug/>} onClick={() => { setOpen(false); openTab(entry.pageKey as typeof page, null, { title: entry.title }); }}>{entry.title}</Btn>)}
        </> : null}
      </nav>
    </Drawer>
  </>;
}
