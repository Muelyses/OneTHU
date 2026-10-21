import { t as i18n, msg as i18nMsg, useLocale as useUiLocale } from "../i18n/index.js";
import { useCallback, type ReactNode } from "react";
/**
 * 通讯录「我的组织」页签：组织列表 + 新建/加入。
 *
 * 组织本身是完整页面（page=org，pages/Organization.tsx）：成员 / 资料库 / GitLab / 项目 / 公告。
 * 这里只做列表与入口，不再有管理弹层（2026-10-19 用户拍板「组织不能只是一张卡片」）。
 */
import { Btn, Card, List, Row, Text } from "@onethu/gui";
import { defineSearchRows } from "../state/searchRows.js";
import { openFormModal } from "../lib/formModal.js";
import { showToast } from "../state/toast.js";
import { openTab } from "../state/explorer.js";
import {
  acceptOrgInvite, createOrg, currentOrgEmail, deleteOrg, useOrgs,
} from "../state/org.js";
import { confirmOk } from "../lib/confirm.js";

defineSearchRows([
  {
    id: "set-orgs", tab: "账号", section: "我的组织", get title() { return i18n("components.organizationsection.51cc2efa3e8d"); },
    aliases: ["组织", "建组织", "成员", "邀请"], get desc() { return i18n("components.organizationsection.9f2eb342aba2"); },
    breadcrumb: ["设置", "账号", "我的组织", "我的组织"],
    go: () => openTab("contacts", { section: "orgs" }),
  },
  {
    id: "set-org-invite", tab: "账号", section: "我的组织", get title() { return i18n("components.organizationsection.10f106e00d20"); },
    aliases: ["邀请口令", "加入组织", "组织名片"], get desc() { return i18n("components.organizationsection.6d690d15464a"); },
    breadcrumb: ["设置", "账号", "我的组织", "组织邀请口令"],
    go: () => openTab("contacts", { section: "orgs" }),
  },
]);

export function OrganizationSection(): ReactNode {
  const uiLocale = useUiLocale();

  const doc = useOrgs();

  const create = useCallback(async (): Promise<void> => {
    const email = await currentOrgEmail();
    const f = await openFormModal(i18nMsg("components.organizationsection.d045f8d60a45"), [
      { key: "name", label: i18nMsg("components.organizationsection.3f38e493103b"), required: true },
      { key: "brief", label: i18nMsg("components.organizationsection.d2e163c18cd9"), kind: "textarea" },
      { key: "joinUrl", label: i18nMsg("components.organizationsection.aa2ed8e463b7") },
    ]);
    if (!f?.name) return;
    const org = createOrg({ name: f.name, brief: f.brief, joinUrl: f.joinUrl, ownerEmail: email });
    openTab("org", { orgId: org.id }, { title: org.name });
    showToast(i18nMsg("components.organizationsection.d1403c75a692", { name: String(org.name) }));
  }, []);

  const join = useCallback(async (): Promise<void> => {
    const f = await openFormModal(i18nMsg("components.organizationsection.f6e4b6f78585"), [
      { key: "code", label: i18nMsg("components.organizationsection.276c9bcadb27"), kind: "textarea", required: true },
      { key: "name", label: i18nMsg("components.organizationsection.786e9c3ff0d0"), default: "我" },
    ]);
    if (!f?.code) return;
    const r = await acceptOrgInvite(f.code, f.name || "我");
    if (!r.ok) {
      showToast(r.reason ?? i18n("components.organizationsection.c697a5163f2d"));
      return;
    }
    showToast(i18nMsg("components.organizationsection.096678f835a7"));
    if (r.orgId) openTab("org", { orgId: r.orgId }, { title: i18n("components.organizationsection.b4d203dea5b9") });
  }, []);

  return (
    <Card>
      <div className="name-card">
        <div className="name-card-actions">
          <Btn variant="solid" tone="brand" size="sm" onClick={() => void create()}>{i18n("components.organizationsection.d045f8d60a45")}</Btn>
          <Btn variant="ghost" size="sm" onClick={() => void join()}>{i18n("components.organizationsection.1a428fa57dd7")}</Btn>
        </div>
        {doc.orgs.length === 0 ? (
          <Text slot="micro" tone="faint">{i18n("components.organizationsection.1d3b05b3fd2d")}</Text>
        ) : (
          <List divided>
            {doc.orgs.map((o) => (
              <Row
                key={o.id}
                flush
                title={o.name}
                onClick={() => openTab("org", { orgId: o.id }, { title: o.name })}
                sub={i18n("components.organizationsection.9fb58025ea25", { length: String(o.members.length), length2: String((o.libraries ?? []).length), length3: String((o.gitlabRepos ?? []).length), value: String(o.joinUrl ? i18n("components.organizationsection.82cae3dbbbd0") : "") })}
                trailing={
                  <span className="name-card-actions">
                    <Btn variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); openTab("org", { orgId: o.id }, { title: o.name }); }}>{i18n("components.organizationsection.4dd6695c0a10")}</Btn>
                    <Btn variant="ghost" size="sm" tone="error" onClick={(e) => { e.stopPropagation(); void confirmOk(i18nMsg("components.organizationsection.40c6a5e5d509", { name: String(o.name) })).then((ok) => { if (ok) deleteOrg(o.id); }); }}>{i18n("components.organizationsection.2f9daa828907")}</Btn>
                  </span>
                }
              />
            ))}
          </List>
        )}
      </div>
    </Card>
  );
}
