import { useMemo, type ReactNode } from "react";
import { useLocale } from "../i18n/index.js";
import { createPreviewDataset } from "../state/data.js";
import { createPreviewScope, PreviewDataContext } from "../state/dataScope.js";

/** Demo values belong only to the widget-preview subtree, including concurrent drawers. */
export function PreviewDataProvider({ children }: { children: ReactNode }): ReactNode {
  const locale = useLocale();
  const scope = useMemo(() => createPreviewScope(createPreviewDataset()), [locale]);
  return <PreviewDataContext.Provider key={locale} value={scope}>{children}</PreviewDataContext.Provider>;
}
