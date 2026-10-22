import { Btn, Text } from "@onethu/gui";
import { t, useLocale } from "../i18n/index.js";
import { useExperienceMode, type ExperienceMode } from "../state/experienceMode.js";
import { setMobileNavigation, useMobileNavigation, type MobileNavigationLayout } from "../state/mobileLayout.js";

/** Same choices and preference source in onboarding and appearance settings. */
export function MobileLayoutChoice({ mode }: { mode?: ExperienceMode }) {
  useLocale();
  const activeMode = useExperienceMode(), chosen = mode ?? activeMode;
  const value = useMobileNavigation(chosen);
  return <section className="mobile-layout-choice" aria-label={t("mobile.layout.title")}>
    <h2>{t("mobile.layout.title")}</h2>
    <Text tone="quiet">{t("mobile.layout.hint")}</Text>
    <div className="mobile-layout-options">
      {(["bottom", "side"] as MobileNavigationLayout[]).map(layout => <Btn key={layout} variant="outline" className={"mobile-layout-option" + (value === layout ? " is-active" : "")} aria-pressed={value === layout} onClick={() => setMobileNavigation(chosen, layout)}>
        <span className={"mobile-layout-preview is-" + layout} aria-hidden="true"><span className="mobile-layout-preview-head"/><span className="mobile-layout-preview-content"><i/><i/><i/></span><span className="mobile-layout-preview-nav">{[0,1,2,3,4].map(n=><i key={n}/>)}</span><span className="mobile-layout-preview-oh"/></span>
        <strong>{(layout === "bottom" ? t("mobile.layout.bottom") : t("mobile.layout.side"))}</strong>
        <span>{(layout === "bottom" ? t("mobile.layout.bottomHint") : t("mobile.layout.sideHint"))}</span>
      </Btn>)}
    </div>
    <Text slot="micro" tone="faint">{t("mobile.layout.later")}</Text>
  </section>;
}
