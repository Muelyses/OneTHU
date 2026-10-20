import { useEffect, useMemo, useState, type ReactNode } from "react";
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

const ROLE_LABEL: Record<OrgRole, string> = { owner: "负责人", member: "成员", guest: "访客" };

function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

const INVITE_EXPIRES = [
  { value: "1", label: "1 天" },
  { value: "7", label: "7 天" },
  { value: "30", label: "30 天" },
  { value: "0", label: "不过期" },
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
  if (!at) return "不过期";
  const d = new Date(at);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** GitLab path 规则：小写字母/数字/_/-/.；中文名转不出就退回 org-<时间>。 */
function gitlabSlug(name: string): string {
  const slug = name.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9_.-]/g, "");
  return slug || "org-" + Date.now().toString(36);
}

/* ══════════ 选择组织（深链没带 orgId 时的落地页） ══════════ */

function OrgPicker(): ReactNode {
  const doc = useOrgs();
  const create = async (): Promise<void> => {
    const email = await currentOrgEmail();
    const f = await openFormModal("新建组织", [
      { key: "name", label: "组织名称", required: true },
      { key: "brief", label: "一句话简介（可选）", kind: "textarea" },
      { key: "joinUrl", label: "加入方式（GitLab 组织 / 云盘资料库链接，可选）" },
    ]);
    if (!f?.name) return;
    const org = createOrg({ name: f.name, brief: f.brief, joinUrl: f.joinUrl, ownerEmail: email });
    openTab("org", { orgId: org.id }, { title: org.name });
    showToast(`已创建「${org.name}」`);
  };
  const join = async (): Promise<void> => {
    const f = await openFormModal("用邀请口令加入组织", [
      { key: "code", label: "组织邀请口令（ON-…）", kind: "textarea", required: true },
      { key: "name", label: "你在组织里的名字", default: "我" },
    ]);
    if (!f?.code) return;
    const r = await acceptOrgInvite(f.code, f.name || "我");
    if (!r.ok) {
      showToast(r.reason ?? "邀请口令无法识别");
      return;
    }
    showToast("已加入组织");
    if (r.orgId) openTab("org", { orgId: r.orgId }, { title: "组织" });
  };
  return (
    <div className="org-page">
      <PageHead
        title="组织"
        meta="成员、资料库与 GitLab 仓库，都落在真实账号上。"
        actions={
          <Inline gap={2} wrap>
            <Btn variant="solid" tone="brand" onClick={() => void create()}>新建组织</Btn>
            <Btn variant="outline" onClick={() => void join()}>用邀请口令加入</Btn>
          </Inline>
        }
      />
      {doc.orgs.length === 0 ? (
        <EmptyState
          icon={<IconIn size="lg" />}
          title="还没有组织"
          hint="建一个组织：成员按邮箱加入，资料库共享到邮箱，GitLab 仓库挂到组织上。"
          action={
            <Inline gap={2} wrap>
              <Btn variant="solid" tone="brand" onClick={() => void create()}>新建组织</Btn>
              <Btn variant="outline" onClick={() => void join()}>用邀请口令加入</Btn>
            </Inline>
          }
        />
      ) : (
        <List divided>
          {doc.orgs.map((o) => (
            <Row
              key={o.id}
              title={o.name}
              sub={`${o.members.length} 名成员 · ${(o.libraries ?? []).length} 个资料库 · ${(o.gitlabRepos ?? []).length} 个仓库${o.brief ? " · " + o.brief : ""}`}
              onClick={() => openTab("org", { orgId: o.id }, { title: o.name })}
              trailing={<Btn size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); openTab("org", { orgId: o.id }, { title: o.name }); }}>打开</Btn>}
            />
          ))}
        </List>
      )}
    </div>
  );
}

/* ══════════ 资料库内联文件浏览 + 文件预览 ══════════ */

function LibraryFiles({ repoId, name }: { repoId: string; name: string }): ReactNode {
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
      showToast(`打不开预览：${e instanceof Error ? e.message : String(e)}（可直接下载）`);
    } finally {
      setPreviewing("");
    }
  };

  return (
    <div className="org-files">
      <div className="name-card-actions">
        <Btn size="sm" variant="ghost" disabled={busy} onClick={() => void load(path)}>刷新</Btn>
        {path !== "/" ? <Btn size="sm" variant="ghost" onClick={() => void load(path.replace(/\/[^/]+$/, "") || "/")}>上一级</Btn> : null}
        <Text slot="micro" tone="faint">「{name}」{path === "/" ? "根目录" : path}</Text>
      </div>
      {busy && !entries ? <Text slot="micro" tone="faint">正在读取云盘…</Text> : null}
      {error ? <Text slot="micro" tone="faint">{error}（可在云盘页确认登录后重试）</Text> : null}
      {entries && entries.length === 0 ? <Text slot="micro" tone="faint">这个资料库还是空的：可以到云盘里上传文件，回来就能预览。</Text> : null}
      {entries && entries.length > 0 ? (
        <List divided>
          {entries.map((entry) => (
            <Row
              key={entry.name}
              title={entry.name}
              sub={entry.kind === "dir" ? "文件夹" : `${Math.max(1, Math.ceil(entry.size / 1024))} KB`}
              onClick={() => {
                if (entry.kind === "dir") void load((path === "/" ? "" : path) + "/" + entry.name);
                else void openFile(entry);
              }}
              trailing={entry.kind === "file" ? <Btn size="sm" variant="ghost" disabled={previewing === entry.name} onClick={(e) => { e.stopPropagation(); void openFile(entry); }}>{previewing === entry.name ? "读取中…" : "预览"}</Btn> : null}
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
              {preview?.data.kind === "too-big" ? "文件太大，不适合直接预览" : "这种文件不支持内联预览"}
              {preview?.data.size ? `（约 ${Math.ceil(preview.data.size / 1024)} KB）` : ""}
            </Text>
            <Inline gap={2}>
              <Btn variant="outline" onClick={() => void seafileDownload(repoId, (path === "/" ? "" : path) + "/" + (preview?.title ?? "")).catch((e) => showToast(`下载失败：${e instanceof Error ? e.message : String(e)}`))}>下载到本机</Btn>
              <Btn variant="ghost" onClick={() => setPreview(null)}>关闭</Btn>
            </Inline>
          </Stack>
        )}
      </Modal>
    </div>
  );
}

/* ══════════ GitLab 仓库内联预览 ══════════ */

function RepoPreview({ projectId }: { projectId: number }): ReactNode {
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
  if (error) return <Text slot="micro" tone="faint">{error}（先打开 GitLab 登录后可预览）</Text>;
  if (!detail) return <Text slot="micro" tone="faint">正在读取仓库…</Text>;
  const last = detail.last_activity_at ? new Date(detail.last_activity_at).toLocaleString("zh-CN", { hour12: false }) : "未知";
  return (
    <KeyValue
      rows={[
        { k: "描述", v: detail.description || "（空）" },
        { k: "默认分支", v: detail.default_branch || "（空库）" },
        { k: "可见性", v: detail.visibility === "private" ? "私有" : detail.visibility === "internal" ? "内部" : "公开" },
        { k: "Star / Fork", v: `${detail.star_count} / ${detail.forks_count}` },
        { k: "未关闭 Issue", v: String(detail.open_issues_count) },
        { k: "最近活动", v: last },
      ]}
    />
  );
}

/* ══════════ 组织主页 ══════════ */

/** 深链/旧标签指向的组织在本机不存在（已删除/换设备）：给明确出口，不装作空组织页。 */
function OrgMissing(): ReactNode {
  return (
    <div className="org-page">
      <PageHead
        title="组织"
        meta="这个组织不在这台设备上了。"
        actions={<Btn variant="outline" onClick={() => openTab("contacts", { section: "orgs" })}>打开通讯录</Btn>}
      />
      <EmptyState
        icon={<IconIn size="lg" />}
        title="找不到这个组织"
        hint="可能已经被删除，或换了设备；到通讯录的「我的组织」里重新新建/加入。"
        action={<Btn variant="solid" tone="brand" onClick={() => openTab("contacts", { section: "orgs" })}>去通讯录「我的组织」</Btn>}
      />
    </div>
  );
}

export function OrganizationPage(): ReactNode {
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
  const runRemote = async (action: () => Promise<void>, success?: string): Promise<void> => {
    setCollabBusy(true); setCollabError("");
    try { await action(); if (success) showToast(success); }
    catch (e) { setCollabError(e instanceof Error ? e.message : String(e)); }
    finally { setCollabBusy(false); }
  };
  const needsCollaboration = (target: Org): boolean => {
    if (!target.collaboration) { setCollabError("请先启用多人协作；成员身份与共享资料需要服务器确认。"); return true; }
    return false;
  };
  useEffect(() => {
    if (!orgId || !org?.collaboration || org.collaboration.status === "initializing") return;
    const refresh = () => { if (document.visibilityState !== "hidden") void refreshRemoteOrg(orgId).catch(e => setCollabError(e instanceof Error ? e.message : String(e))); };
    refresh();
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [orgId, Boolean(org?.collaboration)]);
  /* 云盘配置是懒加载的：进组织页先把 token / 资料库列表拉起来，
     否则「新建资料库」会拿空 token 直接跳云盘页（用户观感=报错）。 */
  useEffect(() => {
    let alive = true;
    void (async () => {
      await ensureSeafileLoaded();
      if (!alive || !getSeafileToken()) return;
      await refreshRepos();
    })();
    return () => { alive = false; };
  }, []);
  const noticeList = useMemo(
    () => [...(org?.announcements ?? [])].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt),
    [org?.announcements],
  );

  /* ── 基本资料 ── */
  const editOrg = async (target: Org): Promise<void> => {
    const f = await openFormModal("编辑组织资料", [
      { key: "name", label: "组织名称", required: true, default: target.name },
      { key: "brief", label: "简介", kind: "textarea", default: target.brief },
      { key: "joinUrl", label: "加入链接（GitLab 组织 / 云盘资料库，可选）", default: target.joinUrl },
    ]);
    if (!f?.name) return;
    if (target.collaboration) await runRemote(() => updateRemoteOrg(target.id, {name:target.name,brief:target.brief,joinUrl:target.joinUrl}, {name:f.name!,brief:f.brief??"",joinUrl:f.joinUrl??""}), "组织资料已同步");
    else { updateOrg(target.id, { name: f.name, brief: f.brief ?? "", joinUrl: f.joinUrl ?? "" }); showToast("本机组织资料已更新；启用多人协作后会上传"); }
  };

  /* ── 邀请 ── */
  const makeInvite = async (target: Org): Promise<void> => {
    const f = await openFormModal("邀请成员", [
      { key: "label", label: "口令名（如「算法组招新」，可选）", default: target.invite?.label ?? "" },
      { key: "allowEmail", label: "只允许这个清华云盘邮箱接受（可选）", default: target.invite?.allowEmail ?? "" },
      { key: "expireDays", label: "有效期（改了会换一条新口令）", kind: "select", options: INVITE_EXPIRES, default: inviteExpireDays(target.invite) },
    ]);
    if (!f) return;
    const email = (f.allowEmail ?? "").trim();
    if (email && !isEmail(email)) {
      showToast("邮箱格式不对");
      return;
    }
    const expireDays = Number(f.expireDays ?? "7") === 0 ? 0 : Number(f.expireDays ?? "7");
    try {
      const code = await orgInviteCode(target, "我", { label: f.label ?? "", allowEmail: email, expireDays });
      setInvite({ code, ...(f.label ? { label: f.label } : {}), ...(email ? { allowEmail: email } : {}) });
      const lifetime = expireDays > 0 ? `${expireDays} 天有效` : "不过期";
      await navigator.clipboard.writeText(code).then(() => showToast(`邀请口令已复制（${lifetime}）`)).catch(() => showToast(`邀请口令已生成（${lifetime}）`));
    } catch (e) {
      showToast(`生成邀请失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  /* ── 成员 ── */
  const addMember = async (target: Org): Promise<void> => {
    if (needsCollaboration(target)) return;
    const f = await openFormModal("添加组织成员", [
      {key:"username",label:"GitLab 用户名（个人资料中的 @用户名）",required:true},
      {key:"email",label:"清华云盘邮箱",required:true},
      {key:"role",label:"角色",kind:"select",options:[{value:"member",label:"成员：编辑项目和公告"},{value:"guest",label:"访客：只读"},{value:"owner",label:"负责人：管理组织与权限"}]},
    ]);
    if (!f) return;
    await runRemote(async () => { const binding = await resolveOrgUser(f.username!,f.email!); await changeRemoteMember(target.id,undefined,{...binding,role:(f.role??"member") as OrgRole}); }, "成员及共享权限已验证完成");
  };
  const editMember = async (target: Org, memberId: string): Promise<void> => {
    if (needsCollaboration(target)) return;
    const member = target.members.find(m=>m.id===memberId);
    if (!member?.gitlabUserId || !member.username) { setCollabError("这个成员尚未绑定服务器身份，请用 GitLab 用户名重新添加"); return; }
    const f = await openFormModal("修改云盘邮箱", [{key:"email",label:`${member.username} 的清华云盘邮箱`,default:member.email,required:true}]);
    if (!f) return;
    await runRemote(async () => { const binding = await resolveOrgUser(member.username!,f.email!); await changeRemoteMember(target.id,member.gitlabUserId,{...binding,role:member.role},{email:member.email,role:member.role}); }, "新邮箱已授权，旧邮箱权限已撤销");
  };
  const changeRole = async (target: Org, memberId: string, role: OrgRole): Promise<void> => {
    if (needsCollaboration(target)) return;
    const member = target.members.find(m=>m.id===memberId); if (!member?.gitlabUserId || !member.username) return;
    await runRemote(() => changeRemoteMember(target.id,member.gitlabUserId,{userId:member.gitlabUserId!,username:member.username!,name:member.name,email:member.email,role},{email:member.email,role:member.role}), "角色与资源权限已验证完成");
  };
  const removeMember = async (target: Org, memberId: string): Promise<void> => {
    if (needsCollaboration(target)) return;
    const member = target.members.find(m=>m.id===memberId); if (!member?.gitlabUserId) return;
    if (!await confirmOk(`从服务器移除「${member.name}」并撤销关联资料库与仓库的权限？`)) return;
    await runRemote(()=>changeRemoteMember(target.id,member.gitlabUserId,undefined,{email:member.email,role:member.role}),"成员与关联资源权限已移除");
  };

  /* ── 资料库 ── */
  const createLibrary = async (target: Org): Promise<void> => {
    if (needsCollaboration(target)) return;
    await ensureSeafileLoaded();
    if (!getSeafileToken()) {
      showToast("先连接清华云盘再建资料库");
      openTab("cloud");
      return;
    }
    const f = await openFormModal("新建组织资料库", [{ key: "name", label: "资料库名称", default: `${target.name} 资料库`, required: true }]);
    if (!f?.name) return;
    setSharing("create-lib");
    try {
      await assertOrgManager(target.id);
      const repoId = await seafileCreateRepo(f.name);
      await updateRemoteResources(target.id,"libraries",target.libraries??[],[...(target.libraries??[]),{repoId,name:f.name.trim(),addedAt:Date.now()}]);
      showToast(`资料库「${f.name}」已创建、关联并核对成员权限`);
    } catch (e) {
      showToast(`建资料库失败：${e instanceof Error ? e.message : String(e)}（可到云盘页确认登录后重试）`);
    } finally {
      setSharing("");
    }
  };

  const linkLibrary = async (target: Org): Promise<void> => {
    if (needsCollaboration(target)) return;
    const repos = seafile.repos.filter((r) => !(target.libraries ?? []).some((l) => l.repoId === r.id));
    if (!repos.length) {
      showToast(seafile.repos.length ? "云盘里的资料库都已关联" : "云盘里还没有资料库：先新建一个");
      return;
    }
    const f = await openFormModal("关联已有资料库", [
      { key: "repoId", label: "选择资料库", kind: "select", options: repos.map((r) => ({ value: r.id, label: r.name })) },
    ]);
    if (!f?.repoId) return;
    const hit = repos.find((r) => r.id === f.repoId);
    await runRemote(()=>updateRemoteResources(target.id,"libraries",target.libraries??[],[...(target.libraries??[]),{repoId:f.repoId!,name:hit?.name??f.repoId!,addedAt:Date.now()}]),"资料库已关联并核对成员权限");
  };

  const shareLibrary = async (target: Org, _repoId: string, _name: string): Promise<void> => { await syncAllPermissions(target); };

  const copyLibraryLink = async (repoId: string, name: string): Promise<void> => {
    setSharing(repoId);
    try {
      await ensureSeafileLoaded();
      if (!getSeafileToken()) throw new Error("清华云盘未连接：先到云盘页登录");

      await navigator.clipboard.writeText(`https://cloud.tsinghua.edu.cn/library/${encodeURIComponent(repoId)}/`);
      showToast(`「${name}」的成员入口已复制，需要登录并拥有资料库权限`);
    } catch (e) {
      showToast(`复制成员入口失败：${e instanceof Error ? e.message : String(e)}（可在云盘页确认登录后重试）`);
    } finally {
      setSharing("");
    }
  };

  const syncAllPermissions = async (target: Org): Promise<void> => {
    if (needsCollaboration(target)) return;
    await runRemote(()=>retryOrgPermissions(target.id),"所有关联资源的权限已回读核对");
  };

  /* ── GitLab ── */
  const linkGitlab = async (target: Org): Promise<void> => {
    if (needsCollaboration(target)) return;
    const f = await openFormModal("关联 GitLab 仓库", [
      { key: "path", label: "本组织私有仓库完整路径", required: true, placeholder: "group/project" },
    ]);
    if (!f?.path) return;
    setSharing("gitlab");
    try {
      const repo = await gitlabProjectByPath(f.path);
      await updateRemoteResources(target.id,"gitlabRepos",target.gitlabRepos??[],[...(target.gitlabRepos??[]),{...repo,addedAt:Date.now()}]);
      showToast(`「${repo.name}」已关联并核对成员权限`);
    } catch (e) {
      showToast(`关联仓库失败：${e instanceof Error ? e.message : String(e)}`);
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
      ...(group ? [] : [{ key: "groupName", label: "GitLab 组织名", default: target.name, required: true } as const]),
      { key: "name", label: group ? "新仓库名" : "第一个仓库名", default: gitlabSlug(target.name), required: true } as const,
      { key: "description", label: "描述（可选）" } as const,
    ];
    const f = await openFormModal(group ? "在 GitLab 组织下新建仓库" : "创建 GitLab 组织与仓库", fields);
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
          description: `${target.name} 的组织空间`,
          visibility,
        });
        setOrgGitlabGroup(target.id, groupRef);
      }
      const repo = await gitlabCreateProject({
        name: f.name,
        description: f.description || `${target.name} 的组织仓库`,
        visibility,
        namespaceId: groupRef.id,
      });
      await updateRemoteResources(target.id,"gitlabRepos",target.gitlabRepos??[],[...(target.gitlabRepos??[]),{...repo,addedAt:Date.now()}]);
      showToast(`仓库「${repo.name}」已创建并核对成员权限`);
    } catch (e) {
      showToast(`创建 GitLab 组织/仓库失败：${e instanceof Error ? e.message : String(e)}（可在 GitLab 页确认登录与组织名占用）`);
    } finally {
      setSharing("");
    }
  };

  /* ── 项目 / 公告 ── */
  const editProject = async (target: Org, project?: OrgProject, draft?: Record<string,string>): Promise<void> => {
    if (needsCollaboration(target)) return;
    const f = await openFormModal(project ? "编辑项目" : "新建项目", [
      {key:"name",label:"项目名称",required:true,default:draft?.name??project?.name},
      {key:"description",label:"项目说明",kind:"textarea",default:draft?.description??project?.description},
      {key:"owner",label:"负责人",default:draft?.owner??project?.owner},
    ]);
    if (!f) return;
    await runRemote(async()=>{
      try { await saveRemoteContent(target.id,"projects",project,{id:project?.id??crypto.randomUUID(),name:f.name!,description:f.description??"",owner:f.owner??"",status:project?.status??"planned",updatedAt:Date.now()}); setRetainedDraft(null); }
      catch(e) { setRetainedDraft({label:"尚未保存的项目",text:JSON.stringify(f,null,2),reopen:()=>void editProject(orgSnapshot().orgs.find(o=>o.id===target.id)??target,orgSnapshot().orgs.find(o=>o.id===target.id)?.projects?.find(p=>p.id===project?.id),f)}); throw e; }
    },"项目已同步给组织成员");
  };
  const editNotice = async (target: Org, notice?: OrgAnnouncement, draft?: Record<string,string>): Promise<void> => {
    if (needsCollaboration(target)) return;
    const f = await openFormModal(notice ? "编辑公告" : "发布公告", [
      {key:"title",label:"公告标题",required:true,default:draft?.title??notice?.title},
      {key:"body",label:"公告内容",kind:"textarea",required:true,default:draft?.body??notice?.body},
    ]);
    if (!f) return;
    await runRemote(async()=>{
      try { await saveRemoteContent(target.id,"announcements",notice,{id:notice?.id??crypto.randomUUID(),title:f.title!,body:f.body!,pinned:notice?.pinned??false,updatedAt:Date.now()}); setRetainedDraft(null); }
      catch(e) { setRetainedDraft({label:"尚未保存的公告",text:JSON.stringify(f,null,2),reopen:()=>void editNotice(orgSnapshot().orgs.find(o=>o.id===target.id)??target,orgSnapshot().orgs.find(o=>o.id===target.id)?.announcements?.find(n=>n.id===notice?.id),f)}); throw e; }
    },"公告已同步给组织成员");
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
          <Text slot="title">{org.collaboration ? "组织多人协作" : "启用组织多人协作"}</Text>
          <Text tone="faint">{org.collaboration ? `成员权限由 GitLab 服务器确认，项目和公告共享给成员。${org.collaboration.lastReadAt ? `最近读取 ${new Date(org.collaboration.lastReadAt).toLocaleTimeString()}` : ""}` : "将现有项目和公告迁入私有组织空间。历史成员资料保留，需补绑 GitLab 用户名。"}</Text>
          <Inline gap={2} wrap>
            {!org.collaboration || org.collaboration.status === "initializing" ? <Btn disabled={collabBusy} variant="solid" onClick={()=>void runRemote(()=>enableOrgCollaboration(org.id),"组织多人协作已启用")}>{collabBusy?"正在连接…":"启用多人协作"}</Btn> : null}
            {org.collaboration ? <Btn disabled={collabBusy} variant="outline" onClick={()=>void runRemote(async()=>{await refreshRemoteOrg(org.id);})}>刷新组织</Btn> : null}
            {org.collaboration?.pending ? <Btn disabled={collabBusy} variant="solid" onClick={()=>void runRemote(()=>retryOrgPermissions(org.id),"权限变更已全部核对完成")}>重试未完成的权限变更</Btn> : null}
            {org.collaboration?.status === "error" && !org.collaboration.lastReadAt ? <Btn disabled={collabBusy} variant="outline" onClick={()=>void runRemote(()=>enableOrgCollaboration(org.id))}>继续初始化</Btn> : null}
          </Inline>
          {org.legacyMembers?.length ? <Text tone="faint">待绑定 GitLab 账号的历史成员：{org.legacyMembers.map(m=>`${m.name} ${m.email}`).join("、")}。原资料已保留，请在成员页添加对应用户名。</Text> : null}
          {collabError || org.collaboration?.error ? <div role="alert"><Text tone="error">{collabError || org.collaboration?.error}</Text></div> : null}
          {retainedDraft ? <Card><Text slot="title">{retainedDraft.label}</Text><Text slot="micro">{retainedDraft.text}</Text><Btn onClick={retainedDraft.reopen}>带着这些输入重新编辑</Btn></Card> : null}
        </Stack>
      </Card>
      <PageHead
        title={org.name}
        meta={org.brief || "成员、资料库与 GitLab 仓库都挂在这个组织上。"}
        actions={
          <Inline gap={2} wrap>
            <Btn variant="solid" tone="brand" onClick={() => void makeInvite(org)}>邀请成员</Btn>
            <Btn variant="outline" onClick={() => void editOrg(org)}>编辑资料</Btn>
            <Btn variant="ghost" onClick={() => openTab("contacts", { section: "orgs" })}>全部组织</Btn>
          </Inline>
        }
      />
      <div className="org-tabs">
        <Segment
          value={tab}
          onChange={setTab}
          options={[
            { value: "overview", label: "概览" },
            { value: "members", label: "成员" },
            { value: "libraries", label: "资料库" },
            { value: "gitlab", label: "GitLab" },
            { value: "projects", label: "项目" },
            { value: "notices", label: "公告" },
          ]}
        />
      </div>

      {tab === "overview" ? (
        <Stack gap={5}>
          <Card>
            <Section title="组织概况" hint="成员邮箱、资料库与仓库都是真实资源" />
            <KeyValue
              rows={[
                { k: "成员", v: `${org.members.length} 人（${org.members.filter((m) => m.email).length} 人已绑定邮箱）` },
                { k: "负责人", v: owner ? `${owner.name}${owner.email ? ` · ${owner.email}` : ""}` : "未设置" },
                { k: "资料库", v: libraries.length ? libraries.map((l) => l.name).join("、") : "还没有资料库" },
                { k: "GitLab 组织", v: org.gitlabGroup ? `${org.gitlabGroup.name}（${org.gitlabGroup.path}）` : "还没有（新建仓库时自动创建）" },
                { k: "GitLab 仓库", v: gitlabRepos.length ? gitlabRepos.map((r) => r.path).join("、") : "还没有关联仓库" },
                { k: "加入方式", v: org.joinUrl || "未设置" },
              ]}
            />
            <div className="name-card-actions">
              <Btn variant="outline" onClick={() => void addMember(org)}>添加成员</Btn>
              <Btn variant="outline" onClick={() => setTab("libraries")}>去建资料库</Btn>
              <Btn variant="ghost" onClick={() => setTab("gitlab")}>去关联仓库</Btn>
              <Btn variant="ghost" onClick={() => { const r = addToVault(orgCardCatch(orgIdentityCard(org))); showToast(r.ok ? "组织名片已放进暂存箱" : "暂存箱里已经有这张名片了"); }}>放进暂存箱</Btn>
            </div>
          </Card>
          {org.invite ? (
            <Card>
              <Section title="最近邀请口令" hint="口令可起名，也可限定某个云盘邮箱才能接受" />
              <div className="vault-share">
                <Text slot="micro" tone="faint">
                  {org.invite.label ? `「${org.invite.label}」` : "邀请口令"}　接收人：{org.invite.allowEmail ?? "任何人"}　有效期：{expireText(org.invite.expiresAt)}
                </Text>
                <code className="vault-share-code">{org.invite.code}</code>
                <Inline gap={2} wrap>
                  <Btn size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(org.invite!.code).then(() => showToast("已复制")).catch(() => showToast("请手动复制"))}>复制口令</Btn>
                  <Btn size="sm" variant="ghost" onClick={() => setInvite(org.invite!)}>显示二维码</Btn>
                  <Btn size="sm" variant="ghost" onClick={() => void makeInvite(org)}>改名称 / 接收人 / 有效期</Btn>
                  <Btn
                    size="sm"
                    variant="ghost"
                    tone="error"
                    onClick={() => void confirmOk("删除这个组织邀请口令？删除后对方将无法再用它加入。").then((ok) => {
                      if (!ok) return;
                      void revokeOrgInvite(org.id).then((r) => showToast(r.ok ? (r.reason ?? "邀请口令已删除") : r.reason ?? "删除失败：到设置里检查云盘登录后重试"));
                    })}
                  >
                    删除口令
                  </Btn>
                </Inline>
              </div>
            </Card>
          ) : null}
          <Card>
            <Section title="组织名片" hint="名片由组织资料自动生成，不需要另建" />
            <IdentityCard card={orgIdentityCard(org)} organization variant="detail" />
          </Card>
          <Card>
            <Section title="危险操作" hint="只删本机组织记录；云盘资料库与 GitLab 仓库不会被删除" />
            <Btn
              variant="ghost"
              tone="error"
              onClick={() => void confirmOk(`删除组织「${org.name}」？本机记录会删除（云盘资料库与 GitLab 仓库不动）。`).then((ok) => {
                if (!ok) return;
                deleteOrg(org.id);
                openTab("contacts", { section: "orgs" });
              })}
            >
              删除这个组织
            </Btn>
          </Card>
        </Stack>
      ) : null}

      {tab === "members" ? (
        <Stack gap={4}>
          <Inline gap={2} wrap>
            <Btn variant="solid" tone="brand" onClick={() => void addMember(org)}>添加成员</Btn>
            <Btn variant="outline" onClick={() => void makeInvite(org)}>邀请口令</Btn>
            <Btn
              variant="ghost"
              disabled={!libraries.length}
              onClick={() => { void (async () => { for (const lib of libraries) await shareLibrary(org, lib.repoId, lib.name); })(); }}
            >
              把资料库共享给全体成员
            </Btn>
            <Btn variant="outline" disabled={sharing === "sync-all"} onClick={() => void syncAllPermissions(org)}>
              {sharing === "sync-all" ? "同步中…" : "同步云盘与 GitLab 权限"}
            </Btn>
          </Inline>
          <Text slot="micro" tone="faint">成员身份来自 GitLab。权限变更未完成时，可先编辑缺失或错误的云盘邮箱，再重试。</Text>
          <List divided>
            {org.members.map((m) => (
              <Row
                key={m.id}
                title={m.name}
                sub={m.email || "还没绑定邮箱 · 点「编辑」补上"}
                trailing={
                  <div className="name-card-actions">
                    <Select aria-label={`${m.name}的角色`} value={m.role} disabled={collabBusy} onChange={(v) => void changeRole(org, m.id, v as OrgRole)}>
                      <option value="owner">{ROLE_LABEL.owner}</option>
                      <option value="member">{ROLE_LABEL.member}</option>
                      <option value="guest">{ROLE_LABEL.guest}</option>
                    </Select>
                    <Btn size="sm" variant="ghost" onClick={() => void editMember(org, m.id)}>编辑</Btn>
                    <Btn size="sm" variant="ghost" tone="error" onClick={() => void removeMember(org, m.id)}>移除</Btn>
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
              <Text slot="label">还没连接清华云盘</Text>
              <Text slot="micro" tone="faint">资料库是云盘上的「资料库（repo）」，共享按成员邮箱发送。先把云盘连上。</Text>
              <div className="name-card-actions"><Btn variant="solid" tone="brand" onClick={() => openTab("cloud")}>去连接云盘</Btn></div>
            </Card>
          ) : null}
          <Inline gap={2} wrap>
            <Btn variant="solid" tone="brand" disabled={sharing === "create-lib"} onClick={() => void createLibrary(org)}>新建资料库</Btn>
            <Btn variant="outline" onClick={() => void linkLibrary(org)}>关联已有资料库</Btn>
          </Inline>
          {libraries.length === 0 ? (
            <EmptyState
              icon={<IconIn size="lg" />}
              title="组织还没有资料库"
              hint="建一个独立的云盘资料库给组织，成员按邮箱获得读写权限——不是组织页里塞几个文件夹。"
            />
          ) : (
            <Stack gap={3}>
              {libraries.map((lib) => (
                <Card key={lib.repoId}>
                  <Stack gap={2}>
                    <Text slot="title">{lib.name}</Text>
                    <Text slot="micro" tone="faint">
                      {org.collaboration ? "权限根据服务器成员和云盘回读核对" : `已共享：${lib.sharedWith?.join("、") || "还没有共享给成员"}`}
                    </Text>
                    <div className="name-card-actions">
                      <Btn size="sm" variant="outline" onClick={() => openTab("cloud", { cloudRepo: lib.repoId })}>打开资料库</Btn>
                      <Btn size="sm" variant="outline" disabled={sharing === lib.repoId} onClick={() => void shareLibrary(org, lib.repoId, lib.name)}>共享给成员</Btn>
                      <Btn size="sm" variant="ghost" disabled={sharing === lib.repoId} onClick={() => void copyLibraryLink(lib.repoId, lib.name)}>复制成员入口</Btn>
                      <Btn size="sm" variant="ghost" onClick={() => setOpenLib(openLib === lib.repoId ? null : lib.repoId)}>{openLib === lib.repoId ? "收起文件" : "预览文件"}</Btn>
                      <Btn size="sm" variant="ghost" tone="error" onClick={() => void confirmOk(`解除资料库「${lib.name}」与组织的关联？云盘里的资料库不会被删除。`).then((ok) => { if (ok) { void runRemote(()=>updateRemoteResources(org.id,"libraries",libraries,libraries.filter(x=>x.repoId!==lib.repoId)),"已解除关联"); } })}>解除关联</Btn>
                    </div>
                    {openLib === lib.repoId ? <LibraryFiles repoId={lib.repoId} name={lib.name} /> : null}
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
                <Text slot="title">GitLab 组织 · {org.gitlabGroup.name}</Text>
                <Text slot="micro" tone="faint">{org.gitlabGroup.path} · 新仓库默认建在这个组织下，成员按邮箱邀请</Text>
                <div className="name-card-actions">
                  <Btn size="sm" variant="outline" onClick={() => void openExternal(org.gitlabGroup!.webUrl)}>浏览器打开组织</Btn>
                  <Btn size="sm" variant="ghost" disabled={sharing === "sync-all"} onClick={() => void syncAllPermissions(org)}>邀请成员进组织</Btn>
                </div>
              </Stack>
            </Card>
          ) : (
            <Text slot="micro" tone="faint">还没有 GitLab 组织：新建仓库时会先建组织并邀请成员。</Text>
          )}
          <Inline gap={2} wrap>
            <Btn variant="solid" tone="brand" disabled={sharing === "gitlab"} onClick={() => void createGitlab(org)}>{org.gitlabGroup ? "在组织下新建仓库" : "建 GitLab 组织与仓库"}</Btn>
            <Btn variant="outline" disabled={sharing === "gitlab"} onClick={() => void linkGitlab(org)}>关联已有仓库</Btn>
            <Btn variant="ghost" onClick={() => openTab("gitlab")}>打开 GitLab</Btn>
          </Inline>
          {gitlabRepos.length === 0 ? (
            <EmptyState
              icon={<IconIn size="lg" />}
              title="组织还没有挂 GitLab 仓库"
              hint="新建仓库，或填 group/project 关联已有仓库。"
            />
          ) : (
            <Stack gap={3}>
              {gitlabRepos.map((repo) => (
                <Card key={repo.id}>
                  <Stack gap={2}>
                    <Text slot="title">{repo.name}</Text>
                    <Text slot="micro" tone="faint">{repo.path}</Text>
                    <div className="name-card-actions">
                      <Btn size="sm" variant="outline" onClick={() => openTab("gitlab", { gitlabProject: repo.id }, { title: `${org.name} · ${repo.name}` })}>打开仓库</Btn>
                      <Btn size="sm" variant="ghost" onClick={() => setOpenRepo(openRepo === repo.id ? null : repo.id)}>{openRepo === repo.id ? "收起详情" : "预览项目"}</Btn>
                      <Btn size="sm" variant="ghost" onClick={() => void openExternal(repo.webUrl ?? `https://git.tsinghua.edu.cn/${repo.path}`)}>浏览器打开</Btn>
                      <Btn size="sm" variant="ghost" tone="error" onClick={() => void confirmOk(`解除仓库「${repo.name}」与组织的关联？GitLab 上的仓库不会被删除。`).then((ok) => { if (ok) { void runRemote(()=>updateRemoteResources(org.id,"gitlabRepos",gitlabRepos,gitlabRepos.filter(x=>x.id!==repo.id)),"已解除关联"); } })}>解除关联</Btn>
                    </div>
                    {openRepo === repo.id ? <RepoPreview projectId={repo.id} /> : null}
                  </Stack>
                </Card>
              ))}
            </Stack>
          )}
        </Stack>
      ) : null}

      {tab === "projects" ? (
        <Stack gap={3}>
          <div><Btn variant="solid" tone="brand" onClick={() => void editProject(org)}>新建项目</Btn></div>
          {projects.length === 0 ? <Text tone="faint">把组织要做的事建成项目，记录负责人和进度。</Text> : null}
          {projects.map((p) => (
            <Card key={p.id}>
              <Stack gap={2}>
                <Text slot="title">{p.name}</Text>
                <Text>{p.description || "暂无说明"}</Text>
                <Text slot="micro">负责人：{p.owner || "待分配"}</Text>
                <div className="name-card-actions">
                  <Select aria-label={`${p.name}的进度`} value={p.status} onChange={(v) => void runRemote(()=>saveRemoteContent(org.id,"projects",p,{...p,status:v as OrgProject["status"],updatedAt:Date.now()}))}>
                    <option value="planned">计划中</option>
                    <option value="active">进行中</option>
                    <option value="done">已完成</option>
                  </Select>
                  <Btn size="sm" variant="ghost" onClick={() => void editProject(org, p)}>编辑</Btn>
                  <Btn size="sm" variant="ghost" tone="error" onClick={() => void confirmOk(`删除项目「${p.name}」？`).then((ok) => { if (ok) void runRemote(()=>saveRemoteContent(org.id,"projects",p,undefined)); })}>删除</Btn>
                </div>
              </Stack>
            </Card>
          ))}
        </Stack>
      ) : null}

      {tab === "notices" ? (
        <Stack gap={3}>
          <div><Btn variant="solid" tone="brand" onClick={() => void editNotice(org)}>发布公告</Btn></div>
          {noticeList.length === 0 ? <Text tone="faint">还没有公告。</Text> : null}
          {noticeList.map((n) => (
            <Card key={n.id}>
              <Stack gap={2}>
                <Text slot="title">{n.pinned ? "置顶 · " : ""}{n.title}</Text>
                <div className="org-notice-body">{n.body}</div>
                <div className="name-card-actions">
                  <Btn size="sm" variant="ghost" onClick={() => void runRemote(()=>saveRemoteContent(org.id,"announcements",n,{...n,pinned:!n.pinned,updatedAt:Date.now()}))}>{n.pinned ? "取消置顶" : "置顶"}</Btn>
                  <Btn size="sm" variant="ghost" onClick={() => void editNotice(org, n)}>编辑</Btn>
                  <Btn size="sm" variant="ghost" tone="error" onClick={() => void confirmOk(`删除公告「${n.title}」？`).then((ok) => { if (ok) void runRemote(()=>saveRemoteContent(org.id,"announcements",n,undefined)); })}>删除</Btn>
                </div>
              </Stack>
            </Card>
          ))}
        </Stack>
      ) : null}

      <Modal open={Boolean(invite)} onClose={() => setInvite(null)} title="组织邀请口令" size="sm">
        {invite ? (
          <Stack gap={3}>
            <Text slot="micro" tone="faint">
              {invite.label ? `「${invite.label}」　` : ""}接收人：{invite.allowEmail ?? "任何人（拿到口令就能接受）"}　有效期：{expireText(org.invite?.expiresAt)}
            </Text>
            <code className="vault-share-code">{invite.code}</code>
            <div className="vault-qr"><QRCodeSVG value={invite.code} size={180} /></div>
            <Inline gap={2} wrap>
              <Btn size="sm" variant="solid" tone="brand" onClick={() => void navigator.clipboard.writeText(invite.code).then(() => showToast("已复制")).catch(() => showToast("请手动复制"))}>复制口令</Btn>
              <Btn size="sm" variant="ghost" onClick={() => setInvite(null)}>收起</Btn>
            </Inline>
          </Stack>
        ) : null}
      </Modal>
    </div>
  );
}
