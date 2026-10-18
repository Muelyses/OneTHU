import {useEffect, useState, useSyncExternalStore} from "react";
import {NAV_REGISTRY} from "./navigation.js";
import {explorerSnapshot, openTab, openWorkspace, subscribeExplorer} from "./explorer.js";
import {openOnePage, userOnePages} from "./onePage.js";
import type {LearnNav, Page} from "./app.js";
export type QuickEntry = {id:string; title:string; kind:"page"|"board"|"workspace"; page?:Page; params?:LearnNav; target?:string};
const KEY="onethu.oneshot.v1", ORDER="onethu.onego.order.v1";
const defaults=["page:learn","page:schedule","page:tasks","page:life"];
function read(key:string,fallback:string[]):string[]{try{const a=JSON.parse(localStorage.getItem(key)??"null");return Array.isArray(a)&&a.every(x=>typeof x==='string')?a:fallback;}catch{return fallback;}}
let shot=read(KEY,defaults).slice(0,4);while(shot.length<4)shot.push(defaults[shot.length]!);
let order=read(ORDER,[]);
const listeners=new Set<()=>void>();
const emit=()=>listeners.forEach(f=>f());
export const subscribeQuick=(f:()=>void)=>{listeners.add(f);return()=>{listeners.delete(f);};};
export function setOneShot(index:number,id:string):void{if(index<0||index>3)return;shot=shot.map((x,i)=>i===index?id:x);try{localStorage.setItem(KEY,JSON.stringify(shot));}catch{}emit();}
export function moveQuickEntry(id:string,before:string):void{const all=quickEntries().filter(e=>e.kind!=="page").map(e=>e.id);const next=all.filter(x=>x!==id);const at=next.indexOf(before);if(at<0)return;next.splice(at,0,id);order=next;try{localStorage.setItem(ORDER,JSON.stringify(order));}catch{}emit();}
export function quickEntries():QuickEntry[]{
 const pages=NAV_REGISTRY.map(e=>({id:'page:'+e.id,title:e.id==='learn'?'网络学堂':e.name,kind:'page' as const,page:e.page,params:e.params}));
 const saved:QuickEntry[]=[...userOnePages().map(b=>({id:'board:'+b.id,title:b.name,kind:'board' as const,target:b.id})),...explorerSnapshot().workspaces.map(w=>({id:'workspace:'+w.id,title:w.name,kind:'workspace' as const,target:w.id}))];
 saved.sort((a,b)=>(order.indexOf(a.id)<0?1e6:order.indexOf(a.id))-(order.indexOf(b.id)<0?1e6:order.indexOf(b.id)));
 return [...pages,...saved];
}
export function useQuickEntries():{entries:QuickEntry[];slots:string[]}{
 const slots=useSyncExternalStore(subscribeQuick,()=>shot,()=>shot);const [,tick]=useState(0);
 useEffect(()=>{const f=()=>tick(x=>x+1);const a=subscribeExplorer(f),b=subscribeQuick(f);window.addEventListener('onethu.boards.changed',f);return()=>{a();b();window.removeEventListener('onethu.boards.changed',f);};},[]);
 return {entries:quickEntries(),slots};
}
export function openQuickEntry(e:QuickEntry):void{
 if(e.kind==='workspace'&&e.target)openWorkspace(e.target);
 else if(e.kind==='board'&&e.target){openOnePage(e.target);openTab('board',null,{title:e.title});}
 else if(e.page)openTab(e.page,e.params??null,{title:e.title});
}
