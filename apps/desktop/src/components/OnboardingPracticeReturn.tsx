import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Btn } from "@onethu/gui";

/** Keep the return action inside an active modal's focus boundary, or beside the page dock. */
export function OnboardingPracticeReturn({ title, onResume, onFinish }: { title:string; onResume:()=>void; onFinish:()=>void }) {
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
 return createPortal(<aside className={"tour-resume"+(panel?" is-embedded":"")} aria-label="返回使用导览">
  <span className="tour-resume-copy"><small>正在体验</small><strong>{title}</strong></span>
  <Btn variant="solid" onClick={onResume}>继续导览</Btn>
  <Btn variant="ghost" onClick={onFinish}>结束导览</Btn>
 </aside>,panel??document.body);
}
