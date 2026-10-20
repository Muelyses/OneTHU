import { useId, useRef, useState } from "react";
import { Btn, Checkbox, Field, Input, Modal, Select, Stack, Text } from "@onethu/gui";
import { QRCodeSVG } from "qrcode.react";
import { pickAndReceiveQr, receivePastedCode } from "../../lib/contentExchange.js";
import { useNfcExchange } from "../../lib/useNfcExchange.js";
import { shareCodeForBox, revokeShare, type VaultSharePayload } from "../../state/vaultShare.js";
import { buildTouchCode, orgOptions, type TouchOrgBrief } from "../../state/touch.js";
import { cardsSnapshot } from "../../state/nameCard.js";
import { activeVault, type VaultBox } from "../../state/vault.js";
import { openTab } from "../../state/explorer.js";
import { openOverlayFrame, useOverlayBack } from "../../state/navStack.js";
import { showToast } from "../../state/toast.js";
import { IconCheck } from "../Icons.js";

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);
type Work = "generate" | "receive" | "scan" | "clipboard" | "copy" | "revoke" | null;

/** The same send/receive flow is used by the radar, drawer and full page. */
export function VaultExchangeActions({ box }: { box: VaultBox }) {
  const nfc = useNfcExchange();
  const id = useId();
  const [view, setView] = useState<"send" | "receive" | null>(null);
  const [target, setTarget] = useState(box);
  const [code, setCode] = useState("");
  const [payload, setPayload] = useState<VaultSharePayload | null>(null);
  const [input, setInput] = useState("");
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [work, setWork] = useState<Work>(null);
  const [withVault, setWithVault] = useState(true);
  const [withPersonal, setWithPersonal] = useState(false);
  const [withOrgId, setWithOrgId] = useState("");
  const [orgs, setOrgs] = useState<TouchOrgBrief[]>([]);
  const [combination, setCombination] = useState(false);
  const [sentSummary, setSentSummary] = useState("");
  const pending = useRef(false);
  const busy = work !== null || nfc.busy;
  const busyRef = useRef(false); busyRef.current = busy;
  const frameId = `vault-exchange-${id}`;
  const close = () => {
    // navStack pops before calling close: keep the progress layer registered while work is running.
    if (busyRef.current) { openOverlayFrame(frameId, close); return; }
    setView(null);
  };
  useOverlayBack(frameId, view !== null, close);

  function open(next: "send" | "receive") {
    setTarget(box); setView(next); setError(""); setResult(""); setCode(""); setPayload(null);
    setInput(""); setWithVault(box.items.length > 0); setWithPersonal(false); setWithOrgId("");
    setOrgs(orgOptions()); setCombination(false); setSentSummary("");
  }
  async function run(kind: Work, action: () => Promise<void>) {
    if (pending.current || nfc.busy) return;
    pending.current = true; setWork(kind); setError("");
    try { await action(); }
    catch (e) { setError(messageOf(e)); }
    finally { pending.current = false; setWork(null); }
  }
  const generate = () => run("generate", async () => {
    const combined = withPersonal || Boolean(withOrgId);
    if (!withVault && !combined) throw new Error("先选择要分享的内容：暂存箱、个人名片或组织名片。");
    if (withPersonal && !cardsSnapshot().personal.name.trim()) throw new Error("个人名片还没有姓名，请先在「我的」中填写。");
    if (withOrgId && !orgOptions().some(org => org.id === withOrgId)) throw new Error("这个组织已不在列表中，请重新选择。");
    if (withVault && combined && (activeVault().id !== target.id || activeVault().items !== target.items || activeVault().name !== target.name)) throw new Error("暂存箱已经切换或更新，请关闭后重新确认要分享的内容。");
    setCode(""); setPayload(null); setResult("");
    if (combined) {
      const shared = await buildTouchCode({ withVault, withPersonal, withOrgId: withOrgId || undefined });
      setCode(shared.code); setCombination(true);
      setSentSummary([shared.payload.vaultName && `暂存箱「${shared.payload.vaultName}」`, shared.payload.personal && "我的名片", shared.payload.orgName && `组织「${shared.payload.orgName}」`].filter(Boolean).join(" · "));
    } else {
      const shared = await shareCodeForBox(target);
      setCode(shared.code); setPayload(shared.payload); setCombination(false);
      setSentSummary(`「${target.name}」的 ${target.items.length} 项内容`);
    }
  });
  const receive = () => run("receive", async () => {
    const message = await receivePastedCode(input);
    setResult(message); setInput(""); showToast(message);
  });
  const scan = () => run("scan", async () => {
    const message = await pickAndReceiveQr();
    if (message) { setResult(message); showToast(message); }
  });
  const paste = () => run("clipboard", async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) throw new Error("剪贴板里还没有口令，请复制后再试。");
      setInput(text.trim()); setResult("");
    } catch (e) {
      throw new Error(e instanceof Error && e.message.includes("剪贴板里") ? e.message : "无法读取剪贴板，请直接在输入框粘贴口令。");
    }
  });
  const copy = () => run("copy", async () => {
    try { await navigator.clipboard.writeText(code); showToast("口令已复制"); }
    catch { throw new Error("复制未完成，请长按或选中上方口令手动复制。"); }
  });
  const revoke = () => run("revoke", async () => {
    if (!payload || !await revokeShare(payload)) throw new Error("撤销未完成，请检查云盘连接后重试。");
    setCode(""); setPayload(null); setResult("这条分享已撤销，口令与二维码将无法再读取。已接收的副本会保留。");
    showToast("分享已撤销");
  });

  return <>
    <div className="vault-exchange-actions">
      <Btn variant="solid" size="sm" disabled={busy} onClick={() => open("send")}>分享口令</Btn>
      <Btn variant="outline" size="sm" disabled={busy} onClick={() => open("receive")}>接收</Btn>
    </div>
    <Modal open={view !== null} onClose={close} title={view === "send" ? "分享内容" : "接收内容"} size="sm" className="vault-exchange-modal">
      <Stack gap={4}>
        {error ? <div className="vault-exchange-notice is-error" role="alert"><Text>{error}</Text></div> : null}
        {result ? <div className="vault-exchange-notice is-success" role="status"><IconCheck width={24} height={24} /><Text>{result}</Text></div> : null}
        {view === "send" ? <>
          {code ? <>
            <div className="vault-exchange-result">
              <Text slot="label">口令已就绪</Text>
              <Text slot="micro" tone="faint">{sentSummary}</Text>
              <code className="vault-exchange-code">{code}</code>
              <div className="vault-exchange-qr"><QRCodeSVG value={code} size={200} /></div>
              <Text slot="micro" tone="faint">{combination ? "名片随组合口令发送；箱内内容与组织仍按各自权限读取。" : payload?.allowEmail ? `仅 ${payload.allowEmail} 的云盘账号可读取` : "持有这条口令的人可以接收，请只发给希望分享的人。"}</Text>
            </div>
            <div className="vault-exchange-buttons">
              <Btn variant="solid" disabled={busy} loading={work === "copy"} onClick={() => void copy()}>复制口令</Btn>
              <Btn variant="outline" disabled={!nfc.available || busy} onClick={() => void nfc.send(() => code)}>NFC 传送</Btn>
              {payload?.cloud?.shareToken ? <Btn variant="ghost" tone="error" disabled={busy} loading={work === "revoke"} onClick={() => void revoke()}>撤销分享</Btn> : null}
            </div>
            {combination ? <Text slot="micro" tone="faint">{[withVault && "箱内内容口令可在「已发出口令」管理", withOrgId && "组织邀请可在组织中管理", "请复制保存这条组合口令"].filter(Boolean).join("；")}。</Text> : null}
            <Btn variant="ghost" disabled={busy} onClick={() => { setCode(""); setPayload(null); setError(""); }}>调整分享内容</Btn>
          </> : <>
            <div className="vault-exchange-summary">
              <Text slot="label">{target.name}</Text>
              <Text slot="micro" tone="faint">{target.items.length ? `${target.items.length} 项内容 · 生成时保存一份快照` : "箱子还是空的，也可以只发送个人或组织名片"}</Text>
            </div>
            <Checkbox checked={withVault} disabled={busy || !target.items.length} onChange={setWithVault} label="带上这个暂存箱" />
            <details className="vault-exchange-options">
              <summary>组合分享 · 带上名片</summary>
              <Stack gap={3}>
                <Checkbox checked={withPersonal} onChange={setWithPersonal} disabled={busy} label="带上我的个人名片" />
                <Field label="组织名片">
                  <Select value={withOrgId} onChange={setWithOrgId} disabled={busy} aria-label="带上组织名片" options={[{ value: "", label: "不带组织名片" }, ...orgs.map(org => ({ value: org.id, label: org.name }))]} />
                </Field>
              </Stack>
            </details>
            <Btn variant="solid" block disabled={busy || (!withVault && !withPersonal && !withOrgId)} loading={work === "generate"} onClick={() => void generate()}>{work === "generate" ? "正在准备口令…" : error ? "重试生成口令" : "生成分享口令"}</Btn>
            {error ? <Btn variant="ghost" disabled={busy} onClick={() => { close(); openTab("cloud"); }}>检查云盘连接</Btn> : null}
          </>}
        </> : result ? <div className="vault-exchange-buttons">
          <Btn variant="solid" onClick={close}>完成</Btn>
          <Btn variant="outline" onClick={() => { setResult(""); setError(""); }}>继续接收</Btn>
        </div> : <>
          <Text slot="micro" tone="faint">箱子会另存为新暂存箱，原来的内容继续保留。</Text>
          <Field label="收到的口令">
            <Input value={input} onChange={setInput} placeholder="ON-…" disabled={busy} onEnter={() => { if (input.trim()) void receive(); }} aria-label="收到的口令" autoFocus />
          </Field>
          <div className="vault-exchange-buttons">
            <Btn variant="outline" disabled={busy} loading={work === "clipboard"} onClick={() => void paste()}>粘贴剪贴板</Btn>
            <Btn variant="solid" disabled={busy || !input.trim()} loading={work === "receive"} onClick={() => void receive()}>{work === "receive" ? "正在接收…" : "接收口令"}</Btn>
          </div>
          <div className="vault-exchange-alternatives">
            <Text slot="micro" tone="faint">也可以</Text>
            <Btn variant="ghost" disabled={busy} loading={work === "scan"} onClick={() => void scan()}>识别二维码</Btn>
            <Btn variant="ghost" disabled={!nfc.available || busy} onClick={() => void nfc.receive()}>NFC 接收</Btn>
          </div>
        </>}
        <Text slot="micro" tone="faint">{nfc.hint}</Text>
        <Text slot="micro" tone="faint">口令、二维码与 NFC 使用同一份内容，接收时需要联网。</Text>
      </Stack>
    </Modal>
    {nfc.feedback}
  </>;
}
