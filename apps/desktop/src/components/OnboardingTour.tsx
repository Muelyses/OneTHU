import { msg as i18nMsg, t as i18n, useLocale as useUiLocale } from "../i18n/index.js";
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
const MODE_INTRO:Record<ExperienceMode,string>={simple:"把今天放在眼前",practical:"常用顺手，功能齐全",get full() { return i18n("components.onboardingtour.e2ee720ea747"); }};

export function OnboardingTour(){
  const uiLocale = useUiLocale();

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
  const replay=()=>{if(!closePracticePanels()){showToast(i18nMsg("components.onboardingtour.7d38695ada28"));return;}setChosen(experienceMode());setStep(-1);setExtra(null);setPractice(null);setConnect(false);setDirection("next");setMcpOn(mcpServerEnabled());setOpen(true);};
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
  if(!closePracticePanels()){showToast(i18nMsg("components.onboardingtour.acb7923e4be1"));return;}
  setPractice(null);
 }} onFinish={finish}/>:null}
 <Modal open={open&&!practice} onClose={finish} maskClose={false} closeButton={false} size="lg" className={`experience-tour is-${phase}`} scope={TOUR_CARD_SCOPE} aria-label={i18n("components.onboardingtour.8dc51de059fe")} foot={<div className="tour-footer">
  <Btn variant="outline" disabled={intro} onClick={()=>{if(extra){setExtra(null);setDirection("back");}else move(step-1);}}>{extra?i18n("components.onboardingtour.bfa8ac132dd5"):i18n("components.onboardingtour.da336fdc0dbd")}</Btn>
  <Btn variant="ghost" className="tour-skip" onClick={finish}>{i18n("components.onboardingtour.d69e80a19484")}</Btn>
  {!extra?<Btn variant="solid" className="tour-next" onClick={()=>{if(intro)setExperienceMode(chosen);if(last)finish();else move(step+1);}}>{intro?i18n("components.onboardingtour.aa4142e144b8"):last?i18n("components.onboardingtour.715ee9dc842f"):i18n("components.onboardingtour.acfc4e74a650")}</Btn>:<Btn variant="solid" className="tour-next" onClick={finish}>{i18n("components.onboardingtour.715ee9dc842f")}</Btn>}
 </div>}>
 <div ref={body} className="tour-shell" data-tour-phase={phase} data-tour-mode={chosen} data-lesson={lesson?.id} data-tour-direction={direction}>
  <header className="tour-header"><span className="tour-wordmark">OneTHU<span>{i18n("components.onboardingtour.ac794a015ee3")}</span></span><span className="tour-counter">{intro?i18n("components.onboardingtour.ccc045ffd9b7"):extra?i18n("components.onboardingtour.a8ab98831f5c"):`${modeName} · ${Math.min(step+1,lessons.length)} / ${lessons.length}`}</span></header>
  {!intro?<nav className="tour-chapters" aria-label={i18n("components.onboardingtour.069d9b73883f")}>
   {lessons.map((item,i)=><Btn key={item.id} variant="ghost" aria-label={i18n("components.onboardingtour.bfd00f0d13de", { value: String(CHAPTERS[item.id]) })} aria-current={!last&&!extra&&i===step?"step":undefined} onClick={()=>move(i)}><span className="tour-chapter-index">{i<step?"✓":i+1}</span>{CHAPTERS[item.id]}</Btn>)}
   <Btn variant="ghost" aria-label={i18n("components.onboardingtour.0e633d7479ee")} aria-current={last?"step":undefined} onClick={()=>move(lessons.length)}>{i18n("components.onboardingtour.c0b3fbff51cc")}</Btn>
  </nav>:null}
  <div className="tour-layout">
   <div className="tour-visual"><TourIllustration lesson={scene} mode={chosen} playing={open&&!practice}/>{intro||last?<div className="tour-visual-note">{intro?MODE_INTRO[chosen]:i18n("components.onboardingtour.f1804844a899")}</div>:null}</div>
   <div className="tour-copy">
    {intro?<>
     <div className="tour-copy-heading" key="intro"><span className="tour-eyebrow">{i18n("components.onboardingtour.d4208c3cace4")}</span><h2>{i18n("components.onboardingtour.9352315ee32a")}</h2><p>{i18n("components.onboardingtour.20fe3342156f")}</p></div>
     <ExperienceModePicker value={chosen} onChange={setChosen} variant="onboarding"/>
     <p className="tour-preserve">{i18n("components.onboardingtour.b92a02095b87")}</p>
    </>:last?<>
     <div className="tour-copy-heading" key="ready"><span className="tour-eyebrow">{i18n("components.onboardingtour.4d572d8843d7")}</span><h2>{i18n("components.onboardingtour.f60b58eb72b6")}</h2><p>{i18n("components.onboardingtour.368669b4e8f4")}</p></div>
     <Btn variant="outline" aria-expanded={connect} onClick={()=>setConnect(!connect)}>{connect?i18n("components.onboardingtour.7f93bdddc69a"):i18n("components.onboardingtour.28f2aed32976")}</Btn>
     {connect?<div className="tour-connections"><OptionalConnections/></div>:null}
     {chosen==="full"?<>
      <div className="tour-explore"><h3>{i18n("components.onboardingtour.a8ab98831f5c")}</h3><p>{i18n("components.onboardingtour.1b47dc7fdca4")}</p><div className="tour-explore-grid">{EXTRA_LESSONS.map(item=><Btn key={item.id} variant="outline" data-lesson-id={item.id} aria-label={i18n("components.onboardingtour.19f469fec604", { title: String(item.title) })} onClick={()=>{setExtra(item);setDirection("next");setConnect(false);}}>{CHAPTERS[item.id]}<span aria-hidden="true">↗</span></Btn>)}</div></div>
      <SettingsList><SettingsRow title={i18n("components.onboardingtour.427f33ee91af")} sub={mcpOn?i18n("components.onboardingtour.09c7b2e4141f"):i18n("components.onboardingtour.3c442701f378")} control={<Switch checked={mcpOn} aria-label={i18n("components.onboardingtour.307ebc489657")} onChange={(v)=>{setMcpServer(v);setMcpOn(v);}}/>}/></SettingsList>
     </>:null}
    </>:<>
     <div className="tour-copy-heading" key={lesson!.id}><span className="tour-eyebrow">{extra?i18n("components.onboardingtour.a8ab98831f5c"):`${String(step+1).padStart(2,"0")} / ${modeName}`}</span><h2>{lesson!.title}</h2><p>{lesson!.lead}</p></div>
     <ol className="tour-steps" key={`steps-${lesson!.id}`}>{lesson!.steps.map((line,i)=><li key={line}><span aria-hidden="true">{String(i+1).padStart(2,"0")}</span>{line}</li>)}</ol>
     {lesson!.target?<div className="tour-real-action"><Btn variant="outline" onClick={()=>startPractice(lesson!)}>{lesson!.action}<span aria-hidden="true">↗</span></Btn><Text slot="micro" tone="faint">{i18n("components.onboardingtour.24e75cb57392")}</Text></div>:null}
    </>}
   </div>
  </div>
  <span className="tour-announcement" aria-live="polite" aria-atomic="true">{intro?i18n("components.onboardingtour.fa24c12c5962"):last?i18n("components.onboardingtour.1ad7fe0f57e3"):lesson!.title}</span>
 </div>
 </Modal>
 </>;
}
