import { Btn } from "@onethu/gui";
import type { ExperienceMode } from "../state/experienceMode.js";
export const MODE_OPTIONS=[
 {id:"simple",name:"极简模式",tag:"只留必需",description:"今日待办与课程，五个固定入口。",detail:"打开就用，不必整理。"},
 {id:"practical",name:"实用模式",tag:"常用在手边",description:"简洁首页，随时展开校园功能。",detail:"四个快捷入口，由你安排。"},
 {id:"full",name:"完整模式",tag:"自由组织",description:"白板、暂存箱、内容传递与组织。",detail:"搭建适合自己的工作空间。"},
] as const;
export function ExperienceModePicker({value,onChange}:{value:ExperienceMode;onChange:(mode:ExperienceMode)=>void}){
 return <div className="experience-mode-picker">{MODE_OPTIONS.map(m=><Btn key={m.id} variant="ghost" className={"experience-mode-option"+(value===m.id?" is-selected":"")} aria-label={m.name} aria-pressed={value===m.id} onClick={()=>onChange(m.id)}>
 <span className={"experience-mode-preview is-"+m.id} aria-hidden="true"><span className="mode-preview-header"/><span className="mode-preview-body"><i/><i/>{m.id==="full"?<i/>:null}</span><span className="mode-preview-nav"><i/><i/><i/><i/><i/></span></span>
 <span className="experience-mode-copy"><span className="experience-mode-tag">{m.tag}</span><strong>{m.name}</strong><span>{m.description}</span><small>{m.detail}</small></span><span className="experience-mode-check" aria-hidden="true">{value===m.id?"✓":""}</span>
 </Btn>)}</div>;
}
