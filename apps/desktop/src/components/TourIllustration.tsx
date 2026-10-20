import { Component, lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Btn, IconBtn, IconBook, IconCalendar, IconCheck, IconChevron, IconCloud, IconFile, IconInfo, IconRefresh, IconSchedule, IconUser, IconVault } from "@onethu/gui";
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
type SceneSpec = { name: string; action: string; before: string; after: string };
const SCENES: Record<string, SceneSpec> = {
  board: { name: "自由白板", action: "试着排开", before: "把卡片放到顺手的位置。", after: "排齐了。每张卡片仍可移动、调整大小。" },
  vault: { name: "暂存箱收纳", action: "把三张卡收进去", before: "长按内容，再拖到边缘暂存箱。", after: "三项内容收好了，原来的内容仍然保留。" },
  code: { name: "短口令传递", action: "模拟接收", before: "一组内容，只需要分享一个短口令。", after: "对方收到三项内容。口令连接的是这组内容。" },
  nfc: { name: "碰一碰", action: "模拟靠近", before: "双方进入收发，再把设备靠近。", after: "传递完成的示意；真实使用需设备支持 NFC。" },
  organization: { name: "组织协作", action: "展开成员", before: "创建组织后，名片与组织直接绑定。", after: "成员、资料、项目和公告，围绕同一个组织。" },
  today: { name: "今日首页", action: "完成演示待办", before: "今天要做的事，和接下来要上的课。", after: "一项完成。下一节课仍在这里，不用重新寻找。" },
  quick: { name: "五个快捷入口", action: "试着打开课表", before: "五个清晰入口，随时回到需要的功能。", after: "课表就在手边；首页和 OH 搜索始终可用。" },
  more: { name: "更多功能", action: "展开服务目录", before: "常用的放在下方，其余服务从这里找。", after: "按目录找服务，点名称就能进入。" },
  swap: { name: "调整快捷入口", action: "把云盘放进第一格", before: "从更多功能选择，再挑一个入口位置。", after: "第一格换成云盘了；其余入口保持原样。" },
  "mode-simple": { name: "极简模式", action: "看看今天", before: "今日待办、课程和五个固定入口。", after: "打开就看今天，其他复杂功能收起来。" },
  "mode-practical": { name: "实用模式", action: "展开更多功能", before: "保留简单首页，常用入口可以自己安排。", after: "更多功能按目录打开，常用四格可以替换。" },
  "mode-full": { name: "完整模式", action: "展开工作台", before: "标签、白板、收纳与协作，按你的方式组合。", after: "内容可以自由组织，完整设置随时保留。" },
  ready: { name: "准备出发", action: "预演回到首页", before: "选好的模式，随时可以在设置里调整。", after: "回到首页，从今天的一件小事开始。" },
};
const EXTRAS: Record<string, { title: string; items: string[] }> = {
  explorer: { title: "保存一组正在进行的事", items: ["课程标签", "资料标签", "工作区"] },
  onego: { title: "从 OneGO! 接着做", items: ["OnePage", "工作区", "OneFlow"] },
  plugin: { title: "按需要扩展能力", items: ["插件", "小 OH", "模型设置"] },
  customize: { title: "换成你习惯的样子", items: ["主题", "壁纸", "字号", "入口"] },
  campus: { title: "校园服务，一处进入", items: ["学习", "生活", "预约", "云盘"] },
  data: { title: "换台设备，继续使用", items: ["同步日程", "导出数据", "恢复设置"] },
};
const SHORTCUTS = ["学习", "预约", "生活", "信息", "课表"];
const ICONS = [IconBook, IconCalendar, IconCloud, IconInfo, IconSchedule];

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

function BoardScene(): ReactNode {
  return <div className="tour-board-model">
    <div className="tour-board-layers" aria-hidden="true"><i/><i/><i/></div>
    <div className="tour-mini-chrome"><span>首页</span><span>你的自由白板</span><i aria-hidden="true" /></div>
    <div className="tour-board-area">
      <div className="tour-board-grid" aria-hidden="true"/>
      <div className="tour-model-card tour-board-todo"><span className="tour-card-eyebrow"><IconCheck size="sm" /> 今日待办</span><b>完成课程作业</b><span className="tour-mini-rule" /><small>整理一份资料</small><span className="tour-mini-rule is-short" /></div>
      <div className="tour-model-card tour-board-note"><span className="tour-card-eyebrow">便笺</span><b>记下刚想到的事</b><i className="tour-resize-corner" aria-hidden="true" /></div>
      <div className="tour-model-card tour-board-class"><IconSchedule size="sm" /><span><b>下一节课</b><small>14:00 · 教学楼</small></span></div>
    </div>
  </div>;
}
function VaultScene({ after }: { after: boolean }): ReactNode {
  return <div className="tour-vault-model">
    <div className="tour-source-stack">{["课程资料", "一段文字", "项目文件"].map((title, index) => <div className="tour-model-card tour-source-card" key={title}><IconFile size="sm" /><span>{title}</span><small>0{index + 1}</small></div>)}</div>
    <div className="tour-transfer-track" aria-hidden="true"><IconChevron size="sm" /></div>
    <div className="tour-vault-box"><div className="tour-vault-mouth" aria-hidden="true"/><div className="tour-vault-lid" aria-hidden="true" /><IconVault size="xl" /><b>暂存箱</b><span className="tour-vault-count">{after ? "3 项已收好" : "等你收进来"}</span><i className="tour-vault-handle" aria-hidden="true" />{after ? <span className="tour-result-seal"><IconCheck size="sm" /></span> : null}</div>
    <div className="tour-parcel-stream" aria-hidden="true">{[0,1,2].map(index=><span className="tour-parcel-glint" key={index}><IconFile size="sm"/></span>)}</div>
  </div>;
}
function CodeScene({ after }: { after: boolean }): ReactNode {
  return <div className="tour-code-model">
    <div className="tour-model-card tour-code-end"><IconVault size="lg" /><b>我的内容</b><small>3 项 · 一组</small></div>
    <div className="tour-code-key"><small>演示短口令</small><strong>ON · 7K2P</strong><span>联网取回内容</span></div>
    <div className={"tour-code-end is-recipient" + (after ? " is-received" : "")}>
      <div className="tour-code-card-back" aria-hidden="true"><IconFile size="lg"/><span>一组内容</span></div>
      <div className="tour-code-card-front"><span className="tour-recipient-icon">{after ? <IconCheck size="lg" /> : <IconUser size="lg" />}</span><b>{after ? "已接收" : "接收方"}</b><small>{after ? "3 项内容" : "粘贴口令"}</small></div>
    </div>
  </div>;
}
function NfcScene({ after }: { after: boolean }): ReactNode {
  return <div className="tour-nfc-model">
    <div className="tour-device is-sender">
      <div className="tour-device-back" aria-hidden="true"><i/><i/><span>OneTHU</span></div>
      <div className="tour-device-front"><div className="tour-device-camera" aria-hidden="true" /><span className="tour-device-label">传送方</span><div className="tour-device-card"><IconFile size="lg" /><b>准备内容</b><small>3 项</small></div><span className="tour-device-foot">已准备</span></div>
    </div>
    <div className="tour-proximity">{after ? <IconCheck size="lg" /> : <IconChevron size="lg" />}<small>{after ? "完成" : "靠近"}</small></div>
    <div className="tour-device is-receiver">
      <div className="tour-device-back" aria-hidden="true"><i/><i/><span>OneTHU</span></div>
      <div className="tour-device-front"><div className="tour-device-camera" aria-hidden="true" /><span className="tour-device-label">接收方</span><div className="tour-device-card"><IconVault size="lg" /><b>{after ? "收到内容" : "开启接收"}</b><small>{after ? "3 项" : "等待靠近"}</small></div><span className="tour-device-foot">{after ? "已收到" : "接收中"}</span></div>
    </div>
  </div>;
}
function OrganizationScene({ after }: { after: boolean }): ReactNode {
  return <div className="tour-org-model"><div className="tour-org-backs" aria-hidden="true"><i/><i/><i/></div><div className="tour-org-identity"><span className="tour-org-monogram" aria-hidden="true">同</span><div><small>名片已绑定</small><b>同学工作室</b></div><IconCheck size="sm" /></div>
    <div className="tour-org-services">{["成员", "文件", "项目", "公告"].map((name, index) => <span className={after && index === 0 ? "is-current" : ""} key={name}>{name}</span>)}</div>
    <div className="tour-org-members">{["负责人", "协作者", "查看者"].map((role, index) => <div className="tour-org-person" key={role}><div className="tour-org-person-front"><span>{["林", "周", "陈"][index]}</span><b>{after ? role : ["组织同学", "一起参与", "随时查看"][index]}</b><small>{after ? ["组织管理", "共同编辑", "阅读资料"][index] : "已加入"}</small></div></div>)}</div>
  </div>;
}
function TodayScene({ after }: { after: boolean }): ReactNode {
  return <div className="tour-today-model"><div className="tour-today-date"><span>今天</span><b>从这一件开始</b></div><div className={"tour-model-card tour-today-task" + (after ? " is-complete" : "")}><span className="tour-demo-checkbox">{after ? <IconCheck size="sm" /> : null}</span><div><b>整理课程笔记</b><small>{after ? "已完成 · 仅为演示" : "今日待办 · 还有 1 项"}</small></div></div><div className="tour-model-card tour-today-course"><span className="tour-course-time">14:00</span>
<div><b>下一节课程</b><small>教学楼 · 提前出发</small></div>
<IconChevron size="sm" /></div></div>;
}
function QuickScene({ selected, onSelect }: { selected: number; onSelect: (index: number) => void }): ReactNode {
  return <div className="tour-quick-model"><div className="tour-quick-view"><span className="tour-mini-chrome"><span>首页</span><span>OH 搜索始终在</span></span><div><IconSchedule size="lg" /><b>{selected < 0 ? "想做什么，直接点" : SHORTCUTS[selected]}</b><small>{selected === 4 ? "周一 · 下一节课 14:00" : "固定在底部，随时找到"}</small></div></div><div className="tour-shortcut-row">{SHORTCUTS.map((name,index) => {const Glyph=ICONS[index]!;return <Btn key={name} className={selected===index?"is-current":""} variant={selected===index?"solid":"outline"} size="sm" aria-label={`演示打开${name}`} onClick={()=>onSelect(index)}><Glyph size="sm"/><span>{name}</span></Btn>;})}</div></div>;
}
function MoreScene({ after }: { after: boolean }): ReactNode {
  return <div className="tour-more-model">{after ? <div className="tour-service-catalog">{["课程与作业", "场馆与研讨间", "校园生活", "云盘与邮箱"].map((title,index)=><div className="tour-model-card" key={title}><span>0{index+1}</span><b>{title}</b><IconChevron size="sm"/></div>)}</div> : <div className="tour-catalog-cover"><IconBook size="lg"/><b>更多功能</b><small>所有基础服务，按目录展开</small></div>}<div className="tour-practical-dock"><span>学习</span><span>预约</span><span>生活</span><span>课表</span><b>{after?"目录已展开":"更多功能"}</b></div></div>;
}
function SwapScene({ after }: { after: boolean }): ReactNode {
  return <div className="tour-swap-model"><div className="tour-swap-source"><IconCloud size="lg" /><b>云盘</b><small>选择想放在手边的功能</small></div><div className="tour-slot-row">{[after?"云盘":"学习", "预约", "生活", "课表"].map((label,index)=><div className={"tour-model-card"+(index===0?" is-target":"")} key={index}><small>入口 {index+1}</small><b>{label}</b>{index===0&&after?<IconCheck size="sm"/>:null}</div>)}</div></div>;
}
function ModeScene({ mode, after }: { mode: ExperienceMode; after: boolean }): ReactNode {
  return <div className={"tour-mode-model tour-mode-model--"+mode}>
    <div className="tour-mode-header"><b>{mode==="full"?"首页":"今天"}</b><span>搜索 / OH</span></div>
    {mode==="full"?<><div className="tour-mode-tabs"><span>首页</span><span>课程资料</span><i aria-hidden="true">＋</i></div><div className="tour-mode-board"><div className="tour-model-card"><IconSchedule size="lg"/><b>今日课程</b></div><div className="tour-model-card"><IconCheck size="lg"/><b>待办与便笺</b></div><div className="tour-model-card"><IconVault size="lg"/><b>{after?"收纳与分享":"暂存箱"}</b></div></div></>:<div className="tour-mode-today"><div><span className="tour-demo-checkbox">{after?<IconCheck size="sm"/>:null}</span><span><b>今日待办</b><small>{after?"一件一件，轻松完成":"整理课程笔记"}</small></span></div><div><b>14:00</b><span><b>下一节课程</b><small>教学楼 · 提前出发</small></span></div></div>}
    {mode==="practical"&&after?<div className="tour-mode-more"><span>云盘</span><span>邮箱</span><span>校历</span><span>更多服务</span></div>:null}
    <div className="tour-mode-shortcuts">{(mode==="practical"?["学习","预约","生活","课表","更多"]:SHORTCUTS).map(name=><span key={name}>{name}</span>)}</div>
  </div>;
}
function ReadyScene({ mode, after }: { mode: ExperienceMode; after: boolean }): ReactNode {
  if(after)return <TodayScene after={false}/>;
  return <div className="tour-ready-model"><span className="tour-ready-seal"><IconCheck size="xl"/></span><b>准备好了</b><span>{mode==="full"?"自由组织你的工作台":mode==="practical"?"常用功能，按习惯安排":"打开首页，就看今天"}</span><small>模式随时可换 · 内容一直保留</small></div>;
}

/** A sandbox made entirely of local state: it never imports stores, network, NFC or permission APIs. */
export function TourIllustration({ lesson, mode = "full", playing = true, replayKey = 0 }: TourIllustrationProps): ReactNode {
  const host = useRef<HTMLElement>(null);
  const [after, setAfter] = useState(false), [paused, setPaused] = useState(false), [selected, setSelected] = useState(-1), [replay, setReplay] = useState(0);
  const { reduced, running } = useSceneMotion(playing, paused, host);
  const scene = lesson, sceneMode = mode;
  const contentExtra = EXTRAS[scene];
  const extra = EXTRAS[lesson];
  const spec = SCENES[lesson] ?? {name:extra?.title??"功能入口",action:"展开示意",before:"从一个入口，找到相关功能。",after:"这些能力在同一处，按需要选择。"};
  const reset = (): void => { setAfter(false); setSelected(-1); setReplay(value=>value+1); };
  useLayoutEffect(() => { setAfter(false); setSelected(-1); }, [lesson, mode, replayKey]);
  useLayoutEffect(() => {
    if (running) return;
    // Changing transition-duration does not stop transitions already in flight.
    // Settle those objects at the current semantic state when motion is suspended.
    for (const animation of host.current?.querySelector(".tour-studio-fallback")?.getAnimations({ subtree:true }) ?? []) {
      if ("transitionProperty" in animation) animation.finish();
    }
  }, [running]);
  const act = (): void => { if(after){setAfter(false);setSelected(-1);}else {setAfter(true);if(lesson==="quick")setSelected(4);} };
  const content = scene==="board"?<BoardScene/>:scene==="vault"?<VaultScene after={after}/>:scene==="code"?<CodeScene after={after}/>:scene==="nfc"?<NfcScene after={after}/>:scene==="organization"?<OrganizationScene after={after}/>:scene==="today"?<TodayScene after={after}/>:scene==="quick"?<QuickScene selected={selected} onSelect={index=>{setSelected(index);setAfter(true);}}/>:scene==="more"?<MoreScene after={after}/>:scene==="swap"?<SwapScene after={after}/>:scene.startsWith("mode-")?<ModeScene mode={sceneMode} after={after}/>:scene==="ready"?<ReadyScene mode={sceneMode} after={after}/>:<div className="tour-extra-model"><IconInfo size="lg"/><b>{contentExtra?.title??"从这里开始"}</b><div>{(contentExtra?.items??["首页","搜索","设置"]).map(item=><span key={item}>{item}</span>)}</div></div>;
  return <section ref={host} className="tour-stage" data-lesson={lesson} data-phase={after?"after":"before"} data-running={String(running)} data-reduced={String(reduced)} aria-label={`交互演示：${spec.name}`}>
    <div className="tour-stage-tools"><span><i aria-hidden="true"/>可交互演示</span><div><Btn variant="ghost" size="sm" disabled={reduced} aria-label={reduced?"已减弱动画":paused?"播放演示":"暂停演示"} aria-pressed={paused} onClick={()=>setPaused(value=>!value)}>{reduced?"静态示意":paused?"播放":"暂停"}</Btn><IconBtn size="sm" variant="ghost" icon={<IconRefresh size="sm"/>} label="重播演示" onClick={reset}/></div></div>
    <div className="tour-stage-canvas">
      <StudioLoadBoundary fallback={<div className="tour-studio-fallback">{content}</div>}>
        <Suspense fallback={<div className="tour-studio-fallback">{content}</div>}>
          <TourStudioScene lesson={lesson} after={after} running={running} reduced={reduced} replayKey={`${replayKey}:${replay}`} fallback={<div className="tour-studio-fallback">{content}</div>}/>
        </Suspense>
      </StudioLoadBoundary>
    </div>
    <div className="tour-stage-console"><p role="status" aria-live="polite">{after?spec.after:spec.before}</p><Btn variant="solid" size="sm" aria-label={`试一试：${spec.name}`} onClick={act}>{after?"再试一次":spec.action}<IconChevron size="sm"/></Btn></div>
    <span className="tour-stage-sandbox">仅为操作示意，不会修改你的内容</span>
  </section>;
}
