import { t as i18n, useLocale as useUiLocale } from "../i18n/index.js";
import { Component, lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Btn } from "@onethu/gui";
import { selectStudioScreen, type StudioScreenSource } from "./tourStudioScreens.js";
import type { ExperienceMode } from "../state/experienceMode.js";
const TourStudioScene = lazy(() => import("./TourStudioScene.js").then(module => ({ default: module.TourStudioScene })));

class StudioLoadBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export interface TourIllustrationProps {
  lesson: string;
  mode?: ExperienceMode;
  /** A parent can suspend its scene while another panel is in front. */
  playing?: boolean;
  /** Changing this replays the entrance without changing any application data. */
  replayKey?: number;
}
type SceneSpec = { name: string; before: string; after: string };
const SCENES: Record<string, SceneSpec> = {
  xiaoda: { get name() { return i18n("tour.xiaoda.title"); }, get before() { return i18n("tour.xiaoda.before"); }, get after() { return i18n("tour.xiaoda.after"); } },
  board: { get name() { return i18n("components.tourillustration.4a8eac97e960"); }, get before() { return i18n("components.tourillustration.5f716b7dedd8"); }, get after() { return i18n("components.tourillustration.ee40e75e813e"); } },
  vault: { get name() { return i18n("components.tourillustration.a53febdc5466"); }, get before() { return i18n("components.tourillustration.3a7769c0aa16"); }, get after() { return i18n("components.tourillustration.4c7a7f26e106"); } },
  code: { get name() { return i18n("components.tourillustration.96b3145a6b73"); }, get before() { return i18n("components.tourillustration.420be7bc077e"); }, get after() { return i18n("components.tourillustration.d9c8475ca6a6"); } },
  nfc: { get name() { return i18n("components.tourillustration.fd962d16dac1"); }, get before() { return i18n("components.tourillustration.a134c7737c93"); }, get after() { return i18n("components.tourillustration.7b25b8069c23"); } },
  organization: { get name() { return i18n("components.tourillustration.24a36e5f10e5"); }, get before() { return i18n("components.tourillustration.299d568b581f"); }, get after() { return i18n("components.tourillustration.f65def27f883"); } },
  today: { get name() { return i18n("components.tourillustration.92ea3aacf873"); }, get before() { return i18n("components.tourillustration.bf5b53af13f4"); }, get after() { return i18n("components.tourillustration.8173df51f2a7"); } },
  quick: { get name() { return i18n("components.tourillustration.7119f12b506b"); }, get before() { return i18n("components.tourillustration.6f56d8a61fe3"); }, get after() { return i18n("components.tourillustration.c6331cafc401"); } },
  more: { get name() { return i18n("components.tourillustration.9c7a9fcee92f"); }, get before() { return i18n("components.tourillustration.6cc2a4b7bfc9"); }, get after() { return i18n("components.tourillustration.f4ad88248fc0"); } },
  swap: { get name() { return i18n("components.tourillustration.16afed511861"); }, get before() { return i18n("components.tourillustration.c20f83cc52d2"); }, get after() { return i18n("components.tourillustration.081c32889cff"); } },
  "mode-simple": { get name() { return i18n("components.tourillustration.c89246ea218f"); }, get before() { return i18n("components.tourillustration.e8332f3f0437"); }, get after() { return i18n("components.tourillustration.9593aef7149a"); } },
  "mode-practical": { get name() { return i18n("components.tourillustration.d8aa9757d2b3"); }, get before() { return i18n("components.tourillustration.6d3f6f685e53"); }, get after() { return i18n("components.tourillustration.dd52e4b6a630"); } },
  "mode-full": { get name() { return i18n("components.tourillustration.413088d3b1a0"); }, get before() { return i18n("components.tourillustration.14904f50ba72"); }, get after() { return i18n("components.tourillustration.7d20856e7f07"); } },
  ready: { get name() { return i18n("components.tourillustration.bb3cdc17373c"); }, get before() { return i18n("components.tourillustration.c3d0e8d4b506"); }, get after() { return i18n("components.tourillustration.2af3e3257866"); } },
};
const EXTRAS: Record<string, { title: string; items: string[] }> = {
  explorer: { get title() { return i18n("components.tourillustration.88f643c1b98a"); }, items: ["课程标签", "资料标签", "工作区"] },
  onego: { get title() { return i18n("components.tourillustration.fe0f7b11128c"); }, items: ["OnePage", "工作区", "OneFlow"] },
  plugin: { get title() { return i18n("components.tourillustration.2f356fc75c90"); }, items: ["插件", "小 OH", "模型设置"] },
  customize: { get title() { return i18n("components.tourillustration.3c3ca96372d1"); }, items: ["主题", "壁纸", "字号", "入口"] },
  campus: { get title() { return i18n("components.tourillustration.fa060d19d9cd"); }, items: ["学习", "生活", "预约", "云盘"] },
  data: { get title() { return i18n("components.tourillustration.d924d8e8fe20"); }, items: ["同步日程", "导出数据", "恢复设置"] },
};

function useSceneMotion(playing: boolean, paused: boolean, host: React.RefObject<HTMLElement | null>) {
  const [reduced, setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.ogMotion === "reduced"), [visible, setVisible] = useState(true), [pageVisible, setPageVisible] = useState(() => !document.hidden);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = (): void => setReduced(media.matches || document.documentElement.dataset.ogMotion === "reduced");
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-og-motion"] });
    media.addEventListener("change", update); update();
    return () => { observer.disconnect(); media.removeEventListener("change", update); };
  }, []);
  useEffect(() => {
    const listener = (): void => setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", listener);
    const observer = new IntersectionObserver(([entry]) => setVisible(!!entry?.isIntersecting), { threshold: .05 });
    if (host.current) observer.observe(host.current);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", listener); };
  }, [host]);
  return { reduced, running: playing && !paused && !reduced && visible && pageVisible };
}

/** The graphics fallback uses the exact same app captures as the 3D screen textures. */
function RealScreen({ before, after, tablet = false }: { before: StudioScreenSource; after: StudioScreenSource; tablet?: boolean }): ReactNode {
  const uiLocale = useUiLocale();

  if (!before.url || !after.url) return <span className="tour-studio-loading">{i18n("components.tourillustration.a31b16bc552a")}</span>;
  return <figure className={"tour-real-device" + (tablet ? " is-tablet" : "")}>
    <div className="tour-real-display">
      <img src={before.url} alt="" draggable={false} data-screen={before.key} className="tour-real-before" />
      <img src={after.url} alt="" draggable={false} data-screen={after.key} className="tour-real-after" />
    </div>
  </figure>;
}
function RealScene({ lesson, mode }: { lesson: string; mode: ExperienceMode }): ReactNode {
  const uiLocale = useUiLocale();

  const before = selectStudioScreen(lesson, mode, false), after = selectStudioScreen(lesson, mode, true);
  return <div className={"tour-real-scene" + (before.secondary ? " is-pair" : "")}>
    <RealScreen before={before.primary} after={after.primary} tablet={before.primary.key === "board-full"} />
    {before.secondary && after.secondary ? <RealScreen before={before.secondary} after={after.secondary} /> : null}
  </div>;
}

type SettledScene = { lesson: string; after: boolean; replayKey: number | string };

/** CSS fallback shares the automatic sequence without requiring WebGL callbacks. */
function AutomaticFallback({ children, running, state, onSettled }: { children: ReactNode; running: boolean; state: SettledScene; onSettled: (state: SettledScene) => void }) {
  const uiLocale = useUiLocale();

  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => onSettled(state), 1800);
    return () => window.clearTimeout(timer);
  }, [running, state.lesson, state.after, state.replayKey, onSettled]);
  return <div className="tour-studio-fallback" aria-hidden="true">{children}</div>;
}

/** Automatic local choreography: never imports stores, network, NFC or permission APIs. */
export function TourIllustration({ lesson, mode = "full", playing = true, replayKey = 0 }: TourIllustrationProps): ReactNode {
  const uiLocale = useUiLocale();

  const host = useRef<HTMLElement>(null);
  const [paused, setPaused] = useState(false);
  const { reduced, running } = useSceneMotion(playing, paused, host);
  const sceneKey = `${mode}:${replayKey}`;
  const sequence = `${lesson}:${sceneKey}`;
  const [playback, setPlayback] = useState({ sequence, after: false });
  const after = reduced || (playback.sequence === sequence && playback.after);
  const cue = `${sequence}:${after}`;
  const [settledCue, setSettledCue] = useState<string | null>(null);
  const current = useRef({ lesson, after, replayKey: sceneKey, cue });
  current.current = { lesson, after, replayKey: sceneKey, cue };
  const hold = useRef({ cue, remaining: after ? 1800 : 700 });
  const onSettled = useCallback((state: SettledScene): void => {
    const now = current.current;
    if (state.lesson === now.lesson && state.after === now.after && state.replayKey === now.replayKey) setSettledCue(now.cue);
  }, []);
  useEffect(() => {
    if (hold.current.cue !== cue) hold.current = { cue, remaining: after ? 1800 : 700 };
    if (!running || settledCue !== cue) return;
    const start = performance.now(), timer = window.setTimeout(() => {
      setSettledCue(null);
      setPlayback({ sequence, after: !after });
    }, hold.current.remaining);
    return () => {
      window.clearTimeout(timer);
      if (hold.current.cue === cue) hold.current.remaining = Math.max(0, hold.current.remaining - (performance.now() - start));
    };
  }, [running, settledCue, cue, sequence, after]);
  useLayoutEffect(() => {
    if (running) return;
    for (const animation of host.current?.querySelector(".tour-studio-fallback")?.getAnimations({ subtree:true }) ?? []) {
      if ("transitionProperty" in animation) animation.finish();
    }
  }, [running]);
  const extra = EXTRAS[lesson];
  const spec = SCENES[lesson] ?? {name:extra?.title??i18n("components.tourillustration.6d78bc490e7e"),before:i18n("components.tourillustration.60d33c9c54ae"),after:i18n("components.tourillustration.e431c37e9bdc")};
  const singlePhone = !["board", "mode-full", "vault", "code", "nfc", "organization"].includes(lesson);
  const content = <RealScene lesson={lesson} mode={mode}/>;
  const fallback = <AutomaticFallback running={running} state={{lesson, after, replayKey: sceneKey}} onSettled={onSettled}>{content}</AutomaticFallback>;
  return <section ref={host} className="tour-stage" data-lesson={lesson} data-device={singlePhone ? "phone" : undefined} data-phase={after?"after":"before"} data-running={String(running)} data-reduced={String(reduced)} data-autoplay="true" aria-label={i18n("components.tourillustration.37bf31378e03", { name: String(spec.name) })}>
    <div className="tour-stage-tools"><span><i aria-hidden="true"/>{reduced?i18n("components.tourillustration.65c89582594c"):paused?i18n("components.tourillustration.eb0c326b60ae"):i18n("components.tourillustration.3272fe53c0f6")}</span><div><Btn variant="ghost" size="sm" disabled={reduced} aria-label={reduced?i18n("components.tourillustration.76aa084fbdd3"):paused?i18n("components.tourillustration.73446b07bee3"):i18n("components.tourillustration.0d450810e15f")} aria-pressed={paused} onClick={()=>setPaused(value=>!value)}>{reduced?i18n("components.tourillustration.65c89582594c"):paused?i18n("components.tourillustration.c3396195e91c"):i18n("components.tourillustration.8d12fc0d4eb2")}</Btn></div></div>
    <div className="tour-stage-canvas">
      <StudioLoadBoundary fallback={fallback}>
        <Suspense fallback={fallback}>
          <TourStudioScene lesson={lesson} mode={mode} after={after} running={running} reduced={reduced} replayKey={sceneKey} onSettled={onSettled} fallback={fallback}/>
        </Suspense>
      </StudioLoadBoundary>
    </div>
    <div className="tour-stage-console"><p>{after&&(reduced||settledCue===cue)?spec.after:spec.before}</p></div>
    <span className="tour-stage-sandbox">{i18n("components.tourillustration.81a9402f9808")}</span>
  </section>;
}
