import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Btn, Card, List, Row, Segment, Select, Stack, Text } from "@onethu/gui";
import { IdentityCard } from "./IdentityCard.js";
import { addOrgMember, removeOrgMember, setOrgMemberRole, updateOrg, orgIdentityCard, saveOrgProject, deleteOrgProject, saveOrgAnnouncement, deleteOrgAnnouncement, type Org, type OrgProject, type OrgAnnouncement, type OrgRole } from "../state/org.js";
import { openFormModal } from "../lib/formModal.js";
import { confirmOk } from "../lib/confirm.js";
import { showToast } from "../state/toast.js";
import { ensureSeafileLoaded, getSeafileToken, openDir, seafileUpload, seafileDownload, type SeafileEntry } from "../state/seafile.js";
import { stageFromPicker } from "../lib/fileChannel.js";
import { openTab } from "../state/explorer.js";
import { addToVault } from "../state/vault.js";
import { orgCardCatch } from "../state/nameCard.js";

function OrgFiles({org,onCreate}:{org:Org;onCreate:()=>void}){
 const [entries,setEntries]=useState<SeafileEntry[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [subdir,setSubdir]=useState<string[]>([]);
 const base=org.cloudPath.replace(/\/$/,""), path=[base,...subdir].join("/");
 async function refresh(){setBusy(true);setError("");try{await ensureSeafileLoaded();if(!getSeafileToken())throw new Error("请先连接清华云盘");setEntries(await openDir(org.cloudRepoId,path,true));}catch(e){setError(String(e));}finally{setBusy(false);}}
 useEffect(()=>{if(org.cloudRepoId)void refresh();},[org.cloudRepoId,path]);
 async function run(action:()=>Promise<unknown>){setBusy(true);try{await action();await refresh();}catch(e){showToast(String(e));}finally{setBusy(false);}}
 if(!org.cloudRepoId)return <Stack gap={3}><Text>为这个组织创建独立文件夹，集中保存资料。</Text><Btn variant="solid" onClick={onCreate}>创建文件空间</Btn><Btn variant="ghost" onClick={()=>openTab("cloud")}>连接清华云盘</Btn></Stack>;
 return <Stack gap={3}><div className="name-card-actions">
 <Btn variant="outline" disabled={busy} onClick={()=>void run(async()=>{const files=await stageFromPicker();for(const f of files){if(!f.localPath)throw new Error("文件未能暂存，请在 OneTHU App 中重试");if(entries.some(e=>e.name===f.name)&&!await confirmOk(`替换已有文件「${f.name}」？`))continue;await seafileUpload(org.cloudRepoId,path,f.localPath,true);}})}>上传文件</Btn>
 <Btn variant="ghost" disabled={busy} onClick={()=>void refresh()}>刷新</Btn>
 {subdir.length?<Btn variant="ghost" onClick={()=>setSubdir(s=>s.slice(0,-1))}>上一级</Btn>:null}
 </div><Text slot="micro" tone="faint">{subdir.length?subdir.join(" / "):"组织文件"}</Text>
 {error?<Text>{error}</Text>:null}{!entries.length&&!busy&&!error?<Text tone="faint">还没有文件，上传第一份资料吧。</Text>:null}
 <List divided>{entries.map(e=><Row key={e.name} title={e.name} sub={e.kind==="dir"?"文件夹":`${Math.ceil(e.size/1024)} KB`} onClick={()=>{if(e.kind==="dir")setSubdir(s=>[...s,e.name]);else void run(()=>seafileDownload(org.cloudRepoId,path+"/"+e.name));}} trailing={<Btn variant="ghost" size="sm" tone="error" disabled={busy} onClick={ev=>{ev.stopPropagation();void confirmOk(`从组织云盘删除「${e.name}」${e.kind==="dir"?"及其中所有文件":""}？此操作不可恢复。`).then(ok=>{if(ok)void run(()=>invoke("seafile_delete",{token:getSeafileToken(),repoId:org.cloudRepoId,path:path+"/"+e.name,kind:e.kind}));});}}>删除</Btn>}/>)}</List></Stack>;
}
export function OrganizationWorkspace({org,onInvite,onCreateSpace}:{org:Org;onInvite:()=>void;onCreateSpace:()=>void}){
 const [tab,setTab]=useState("members");
 async function editProject(project?:OrgProject){const f=await openFormModal(project?"编辑项目":"新建项目",[{key:"name",label:"项目名称",required:true,default:project?.name},{key:"description",label:"项目说明",kind:"textarea",default:project?.description},{key:"owner",label:"负责人",default:project?.owner}]);if(f)saveOrgProject(org.id,{id:project?.id,name:f.name!,description:f.description??"",owner:f.owner??"",status:project?.status??"planned"});}
 async function editNotice(notice?:OrgAnnouncement){const f=await openFormModal(notice?"编辑公告":"发布公告",[{key:"title",label:"公告标题",required:true,default:notice?.title},{key:"body",label:"公告内容",kind:"textarea",required:true,default:notice?.body}]);if(f)saveOrgAnnouncement(org.id,{id:notice?.id,title:f.title!,body:f.body!,pinned:notice?.pinned??false});}
 return <Stack gap={4}><Segment aria-label="组织管理" value={tab} onChange={setTab} options={[{value:"members",label:"成员"},{value:"files",label:"文件"},{value:"projects",label:"项目"},{value:"announcements",label:"公告"},{value:"card",label:"组织名片"}]}/>
 {tab==="members"?<><div className="name-card-actions"><Btn variant="solid" onClick={()=>void openFormModal("添加成员",[{key:"name",label:"成员名字",required:true}]).then(f=>{if(f?.name){const r=addOrgMember(org.id,f.name);showToast(r.ok?"成员已加入":"成员已存在或名称无效");}})}>添加成员</Btn><Btn variant="outline" onClick={onInvite}>邀请口令</Btn></div>
 <Text slot="micro" tone="faint">这里管理本机组织名册。角色不会自动授予云盘访问权限。</Text>
 <List divided>{org.members.map(m=><Row key={m.id} title={m.name} trailing={<div className="name-card-actions"><Select aria-label={`${m.name}的角色`} value={m.role} onChange={v=>{if(!setOrgMemberRole(org.id,m.id,v as OrgRole))showToast("至少保留一位组织负责人");}}><option value="owner">负责人</option><option value="member">成员</option><option value="guest">访客</option></Select><Btn variant="ghost" tone="error" size="sm" onClick={()=>void confirmOk(`移除成员「${m.name}」？`).then(ok=>{if(ok&&!removeOrgMember(org.id,m.id))showToast("至少保留一位组织负责人");})}>移除</Btn></div>}/>)}</List></>:null}
 {tab==="files"?<OrgFiles org={org} onCreate={onCreateSpace}/>:null}
 {tab==="projects"?<><Btn variant="solid" onClick={()=>void editProject()}>新建项目</Btn>{!(org.projects?.length)?<Text tone="faint">把组织要做的事建成项目，记录负责人和进度。</Text>:null}{(org.projects??[]).map(p=><Card key={p.id}><Stack gap={2}><Text slot="title">{p.name}</Text><Text>{p.description||"暂无说明"}</Text><Text slot="micro">负责人：{p.owner||"待分配"}</Text><div className="name-card-actions"><Select aria-label={`${p.name}的进度`} value={p.status} onChange={v=>saveOrgProject(org.id,{...p,status:v as OrgProject["status"]})}><option value="planned">计划中</option><option value="active">进行中</option><option value="done">已完成</option></Select><Btn variant="ghost" onClick={()=>void editProject(p)}>编辑</Btn><Btn variant="ghost" tone="error" onClick={()=>void confirmOk(`删除项目「${p.name}」？`).then(ok=>{if(ok)deleteOrgProject(org.id,p.id);})}>删除</Btn></div></Stack></Card>)}</>:null}
 {tab==="announcements"?<><Btn variant="solid" onClick={()=>void editNotice()}>发布公告</Btn>{!org.announcements?.length?<Text tone="faint">还没有公告。</Text>:null}{[...(org.announcements??[])].sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.updatedAt-a.updatedAt).map(n=><Card key={n.id}><Stack gap={2}><Text slot="title">{n.pinned?"置顶 · ":""}{n.title}</Text><div className="org-notice-body">{n.body}</div><div className="name-card-actions"><Btn variant="ghost" onClick={()=>saveOrgAnnouncement(org.id,{...n,pinned:!n.pinned})}>{n.pinned?"取消置顶":"置顶"}</Btn><Btn variant="ghost" onClick={()=>void editNotice(n)}>编辑</Btn><Btn variant="ghost" tone="error" onClick={()=>void confirmOk(`删除公告「${n.title}」？`).then(ok=>{if(ok)deleteOrgAnnouncement(org.id,n.id);})}>删除</Btn></div></Stack></Card>)}</>:null}
 {tab==="card"?<><IdentityCard card={orgIdentityCard(org)} organization variant="detail"/><div className="name-card-actions"><Btn variant="solid" onClick={onInvite}>分享组织口令</Btn><Btn variant="outline" onClick={()=>{const r=addToVault(orgCardCatch(orgIdentityCard(org)));showToast(r.ok?"已放进暂存箱":"暂存箱中已有这张名片");}}>放进暂存箱</Btn><Btn variant="ghost" onClick={()=>void openFormModal("编辑组织资料",[{key:"name",label:"组织名称",required:true,default:org.name},{key:"brief",label:"简介",kind:"textarea",default:org.brief},{key:"joinUrl",label:"加入链接",default:org.joinUrl}]).then(f=>{if(f)updateOrg(org.id,f);})}>编辑组织资料</Btn></div><Text slot="micro" tone="faint">名片自动使用当前组织资料，无需另外创建。</Text></>:null}
 </Stack>;
}
