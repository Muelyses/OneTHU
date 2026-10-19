import { useRef, useState } from "react";
import { Btn, Modal, Stack, Text } from "@onethu/gui";
import { QRCodeSVG } from "qrcode.react";
import { useVaultReceive } from "../../lib/useVaultReceive.js";
import { useNfcExchange } from "../../lib/useNfcExchange.js";
import { shareCodeForBox, revokeShare, type VaultSharePayload } from "../../state/vaultShare.js";
import { vaultShareCode } from "../../lib/contentExchange.js";
import type { VaultBox } from "../../state/vault.js";
import { showToast } from "../../state/toast.js";

/** One send/receive surface for radar, drawer and full page. */
export function VaultExchangeActions({box}:{box:VaultBox}){
 const receive=useVaultReceive(),nfc=useNfcExchange();
 const [view,setView]=useState<"send"|"receive"|null>(null),[code,setCode]=useState(""),[payload,setPayload]=useState<VaultSharePayload|null>(null),[working,setWorking]=useState(false);
 const pending=useRef(false);const busy=working||receive.busy||nfc.busy;
 async function share(){if(pending.current)return;pending.current=true;setWorking(true);setView("send");setCode("");setPayload(null);try{const r=await shareCodeForBox(box);setCode(r.code);setPayload(r.payload);await navigator.clipboard.writeText(r.code).then(()=>showToast("分享口令已复制")).catch(()=>undefined);}catch(e){showToast(String(e));}finally{pending.current=false;setWorking(false);}}
 return <><div className="vault-exchange-actions"><Btn variant="solid" size="sm" disabled={busy||!box.items.length} onClick={()=>void share()}>{working?"正在生成…":"分享口令"}</Btn><Btn variant="outline" size="sm" disabled={busy} onClick={()=>setView("receive")}>接收</Btn></div>
 <Modal open={view!==null} onClose={()=>setView(null)} title={view==="send"?`分享「${box.name}」`:"接收内容"} size="sm">
 <Stack gap={3}>{view==="send"?<>
 {working?<Text>正在准备联网短口令…</Text>:code?<><code className="vault-share-code">{code}</code><div className="vault-qr"><QRCodeSVG value={code} size={200}/></div><div className="name-card-actions"><Btn variant="outline" onClick={()=>void navigator.clipboard.writeText(code).then(()=>showToast("已复制")).catch(()=>showToast("请手动复制口令"))}>复制口令</Btn><Btn variant="outline" disabled={!nfc.available||busy} onClick={()=>void nfc.send(()=>code)}>NFC 传送</Btn>{payload?.cloud?.shareToken?<Btn variant="ghost" tone="error" disabled={busy} onClick={()=>{setWorking(true);void revokeShare(payload).then(ok=>{if(ok){setCode("");setView(null);showToast("分享已撤销");}else showToast("撤销未完成，请重试");}).catch(e=>showToast(String(e))).finally(()=>setWorking(false));}}>撤销分享</Btn>:null}</div></>:<Btn variant="outline" disabled={busy} onClick={()=>void share()}>重新生成</Btn>}
 </>:<div className="name-card-actions"><Btn variant="solid" disabled={busy} onClick={()=>void receive.paste()}>粘贴口令</Btn><Btn variant="outline" disabled={busy} onClick={()=>void receive.scan()}>识别二维码</Btn><Btn variant="outline" disabled={!nfc.available||busy} onClick={()=>void nfc.receive()}>NFC 接收</Btn></div>}
 <Text slot="micro" tone="faint">{nfc.hint}</Text><Text slot="micro" tone="faint">口令、二维码与 NFC 使用同一份内容；接收时需要联网。</Text>
 </Stack></Modal>{nfc.feedback}</>;
}
