import { useLocale as useUiLocale } from "../../i18n/index.js";
import type { SVGProps } from "react";
import type { VaultCatch } from "../../state/vault.js";
import { IconContentType } from "../Icons.js";
import { vaultItemPresentation } from "./vaultItemPresentation.js";

/** Same paths as the native DOM drag ghost; the adjacent title supplies the accessible name. */
export function VaultItemIcon({ item, ...props }: { item: VaultCatch } & SVGProps<SVGSVGElement>) {
  const uiLocale = useUiLocale();

  const { icon } = vaultItemPresentation(item);
  return <IconContentType kind={icon} width={20} height={20} {...props} />;
}
