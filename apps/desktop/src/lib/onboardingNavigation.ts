/** Real practice destinations. The guide never substitutes a home-page jump for a named tool. */
import { closeSettings, openSettings, openTab } from "../state/explorer.js";
import { closeOneGoSheet, openOneGoSection } from "../components/explorer/OneGoSheet.js";
import { requestSettingsTab } from "../state/settingsMode.js";
import { showPracticalFeatures } from "../state/practicalFeatures.js";
import { back, MAX_FRAMES, navFrames } from "../state/navStack.js";
import { requestOhPanel, openOhPanel } from "../plugins/ohControl.js";
import { dockUiSnapshot } from "../plugins/ChatDock.js";
import type { TourTarget } from "./onboardingLessons.js";

let practiceBaseline: Set<string> | null = null;

/** Record ownership before navigating; a pre-existing overlay is never ours to dismiss. */
export function beginPracticePanels(): void {
  practiceBaseline = new Set(navFrames().flatMap(frame => frame.kind === "overlay" ? [frame.id] : []));
}

/** Ending the guide leaves the user's current real work open and relinquishes ownership. */
export function endPracticePanels(): void {
  practiceBaseline = null;
}

export function openLessonTarget(target: TourTarget): void {
  switch (target) {
    case "search": openOhPanel("search", ""); break;
    case "oh": openOhPanel("oh", ""); break;
    case "mode": openSettings("settings"); break;
    case "home": openTab("homepage"); break;
    case "workspaces": openOneGoSection("ws"); break;
    case "onego": openOneGoSection("favs"); break;
    case "vault": openTab("vault"); break;
    case "organization": openTab("contacts", { section: "orgs" } as never); break;
    case "plugins": openSettings("plugins"); break;
    case "appearance": requestSettingsTab("外观"); openSettings("settings"); break;
    case "data": requestSettingsTab("账号"); openSettings("settings"); break;
    case "learn": openTab("learn"); break;
    case "xiaoda": openTab("xiaoda"); break;
    case "practical": openTab("homepage"); showPracticalFeatures(); break;
  }
}

/**
 * Unwind only overlays opened by this practice, preserving pages and the original overlay boundary.
 * A busy operation may synchronously re-register its frame to decline Back; let it finish first.
 */
export function closePracticePanels(): boolean {
  if (practiceBaseline) {
    let closed = 0;
    while (closed < MAX_FRAMES) {
      const top = navFrames().at(-1);
      if (!top || top.kind !== "overlay" || top.id === "onboarding-tour" || practiceBaseline.has(top.id)) break;
      if (!back()) return false;
      closed++;
      if (navFrames().some(frame => frame.kind === "overlay" && frame.id === top.id)) return false;
    }
    const remaining = navFrames().at(-1);
    if (remaining?.kind === "overlay" && remaining.id !== "onboarding-tour" && !practiceBaseline.has(remaining.id)) return false;
  }
  const dock = dockUiSnapshot();
  if (dock.open && practiceBaseline && !practiceBaseline.has("oh-panel")) requestOhPanel(dock.mode);
  closeSettings();
  closeOneGoSheet();
  showPracticalFeatures(false);
  endPracticePanels();
  return true;
}
