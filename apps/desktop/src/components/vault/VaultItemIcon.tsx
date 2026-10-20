import type { SVGProps } from "react";
import type { VaultCatch } from "../../state/vault.js";
import { VAULT_ICON_PATHS, vaultItemPresentation } from "./vaultItemPresentation.js";

/** Same paths as the native DOM drag ghost; the adjacent title supplies the accessible name. */
export function VaultItemIcon({ item, ...props }: { item: VaultCatch } & SVGProps<SVGSVGElement>) {
  const { icon } = vaultItemPresentation(item);
  return <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>
    <path d={VAULT_ICON_PATHS[icon] ?? VAULT_ICON_PATHS.inbox} />
  </svg>;
}
