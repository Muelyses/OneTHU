/**
 * OneTHU 暂存箱页面（Phase 1）：混合对象清单 + 口令生成/导入 + 拖放收纳。
 *
 * 视觉：沿用 OneGUI（PageHead/Card/List/Row/Btn/Segment/Input），不写私有 chrome；
 * 拖动相关类在 packages/gui/src/recipes/workbench.css，唯一交互层是 vaultDrag.ts。
 */
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Btn, Card, List, Row, Segment, Text } from "@onethu/gui";
import { Empty, PageHead } from "../Layout.js";
import { openFormModal } from "../../lib/formModal.js";
import { confirmOk } from "../../lib/confirm.js";
import { showToast } from "../../state/toast.js";
import {
  activeVault, clearVault, createVault, deleteVault, renameVault, removeFromVault,
  setActiveVault, subscribeVault, VAULT_TYPE_LABEL, vaultSnapshot, type VaultItem,
} from "../../state/vault.js";
import { importShareCodeAsCurrent, mintShareCode } from "../../state/vaultShare.js";
import { vaultCatchAttr } from "./vaultDrag.js";

function itemSub(it: VaultItem): string {
  const type = VAULT_TYPE_LABEL[it.type] ?? it.type;
  const extra = it.sub ?? (it.atom ? `${it.atom.kind} · ${it.atom.key}` : it.file?.name ?? "");
  return extra ? `${type} · ${extra}` : type;
}

/** 一条清单项也可再次拖走（换成另一个箱子/以后拖去白板）。 */
function ItemRow({ it, onRemove }: { it: VaultItem; onRemove: () => void }): ReactNode {
  return (
    <div data-vault-catch={vaultCatchAttr({ type: it.type, title: it.title, sub: it.sub, atom: it.atom, text: it.text, file: it.file, board: it.board, payload: it.payload, source: it.source })}>
      <Row
        flush
        title={it.title}
        sub={itemSub(it)}
        trailing={<Btn variant="ghost" size="sm" onClick={onRemove}>移除</Btn>}
      />
    </div>
  );
}

export function VaultPage(): ReactNode {
  useSyncExternalStore(subscribeVault, vaultSnapshot, vaultSnapshot);
  const box = activeVault();
  const all = vaultSnapshot().boxes;
  const [code, setCode] = useState<string>(box.lastShareCode ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => { setCode(activeVault().lastShareCode ?? ""); }, [box.id]);

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
            <Btn variant="solid" tone="brand" onClick={() => void share()} disabled={busy || box.items.length === 0}>生成口令</Btn>
          </div>
        </div>
        {code ? (
          <div className="vault-share">
            <Text slot="micro" tone="faint">把这段口令发给好友，或在另一台 OneTHU 里「导入口令」：</Text>
            <code className="vault-share-code">{code}</code>
            <div className="vault-actions">
              <Btn variant="ghost" size="sm" onClick={() => void navigator.clipboard.writeText(code).catch(() => undefined)}>复制</Btn>
              <Btn variant="ghost" size="sm" onClick={() => setCode("")}>收起</Btn>
            </div>
          </div>
        ) : null}
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
              <ItemRow key={it.id} it={it} onRemove={() => removeFromVault(box.id, it.id)} />
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
