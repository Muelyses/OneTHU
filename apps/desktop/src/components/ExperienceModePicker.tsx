import { t as i18n, useLocale as useUiLocale } from "../i18n/index.js";
import { Btn } from "@onethu/gui";
import type { ExperienceMode } from "../state/experienceMode.js";
export const MODE_OPTIONS=[
 {id:"simple",get name() { return i18n("components.experiencemodepicker.c89246ea218f"); },tag:"只留必需",get description() { return i18n("components.experiencemodepicker.32b0d50230a3"); },get detail() { return i18n("components.experiencemodepicker.5d3752839f3f"); }},
 {id:"practical",get name() { return i18n("components.experiencemodepicker.d8aa9757d2b3"); },tag:"常用在手边",get description() { return i18n("components.experiencemodepicker.cbe971c9e2fc"); },get detail() { return i18n("components.experiencemodepicker.26cbedbe0b4f"); }},
 {id:"full",get name() { return i18n("components.experiencemodepicker.413088d3b1a0"); },tag:"自由组织",get description() { return i18n("components.experiencemodepicker.7dbdf431adc5"); },get detail() { return i18n("components.experiencemodepicker.8dc9a2960ed1"); }},
] as const;
export function ExperienceModePicker({value,onChange,variant="default"}:{value:ExperienceMode;onChange:(mode:ExperienceMode)=>void;variant?:"default"|"onboarding"}){
  const uiLocale = useUiLocale();

 return <div className={"experience-mode-picker"+(variant==="onboarding"?" is-onboarding":"")}>{MODE_OPTIONS.map(m=><Btn key={m.id} variant="ghost" className={"experience-mode-option"+(value===m.id?" is-selected":"")} aria-label={m.name} aria-pressed={value===m.id} onClick={()=>onChange(m.id)}>
 <span className={"experience-mode-preview is-"+m.id} aria-hidden="true"><span className="mode-preview-header"/><span className="mode-preview-body"><i/><i/>{m.id==="full"?<i/>:null}</span><span className="mode-preview-nav"><i/><i/><i/><i/><i/></span></span>
 <span className="experience-mode-copy"><span className="experience-mode-tag">{m.tag}</span><strong>{m.name}</strong><span>{m.description}</span><small>{m.detail}</small></span><span className="experience-mode-check" aria-hidden="true">{value===m.id?"✓":""}</span>
 </Btn>)}</div>;
}
