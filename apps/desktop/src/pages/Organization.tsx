import { getLocale as getUiLocale } from "../i18n/index.js";
import { t as i18n, msg as i18nMsg, rich as i18nRich, useLocale as useUiLocale } from "../i18n/index.js";
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
/**
 * 组织主页（page=org，navParams.orgId）：组织是完整页面，不是一张卡片。
 *
 * 结构：页头（名字/简介/邀请/编辑）→ 概览 / 成员 / 资料库 / GitLab / 项目 / 公告。
 * 口径（2026-10-19 用户拍板）：
 * - 成员是真实清华云盘邮箱，不只是名字（资料库共享按邮箱发）；
 * - 资料库是清华云盘「资料库（repo）」，不是组织里的文件夹；
 * - GitLab 仓库只存引用（id/path），可关联已有仓库或直接新建；
 * - 邀请口令可起名、可限定接收邮箱。
 */
import { Btn, Card, EmptyState, IconIn, Inline, KeyValue, List, Modal, Row, Section, Segment, Select, Stack, Text } from "@onethu/gui";
import { QRCodeSVG } from "qrcode.react";
import { IdentityCard } from "../components/IdentityCard.js";
import { PageHead } from "../components/Layout.js";
import { confirmOk } from "../lib/confirm.js";
import { openFormModal } from "../lib/formModal.js";
import { showToast } from "../state/toast.js";
import { useApp } from "../state/context.js";
import { openTab } from "../state/explorer.js";
import {
  acceptOrgInvite, createOrg, currentOrgEmail, deleteOrg, orgIdentityCard, orgInviteCode, orgSnapshot,
  revokeOrgInvite, setOrgGitlabGroup, updateOrg,
  useOrgs, type Org, type OrgAnnouncement, type OrgProject, type OrgRole,
} from "../state/org.js";
import {
  ensureSeafileLoaded, getSeafileToken, openDir, refreshRepos, seafileCreateRepo, seafileDownload,
  seafilePreview, useSeafile,
  type SeafileEntry, type SeafilePreview,
} from "../state/seafile.js";
import {
  gitlabCreateGroup, gitlabCreateProject, gitlabProject, gitlabProjectByPath,
} from "../state/gitlab.js";
import { openExternal } from "./info/openExternal.js";
import { addToVault } from "../state/vault.js";
import { assertOrgManager, changeRemoteMember, enableOrgCollaboration, refreshRemoteOrg, resolveOrgUser, retryOrgPermissions, saveRemoteContent, updateRemoteOrg, updateRemoteResources } from "../state/orgSync.js";
import { orgCardCatch } from "../state/nameCard.js";
import { experienceRevision, subscribeExperience, useExperienceMode } from "../state/experienceMode.js";
import { fullModeReceiveSession } from "../lib/fullModeReceive.js";

const ROLE_LABEL: Record<OrgRole, string> = { get owner() { return i18n("pages.organization.a525346277ed"); }, get member() { return i18n("pages.organization.6e6d6ddbb7c1"); }, get guest() { return i18n("pages.organization.8b358d0f9742"); } };

function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

const INVITE_EXPIRES = [
  { value: "1", get label() { return i18nMsg("pages.organization.30c21284df4f"); } },
  { value: "7", get label() { return i18nMsg("pages.organization.38eefacbb326"); } },
  { value: "30", get label() { return i18nMsg("pages.organization.84ad2952a308"); } },
  { value: "0", get label() { return i18nMsg("pages.organization.8de1bb55709d"); } },
];

/** 当前邀请口令的有效期 → 表单默认值（尽量取最接近的档位）。 */
function inviteExpireDays(invite?: { expiresAt?: number }): string {
  if (!invite) return "7";
  if (!invite.expiresAt) return "0";
  const days = Math.max(1, Math.round((invite.expiresAt - Date.now()) / 86400_000));
  const nearest = [1, 7, 30].reduce((a, b) => (Math.abs(b - days) < Math.abs(a - days) ? b : a), 7);
  return String(nearest);
}

function expireText(at?: number): string {
  if (!at) return i18n("pages.organization.8de1bb55709d");
  const d = new Date(at);
  return i18n("pages.organization.b73971671bd8", { value: String(d.getMonth() + 1), value2: String(d.getDate()), value3: String(String(d.getHours()).padStart(2, "0")), value4: String(String(d.getMinutes()).padStart(2, "0")) });
}

/** GitLab path 规则：小写字母/数字/_/-/.；中文名转不出就退回 org-<时间>。 */
function gitlabSlug(name: string): string {
  const slug = name.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9_.-]/g, "");
  return slug || "org-" + Date.now().toString(36);
}

/* ══════════ 选择组织（深链没带 orgId 时的落地页） ══════════ */

function OrgPicker(): ReactNode {
  const uiLocale = useUiLocale();

  const doc = useOrgs();
  const create = async (): Promise<void> => {
    const email = await currentOrgEmail();
    const f = await openFormModal(i18nMsg("pages.organization.d045f8d60a45"), [
      { key: "name", label: i18nMsg("pages.organization.3f38e493103b"), required: true },
      { key: "brief", label: i18nMsg("pages.organization.d2e163c18cd9"), kind: "textarea" },
      { key: "joinUrl", label: i18nMsg("pages.organization.aa2ed8e463b7") },
    ]);
    if (!f?.name) return;
    const org = createOrg({ name: f.name, brief: f.brief, joinUrl: f.joinUrl, ownerEmail: email });
    openTab("org", { orgId: org.id }, { title: org.name });
    showToast(i18nMsg("pages.organization.d1403c75a692", { name: String(org.name) }));
  };
  const join = async (): Promise<void> => {
    const f = await openFormModal(i18nMsg("pages.organization.ab31e3c17be4"), [
      { key: "code", label: i18nMsg("pages.organization.1e0b8202b535"), kind: "textarea", required: true },
      { key: "name", label: i18nMsg("pages.organization.e2cce0244756"), default: "我" },
    ]);
    if (!f?.code) return;
    const r = await acceptOrgInvite(f.code, f.name || "我");
    if (!r.ok) {
      showToast(r.reason ?? i18n("pages.organization.c697a5163f2d"));
      return;
    }
    showToast(i18nMsg("pages.organization.096678f835a7"));
    if (r.orgId) openTab("org", { orgId: r.orgId }, { title: i18n("pages.organization.b4d203dea5b9") });
  };
  return (
    <div className="org-page">
      <PageHead
        title={i18n("pages.organization.b4d203dea5b9")}
        meta={i18n("pages.organization.44b9531844c7")}
        actions={
          <Inline gap={2} wrap>
            <Btn variant="solid" tone="brand" onClick={() => void create()}>{i18n("pages.organization.d045f8d60a45")}</Btn>
            <Btn variant="outline" onClick={() => void join()}>{i18n("pages.organization.1a428fa57dd7")}</Btn>
          </Inline>
        }
      />
      {doc.orgs.length === 0 ? (
        <EmptyState
          icon={<IconIn size="lg" />}
          title={i18n("pages.organization.af4e39e43455")}
          hint={i18n("pages.organization.6469b14af6bb")}
          action={
            <Inline gap={2} wrap>
              <Btn variant="solid" tone="brand" onClick={() => void create()}>{i18n("pages.organization.d045f8d60a45")}</Btn>
              <Btn variant="outline" onClick={() => void join()}>{i18n("pages.organization.1a428fa57dd7")}</Btn>
            </Inline>
          }
        />
      ) : (
        <List divided>
          {doc.orgs.map((o) => (
            <Row
              key={o.id}
              title={o.name}
              sub={i18n("pages.organization.9fb58025ea25", { length: String(o.members.length), length2: String((o.libraries ?? []).length), length3: String((o.gitlabRepos ?? []).length), value: String(o.brief ? " · " + o.brief : "") })}
              onClick={() => openTab("org", { orgId: o.id }, { title: o.name })}
              trailing={<Btn size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); openTab("org", { orgId: o.id }, { title: o.name }); }}>{i18n("pages.organization.c771248e511f")}</Btn>}
            />
          ))}
        </List>
      )}
    </div>
  );
}

/* ══════════ 资料库内联文件浏览 + 文件预览 ══════════ */

function LibraryFiles({ repoId, name }: { repoId: string; name: string }): ReactNode {
  const uiLocale = useUiLocale();

  const [path, setPath] = useState("/");
  const [entries, setEntries] = useState<SeafileEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{ title: string; data: SeafilePreview } | null>(null);
  const [previewing, setPreviewing] = useState("");

  const load = async (next: string): Promise<void> => {
    setBusy(true);
    setError("");
    try {
      await ensureSeafileLoaded();
      setEntries(await openDir(repoId, next, true));
      setPath(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load("/");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId]);

  const openFile = async (entry: SeafileEntry): Promise<void> => {
    const full = (path === "/" ? "" : path) + "/" + entry.name;
    setPreviewing(entry.name);
    try {
      const data = await seafilePreview(repoId, full);
      setPreview({ title: entry.name, data });
    } catch (e) {
      showToast(i18nMsg("pages.organization.5c52a6e0b15b", { value: String(e instanceof Error ? e.message : String(e)) }));
    } finally {
      setPreviewing("");
    }
  };

  return (
    <div className="org-files">
      <div className="name-card-actions">
        <Btn size="sm" variant="ghost" disabled={busy} onClick={() => void load(path)}>{i18n("pages.organization.aee887434131")}</Btn>
        {path !== "/" ? <Btn size="sm" variant="ghost" onClick={() => void load(path.replace(/\/[^/]+$/, "") || "/")}>{i18n("pages.organization.8e7847be62b6")}</Btn> : null}
        <Text slot="micro" tone="faint">「{name}」{path === "/" ? i18n("pages.organization.42ee2863b6d7") : path}</Text>
      </div>
      {busy && !entries ? <Text slot="micro" tone="faint">{i18n("pages.organization.5d32479622a4")}</Text> : null}
      {error ? <Text slot="micro" tone="faint">{i18nRich("pages.organization.fb31be93aaae", { error: error })}</Text> : null}
      {entries && entries.length === 0 ? <Text slot="micro" tone="faint">{i18n("pages.organization.c04beb5908e7")}</Text> : null}
      {entries && entries.length > 0 ? (
        <List divided>
          {entries.map((entry) => (
            <Row
              key={entry.name}
              title={entry.name}
              sub={entry.kind === "dir" ? i18n("pages.organization.7c7802d8adae") : `${Math.max(1, Math.ceil(entry.size / 1024))} KB`}
              onClick={() => {
                if (entry.kind === "dir") void load((path === "/" ? "" : path) + "/" + entry.name);
                else void openFile(entry);
              }}
              trailing={entry.kind === "file" ? <Btn size="sm" variant="ghost" disabled={previewing === entry.name} onClick={(e) => { e.stopPropagation(); void openFile(entry); }}>{previewing === entry.name ? i18n("pages.organization.346ff60e6c7c") : i18n("pages.organization.13d61fea9f17")}</Btn> : null}
            />
          ))}
        </List>
      ) : null}
      <Modal open={Boolean(preview)} onClose={() => setPreview(null)} title={preview ? `${name} · ${preview.title}` : name} size="lg">
        {preview?.data.kind === "text" ? (
          <pre className="org-file-text">{preview.data.text}</pre>
        ) : preview?.data.kind === "image" ? (
          <img className="org-file-image" src={preview.data.dataUrl} alt={preview.title} />
        ) : (
          <Stack gap={3}>
            <Text slot="micro" tone="faint">
              {preview?.data.kind === "too-big" ? i18n("pages.organization.aede3a1aba90") : i18n("pages.organization.0a419ff6b3a9")}
              {preview?.data.size ? i18n("pages.organization.77cb6bdd9069", { value: String(Math.ceil(preview.data.size / 1024)) }) : ""}
            </Text>
            <Inline gap={2}>
              <Btn variant="outline" onClick={() => void seafileDownload(repoId, (path === "/" ? "" : path) + "/" + (preview?.title ?? "")).catch((e) => showToast(i18nMsg("pages.organization.6dd57693b44a", { value: String(e instanceof Error ? e.message : String(e)) })))}>{i18n("pages.organization.4b5220c396ed")}</Btn>
              <Btn variant="ghost" onClick={() => setPreview(null)}>{i18n("pages.organization.3fd47edce45b")}</Btn>
            </Inline>
          </Stack>
        )}
      </Modal>
    </div>
  );
}

/* ══════════ GitLab 仓库内联预览 ══════════ */

function RepoPreview({ projectId }: { projectId: number }): ReactNode {
  const uiLocale = useUiLocale();

  const [detail, setDetail] = useState<Awaited<ReturnType<typeof gitlabProject>> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const d = await gitlabProject(projectId);
        if (alive) setDetail(d);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { alive = false; };
  }, [projectId]);
  if (error) return <Text slot="micro" tone="faint">{i18nRich("pages.organization.479be5a363f5", { error: error })}</Text>;
  if (!detail) return <Text slot="micro" tone="faint">{i18n("pages.organization.b838382181d9")}</Text>;
  const last = detail.last_activity_at ? new Date(detail.last_activity_at).toLocaleString(getUiLocale(), { hour12: false }) : i18n("pages.organization.4d8c1c5b4283");
  return (
    <KeyValue
      rows={[
        { k: i18n("pages.organization.dc2ba467fc7a"), v: detail.description || i18n("pages.organization.fa8bc5e925f9") },
        { k: i18n("pages.organization.35e9a0c6fbb2"), v: detail.default_branch || i18n("pages.organization.e520c15bfc4d") },
        { k: i18n("pages.organization.7e228d4688a2"), v: detail.visibility === "private" ? i18n("pages.organization.94df451074d7") : detail.visibility === "internal" ? i18n("pages.organization.6f225eb36d6d") : i18n("pages.organization.7a73baf0ce9a") },
        { k: "Star / Fork", v: `${detail.star_count} / ${detail.forks_count}` },
        { k: i18n("pages.organization.4389d4cfa276"), v: String(detail.open_issues_count) },
        { k: i18n("pages.organization.41f5cada11ed"), v: last },
      ]}
    />
  );
}

/* ══════════ 组织主页 ══════════ */

/** 深链/旧标签指向的组织在本机不存在（已删除/换设备）：给明确出口，不装作空组织页。 */
function OrgMissing(): ReactNode {
  const uiLocale = useUiLocale();

  return (
    <div className="org-page">
      <PageHead
        title={i18n("pages.organization.b4d203dea5b9")}
        meta={i18n("pages.organization.2ad099f6be0b")}
        actions={<Btn variant="outline" onClick={() => openTab("contacts", { section: "orgs" })}>{i18n("pages.organization.4753aae92593")}</Btn>}
      />
      <EmptyState
        icon={<IconIn size="lg" />}
        title={i18n("pages.organization.3e679e9bcd2d")}
        hint={i18n("pages.organization.625faadf7120")}
        action={<Btn variant="solid" tone="brand" onClick={() => openTab("contacts", { section: "orgs" })}>{i18n("pages.organization.a9ff0848a19b")}</Btn>}
      />
    </div>
  );
}

export function OrganizationPage(): ReactNode {
  const uiLocale = useUiLocale();
  const mode = useExperienceMode();
  const revision = useSyncExternalStore(subscribeExperience, experienceRevision, experienceRevision);

  const { navParams } = useApp();
  const doc = useOrgs();
  const orgId = (navParams as { orgId?: string } | null)?.orgId;
  const org: Org | null = doc.orgs.find((o) => o.id === orgId) ?? null;
  const [tab, setTab] = useState("overview");
  const [invite, setInvite] = useState<{ code: string; label?: string; allowEmail?: string } | null>(null);
  const [sharing, setSharing] = useState("");
  const [openLib, setOpenLib] = useState<string | null>(null);
  const [openRepo, setOpenRepo] = useState<number | null>(null);
  const seafile = useSeafile();
  const [collabBusy, setCollabBusy] = useState(false);
  const [collabError, setCollabError] = useState("");
  const [retainedDraft, setRetainedDraft] = useState<{label: string; text: string; reopen: () => void} | null>(null);
  useEffect(() => {
    setCollabBusy(false);
    setInvite(null);
    setOpenLib(null);
    setOpenRepo(null);
  }, [mode, revision]);
  const runRemote = async (action: () => Promise<void>, success?: string): Promise<void> => {
    const receiving = fullModeReceiveSession();
    if (!receiving.isCurrent()) return;
    setCollabBusy(true); setCollabError("");
    try { await action(); if (success && receiving.isCurrent()) showToast(success); }
    catch (e) { if (receiving.isCurrent()) setCollabError(e instanceof Error ? e.message : String(e)); }
    finally { if (receiving.isCurrent()) setCollabBusy(false); }
  };
  const needsCollaboration = (target: Org): boolean => {
    if (!target.collaboration) { setCollabError(i18n("pages.organization.a17ba20c4f4c")); return true; }
    return false;
  };
  useEffect(() => {
    if (mode !== "full" || !orgId || !org?.collaboration || org.collaboration.status === "initializing") return;
    let alive = true;
    const receiving = fullModeReceiveSession();
    const refresh = () => {
      if (alive && receiving.isCurrent() && document.visibilityState !== "hidden") {
        void refreshRemoteOrg(orgId).catch(e => {
          if (alive && receiving.isCurrent()) setCollabError(e instanceof Error ? e.message : String(e));
        });
      }
    };
    refresh();
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    return () => { alive = false; window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [mode, revision, orgId, Boolean(org?.collaboration)]);
  /* 云盘配置是懒加载的：进组织页先把 token / 资料库列表拉起来，
     否则「新建资料库」会拿空 token 直接跳云盘页（用户观感=报错）。 */
  useEffect(() => {
    if (mode !== "full") return;
    let alive = true;
    const receiving = fullModeReceiveSession();
    void (async () => {
      await ensureSeafileLoaded();
      if (!alive || !receiving.isCurrent() || !getSeafileToken()) return;
      await refreshRepos();
    })();
    return () => { alive = false; };
  }, [mode, revision]);
  const noticeList = useMemo(
    () => [...(org?.announcements ?? [])].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt),
    [uiLocale, org?.announcements],
  );

  /* ── 基本资料 ── */
  const editOrg = async (target: Org): Promise<void> => {
    const f = await openFormModal(i18nMsg("pages.organization.6fb2720ac3f3"), [
      { key: "name", label: i18nMsg("pages.organization.3f38e493103b"), required: true, default: target.name },
      { key: "brief", label: i18nMsg("pages.organization.8131eafd0239"), kind: "textarea", default: target.brief },
      { key: "joinUrl", label: i18nMsg("pages.organization.8992ab3202b4"), default: target.joinUrl },
    ]);
    if (!f?.name) return;
    if (target.collaboration) await runRemote(() => updateRemoteOrg(target.id, {name:target.name,brief:target.brief,joinUrl:target.joinUrl}, {name:f.name!,brief:f.brief??"",joinUrl:f.joinUrl??""}), i18n("pages.organization.66dbb2801a9d"));
    else { updateOrg(target.id, { name: f.name, brief: f.brief ?? "", joinUrl: f.joinUrl ?? "" }); showToast(i18nMsg("pages.organization.818c0ab5d9ee")); }
  };

  /* ── 邀请 ── */
  const makeInvite = async (target: Org): Promise<void> => {
    const receiving = fullModeReceiveSession();
    if (!receiving.isCurrent()) return;
    const f = await openFormModal(i18nMsg("pages.organization.addfc25ab35b"), [
      { key: "label", label: i18nMsg("pages.organization.daa75e1875bd"), default: target.invite?.label ?? "" },
      { key: "allowEmail", label: i18nMsg("pages.organization.aeeeb7431935"), default: target.invite?.allowEmail ?? "" },
      { key: "expireDays", label: i18nMsg("pages.organization.c56cd8e33248"), kind: "select", options: INVITE_EXPIRES, default: inviteExpireDays(target.invite) },
    ]);
    if (!f || !receiving.isCurrent()) return;
    const email = (f.allowEmail ?? "").trim();
    if (email && !isEmail(email)) {
      showToast(i18nMsg("pages.organization.08db6a07f7dd"));
      return;
    }
    const expireDays = Number(f.expireDays ?? "7") === 0 ? 0 : Number(f.expireDays ?? "7");
    try {
      const code = await orgInviteCode(target, "我", { label: f.label ?? "", allowEmail: email, expireDays });
      if (!receiving.isCurrent()) return;
      setInvite({ code, ...(f.label ? { label: f.label } : {}), ...(email ? { allowEmail: email } : {}) });
      const lifetime = expireDays > 0 ? i18n("pages.organization.37d624a5b84e", { expireDays: String(expireDays) }) : i18n("pages.organization.8de1bb55709d");
      await navigator.clipboard.writeText(code).then(() => {
        if (receiving.isCurrent()) showToast(i18nMsg("pages.organization.5f7f73143f0f", { lifetime: String(lifetime) }));
      }).catch(() => {
        if (receiving.isCurrent()) showToast(i18nMsg("pages.organization.5f1d03317818", { lifetime: String(lifetime) }));
      });
    } catch (e) {
      if (receiving.isCurrent()) showToast(i18nMsg("pages.organization.4949eb791978", { value: String(e instanceof Error ? e.message : String(e)) }));
    }
  };

  /* ── 成员 ── */
  const addMember = async (target: Org): Promise<void> => {
    if (needsCollaboration(target)) return;
    const f = await openFormModal(i18nMsg("pages.organization.d509575956fc"), [
      {key:"username",label:i18nMsg("pages.organization.9f6a077a48fc"),required:true},
      {key:"email",label:i18nMsg("pages.organization.daa435b57879"),required:true},
      {key:"role",label:i18nMsg("pages.organization.c47b54e84e79"),kind:"select",options:[{value:"member",label:i18nMsg("pages.organization.22ea1db0cf4f")},{value:"guest",label:i18nMsg("pages.organization.d1ef1361de26")},{value:"owner",label:i18nMsg("pages.organization.3f2bcd552c63")}]},
    ]);
    if (!f) return;
    await runRemote(async () => { const binding = await resolveOrgUser(f.username!,f.email!); await changeRemoteMember(target.id,undefined,{...binding,role:(f.role??"member") as OrgRole}); }, i18n("pages.organization.cbb93d90a17f"));
  };
  const editMember = async (target: Org, memberId: string): Promise<void> => {
    if (needsCollaboration(target)) return;
    const member = target.members.find(m=>m.id===memberId);
    if (!member?.gitlabUserId || !member.username) { setCollabError(i18n("pages.organization.6d96e60ed4ea")); return; }
    const f = await openFormModal(i18nMsg("pages.organization.b9dc0caf4b89"), [{key:"email",label:i18nMsg("pages.organization.d095478efd68", { username: String(member.username) }),default:member.email,required:true}]);
    if (!f) return;
    await runRemote(async () => { const binding = await resolveOrgUser(member.username!,f.email!); await changeRemoteMember(target.id,member.gitlabUserId,{...binding,role:member.role},{email:member.email,role:member.role}); }, i18n("pages.organization.36ce198143e6"));
  };
  const changeRole = async (target: Org, memberId: string, role: OrgRole): Promise<void> => {
    if (needsCollaboration(target)) return;
    const member = target.members.find(m=>m.id===memberId); if (!member?.gitlabUserId || !member.username) return;
    await runRemote(() => changeRemoteMember(target.id,member.gitlabUserId,{userId:member.gitlabUserId!,username:member.username!,name:member.name,email:member.email,role},{email:member.email,role:member.role}), i18n("pages.organization.51c72d5d47ff"));
  };
  const removeMember = async (target: Org, memberId: string): Promise<void> => {
    if (needsCollaboration(target)) return;
    const member = target.members.find(m=>m.id===memberId); if (!member?.gitlabUserId) return;
    if (!await confirmOk(i18nMsg("pages.organization.187853347221", { name: String(member.name) }))) return;
    await runRemote(()=>changeRemoteMember(target.id,member.gitlabUserId,undefined,{email:member.email,role:member.role}),i18n("pages.organization.c505be585240"));
  };

  /* ── 资料库 ── */
  const createLibrary = async (target: Org): Promise<void> => {
    if (needsCollaboration(target)) return;
    await ensureSeafileLoaded();
    if (!getSeafileToken()) {
      showToast(i18nMsg("pages.organization.ef185b726b26"));
      openTab("cloud");
      return;
    }
    const f = await openFormModal(i18nMsg("pages.organization.cdd79829476d"), [{ key: "name", label: i18nMsg("pages.organization.08008fa506a0"), default: i18n("pages.organization.7fd872847a17", { name: String(target.name) }), required: true }]);
    if (!f?.name) return;
    setSharing("create-lib");
    try {
      await assertOrgManager(target.id);
      const repoId = await seafileCreateRepo(f.name);
      await updateRemoteResources(target.id,"libraries",target.libraries??[],[...(target.libraries??[]),{repoId,name:f.name.trim(),addedAt:Date.now()}]);
      showToast(i18nMsg("pages.organization.36f02dfa5d1b", { name: String(f.name) }));
    } catch (e) {
      showToast(i18nMsg("pages.organization.1a11fb6c8b7d", { value: String(e instanceof Error ? e.message : String(e)) }));
    } finally {
      setSharing("");
    }
  };

  const linkLibrary = async (target: Org): Promise<void> => {
    if (needsCollaboration(target)) return;
    const repos = seafile.repos.filter((r) => !(target.libraries ?? []).some((l) => l.repoId === r.id));
    if (!repos.length) {
      showToast(seafile.repos.length ? i18nMsg("pages.organization.9efd7e2871ec") : i18nMsg("pages.organization.c7a1e9997e12"));
      return;
    }
    const f = await openFormModal(i18nMsg("pages.organization.47e4a946fb48"), [
      { key: "repoId", label: i18nMsg("pages.organization.a7345e453164"), kind: "select", options: repos.map((r) => ({ value: r.id, label: r.name })) },
    ]);
    if (!f?.repoId) return;
    const hit = repos.find((r) => r.id === f.repoId);
    await runRemote(()=>updateRemoteResources(target.id,"libraries",target.libraries??[],[...(target.libraries??[]),{repoId:f.repoId!,name:hit?.name??f.repoId!,addedAt:Date.now()}]),i18n("pages.organization.ff2b46e9d6d7"));
  };

  const shareLibrary = async (target: Org, _repoId: string, _name: string): Promise<void> => { await syncAllPermissions(target); };

  const copyLibraryLink = async (repoId: string, name: string): Promise<void> => {
    setSharing(repoId);
    try {
      await ensureSeafileLoaded();
      if (!getSeafileToken()) throw new Error(i18n("pages.organization.15e1ef41e215"));

      await navigator.clipboard.writeText(`https://cloud.tsinghua.edu.cn/library/${encodeURIComponent(repoId)}/`);
      showToast(i18nMsg("pages.organization.2a0551eb4c4e", { name: String(name) }));
    } catch (e) {
      showToast(i18nMsg("pages.organization.24d39595abbf", { value: String(e instanceof Error ? e.message : String(e)) }));
    } finally {
      setSharing("");
    }
  };

  const syncAllPermissions = async (target: Org): Promise<void> => {
    if (needsCollaboration(target)) return;
    await runRemote(()=>retryOrgPermissions(target.id),i18n("pages.organization.a6b97088a34a"));
  };

  /* ── GitLab ── */
  const linkGitlab = async (target: Org): Promise<void> => {
    if (needsCollaboration(target)) return;
    const f = await openFormModal(i18nMsg("pages.organization.86da79df695d"), [
      { key: "path", label: i18nMsg("pages.organization.a5551da83869"), required: true, placeholder: "group/project" },
    ]);
    if (!f?.path) return;
    setSharing("gitlab");
    try {
      const repo = await gitlabProjectByPath(f.path);
      await updateRemoteResources(target.id,"gitlabRepos",target.gitlabRepos??[],[...(target.gitlabRepos??[]),{...repo,addedAt:Date.now()}]);
      showToast(i18nMsg("pages.organization.d11fe0c02879", { name: String(repo.name) }));
    } catch (e) {
      showToast(i18nMsg("pages.organization.d7e64b958bc2", { value: String(e instanceof Error ? e.message : String(e)) }));
    } finally {
      setSharing("");
    }
  };

  /**
   * 创建组织仓库 = 先建一个 **GitLab 组织（群组）**（还没有的话），
   * 把成员都邀请进去，再把仓库建在这个组织下面 —— 不是孤立地在个人命名空间建仓库。
   */
  const createGitlab = async (target: Org): Promise<void> => {
    if (needsCollaboration(target)) return;
    const latest = orgSnapshot().orgs.find((o) => o.id === target.id) ?? target;
    const group = latest.gitlabGroup;
    const fields = [
      ...(group ? [] : [{ key: "groupName", label: i18nMsg("pages.organization.018a9cb5b40a"), default: target.name, required: true } as const]),
      { key: "name", label: group ? i18nMsg("pages.organization.838996610aeb") : i18nMsg("pages.organization.b285a8665e40"), default: gitlabSlug(target.name), required: true } as const,
      { key: "description", label: i18nMsg("pages.organization.19ad97a6aca8") } as const,
    ];
    const f = await openFormModal(group ? i18nMsg("pages.organization.c697f98ef8c1") : i18nMsg("pages.organization.472ef6d25612"), fields);
    if (!f?.name) return;
    const visibility = "private" as const;
    setSharing("gitlab");
    try {
      await assertOrgManager(target.id);
      let groupRef = group;
      if (!groupRef) {
        const groupName = (f.groupName ?? target.name).trim();
        groupRef = await gitlabCreateGroup({
          name: groupName,
          path: gitlabSlug(groupName),
          description: i18n("pages.organization.b553a6d53946", { name: String(target.name) }),
          visibility,
        });
        setOrgGitlabGroup(target.id, groupRef);
      }
      const repo = await gitlabCreateProject({
        name: f.name,
        description: f.description || i18n("pages.organization.22ba5aac038e", { name: String(target.name) }),
        visibility,
        namespaceId: groupRef.id,
      });
      await updateRemoteResources(target.id,"gitlabRepos",target.gitlabRepos??[],[...(target.gitlabRepos??[]),{...repo,addedAt:Date.now()}]);
      showToast(i18nMsg("pages.organization.dc6c576b40b6", { name: String(repo.name) }));
    } catch (e) {
      showToast(i18nMsg("pages.organization.2a13fd852180", { value: String(e instanceof Error ? e.message : String(e)) }));
    } finally {
      setSharing("");
    }
  };

  /* ── 项目 / 公告 ── */
  const editProject = async (target: Org, project?: OrgProject, draft?: Record<string,string>): Promise<void> => {
    if (needsCollaboration(target)) return;
    const f = await openFormModal(project ? i18nMsg("pages.organization.577feeefb88d") : i18nMsg("pages.organization.0e1a7040390f"), [
      {key:"name",label:i18nMsg("pages.organization.867698fb7b0c"),required:true,default:draft?.name??project?.name},
      {key:"description",label:i18nMsg("pages.organization.7725bcb29aa3"),kind:"textarea",default:draft?.description??project?.description},
      {key:"owner",label:i18nMsg("pages.organization.a525346277ed"),default:draft?.owner??project?.owner},
    ]);
    if (!f) return;
    await runRemote(async()=>{
      try { await saveRemoteContent(target.id,"projects",project,{id:project?.id??crypto.randomUUID(),name:f.name!,description:f.description??"",owner:f.owner??"",status:project?.status??"planned",updatedAt:Date.now()}); setRetainedDraft(null); }
      catch(e) { setRetainedDraft({label:i18n("pages.organization.b13ec9094503"),text:JSON.stringify(f,null,2),reopen:()=>void editProject(orgSnapshot().orgs.find(o=>o.id===target.id)??target,orgSnapshot().orgs.find(o=>o.id===target.id)?.projects?.find(p=>p.id===project?.id),f)}); throw e; }
    },i18n("pages.organization.d6b2632aaf47"));
  };
  const editNotice = async (target: Org, notice?: OrgAnnouncement, draft?: Record<string,string>): Promise<void> => {
    if (needsCollaboration(target)) return;
    const f = await openFormModal(notice ? i18nMsg("pages.organization.83163278a659") : i18nMsg("pages.organization.d78a6a9cd030"), [
      {key:"title",label:i18nMsg("pages.organization.37d9c73375dc"),required:true,default:draft?.title??notice?.title},
      {key:"body",label:i18nMsg("pages.organization.81d7905bd513"),kind:"textarea",required:true,default:draft?.body??notice?.body},
    ]);
    if (!f) return;
    await runRemote(async()=>{
      try { await saveRemoteContent(target.id,"announcements",notice,{id:notice?.id??crypto.randomUUID(),title:f.title!,body:f.body!,pinned:notice?.pinned??false,updatedAt:Date.now()}); setRetainedDraft(null); }
      catch(e) { setRetainedDraft({label:i18n("pages.organization.51902a13beff"),text:JSON.stringify(f,null,2),reopen:()=>void editNotice(orgSnapshot().orgs.find(o=>o.id===target.id)??target,orgSnapshot().orgs.find(o=>o.id===target.id)?.announcements?.find(n=>n.id===notice?.id),f)}); throw e; }
    },i18n("pages.organization.be276e340929"));
  };

  if (!org) return orgId ? <OrgMissing /> : <OrgPicker />;

  const owner = org.members.find((m) => m.role === "owner");
  const libraries = org.libraries ?? [];
  const gitlabRepos = org.gitlabRepos ?? [];
  const projects = org.projects ?? [];

  return (
    <div className="org-page">
      <Card>
        <Stack gap={2}>
          <Text slot="title">{org.collaboration ? i18n("pages.organization.ac1fa183249e") : i18n("pages.organization.c90a2cd05ae2")}</Text>
          <Text tone="faint">{org.collaboration ? i18n("pages.organization.d71274370983", { value: String(org.collaboration.lastReadAt ? i18n("pages.organization.893ebe28c87a", { value: String(new Date(org.collaboration.lastReadAt).toLocaleTimeString(getUiLocale())) }) : "") }) : i18n("pages.organization.2ea3669be1b3")}</Text>
          <Inline gap={2} wrap>
            {!org.collaboration || org.collaboration.status === "initializing" ? <Btn disabled={collabBusy} variant="solid" onClick={()=>void runRemote(()=>enableOrgCollaboration(org.id),i18n("pages.organization.d00013a32eac"))}>{collabBusy?i18n("pages.organization.8be0ea36a9bb"):i18n("pages.organization.0a071e483d36")}</Btn> : null}
            {org.collaboration ? <Btn disabled={collabBusy} variant="outline" onClick={()=>void runRemote(async()=>{await refreshRemoteOrg(org.id);})}>{i18n("pages.organization.4b5a3f828e24")}</Btn> : null}
            {org.collaboration?.pending ? <Btn disabled={collabBusy} variant="solid" onClick={()=>void runRemote(()=>retryOrgPermissions(org.id),i18n("pages.organization.6b02818a1d0f"))}>{i18n("pages.organization.c1e0eabac88e")}</Btn> : null}
            {org.collaboration?.status === "error" && !org.collaboration.lastReadAt ? <Btn disabled={collabBusy} variant="outline" onClick={()=>void runRemote(()=>enableOrgCollaboration(org.id))}>{i18n("pages.organization.e7ff0c31b623")}</Btn> : null}
          </Inline>
          {org.legacyMembers?.length ? <Text tone="faint">{i18nRich("pages.organization.86481b9cae10", { value: org.legacyMembers.map(m=>`${m.name} ${m.email}`).join("、") })}</Text> : null}
          {collabError || org.collaboration?.error ? <div role="alert"><Text tone="error">{collabError || org.collaboration?.error}</Text></div> : null}
          {retainedDraft ? <Card><Text slot="title">{retainedDraft.label}</Text><Text slot="micro">{retainedDraft.text}</Text><Btn onClick={retainedDraft.reopen}>{i18n("pages.organization.b0cda987a0ff")}</Btn></Card> : null}
        </Stack>
      </Card>
      <PageHead
        title={org.name}
        meta={org.brief || i18n("pages.organization.6a0b2effbe54")}
        actions={
          <Inline gap={2} wrap>
            <Btn variant="solid" tone="brand" onClick={() => void makeInvite(org)}>{i18n("pages.organization.addfc25ab35b")}</Btn>
            <Btn variant="outline" onClick={() => void editOrg(org)}>{i18n("pages.organization.6e7ecbfdeb6c")}</Btn>
            <Btn variant="ghost" onClick={() => openTab("contacts", { section: "orgs" })}>{i18n("pages.organization.43831ecc8c21")}</Btn>
          </Inline>
        }
      />
      <div className="org-tabs">
        <Segment
          value={tab}
          onChange={setTab}
          options={[
            { value: "overview", label: i18n("pages.organization.fea405f9b01d") },
            { value: "members", label: i18n("pages.organization.6e6d6ddbb7c1") },
            { value: "libraries", label: i18n("pages.organization.433bdcb25776") },
            { value: "gitlab", label: "GitLab" },
            { value: "projects", label: i18n("pages.organization.79f326be4409") },
            { value: "notices", label: i18n("pages.organization.069c0ecbf898") },
          ]}
        />
      </div>

      {tab === "overview" ? (
        <Stack gap={5}>
          <Card>
            <Section title={i18n("pages.organization.8952bf863820")} hint={i18n("pages.organization.6c3e6b9444b7")} />
            <KeyValue
              rows={[
                { k: i18n("pages.organization.6e6d6ddbb7c1"), v: i18n("pages.organization.ca51ffb73a0c", { length: String(org.members.length), length2: String(org.members.filter((m) => m.email).length) }) },
                { k: i18n("pages.organization.a525346277ed"), v: owner ? `${owner.name}${owner.email ? ` · ${owner.email}` : ""}` : i18n("pages.organization.2f5f1d6fbfb0") },
                { k: i18n("pages.organization.433bdcb25776"), v: libraries.length ? libraries.map((l) => l.name).join("、") : i18n("pages.organization.a07198d1ffb2") },
                { k: i18n("pages.organization.0f29627f4bfb"), v: org.gitlabGroup ? `${org.gitlabGroup.name}（${org.gitlabGroup.path}）` : i18n("pages.organization.9a2e2b263340") },
                { k: i18n("pages.organization.9f54beb67068"), v: gitlabRepos.length ? gitlabRepos.map((r) => r.path).join("、") : i18n("pages.organization.4f43cc1cd5a7") },
                { k: i18n("pages.organization.b52ea6d355c2"), v: org.joinUrl || i18n("pages.organization.2f5f1d6fbfb0") },
              ]}
            />
            <div className="name-card-actions">
              <Btn variant="outline" onClick={() => void addMember(org)}>{i18n("pages.organization.ad9737dafdbf")}</Btn>
              <Btn variant="outline" onClick={() => setTab("libraries")}>{i18n("pages.organization.b20cb0bae1a1")}</Btn>
              <Btn variant="ghost" onClick={() => setTab("gitlab")}>{i18n("pages.organization.97a3bc7f1fb2")}</Btn>
              <Btn variant="ghost" onClick={() => { const r = addToVault(orgCardCatch(orgIdentityCard(org))); showToast(r.ok ? i18nMsg("pages.organization.1cfd3b432295") : i18nMsg("pages.organization.9e7804614304")); }}>{i18n("pages.organization.8e5ba1de0a5c")}</Btn>
            </div>
          </Card>
          {org.invite ? (
            <Card>
              <Section title={i18n("pages.organization.f84bbaa62e05")} hint={i18n("pages.organization.79a369a8de4f")} />
              <div className="vault-share">
                <Text slot="micro" tone="faint">{i18nRich("pages.organization.451e59f8953a", { value: org.invite.label ? `「${org.invite.label}」` : i18n("pages.organization.51c549e1aeed"), value2: org.invite.allowEmail ?? i18n("pages.organization.d8c9c482d09b"), value3: expireText(org.invite.expiresAt) })}</Text>
                <code className="vault-share-code">{org.invite.code}</code>
                <Inline gap={2} wrap>
                  <Btn size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(org.invite!.code).then(() => showToast(i18nMsg("pages.organization.8f6f8d979c98"))).catch(() => showToast(i18nMsg("pages.organization.f2d4a102e351")))}>{i18n("pages.organization.7dc5266a2019")}</Btn>
                  <Btn size="sm" variant="ghost" onClick={() => setInvite(org.invite!)}>{i18n("pages.organization.e0e6bffae711")}</Btn>
                  <Btn size="sm" variant="ghost" onClick={() => void makeInvite(org)}>{i18n("pages.organization.9a3cf166ef29")}</Btn>
                  <Btn
                    size="sm"
                    variant="ghost"
                    tone="error"
                    onClick={() => void confirmOk(i18nMsg("pages.organization.5b5a9bdff428")).then((ok) => {
                      if (!ok) return;
                      void revokeOrgInvite(org.id).then((r) => showToast(r.ok ? (r.reason ?? i18n("pages.organization.b3b03ad2638a")) : r.reason ?? i18n("pages.organization.5c94b0602337")));
                    })}
                  >{i18n("pages.organization.1e7f3a3d7f2d")}</Btn>
                </Inline>
              </div>
            </Card>
          ) : null}
          <Card>
            <Section title={i18n("pages.organization.b1bd19b13336")} hint={i18n("pages.organization.e6ed002d8a0b")} />
            <IdentityCard card={orgIdentityCard(org)} organization variant="detail" />
          </Card>
          <Card>
            <Section title={i18n("pages.organization.cd84121acb17")} hint={i18n("pages.organization.4d0b00da0e94")} />
            <Btn
              variant="ghost"
              tone="error"
              onClick={() => void confirmOk(i18nMsg("pages.organization.15e315333695", { name: String(org.name) })).then((ok) => {
                if (!ok) return;
                deleteOrg(org.id);
                openTab("contacts", { section: "orgs" });
              })}
            >{i18n("pages.organization.14941cd30619")}</Btn>
          </Card>
        </Stack>
      ) : null}

      {tab === "members" ? (
        <Stack gap={4}>
          <Inline gap={2} wrap>
            <Btn variant="solid" tone="brand" onClick={() => void addMember(org)}>{i18n("pages.organization.ad9737dafdbf")}</Btn>
            <Btn variant="outline" onClick={() => void makeInvite(org)}>{i18n("pages.organization.51c549e1aeed")}</Btn>
            <Btn
              variant="ghost"
              disabled={!libraries.length}
              onClick={() => { void (async () => { for (const lib of libraries) await shareLibrary(org, lib.repoId, lib.name); })(); }}
            >{i18n("pages.organization.71d4aa440534")}</Btn>
            <Btn variant="outline" disabled={sharing === "sync-all"} onClick={() => void syncAllPermissions(org)}>
              {sharing === "sync-all" ? i18n("pages.organization.4e2238b74ec7") : i18n("pages.organization.d39c271f5ef1")}
            </Btn>
          </Inline>
          <Text slot="micro" tone="faint">{i18n("pages.organization.8eeb2b0ca1de")}</Text>
          <List divided>
            {org.members.map((m) => (
              <Row
                key={m.id}
                title={m.name}
                sub={m.email || i18n("pages.organization.2ed6ff817aa6")}
                trailing={
                  <div className="name-card-actions">
                    <Select aria-label={i18n("pages.organization.1b6e4682502c", { name: String(m.name) })} value={m.role} disabled={collabBusy} onChange={(v) => void changeRole(org, m.id, v as OrgRole)}>
                      <option value="owner">{ROLE_LABEL.owner}</option>
                      <option value="member">{ROLE_LABEL.member}</option>
                      <option value="guest">{ROLE_LABEL.guest}</option>
                    </Select>
                    <Btn size="sm" variant="ghost" onClick={() => void editMember(org, m.id)}>{i18n("pages.organization.051836569928")}</Btn>
                    <Btn size="sm" variant="ghost" tone="error" onClick={() => void removeMember(org, m.id)}>{i18n("pages.organization.6135d4159e89")}</Btn>
                  </div>
                }
              />
            ))}
          </List>
        </Stack>
      ) : null}

      {tab === "libraries" ? (
        <Stack gap={4}>
          {!seafile.configured ? (
            <Card>
              <Text slot="label">{i18n("pages.organization.c29f7a1f09d0")}</Text>
              <Text slot="micro" tone="faint">{i18n("pages.organization.e562cb9d8b4f")}</Text>
              <div className="name-card-actions"><Btn variant="solid" tone="brand" onClick={() => openTab("cloud")}>{i18n("pages.organization.1e9c085e0a16")}</Btn></div>
            </Card>
          ) : null}
          <Inline gap={2} wrap>
            <Btn variant="solid" tone="brand" disabled={sharing === "create-lib"} onClick={() => void createLibrary(org)}>{i18n("pages.organization.d7b6a5ec5201")}</Btn>
            <Btn variant="outline" onClick={() => void linkLibrary(org)}>{i18n("pages.organization.47e4a946fb48")}</Btn>
          </Inline>
          {libraries.length === 0 ? (
            <EmptyState
              icon={<IconIn size="lg" />}
              title={i18n("pages.organization.88e67027847d")}
              hint={i18n("pages.organization.e009d90fde61")}
            />
          ) : (
            <Stack gap={3}>
              {libraries.map((lib) => (
                <Card key={lib.repoId}>
                  <Stack gap={2}>
                    <Text slot="title">{lib.name}</Text>
                    <Text slot="micro" tone="faint">
                      {org.collaboration ? i18n("pages.organization.92dcb4e03902") : i18n("pages.organization.4899ad0eba7a", { value: String(lib.sharedWith?.join("、") || i18n("pages.organization.8e09dafb1ae1")) })}
                    </Text>
                    <div className="name-card-actions">
                      <Btn size="sm" variant="outline" onClick={() => openTab("cloud", { cloudRepo: lib.repoId })}>{i18n("pages.organization.2f08b70b8cf9")}</Btn>
                      <Btn size="sm" variant="outline" disabled={sharing === lib.repoId} onClick={() => void shareLibrary(org, lib.repoId, lib.name)}>{i18n("pages.organization.f2b2fddfd1c5")}</Btn>
                      <Btn size="sm" variant="ghost" disabled={sharing === lib.repoId} onClick={() => void copyLibraryLink(lib.repoId, lib.name)}>{i18n("pages.organization.1da6f8b31270")}</Btn>
                      <Btn size="sm" variant="ghost" onClick={() => setOpenLib(openLib === lib.repoId ? null : lib.repoId)}>{openLib === lib.repoId ? i18n("pages.organization.5aff278dfeb0") : i18n("pages.organization.96812fd51b93")}</Btn>
                      <Btn size="sm" variant="ghost" tone="error" onClick={() => void confirmOk(i18nMsg("pages.organization.959d1ad22dc2", { name: String(lib.name) })).then((ok) => { if (ok) { void runRemote(()=>updateRemoteResources(org.id,"libraries",libraries,libraries.filter(x=>x.repoId!==lib.repoId)),i18n("pages.organization.ffaf3f2d7689")); } })}>{i18n("pages.organization.f48551f0b9c9")}</Btn>
                    </div>
                    {mode === "full" && openLib === lib.repoId ? <LibraryFiles repoId={lib.repoId} name={lib.name} /> : null}
                  </Stack>
                </Card>
              ))}
            </Stack>
          )}
        </Stack>
      ) : null}

      {tab === "gitlab" ? (
        <Stack gap={4}>
          {org.gitlabGroup ? (
            <Card>
              <Stack gap={2}>
                <Text slot="title">{i18nRich("pages.organization.f600f42af5cd", { name: org.gitlabGroup.name })}</Text>
                <Text slot="micro" tone="faint">{i18nRich("pages.organization.fee56fb67def", { path: org.gitlabGroup.path })}</Text>
                <div className="name-card-actions">
                  <Btn size="sm" variant="outline" onClick={() => void openExternal(org.gitlabGroup!.webUrl)}>{i18n("pages.organization.23b3dcbdcd6a")}</Btn>
                  <Btn size="sm" variant="ghost" disabled={sharing === "sync-all"} onClick={() => void syncAllPermissions(org)}>{i18n("pages.organization.f8f94f22c3a1")}</Btn>
                </div>
              </Stack>
            </Card>
          ) : (
            <Text slot="micro" tone="faint">{i18n("pages.organization.74ab5e0d1e5f")}</Text>
          )}
          <Inline gap={2} wrap>
            <Btn variant="solid" tone="brand" disabled={sharing === "gitlab"} onClick={() => void createGitlab(org)}>{org.gitlabGroup ? i18n("pages.organization.a27b334c9efa") : i18n("pages.organization.e72c208a9eca")}</Btn>
            <Btn variant="outline" disabled={sharing === "gitlab"} onClick={() => void linkGitlab(org)}>{i18n("pages.organization.7371988e7f6d")}</Btn>
            <Btn variant="ghost" onClick={() => openTab("gitlab")}>{i18n("pages.organization.c583a7142d40")}</Btn>
          </Inline>
          {gitlabRepos.length === 0 ? (
            <EmptyState
              icon={<IconIn size="lg" />}
              title={i18n("pages.organization.6205cceeeb30")}
              hint={i18n("pages.organization.670834ee8d02")}
            />
          ) : (
            <Stack gap={3}>
              {gitlabRepos.map((repo) => (
                <Card key={repo.id}>
                  <Stack gap={2}>
                    <Text slot="title">{repo.name}</Text>
                    <Text slot="micro" tone="faint">{repo.path}</Text>
                    <div className="name-card-actions">
                      <Btn size="sm" variant="outline" onClick={() => openTab("gitlab", { gitlabProject: repo.id }, { title: `${org.name} · ${repo.name}` })}>{i18n("pages.organization.809f2cef23cc")}</Btn>
                      <Btn size="sm" variant="ghost" onClick={() => setOpenRepo(openRepo === repo.id ? null : repo.id)}>{openRepo === repo.id ? i18n("pages.organization.0ae7312510f4") : i18n("pages.organization.c73a21cff12c")}</Btn>
                      <Btn size="sm" variant="ghost" onClick={() => void openExternal(repo.webUrl ?? `https://git.tsinghua.edu.cn/${repo.path}`)}>{i18n("pages.organization.b231587899f3")}</Btn>
                      <Btn size="sm" variant="ghost" tone="error" onClick={() => void confirmOk(i18nMsg("pages.organization.18826c45fb28", { name: String(repo.name) })).then((ok) => { if (ok) { void runRemote(()=>updateRemoteResources(org.id,"gitlabRepos",gitlabRepos,gitlabRepos.filter(x=>x.id!==repo.id)),i18n("pages.organization.ffaf3f2d7689")); } })}>{i18n("pages.organization.f48551f0b9c9")}</Btn>
                    </div>
                    {mode === "full" && openRepo === repo.id ? <RepoPreview projectId={repo.id} /> : null}
                  </Stack>
                </Card>
              ))}
            </Stack>
          )}
        </Stack>
      ) : null}

      {tab === "projects" ? (
        <Stack gap={3}>
          <div><Btn variant="solid" tone="brand" onClick={() => void editProject(org)}>{i18n("pages.organization.0e1a7040390f")}</Btn></div>
          {projects.length === 0 ? <Text tone="faint">{i18n("pages.organization.b41fea3b8092")}</Text> : null}
          {projects.map((p) => (
            <Card key={p.id}>
              <Stack gap={2}>
                <Text slot="title">{p.name}</Text>
                <Text>{p.description || i18n("pages.organization.71083097a94f")}</Text>
                <Text slot="micro">{i18nRich("pages.organization.735033d7d37f", { value: p.owner || i18n("pages.organization.17bf181625e8") })}</Text>
                <div className="name-card-actions">
                  <Select aria-label={i18n("pages.organization.752caefd1bea", { name: String(p.name) })} value={p.status} onChange={(v) => void runRemote(()=>saveRemoteContent(org.id,"projects",p,{...p,status:v as OrgProject["status"],updatedAt:Date.now()}))}>
                    <option value="planned">{i18n("pages.organization.26e515a6709d")}</option>
                    <option value="active">{i18n("pages.organization.dc9591e56d50")}</option>
                    <option value="done">{i18n("pages.organization.f28461bb49c8")}</option>
                  </Select>
                  <Btn size="sm" variant="ghost" onClick={() => void editProject(org, p)}>{i18n("pages.organization.051836569928")}</Btn>
                  <Btn size="sm" variant="ghost" tone="error" onClick={() => void confirmOk(i18nMsg("pages.organization.e4c62033c16d", { name: String(p.name) })).then((ok) => { if (ok) void runRemote(()=>saveRemoteContent(org.id,"projects",p,undefined)); })}>{i18n("pages.organization.2f9daa828907")}</Btn>
                </div>
              </Stack>
            </Card>
          ))}
        </Stack>
      ) : null}

      {tab === "notices" ? (
        <Stack gap={3}>
          <div><Btn variant="solid" tone="brand" onClick={() => void editNotice(org)}>{i18n("pages.organization.d78a6a9cd030")}</Btn></div>
          {noticeList.length === 0 ? <Text tone="faint">{i18n("pages.organization.bd1aee6959f6")}</Text> : null}
          {noticeList.map((n) => (
            <Card key={n.id}>
              <Stack gap={2}>
                <Text slot="title">{n.pinned ? i18n("pages.organization.76e68f1e2fcd") : ""}{n.title}</Text>
                <div className="org-notice-body">{n.body}</div>
                <div className="name-card-actions">
                  <Btn size="sm" variant="ghost" onClick={() => void runRemote(()=>saveRemoteContent(org.id,"announcements",n,{...n,pinned:!n.pinned,updatedAt:Date.now()}))}>{n.pinned ? i18n("pages.organization.c92179b74af6") : i18n("pages.organization.173f88d28ebf")}</Btn>
                  <Btn size="sm" variant="ghost" onClick={() => void editNotice(org, n)}>{i18n("pages.organization.051836569928")}</Btn>
                  <Btn size="sm" variant="ghost" tone="error" onClick={() => void confirmOk(i18nMsg("pages.organization.854c6ca1dc79", { title: String(n.title) })).then((ok) => { if (ok) void runRemote(()=>saveRemoteContent(org.id,"announcements",n,undefined)); })}>{i18n("pages.organization.2f9daa828907")}</Btn>
                </div>
              </Stack>
            </Card>
          ))}
        </Stack>
      ) : null}

      <Modal open={mode === "full" && Boolean(invite)} onClose={() => setInvite(null)} title={i18n("pages.organization.10f106e00d20")} size="sm">
        {invite ? (
          <Stack gap={3}>
            <Text slot="micro" tone="faint">{i18nRich("pages.organization.6b3341c7022d", { value: invite.label ? `「${invite.label}」　` : "", value2: invite.allowEmail ?? i18n("pages.organization.b8e3e3e6c5e6"), value3: expireText(org.invite?.expiresAt) })}</Text>
            <code className="vault-share-code">{invite.code}</code>
            <div className="vault-qr"><QRCodeSVG value={invite.code} size={180} /></div>
            <Inline gap={2} wrap>
              <Btn size="sm" variant="solid" tone="brand" onClick={() => void navigator.clipboard.writeText(invite.code).then(() => showToast(i18nMsg("pages.organization.8f6f8d979c98"))).catch(() => showToast(i18nMsg("pages.organization.f2d4a102e351")))}>{i18n("pages.organization.7dc5266a2019")}</Btn>
              <Btn size="sm" variant="ghost" onClick={() => setInvite(null)}>{i18n("pages.organization.afd4b783536b")}</Btn>
            </Inline>
          </Stack>
        ) : null}
      </Modal>
    </div>
  );
}
