import { useEffect, useMemo, type ReactNode } from "react";
import { ONE_GUI_MESSAGE_KEYS, OneGUILocaleProvider, type OneGUIMessageKey } from "@onethu/gui";
import { installI18n, localeTable, useLocale } from "./index.js";

/** Subscribes the library defaults without remounting pages, portals or draft inputs. */
export function I18nProvider({ children }: { children: ReactNode }): ReactNode {
  const locale = useLocale();
  useEffect(installI18n, []);
  const messages = useMemo(() => {
    const table = localeTable(locale);
    const result: Partial<Record<OneGUIMessageKey, string>> = {};
    for (const key of ONE_GUI_MESSAGE_KEYS) {
      const value = table[key];
      // The standalone GUI provider supplies its own defaults until extraction.
      if (value) result[key] = value;
    }
    return result;
  }, [locale]);
  return <OneGUILocaleProvider locale={locale} messages={messages}>{children}</OneGUILocaleProvider>;
}
