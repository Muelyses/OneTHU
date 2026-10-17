/**
 * 设置页「我的 OneTHU 名片」：个人名片编辑、组织名片、通讯录。
 * 数据在 state/nameCard.ts；进暂存箱/分享口令/以后 NFC 碰一碰都复用同一 payload。
 */
import { useCallback, useState, type ReactNode } from "react";
import { Btn, Card, List, Row, Text } from "@onethu/gui";
import { defineSearchRows } from "../state/searchRows.js";
import { openFormModal } from "../lib/formModal.js";
import { confirmOk } from "../lib/confirm.js";
import { showToast } from "../state/toast.js";
import { pickFile, fileToBytes } from "../lib/attach.js";
import { bytesToBase64 } from "../lib/imageSave.js";
import { addToVault, vaultSnapshot } from "../state/vault.js";
import {
  CARD_LIMITS, addContact, orgCardCatch, personalCardCatch, removeContact, removeOrgCard,
  savePersonalCard, setContactShare, upsertOrgCard, useCards,
} from "../state/nameCard.js";
import { prepareAndShareFolder } from "../lib/cloudFolder.js";
import { openBidirectionalShare, sendFriendFile, sendFriendText, useFriendMessages } from "../state/friendChannel.js";
import { stageFromPicker } from "../lib/fileChannel.js";

defineSearchRows([
  {
    id: "set-namecard", tab: "账号", section: "我的 OneTHU 名片", title: "我的 OneTHU 名片",
    aliases: ["名片", "头像", "个人简介", "社交媒体", "个人网址"], desc: "头像、网址、社交、手机号、简介",
    breadcrumb: ["设置", "账号", "我的 OneTHU 名片", "我的 OneTHU 名片"],
  },
  {
    id: "set-contacts", tab: "账号", section: "我的 OneTHU 名片", title: "通讯录",
    aliases: ["联系人", "好友", "组织名片"], desc: "收到的个人/组织名片",
    breadcrumb: ["设置", "账号", "我的 OneTHU 名片", "通讯录"],
  },
]);

export function NameCardSection(): ReactNode {
  const doc = useCards();
  const p = doc.personal;
  const [busy, setBusy] = useState(false);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [channelId, setChannelId] = useState<string | null>(null);

  const edit = useCallback(async (): Promise<void> => {
    const f = await openFormModal("编辑我的名片", [
      { key: "name", label: "名字", required: true, default: p.name },
      { key: "website", label: "个人网址", default: p.website },
      { key: "social", label: "社交媒体", default: p.social },
      { key: "phone", label: "手机号", default: p.phone },
      { key: "cloudEmail", label: "清华云盘邮箱（好友双向共享用，可空）", default: p.cloudEmail ?? "" },
      { key: "bio", label: "个人简介（≤120 字，碰一碰要短）", kind: "textarea", default: p.bio },
    ]);
    if (f) savePersonalCard(f);
  }, [p]);

  const pickAvatar = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      const f = await pickFile();
      if (!f) return;
      if (!f.mime.startsWith("image/")) throw new Error("只支持图片");
      if (f.size > 200 * 1024) throw new Error("头像请控制在 200KB 以内");
      const bytes = await fileToBytes(f, 200 * 1024);
      savePersonalCard({ avatar: `data:${f.mime};base64,${bytesToBase64(bytes)}` });
      showToast("头像已更新");
    } catch (e) {
      showToast(`头像设置失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  const toVault = useCallback((): void => {
    const r = addToVault(personalCardCatch());
    if (r.ok) showToast("名片已放进暂存箱");
    else showToast(r.reason === "duplicate" ? "暂存箱里已经有这张名片了" : "暂存箱暂时不可用");
  }, []);

  const addOrg = useCallback(async (): Promise<void> => {
    const f = await openFormModal("新建组织名片", [
      { key: "name", label: "组织名称", required: true },
      { key: "brief", label: `一句话简介（≤${CARD_LIMITS.orgBrief} 字）`, kind: "textarea" },
      { key: "joinUrl", label: "加入方式 / 邀请链接" },
    ]);
    if (f?.name) { upsertOrgCard({ name: f.name, brief: f.brief, joinUrl: f.joinUrl }); showToast("组织名片已保存"); }
  }, []);

  const shareCloud = useCallback(async (contactId: string, name: string): Promise<void> => {
    setSharingId(contactId);
    try {
      const share = await prepareAndShareFolder(`/Friends/${contactId}`, `${name} 与我的共享云盘`);
      setContactShare(contactId, { repoId: share.repoId, path: share.path, shareUrl: share.shareUrl, shareToken: share.shareToken, expiresAt: share.expiresAt, createdAt: Date.now() });
      await navigator.clipboard.writeText(share.shareUrl).catch(() => undefined);
      const twoWay = await openBidirectionalShare(contactId);
      showToast(twoWay.ok ? "共享云盘已创建，并已开通好友双向写入" : "共享云盘已创建：链接已复制；对方填云盘邮箱后可开通双向");
    } catch (e) {
      showToast(`共享云盘创建失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSharingId(null);
    }
  }, []);

  const channelMessages = useFriendMessages(channelId ?? "");

  const sendMessage = useCallback(async (): Promise<void> => {
    if (!channelId) return;
    const f = await openFormModal("给好友留言", [{ key: "text", label: "留言（同步写进共享云盘）", kind: "textarea", required: true }]);
    if (!f?.text) return;
    const r = await sendFriendText(channelId, f.text);
    showToast(r.ok ? "留言已写入共享云盘" : `留言只留在本机：${r.reason}`);
  }, [channelId]);

  const sendFile = useCallback(async (): Promise<void> => {
    if (!channelId) return;
    try {
      const staged = await stageFromPicker(true);
      let ok = 0;
      for (const f of staged) {
        const r = await sendFriendFile(channelId, { name: f.name, localPath: f.localPath, size: f.size });
        if (r.ok) ok++;
        else showToast(`「${f.name}」上传失败：${r.reason}`);
      }
      if (ok) showToast(`已把 ${ok} 个文件放进共享云盘`);
    } catch (e) {
      showToast(`文件选择失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }, [channelId]);

  const importContacts = useCallback((): void => {
    let ok = 0;
    let dup = 0;
    for (const box of vaultSnapshot().boxes) {
      for (const it of box.items) {
        const payload = it.payload as { kind?: string; card?: Record<string, unknown>; org?: boolean } | undefined;
        if (payload?.kind !== "namecard" || !payload.card) continue;
        const r = addContact(payload.org ? "organization" : "personal", payload.card as never, it.sub ?? "");
        if (r.ok) ok++;
        else if (r.reason === "duplicate") dup++;
      }
    }
    if (ok) showToast(`已加入通讯录：${ok} 张`);
    else showToast(dup ? "这些名片已经在通讯录里了" : "暂存箱里还没有名片：先把名片放进暂存箱");
  }, []);

  const orgs = doc.orgs;
  const contacts = doc.contacts;

  return (
    <Card>
      <div className="name-card">
        <div className="name-card-head">
          {p.avatar ? (
            <img className="name-card-avatar" src={p.avatar} alt="我的头像" />
          ) : (
            <span className="name-card-avatar name-card-avatar-empty" aria-hidden="true">{(p.name || "我").slice(0, 1)}</span>
          )}
          <div className="name-card-id">
            <Text slot="label">{p.name || "还没设置名字"}</Text>
            <Text slot="micro" tone="faint">{p.bio || "个人简介会出现在名片和碰一碰里"}</Text>
            {p.website || p.social || p.phone ? (
              <Text slot="micro" tone="faint">{[p.website, p.social, p.phone, p.cloudEmail].filter(Boolean).join(" · ")}</Text>
            ) : null}
          </div>
        </div>
        <div className="name-card-actions">
          <Btn variant="solid" tone="brand" size="sm" onClick={() => void edit()}>编辑资料</Btn>
          <Btn variant="ghost" size="sm" onClick={() => void pickAvatar()} disabled={busy}>换头像</Btn>
          <Btn variant="ghost" size="sm" onClick={toVault}>放进暂存箱</Btn>
          <Btn variant="ghost" size="sm" onClick={() => void addOrg()}>新建组织名片</Btn>
          <Btn variant="ghost" size="sm" onClick={importContacts}>从暂存箱收名片</Btn>
        </div>
      </div>

      {orgs.length > 0 ? (
        <List divided>
          {orgs.map((o) => (
            <Row
              key={o.id}
              flush
              title={o.name}
              sub={o.brief || o.joinUrl || "组织名片"}
              trailing={
                <span className="name-card-actions">
                  <Btn variant="ghost" size="sm" onClick={() => {
                    const r = addToVault(orgCardCatch(o));
                    showToast(r.ok ? "组织名片已放进暂存箱" : r.reason === "duplicate" ? "暂存箱里已有了" : "暂存箱暂时不可用");
                  }}>放进暂存箱</Btn>
                  <Btn variant="ghost" size="sm" tone="error" onClick={() => void confirmOk(`删除组织名片「${o.name}」？`).then((ok) => { if (ok) removeOrgCard(o.id); })}>删除</Btn>
                </span>
              }
            />
          ))}
        </List>
      ) : null}

      <div className="name-card-contacts">
        <Text slot="label">通讯录{contacts.length ? `（${contacts.length}）` : ""}</Text>
        {contacts.length === 0 ? (
          <Text slot="micro" tone="faint">还没有联系人。收下别人的名片（暂存箱/口令/碰一碰）后会出现在这里。</Text>
        ) : (
          <List divided>
            {contacts.map((c) => (
              <Row
                key={c.id}
                flush
                title={c.name}
                sub={(c.kind === "organization" ? "组织" : "个人") + (c.note ? " · " + c.note : "") + (c.shared?.shareUrl ? " · 已建共享云盘" : "")}
                trailing={
                  <span className="name-card-actions">
                    {c.shared?.shareUrl ? (
                      <Btn variant="ghost" size="sm" onClick={() => void navigator.clipboard.writeText(c.shared!.shareUrl!).then(() => showToast("共享链接已复制")).catch(() => showToast("复制失败，请手动复制"))}>复制链接</Btn>
                    ) : (
                      <Btn variant="ghost" size="sm" disabled={sharingId === c.id} onClick={() => void shareCloud(c.id, c.name)}>{sharingId === c.id ? "创建中…" : "共享云盘"}</Btn>
                    )}
                    {c.shared && !c.shared.sharedWith && (c.card as { cloudEmail?: string }).cloudEmail ? (
                      <Btn variant="ghost" size="sm" onClick={() => void openBidirectionalShare(c.id).then((r) => showToast(r.ok ? "已开通双向写入" : `开通失败：${r.reason}`))}>开通双向</Btn>
                    ) : null}
                    <Btn variant="ghost" size="sm" onClick={() => setChannelId(channelId === c.id ? null : c.id)}>通道</Btn>
                    <Btn variant="ghost" size="sm" tone="error" onClick={() => removeContact(c.id)}>删除</Btn>
                  </span>
                }
              />
            ))}
          </List>
        )}
        {channelId ? (
          <div className="vault-share">
            <Text slot="label">好友通道</Text>
            {channelMessages.length === 0 ? (
              <Text slot="micro" tone="faint">还没有留言。留言/文件会写进你们的共享云盘；对方通过共享链接查看。</Text>
            ) : (
              <List divided>
                {channelMessages.map((m) => (
                  <Row key={m.id} flush title={m.kind === "file" ? "文件：" + m.text : m.text} sub={m.cloudPath ? "已写入共享云盘" : "仅本机"} />
                ))}
              </List>
            )}
            <div className="name-card-actions">
              <Btn variant="solid" tone="brand" size="sm" onClick={() => void sendMessage()}>留言</Btn>
              <Btn variant="ghost" size="sm" onClick={() => void sendFile()}>传文件</Btn>
              <Btn variant="ghost" size="sm" onClick={() => setChannelId(null)}>关闭通道</Btn>
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
