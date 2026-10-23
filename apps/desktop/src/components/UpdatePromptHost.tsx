import { useCallback, useEffect, useRef, useState } from "react";
import { Btn, Modal, Select, Stack, Text } from "@onethu/gui";
import { t, useLocale } from "../i18n/index.js";
import { checkForUpdate, type UpdateCheckResult } from "../lib/updater.js";
import { UPDATE_REMINDER_CHANGED, UPDATE_REVIEW_REQUESTED, SNOOZE_KEY, LEGACY_KEY, snoozeUpdate, stageUpdateReview, updateReminderDelay, type UpdateSnooze } from "../lib/updateReminder.js";
import { useOverlayBack } from "../state/navStack.js";
import { openSettings } from "../state/explorer.js";
import { requestSettingsTab, requestSettingsSection } from "../state/settingsMode.js";
import { experienceMode } from "../state/experienceMode.js";
import { SoftwareUpdateSection } from "./SoftwareUpdateSection.js";

const CHECK_INTERVAL = 6 * 60 * 60 * 1000;

/** One host for all three modes. Checking is read-only; installation stays user-triggered. */
export function UpdatePromptHost({ authenticated = true, deferAutomatic = false }: { authenticated?: boolean; deferAutomatic?: boolean }) {
  useLocale();
  const [release, setRelease] = useState<UpdateCheckResult | null>(null);
  const [open, setOpen] = useState(false);
  const [duration, setDuration] = useState<UpdateSnooze>("day");
  const [revision, setRevision] = useState(0);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewSeed, setReviewSeed] = useState<UpdateCheckResult | null>(null);
  const reviewing = useRef(false);
  const checkPending = useRef<Promise<UpdateCheckResult | null> | null>(null);
  const reviewSequence = useRef(0);
  const latest = useRef(release); latest.current = release;
  const receiveReviewCheck = useCallback((result: UpdateCheckResult) => {
    setReviewSeed(result);
    if (result.ok) setRelease(result.hasUpdate && result.latest && result.downloadUrl ? result : null);
  }, []);

  const showCenter = useCallback(() => {
    const sequence = ++reviewSequence.current;
    reviewing.current = true;
    setOpen(false); setReviewOpen(true);
    const pending = checkPending.current;
    setReviewLoading(Boolean(pending));
    setReviewSeed(latest.current);
    // An in-progress automatic request supplies the same dialog; do not start
    // a second request when the user opens updates during the startup check.
    if (pending) void pending.then(result => {
      if (sequence !== reviewSequence.current) return;
      setReviewSeed(result); setReviewLoading(false);
    });
  }, []);
  const closeCenter = useCallback((pause = true) => {
    reviewSequence.current++;
    if (pause && (reviewSeed?.latest || latest.current?.latest)) snoozeUpdate((reviewSeed?.latest || latest.current!.latest)!, "hour");
    reviewing.current = false; setReviewOpen(false);
  }, [reviewSeed]);
  useOverlayBack("software-update-center", reviewOpen, () => closeCenter());
  useEffect(() => {
    window.addEventListener(UPDATE_REVIEW_REQUESTED, showCenter);
    return () => { reviewSequence.current++; window.removeEventListener(UPDATE_REVIEW_REQUESTED, showCenter); };
  }, [showCenter]);

  useEffect(() => {
    let alive = true, nextCheck = 0;
    let controller: AbortController | null = null;
    const check = async () => {
      if (reviewing.current || document.visibilityState === "hidden" || controller || Date.now() < nextCheck) return;
      nextCheck = Date.now() + 15 * 60_000; controller = new AbortController();
      const request = checkForUpdate({ signal: controller.signal }).catch(() => null);
      checkPending.current = request;
      try {
        const result = await request;
        if (alive && result?.ok) {
          nextCheck = Date.now() + CHECK_INTERVAL;
          setRelease(result.hasUpdate && result.latest && result.downloadUrl ? result : null);
        }
      } catch { /* Background failures stay silent; Settings offers retry and diagnostics. */ }
      finally { if (checkPending.current === request) checkPending.current = null; controller = null; }
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
    if (!release?.latest || deferAutomatic || reviewOpen) { setOpen(false); return; }
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
  }, [release, open, revision, deferAutomatic, reviewOpen]);

  const later = useCallback(() => {
    if (latest.current?.latest) snoozeUpdate(latest.current.latest, duration);
    setOpen(false);
  }, [duration]);
  useOverlayBack("software-update-prompt", open, later);

  const review = () => {
    if (!release?.latest) return;
    if (!authenticated) { showCenter(); return; }
    // Give the user time to read/download; leaving Settings keeps a one-hour reminder.
    snoozeUpdate(release.latest, "hour"); stageUpdateReview(release); setOpen(false);
    if (experienceMode() === "full") { requestSettingsTab("关于"); requestSettingsSection("set-update"); }
    openSettings("settings");
  };

  return <><Modal open={open && !!release} onClose={later} maskClose={false} closeButton={false}
    size="sm" title={t("update.prompt.title")} data-testid="software-update-prompt">
    <Stack gap={4}>
      <Text slot="title">{t("update.prompt.version", { version: release?.latest ?? "" })}</Text>
      <Text as="p" tone="faint">{t("update.prompt.body")}</Text>
      {release?.notes ? <div data-testid="software-update-notes" tabIndex={0} style={{ maxHeight: "min(26vh, 220px)", overflowY: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: "var(--text-sm)", lineHeight: 1.6 }}>
        {t("components.softwareupdatesection.e5958649985d", { notes: release.notes }).trim()}
      </div> : null}
      <Btn block variant="solid" onClick={review}>{t("update.prompt.open")}</Btn>
      <Stack gap={2}>
        <Text slot="label">{t("update.prompt.delay")}</Text>
        <Select value={duration} aria-label={t("update.prompt.delay")} onChange={value => { if (value === "hour" || value === "day" || value === "week") setDuration(value); }} options={[
          { value: "hour", label: t("update.prompt.hour") }, { value: "day", label: t("update.prompt.day") }, { value: "week", label: t("update.prompt.week") },
        ]}/>
        <Btn block variant="outline" onClick={later}>{t("update.prompt.later")}</Btn>
      </Stack>
    </Stack>
  </Modal>
    <Modal open={reviewOpen} onClose={() => closeCenter()} maskClose={false}
      size="md" title={t("components.softwareupdatesection.c692dd3f13e4", { value: "" })} data-testid="software-update-center">
      {reviewLoading ? <div role="status">{t("update.checkingSource", { source: "" })}</div>
        : <SoftwareUpdateSection active={reviewOpen} initialResult={reviewSeed} autoCheck={!reviewSeed} onSnooze={() => closeCenter(false)} onChecked={receiveReviewCheck} />}
    </Modal>
  </>;
}
