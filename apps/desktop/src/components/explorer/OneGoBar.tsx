import { t as i18n, msg as i18nMsg, useLocale as useUiLocale } from "../../i18n/index.js";
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {Btn,IconBtn} from '@onethu/gui';
import {useIsPhone} from '../../state/phoneSheets.js';
import {moveQuickEntry,openQuickEntry,useQuickEntries,type QuickEntry} from '../../state/quickAccess.js';
import {openOneGoSheet} from './OneGoSheet.js';
import {openContextMenu} from './ContextMenu.js';
import {openWorkspaceEditor} from './WorkspaceEditor.js';
import {renameOnePage,removeOnePage} from '../../state/onePage.js';
import {openFolderIconPicker} from './FolderIconPicker.js';
import {openFormModal} from '../../lib/formModal.js';
import {confirmOk} from '../../lib/confirm.js';
import {addToVault,type VaultCatch} from '../../state/vault.js';
import {showToast} from '../../state/toast.js';
import {IconFist,IconTriangleDown} from '../Icons.js';
import {QuickIcon} from './OneShot.js';
export function quickCatch(e:QuickEntry):VaultCatch{return {type:'payload',title:e.title,sub:e.kind==='board'?'OnePage':i18n("components.explorer.onegobar.37979829426b"),payload:{kind:'quick-entry',entry:e},source:'OneGO!'};}
export function OneGoBar(){
  const uiLocale = useUiLocale();

 const phone=useIsPhone();const {entries}=useQuickEntries();const saved=entries.filter(e=>e.kind!=='page');
 const ref=useRef<HTMLDivElement>(null);const measure=useRef<HTMLDivElement>(null);const [limit,setLimit]=useState(0);const [overflow,setOverflow]=useState(false);const dragged=useRef<string|null>(null);
 useLayoutEffect(()=>{const el=ref.current,probe=measure.current;if(!el||!probe)return;const fit=()=>{let w=0,n=0;for(const c of Array.from(probe.children)){const cw=c.getBoundingClientRect().width+4;if(w+cw>el.clientWidth-36)break;w+=cw;n++;}setLimit(n);};fit();const ro=new ResizeObserver(fit);ro.observe(el);return()=>ro.disconnect();},[saved.map(e=>e.id+e.title).join('|'),phone]);
 useEffect(()=>{if(!overflow)return;const f=(e:PointerEvent)=>{if(!(e.target as Element)?.closest('.onego-bookmarks'))setOverflow(false);};const k=(e:KeyboardEvent)=>{if(e.key==='Escape')setOverflow(false);};window.addEventListener('pointerdown',f);window.addEventListener('keydown',k);return()=>{window.removeEventListener('pointerdown',f);window.removeEventListener('keydown',k);};},[overflow]);
 if(phone)return null;
 const menu=(e:QuickEntry,x:number,y:number)=>openContextMenu(x,y,[
  {label:i18n("components.explorer.onegobar.c771248e511f"),onSelect:()=>openQuickEntry(e)},
  ...(e.kind==='board'?[{label:i18n("components.explorer.onegobar.ec4cd05f5147"),onSelect:()=>{void openFormModal(i18nMsg("components.explorer.onegobar.0c898fe25ba6"),[{key:'name',label:i18nMsg("components.explorer.onegobar.d44e9b3d3b31"),required:true,default:e.title}]).then(f=>{if(f?.name)renameOnePage(e.target!,f.name);});}},{label:i18n("components.explorer.onegobar.810c7fbfef76"),onSelect:()=>openFolderIconPicker(e.target!)},{label:i18n("components.explorer.onegobar.0552e329ccf8"),danger:true,onSelect:()=>{void confirmOk(i18nMsg("components.explorer.onegobar.c98097f4a6d7", { title: String(e.title) })).then(ok=>{if(ok)removeOnePage(e.target!);});}}]:[{label:i18n("components.explorer.onegobar.c6d80849d9f5"),onSelect:()=>openWorkspaceEditor(e.target!)}]),
  {label:i18n("components.explorer.onegobar.17eac802d3f7"),onSelect:()=>{const r=addToVault(quickCatch(e));showToast(r.ok?i18nMsg("components.explorer.onegobar.4cfe5f20b9dd"):i18nMsg("components.explorer.onegobar.eaaa11207297"));}},
  {label:i18n("components.explorer.onegobar.e933dda58744"),onSelect:()=>{if(saved[0])moveQuickEntry(e.id,saved[0].id);}},
 ]);
 const item=(e:QuickEntry,measuring=false)=><Btn key={e.id} className="onego-bookmark" size="sm" icon={<QuickIcon entry={e}/>} titleAttr={e.title} tabIndex={measuring?-1:0} draggable={!measuring} data-vault-catch={measuring?undefined:JSON.stringify(quickCatch(e))} data-vault-reorder={measuring?undefined:'true'} onClick={()=>{openQuickEntry(e);setOverflow(false);}} onContextMenu={ev=>{ev.preventDefault();menu(e,ev.clientX,ev.clientY);}} onDragStart={ev=>{dragged.current=e.id;ev.dataTransfer.setData('text/onethu-onego',e.id);ev.dataTransfer.effectAllowed='move';}} onDragOver={ev=>{if(dragged.current)ev.preventDefault();}} onDrop={ev=>{ev.preventDefault();if(dragged.current)moveQuickEntry(dragged.current,e.id);dragged.current=null;}} onDragEnd={()=>{dragged.current=null;}}>{e.title}</Btn>;
 return <nav className="onego-bookmarks" aria-label={i18n("components.explorer.onegobar.2d1cb40d3c6d")}>
 <Btn className="onego-manager" variant="solid" size="sm" icon={<IconFist width={16} height={16}/>} onClick={openOneGoSheet}>OneGO!</Btn>
 <div className="onego-bookmark-track" ref={ref}>{saved.slice(0,limit).map(e=>item(e))}{saved.length===0?<span className="onego-bookmark-empty">{i18n("components.explorer.onegobar.a1b27175f9e6")}</span>:null}</div>
 {saved.length>limit?<IconBtn size="sm" label={i18n("components.explorer.onegobar.eef22ab3c4a8")} aria-expanded={overflow} icon={<IconTriangleDown width={12} height={12}/>} onClick={()=>setOverflow(v=>!v)}/>:null}
 <div ref={measure} className="onego-bookmark-measure" aria-hidden="true" inert>{saved.map(e=>item(e,true))}</div>
 {overflow?<div className="onego-bookmark-overflow" aria-label={i18n("components.explorer.onegobar.eef22ab3c4a8")}>{saved.slice(limit).map(e=>item(e))}</div>:null}
 </nav>;
}
