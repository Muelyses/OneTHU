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

const STATE_LABEL: Record<string, string> = { active: "有效", revoked: "已撤销", expired: "已过期" };
const BUSY_LABEL = { copy: "正在复制…", rename: "正在更新名称…", restrict: "正在更新接收范围…", revoke: "正在撤销…", forget: "正在删除记录…" };
type Action = keyof typeof BUSY_LABEL;
function timeText(ms: number): string {
  const d = new Date(ms);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function IssuedSharesCard({ boxId }: { boxId?: string } = {}): ReactNode {
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
    if (!entry.cloud?.shareToken) throw new Error("这条旧口令没有云盘分享，只能删除记录。");
    if (!await confirmOk(`撤销「${issuedShareTitle(entry)}」？对方将无法再次读取，已经接收的副本会保留。`)) return;
    if (!await revokeShare(payloadOfIssuedShare(entry))) throw new Error("撤销未完成，请检查云盘连接后重试。");
    markIssuedShareRevoked(entry.id); showToast("分享已撤销");
  });
  const rename = (entry: IssuedShare) => perform(entry, "rename", async () => {
    const fields = await openFormModal("口令名称", [{ key: "label", label: "名称（留空使用箱子名）", default: entry.label ?? "" }]);
    if (!fields) return;
    const result = await updateShareMeta(entry.code, { label: fields.label ?? "" });
    if (!result.ok) throw new Error(result.reason ?? "改名未完成，请重试。");
    showToast("口令名称已更新");
  });
  const restrict = (entry: IssuedShare) => perform(entry, "restrict", async () => {
    const fields = await openFormModal("接收范围", [{ key: "allowEmail", label: "清华云盘邮箱（留空允许持有口令的人接收）", default: entry.allowEmail ?? "" }]);
    if (!fields) return;
    const result = await updateShareMeta(entry.code, { allowEmail: (fields.allowEmail ?? "").trim() });
    if (!result.ok) throw new Error(result.reason ?? "接收范围更新未完成，请重试。");
    // A rotation must finish its real revocation before we offer the replacement code.
    showToast(result.code ? "接收范围已更新，旧口令已撤销。请复制新口令发送。" : "接收范围已更新");
  });
  const copy = (entry: IssuedShare) => perform(entry, "copy", async () => {
    let code = entry.code;
    if (hasPendingShareRotation(code) || (entry.allowEmail && !entry.cloud?.keyRepoId)) {
      const result = await updateShareMeta(code, entry.allowEmail && !entry.cloud?.keyRepoId ? { allowEmail: entry.allowEmail } : {});
      if (!result.ok) throw new Error(result.reason ?? "分享升级未完成，请重试。");
      code = result.code ?? code;
    }
    try { await navigator.clipboard.writeText(code); }
    catch { throw new Error("无法写入剪贴板，请从「查看口令」中手动复制。"); }
    showToast(code === entry.code ? "口令已复制" : "私密分享已升级，新口令已复制");
  });
  const forget = (entry: IssuedShare) => perform(entry, "forget", async () => {
    if (issuedShareState(entry) === "active" && !await confirmOk("这条口令仍有效，删除记录不会撤销分享。确定只删除记录？")) return;
    forgetIssuedShare(entry.id); showToast("记录已删除");
  });
  const [revealed, setRevealed] = useState<string | null>(null);

  return <>
    <Btn className="vault-issued-trigger" variant="ghost" onClick={() => { setError(null); setScope(boxId ? "box" : "all"); setOpen(true); }}>已发出口令{currentCount ? ` · ${currentCount}` : ""}</Btn>
    <Modal open={open} onClose={close} title="已发出口令" size="md" className="vault-issued-modal">
      <Stack gap={4}>
        {boxId ? <Segment value={scope} onChange={value => { setScope(value as "box" | "all"); setMenu(null); setError(null); }} options={[{ value: "box", label: "当前箱" }, { value: "all", label: "全部口令" }]} /> : null}
        <Text slot="micro" tone="faint">{allEntries ? "所有箱子" : "当前箱"}的分享快照。清空或删除箱子不会撤销已发口令。</Text>
        {entries.length ? <div className="vault-issued-list">
          {entries.map(entry => {
            const state = issuedShareState(entry);
            const working = busy?.id === entry.id;
            return <section className="vault-issued-entry" key={entry.id} aria-label={`口令：${issuedShareTitle(entry)}`}>
              <div className="vault-issued-heading">
                <Text slot="label">{issuedShareTitle(entry)}</Text>
                <Text slot="micro" tone={state === "active" ? "default" : "faint"}>{STATE_LABEL[state]}</Text>
              </div>
              {allEntries ? <Text slot="micro" tone="faint">来自「{entry.boxName}」{vaults.boxes.some(box=>box.id===entry.boxId) ? "" : " · 箱子已删除"}</Text> : null}
              <Text slot="micro" tone="faint">{scopeLabel(entry)} · {entry.allowEmail ? `仅 ${entry.allowEmail}` : "持有口令即可接收"}</Text>
              <Text slot="micro" tone="faint">{timeText(entry.issuedAt)} 发出 · {entry.expiresAt ? `${timeText(entry.expiresAt)} 到期` : "不过期"}</Text>
              {revealed === entry.id ? <code className="vault-issued-code">{entry.code}</code> : null}
              {error?.id === entry.id ? <div className="vault-issued-error" role="alert"><Text slot="micro">{error.message}</Text></div> : null}
              <div className="vault-issued-actions">
                {working ? <span role="status"><Text slot="micro" tone="faint">{BUSY_LABEL[busy.action]}</Text></span> : null}
                <Btn size="sm" variant="outline" disabled={Boolean(busy) || state !== "active"} loading={working && busy.action === "copy"} onClick={() => void copy(entry)}>{entry.allowEmail && !entry.cloud?.keyRepoId ? "升级并复制" : "复制口令"}</Btn>
                <Btn size="sm" variant="ghost" disabled={Boolean(busy)} aria-haspopup="menu" aria-expanded={menu?.id === entry.id} aria-label={`管理口令：${issuedShareTitle(entry)}`} onClick={event => setMenu({ id: entry.id, anchor: event.currentTarget })}>更多</Btn>
              </div>
            </section>;
          })}
        </div> : <div className="vault-issued-empty"><Text slot="label">还没有发出口令</Text><Text slot="micro" tone="faint">{!allEntries && log.entries.length ? "其他箱子发出的分享，可以在「全部口令」中查看。" : "生成暂存箱分享后，会在这里留下记录。"}</Text></div>}
      </Stack>
    </Modal>
    <Menu open={Boolean(selected && menu)} anchor={menu?.anchor} onClose={() => setMenu(null)} label="口令管理" title={selected ? issuedShareTitle(selected) : undefined} items={selected ? [
      { id: "show", label: revealed === selected.id ? "收起口令" : "查看口令", disabled: issuedShareState(selected) !== "active" || hasPendingShareRotation(selected.code) || Boolean(selected.allowEmail && !selected.cloud?.keyRepoId), onSelect: () => setRevealed(revealed === selected.id ? null : selected.id) },
      { id: "rename", label: "改名", disabled: issuedShareState(selected) !== "active", onSelect: () => void rename(selected) },
      { id: "recipient", label: "限定邮箱", disabled: issuedShareState(selected) !== "active", onSelect: () => void restrict(selected) },
      "separator",
      { id: "revoke", label: "撤销分享", danger: true, disabled: issuedShareState(selected) !== "active", onSelect: () => void revoke(selected) },
      { id: "forget", label: "删除记录", danger: true, onSelect: () => void forget(selected) },
    ] : []} />
  </>;
}
