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
  savePersonalCard, upsertOrgCard, useCards,
} from "../state/nameCard.js";

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

  const edit = useCallback(async (): Promise<void> => {
    const f = await openFormModal("编辑我的名片", [
      { key: "name", label: "名字", required: true, default: p.name },
      { key: "website", label: "个人网址", default: p.website },
      { key: "social", label: "社交媒体", default: p.social },
      { key: "phone", label: "手机号", default: p.phone },
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
              <Text slot="micro" tone="faint">{[p.website, p.social, p.phone].filter(Boolean).join(" · ")}</Text>
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
                sub={(c.kind === "organization" ? "组织" : "个人") + (c.note ? " · " + c.note : "")}
                trailing={<Btn variant="ghost" size="sm" tone="error" onClick={() => removeContact(c.id)}>删除</Btn>}
              />
            ))}
          </List>
        )}
      </div>
    </Card>
  );
}
