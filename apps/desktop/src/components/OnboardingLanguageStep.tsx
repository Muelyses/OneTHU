import { Radio } from "@onethu/gui";
import {
  availableLocales, localeTable, msg, setLocale, useLocale,
  type MessageDescriptor,
} from "../i18n/index.js";

const COPY = {
  title: msg("components.onboardinglanguage.title"),
  lead: msg("components.onboardinglanguage.lead"),
  hint: msg("components.onboardinglanguage.hint"),
  label: msg("components.onboardinglanguage.label"),
  step: msg("components.onboardinglanguage.step"),
  continue: msg("components.onboardinglanguage.continue"),
};

// This first question must stay readable before a language has been chosen.
// Reading both built-in tables does not change the user's current locale.
function bilingualParts(message: MessageDescriptor): [string, string] {
  return [localeTable("zh-CN")[message.key]!, localeTable("en-US")[message.key]!];
}
export function onboardingLanguagePrompt(part: keyof typeof COPY): string {
  return bilingualParts(COPY[part]).join(" / ");
}
function Bilingual({ message }: { message: MessageDescriptor }) {
  const [zh, en] = bilingualParts(message);
  return <><span lang="zh-CN">{zh}</span><span lang="en-US">{en}</span></>;
}

export function OnboardingLanguageStep() {
  const locale = useLocale();
  const names = new Intl.DisplayNames([locale], { type: "language" });
  return <section className="tour-language" aria-labelledby="tour-language-title">
    <div className="tour-copy-heading tour-language-heading">
      <h2 id="tour-language-title"><Bilingual message={COPY.title} /></h2>
      <p className="tour-language-lead"><Bilingual message={COPY.lead} /></p>
      <p className="tour-language-short"><Bilingual message={COPY.hint} /></p>
    </div>
    <fieldset className="tour-language-options">
      <legend>{onboardingLanguagePrompt("label")}</legend>
      <div className="tour-language-grid">
        {availableLocales().map(option => <Radio
          key={option.code}
          name="onboarding-language"
          value={option.code}
          checked={locale === option.code}
          onChange={setLocale}
          className={"tour-language-option" + (locale === option.code ? " is-selected" : "")}
          label={<span className="tour-language-name">
            <strong lang={option.code}>{option.label}</strong>
            <span>{names.of(option.code) ?? option.label}</span>
          </span>}
        />)}
      </div>
    </fieldset>
  </section>;
}
