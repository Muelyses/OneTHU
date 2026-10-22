import { useCallback, useEffect, useRef, useState } from "react";
import { Btn, Modal, Select, Stack, Text } from "@onethu/gui";
import { t, useLocale } from "../i18n/index.js";
import { checkForUpdate, type UpdateCheckResult } from "../lib/updater.js";
import { UPDATE_REMINDER_CHANGED, SNOOZE_KEY, LEGACY_KEY, snoozeUpdate, stageUpdateReview, updateReminderDelay, type UpdateSnooze } from "../lib/updateReminder.js";
import { useOverlayBack } from "../state/navStack.js";
import { openSettings } from "../state/explorer.js";
import { requestSettingsTab, requestSettingsSection } from "../state/settingsMode.js";
import { experienceMode } from "../state/experienceMode.js";

const CHECK_INTERVAL = 6 * 60 * 60 * 1000;

/** One host for all three modes. Checking is read-only; installation stays user-triggered. */
export function UpdatePromptHost() {
  useLocale();
  const [release, setRelease] = useState<UpdateCheckResult | null>(null);
  const [open, setOpen] = useState(false);
  const [duration, setDuration] = useState<UpdateSnooze>("day");
  const [revision, setRevision] = useState(0);
  const latest = useRef(release); latest.current = release;

  useEffect(() => {
    let alive = true, nextCheck = 0;
    let controller: AbortController | null = null;
    const check = async () => {
      if (document.visibilityState === "hidden" || controller || Date.now() < nextCheck) return;
      nextCheck = Date.now() + 15 * 60_000; controller = new AbortController();
      try {
        const result = await checkForUpdate({ signal: controller.signal });
        if (alive && result.ok) {
          nextCheck = Date.now() + CHECK_INTERVAL;
          setRelease(result.hasUpdate && result.latest && result.downloadUrl ? result : null);
        }
      } catch { /* Background failures stay silent; Settings offers retry and diagnostics. */ }
      finally { controller = null; }
    };
    const first = window.setTimeout(() => void check(), 3000);
    const interval = window.setInterval(() => void check(), 60_000);
    const resume = () => void check();
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      alive = false; controller?.abort(); window.clearTimeout(first); window.clearInterval(interval);
      window.removeEventListener("focus", resume); window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, []);

  useEffect(() => {
    const changed = () => { setOpen(false); setRevision(n => n + 1); };
    const storageChanged = (event: StorageEvent) => {
      if (event.key === null || event.key === SNOOZE_KEY || event.key === LEGACY_KEY) changed();
    };
    window.addEventListener(UPDATE_REMINDER_CHANGED, changed);
    window.addEventListener("storage", storageChanged);
    return () => { window.removeEventListener(UPDATE_REMINDER_CHANGED, changed); window.removeEventListener("storage", storageChanged); };
  }, []);

  useEffect(() => {
    if (!release?.latest) { setOpen(false); return; }
    if (open) return;
    let timer = 0, frame = 0;
    const tryOpen = () => {
      window.clearTimeout(timer);
      const delay = updateReminderDelay(release.latest!);
      if (delay === Infinity) return;
      if (delay > 0) { timer = window.setTimeout(tryOpen, delay); return; }
      if (document.visibilityState === "hidden") return;
      // Let onboarding, settings and existing modal tasks finish first.
      const blocked = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], [aria-modal="true"], .tour-resume'))
        .some(node => node.getClientRects().length > 0);
      if (!blocked) { setDuration("day"); setOpen(true); }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; tryOpen(); }); };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("visibilitychange", schedule);
    // Defer one frame so sibling onboarding / conflict modals can mount first.
    schedule();
    return () => { clearTimeout(timer); cancelAnimationFrame(frame); observer.disconnect(); document.removeEventListener("visibilitychange", schedule); };
  }, [release, open, revision]);

  const later = useCallback(() => {
    if (latest.current?.latest) snoozeUpdate(latest.current.latest, duration);
    setOpen(false);
  }, [duration]);
  useOverlayBack("software-update-prompt", open, later);

  const review = () => {
    if (!release?.latest) return;
    // Give the user time to read/download; leaving Settings keeps a one-hour reminder.
    snoozeUpdate(release.latest, "hour"); stageUpdateReview(release); setOpen(false);
    if (experienceMode() === "full") { requestSettingsTab("关于"); requestSettingsSection("set-update"); }
    openSettings("settings");
  };

  return <Modal open={open && !!release} onClose={later} maskClose={false} closeButton={false}
    size="sm" title={t("update.prompt.title")} data-testid="software-update-prompt">
    <Stack gap={4}>
      <Text slot="title">{t("update.prompt.version", { version: release?.latest ?? "" })}</Text>
      <Text as="p" tone="faint">{t("update.prompt.body")}</Text>
      <Btn block variant="solid" onClick={review}>{t("update.prompt.open")}</Btn>
      <Stack gap={2}>
        <Text slot="label">{t("update.prompt.delay")}</Text>
        <Select value={duration} aria-label={t("update.prompt.delay")} onChange={value => { if (value === "hour" || value === "day" || value === "week") setDuration(value); }} options={[
          { value: "hour", label: t("update.prompt.hour") }, { value: "day", label: t("update.prompt.day") }, { value: "week", label: t("update.prompt.week") },
        ]}/>
        <Btn block variant="outline" onClick={later}>{t("update.prompt.later")}</Btn>
      </Stack>
    </Stack>
  </Modal>;
}
