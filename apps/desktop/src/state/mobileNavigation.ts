/** Session navigation for all three shells. Back restores routes, never deletes tabs. */
import type { LearnNav, Page } from "./app.js";
import { activeTab, focusTab, getTab, HOME_TAB_ID, navigateInTab, subscribeExplorer } from "./explorer.js";
import { experienceMode, navigateSimple, simpleRoute, subscribeExperience, type ExperienceMode } from "./experienceMode.js";
import { MAX_FRAMES, registerNavigationBack, refreshNavigationBack } from "./navStack.js";

type Route = { tabId: string | null; page: Page; params: LearnNav | null };
const home = (): Route => ({ tabId: HOME_TAB_ID, page: "homepage", params: null });
const same = (a: Route | undefined, b: Route): boolean => !!a && a.tabId === b.tabId && a.page === b.page && JSON.stringify(a.params) === JSON.stringify(b.params);

/** Mount once with Shell, including the root: Android must listen before the first navigation. */
export function startMobileNavigation(): () => void {
  const histories = new Map<ExperienceMode, Route[]>();
  let restoring = false;
  const read = (): Route => experienceMode() === "full"
    ? { tabId: activeTab().id, page: activeTab().page, params: activeTab().params }
    : { tabId: null, ...simpleRoute() };
  const record = (): void => {
    if (restoring) return;
    const mode = experienceMode(), current = read();
    let history = histories.get(mode);
    if (!history) {
      const root = { ...home(), tabId: mode === "full" ? HOME_TAB_ID : null };
      history = same(root, current) ? [] : [root];
      histories.set(mode, history);
    }
    const previous = history.at(-1);
    // Root pages write their default segment back after mount. Enrich that entry
    // instead of requiring an extra Back just to undo automatic initialization.
    if (previous && previous.tabId === current.tabId && previous.page === current.page && previous.params === null && current.params !== null) {
      history[history.length - 1] = current;
    } else if (!same(previous, current)) history.push(current);
    // Preserve the root so a long session can still return home.
    if (history.length > MAX_FRAMES) history.splice(1, history.length - MAX_FRAMES);
    refreshNavigationBack();
  };
  record();
  const stopExplorer = subscribeExplorer(record);
  const stopExperience = subscribeExperience(record);
  const stopBack = registerNavigationBack({
    depth: () => histories.get(experienceMode())?.length ?? 0,
    canGoBack: () => (histories.get(experienceMode())?.length ?? 0) > 1,
    back: () => {
      record();
      const mode = experienceMode(), history = histories.get(mode)!;
      if (history.length <= 1) return false;
      history.pop();
      // Closed tabs cannot be resurrected by Back.
      while (history.length > 1 && ((mode === "full" && !getTab(history.at(-1)!.tabId!)) || same(history.at(-1), read()))) history.pop();
      const target = history.at(-1)!;
      restoring = true;
      try {
        if (mode === "full") {
          if (target.tabId !== HOME_TAB_ID) navigateInTab(target.tabId!, target.page, target.params);
          focusTab(target.tabId!);
        } else navigateSimple(target.page, target.params);
      } finally { restoring = false; }
      return true;
    },
  });
  return () => { stopBack(); stopExplorer(); stopExperience(); };
}
