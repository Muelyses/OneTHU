import { useState } from "react";
import { Btn, Card, Input, Stack, Text, SettingsRow } from "@onethu/gui";
import { ExperienceModeControl } from "./SimpleExperience.js";
import { ImSettingsSection } from "./ImSettingsSection.js";
import { YktQrPanel, saveYuketang } from "./ExtHwLoginModal.js";
import { getPlugin, updatePlugin } from "../plugins/registry.js";
import { showToast } from "../state/toast.js";
import { useApp } from "../state/context.js";
import { replayOnboarding } from "./OnboardingTour.js";

export function OptionalConnections() {
 const [qr,setQr]=useState(false);
 return <Stack gap={3}>
 <Card><SettingsRow title="雨课堂" sub="扫码同步雨课堂作业；随时可以稍后连接。" control={<Btn variant="outline" onClick={()=>setQr(true)}>扫码连接</Btn>}/>
 {qr?<YktQrPanel onCancel={()=>setQr(false)} onSuccess={cookie=>{void saveYuketang(cookie).then(()=>{setQr(false);showToast("雨课堂已连接");}).catch(e=>showToast(String(e)));}}/>:null}</Card>
 <ImSettingsSection tier="basic"/>
 </Stack>;
}
export function SimpleSettings() {
 const { user, logout }=useApp();
 const initial=getPlugin("onethu.harness")?.settings??{};
 const [baseUrl,setBaseUrl]=useState(String(initial.baseUrl??""));
 const [apiKey,setApiKey]=useState(String(initial.apiKey??""));
 const [model,setModel]=useState(String(initial.model??""));
 return <div className="simple-settings"><Stack gap={4}>
 <ExperienceModeControl/>
 <Card><SettingsRow title="使用导览" sub="重新选择模式，或了解当前模式。" control={<Btn variant="outline" onClick={replayOnboarding}>重新查看</Btn>}/>
 <SettingsRow title="统一认证" sub={user?.displayName??"已登录"} control={<Btn variant="ghost" onClick={()=>void logout()}>退出登录</Btn>}/></Card>
 <Card><Stack gap={3}><Text slot="title">小 OH · 自己的 API</Text>
 <Input aria-label="API 地址" placeholder="API 地址（https://…/v1）" value={baseUrl} onChange={setBaseUrl}/>
 <Input aria-label="API Key" placeholder="API Key" type="password" value={apiKey} onChange={setApiKey}/>
 <Input aria-label="模型名称" placeholder="模型名称" value={model} onChange={setModel}/>
 <Btn variant="solid" onClick={()=>{
 const plugin=getPlugin("onethu.harness"); if(!plugin){showToast("小 OH 正在准备，请稍后再试");return;}
 try{const u=new URL(baseUrl);if(!["https:","http:"].includes(u.protocol))throw new Error();}catch{showToast("请输入有效的 API 地址");return;}
 if(!apiKey.trim()||!model.trim()){showToast("请填写 API Key 和模型名称");return;}
 updatePlugin("onethu.harness",{settings:{...plugin.settings,provider:"custom",baseUrl:baseUrl.trim(),apiKey:apiKey.trim(),model:model.trim()}});showToast("API 配置已保存");
 }}>保存 API</Btn></Stack></Card>
 <OptionalConnections/>
 </Stack></div>;
}
