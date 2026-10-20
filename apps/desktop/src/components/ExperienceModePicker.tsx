import { Btn } from "@onethu/gui";
import type { ExperienceMode } from "../state/experienceMode.js";
export const MODE_OPTIONS=[
 {id:"simple",name:"极简模式",tag:"只留必需",description:"仅保留学习、预约、生活、课表、信息五个功能。",detail:"打开就用，不必整理。"},
 {id:"practical",name:"实用模式",tag:"常用在手边",description:"包含所有基础功能。",detail:"四个快捷入口随你安排；第五格「更多功能」展开全部。"},
 {id:"full",name:"完整模式",tag:"自由组织",description:"充分体验 OneTHU 系列服务带来的高度便利性与可定制化。",detail:"白板、暂存箱与传递、标签页/工作区、组织、插件与 OH。"},
] as const;
export function ExperienceModePicker({value,onChange,variant="default"}:{value:ExperienceMode;onChange:(mode:ExperienceMode)=>void;variant?:"default"|"onboarding"}){
 return <div className={"experience-mode-picker"+(variant==="onboarding"?" is-onboarding":"")}>{MODE_OPTIONS.map(m=><Btn key={m.id} variant="ghost" className={"experience-mode-option"+(value===m.id?" is-selected":"")} aria-label={m.name} aria-pressed={value===m.id} onClick={()=>onChange(m.id)}>
 <span className={"experience-mode-preview is-"+m.id} aria-hidden="true"><span className="mode-preview-header"/><span className="mode-preview-body"><i/><i/>{m.id==="full"?<i/>:null}</span><span className="mode-preview-nav"><i/><i/><i/><i/><i/></span></span>
 <span className="experience-mode-copy"><span className="experience-mode-tag">{m.tag}</span><strong>{m.name}</strong><span>{m.description}</span><small>{m.detail}</small></span><span className="experience-mode-check" aria-hidden="true">{value===m.id?"✓":""}</span>
 </Btn>)}</div>;
}
