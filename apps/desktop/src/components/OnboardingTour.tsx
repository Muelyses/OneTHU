import { useEffect, useState } from "react";
import { Btn, Modal, Stack, Text, Inline, Spacer, Progress } from "@onethu/gui";
import { experienceMode, setExperienceMode, type ExperienceMode } from "../state/experienceMode.js";
import { openTab } from "../state/explorer.js";
import { OptionalConnections } from "./SimpleSettings.js";
import { TOUR_CARD_SCOPE, defineOnboardingScopes } from "./OnboardingTourScope.js";

const KEY="onethu.onboarded.flow4";
const REPLAY="onethu.onboarding.replay";
export function replayOnboarding(){window.dispatchEvent(new Event(REPLAY));}
type Lesson={id:string;title:string;lead:string;steps:string[];page?:"homepage"|"vault"|"contacts";action?:string};
export const FULL_LESSONS:Lesson[]=[
 {id:"board",title:"白板，把常用内容放到手边",lead:"首页也是一块白板。布局由你决定，不用每次从目录里找。",steps:["进入首页的编辑状态，添加课程、待办、便笺等组件。","拖动组件的把手调整位置，拖动边角改变大小；退出编辑即可正常使用。","OneGO 可以保存和打开独立白板与工作区。"],page:"homepage",action:"去看看白板"},
 {id:"vault",title:"暂存箱，先收起来再处理",lead:"课程、文字、文件或名片，都可以先放进同一个箱子。",steps:["按住内容，等箱子与 OH 胶囊亮起，再开始拖动。","拖到箱子上是暂存，拖到 OH 胶囊上是交给小 OH。","点击箱子展开雷达；打开清单可以整理内容或切换箱子。"],page:"vault",action:"打开暂存箱"},
 {id:"code",title:"一个短口令，传递一组内容",lead:"口令是联网取回内容的钥匙。接收方不必自己拼装白板或文件。",steps:["在暂存箱点击「分享口令」，生成后复制给对方。","对方点「接收」粘贴口令，或识别分享二维码。","分享前确认箱子里的内容；收到的内容会进入暂存箱。"],page:"vault",action:"查看收发入口"},
 {id:"nfc",title:"碰一碰，让内容接力",lead:"有 NFC 的设备，可以用触碰传递同一份分享口令。",steps:["先准备分享内容，再选择 NFC 传送；另一台设备选择 NFC 接收。","按设备提示靠近，看到成功反馈后再分开。","NFC 需要设备和系统支持。没有 NFC 时，口令和二维码一样可用。"],page:"vault",action:"查看设备支持"},
 {id:"organization",title:"组织，把人和事情放在一起",lead:"创建组织后，名片与组织绑定，不需要再单独制作一张。",steps:["在通讯录的组织中创建组织，添加成员并管理角色。","用文件、项目和公告整理资料、进度与通知。","通过组织口令邀请他人；名片随组织资料一起更新。"],page:"contacts",action:"打开组织"},
];
const SIMPLE_LESSONS:Lesson[]=[
 {id:"today",title:"首页，只关心今天",lead:"打开就看到待办与要上的课程。没有需要整理的标签和白板。",steps:["点一条待办查看详情，点课程进入课程内容。","随时点左上角「首页」回来。"]},
 {id:"quick",title:"五个入口，直接到达",lead:"学习、预约、生活、信息、课表，始终在底部。",steps:["学习里看课程与作业，预约里找场馆和研讨间。","生活与信息汇集校园服务，课表里查看时间安排。","OH 与搜索胶囊保持可用；在设置中填写自己的 API。"]},
];
function shouldStart(){try{return !localStorage.getItem(KEY)&&!localStorage.getItem("onethu.onboarded.flow3")&&!localStorage.getItem("onethu.onboarded.phone");}catch{return false;}}
export function OnboardingTour(){
 const [open,setOpen]=useState(shouldStart),[chosen,setChosen]=useState<ExperienceMode>(experienceMode),[step,setStep]=useState(-1),[practice,setPractice]=useState(false),[connect,setConnect]=useState(false);
 const lessons=chosen==="simple"?SIMPLE_LESSONS:FULL_LESSONS;
 const last=step===lessons.length, lesson=lessons[step] ?? lessons[0]!;
 useEffect(()=>{const replay=()=>{setChosen(experienceMode());setStep(-1);setPractice(false);setConnect(false);setOpen(true);};window.addEventListener(REPLAY,replay);return()=>window.removeEventListener(REPLAY,replay);},[]);
 const finish=()=>{try{localStorage.setItem(KEY,"1");}catch{}setOpen(false);setPractice(false);};
 if(!open)return null;
 defineOnboardingScopes();
 if(practice)return <aside className="tour-resume" role="status"><Text>正在体验：{lesson?.title}</Text><Btn variant="solid" onClick={()=>setPractice(false)}>继续导览</Btn><Btn variant="ghost" onClick={finish}>结束导览</Btn></aside>;
 return <Modal open onClose={finish} closeButton={false} size="md" scope={TOUR_CARD_SCOPE} aria-label="OneTHU 使用导览" foot={<Inline gap={2} wrap>
 <Btn variant="outline" disabled={step<0} onClick={()=>{setStep(s=>s-1);setConnect(false);}}>上一步</Btn><Spacer/>
 <Btn variant="ghost" onClick={finish}>跳过导览</Btn>
 <Btn variant="solid" onClick={()=>{if(step===-1)setExperienceMode(chosen);if(last)finish();else setStep(s=>s+1);}}>{step===-1?"按此模式开始":last?"开始使用":"下一步"}</Btn>
 </Inline>}>
 <Stack gap={4}>
 <Text slot="micro" tone="faint">{step<0?"欢迎来到 OneTHU":`${chosen==="simple"?"极简":"完整"}模式 · ${step+1} / ${lessons.length+1}`}</Text>
 <Progress size="sm" value={step<0?0:(step+1)/(lessons.length+1)}/>
 {step<0?<><Text as="h2" slot="title">你想怎样使用 OneTHU？</Text><div className="tour-mode-options">
 {(["simple","full"] as const).map(m=><Btn key={m} variant={chosen===m?"solid":"outline"} aria-pressed={chosen===m} onClick={()=>setChosen(m)}><span><strong>{m==="simple"?"极简模式":"完整模式"}</strong><small>{m==="simple"?"只看今天 · 五个快捷入口":"自由白板 · 内容传递 · 组织管理"}</small></span></Btn>)}
 </div><Text tone="faint">以后可以在设置里切换。已有标签、白板和完整模式设置都会原样保留。</Text></>:last?<>
 <Text as="h2" slot="title">需要时，再连接</Text><Text>可选连接雨课堂同步作业，或扫码连接微信、飞书，在熟悉的聊天里使用 OH。现在不连接，也可以直接开始。</Text>
 <Btn variant="outline" onClick={()=>setConnect(!connect)}>{connect?"收起连接选项":"选择扫码连接"}</Btn>{connect?<OptionalConnections/>:null}
 </>:<><Text as="h2" slot="title">{lesson.title}</Text><Text>{lesson.lead}</Text><ol className="tour-steps">{lesson.steps.map(s=><li key={s}>{s}</li>)}</ol>
 {lesson.page?<Btn variant="outline" onClick={()=>{openTab(lesson.page!, lesson.page==="contacts"?{section:"orgs"} as never:null);setPractice(true);}}>{lesson.action}</Btn>:null}</>}
 </Stack></Modal>;
}
