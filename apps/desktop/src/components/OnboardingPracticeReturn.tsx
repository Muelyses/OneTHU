import { t as i18n, useLocale as useUiLocale } from "../i18n/index.js";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Btn } from "@onethu/gui";

/** Keep the return action inside an active modal's focus boundary, or beside the page dock. */
export function OnboardingPracticeReturn({ title, onResume, onFinish }: { title:string; onResume:()=>void; onFinish:()=>void }) {
  const uiLocale = useUiLocale();

 const [panel,setPanel]=useState<HTMLElement|null>(null);
 useEffect(()=>{
  let frame=0;
  const update=()=>{
   frame=0;
   const dialogs=Array.from(document.querySelectorAll<HTMLElement>('.og-panel[role="dialog"], .ex-onego[role="dialog"], .settings-panel[role="dialog"]'));
   const target=dialogs.reverse().find(el=>!el.classList.contains("experience-tour")&&!el.closest(".is-closing")&&el.getClientRects().length>0)??null;
   setPanel(previous=>previous===target?previous:target);
  };
  const observer=new MutationObserver(()=>{if(!frame)frame=requestAnimationFrame(update);});
  observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:["class","hidden","aria-hidden"]});
  update();
  return()=>{observer.disconnect();cancelAnimationFrame(frame);};
 },[]);
 return createPortal(<aside className={"tour-resume"+(panel?" is-embedded":"")} aria-label={i18n("components.onboardingpracticereturn.28a8dedd4ed0")}>
  <span className="tour-resume-copy"><small>{i18n("components.onboardingpracticereturn.da5089b7b6da")}</small><strong>{title}</strong></span>
  <Btn variant="solid" onClick={onResume}>{i18n("components.onboardingpracticereturn.12fd8c16961e")}</Btn>
  <Btn variant="ghost" onClick={onFinish}>{i18n("components.onboardingpracticereturn.bdb8ec437a18")}</Btn>
 </aside>,panel??document.body);
}
