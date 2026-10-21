import { useState } from "react";
import { Btn, Card, Checkbox, SettingsRow, Stack, Switch } from "@onethu/gui";
import { localeTable, t } from "../i18n/index.js";
import { savePrivacyConsent, usePrivacyConsent, type PrivacyConsent } from "../state/privacyConsent.js";
import { showToast } from "../state/toast.js";
export function privacyBilingual(part: string): string {
  return [localeTable("zh-CN")["privacy."+part], localeTable("en-US")["privacy."+part]].join(" / ");
}
function Bilingual({part}: {part:string}) {
  return <><span lang="zh-CN">{localeTable("zh-CN")["privacy."+part]}</span><span lang="en-US">{localeTable("en-US")["privacy."+part]}</span></>;
}
export function PrivacyNotice({value,onChange}: {value:PrivacyConsent;onChange:(v:PrivacyConsent)=>void}) {
  return <section className="privacy-notice" aria-labelledby="privacy-title">
    <header><h2 id="privacy-title"><Bilingual part="title"/></h2><p><Bilingual part="lead"/></p></header>
    <div className="privacy-notice-sections">
      {["local","disclaimer","cloud","oh"].map(id=><section key={id}><h3><Bilingual part={id+"Title"}/></h3><p><Bilingual part={id+"Body"}/></p>{id === "cloud" ? <p><Bilingual part="revokeGuide"/></p> : null}
      {id === "cloud" || id === "oh" ? <div className="privacy-permission"><div><strong><Bilingual part={id+"Toggle"}/></strong><p><Bilingual part={id+"Effect"}/></p></div><Switch checked={value[id]} aria-label={privacyBilingual(id+"Toggle")} onChange={checked=>onChange({...value,[id]:checked})}/></div> : null}
      </section>)}
    </div>
    <p className="privacy-withdraw"><Bilingual part="withdraw"/></p>
    <Checkbox checked={value.acknowledged} onChange={checked=>onChange({...value,acknowledged:checked})} label={<span className="privacy-ack"><Bilingual part="ack"/></span>}/>
  </section>;
}
/** Always reachable in compact settings, so consent can be granted or withdrawn. */
export function PrivacySettings() {
  const consent=usePrivacyConsent();
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false);
  const [draft,setDraft]=useState(consent);
  return <Card><Stack gap={3}>
    <SettingsRow title={t("privacy.settings")} sub={t("privacy.withdraw")} control={<Btn variant="outline" onClick={()=>{setDraft(consent);setOpen(v=>!v);}}>{t("privacy.review")}</Btn>}/>
    {open?<><PrivacyNotice value={draft} onChange={setDraft}/><Btn variant="solid" disabled={!draft.acknowledged||busy} onClick={()=>{
      setBusy(true);void savePrivacyConsent(draft).then(()=>{setOpen(false);showToast(t("privacy.saved"));}).catch(e=>showToast(String(e))).finally(()=>setBusy(false));
    }}>{t("privacy.continue")}</Btn></>:null}
  </Stack></Card>;
}
