/**
 * 拟物名片卡：真实银行卡比例（1.586 : 1）的纸卡。
 *
 * 只表达"一张卡"本身，不含按钮与数据读写：
 * - 纸面：纸纹 + 顶部受光 + 压印高光，全部由 --og-surface-* / --og-content-* 令牌派生；
 * - 结构：品牌行 · 芯片 · 人像行（头像 / 名字 / 简介）· 联系行 · 钢印；
 * - deck（卡片夹里的实物）/ hero（我的名片）/ detail（弹出的大卡）三档由 class 决定，
 *   比例、层叠阴影与深浅主题对比都写在 recipes/contacts.css。
 */
import type { ReactNode } from "react";
import type { OrgCard, PersonalCard } from "../state/nameCard.js";

export type IdentityCardVariant = "deck" | "hero" | "detail";

export function IdentityCard({
  card,
  organization = false,
  variant = "deck",
}: {
  card: PersonalCard | OrgCard;
  /** 组织名片：换纸料与标签，简介/加入方式取组织字段 */
  organization?: boolean;
  variant?: IdentityCardVariant;
}): ReactNode {
  const person = card as PersonalCard;
  const org = card as OrgCard;
  const name = (card.name || "").trim() || (organization ? "未命名组织" : "我的名片");
  const headline = organization ? org.brief || "组织邀请" : person.bio || "在清华，与你相遇。";
  const details = (organization ? [org.joinUrl] : [person.website, person.social, person.phone])
    .filter((s): s is string => Boolean(s && s.trim()));
  return (
    <article className={`identity-card identity-card--${variant}${organization ? " is-organization" : ""}`}>
      <span className="identity-card-stock" aria-hidden="true" />
      <span className="identity-card-watermark" aria-hidden="true">
        {Array.from(name)[0]}
      </span>
      <div className="identity-card-top">
        <span className="identity-card-brand">OneTHU</span>
        <span className="identity-card-kind">{organization ? "ORGANIZATION" : "PERSONAL CARD"}</span>
      </div>
      <div className="identity-card-middle">
        <span className="identity-card-chip" aria-hidden="true" />
        <div className="identity-card-person">
          {person.avatar ? (
            <img className="identity-card-avatar" src={person.avatar} alt="" />
          ) : (
            <span className="identity-monogram" aria-hidden="true">
              {Array.from(name)[0]}
            </span>
          )}
          <span className="identity-card-id">
            <span className="identity-card-name">{name}</span>
            <span className="identity-card-line">{headline}</span>
          </span>
        </div>
      </div>
      <div className="identity-card-bottom">
        <span className="identity-card-details">
          {details.length ? details.join(" · ") : "点击编辑，写下你的介绍"}
        </span>
        <span className="identity-seal" aria-hidden="true">
          THU
        </span>
      </div>
    </article>
  );
}