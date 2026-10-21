import { labelForId } from "../../i18n/staticLabels.js";
import { t as i18n, rich as i18nRich, useLocale as useUiLocale } from "../../i18n/index.js";
/** Practical mode service library: search, browse, open, or pin to one of four slots. */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Btn, IconBtn, Modal, SearchField, Text } from "@onethu/gui";
import { IconPlus, IconLearn, IconSchedule, IconInfo } from "../Icons.js";
import { NAV } from "../Layout.js";
import { NAV_CATEGORIES, NAV_REGISTRY } from "../../state/navigation.js";
import { openTab } from "../../state/explorer.js";
import { quickEntries } from "../../state/quickAccess.js";
import { compactPageAllowed } from "../../state/experienceMode.js";
import type { NavEntry } from "../../state/navigation.js";

function FeatureIcon({page}:{page:string}) {
  const uiLocale = useUiLocale();

 const Icon=NAV.find(n=>n.page===page||n.activePages?.includes(page as NavEntry["page"]))?.icon ?? (page.startsWith("learn")?IconLearn:page.startsWith("schedule")?IconSchedule:IconInfo);
 return <span className="practical-feature-icon" aria-hidden="true"><Icon/></span>;
}
export function PracticalFeaturesPanel({open,onClose,slots,onPlace}:{
 open:boolean;onClose:()=>void;slots:string[];onPlace:(feature:{id:string;title:string})=>void;
}):ReactNode {
  const uiLocale = useUiLocale();

 const [query,setQuery]=useState("");
 const [category,setCategory]=useState("全部");
 useEffect(()=>{if(open){setQuery("");setCategory("全部");}},[open]);
 const entries=useMemo(()=>NAV_REGISTRY.filter(e=>compactPageAllowed(e.page)&&e.page!=="settings"),[uiLocale]);
 const categories=NAV_CATEGORIES.filter(c=>entries.some(e=>e.category===c));
 const search=query.trim().toLocaleLowerCase();
 const groups=categories.map(name=>({name,entries:entries.filter(e=>e.category===name&&(category==="全部"||category===name)&&(!search||[e.name,e.note,...e.keywords].join(" ").toLocaleLowerCase().includes(search)))})).filter(g=>g.entries.length);
 const shortcuts=quickEntries();
 const place=(entry:NavEntry)=>onPlace({id:"page:"+entry.id,title:entry.name});
 return <Modal open={open} onClose={onClose} title={i18n("components.explorer.practicalfeatures.9c7a9fcee92f")} className="practical-library" size="lg">
 <div className="practical-library-intro"><span className="practical-library-kicker">{i18n("components.explorer.practicalfeatures.c409f53e4604")}</span><Text tone="faint">{i18n("components.explorer.practicalfeatures.67fec4a963ba")}</Text></div>
 <div className="practical-pinned"><span className="practical-section-label">{i18n("components.explorer.practicalfeatures.7c6365b991ef")}</span><div className="practical-pinned-grid">{slots.map((id,i)=>{const e=shortcuts.find(e=>e.id===id);return <div className="practical-pinned-item" key={i}><span className="practical-slot-number">0{i+1}</span><span>{e?.title??i18n("components.explorer.practicalfeatures.931b4c6458b9")}</span></div>;})}</div></div>
 <div className="practical-library-search"><SearchField aria-label={i18n("components.explorer.practicalfeatures.505ea9c9f199")} placeholder={i18n("components.explorer.practicalfeatures.5ff9d327b5e0")} value={query} onChange={setQuery}/></div>
 <div className="practical-library-layout">
 <nav className="practical-categories" aria-label={i18n("components.explorer.practicalfeatures.a1963a64917e")}>{["全部",...categories].map(c=><Btn key={c} variant="ghost" aria-pressed={category===c} onClick={()=>setCategory(c)}>{c === "全部" ? i18n("components.explorer.practicalfeatures.5c55a67935af") : labelForId(c)}<span>{c==="全部"?entries.length:entries.filter(e=>e.category===c).length}</span></Btn>)}</nav>
 <div className="practical-library-results" aria-live="polite">
 {groups.length?groups.map(group=><section className="practical-service-group" key={group.name}><header><h3>{labelForId(group.name)}</h3><span>{i18nRich("components.explorer.practicalfeatures.42e970981c31", { length: group.entries.length })}</span></header><div className="practical-service-grid">{group.entries.map(entry=>{
 const slot=slots.indexOf("page:"+entry.id);
 return <div className="practical-feature-row" key={entry.id}>
 <Btn className="workbench-catalog-entry practical-feature-open" variant="ghost" onClick={()=>{openTab(entry.page,entry.params??null,{title:entry.name});onClose();}}>
 <FeatureIcon page={entry.page}/><span className="practical-feature-copy"><strong>{entry.name}</strong><small>{entry.note||labelForId(entry.category)||i18n("components.explorer.practicalfeatures.15898013a408")}</small></span>
 </Btn><IconBtn size="sm" variant="ghost" className={"practical-feature-pin"+(slot>=0?" is-pinned":"")} label={i18n("components.explorer.practicalfeatures.cddf4389584d", { name: String(entry.name) })} titleAttr={slot>=0?i18n("components.explorer.practicalfeatures.af335e1f813a", { value: String(slot+1) }):i18n("components.explorer.practicalfeatures.0f6d4250e8fe")} icon={slot>=0?<span>{slot+1}</span>:<IconPlus width={14} height={14}/>} onClick={()=>place(entry)}/>
 </div>;
 })}</div></section>):<div className="practical-no-results"><strong>{i18nRich("components.explorer.practicalfeatures.6d53ec60808b", { query: query })}</strong><Text tone="faint">{i18n("components.explorer.practicalfeatures.97a5b0beb286")}</Text><Btn variant="outline" onClick={()=>{setQuery("");setCategory("全部");}}>{i18n("components.explorer.practicalfeatures.fa2ff3c379a7")}</Btn></div>}
 </div></div>
 <Text className="practical-library-footnote" slot="micro" tone="faint">{i18n("components.explorer.practicalfeatures.1954e6efaf49")}</Text>
 </Modal>;
}
