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
  board: { name: "自由白板", before: "把卡片放到顺手的位置。", after: "白板上的组件可以移动、调整大小。" },
  vault: { name: "暂存箱收纳", before: "长按内容，再拖到边缘暂存箱。", after: "三项内容收好了，原来的内容仍然保留。" },
  code: { name: "短口令传递", before: "一组内容，只需要分享一个短口令。", after: "生成的短口令连接这一组内容。" },
  nfc: { name: "碰一碰", before: "双方进入收发，再把设备靠近。", after: "传递完成的示意；真实使用需设备支持 NFC。" },
  organization: { name: "组织协作", before: "创建组织后，名片与组织直接绑定。", after: "成员、资料、项目和公告，围绕同一个组织。" },
  today: { name: "今日首页", before: "今天要做的事，和接下来要上的课。", after: "首页会把今日待办和下一节课整理清楚。" },
  quick: { name: "五个快捷入口", before: "五个清晰入口，随时回到需要的功能。", after: "课表就在手边；首页和 OH 搜索始终可用。" },
  more: { name: "更多功能", before: "常用的放在下方，其余服务从这里找。", after: "按目录找服务，点名称就能进入。" },
  swap: { name: "调整快捷入口", before: "从更多功能选择，再挑一个入口位置。", after: "第一格换成云盘了；其余入口保持原样。" },
  "mode-simple": { name: "极简模式", before: "今日待办、课程和五个固定入口。", after: "打开就看今天，其他复杂功能收起来。" },
  "mode-practical": { name: "实用模式", before: "保留简单首页，常用入口可以自己安排。", after: "更多功能按目录打开，常用四格可以替换。" },
  "mode-full": { name: "完整模式", before: "标签、白板、收纳与协作，按你的方式组合。", after: "内容可以自由组织，完整设置随时保留。" },
  ready: { name: "准备出发", before: "选好的模式，随时可以在设置里调整。", after: "回到首页，从今天的一件小事开始。" },
};
const EXTRAS: Record<string, { title: string; items: string[] }> = {
  explorer: { title: "保存一组正在进行的事", items: ["课程标签", "资料标签", "工作区"] },
  onego: { title: "从 OneGO! 接着做", items: ["OnePage", "工作区", "OneFlow"] },
  plugin: { title: "按需要扩展能力", items: ["插件", "小 OH", "模型设置"] },
  customize: { title: "换成你习惯的样子", items: ["主题", "壁纸", "字号", "入口"] },
  campus: { title: "校园服务，一处进入", items: ["学习", "生活", "预约", "云盘"] },
  data: { title: "换台设备，继续使用", items: ["同步日程", "导出数据", "恢复设置"] },
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
  if (!before.url || !after.url) return <span className="tour-studio-loading">真实界面暂未载入</span>;
  return <figure className={"tour-real-device" + (tablet ? " is-tablet" : "")}>
    <div className="tour-real-display">
      <img src={before.url} alt="" draggable={false} data-screen={before.key} className="tour-real-before" />
      <img src={after.url} alt="" draggable={false} data-screen={after.key} className="tour-real-after" />
    </div>
  </figure>;
}
function RealScene({ lesson, mode }: { lesson: string; mode: ExperienceMode }): ReactNode {
  const before = selectStudioScreen(lesson, mode, false), after = selectStudioScreen(lesson, mode, true);
  return <div className={"tour-real-scene" + (before.secondary ? " is-pair" : "")}>
    <RealScreen before={before.primary} after={after.primary} tablet={before.primary.key === "board-full"} />
    {before.secondary && after.secondary ? <RealScreen before={before.secondary} after={after.secondary} /> : null}
  </div>;
}

type SettledScene = { lesson: string; after: boolean; replayKey: number | string };

/** CSS fallback shares the automatic sequence without requiring WebGL callbacks. */
function AutomaticFallback({ children, running, state, onSettled }: { children: ReactNode; running: boolean; state: SettledScene; onSettled: (state: SettledScene) => void }) {
  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => onSettled(state), 1800);
    return () => window.clearTimeout(timer);
  }, [running, state.lesson, state.after, state.replayKey, onSettled]);
  return <div className="tour-studio-fallback" aria-hidden="true">{children}</div>;
}

/** Automatic local choreography: never imports stores, network, NFC or permission APIs. */
export function TourIllustration({ lesson, mode = "full", playing = true, replayKey = 0 }: TourIllustrationProps): ReactNode {
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
  const spec = SCENES[lesson] ?? {name:extra?.title??"功能入口",before:"从一个入口，找到相关功能。",after:"这些能力在同一处，按需要选择。"};
  const singlePhone = !["board", "mode-full", "vault", "code", "nfc", "organization"].includes(lesson);
  const content = <RealScene lesson={lesson} mode={mode}/>;
  const fallback = <AutomaticFallback running={running} state={{lesson, after, replayKey: sceneKey}} onSettled={onSettled}>{content}</AutomaticFallback>;
  return <section ref={host} className="tour-stage" data-lesson={lesson} data-device={singlePhone ? "phone" : undefined} data-phase={after?"after":"before"} data-running={String(running)} data-reduced={String(reduced)} data-autoplay="true" aria-label={`动画演示：${spec.name}`}>
    <div className="tour-stage-tools"><span><i aria-hidden="true"/>{reduced?"静态示意":paused?"已暂停":"自动演示"}</span><div><Btn variant="ghost" size="sm" disabled={reduced} aria-label={reduced?"已减弱动画":paused?"播放演示":"暂停演示"} aria-pressed={paused} onClick={()=>setPaused(value=>!value)}>{reduced?"静态示意":paused?"播放":"暂停"}</Btn></div></div>
    <div className="tour-stage-canvas">
      <StudioLoadBoundary fallback={fallback}>
        <Suspense fallback={fallback}>
          <TourStudioScene lesson={lesson} mode={mode} after={after} running={running} reduced={reduced} replayKey={sceneKey} onSettled={onSettled} fallback={fallback}/>
        </Suspense>
      </StudioLoadBoundary>
    </div>
    <div className="tour-stage-console"><p>{after&&(reduced||settledCue===cue)?spec.after:spec.before}</p></div>
    <span className="tour-stage-sandbox">仅为操作示意，不会修改你的内容</span>
  </section>;
}
