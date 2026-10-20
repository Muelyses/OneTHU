import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Btn, Modal, Text, SettingsList, SettingsRow, Switch } from "@onethu/gui";
import { OnboardingPracticeReturn } from "./OnboardingPracticeReturn.js";
import { showToast } from "../state/toast.js";
import { TourIllustration } from "./TourIllustration.js";
import { ExperienceModePicker, MODE_OPTIONS } from "./ExperienceModePicker.js";
import { experienceMode, setExperienceMode, useExperienceMode, type ExperienceMode } from "../state/experienceMode.js";
import { useOverlayBack } from "../state/navStack.js";
import { EXTRA_LESSONS, lessonsForMode, type Lesson } from "../lib/onboardingLessons.js";
import { beginPracticePanels, closePracticePanels, endPracticePanels, openLessonTarget } from "../lib/onboardingNavigation.js";
import { OptionalConnections } from "./SimpleSettings.js";
import { TOUR_CARD_SCOPE, defineOnboardingScopes } from "./OnboardingTourScope.js";
import { mcpServerEnabled, setMcpServer } from "../state/userext.js";

const KEY="onethu.onboarded.flow4";
const REPLAY="onethu.onboarding.replay";
export function replayOnboarding(){window.dispatchEvent(new Event(REPLAY));}
function shouldStart(){
 try {
  if(typeof location!=="undefined"&&new URLSearchParams(location.search).get("tour")==="1")return true;
  return !localStorage.getItem(KEY)&&!localStorage.getItem("onethu.onboarded.flow3")&&!localStorage.getItem("onethu.onboarded.phone");
 } catch { return false; }
}
const CHAPTERS:Record<string,string>={board:"白板",vault:"暂存箱",code:"口令",nfc:"碰一碰",organization:"组织",today:"今天",quick:"五个入口",more:"更多功能",swap:"常用入口",explorer:"标签与工作区",onego:"OneGO!",plugin:"插件与 OH",customize:"外观",campus:"校园服务",data:"数据与同步"};
const MODE_INTRO:Record<ExperienceMode,string>={simple:"把今天放在眼前",practical:"常用顺手，功能齐全",full:"把校园生活，组织成你的样子"};

export function OnboardingTour(){
 const currentMode=useExperienceMode();
 const [open,setOpen]=useState(shouldStart);
 const [chosen,setChosen]=useState<ExperienceMode>(experienceMode);
 const [step,setStep]=useState(-1);
 const [extra,setExtra]=useState<Lesson|null>(null);
 const [practice,setPractice]=useState<Lesson|null>(null);
 const [connect,setConnect]=useState(false);
 const [mcpOn,setMcpOn]=useState(()=>mcpServerEnabled());
 const [direction,setDirection]=useState<"next"|"back">("next");
 const body=useRef<HTMLDivElement>(null);
 const lessons=lessonsForMode(chosen);
 const intro=step<0;
 const last=step===lessons.length&&!extra;
 const lesson=extra??lessons[step];
 const phase=intro?"intro":last?"ready":"lesson";
 const scene=intro?`mode-${chosen}`:last?"ready":lesson!.id;
 const modeName=MODE_OPTIONS.find(m=>m.id===chosen)!.name;
 const move=(next:number)=>{setDirection(next<step?"back":"next");setStep(Math.max(-1,Math.min(lessons.length,next)));setExtra(null);setConnect(false);};
 const finish=()=>{try{localStorage.setItem(KEY,"1");}catch{}endPracticePanels();setOpen(false);setPractice(null);};
 useOverlayBack("onboarding-tour",open&&!practice,finish);
 useEffect(()=>{
  const replay=()=>{if(!closePracticePanels()){showToast("请先完成当前操作，再打开导览");return;}setChosen(experienceMode());setStep(-1);setExtra(null);setPractice(null);setConnect(false);setDirection("next");setMcpOn(mcpServerEnabled());setOpen(true);};
  window.addEventListener(REPLAY,replay);
  return()=>window.removeEventListener(REPLAY,replay);
 },[]);
 useEffect(()=>{
  // Settings can change the mode during a real practice visit. Resume the matching guide.
  if(open&&step>=0&&currentMode!==chosen){
   if(!closePracticePanels())return;
   setChosen(currentMode);setStep(0);setExtra(null);setPractice(null);setConnect(false);
  }
 },[open,step,currentMode,chosen,practice]);
 useLayoutEffect(()=>{
  // Retain a stable footer, but do not inherit the previous chapter's reading position.
  const scroller=body.current?.closest(".og-panel-body");
  if(scroller)scroller.scrollTop=0;
  const panel=body.current?.closest(".experience-tour");
  if(panel)panel.scrollTop=0;
  const chapters=body.current?.querySelector<HTMLElement>(".tour-chapters");
  const active=chapters?.querySelector<HTMLElement>('[aria-current="step"]');
  if(chapters&&active){
   const rail=chapters.getBoundingClientRect(),item=active.getBoundingClientRect();
   if(item.right>rail.right)chapters.scrollLeft+=item.right-rail.right;
   else if(item.left<rail.left)chapters.scrollLeft-=rail.left-item.left;
  }
 },[step,extra,practice,open]);
 defineOnboardingScopes();
 const startPractice=(item:Lesson)=>{
  if(!item.target)return;
  beginPracticePanels();
  setPractice(item);
  openLessonTarget(item.target);
 };
 return <>
 {open&&practice?<OnboardingPracticeReturn title={CHAPTERS[practice.id]!} onResume={()=>{
  if(!closePracticePanels()){showToast("当前操作仍在进行，完成后再继续导览");return;}
  setPractice(null);
 }} onFinish={finish}/>:null}
 <Modal open={open&&!practice} onClose={finish} maskClose={false} closeButton={false} size="lg" className={`experience-tour is-${phase}`} scope={TOUR_CARD_SCOPE} aria-label="OneTHU 使用导览" foot={<div className="tour-footer">
  <Btn variant="outline" disabled={intro} onClick={()=>{if(extra){setExtra(null);setDirection("back");}else move(step-1);}}>{extra?"返回完成页":"上一步"}</Btn>
  <Btn variant="ghost" className="tour-skip" onClick={finish}>跳过导览</Btn>
  {!extra?<Btn variant="solid" className="tour-next" onClick={()=>{if(intro)setExperienceMode(chosen);if(last)finish();else move(step+1);}}>{intro?"按此模式开始":last?"开始使用":"下一步"}</Btn>:<Btn variant="solid" className="tour-next" onClick={finish}>开始使用</Btn>}
 </div>}>
 <div ref={body} className="tour-shell" data-tour-phase={phase} data-tour-mode={chosen} data-lesson={lesson?.id} data-tour-direction={direction}>
  <header className="tour-header"><span className="tour-wordmark">OneTHU<span>使用导览</span></span><span className="tour-counter">{intro?"选择你的方式":extra?"继续探索":`${modeName} · ${Math.min(step+1,lessons.length)} / ${lessons.length}`}</span></header>
  {!intro?<nav className="tour-chapters" aria-label="导览章节">
   {lessons.map((item,i)=><Btn key={item.id} variant="ghost" aria-label={`跳到：${CHAPTERS[item.id]}`} aria-current={!last&&!extra&&i===step?"step":undefined} onClick={()=>move(i)}><span className="tour-chapter-index">{i<step?"✓":i+1}</span>{CHAPTERS[item.id]}</Btn>)}
   <Btn variant="ghost" aria-label="跳到：准备完成" aria-current={last?"step":undefined} onClick={()=>move(lessons.length)}>完成</Btn>
  </nav>:null}
  <div className="tour-layout">
   <div className="tour-visual"><TourIllustration lesson={scene} mode={chosen} playing={open&&!practice}/>{intro||last?<div className="tour-visual-note">{intro?MODE_INTRO[chosen]:"准备好了，按自己的节奏开始。"}</div>:null}</div>
   <div className="tour-copy">
    {intro?<>
     <div className="tour-copy-heading" key="intro"><span className="tour-eyebrow">从适合你的方式开始</span><h2>你想怎样使用 OneTHU？</h2><p>先选一种，随时可以换。</p></div>
     <ExperienceModePicker value={chosen} onChange={setChosen} variant="onboarding"/>
     <p className="tour-preserve">切换只改变界面。已有标签、白板和设置都会保留。</p>
    </>:last?<>
     <div className="tour-copy-heading" key="ready"><span className="tour-eyebrow">你的 OneTHU，准备好了</span><h2>需要时，再连接</h2><p>扫码连接雨课堂，或在微信、飞书里使用 OH。现在跳过也可以。</p></div>
     <Btn variant="outline" aria-expanded={connect} onClick={()=>setConnect(!connect)}>{connect?"收起连接选项":"选择扫码连接"}</Btn>
     {connect?<div className="tour-connections"><OptionalConnections/></div>:null}
     {chosen==="full"?<>
      <div className="tour-explore"><h3>继续探索</h3><p>这些功能，等需要时再了解。</p><div className="tour-explore-grid">{EXTRA_LESSONS.map(item=><Btn key={item.id} variant="outline" data-lesson-id={item.id} aria-label={`继续探索：${item.title}`} onClick={()=>{setExtra(item);setDirection("next");setConnect(false);}}>{CHAPTERS[item.id]}<span aria-hidden="true">↗</span></Btn>)}</div></div>
      <SettingsList><SettingsRow title="向本机应用开放 OH MCP" sub={mcpOn?"已开启：本机客户端可连 127.0.0.1:8787":"默认关闭；开启后本机其他应用可把 OneTHU 当工具调用"} control={<Switch checked={mcpOn} aria-label="OH MCP 服务器开关" onChange={(v)=>{setMcpServer(v);setMcpOn(v);}}/>}/></SettingsList>
     </>:null}
    </>:<>
     <div className="tour-copy-heading" key={lesson!.id}><span className="tour-eyebrow">{extra?"继续探索":`${String(step+1).padStart(2,"0")} / ${modeName}`}</span><h2>{lesson!.title}</h2><p>{lesson!.lead}</p></div>
     <ol className="tour-steps" key={`steps-${lesson!.id}`}>{lesson!.steps.map((line,i)=><li key={line}><span aria-hidden="true">{String(i+1).padStart(2,"0")}</span>{line}</li>)}</ol>
     {lesson!.target?<div className="tour-real-action"><Btn variant="outline" onClick={()=>startPractice(lesson!)}>{lesson!.action}<span aria-hidden="true">↗</span></Btn><Text slot="micro" tone="faint">打开真实页面，随时回来继续</Text></div>:null}
    </>}
   </div>
  </div>
  <span className="tour-announcement" aria-live="polite" aria-atomic="true">{intro?"选择体验模式":last?"导览完成，可选择连接服务":lesson!.title}</span>
 </div>
 </Modal>
 </>;
}
