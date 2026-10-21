import { t as i18n, useLocale as useUiLocale } from "../i18n/index.js";
import { useApp } from "../state/context.js";
/**
 * 通讯录：一级功能区页面（名片夹 + 我的组织）。
 *
 * 入口：一级功能区 / 全局搜索 / 收藏（page=contacts，NAV_REGISTRY 已登记）。
 * 结构：完整页头（标题 / 说明 / 收藏星标）→ 段切换 → 名片夹或组织。
 * 名片夹本体在 components/NameCardSection.tsx（拟物纸卡 + 堆叠 + Modal 大卡）；
 * 组织页签 = 组织名片 + 组织成员/邀请口令（OrganizationSection，与设置页共用同一份实现）。
 */
import { useState } from "react";
import { Btn, Inline, Segment, Stack, Text } from "@onethu/gui";
import { PageHead } from "../components/Layout.js";
import { PageAtomStar } from "../components/Collect.js";
import { NameCardSection, OrgCardsSection } from "../components/NameCardSection.js";
import { OrganizationSection } from "../components/OrganizationSection.js";
import { ProfileSyncStatus } from "../components/ProfileSyncStatus.js";

type ContactsTab = "cards" | "orgs";

export function ContactsPage() {
  const uiLocale = useUiLocale();

  const { navParams } = useApp();
  const [tab, setTab] = useState<ContactsTab>((navParams as {section?:string}|null)?.section==="orgs"?"orgs":"cards");
  return (
    <div className="contacts-page">
      <PageHead
        title={i18n("pages.contacts.06657c279571")}
        meta={i18n("pages.contacts.b62dac5fc7e9")}
        actions={<PageAtomStar atomKey="contacts" title={i18n("pages.contacts.06657c279571")} />}
      />
      <ProfileSyncStatus />
      <div className="contacts-tabs">
        <Segment
          value={tab}
          onChange={(v) => setTab(v as ContactsTab)}
          options={[
            { value: "cards", label: i18n("pages.contacts.1ad56c152731") },
            { value: "orgs", label: i18n("pages.contacts.51cc2efa3e8d") },
          ]}
        />
      </div>
      {tab === "cards" ? (
        <NameCardSection view="contacts" />
      ) : (
        <Stack gap={6}>

          <div className="contacts-orgs">
            <Text slot="label" tone="faint">{i18n("pages.contacts.d3548ea24212")}</Text>
            <OrganizationSection />
          </div>
          <Inline gap={2} wrap>
            <Btn variant="ghost" onClick={() => setTab("cards")}>{i18n("pages.contacts.ea0abe91fe00")}</Btn>
          </Inline>
        </Stack>
      )}
    </div>
  );
}
