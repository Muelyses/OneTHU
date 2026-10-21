import { t as i18n, useLocale as useUiLocale } from "../../i18n/index.js";
import type { ReactNode } from "react";
import { PageHead } from "../Layout.js";
import { VaultWorkspace } from "./VaultWorkspace.js";

export function VaultPage(): ReactNode {
  const uiLocale = useUiLocale();

  return <div className="vault-page">
    <PageHead title={i18n("components.vault.vaultpage.804002a9c49a")} meta={i18n("components.vault.vaultpage.ee747d4c47e2")} />
    <VaultWorkspace />
  </div>;
}
