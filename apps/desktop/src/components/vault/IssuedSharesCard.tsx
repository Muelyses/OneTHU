import { t as i18n, msg as i18nMsg, rich as i18nRich, useLocale as useUiLocale } from "../../i18n/index.js";
/** Secondary management of issued snapshots. Deleting a record never revokes a share. */
import { useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Btn, Menu, Modal, Segment, Stack, Text } from "@onethu/gui";
import { confirmOk } from "../../lib/confirm.js";
import { openFormModal } from "../../lib/formModal.js";
import { openOverlayFrame, useOverlayBack } from "../../state/navStack.js";
import { showToast } from "../../state/toast.js";
import { subscribeVault, vaultSnapshot } from "../../state/vault.js";
import { hasPendingShareRotation, revokeShare, updateShareMeta } from "../../state/vaultShare.js";
import {
  forgetIssuedShare, issuedShareState, issuedShareTitle, issuedSharesSnapshot, markIssuedShareRevoked,
  payloadOfIssuedShare, scopeLabel, subscribeIssuedShares, type IssuedShare,
} from "../../state/vaultShareLog.js";

const STATE_LABEL: Record<string, string> = { get active() { return i18n("components.vault.issuedsharescard.11afd2a53439"); }, get revoked() { return i18n("components.vault.issuedsharescard.fef96e34f77b"); }, get expired() { return i18n("components.vault.issuedsharescard.2fe0e3339ac4"); } };
const BUSY_LABEL = { get copy() { return i18n("components.vault.issuedsharescard.2b2ad5e6aba9"); }, get rename() { return i18n("components.vault.issuedsharescard.4391437c6fb1"); }, get restrict() { return i18n("components.vault.issuedsharescard.a3308fe758a1"); }, get revoke() { return i18n("components.vault.issuedsharescard.d32f69ae73d3"); }, get forget() { return i18n("components.vault.issuedsharescard.275061511cc8"); } };
type Action = keyof typeof BUSY_LABEL;
function timeText(ms: number): string {
  const d = new Date(ms);
  return i18n("components.vault.issuedsharescard.b73971671bd8", { value: String(d.getMonth() + 1), value2: String(d.getDate()), value3: String(String(d.getHours()).padStart(2, "0")), value4: String(String(d.getMinutes()).padStart(2, "0")) });
}

export function IssuedSharesCard({ boxId }: { boxId?: string } = {}): ReactNode {
  const uiLocale = useUiLocale();

  const log = useSyncExternalStore(subscribeIssuedShares, issuedSharesSnapshot, issuedSharesSnapshot);
  const vaults = useSyncExternalStore(subscribeVault, vaultSnapshot, vaultSnapshot);
  const [scope, setScope] = useState<"box" | "all">(boxId ? "box" : "all");
  const allEntries = scope === "all" || !boxId;
  const entries = allEntries ? log.entries : log.entries.filter(entry => entry.boxId === boxId);
  const currentCount = boxId ? log.entries.filter(entry=>entry.boxId===boxId).length : log.entries.length;
  const id = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<{ id: string; action: Action } | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  const [menu, setMenu] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const pending = useRef(false);
  const busyRef = useRef(false); busyRef.current = Boolean(busy);
  const frameId = `vault-issued-${id}`;
  const close = () => {
    if (busyRef.current) { openOverlayFrame(frameId, close); return; }
    setMenu(null); setOpen(false);
  };
  useOverlayBack(frameId, open, close);
  useOverlayBack(`${frameId}-menu`, Boolean(menu), () => setMenu(null));
  const selected = menu ? entries.find(entry => entry.id === menu.id) : undefined;

  async function perform(entry: IssuedShare, action: Action, task: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true; setBusy({ id: entry.id, action }); setError(null); setMenu(null);
    try { await task(); }
    catch (e) { setError({ id: entry.id, message: e instanceof Error ? e.message : String(e) }); }
    finally { pending.current = false; setBusy(null); }
  }
  const revoke = (entry: IssuedShare) => perform(entry, "revoke", async () => {
    if (!entry.cloud?.shareToken) throw new Error(i18n("components.vault.issuedsharescard.b4c7fd58d80f"));
    if (!await confirmOk(i18nMsg("components.vault.issuedsharescard.d96fa2056906", { value: String(issuedShareTitle(entry)) }))) return;
    if (!await revokeShare(payloadOfIssuedShare(entry))) throw new Error(i18n("components.vault.issuedsharescard.3c8e966d966b"));
    markIssuedShareRevoked(entry.id); showToast(i18nMsg("components.vault.issuedsharescard.0b7a8ccf5201"));
  });
  const rename = (entry: IssuedShare) => perform(entry, "rename", async () => {
    const fields = await openFormModal(i18nMsg("components.vault.issuedsharescard.dd6c08640a66"), [{ key: "label", label: i18nMsg("components.vault.issuedsharescard.7aefa357c175"), default: entry.label ?? "" }]);
    if (!fields) return;
    const result = await updateShareMeta(entry.code, { label: fields.label ?? "" });
    if (!result.ok) throw new Error(result.reason ?? i18n("components.vault.issuedsharescard.9dc46ae316d4"));
    showToast(i18nMsg("components.vault.issuedsharescard.faf91eef462c"));
  });
  const restrict = (entry: IssuedShare) => perform(entry, "restrict", async () => {
    const fields = await openFormModal(i18nMsg("components.vault.issuedsharescard.263480c0d47a"), [{ key: "allowEmail", label: i18nMsg("components.vault.issuedsharescard.3c71ad2b46e2"), default: entry.allowEmail ?? "" }]);
    if (!fields) return;
    const result = await updateShareMeta(entry.code, { allowEmail: (fields.allowEmail ?? "").trim() });
    if (!result.ok) throw new Error(result.reason ?? i18n("components.vault.issuedsharescard.263fae90b25b"));
    // A rotation must finish its real revocation before we offer the replacement code.
    showToast(result.code ? i18nMsg("components.vault.issuedsharescard.4371a9b86f89") : i18nMsg("components.vault.issuedsharescard.9d7deae4f40d"));
  });
  const copy = (entry: IssuedShare) => perform(entry, "copy", async () => {
    let code = entry.code;
    if (hasPendingShareRotation(code) || (entry.allowEmail && !entry.cloud?.keyRepoId)) {
      const result = await updateShareMeta(code, entry.allowEmail && !entry.cloud?.keyRepoId ? { allowEmail: entry.allowEmail } : {});
      if (!result.ok) throw new Error(result.reason ?? i18n("components.vault.issuedsharescard.7627cfd1a5fe"));
      code = result.code ?? code;
    }
    try { await navigator.clipboard.writeText(code); }
    catch { throw new Error(i18n("components.vault.issuedsharescard.26b302e09f03")); }
    showToast(code === entry.code ? i18nMsg("components.vault.issuedsharescard.ddc1d8107144") : i18nMsg("components.vault.issuedsharescard.f7b132a0b0ed"));
  });
  const forget = (entry: IssuedShare) => perform(entry, "forget", async () => {
    if (issuedShareState(entry) === "active" && !await confirmOk(i18nMsg("components.vault.issuedsharescard.5e43012c5ebe"))) return;
    forgetIssuedShare(entry.id); showToast(i18nMsg("components.vault.issuedsharescard.36bdc2fdb515"));
  });
  const [revealed, setRevealed] = useState<string | null>(null);

  return <>
    <Btn className="vault-issued-trigger" variant="ghost" onClick={() => { setError(null); setScope(boxId ? "box" : "all"); setOpen(true); }}>{i18nRich("components.vault.issuedsharescard.5c07ccfd4b6e", { value: currentCount ? ` · ${currentCount}` : "" })}</Btn>
    <Modal open={open} onClose={close} title={i18n("components.vault.issuedsharescard.a60259e90289")} size="md" className="vault-issued-modal">
      <Stack gap={4}>
        {boxId ? <Segment value={scope} onChange={value => { setScope(value as "box" | "all"); setMenu(null); setError(null); }} options={[{ value: "box", label: i18n("components.vault.issuedsharescard.6d2ce5e21b2a") }, { value: "all", label: i18n("components.vault.issuedsharescard.525bd7fa41f3") }]} /> : null}
        <Text slot="micro" tone="faint">{i18nRich("components.vault.issuedsharescard.0fc9370bf68e", { value: allEntries ? i18n("components.vault.issuedsharescard.cc7232862b97") : i18n("components.vault.issuedsharescard.6d2ce5e21b2a") })}</Text>
        {entries.length ? <div className="vault-issued-list">
          {entries.map(entry => {
            const state = issuedShareState(entry);
            const working = busy?.id === entry.id;
            return <section className="vault-issued-entry" key={entry.id} aria-label={i18n("components.vault.issuedsharescard.cd10024a604e", { value: String(issuedShareTitle(entry)) })}>
              <div className="vault-issued-heading">
                <Text slot="label">{issuedShareTitle(entry)}</Text>
                <Text slot="micro" tone={state === "active" ? "default" : "faint"}>{STATE_LABEL[state]}</Text>
              </div>
              {allEntries ? <Text slot="micro" tone="faint">{i18nRich("components.vault.issuedsharescard.f76d8f310254", { boxName: entry.boxName, value: vaults.boxes.some(box=>box.id===entry.boxId) ? "" : i18n("components.vault.issuedsharescard.d9cb809600c7") })}</Text> : null}
              <Text slot="micro" tone="faint">{scopeLabel(entry)} · {entry.allowEmail ? i18n("components.vault.issuedsharescard.6d970e8dbefd", { allowEmail: String(entry.allowEmail) }) : i18n("components.vault.issuedsharescard.533f11fea9a2")}</Text>
              <Text slot="micro" tone="faint">{i18nRich("components.vault.issuedsharescard.f7e8f0f64a0d", { value: timeText(entry.issuedAt), value2: entry.expiresAt ? i18n("components.vault.issuedsharescard.ed74c111755f", { value: String(timeText(entry.expiresAt)) }) : i18n("components.vault.issuedsharescard.8de1bb55709d") })}</Text>
              {revealed === entry.id ? <code className="vault-issued-code">{entry.code}</code> : null}
              {error?.id === entry.id ? <div className="vault-issued-error" role="alert"><Text slot="micro">{error.message}</Text></div> : null}
              <div className="vault-issued-actions">
                {working ? <span role="status"><Text slot="micro" tone="faint">{BUSY_LABEL[busy.action]}</Text></span> : null}
                <Btn size="sm" variant="outline" disabled={Boolean(busy) || state !== "active"} loading={working && busy.action === "copy"} onClick={() => void copy(entry)}>{entry.allowEmail && !entry.cloud?.keyRepoId ? i18n("components.vault.issuedsharescard.164caa9ac6c3") : i18n("components.vault.issuedsharescard.7dc5266a2019")}</Btn>
                <Btn size="sm" variant="ghost" disabled={Boolean(busy)} aria-haspopup="menu" aria-expanded={menu?.id === entry.id} aria-label={i18n("components.vault.issuedsharescard.fd76c2e8321a", { value: String(issuedShareTitle(entry)) })} onClick={event => setMenu({ id: entry.id, anchor: event.currentTarget })}>{i18n("components.vault.issuedsharescard.38844b135cf7")}</Btn>
              </div>
            </section>;
          })}
        </div> : <div className="vault-issued-empty"><Text slot="label">{i18n("components.vault.issuedsharescard.3588b544b50b")}</Text><Text slot="micro" tone="faint">{!allEntries && log.entries.length ? i18n("components.vault.issuedsharescard.bdb38862008b") : i18n("components.vault.issuedsharescard.4aa0b6ffacf1")}</Text></div>}
      </Stack>
    </Modal>
    <Menu open={Boolean(selected && menu)} anchor={menu?.anchor} onClose={() => setMenu(null)} label={i18n("components.vault.issuedsharescard.252b9e5745de")} title={selected ? issuedShareTitle(selected) : undefined} items={selected ? [
      { id: "show", label: revealed === selected.id ? i18n("components.vault.issuedsharescard.32ab30d4f1a4") : i18n("components.vault.issuedsharescard.84168ec6814c"), disabled: issuedShareState(selected) !== "active" || hasPendingShareRotation(selected.code) || Boolean(selected.allowEmail && !selected.cloud?.keyRepoId), onSelect: () => setRevealed(revealed === selected.id ? null : selected.id) },
      { id: "rename", label: i18n("components.vault.issuedsharescard.83c37e8a4a5f"), disabled: issuedShareState(selected) !== "active", onSelect: () => void rename(selected) },
      { id: "recipient", label: i18n("components.vault.issuedsharescard.08b88677f8f0"), disabled: issuedShareState(selected) !== "active", onSelect: () => void restrict(selected) },
      "separator",
      { id: "revoke", label: i18n("components.vault.issuedsharescard.b52e35824750"), danger: true, disabled: issuedShareState(selected) !== "active", onSelect: () => void revoke(selected) },
      { id: "forget", label: i18n("components.vault.issuedsharescard.f2cf9101bb2d"), danger: true, onSelect: () => void forget(selected) },
    ] : []} />
  </>;
}
