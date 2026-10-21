import { useLocale as useUiLocale } from "../../i18n/index.js";
import type { ReactNode } from "react";

/** A local acceptance signal around the unchanged entrance, not a content panel. */
export function VaultRadarScope({ left, top, hover }: { left: number; top: number; hover: boolean }): ReactNode {
  const uiLocale = useUiLocale();

  return <div className="vault-accept-layer" aria-hidden="true">
    <div className={"vault-accept-halo" + (hover ? " is-hover" : "")} style={{ left, top }} data-vault-drop>
      <span className="vault-accept-scan" />
    </div>
  </div>;
}
