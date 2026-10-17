/**
 * OneTHU 暂存箱页面（Phase 1）：混合对象清单 + 口令生成/导入 + 拖放收纳。
 *
 * 视觉：沿用 OneGUI（PageHead/Card/List/Row/Btn/Segment/Input），不写私有 chrome；
 * 拖动相关类在 packages/gui/src/recipes/workbench.css，唯一交互层是 vaultDrag.ts。
 */
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Btn, Card, List, Row, Segment, Text } from "@onethu/gui";
import { QRCodeSVG } from "qrcode.react";
import { Empty, PageHead } from "../Layout.js";
import { useApp } from "../../state/context.js";
import { openFormModal } from "../../lib/formModal.js";
import { confirmOk } from "../../lib/confirm.js";
import { showToast } from "../../state/toast.js";
import {
  activeVault, addToVault, clearVault, createVault, deleteVault, renameVault, removeFromVault,
  setActiveVault, subscribeVault, VAULT_TYPE_LABEL, vaultSnapshot, type VaultItem,
} from "../../state/vault.js";
import { allowInlineShare, decodeShareAsync, importShareCodeAsCurrent, mintShareCode, revokeShare, type VaultSharePayload } from "../../state/vaultShare.js";
import { installVaultCloudAdapter } from "../../state/vaultCloud.js";
import { nfcReadText, nfcShareText, nfcStatus } from "../../lib/nfc.js";
import { decodeQrFile, qrScanSupported } from "../../lib/qrScan.js";
import { fileToBytes, pickFile } from "../../lib/attach.js";
import { acceptOrgInvite } from "../../state/org.js";
import { buildTouchCode, importTouchCode, orgOptions } from "../../state/touch.js";
import { vaultCatchAttr } from "./vaultDrag.js";
import { openVaultItem } from "../../state/vaultRegistry.js";
import { addAtomToHome } from "../../state/onePage.js";
import { fileRefOf, stageFromFiles, stageFromPicker, type StagedFile } from "../../lib/fileChannel.js";

function sizeText(n?: number): string {
  if (!n || n <= 0) return "文件";
  if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + " MB";
  return Math.max(1, Math.round(n / 1024)) + " KB";
}

function itemSub(it: VaultItem): string {
  const type = VAULT_TYPE_LABEL[it.type] ?? it.type;
  const extra = it.sub ?? (it.atom ? `${it.atom.kind} · ${it.atom.key}` : it.file?.name ?? "");
  return extra ? `${type} · ${extra}` : type;
}

/** 一条清单项也可再次拖走（换成另一个箱子/以后拖去白板）。 */
function ItemRow({ it, onRemove, onOpen }: { it: VaultItem; onRemove: () => void; onOpen: () => void }): ReactNode {
  return (
    <div className="vault-item-in" data-vault-catch={vaultCatchAttr({ type: it.type, title: it.title, sub: it.sub, atom: it.atom, text: it.text, file: it.file, board: it.board, payload: it.payload, source: it.source })}>
      <Row
        flush
        title={it.title}
        sub={itemSub(it)}
        onClick={onOpen}
        trailing={
          <span className="vault-actions">
            {it.atom ? (
              <Btn variant="ghost" size="sm" onClick={() => {
                const r = addAtomToHome(`${it.atom!.kind}|${it.atom!.key}`);
                showToast(r.added ? "已放进首页" : r.reason === "duplicate" ? "首页已经有这一项了" : "放进首页失败");
              }}>放进首页</Btn>
            ) : null}
            <Btn variant="ghost" size="sm" onClick={onRemove}>移除</Btn>
          </span>
        }
      />
    </div>
  );
}

export function VaultPage(): ReactNode {
  useSyncExternalStore(subscribeVault, vaultSnapshot, vaultSnapshot);
  const { navigate } = useApp();
  const box = activeVault();
  const all = vaultSnapshot().boxes;
  const [code, setCode] = useState<string>(box.lastShareCode ?? "");
  const [busy, setBusy] = useState(false);
  const [fileHot, setFileHot] = useState(false);
  const [cloudReady, setCloudReady] = useState(false);
  const [cloudChecked, setCloudChecked] = useState(false);
  const [nfc, setNfc] = useState<{ available: boolean; enabled: boolean }>({ available: false, enabled: false });
  const [nfcReading, setNfcReading] = useState(false);
  const [shareInfo, setShareInfo] = useState<VaultSharePayload | null>(null);
  const [touchCode, setTouchCode] = useState("");

  useEffect(() => {
    const last = activeVault().lastShareCode ?? "";
    setCode(last);
    setShareInfo(null);
    if (last) void decodeShareAsync(last).then((d) => setShareInfo(d.payload ?? null));
  }, [box.id]);
  useEffect(() => { void installVaultCloudAdapter().then((ok) => { setCloudReady(ok); setCloudChecked(true); }); }, []);
  useEffect(() => { void nfcStatus().then((s) => setNfc({ available: s.available, enabled: s.enabled })); }, []);

  const addStaged = useCallback((files: StagedFile[]): void => {
    let ok = 0;
    let dup = 0;
    for (const f of files) {
      const r = addToVault({ type: "file", title: f.name, sub: `${sizeText(f.size)} · ${f.mime}`, file: fileRefOf(f), source: "文件" });
      if (r.ok) ok++;
      else if (r.reason === "duplicate") dup++;
    }
    if (ok) showToast(`已收进暂存箱：${ok} 个文件`);
    else if (dup) showToast("这些文件已经在暂存箱里了（按内容指纹去重）");
  }, []);

  const pickFilesToVault = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      addStaged(await stageFromPicker(true));
    } catch (e) {
      showToast(`文件读取失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [addStaged]);

  const rename = useCallback(async (): Promise<void> => {
    const f = await openFormModal("重命名暂存箱", [{ key: "name", label: "名字", required: true, default: box.name }]);
    if (f?.name) renameVault(box.id, f.name);
  }, [box.id, box.name]);

  const makeTouch = useCallback(async (): Promise<void> => {
    if (!cloudReady && !allowInlineShare()) {
      showToast("本版本要求先连接清华云盘，再生成碰一碰口令");
      return;
    }
    const orgs = orgOptions();
    const f = await openFormModal("碰一碰 / 组合分享", [
      { key: "vault", label: "带上当前暂存箱", kind: "select", options: [{ value: "yes", label: "是" }, { value: "no", label: "否" }] },
      { key: "personal", label: "带上我的个人名片", kind: "select", options: [{ value: "yes", label: "是" }, { value: "no", label: "否" }] },
      {
        key: "org", label: "带上组织名片", kind: "select",
        options: [{ value: "", label: "不带" }, ...orgs.map((o) => ({ value: o.id, label: o.name }))],
      },
    ]);
    if (!f) return;
    setBusy(true);
    try {
      const r = await buildTouchCode({
        withVault: f.vault !== "no",
        withPersonal: f.personal !== "no",
        withOrgId: f.org || undefined,
      });
      setTouchCode(r.code);
      try { await navigator.clipboard.writeText(r.code); showToast("碰一碰口令已生成并复制（NFC 接入前用口令/二维码代替）"); }
      catch { showToast("碰一碰口令已生成：复制下方文本"); }
    } catch (e) {
      showToast(`组合分享生成失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  const receiveTouch = useCallback(async (): Promise<void> => {
    const f = await openFormModal("接收碰一碰", [{ key: "code", label: "碰一碰口令（ONTOUCH1.…）", kind: "textarea", required: true }]);
    if (!f?.code) return;
    setBusy(true);
    try {
      const r = await importTouchCode(f.code);
      if (!r.ok) { showToast(r.reason ?? "口令无法导入"); return; }
      const parts = [r.vault ? "暂存箱" : "", r.contact ? "名片" : "", r.org ? "组织" : ""].filter(Boolean).join(" / ");
      showToast(`已接收：${parts}`);
    } finally {
      setBusy(false);
    }
  }, []);

  const shareNfc = useCallback(async (): Promise<void> => {
    const payloadText = touchCode || code;
    if (!payloadText) { showToast("先生成碰一碰/分享口令，再用 NFC 发送"); return; }
    setBusy(true);
    try {
      await nfcShareText(payloadText);
      showToast("NFC 发送已就绪：让对方手机贴近本机（双方 NFC 开启）");
    } catch (e) {
      showToast(`NFC 发送失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [touchCode, code]);

  const receiveText = useCallback(async (text: string): Promise<void> => {
    const t = text.trim();
    if (t.startsWith("ONTOUCH1.")) {
      const r = await importTouchCode(t);
      showToast(r.ok ? "碰一碰内容已接收" : r.reason ?? "碰一碰口令无法导入");
      return;
    }
    if (t.startsWith("ONV1.") || t.startsWith("ONV2.")) {
      const r = await importShareCodeAsCurrent(t);
      showToast(r.ok ? `已导入 ${r.imported ?? 0} 项` : r.reason ?? "口令无法导入");
      return;
    }
    if (t.startsWith("ONORG1.")) {
      const r = acceptOrgInvite(t);
      showToast(r.ok ? "已加入组织（本地成员清单）" : r.reason ?? "组织邀请无法识别");
      return;
    }
    showToast("这不是 OneTHU 的分享/碰一碰/组织口令");
  }, []);

  const scanQr = useCallback(async (): Promise<void> => {
    try {
      if (!qrScanSupported()) { showToast("当前环境不支持二维码识别"); return; }
      const f = await pickFile();
      if (!f) return;
      if (!f.mime.startsWith("image/")) { showToast("请选择一张二维码图片"); return; }
      setBusy(true);
      const bytes = await fileToBytes(f, 8 * 1024 * 1024);
      const img = new File([bytes], f.name, { type: f.mime });
      const text = await decodeQrFile(img);
      if (!text) { showToast("图片里没有识别到二维码"); return; }
      await receiveText(text);
    } catch (e) {
      showToast(`扫码失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [receiveText]);

  const readNfc = useCallback(async (): Promise<void> => {
    setBusy(true);
    setNfcReading(true);
    try {
      const text = (await nfcReadText()).trim();
      if (!text) { showToast("NFC 没有读到内容"); return; }
      await receiveText(text);
    } catch (e) {
      showToast(`NFC 读取失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
      setNfcReading(false);
    }
  }, [receiveText]);

  const importCode = useCallback(async (): Promise<void> => {
    const f = await openFormModal("导入分享口令", [
      { key: "code", label: "口令（ONV1.…）", kind: "textarea", required: true },
    ]);
    if (!f?.code) return;
    setBusy(true);
    try {
      const r = await importShareCodeAsCurrent(f.code);
      if (r.ok) showToast(`已导入 ${r.imported ?? 0} 项，替换为当前暂存箱`);
      else showToast(r.reason ?? "口令无法导入");
    } finally {
      setBusy(false);
    }
  }, []);

  const share = useCallback(async (): Promise<void> => {
    if (!cloudReady && !allowInlineShare()) {
      showToast("本版本要求先连接清华云盘，再生成分享口令");
      return;
    }
    setBusy(true);
    try {
      const r = await mintShareCode(box);
      setCode(r.code);
      setShareInfo(r.payload);
      try { await navigator.clipboard.writeText(r.code); showToast("口令已生成并复制"); }
      catch { showToast("口令已生成：复制下方文本发送给好友"); }
    } catch (e) {
      showToast(`口令生成失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [box]);

  return (
    <>
      <PageHead title="暂存箱" meta="任何东西都能先放这里：长按/拖动元素进来，或从搜索结果拖入" />
      {cloudChecked && !cloudReady ? (
        <Card>
          <div className="vault-actions">
            <Text slot="label">本版本要求连接清华云盘</Text>
            <Btn variant="solid" tone="brand" size="sm" onClick={() => navigate("cloud")}>去连接云盘</Btn>
          </div>
          <Text slot="micro" tone="faint">文件与分享口令依赖云盘；未连接时暂存箱只保留本地引用，云分享不可用。</Text>
        </Card>
      ) : null}
      <Card>
        <div className="vault-toolbar">
          <Segment
            value={box.id}
            onChange={(v) => setActiveVault(v)}
            options={all.map((b) => ({ value: b.id, label: `${b.name}（${b.items.length}）` }))}
          />
          <div className="vault-actions">
            <Btn variant="outline" onClick={() => { const b = createVault(); showToast(`已新建「${b.name}」`); }}>新建</Btn>
            <Btn variant="ghost" onClick={() => void rename()}>重命名</Btn>
            <Btn variant="ghost" onClick={() => void importCode()} disabled={busy}>导入口令</Btn>
            <Btn variant="outline" onClick={() => void pickFilesToVault()} disabled={busy}>添加文件</Btn>
            <Btn variant="ghost" onClick={() => void makeTouch()} disabled={busy}>碰一碰组合</Btn>
            <Btn variant="ghost" onClick={() => void receiveTouch()} disabled={busy}>收碰一碰</Btn>
            <Btn variant="ghost" onClick={() => void scanQr()} disabled={busy}>扫码接收</Btn>
            <Btn className={nfcReading ? "vault-nfc-reading" : undefined} variant="ghost" onClick={() => void readNfc()} disabled={busy || !nfc.available} titleAttr={nfc.available ? (nfc.enabled ? "贴一下 NFC 标签或对方手机" : "NFC 未开启：到系统设置打开") : "NFC 仅 Android 手机可用"}>{nfcReading ? "贴近中…" : "NFC 接收"}</Btn>
            <Text slot="micro" tone="faint">{nfc.available ? (nfc.enabled ? "NFC 可用" : "NFC 未开启") : "NFC 仅手机端"}</Text>
            <Btn variant="solid" tone="brand" onClick={() => void share()} disabled={busy || box.items.length === 0} titleAttr={cloudReady ? "生成云分享口令" : "先连接清华云盘"}>生成口令</Btn>
            <Text slot="micro" tone="faint">{cloudReady ? "云分享" : "本地口令"}</Text>
          </div>
        </div>
        {code ? (
          <div className="vault-share">
            <Text slot="micro" tone="faint">把这段口令发给好友，或在另一台 OneTHU 里「导入口令」：</Text>
            <code className="vault-share-code">{code}</code>
            <div className="vault-qr"><QRCodeSVG value={code} size={240} /></div>
            <div className="vault-actions">
              <Btn variant="ghost" size="sm" onClick={() => void navigator.clipboard.writeText(code).catch(() => undefined)}>复制</Btn>
              <Btn variant="ghost" size="sm" onClick={() => setCode("")}>收起</Btn>
              {shareInfo?.cloud?.shareToken ? (
                <Btn variant="ghost" size="sm" tone="error" onClick={() => {
                  void revokeShare(shareInfo).then((ok) => {
                    if (ok) { setCode(""); setShareInfo(null); showToast("云分享已撤销"); }
                    else showToast("撤销没有完成：请到云盘确认权限");
                  }).catch((e) => showToast(`撤销失败：${e instanceof Error ? e.message : String(e)}`));
                }}>撤销云分享</Btn>
              ) : null}
            </div>
          </div>
        ) : null}
        <div
          className={"vault-file-drop" + (fileHot ? " is-hot" : "")}
          onDragOver={(e) => { e.preventDefault(); setFileHot(true); }}
          onDragLeave={() => setFileHot(false)}
          onDrop={(e) => {
            e.preventDefault();
            setFileHot(false);
            const files = Array.from(e.dataTransfer.files ?? []);
            if (files.length > 0) void stageFromFiles(files).then(addStaged).catch((err) => showToast(`文件读取失败：${err instanceof Error ? err.message : String(err)}`));
          }}
        >
          <Text slot="label">把文件拖到这里，或点「添加文件」</Text>
          <Text slot="micro" tone="faint">文件只入库引用与内容指纹；同一份文件重复拖入会自动去重。</Text>
        </div>
        {touchCode ? (
          <div className="vault-share">
            <Text slot="micro" tone="faint">碰一碰 / 组合口令（NFC 接入前用这段口令或二维码代替）：</Text>
            <code className="vault-share-code">{touchCode}</code>
            <div className="vault-qr"><QRCodeSVG value={touchCode} size={240} /></div>
            <div className="vault-actions">
              <Btn variant="ghost" size="sm" onClick={() => void navigator.clipboard.writeText(touchCode).catch(() => undefined)}>复制</Btn>
              <Btn variant="ghost" size="sm" onClick={() => void shareNfc()} disabled={!nfc.available || !nfc.enabled}>NFC 发送</Btn>
              <Btn variant="ghost" size="sm" onClick={() => setTouchCode("")}>收起</Btn>
            </div>
          </div>
        ) : null}
        <Text slot="micro" tone="faint">
          提示：搜索结果/首页元素支持长按（手机）或直接拖动（桌面）收进来；选中文字按 ⌘/Ctrl+Shift+S 收纳；
          文件本体通过清华云盘保存。
        </Text>
      </Card>

      <Card>
        {box.items.length === 0 ? (
          <Empty text="暂存箱还是空的。打开搜索，长按任意结果拖到这里试试。" />
        ) : (
          <List divided>
            {box.items.map((it) => (
              <ItemRow
                key={it.id}
                it={it}
                onOpen={() => openVaultItem(it, { navigate: (page, params) => navigate(page as never, params as never), toast: showToast })}
                onRemove={() => removeFromVault(box.id, it.id)}
              />
            ))}
          </List>
        )}
      </Card>

      <div className="vault-footer-actions">
        <Btn variant="ghost" tone="error" onClick={() => {
          void confirmOk(`清空暂存箱「${box.name}」？未分享的内容会立即消失。`).then((ok) => { if (ok) { clearVault(box.id); showToast("已清空"); } });
        }} disabled={box.items.length === 0}>清空</Btn>
        <Btn variant="ghost" onClick={() => {
          void confirmOk(`删除暂存箱「${box.name}」？`).then((ok) => { if (ok) { deleteVault(box.id); showToast("已删除"); } });
        }} disabled={all.length <= 1}>删除此箱</Btn>
      </div>
    </>
  );
}
