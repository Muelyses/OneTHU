/**
 * OneTHU 暂存箱页面（Phase 1）：混合对象清单 + 口令生成/导入 + 拖放收纳。
 *
 * 视觉：沿用 OneGUI（PageHead/Card/List/Row/Btn/Segment/Input），不写私有 chrome；
 * 拖动相关类在 packages/gui/src/recipes/workbench.css，唯一交互层是 vaultDrag.ts。
 */
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Btn, Card, List, Row, Segment, Text } from "@onethu/gui";
import { Empty, PageHead } from "../Layout.js";
import { useApp } from "../../state/context.js";
import { openFormModal } from "../../lib/formModal.js";
import { confirmOk } from "../../lib/confirm.js";
import { showToast } from "../../state/toast.js";
import {
  activeVault, addToVault, clearVault, createVault, deleteVault, renameVault, removeFromVault,
  setActiveVault, subscribeVault, VAULT_TYPE_LABEL, vaultSnapshot, type VaultItem,
} from "../../state/vault.js";
import { decodeShare, importShareCodeAsCurrent, mintShareCode, revokeShare, type VaultSharePayload } from "../../state/vaultShare.js";
import { installVaultCloudAdapter } from "../../state/vaultCloud.js";
import { vaultCatchAttr } from "./vaultDrag.js";
import { openVaultItem } from "../../state/vaultRegistry.js";
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
    <div data-vault-catch={vaultCatchAttr({ type: it.type, title: it.title, sub: it.sub, atom: it.atom, text: it.text, file: it.file, board: it.board, payload: it.payload, source: it.source })}>
      <Row
        flush
        title={it.title}
        sub={itemSub(it)}
        onClick={onOpen}
        trailing={<Btn variant="ghost" size="sm" onClick={onRemove}>移除</Btn>}
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
  const [shareInfo, setShareInfo] = useState<VaultSharePayload | null>(null);

  useEffect(() => {
    const last = activeVault().lastShareCode ?? "";
    setCode(last);
    setShareInfo(last ? decodeShare(last).payload ?? null : null);
  }, [box.id]);
  useEffect(() => { void installVaultCloudAdapter().then(setCloudReady); }, []);

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
            <Btn variant="solid" tone="brand" onClick={() => void share()} disabled={busy || box.items.length === 0}>生成口令</Btn>
            <Text slot="micro" tone="faint">{cloudReady ? "云分享" : "本地口令"}</Text>
          </div>
        </div>
        {code ? (
          <div className="vault-share">
            <Text slot="micro" tone="faint">把这段口令发给好友，或在另一台 OneTHU 里「导入口令」：</Text>
            <code className="vault-share-code">{code}</code>
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
        <Text slot="micro" tone="faint">
          提示：搜索结果/首页元素支持长按（手机）或直接拖动（桌面）收进来；文件本体通过清华云盘保存（下一步接入）。
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
