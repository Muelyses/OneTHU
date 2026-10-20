import { t as i18n, msg as i18nMsg, rich as i18nRich, useLocale as useUiLocale } from "../../i18n/index.js";
/** Drawer and full page share collections, content and exchange actions. */
import { useEffect, useId, useState, useSyncExternalStore, type ReactNode } from "react";
import { Btn, IconBtn, Input, List, Menu, Row, Select, Text, type MenuItem } from "@onethu/gui";
import { IconIn, IconMore, IconPlus, IconSearch, IconUpload } from "../Icons.js";
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
import { animateVaultTakeout, vaultCatchAttr } from "./vaultDrag.js";
import { VaultExchangeActions } from "./VaultExchangeActions.js";
import { IssuedSharesCard } from "./IssuedSharesCard.js";
import { VaultItemIcon } from "./VaultItemIcon.js";
import { vaultItemPresentation } from "./vaultItemPresentation.js";

function sizeText(size?: number): string {
  if (!size) return i18n("components.vault.vaultworkspace.39932f24fe11");
  return size >= 1024 * 1024 ? `${(size / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;
}
function itemSummary(item: VaultItem): string {
  if (item.file) return [sizeText(item.file.size), item.source].filter(Boolean).join(" · ");
  if (item.text) return item.text.replace(/\s+/g, " ").slice(0, 100);
  return [vaultItemPresentation(item).label, item.source].filter(Boolean).join(" · ");
}

export function VaultWorkspace({ compact = false, onNavigate }: { compact?: boolean; onNavigate?: () => void }): ReactNode {
  const uiLocale = useUiLocale();

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
  const openItem = (item: VaultItem, source?: HTMLElement): void => {
    const origin = source?.getBoundingClientRect();
    // The document viewer owns its own window; leave the manager before opening it.
    if (item.type === "file" && item.file) onNavigate?.();
    const handled = openVaultItem(item, { navigate: go, toast: showToast });
    if (handled && origin) animateVaultTakeout(item, origin);
  };
  const addFiles = async (read: () => Promise<StagedFile[]>): Promise<void> => {
    if (busy) return;
    const targetId = box.id, targetName = box.name;
    setBusy(true);
    try {
      const files = await read();
      if (!files.length) return;
      if (!vaultSnapshot().boxes.some(entry => entry.id === targetId)) throw new Error(i18n("components.vault.vaultworkspace.04393fb8fdca"));
      let added = 0;
      for (const file of files) if (addToVault({ type: "file", title: file.name, file: fileRefOf(file), source: "文件" }, targetId).ok) added++;
      showToast(added ? i18nMsg("components.vault.vaultworkspace.d7ff9e26df0d", { added: String(added), targetName: String(targetName) }) : i18nMsg("components.vault.vaultworkspace.57588aea6e6a"));
    } catch (error) { showToast(error instanceof Error ? error.message : i18nMsg("components.vault.vaultworkspace.69cb3fb1fdd6")); }
    finally { setBusy(false); }
  };
  const create = async (): Promise<void> => {
    const form = await openFormModal(i18nMsg("components.vault.vaultworkspace.01c3348965f5"), [{ key: "name", label: i18nMsg("components.vault.vaultworkspace.c95ed9f3eec2"), required: true, default: i18n("components.vault.vaultworkspace.4dc6d8e7a87a") }]);
    if (form?.name?.trim()) createVault(form.name);
  };
  const rename = async (): Promise<void> => {
    const form = await openFormModal(i18nMsg("components.vault.vaultworkspace.9797d33f081b"), [{ key: "name", label: i18nMsg("components.vault.vaultworkspace.c95ed9f3eec2"), required: true, default: box.name }]);
    if (form?.name?.trim()) renameVault(box.id, form.name);
  };
  const boxActions: MenuItem[] = [
    { id: "rename", label: i18n("components.vault.vaultworkspace.0d0cbac2eee5"), onSelect: () => void rename() }, "separator",
    { id: "clear", label: i18n("components.vault.vaultworkspace.bc3dd14b898a"), danger: true, disabled: !box.items.length, onSelect: () => { void confirmOk(i18nMsg("components.vault.vaultworkspace.704da93b664d", { name: String(box.name), length: String(box.items.length) })).then(ok => { if (ok) clearVault(box.id); }); } },
    { id: "delete", label: i18n("components.vault.vaultworkspace.5259cc54976d"), danger: true, disabled: doc.boxes.length <= 1, onSelect: () => { void confirmOk(i18nMsg("components.vault.vaultworkspace.496b211080c6", { name: String(box.name) })).then(ok => { if (ok) deleteVault(box.id); }); } },
  ];
  const itemActions: MenuItem[] = itemMenu ? [
    ...(itemMenu.item.atom ? [{ id: "home", label: i18n("components.vault.vaultworkspace.5560decc5a07"), onSelect: () => {
      const atom = itemMenu.item.atom!;
      const result = addAtomToHome(`${atom.kind}|${atom.key}`);
      showToast(result.added ? i18nMsg("components.vault.vaultworkspace.51d8ab62786e") : result.reason === "duplicate" ? i18nMsg("components.vault.vaultworkspace.b96760b70dab") : i18nMsg("components.vault.vaultworkspace.918d44cf93b2"));
    } }] : []),
    ...(itemMenu.item.text ? [{ id: "copy", label: i18n("components.vault.vaultworkspace.29636e43fdb4"), onSelect: () => { void navigator.clipboard.writeText(itemMenu.item.text!).then(() => showToast(i18nMsg("components.vault.vaultworkspace.cd78767c92e6"))).catch(() => showToast(i18nMsg("components.vault.vaultworkspace.abf541ded48d"))); } }] : []),
    ...(doc.boxes.length > 1 ? [{ id: "move", label: i18n("components.vault.vaultworkspace.31fe3c2b0bba"), onSelect: () => {
      const target = itemMenu;
      void openFormModal(i18nMsg("components.vault.vaultworkspace.c05d4e484881"), [{ key: "box", label: i18nMsg("components.vault.vaultworkspace.13a5f3ed956e"), kind: "select", options: doc.boxes.filter(entry => entry.id !== target.boxId).map(entry => ({ value: entry.id, label: entry.name })) }]).then(form => {
        if (!form?.box) return;
        const result = addToVault(target.item, form.box);
        if (result.ok || result.reason === "duplicate") { removeFromVault(target.boxId, target.item.id); showToast(i18nMsg("components.vault.vaultworkspace.4b409085c396")); }
        else showToast(i18nMsg("components.vault.vaultworkspace.1cb589a18057"));
      });
    } }] : []),
    { id: "remove", label: i18n("components.vault.vaultworkspace.6135d4159e89"), danger: true, onSelect: () => { removeFromVault(itemMenu.boxId, itemMenu.item.id); showToast(i18nMsg("components.vault.vaultworkspace.38d4ac4ea494")); } },
  ] : [];
  const term = query.trim().toLocaleLowerCase();
  const visible = box.items.filter(item => !term || `${item.title} ${item.text ?? ""} ${item.source ?? ""} ${item.file?.name ?? ""}`.toLocaleLowerCase().includes(term));

  return <section className={`vault-workspace${compact ? " is-compact" : ""}`} aria-label={i18n("components.vault.vaultworkspace.d9d455b6afd7")}>
    <aside className="vault-collections" aria-label={i18n("components.vault.vaultworkspace.81ded76ddc48")}>
      <div className="vault-collections-heading"><Text slot="micro" tone="faint">{i18n("components.vault.vaultworkspace.7548dfb917ce")}</Text><IconBtn label={i18n("components.vault.vaultworkspace.01c3348965f5")} icon={<IconPlus />} onClick={() => void create()} /></div>
      <div className="vault-collections-list">{doc.boxes.map(entry => <Btn key={entry.id} className="vault-collection" selected={entry.id === box.id} aria-pressed={entry.id === box.id} onClick={() => setActiveVault(entry.id)} icon={<IconIn />} titleAttr={entry.name}><span>{entry.name}</span><small>{entry.items.length}</small></Btn>)}</div>
      <div className="vault-collections-note"><IconIn /><Text slot="micro" tone="faint">{i18n("components.vault.vaultworkspace.564ff4ed9876")}</Text></div>
    </aside>
    <div className="vault-workspace-main">
      <div className="vault-mobile-collections"><Select aria-label={i18n("components.vault.vaultworkspace.6726270958a4")} value={box.id} onChange={setActiveVault} options={doc.boxes.map(entry => ({ value: entry.id, label: `${entry.name} · ${entry.items.length}` }))} /><IconBtn label={i18n("components.vault.vaultworkspace.01c3348965f5")} icon={<IconPlus />} onClick={() => void create()} /><IconBtn label={i18n("components.vault.vaultworkspace.4f17124dd970")} aria-haspopup="menu" aria-expanded={!!boxMenu} icon={<IconMore />} onClick={event => setBoxMenu(event.currentTarget)} /></div>
      <header className="vault-collection-head"><div><Text slot="micro" tone="faint">{i18n("components.vault.vaultworkspace.17fa33d72406")}</Text><h2>{box.name}</h2><Text slot="micro" tone="faint">{box.items.length ? i18n("components.vault.vaultworkspace.105a1b5daf4b", { length: String(box.items.length) }) : i18n("components.vault.vaultworkspace.61924286426a")}</Text></div><IconBtn label={i18n("components.vault.vaultworkspace.4f17124dd970")} aria-haspopup="menu" aria-expanded={!!boxMenu} icon={<IconMore />} onClick={event => setBoxMenu(event.currentTarget)} /></header>
      <div className="vault-primary-actions vault-action-row"><Btn variant="outline" icon={<IconPlus />} onClick={() => void addFiles(() => stageFromPicker(true))} loading={busy}>{i18n("components.vault.vaultworkspace.ad9daebe00dc")}</Btn><VaultExchangeActions box={box} /></div>
      <div className="vault-search-row"><Input type="search" icon={<IconSearch />} value={query} onChange={setQuery} placeholder={i18n("components.vault.vaultworkspace.e2d666e87d74")} aria-label={i18n("components.vault.vaultworkspace.e2d666e87d74")} /><Text slot="micro" tone="faint">{i18nRich("components.vault.vaultworkspace.42e970981c31", { length: visible.length })}</Text></div>
      <div className={`vault-contents vault-file-drop${fileHot ? " is-hot" : ""}`} onDragOver={event => { if (Array.from(event.dataTransfer.types).includes("Files")) { event.preventDefault(); event.stopPropagation(); setFileHot(true); } }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFileHot(false); }} onDrop={event => {
        const files = Array.from(event.dataTransfer.files); if (!files.length) return;
        event.preventDefault(); event.stopPropagation(); setFileHot(false); window.dispatchEvent(new Event("onethu:vault-file-drop-handled"));
        void addFiles(() => stageFromFiles(files));
      }}>
        {visible.length ? <List className="vault-content-list" divided>{visible.map(item => <div className="vault-item-in" key={item.id} data-vault-catch={vaultCatchAttr(item)}><Row flush leading={<span className={`vault-item-symbol is-${item.type}`}><VaultItemIcon item={item} /></span>} title={item.title} sub={itemSummary(item)} titleAttr={item.title} onClick={event => openItem(item, event.currentTarget)} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); openItem(item, event.currentTarget); } }} trailing={<IconBtn label={i18n("components.vault.vaultworkspace.d1cb5866d979", { title: String(item.title) })} icon={<IconMore />} onClick={event => { event.stopPropagation(); setItemMenu({ anchor: event.currentTarget, item, boxId: box.id }); }} />}/></div>)}</List> : <div className="vault-content-empty"><span className="vault-empty-mark"><IconIn /></span><h3>{term ? i18n("components.vault.vaultworkspace.017799558da2") : i18n("components.vault.vaultworkspace.2a6304d5346d")}</h3><Text tone="faint">{term ? i18n("components.vault.vaultworkspace.ab70eecb29dc") : i18n("components.vault.vaultworkspace.45548176eb84")}</Text>{term ? <Btn variant="outline" onClick={() => setQuery("")}>{i18n("components.vault.vaultworkspace.ee32f25f7050")}</Btn> : <Text slot="micro" tone="faint">{i18n("components.vault.vaultworkspace.21b57ecf4c6a")}</Text>}</div>}
        {fileHot ? <div className="vault-contents-drop"><IconUpload /><b>{i18nRich("components.vault.vaultworkspace.e4bbf7bc2d7e", { name: box.name })}</b></div> : null}
      </div>
      <footer className="vault-workspace-foot"><IssuedSharesCard boxId={box.id} />{cloudReady === false ? <Btn size="sm" variant="ghost" onClick={() => go("cloud")}>{i18n("components.vault.vaultworkspace.75d248782548")}</Btn> : <Text slot="micro" tone="faint">{i18n("components.vault.vaultworkspace.124b06b7f26a")}</Text>}</footer>
    </div>
    <Menu open={!!boxMenu} onClose={() => setBoxMenu(null)} anchor={boxMenu ?? undefined} items={boxActions} title={box.name} label={i18n("components.vault.vaultworkspace.dad3c42e9d64")} />
    <Menu open={!!itemMenu} onClose={() => setItemMenu(null)} anchor={itemMenu?.anchor} items={itemActions} title={itemMenu?.item.title} label={i18n("components.vault.vaultworkspace.04d78aa54101")} />
  </section>;
}
