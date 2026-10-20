import type { ReactNode } from "react";
import { PageHead } from "../Layout.js";
import { VaultWorkspace } from "./VaultWorkspace.js";

export function VaultPage(): ReactNode {
  return <div className="vault-page">
    <PageHead title="暂存箱" meta="先收好，再打开、分享，或交给小OH。" />
    <VaultWorkspace />
  </div>;
}
