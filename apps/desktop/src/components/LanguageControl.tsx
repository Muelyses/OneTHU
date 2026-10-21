import { useLocale as useUiLocale } from "../i18n/index.js";
import { Select, SettingsList, SettingsRow } from "@onethu/gui";
import { availableLocales, localeTable, setLocale, t, useLocale } from "../i18n/index.js";

/** UI preference only: navigation, account state and existing drafts are retained. */
export function LanguageControl({ compact = false }: { compact?: boolean }) {
  const uiLocale = useUiLocale();

  const locale = useLocale();
  const label = compact
    ? `${localeTable("zh-CN")["settings.language.title"]} / ${localeTable("en-US")["settings.language.title"]}`
    : t("settings.language.title");
  const select = <Select aria-label={label} value={locale}
    options={availableLocales().map(({ code, label }) => ({ value: code, label }))}
    onChange={setLocale} />;
  if (compact) return <div data-language-control className="login-language">
    <span>{label}</span>{select}
  </div>;
  return <div data-language-control>
    <SettingsList><SettingsRow title={t("settings.language.title")} sub={t("settings.language.description")}
      control={select} />
    </SettingsList>
  </div>;
}
