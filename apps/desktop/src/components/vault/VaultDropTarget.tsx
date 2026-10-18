/**
 * 常驻「暂存箱」拖放目标：只在拖动开始时出现，避免遮挡底栏/OH 胶囊。
 * 桌面：右下悬浮；手机：底部居中（贴底抽屉之上）。
 */
import { useEffect, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Btn } from "@onethu/gui";
import { IconIn } from "../Icons.js";
import { useApp } from "../../state/context.js";
import { useIsPhone } from "../../state/phoneSheets.js";
import { activeVault, addToVault, vaultSnapshot, subscribeVault } from "../../state/vault.js";
import { stageFromFiles } from "../../lib/fileChannel.js";
import { showToast } from "../../state/toast.js";
import {
  installVaultDragSources, subscribeVaultDrag, vaultDragSnapshot,
} from "./vaultDrag.js";

export function VaultDropTarget(): ReactNode {
  const drag = useSyncExternalStore(subscribeVaultDrag, vaultDragSnapshot, vaultDragSnapshot);
  const vault = useSyncExternalStore(subscribeVault, vaultSnapshot, vaultSnapshot);
  const isPhone = useIsPhone();
  const { navigate } = useApp();
  const [fileDrag, setFileDrag] = useState(false);
  useEffect(() => installVaultDragSources(), []);
  useEffect(() => {
    /* 选中文字 → ⌘/Ctrl+Shift+S 收进暂存箱（文字没有可拖 DOM，给一个快捷入口）。 */
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.key.toLowerCase() !== "s") return;
      const text = window.getSelection?.()?.toString().trim() ?? "";
      if (!text) return;
      e.preventDefault();
      const r = addToVault({ type: "text", title: text.slice(0, 40), sub: text.length > 40 ? `${text.length} 字` : undefined, text: text.slice(0, 4000), source: "选中文字" });
      showToast(r.ok ? "选中文字已收进暂存箱" : "暂存箱里已经有这段文字了");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    const hasFiles = (e: DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const onEnter = (e: DragEvent): void => { if (hasFiles(e)) { e.preventDefault(); setFileDrag(true); } };
    const onOver = (e: DragEvent): void => { if (hasFiles(e)) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"; } };
    const onLeave = (e: DragEvent): void => { if (!e.relatedTarget) setFileDrag(false); };
    const onDrop = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setFileDrag(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      void stageFromFiles(files).then((staged) => {
        let ok = 0;
        for (const f of staged) {
          const r = addToVault({ type: "file", title: f.name, sub: `${f.size} B · ${f.mime}`, file: { name: f.name, size: f.size, mime: f.mime, hash: f.sha256, cloudPath: null, stagedPath: f.localPath }, source: "文件拖入" });
          if (r.ok) ok++;
        }
        showToast(ok ? `已收进暂存箱：${ok} 个文件` : "这些文件已在暂存箱里（按内容指纹去重）");
      }).catch((err) => showToast(`文件读取失败：${err instanceof Error ? err.message : String(err)}`));
    };
    document.addEventListener("dragenter", onEnter);
    document.addEventListener("dragover", onOver);
    document.addEventListener("dragleave", onLeave);
    document.addEventListener("drop", onDrop);
    return () => {
      document.removeEventListener("dragenter", onEnter);
      document.removeEventListener("dragover", onOver);
      document.removeEventListener("dragleave", onLeave);
      document.removeEventListener("drop", onDrop);
    };
  }, []);
  const box = activeVault();
  if (fileDrag) {
    return createPortal(
      <div className="vault-file-overlay">
        <div className="vault-file-overlay-box">
          <IconIn width={28} height={28} />
          <span>松手收进「{box.name}」</span>
          <span className="vault-file-overlay-sub">文件会先算内容指纹，同内容自动去重</span>
        </div>
      </div>,
      document.body,
    );
  }
  return !isPhone ? createPortal(<div className="vault-desktop-anchor"><VaultButton /></div>,document.body) : null;
}

export function VaultButton():ReactNode {
  const drag=useSyncExternalStore(subscribeVaultDrag,vaultDragSnapshot,vaultDragSnapshot);
  const doc=useSyncExternalStore(subscribeVault,vaultSnapshot,vaultSnapshot);
  const box=doc.boxes.find(b=>b.id===doc.activeId)??doc.boxes[0]!;
  const {navigate}=useApp();const [open,setOpen]=useState(false);
  const items=box.items;
  useEffect(()=>{if(!open)return;const key=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpen(false);};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[open]);
  return <div className={"vault-anchor"+(drag.active?" is-transfer":"")+(drag.target==='vault'?" is-hover":"")}>
    <Btn className="vault-box-button" variant="solid" data-vault-drop aria-label={`暂存箱，${items.length} 项`} aria-expanded={open||drag.active} titleAttr="暂存箱 · 长按内容后拖到这里" onClick={()=>setOpen(v=>!v)}><IconIn width={20} height={20}/><span>{items.length||''}</span></Btn>
    {open||drag.active?<div className="vault-radar" role="region" aria-label="暂存箱雷达">
      <span className="vault-radar-scan" aria-hidden="true"/>
      <div className="vault-radar-heading">{drag.active?'存入暂存箱':box.name}<small>{items.length} 项</small></div>
      <div className="vault-orbits">{items.map((item,i)=><span key={item.id} className="vault-orbit" style={{'--orbit-angle':`${i*360/Math.max(1,items.length)}deg`,'--orbit-radius':`${76+(i%3)*24}px`} as CSSProperties}><span title={item.title}>{item.title.slice(0,8)}</span></span>)}</div>
      {!drag.active?<><div className="vault-radar-list">{items.length?items.map(item=><Btn key={item.id} size="sm" data-vault-catch={JSON.stringify(item)} onClick={()=>{navigate('vault');setOpen(false);}}>{item.title}</Btn>):<p>长按内容，再拖到箱子里</p>}</div><Btn variant="solid" size="sm" onClick={()=>{navigate('vault');setOpen(false);}}>打开暂存箱</Btn><Btn size="sm" onClick={()=>setOpen(false)}>收起</Btn></>:<span className="vault-radar-hint">{drag.target==='vault'?'松手收纳':'拖到箱子上松手'}</span>}
    </div>:null}
    {drag.active?createPortal(<div className="transfer-oh-hint">{drag.target==='oh'?'松手发给小OH':'发给小OH'}</div>,document.body):null}
  </div>;
}
