import { useLocale as useUiLocale } from "../i18n/index.js";
import { Select, SettingsList, SettingsRow } from "@onethu/gui";
import { availableLocales, setLocale, t, useLocale } from "../i18n/index.js";

/** UI preference only: navigation, account state and existing drafts are retained. */
export function LanguageControl() {
  const uiLocale = useUiLocale();

  const locale = useLocale();
  return <div data-language-control>
    <SettingsList><SettingsRow title={t("settings.language.title")} sub={t("settings.language.description")}
      control={<Select aria-label={t("settings.language.title")} value={locale}
        options={availableLocales().map(({ code, label }) => ({ value: code, label }))}
        onChange={setLocale} />} />
    </SettingsList>
  </div>;
}
