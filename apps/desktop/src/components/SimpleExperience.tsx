import { useMemo } from "react";
import { Btn, Card, Text, Stack } from "@onethu/gui";
import { Ctx, useApp } from "../state/context.js";
import { useSimpleRoute, navigateSimple, useExperienceMode, setExperienceMode } from "../state/experienceMode.js";
import { openSettings } from "../state/explorer.js";
import { renderPage } from "./explorer/renderPage.js";
import { HomeworkWidget, TodayClassesWidget } from "./HomeWidgets.js";
export function ExperienceModeControl() {
 const mode=useExperienceMode();
 return <Card><Stack gap={2}><Text slot="title">使用模式</Text><div className="name-card-actions">
 <Btn aria-pressed={mode==="simple"} variant={mode==="simple"?"solid":"outline"} onClick={()=>setExperienceMode("simple")}>极简模式</Btn>
 <Btn aria-pressed={mode==="full"} variant={mode==="full"?"solid":"outline"} onClick={()=>setExperienceMode("full")}>完整模式</Btn>
 </div><Text slot="micro" tone="faint">随时切换。完整模式的标签、白板和自定义布局都会保留。</Text></Stack></Card>;
}
export function SimpleHeader(){return <header className="simple-header"><Btn variant="ghost" onClick={()=>navigateSimple("homepage")}>首页</Btn><Btn variant="ghost" onClick={()=>openSettings("settings")}>设置</Btn></header>;}
export function SimpleHost(){
 const outer=useApp(), route=useSimpleRoute();
 const value=useMemo(()=>({...outer,page:route.page,navParams:route.params,navigate:(page:typeof route.page,params?:NonNullable<typeof route.params>)=>{if(page==="settings"||page==="plugins")openSettings("settings");else navigateSimple(page,params);}}),[outer,route]);
 return <Ctx.Provider value={value}><div className="explorer-panel simple-panel" data-simple-page={route.page}><div className="page-anim" key={route.page} data-page={route.page}>
 {route.page==="homepage"?<div className="simple-home"><section><h2>今日待办</h2><HomeworkWidget/></section><section><h2>今日课程</h2><TodayClassesWidget upcoming/></section></div>:renderPage(route.page)}
 </div></div></Ctx.Provider>;
}
