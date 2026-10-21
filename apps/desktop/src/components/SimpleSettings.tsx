import { t as i18n, msg as i18nMsg, useLocale as useUiLocale } from "../i18n/index.js";
import { PrivacySettings } from "./PrivacyNotice.js";
import { CalendarSyncSettings } from "./CalendarSyncSettings.js";
import { useState } from "react";
import { Btn, Card, Input, Stack, Text, SettingsRow } from "@onethu/gui";
import { LanguageControl } from "./LanguageControl.js";
import { ExperienceModeControl } from "./SimpleExperience.js";
import { OhModelSourceCard } from "./OhModelSourceCard.js";
import { ImSettingsSection } from "./ImSettingsSection.js";
import { YktQrPanel, saveYuketang } from "./ExtHwLoginModal.js";
import { getPlugin, updatePlugin } from "../plugins/registry.js";
import { showToast } from "../state/toast.js";
import { useApp } from "../state/context.js";
import { replayOnboarding } from "./OnboardingTour.js";

export function OptionalConnections() {
  const uiLocale = useUiLocale();

 const [qr,setQr]=useState(false);
 return <Stack gap={3}>
 <Card><SettingsRow title={i18n("components.simplesettings.38b9eabcae1b")} sub={i18n("components.simplesettings.950d624f5068")} control={<Btn variant="outline" onClick={()=>setQr(true)}>{i18n("components.simplesettings.b431a37597fc")}</Btn>}/>
 {qr?<YktQrPanel onCancel={()=>setQr(false)} onSuccess={cookie=>{void saveYuketang(cookie).then(()=>{setQr(false);showToast(i18nMsg("components.simplesettings.36fe6819580c"));}).catch(e=>showToast(String(e)));}}/>:null}</Card>
 <ImSettingsSection tier="basic"/>
 </Stack>;
}
export function SimpleSettings() {
  const uiLocale = useUiLocale();

 const { user, logout }=useApp();
 const [calendarOpen,setCalendarOpen]=useState(false);
 const initial=getPlugin("onethu.harness")?.settings??{};
 const [baseUrl,setBaseUrl]=useState(String(initial.baseUrl??""));
 const [apiKey,setApiKey]=useState(String(initial.apiKey??""));
 const [model,setModel]=useState(String(initial.model??""));
 return <div className="simple-settings"><Stack gap={4}>
 <ExperienceModeControl/>
 <LanguageControl/>
 <PrivacySettings/>
 <OhModelSourceCard/>
 <Card><SettingsRow title={i18n("components.simplesettings.ac794a015ee3")} sub={i18n("components.simplesettings.49454b147354")} control={<Btn variant="outline" onClick={replayOnboarding}>{i18n("components.simplesettings.7c4b06e07cb4")}</Btn>}/>
 <SettingsRow title={i18n("components.simplesettings.99e398c6de5c")} sub={user?.displayName??i18n("components.simplesettings.0a01eee1cd37")} control={<Btn variant="ghost" onClick={()=>void logout()}>{i18n("components.simplesettings.3ab8cc15939f")}</Btn>}/></Card>
 <Card><Stack gap={3}><Text slot="title">{i18n("components.simplesettings.230b7d15300f")}</Text>
 <Input aria-label={i18n("components.simplesettings.d94c3fb87662")} placeholder={i18n("components.simplesettings.f9ae83ae1e0f")} value={baseUrl} onChange={setBaseUrl}/>
 <Input aria-label="API Key" placeholder="API Key" type="password" value={apiKey} onChange={setApiKey}/>
 <Input aria-label={i18n("components.simplesettings.cb2f1709f983")} placeholder={i18n("components.simplesettings.cb2f1709f983")} value={model} onChange={setModel}/>
 <Btn variant="solid" onClick={()=>{
 const plugin=getPlugin("onethu.harness"); if(!plugin){showToast(i18nMsg("components.simplesettings.1fa9a1f5453b"));return;}
 try{const u=new URL(baseUrl);if(!["https:","http:"].includes(u.protocol))throw new Error();}catch{showToast(i18nMsg("components.simplesettings.b975feac2d32"));return;}
 if(!apiKey.trim()||!model.trim()){showToast(i18nMsg("components.simplesettings.cde6c2804c9d"));return;}
 updatePlugin("onethu.harness",{settings:{...plugin.settings,provider:"custom",baseUrl:baseUrl.trim(),apiKey:apiKey.trim(),model:model.trim()}});showToast(i18nMsg("components.simplesettings.7ef3aed84e34"));
 }}>{i18n("components.simplesettings.a15f3b20eaec")}</Btn></Stack></Card>
 <Card><SettingsRow title={i18n("components.simplesettings.bccf98c5f9fa")} sub={i18n("components.simplesettings.553df7f47b1a")} control={<Btn variant="outline" onClick={()=>setCalendarOpen(v=>!v)}>{calendarOpen?i18n("components.simplesettings.afd4b783536b"):i18n("components.simplesettings.d7d18c1f3213")}</Btn>}/></Card>
 {calendarOpen?<CalendarSyncSettings/>:null}
 <OptionalConnections/>
 </Stack></div>;
}
