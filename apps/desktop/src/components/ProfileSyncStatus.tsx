import { useEffect, useSyncExternalStore } from "react";
import { Btn, Inline, Modal, Stack, Text, IconTrash } from "@onethu/gui";
import { t, useLocale } from "../i18n/index.js";
import { profileSyncStatus, profileSyncConflicts, profileSyncSelection, selectProfileConflict, resolveProfileSync, requestProfileSync, subscribeProfileSync } from "../state/profileSync.js";
import { resolvedProfileValue, profileConflictPaths, profileConflictId, type ProfileConflict } from "../state/profileSyncCore.js";
import { useExperienceMode } from "../state/experienceMode.js";
import { IdentityCard } from "./IdentityCard.js";
import type { PersonalCard, OrgCard } from "../state/nameCard.js";
import "../styles/profile-sync.css";

function fieldValue(value: any, path: string): any {
  if (!path || value == null) return value;
  const rows = Array.isArray(value) ? Object.fromEntries(value.map(v=>[v.id??v.repoId,v])) : value;
  if (typeof rows !== "object") return undefined;
  const key = Object.keys(rows).sort((a,b)=>b.length-a.length).find(k=>path===k || path.startsWith(k+"."));
  return key ? fieldValue(rows[key], path.slice(key.length+1)) : undefined;
}
export function ProfileSyncStatus({ host = false }: { host?: boolean } = {}) {
  useLocale();
  const full = useExperienceMode() === "full";
  const status = useSyncExternalStore(subscribeProfileSync, profileSyncStatus, profileSyncStatus);
  const conflicts = useSyncExternalStore(subscribeProfileSync, profileSyncConflicts, profileSyncConflicts);
  const selected = useSyncExternalStore(subscribeProfileSync,profileSyncSelection,profileSyncSelection);
  const setSelected = selectProfileConflict;
  const conflict = conflicts.find(c=>profileConflictId(c)===selected);
  useEffect(()=>{
    if (!host || !full || conflict) return;
    if(conflicts[0])setSelected(profileConflictId(conflicts[0]));
  },[conflicts,conflict,full,host]);
  const labels = {
    offline:t("profile.sync.offline"),pending:t("profile.sync.pending"),syncing:t("profile.sync.syncing"),
    synced:t("profile.sync.synced"),paused:t("profile.sync.paused"),conflict:t("profile.sync.conflict"),
  };
  const fields:Record<string,string> = {
    name:t("profile.field.name"),bio:t("profile.field.bio"),phone:t("profile.field.phone"),website:t("profile.field.website"),social:t("profile.field.social"),
    brief:t("profile.field.brief"),note:t("profile.field.note"),members:t("profile.field.members"),role:t("profile.field.role"),email:t("profile.field.email"),
    projects:t("profile.field.projects"),announcements:t("profile.field.announcements"),title:t("profile.field.title"),body:t("profile.field.body"),description:t("profile.field.description"),
    status:t("profile.field.status"),libraries:t("profile.field.libraries"),gitlabRepos:t("profile.field.gitlabRepos"),avatar:t("profile.field.image"),src:t("profile.field.image"),cover:t("profile.field.image"),owner:t("profile.field.owner"),
  };
  const fieldLabel = (c:ProfileConflict,path:string) => {
    const trail=path===c.key?"":path.slice(c.key.length+1);
    const label=fields[trail.split(".").at(-1)??""]??t("profile.sync.record");
    const parent=trail.includes(".")?trail.slice(0,trail.lastIndexOf(".")):"";
    const context=fieldValue(c.local.value,parent)??fieldValue(c.remote.value,parent);
    return /^(members|projects|announcements|libraries|gitlabRepos)\./.test(parent)&&context?.name?`${context.name} · ${label}`:label;
  };
  const display = (value:any,path:string) => {
    if(value==null)return t("profile.sync.deleted");
    if(value==="")return t("profile.sync.notSet");
    if(/token|secret|invite|shared|shareUrl/i.test(path))return t("profile.sync.privateValue");
    const words:Record<string,string>={owner:t("profile.role.owner"),member:t("profile.role.member"),guest:t("profile.role.guest"),planned:t("profile.status.planned"),active:t("profile.status.active"),done:t("profile.status.done")};
    if(path.endsWith(".role")||path.endsWith(".status"))return words[value]??String(value);
    if(typeof value==="string"&&/^data:image\/(?:png|jpeg|webp);base64,/.test(value))return <img className="profile-sync-diff-image" src={value} alt={t("profile.field.image")} />;
    if(typeof value==="object")return Array.isArray(value)?value.map(v=>v.name??v.title??t("profile.sync.record")).join(" · "):value.name??value.title??t("profile.sync.record");
    return String(value);
  };
  const choose = (c:ProfileConflict,choice:"local"|"remote") => { resolveProfileSync(profileConflictId(c),choice); setSelected(null); };
  const renderChoices = (c:ProfileConflict) => {
    const local=resolvedProfileValue(c,"local"),remote=resolvedProfileValue(c,"remote");
    const personal=c.key==="personal"||c.key.startsWith("contact:")&&((c.local.value??c.remote.value) as any)?.kind==="personal";
    const options:Array<{kind:"local"|"remote";label:string;value:typeof local}>=[
      {kind:"local",label:t("profile.sync.thisDevice"),value:local},{kind:"remote",label:t("profile.sync.otherDevice"),value:remote},
    ];
    return <div className="profile-sync-choices">{options.map(option=>{
      const data:any=option.value;
      const card:PersonalCard|OrgCard=data?.card??data;
      return <section className="profile-sync-choice" key={option.kind}>
        <Text slot="label">{option.label}</Text>
        {data?<IdentityCard card={card} organization={!personal} />:<div className="profile-sync-deleted"><IconTrash size="lg"/><Text>{t("profile.sync.deletedHere")}</Text></div>}
        <div className="profile-sync-differences">{profileConflictPaths(c).map(path=>{
          const trail=path===c.key?"":path.slice(c.key.length+1);
          return <div className="profile-sync-difference" key={path}><Text slot="micro" tone="faint">{fieldLabel(c,path)}</Text><strong>{display(fieldValue(data,trail),path)}</strong></div>;
        })}</div>
        <Btn block variant={option.kind==="remote"?"solid":"outline"} tone={data===null?"error":"brand"} onClick={()=>choose(c,option.kind)}>
          {data===null?t("profile.sync.confirmDelete"):personal?(option.kind==="local"?t("profile.sync.keepCard"):t("profile.sync.useOtherCard")):(option.kind==="local"?t("profile.sync.keepVersion"):t("profile.sync.useOtherVersion"))}
        </Btn>
      </section>;
    })}</div>;
  };
  return <Stack gap={2}>
    {!host?<Inline gap={2} wrap><span role="status"><Text slot="micro" tone={status==="paused"?"error":"faint"}>{labels[status]}</Text></span>
      <Btn size="sm" variant="ghost" disabled={status==="syncing"||status==="offline"} onClick={requestProfileSync}>{t("profile.sync.now")}</Btn>
      {conflicts.map(c=><Btn key={profileConflictId(c)} size="sm" variant="outline" onClick={()=>setSelected(profileConflictId(c))}>{t("profile.sync.review")} · {c.key==="personal"?t("profile.sync.personal"):c.local.value?.name??c.remote.value?.name??t("profile.sync.record")}</Btn>)}
    </Inline>:null}
    {host?<Modal open={full&&!!conflict} onClose={()=>{}} maskClose={false} closeButton={false} size="lg" title={t("profile.sync.chooseVersion")}>
      {conflict?<Stack gap={4}><Text as="p" tone="faint">{t("profile.sync.visualHelp")}</Text>{renderChoices(conflict)}</Stack>:null}
    </Modal>:null}
  </Stack>;
}
/** One application-wide portal, even when several Contacts/settings tabs exist. */
export function ProfileConflictHost() { return <ProfileSyncStatus host />; }
