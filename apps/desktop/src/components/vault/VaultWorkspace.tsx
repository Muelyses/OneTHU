/** Drawer and full page share collections, content and exchange actions. */
import { useEffect, useId, useState, useSyncExternalStore, type ReactNode } from "react";
import { Btn, IconBtn, Input, List, Menu, Row, Select, Text, type MenuItem } from "@onethu/gui";
import { IconFile, IconFolder, IconIn, IconMore, IconPlus, IconSearch, IconToday, IconUpload } from "../Icons.js";
import { useApp } from "../../state/context.js";
import { showToast } from "../../state/toast.js";
import { openFormModal } from "../../lib/formModal.js";
import { confirmOk } from "../../lib/confirm.js";
import { fileRefOf, stageFromFiles, stageFromPicker, type StagedFile } from "../../lib/fileChannel.js";
import { addToVault, clearVault, createVault, deleteVault, removeFromVault, renameVault, setActiveVault, subscribeVault, vaultSnapshot, type VaultItem } from "../../state/vault.js";
import { installVaultCloudAdapter } from "../../state/vaultCloud.js";
import { useSeafile } from "../../state/seafile.js";
import { openVaultItem } from "../../state/vaultRegistry.js";
import { addAtomToHome } from "../../state/onePage.js";
import { useOverlayBack } from "../../state/navStack.js";
import { vaultCatchAttr } from "./vaultDrag.js";
import { VaultExchangeActions } from "./VaultExchangeActions.js";
import { IssuedSharesCard } from "./IssuedSharesCard.js";

const TYPE_NAMES = { atom: "快捷入口", text: "文字", file: "文件", "board-item": "白板组件", payload: "已存内容" };
function sizeText(size?: number): string {
  if (!size) return "文件";
  return size >= 1024 * 1024 ? `${(size / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;
}
function itemSummary(item: VaultItem): string {
  if (item.file) return [sizeText(item.file.size), item.source].filter(Boolean).join(" · ");
  if (item.text) return item.text.replace(/\s+/g, " ").slice(0, 100);
  return [TYPE_NAMES[item.type], item.source].filter(Boolean).join(" · ");
}
function itemIcon(item: VaultItem): ReactNode {
  return item.type === "file" ? <IconFile /> : item.type === "text" ? <IconToday /> : item.type === "atom" ? <IconFolder /> : <IconIn />;
}

export function VaultWorkspace({ compact = false, onNavigate }: { compact?: boolean; onNavigate?: () => void }): ReactNode {
  const doc = useSyncExternalStore(subscribeVault, vaultSnapshot, vaultSnapshot);
  const box = doc.boxes.find(entry => entry.id === doc.activeId) ?? doc.boxes[0]!;
  const { navigate } = useApp();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [fileHot, setFileHot] = useState(false);
  const [cloudReady, setCloudReady] = useState<boolean | null>(null);
  const { configured: cloudConfigured } = useSeafile();
  const [boxMenu, setBoxMenu] = useState<HTMLElement | null>(null);
  const [itemMenu, setItemMenu] = useState<{ anchor: HTMLElement; item: VaultItem; boxId: string } | null>(null);
  const overlayId = useId();
  useOverlayBack(`vault-box-menu-${overlayId}`, !!boxMenu, () => setBoxMenu(null));
  useOverlayBack(`vault-item-menu-${overlayId}`, !!itemMenu, () => setItemMenu(null));
  useEffect(() => { let active = true; void installVaultCloudAdapter().then(ok => { if (active) setCloudReady(ok); }).catch(() => { if (active) setCloudReady(false); }); return () => { active = false; }; }, [cloudConfigured]);
  useEffect(() => { setQuery(""); setBoxMenu(null); setItemMenu(null); }, [box.id]);
  const go = (page: string, params?: unknown): void => { onNavigate?.(); navigate(page as never, params as never); };
  const openItem = (item: VaultItem): void => {
    // The document viewer owns its own window; leave the manager before opening it.
    if (item.type === "file" && item.file) onNavigate?.();
    openVaultItem(item, { navigate: go, toast: showToast });
  };
  const addFiles = async (read: () => Promise<StagedFile[]>): Promise<void> => {
    if (busy) return;
    const targetId = box.id, targetName = box.name;
    setBusy(true);
    try {
      const files = await read();
      if (!files.length) return;
      if (!vaultSnapshot().boxes.some(entry => entry.id === targetId)) throw new Error("原暂存箱已删除，请重新添加文件");
      let added = 0;
      for (const file of files) if (addToVault({ type: "file", title: file.name, file: fileRefOf(file), source: "文件" }, targetId).ok) added++;
      showToast(added ? `已将 ${added} 个文件放入「${targetName}」` : "这些文件已经在箱子里了");
    } catch (error) { showToast(error instanceof Error ? error.message : "文件读取失败，请重试"); }
    finally { setBusy(false); }
  };
  const create = async (): Promise<void> => {
    const form = await openFormModal("新建暂存箱", [{ key: "name", label: "箱子名称", required: true, default: "新暂存箱" }]);
    if (form?.name?.trim()) createVault(form.name);
  };
  const rename = async (): Promise<void> => {
    const form = await openFormModal("重命名暂存箱", [{ key: "name", label: "箱子名称", required: true, default: box.name }]);
    if (form?.name?.trim()) renameVault(box.id, form.name);
  };
  const boxActions: MenuItem[] = [
    { id: "rename", label: "重命名", onSelect: () => void rename() }, "separator",
    { id: "clear", label: "清空内容", danger: true, disabled: !box.items.length, onSelect: () => { void confirmOk(`清空「${box.name}」的 ${box.items.length} 项内容？已发出的口令需单独撤销。`).then(ok => { if (ok) clearVault(box.id); }); } },
    { id: "delete", label: "删除此箱", danger: true, disabled: doc.boxes.length <= 1, onSelect: () => { void confirmOk(`删除「${box.name}」及其中的内容？已发出的口令需单独撤销。`).then(ok => { if (ok) deleteVault(box.id); }); } },
  ];
  const itemActions: MenuItem[] = itemMenu ? [
    ...(itemMenu.item.atom ? [{ id: "home", label: "放进首页", onSelect: () => {
      const atom = itemMenu.item.atom!;
      const result = addAtomToHome(`${atom.kind}|${atom.key}`);
      showToast(result.added ? "已放进首页" : result.reason === "duplicate" ? "首页已经有这一项了" : "暂时无法放进首页");
    } }] : []),
    ...(itemMenu.item.text ? [{ id: "copy", label: "复制文字", onSelect: () => { void navigator.clipboard.writeText(itemMenu.item.text!).then(() => showToast("文字已复制")).catch(() => showToast("复制失败，请打开内容后手动复制")); } }] : []),
    ...(doc.boxes.length > 1 ? [{ id: "move", label: "移到其他箱子", onSelect: () => {
      const target = itemMenu;
      void openFormModal("移动暂存项", [{ key: "box", label: "目标暂存箱", kind: "select", options: doc.boxes.filter(entry => entry.id !== target.boxId).map(entry => ({ value: entry.id, label: entry.name })) }]).then(form => {
        if (!form?.box) return;
        const result = addToVault(target.item, form.box);
        if (result.ok || result.reason === "duplicate") { removeFromVault(target.boxId, target.item.id); showToast("已移动到所选暂存箱"); }
        else showToast("目标暂存箱已不存在，请重试");
      });
    } }] : []),
    { id: "remove", label: "移除", danger: true, onSelect: () => { removeFromVault(itemMenu.boxId, itemMenu.item.id); showToast("已从暂存箱移除"); } },
  ] : [];
  const term = query.trim().toLocaleLowerCase();
  const visible = box.items.filter(item => !term || `${item.title} ${item.text ?? ""} ${item.source ?? ""} ${item.file?.name ?? ""}`.toLocaleLowerCase().includes(term));

  return <section className={`vault-workspace${compact ? " is-compact" : ""}`} aria-label="暂存箱内容管理">
    <aside className="vault-collections" aria-label="我的暂存箱列表">
      <div className="vault-collections-heading"><Text slot="micro" tone="faint">我的箱子</Text><IconBtn label="新建暂存箱" icon={<IconPlus />} onClick={() => void create()} /></div>
      <div className="vault-collections-list">{doc.boxes.map(entry => <Btn key={entry.id} className="vault-collection" selected={entry.id === box.id} aria-pressed={entry.id === box.id} onClick={() => setActiveVault(entry.id)} icon={<IconIn />} titleAttr={entry.name}><span>{entry.name}</span><small>{entry.items.length}</small></Btn>)}</div>
      <div className="vault-collections-note"><IconIn /><Text slot="micro" tone="faint">先收好，需要时再打开、分享或交给小OH。</Text></div>
    </aside>
    <div className="vault-workspace-main">
      <div className="vault-mobile-collections"><Select aria-label="切换暂存箱" value={box.id} onChange={setActiveVault} options={doc.boxes.map(entry => ({ value: entry.id, label: `${entry.name} · ${entry.items.length}` }))} /><IconBtn label="新建暂存箱" icon={<IconPlus />} onClick={() => void create()} /><IconBtn label="暂存箱操作" aria-haspopup="menu" aria-expanded={!!boxMenu} icon={<IconMore />} onClick={event => setBoxMenu(event.currentTarget)} /></div>
      <header className="vault-collection-head"><div><Text slot="micro" tone="faint">当前暂存箱</Text><h2>{box.name}</h2><Text slot="micro" tone="faint">{box.items.length ? `${box.items.length} 项内容，随时取用` : "把想留住的内容放进来"}</Text></div><IconBtn label="暂存箱操作" aria-haspopup="menu" aria-expanded={!!boxMenu} icon={<IconMore />} onClick={event => setBoxMenu(event.currentTarget)} /></header>
      <div className="vault-primary-actions vault-action-row"><Btn variant="outline" icon={<IconPlus />} onClick={() => void addFiles(() => stageFromPicker(true))} loading={busy}>添加文件</Btn><VaultExchangeActions box={box} /></div>
      <div className="vault-search-row"><Input type="search" icon={<IconSearch />} value={query} onChange={setQuery} placeholder="查找箱内内容" aria-label="查找箱内内容" /><Text slot="micro" tone="faint">{visible.length} 项</Text></div>
      <div className={`vault-contents vault-file-drop${fileHot ? " is-hot" : ""}`} onDragOver={event => { if (Array.from(event.dataTransfer.types).includes("Files")) { event.preventDefault(); event.stopPropagation(); setFileHot(true); } }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFileHot(false); }} onDrop={event => {
        const files = Array.from(event.dataTransfer.files); if (!files.length) return;
        event.preventDefault(); event.stopPropagation(); setFileHot(false); window.dispatchEvent(new Event("onethu:vault-file-drop-handled"));
        void addFiles(() => stageFromFiles(files));
      }}>
        {visible.length ? <List className="vault-content-list" divided>{visible.map(item => <div className="vault-item-in" key={item.id} data-vault-catch={vaultCatchAttr(item)}><Row flush leading={<span className={`vault-item-symbol is-${item.type}`}>{itemIcon(item)}</span>} title={item.title} sub={itemSummary(item)} titleAttr={item.title} onClick={() => openItem(item)} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); openItem(item); } }} trailing={<IconBtn label={`更多操作：${item.title}`} icon={<IconMore />} onClick={event => { event.stopPropagation(); setItemMenu({ anchor: event.currentTarget, item, boxId: box.id }); }} />}/></div>)}</List> : <div className="vault-content-empty"><span className="vault-empty-mark"><IconIn /></span><h3>{term ? "没有找到相关内容" : "先放进来，稍后再处理"}</h3><Text tone="faint">{term ? "试试其他关键词，或查看箱内全部内容。" : "文件、文字和页面入口，都可以收在一起。"}</Text>{term ? <Btn variant="outline" onClick={() => setQuery("")}>清除搜索</Btn> : <Text slot="micro" tone="faint">长按内容后拖到箱子；电脑也可以直接拖入文件。</Text>}</div>}
        {fileHot ? <div className="vault-contents-drop"><IconUpload /><b>松手放入「{box.name}」</b></div> : null}
      </div>
      <footer className="vault-workspace-foot"><IssuedSharesCard boxId={box.id} />{cloudReady === false ? <Btn size="sm" variant="ghost" onClick={() => go("cloud")}>连接云盘以分享文件与口令</Btn> : <Text slot="micro" tone="faint">长按收纳 · 拖到 OH 胶囊交给小OH</Text>}</footer>
    </div>
    <Menu open={!!boxMenu} onClose={() => setBoxMenu(null)} anchor={boxMenu ?? undefined} items={boxActions} title={box.name} label="暂存箱操作菜单" />
    <Menu open={!!itemMenu} onClose={() => setItemMenu(null)} anchor={itemMenu?.anchor} items={itemActions} title={itemMenu?.item.title} label="暂存项操作菜单" />
  </section>;
}
