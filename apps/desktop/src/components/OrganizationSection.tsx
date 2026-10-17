/**
 * 设置页「我的组织」：建组织、成员、邀请口令、加入邀请。
 * 资源空间（GitLab/云盘）字段已留在 Org 上，orgCloud 接入后由这里展示入口。
 */
import { useCallback, useState, type ReactNode } from "react";
import { Btn, Card, List, Row, Text } from "@onethu/gui";
import { defineSearchRows } from "../state/searchRows.js";
import { openFormModal } from "../lib/formModal.js";
import { confirmOk } from "../lib/confirm.js";
import { showToast } from "../state/toast.js";
import {
  acceptOrgInvite, addOrgMember, createOrg, deleteOrg, orgInviteCode, setOrgShare, useOrgs,
} from "../state/org.js";
import { prepareAndShareFolder } from "../lib/cloudFolder.js";

defineSearchRows([
  {
    id: "set-orgs", tab: "账号", section: "我的组织", title: "我的组织",
    aliases: ["组织", "建组织", "成员", "邀请"], desc: "建立组织、邀请成员、共享资料空间",
    breadcrumb: ["设置", "账号", "我的组织", "我的组织"],
  },
  {
    id: "set-org-invite", tab: "账号", section: "我的组织", title: "组织邀请口令",
    aliases: ["邀请口令", "加入组织", "组织名片"], desc: "生成/接受组织邀请口令",
    breadcrumb: ["设置", "账号", "我的组织", "组织邀请口令"],
  },
]);

export function OrganizationSection(): ReactNode {
  const doc = useOrgs();
  const [invite, setInvite] = useState<{ org: string; code: string } | null>(null);
  const [sharing, setSharing] = useState<string | null>(null);

  const create = useCallback(async (): Promise<void> => {
    const f = await openFormModal("新建组织", [
      { key: "name", label: "组织名称", required: true },
      { key: "brief", label: "一句话简介（可选）", kind: "textarea" },
      { key: "joinUrl", label: "加入方式（GitLab 组织 / 云盘共享文件夹链接，可选）" },
    ]);
    if (!f?.name) return;
    const org = createOrg({ name: f.name, brief: f.brief, joinUrl: f.joinUrl });
    showToast(`已创建「${org.name}」`);
  }, []);

  const inviteOrg = useCallback((id: string, name: string): void => {
    const org = doc.orgs.find((o) => o.id === id);
    if (!org) return;
    const code = orgInviteCode(org);
    setInvite({ org: name, code });
    void navigator.clipboard.writeText(code).then(() => showToast("组织邀请口令已复制")).catch(() => showToast("邀请口令已生成：复制下方文本"));
  }, [doc.orgs]);

  const join = useCallback(async (): Promise<void> => {
    const f = await openFormModal("加入组织", [
      { key: "code", label: "组织邀请口令（ONORG1.…）", kind: "textarea", required: true },
      { key: "name", label: "你在这个组织里的名字", default: "我" },
    ]);
    if (!f?.code) return;
    const r = acceptOrgInvite(f.code, f.name || "我");
    showToast(r.ok ? "已加入组织（本地成员清单）" : r.reason ?? "邀请口令无法识别");
  }, []);

  const shareSpace = useCallback(async (id: string, name: string): Promise<void> => {
    setSharing(id);
    try {
      const share = await prepareAndShareFolder(`/Orgs/${id}`, `${name} 的组织共享空间`);
      setOrgShare(id, { repoId: share.repoId, path: share.path, shareUrl: share.shareUrl, shareToken: share.shareToken, expiresAt: share.expiresAt, createdAt: Date.now() });
      await navigator.clipboard.writeText(share.shareUrl).catch(() => undefined);
      showToast("组织共享空间已创建：链接已复制，发给成员即可加入");
    } catch (e) {
      showToast(`组织共享空间创建失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSharing(null);
    }
  }, []);

  const addMember = useCallback(async (id: string): Promise<void> => {
    const f = await openFormModal("添加成员", [{ key: "name", label: "成员名字", required: true }]);
    if (!f?.name) return;
    const r = addOrgMember(id, f.name);
    showToast(r.ok ? "成员已加入" : r.reason === "duplicate" ? "这个成员已经在组织里了" : "组织不存在");
  }, []);

  return (
    <Card>
      <div className="name-card">
        <div className="name-card-actions">
          <Btn variant="solid" tone="brand" size="sm" onClick={() => void create()}>新建组织</Btn>
          <Btn variant="ghost" size="sm" onClick={() => void join()}>用邀请口令加入</Btn>
        </div>
        {doc.orgs.length === 0 ? (
          <Text slot="micro" tone="faint">还没有组织。建一个组织，把成员、资料空间和邀请口令放在一起。</Text>
        ) : (
          <List divided>
            {doc.orgs.map((o) => (
              <Row
                key={o.id}
                flush
                title={o.name}
                sub={`${o.members.length} 名成员${o.brief ? " · " + o.brief : ""}${o.joinUrl ? " · 已设加入方式" : ""}`}
                trailing={
                  <span className="name-card-actions">
                    {o.shared?.shareUrl ? (
                      <Btn variant="ghost" size="sm" onClick={() => void navigator.clipboard.writeText(o.shared!.shareUrl).then(() => showToast("共享空间链接已复制")).catch(() => showToast("复制失败，请手动复制"))}>复制空间链接</Btn>
                    ) : (
                      <Btn variant="ghost" size="sm" disabled={sharing === o.id} onClick={() => void shareSpace(o.id, o.name)}>{sharing === o.id ? "创建中…" : "共享空间"}</Btn>
                    )}
                    <Btn variant="ghost" size="sm" onClick={() => inviteOrg(o.id, o.name)}>邀请</Btn>
                    <Btn variant="ghost" size="sm" onClick={() => void addMember(o.id)}>加成员</Btn>
                    <Btn variant="ghost" size="sm" tone="error" onClick={() => void confirmOk(`删除组织「${o.name}」？成员清单会一起删除（云盘资料不动）。`).then((ok) => { if (ok) deleteOrg(o.id); })}>删除</Btn>
                  </span>
                }
              />
            ))}
          </List>
        )}
        {invite ? (
          <div className="vault-share">
            <Text slot="micro" tone="faint">「{invite.org}」的邀请口令（对方在 设置→账号→我的组织 里接受）：</Text>
            <code className="vault-share-code">{invite.code}</code>
            <div className="name-card-actions">
              <Btn variant="ghost" size="sm" onClick={() => void navigator.clipboard.writeText(invite.code).catch(() => undefined)}>复制</Btn>
              <Btn variant="ghost" size="sm" onClick={() => setInvite(null)}>收起</Btn>
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
