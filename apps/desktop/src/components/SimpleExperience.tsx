import { ExperienceModePicker, MODE_OPTIONS } from "./ExperienceModePicker.js";
import { useMemo, useState } from "react";
import { Btn, Card, Text, Stack } from "@onethu/gui";
import { Ctx, useApp } from "../state/context.js";
import { useSimpleRoute, navigateSimple, useExperienceMode, setExperienceMode } from "../state/experienceMode.js";
import { openSettings } from "../state/explorer.js";
import { renderPage } from "./explorer/renderPage.js";
import { HomeworkWidget, TodayClassesWidget } from "./HomeWidgets.js";
/** 设置里的模式选择：默认只留一行摘要，点开才展开三张模式卡（不长期占一大块）。 */
export function ExperienceModeControl() {
 const mode=useExperienceMode();
 const [open,setOpen]=useState(false);
 const current=MODE_OPTIONS.find(m=>m.id===mode)??MODE_OPTIONS[2];
 return <Card className="experience-mode-control">
  <div className="experience-mode-summary">
   <div className="experience-mode-summary-text">
    <Text slot="title">使用模式</Text>
    <Text slot="micro" tone="faint">当前：{current.name} · {current.tag}</Text>
   </div>
   <Btn variant={open?"ghost":"outline"} onClick={()=>setOpen(v=>!v)} aria-expanded={open}>{open?"收起":"切换模式"}</Btn>
  </div>
  {open?<Stack gap={3}><ExperienceModePicker value={mode} onChange={(m)=>{setExperienceMode(m);setOpen(false);}}/><Text slot="micro" tone="faint">模式只改变显示。标签、白板和各模式的快捷入口都会保留。</Text></Stack>:null}
 </Card>;
}

export function SimpleHeader(){return <header className="simple-header"><Btn variant="ghost" aria-label="首页" onClick={()=>navigateSimple("homepage")}><span className="simple-wordmark">OneTHU</span><span className="simple-home-label">首页</span></Btn><span className="simple-header-date">{new Intl.DateTimeFormat("zh-CN",{month:"long",day:"numeric",weekday:"long"}).format(new Date())}</span><Btn variant="ghost" onClick={()=>openSettings("settings")}>设置</Btn></header>;}
export function SimpleHost(){
 const outer=useApp(), route=useSimpleRoute();
 const value=useMemo(()=>({...outer,page:route.page,navParams:route.params,navigate:(page:typeof route.page,params?:NonNullable<typeof route.params>)=>{if(page==="settings"||page==="plugins")openSettings("settings");else navigateSimple(page,params);}}),[outer,route]);
 return <Ctx.Provider value={value}><div className="explorer-panel simple-panel" data-simple-page={route.page}><div className="page-anim" key={route.page} data-page={route.page}>
 {route.page==="homepage"?<div className="simple-home"><section><header className="simple-section-head"><span>01 / 待办</span><h2>今日待办</h2><p>把要做的事，一件件完成。</p></header><HomeworkWidget/></section><section><header className="simple-section-head"><span>02 / 课程</span><h2>今日课程</h2><p>接下来，去哪里上课。</p></header><TodayClassesWidget upcoming/></section></div>:renderPage(route.page)}
 </div></div></Ctx.Provider>;
}
