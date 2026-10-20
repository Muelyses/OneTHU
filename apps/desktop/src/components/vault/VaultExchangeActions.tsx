import { t as i18n, msg as i18nMsg, useLocale as useUiLocale } from "../../i18n/index.js";
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
  const uiLocale = useUiLocale();

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
    if (!withVault && !combined) throw new Error(i18n("components.vault.vaultexchangeactions.edc68923b734"));
    if (withPersonal && !cardsSnapshot().personal.name.trim()) throw new Error(i18n("components.vault.vaultexchangeactions.d351c99d90dc"));
    if (withOrgId && !orgOptions().some(org => org.id === withOrgId)) throw new Error(i18n("components.vault.vaultexchangeactions.aae2b6b66901"));
    if (withVault && combined && (activeVault().id !== target.id || activeVault().items !== target.items || activeVault().name !== target.name)) throw new Error(i18n("components.vault.vaultexchangeactions.577a1f849d63"));
    setCode(""); setPayload(null); setResult("");
    if (combined) {
      const shared = await buildTouchCode({ withVault, withPersonal, withOrgId: withOrgId || undefined });
      setCode(shared.code); setCombination(true);
      setSentSummary([shared.payload.vaultName && i18n("components.vault.vaultexchangeactions.07be734451da", { vaultName: String(shared.payload.vaultName) }), shared.payload.personal && i18n("components.vault.vaultexchangeactions.487e926379fe"), shared.payload.orgName && i18n("components.vault.vaultexchangeactions.542ad2d546d0", { orgName: String(shared.payload.orgName) })].filter(Boolean).join(" · "));
    } else {
      const shared = await shareCodeForBox(target);
      setCode(shared.code); setPayload(shared.payload); setCombination(false);
      setSentSummary(i18n("components.vault.vaultexchangeactions.32db96a41dc9", { name: String(target.name), length: String(target.items.length) }));
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
      if (!text.trim()) throw new Error(i18n("components.vault.vaultexchangeactions.ad0b66c6915d"));
      setInput(text.trim()); setResult("");
    } catch (e) {
      throw new Error(e instanceof Error && e.message.includes("剪贴板里") ? e.message : i18n("components.vault.vaultexchangeactions.31e8013b76c6"));
    }
  });
  const copy = () => run("copy", async () => {
    try { await navigator.clipboard.writeText(code); showToast(i18nMsg("components.vault.vaultexchangeactions.ddc1d8107144")); }
    catch { throw new Error(i18n("components.vault.vaultexchangeactions.a5ffbae552f7")); }
  });
  const revoke = () => run("revoke", async () => {
    if (!payload || !await revokeShare(payload)) throw new Error(i18n("components.vault.vaultexchangeactions.3c8e966d966b"));
    setCode(""); setPayload(null); setResult(i18n("components.vault.vaultexchangeactions.68368d728a9e"));
    showToast(i18nMsg("components.vault.vaultexchangeactions.0b7a8ccf5201"));
  });

  return <>
    <div className="vault-exchange-actions">
      <Btn variant="solid" size="sm" disabled={busy} onClick={() => open("send")}>{i18n("components.vault.vaultexchangeactions.3c4f03e4df9e")}</Btn>
      <Btn variant="outline" size="sm" disabled={busy} onClick={() => open("receive")}>{i18n("components.vault.vaultexchangeactions.6e684586884e")}</Btn>
    </div>
    <Modal open={view !== null} onClose={close} title={view === "send" ? i18n("components.vault.vaultexchangeactions.a840e8381cf3") : i18n("components.vault.vaultexchangeactions.3580f829b532")} size="sm" className="vault-exchange-modal">
      <Stack gap={4}>
        {error ? <div className="vault-exchange-notice is-error" role="alert"><Text>{error}</Text></div> : null}
        {result ? <div className="vault-exchange-notice is-success" role="status"><IconCheck width={24} height={24} /><Text>{result}</Text></div> : null}
        {view === "send" ? <>
          {code ? <>
            <div className="vault-exchange-result">
              <Text slot="label">{i18n("components.vault.vaultexchangeactions.1426563f7393")}</Text>
              <Text slot="micro" tone="faint">{sentSummary}</Text>
              <code className="vault-exchange-code">{code}</code>
              <div className="vault-exchange-qr"><QRCodeSVG value={code} size={200} /></div>
              <Text slot="micro" tone="faint">{combination ? i18n("components.vault.vaultexchangeactions.bd3dfaa014dc") : payload?.allowEmail ? i18n("components.vault.vaultexchangeactions.90af63ce1115", { allowEmail: String(payload.allowEmail) }) : i18n("components.vault.vaultexchangeactions.c8176173ee4c")}</Text>
            </div>
            <div className="vault-exchange-buttons">
              <Btn variant="solid" disabled={busy} loading={work === "copy"} onClick={() => void copy()}>{i18n("components.vault.vaultexchangeactions.7dc5266a2019")}</Btn>
              <Btn variant="outline" disabled={!nfc.available || busy} onClick={() => void nfc.send(() => code)}>{i18n("components.vault.vaultexchangeactions.12beebf24ea5")}</Btn>
              {payload?.cloud?.shareToken ? <Btn variant="ghost" tone="error" disabled={busy} loading={work === "revoke"} onClick={() => void revoke()}>{i18n("components.vault.vaultexchangeactions.b52e35824750")}</Btn> : null}
            </div>
            {combination ? <Text slot="micro" tone="faint">{[withVault && i18n("components.vault.vaultexchangeactions.2a4057bbb923"), withOrgId && i18n("components.vault.vaultexchangeactions.e6de5478dcda"), i18n("components.vault.vaultexchangeactions.1054b7ea97a6")].filter(Boolean).join("；")}。</Text> : null}
            <Btn variant="ghost" disabled={busy} onClick={() => { setCode(""); setPayload(null); setError(""); }}>{i18n("components.vault.vaultexchangeactions.8333578c2f49")}</Btn>
          </> : <>
            <div className="vault-exchange-summary">
              <Text slot="label">{target.name}</Text>
              <Text slot="micro" tone="faint">{target.items.length ? i18n("components.vault.vaultexchangeactions.c4070317e698", { length: String(target.items.length) }) : i18n("components.vault.vaultexchangeactions.74acec2e689a")}</Text>
            </div>
            <Checkbox checked={withVault} disabled={busy || !target.items.length} onChange={setWithVault} label={i18n("components.vault.vaultexchangeactions.6e17991c80d7")} />
            <details className="vault-exchange-options">
              <summary>{i18n("components.vault.vaultexchangeactions.75d3321f0e54")}</summary>
              <Stack gap={3}>
                <Checkbox checked={withPersonal} onChange={setWithPersonal} disabled={busy} label={i18n("components.vault.vaultexchangeactions.df6746028850")} />
                <Field label={i18n("components.vault.vaultexchangeactions.b1bd19b13336")}>
                  <Select value={withOrgId} onChange={setWithOrgId} disabled={busy} aria-label={i18n("components.vault.vaultexchangeactions.6b6a8f5e0dbb")} options={[{ value: "", label: i18n("components.vault.vaultexchangeactions.32c1c83421fc") }, ...orgs.map(org => ({ value: org.id, label: org.name }))]} />
                </Field>
              </Stack>
            </details>
            <Btn variant="solid" block disabled={busy || (!withVault && !withPersonal && !withOrgId)} loading={work === "generate"} onClick={() => void generate()}>{work === "generate" ? i18n("components.vault.vaultexchangeactions.f730d0ac1001") : error ? i18n("components.vault.vaultexchangeactions.626483b777ae") : i18n("components.vault.vaultexchangeactions.645b0bbba87e")}</Btn>
            {error ? <Btn variant="ghost" disabled={busy} onClick={() => { close(); openTab("cloud"); }}>{i18n("components.vault.vaultexchangeactions.401caf5fdfe9")}</Btn> : null}
          </>}
        </> : result ? <div className="vault-exchange-buttons">
          <Btn variant="solid" onClick={close}>{i18n("components.vault.vaultexchangeactions.c0b3fbff51cc")}</Btn>
          <Btn variant="outline" onClick={() => { setResult(""); setError(""); }}>{i18n("components.vault.vaultexchangeactions.b22a92ecd85c")}</Btn>
        </div> : <>
          <Text slot="micro" tone="faint">{i18n("components.vault.vaultexchangeactions.d8af406df93e")}</Text>
          <Field label={i18n("components.vault.vaultexchangeactions.0722f2f96a03")}>
            <Input value={input} onChange={setInput} placeholder="ON-…" disabled={busy} onEnter={() => { if (input.trim()) void receive(); }} aria-label={i18n("components.vault.vaultexchangeactions.0722f2f96a03")} autoFocus />
          </Field>
          <div className="vault-exchange-buttons">
            <Btn variant="outline" disabled={busy} loading={work === "clipboard"} onClick={() => void paste()}>{i18n("components.vault.vaultexchangeactions.cfe420a86519")}</Btn>
            <Btn variant="solid" disabled={busy || !input.trim()} loading={work === "receive"} onClick={() => void receive()}>{work === "receive" ? i18n("components.vault.vaultexchangeactions.37c201950f27") : i18n("components.vault.vaultexchangeactions.3e3b496af014")}</Btn>
          </div>
          <div className="vault-exchange-alternatives">
            <Text slot="micro" tone="faint">{i18n("components.vault.vaultexchangeactions.6f61e147f9fb")}</Text>
            <Btn variant="ghost" disabled={busy} loading={work === "scan"} onClick={() => void scan()}>{i18n("components.vault.vaultexchangeactions.6ebb64384907")}</Btn>
            <Btn variant="ghost" disabled={!nfc.available || busy} onClick={() => void nfc.receive()}>{i18n("components.vault.vaultexchangeactions.11598ea1df1a")}</Btn>
          </div>
        </>}
        <Text slot="micro" tone="faint">{nfc.hint}</Text>
        <Text slot="micro" tone="faint">{i18n("components.vault.vaultexchangeactions.7ac87294020a")}</Text>
      </Stack>
    </Modal>
    {nfc.feedback}
  </>;
}
