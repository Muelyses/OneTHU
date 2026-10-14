import { Btn } from "@onethu/gui";
/**
 * 壁纸库网格（设置→外观 与 页面右键选择器共用，2026-10-13；2026-10-14 单档化）。
 *
 * - variant="panel"：设置里的完整库面板——上传入库、删除、应用、云盘同步/恢复（wallpsync）；
 * - variant="picker"：右键「更换壁纸」弹出的小选择器——点缩略图即应用。
 * 「画布化定案」：壁纸只有全屏一档（壳层绘制，面板/栏体透出它）；点图与角标等效，
 * 本页（per-tab）档已随功能删除。
 * 内置渐变常驻库首且不可删；用户条目上限 12 张（LIBRARY_MAX），满员时上传直接应用不入库。
 */
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  addToLibrary,
  builtinCss,
  displayRef,
  ensureWallpaperLum,
  importWallpaperFile,
  isVideoRef,
  LIBRARY_MAX,
  libraryItems,
  removeFromLibrary,
  setGlobalWallpaper,
  subscribeWallpaper,
  wallpaperSnapshot,
  type LibraryEntry,
} from "../../state/wallpaper.js";
import {
  restoreWallpaperFromCloud,
  syncWallpaperToCloud,
  type WallpSyncResult,
} from "../../state/wallpsync.js";
import { showToast } from "../../state/toast.js";

/** 单格缩略图（图片直接预览；视频出首帧；内置渐变画色块） */
function WallThumb({ entry }: { entry: LibraryEntry }): ReactNode {
  const css = entry.builtin ? builtinCss(entry.ref) : null;
  if (css) return <span className="wall-thumb-fill" style={{ background: css }} />;
  if (isVideoRef(entry.ref)) return <video src={displayRef(entry.ref)} muted preload="metadata" />;
  return <img src={displayRef(entry.ref)} alt="" loading="lazy" />;
}

function WallCell({ entry, variant }: { entry: LibraryEntry; variant: "panel" | "picker" }): ReactNode {
  const doc = useSyncExternalStore(subscribeWallpaper, wallpaperSnapshot, wallpaperSnapshot);
  /* 图片入库/应用后确保亮度采样在跑（纱与栏体文字分支依赖它） */
  useEffect(() => {
    if (!entry.builtin && !isVideoRef(entry.ref)) ensureWallpaperLum(entry.ref);
  }, [entry.builtin, entry.ref]);
  const fullActive = doc.global === entry.ref;
  const apply = (): void => setGlobalWallpaper(entry.ref);
  return (
    <div className="wall-cell">
      <button
        type="button"
        className={"wall-thumb" + (fullActive ? " is-page-active" : "")}
        onClick={apply}
        title={entry.name}
      >
        <WallThumb entry={entry} />
      </button>
      {variant === "panel" ? (
        <button
          type="button"
          className={"wall-chip wall-chip-full" + (fullActive ? " is-on" : "")}
          onClick={apply}
          aria-label={"设为全屏：" + entry.name}
          title="设为全屏"
        >
          全屏
        </button>
      ) : null}
      {variant === "panel" && !entry.builtin ? (
        <button
          type="button"
          className="wall-chip wall-chip-del"
          onClick={() => removeFromLibrary(entry.id)}
          aria-label={"删除：" + entry.name}
          title="从库里删除"
        >
          ✕
        </button>
      ) : null}
      {fullActive ? <span className="wall-dot" title="当前全屏壁纸" /> : null}
      <div className="wall-name">{entry.name}</div>
    </div>
  );
}

export function WallpaperLibrary({
  variant,
  onClose,
}: {
  variant: "panel" | "picker";
  onClose?: () => void;
}): ReactNode {
  const doc = useSyncExternalStore(subscribeWallpaper, wallpaperSnapshot, wallpaperSnapshot);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const pickUpload = (): void => fileRef.current?.click();

  /* 入库（满员只提示不阻断）+ 应用：picker 应用并关闭，panel 入库即可 */
  const onFile = async (f: File): Promise<void> => {
    const r = await importWallpaperFile(f);
    if (!r.ref) {
      showToast(r.error ?? "处理失败，请换一个文件");
      return;
    }
    const name = f.name.replace(/\.[a-z0-9]+$/i, "");
    const full = addToLibrary(r.ref, name);
    if (variant === "picker") {
      setGlobalWallpaper(r.ref);
      onClose?.();
    }
    if (full) showToast(full + (variant === "picker" ? "；已直接应用" : "；已应用不入库"));
  };

  const runSync = async (fn: () => Promise<WallpSyncResult>): Promise<void> => {
    setBusy(true);
    try {
      showToast((await fn()).msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={"wall-lib" + (variant === "picker" ? " wall-lib-picker" : "")}>
      {/* 隐藏文件选择器：图片/视频选中即处理 */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*,video/mp4,video/webm"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void onFile(f);
        }}
      />
      {variant === "picker" ? (
        <div className="wall-picker-head">
          <b>更换壁纸</b>
          <Btn variant="ghost" onClick={onClose} aria-label="关闭">
            关闭
          </Btn>
        </div>
      ) : (
        <div className="wall-lib-ops">
          <Btn variant="outline" onClick={pickUpload}>
            上传入库…
          </Btn>
          <button type="button" className="btn" disabled={busy} onClick={() => void runSync(syncWallpaperToCloud)}>
            同步到云盘
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => void runSync(restoreWallpaperFromCloud)}>
            从云盘恢复
          </button>
          {doc.global ? (
            <button type="button" className="btn btn-ghost" onClick={() => setGlobalWallpaper(null)}>
              清除全屏
            </button>
          ) : null}
        </div>
      )}
      <div className="wall-lib-grid">
        {libraryItems().map((entry) => (
          <WallCell key={entry.id} entry={entry} variant={variant} />
        ))}
      </div>
      {variant === "panel" ? (
        <div className="wall-lib-hint">
          已收 {doc.library.length}/{LIBRARY_MAX} 张；同步含库内图片与视频，恢复会覆盖本机
        </div>
      ) : null}
      {variant === "picker" ? (
        <Btn variant="outline" onClick={pickUpload}>
          上传图片或视频…
        </Btn>
      ) : null}
    </div>
  );
}
