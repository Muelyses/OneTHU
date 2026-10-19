import { useMemo, useState, type ReactNode } from "react";
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
  addOrgLibrary, addOrgMember, createOrg, currentOrgEmail, deleteOrg, deleteOrgAnnouncement, deleteOrgProject,
  linkOrgGitlab, markOrgLibraryShared, orgIdentityCard, orgInviteCode, removeOrgLibrary, removeOrgMember,
  saveOrgAnnouncement, saveOrgProject, setOrgMemberRole, unlinkOrgGitlab, updateOrg, updateOrgMember,
  useOrgs, type Org, type OrgAnnouncement, type OrgProject, type OrgRole,
} from "../state/org.js";
import {
  getSeafileToken, seafileCreateRepo, seafileShareRepo, seafileShareRepoToUser, useSeafile,
} from "../state/seafile.js";
import { gitlabCreateProject, gitlabProjectByPath } from "../state/gitlab.js";
import { addToVault } from "../state/vault.js";
import { orgCardCatch } from "../state/nameCard.js";

const ROLE_LABEL: Record<OrgRole, string> = { owner: "负责人", member: "成员", guest: "访客" };

function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
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
  return (
    <div className="org-page">
      <PageHead
        title="组织"
        meta="成员、资料库与 GitLab 仓库，都落在真实账号上。"
        actions={<Btn variant="solid" tone="brand" onClick={() => void create()}>新建组织</Btn>}
      />
      {doc.orgs.length === 0 ? (
        <EmptyState
          icon={<IconIn size="lg" />}
          title="还没有组织"
          hint="建一个组织：成员按邮箱加入，资料库共享到邮箱，GitLab 仓库挂到组织上。"
          action={<Btn variant="solid" tone="brand" onClick={() => void create()}>新建组织</Btn>}
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

/* ══════════ 组织主页 ══════════ */

export function OrganizationPage(): ReactNode {
  const { navParams } = useApp();
  const doc = useOrgs();
  const orgId = (navParams as { orgId?: string } | null)?.orgId;
  const org: Org | null = doc.orgs.find((o) => o.id === orgId) ?? null;
  const [tab, setTab] = useState("overview");
  const [invite, setInvite] = useState<{ code: string; label?: string; allowEmail?: string } | null>(null);
  const [sharing, setSharing] = useState("");
  const seafile = useSeafile();
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
    updateOrg(target.id, { name: f.name, brief: f.brief ?? "", joinUrl: f.joinUrl ?? "" });
    showToast("组织资料已更新");
  };

  /* ── 邀请 ── */
  const makeInvite = async (target: Org): Promise<void> => {
    const f = await openFormModal("邀请成员", [
      { key: "label", label: "口令名（如「算法组招新」，可选）", default: target.invite?.label ?? "" },
      { key: "allowEmail", label: "只允许这个清华云盘邮箱接受（可选）", default: target.invite?.allowEmail ?? "" },
    ]);
    if (!f) return;
    const email = (f.allowEmail ?? "").trim();
    if (email && !isEmail(email)) {
      showToast("邮箱格式不对");
      return;
    }
    try {
      const code = await orgInviteCode(target, "我", { label: f.label ?? "", allowEmail: email });
      setInvite({ code, ...(f.label ? { label: f.label } : {}), ...(email ? { allowEmail: email } : {}) });
      await navigator.clipboard.writeText(code).then(() => showToast("邀请口令已复制")).catch(() => showToast("邀请口令已生成"));
    } catch (e) {
      showToast(`生成邀请失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  /* ── 成员 ── */
  const addMember = async (target: Org): Promise<void> => {
    const f = await openFormModal("添加成员", [
      { key: "email", label: "清华云盘邮箱", required: true, placeholder: "学号@mails.tsinghua.edu.cn" },
      { key: "name", label: "显示名（留空用邮箱前缀）" },
      { key: "role", label: "角色", kind: "select", options: [{ value: "member", label: "成员" }, { value: "guest", label: "访客" }, { value: "owner", label: "负责人" }] },
    ]);
    if (!f?.email) return;
    if (!isEmail(f.email)) {
      showToast("邮箱格式不对");
      return;
    }
    const name = f.name?.trim() || f.email.split("@")[0] || "成员";
    const r = addOrgMember(target.id, name, f.email, (f.role as OrgRole) ?? "member");
    showToast(r.ok ? "成员已加入" : r.reason === "duplicate" ? "这个邮箱已经在组织里了" : "成员信息不合法");
  };

  const editMember = async (target: Org, memberId: string): Promise<void> => {
    const m = target.members.find((x) => x.id === memberId);
    if (!m) return;
    const f = await openFormModal("编辑成员", [
      { key: "name", label: "显示名", default: m.name },
      { key: "email", label: "清华云盘邮箱", default: m.email, placeholder: "学号@mails.tsinghua.edu.cn" },
    ]);
    if (!f) return;
    const r = updateOrgMember(target.id, memberId, { name: f.name ?? m.name, email: f.email ?? m.email });
    showToast(r.ok ? "成员资料已更新" : r.reason === "duplicate" ? "这个邮箱已经在组织里了" : "邮箱格式不对");
  };

  /* ── 资料库 ── */
  const createLibrary = async (target: Org): Promise<void> => {
    if (!getSeafileToken()) {
      showToast("先连接清华云盘再建资料库");
      openTab("cloud");
      return;
    }
    const f = await openFormModal("新建组织资料库", [{ key: "name", label: "资料库名称", default: `${target.name} 资料库`, required: true }]);
    if (!f?.name) return;
    setSharing("create-lib");
    try {
      const repoId = await seafileCreateRepo(f.name);
      const r = addOrgLibrary(target.id, { repoId, name: f.name.trim() });
      showToast(r.ok ? `资料库「${f.name}」已建好并挂到组织上` : "这个资料库已经关联过了");
    } catch (e) {
      showToast(`建资料库失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSharing("");
    }
  };

  const linkLibrary = async (target: Org): Promise<void> => {
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
    const r = addOrgLibrary(target.id, { repoId: f.repoId, name: hit?.name ?? f.repoId });
    showToast(r.ok ? "资料库已关联" : "这个资料库已经关联过了");
  };

  const shareLibrary = async (target: Org, repoId: string, name: string): Promise<void> => {
    const targets = target.members.filter((m) => m.email);
    if (!targets.length) {
      showToast("成员还没有绑定邮箱：先在「成员」里补上邮箱再共享");
      return;
    }
    if (!getSeafileToken()) {
      showToast("先连接清华云盘再共享资料库");
      openTab("cloud");
      return;
    }
    if (!(await confirmOk(`把资料库「${name}」共享给 ${targets.length} 位成员的云盘账号？`))) return;
    setSharing(repoId);
    let ok = 0;
    const failed: string[] = [];
    for (const m of targets) {
      try {
        await seafileShareRepoToUser(repoId, m.email, m.role === "guest" ? "r" : "rw");
        ok += 1;
      } catch {
        failed.push(m.email);
      }
    }
    if (ok) markOrgLibraryShared(target.id, repoId, targets.filter((m) => !failed.includes(m.email)).map((m) => m.email));
    setSharing("");
    showToast(ok ? `已共享给 ${ok} 位成员${failed.length ? `；${failed.length} 位失败（可在云盘里手动补）` : ""}` : "共享失败：检查云盘登录与成员邮箱");
  };

  const copyLibraryLink = async (repoId: string, name: string): Promise<void> => {
    setSharing(repoId);
    try {
      const share = await seafileShareRepo(repoId, 7);
      await navigator.clipboard.writeText(share.shareUrl).catch(() => undefined);
      showToast(`「${name}」的分享链接已复制（7 天有效）`);
    } catch (e) {
      showToast(`生成分享链接失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSharing("");
    }
  };

  /* ── GitLab ── */
  const linkGitlab = async (target: Org): Promise<void> => {
    const f = await openFormModal("关联 GitLab 仓库", [
      { key: "path", label: "仓库完整路径", required: true, placeholder: "group/project" },
    ]);
    if (!f?.path) return;
    setSharing("gitlab");
    try {
      const repo = await gitlabProjectByPath(f.path);
      const r = linkOrgGitlab(target.id, repo);
      showToast(r.ok ? `已关联「${repo.name}」` : "这个仓库已经关联过了");
    } catch (e) {
      showToast(`找不到仓库（GitLab 未登录也会这样）：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSharing("");
    }
  };

  const createGitlab = async (target: Org): Promise<void> => {
    const f = await openFormModal("新建 GitLab 仓库", [
      { key: "name", label: "仓库名", default: target.name.toLowerCase().replace(/\s+/g, "-"), required: true },
      { key: "description", label: "描述（可选）" },
      {
        key: "visibility",
        label: "可见性",
        kind: "select",
        options: [{ value: "private", label: "私有" }, { value: "internal", label: "内部" }, { value: "public", label: "公开" }],
      },
    ]);
    if (!f?.name) return;
    setSharing("gitlab");
    try {
      const repo = await gitlabCreateProject({
        name: f.name,
        description: f.description || `${target.name} 的组织仓库`,
        visibility: (f.visibility as "private" | "internal" | "public") ?? "private",
      });
      linkOrgGitlab(target.id, repo);
      showToast(`仓库「${repo.name}」已创建并关联`);
    } catch (e) {
      showToast(`新建仓库失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSharing("");
    }
  };

  /* ── 项目 / 公告 ── */
  const editProject = async (target: Org, project?: OrgProject): Promise<void> => {
    const f = await openFormModal(project ? "编辑项目" : "新建项目", [
      { key: "name", label: "项目名称", required: true, default: project?.name },
      { key: "description", label: "项目说明", kind: "textarea", default: project?.description },
      { key: "owner", label: "负责人", default: project?.owner },
    ]);
    if (!f) return;
    saveOrgProject(target.id, { id: project?.id, name: f.name!, description: f.description ?? "", owner: f.owner ?? "", status: project?.status ?? "planned" });
  };

  const editNotice = async (target: Org, notice?: OrgAnnouncement): Promise<void> => {
    const f = await openFormModal(notice ? "编辑公告" : "发布公告", [
      { key: "title", label: "公告标题", required: true, default: notice?.title },
      { key: "body", label: "公告内容", kind: "textarea", required: true, default: notice?.body },
    ]);
    if (!f) return;
    saveOrgAnnouncement(target.id, { id: notice?.id, title: f.title!, body: f.body!, pinned: notice?.pinned ?? false });
  };

  if (!org) return <OrgPicker />;

  const owner = org.members.find((m) => m.role === "owner");
  const libraries = org.libraries ?? [];
  const gitlabRepos = org.gitlabRepos ?? [];
  const projects = org.projects ?? [];

  return (
    <div className="org-page">
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
                { k: "GitLab", v: gitlabRepos.length ? gitlabRepos.map((r) => r.path).join("、") : "还没有关联仓库" },
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
                  {org.invite.label ? `「${org.invite.label}」` : "邀请口令"}　接收人：{org.invite.allowEmail ?? "任何人"}
                </Text>
                <code className="vault-share-code">{org.invite.code}</code>
                <Inline gap={2} wrap>
                  <Btn size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(org.invite!.code).then(() => showToast("已复制")).catch(() => showToast("请手动复制"))}>复制口令</Btn>
                  <Btn size="sm" variant="ghost" onClick={() => setInvite(org.invite!)}>显示二维码</Btn>
                  <Btn size="sm" variant="ghost" onClick={() => void makeInvite(org)}>重新生成</Btn>
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
          </Inline>
          <Text slot="micro" tone="faint">资料库共享按成员的清华云盘邮箱发送；改邮箱后记得重新共享。</Text>
          <List divided>
            {org.members.map((m) => (
              <Row
                key={m.id}
                title={m.name}
                sub={m.email || "还没绑定邮箱 · 点「编辑」补上"}
                trailing={
                  <div className="name-card-actions">
                    <Select aria-label={`${m.name}的角色`} value={m.role} onChange={(v) => { if (!setOrgMemberRole(org.id, m.id, v as OrgRole)) showToast("至少保留一位组织负责人"); }}>
                      <option value="owner">{ROLE_LABEL.owner}</option>
                      <option value="member">{ROLE_LABEL.member}</option>
                      <option value="guest">{ROLE_LABEL.guest}</option>
                    </Select>
                    <Btn size="sm" variant="ghost" onClick={() => void editMember(org, m.id)}>编辑</Btn>
                    <Btn size="sm" variant="ghost" tone="error" onClick={() => void confirmOk(`移除成员「${m.name}」？`).then((ok) => { if (ok && !removeOrgMember(org.id, m.id)) showToast("至少保留一位组织负责人"); })}>移除</Btn>
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
                      已共享：{lib.sharedWith?.length ? lib.sharedWith.join("、") : "还没有共享给成员"}
                    </Text>
                    <div className="name-card-actions">
                      <Btn size="sm" variant="outline" onClick={() => openTab("cloud", { cloudRepo: lib.repoId })}>打开资料库</Btn>
                      <Btn size="sm" variant="outline" disabled={sharing === lib.repoId} onClick={() => void shareLibrary(org, lib.repoId, lib.name)}>共享给成员</Btn>
                      <Btn size="sm" variant="ghost" disabled={sharing === lib.repoId} onClick={() => void copyLibraryLink(lib.repoId, lib.name)}>复制分享链接</Btn>
                      <Btn size="sm" variant="ghost" tone="error" onClick={() => void confirmOk(`解除资料库「${lib.name}」与组织的关联？云盘里的资料库不会被删除。`).then((ok) => { if (ok) { removeOrgLibrary(org.id, lib.repoId); showToast("已解除关联"); } })}>解除关联</Btn>
                    </div>
                  </Stack>
                </Card>
              ))}
            </Stack>
          )}
        </Stack>
      ) : null}

      {tab === "gitlab" ? (
        <Stack gap={4}>
          <Inline gap={2} wrap>
            <Btn variant="solid" tone="brand" disabled={sharing === "gitlab"} onClick={() => void createGitlab(org)}>新建仓库</Btn>
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
                      <Btn size="sm" variant="ghost" tone="error" onClick={() => void confirmOk(`解除仓库「${repo.name}」与组织的关联？GitLab 上的仓库不会被删除。`).then((ok) => { if (ok) { unlinkOrgGitlab(org.id, repo.id); showToast("已解除关联"); } })}>解除关联</Btn>
                    </div>
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
                  <Select aria-label={`${p.name}的进度`} value={p.status} onChange={(v) => saveOrgProject(org.id, { ...p, status: v as OrgProject["status"] })}>
                    <option value="planned">计划中</option>
                    <option value="active">进行中</option>
                    <option value="done">已完成</option>
                  </Select>
                  <Btn size="sm" variant="ghost" onClick={() => void editProject(org, p)}>编辑</Btn>
                  <Btn size="sm" variant="ghost" tone="error" onClick={() => void confirmOk(`删除项目「${p.name}」？`).then((ok) => { if (ok) deleteOrgProject(org.id, p.id); })}>删除</Btn>
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
                  <Btn size="sm" variant="ghost" onClick={() => saveOrgAnnouncement(org.id, { ...n, pinned: !n.pinned })}>{n.pinned ? "取消置顶" : "置顶"}</Btn>
                  <Btn size="sm" variant="ghost" onClick={() => void editNotice(org, n)}>编辑</Btn>
                  <Btn size="sm" variant="ghost" tone="error" onClick={() => void confirmOk(`删除公告「${n.title}」？`).then((ok) => { if (ok) deleteOrgAnnouncement(org.id, n.id); })}>删除</Btn>
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
              {invite.label ? `「${invite.label}」　` : ""}接收人：{invite.allowEmail ?? "任何人（拿到口令就能接受）"}
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
