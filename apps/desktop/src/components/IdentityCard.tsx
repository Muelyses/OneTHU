import { t as i18n, useLocale as useUiLocale } from "../i18n/index.js";
/**
 * 拟物名片卡：真实银行卡比例（1.586 : 1）的纸卡。
 *
 * 只表达"一张卡"本身，不含按钮与数据读写：
 * - 纸面：纸纹 + 顶部受光 + 压印高光，全部由 --og-surface-* / --og-content-* 令牌派生；
 * - 结构：品牌行 · 芯片 · 人像行（头像 / 名字 / 简介）· 联系行 · 钢印；
 * - deck（卡片夹里的实物）/ hero（我的名片）/ detail（弹出的大卡）三档由 class 决定，
 *   比例、层叠阴影与深浅主题对比都写在 recipes/contacts.css。
 */
import { FocalImage } from "@onethu/gui";
import type { ReactNode } from "react";
import type { OrgCard, PersonalCard } from "../state/nameCard.js";
import { BrandLogo } from "./BrandLogo.js";

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
  const uiLocale = useUiLocale();

  const person = card as PersonalCard;
  const org = card as OrgCard;
  const name = (card.name || "").trim() || (organization ? i18n("components.identitycard.d203a5652f03") : i18n("components.identitycard.487e926379fe"));
  const cover = organization ? undefined : person.cover;
  const headline = organization ? org.brief || i18n("components.identitycard.b8fde21bc2ca") : person.bio || i18n("components.identitycard.f83c8237fcf6");
  const details = (organization ? [org.joinUrl] : [person.website, person.social, person.phone])
    .filter((s): s is string => Boolean(s && s.trim()));
  return (
    <article
      className={`identity-card identity-card--${variant}${organization ? " is-organization" : ""}${cover ? ` has-cover is-cover-${cover.ink}` : ""}`}
      /* 有自定义卡面时字色由卡面自己算（黑/白 + 蒙层），不让全局「按页面底色自动字色」再插一脚。 */
      {...(cover ? { "data-tx": "keep" } : {})}
    >
      {cover ? (
        <span className="identity-card-cover" aria-hidden="true">
          <FocalImage src={cover.src} focusX={cover.focusX} focusY={cover.focusY} zoom={cover.zoom} />
        </span>
      ) : null}
      <span className="identity-card-stock" aria-hidden="true" />
      <span className="identity-card-watermark" aria-hidden="true">
        {Array.from(name)[0]}
      </span>
      <div className="identity-card-top">
        {/* 品牌只留这一处：标准 (One / THU) logo，底部钢印那枚 THU 已去掉 */}
        <span className="identity-card-brand"><BrandLogo size={variant === "deck" ? 10 : 13} /></span>
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
          {details.length ? details.join(" · ") : i18n("components.identitycard.3fa24b555e9d")}
        </span>
      </div>
    </article>
  );
}