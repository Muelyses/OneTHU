import { Btn } from "@onethu/gui";
/**
 * 图片滤镜编辑（需求 8）：预设缩略图横排 + 旋转 + 应用/取消。
 *
 * 交互与性能取舍：
 *  - 预览只跑 ≤720px（`PREVIEW_EDGE`）：切预设、点旋转都要即时，像素循环按这个尺寸
 *    只要几十毫秒；点「应用」时才按 ≤2000px 出成图（`MAX_EDGE`），手机原图也能收得住。
 *  - 缩略图五张各 ≤72px，随旋转一起重算，让横排上的图跟着转，避免「缩略图和预览两个朝向」。
 *  - 滤镜是同步像素运算：点应用前先让「处理中」渲染一帧（await 一个宏任务），
 *    否则大图那几百毫秒会把按钮的忙碌态一起卡住，用户以为没反应。
 *  - 组件自包含（自带样式、portal 到 body），宿主只需要给图源与两个回调。
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  FILTER_PRESETS, MAX_EDGE, PREVIEW_EDGE, applyFilter, applyFilterToCanvas, canvasToDataUrl,
  drawToCanvas, loadImageSource, releaseImage,
  type FilterPreset, type ImageSource, type RotationDeg,
} from "../lib/imageFilters.js";
import { extForMime } from "../lib/attach.js";
import { IconRefresh, IconX } from "./Icons.js";

export interface FilterResult {
  /** 处理后的图（dataURL，默认 JPEG q0.88） */
  dataUrl: string;
  preset: FilterPreset;
  rotate: RotationDeg;
  width: number;
  height: number;
  /** 建议文件名（含预设/旋转后缀与正确扩展名） */
  name: string;
}

export interface ImageFilterSheetProps {
  /** 原图：File / Blob / dataURL / objectURL / 已解码画源 */
  src: Blob | string | ImageSource;
  /** 建议文件名（应用后按它命名） */
  fileName?: string;
  onApply: (r: FilterResult) => void;
  /** 取消：宿主什么都别发（诚实的「没选」） */
  onCancel: () => void;
  /** 成图长边上限（默认 2000） */
  maxEdge?: number;
  /** 成图 MIME（默认 image/jpeg） */
  mime?: string;
  quality?: number;
  title?: string;
}

const ROTATIONS: RotationDeg[] = [0, 90, 180, 270];

function msgOf(e: unknown): string {
  return e instanceof Error && e.message ? e.message : "这一步没做完，请重试";
}

function outputName(base: string | undefined, preset: FilterPreset, rotate: RotationDeg, mime: string): string {
  const raw = (base || "图片").replace(/\.[^.]*$/, "");
  const suffix = `${preset === "original" ? "" : `-${preset}`}${rotate ? `-r${rotate}` : ""}`;
  return `${raw}${suffix}.${extForMime(mime)}`;
}

const SHEET_CSS = `
.ohf-backdrop { position: fixed; inset: 0; z-index: 10050; background: rgba(0, 0, 0, .45);
  display: flex; align-items: flex-end; justify-content: center; }
.ohf-panel { width: 100%; max-width: 560px; max-height: 90vh; overflow: auto;
  background: var(--dsw-alias-bg-layer-1, #fff); color: var(--dsw-alias-label-primary, #1c1f24);
  border-radius: var(--dsw-radius-xl, 20px) var(--dsw-radius-xl, 20px) 0 0;
  border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, .08));
  box-shadow: 0 -12px 40px rgba(0, 0, 0, .28); padding: 16px 16px calc(16px + env(safe-area-inset-bottom, 0px)); }
@media (min-width: 600px) {
  .ohf-backdrop { align-items: center; }
  .ohf-panel { border-radius: var(--dsw-radius-xl, 20px); }
}
.ohf-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ohf-title { font-size: 16px; font-weight: 600; }
.ohf-stage { margin: 12px 0; padding: 8px; border-radius: var(--dsw-radius-md, 12px);
  background: var(--dsw-alias-bg-layer-2, #f4f4f6); display: flex; align-items: center; justify-content: center; }
.ohf-stage img { max-width: 100%; max-height: 36vh; object-fit: contain; border-radius: var(--dsw-radius-sm, 8px); }
.ohf-strip { display: flex; gap: 8px; overflow-x: auto; padding: 4px 0 8px; }
.ohf-thumb { flex: 0 0 auto; width: 72px; padding: 4px; cursor: pointer; text-align: center;
  background: transparent; border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, .1));
  border-radius: var(--dsw-radius-md, 12px); color: inherit; }
.ohf-thumb img { width: 100%; height: 56px; object-fit: cover; border-radius: var(--dsw-radius-xs, 4px); display: block; }
.ohf-thumb span { display: block; font-size: 12px; margin-top: 4px; opacity: .8; }
.ohf-thumb[aria-pressed="true"] { border-color: var(--dsw-alias-brand-primary, #111); }
.ohf-thumb[aria-pressed="true"] span { opacity: 1; font-weight: 600; }
.ohf-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 12px;
  color: var(--dsw-alias-label-secondary, #5c6370); }
.ohf-foot { display: flex; gap: 12px; justify-content: flex-end; margin-top: 12px; }
`;

export function ImageFilterSheet(props: ImageFilterSheetProps): ReactNode {
  const {
    src, fileName, onApply, onCancel, maxEdge = MAX_EDGE, mime = "image/jpeg", quality = 0.88,
    title = "编辑图片",
  } = props;
  const [preset, setPreset] = useState<FilterPreset>("original");
  const [rotate, setRotate] = useState<RotationDeg>(0);
  const [loaded, setLoaded] = useState(false);
  const [preview, setPreview] = useState("");
  const [thumbs, setThumbs] = useState<Array<{ id: FilterPreset; url: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const sourceRef = useRef<ImageSource | null>(null);

  /* ① 装载原图（一次；卸载时把位图内存还回去） */
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const img = await loadImageSource(src);
        if (!alive) {
          releaseImage(img);
          return;
        }
        sourceRef.current = img;
        setLoaded(true);
      } catch (e) {
        if (alive) setErr(msgOf(e));
      }
    })();
    return () => {
      alive = false;
      releaseImage(sourceRef.current);
      sourceRef.current = null;
    };
  }, [src]);

  /* ② 旋转 / 预设变化 → 缩略图与预览（预览尺寸，别跑原图） */
  useEffect(() => {
    const img = sourceRef.current;
    if (!img) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      if (!alive) return;
      try {
        const base = drawToCanvas(img, { maxEdge: PREVIEW_EDGE, rotate });
        setThumbs(FILTER_PRESETS.map((p) => ({ id: p.id, url: applyFilter(base, p.id, { maxEdge: PREVIEW_EDGE }) })));
        setPreview(applyFilter(base, preset, { maxEdge: PREVIEW_EDGE }));
        setErr("");
      } catch (e) {
        setErr(msgOf(e));
      }
    }, 0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [preset, rotate, loaded]);

  /* ③ Esc 退出（不发送任何东西） */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  /** 应用：按全尺寸出图（同步运算，先让忙碌态渲染一帧） */
  const doApply = useCallback(async (): Promise<void> => {
    const img = sourceRef.current;
    if (!img || busy) return;
    setBusy(true);
    setErr("");
    await new Promise((r) => window.setTimeout(r, 16));
    try {
      const full = drawToCanvas(img, { maxEdge, rotate });
      applyFilterToCanvas(full, preset);
      const dataUrl = canvasToDataUrl(full, mime, quality);
      onApply({
        dataUrl,
        preset,
        rotate,
        width: full.width,
        height: full.height,
        name: outputName(fileName, preset, rotate, mime),
      });
    } catch (e) {
      setErr(msgOf(e));
      setBusy(false);
    }
  }, [busy, fileName, maxEdge, mime, onApply, preset, quality, rotate]);

  const info = FILTER_PRESETS.find((p) => p.id === preset);
  const dirty = preset !== "original" || rotate !== 0;
  const note = err
    ? err
    : !loaded
      ? "正在读取图片…"
      : busy
        ? "正在生成，请稍候…"
        : `${info?.hint ?? ""}${rotate ? ` · 已旋转 ${rotate}°` : ""}${dirty ? "" : " · 未改动"}`;

  const panelStyle: CSSProperties = { touchAction: "pan-y" };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="ohf-backdrop" onClick={onCancel} role="presentation">
      <style>{SHEET_CSS}</style>
      <div
        className="ohf-panel"
        style={panelStyle}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ohf-head">
          <span className="ohf-title">{title}</span>
          <Btn variant="outline" onClick={onCancel} aria-label="取消编辑"><IconX /></Btn>
        </div>

        <div className="ohf-stage">
          {preview ? <img src={preview} alt="处理后的预览" /> : <span style={{ fontSize: 12, opacity: 0.7 }}>读取中…</span>}
        </div>

        <div className="ohf-strip" role="group" aria-label="滤镜预设">
          {thumbs.map((t) => {
            const meta = FILTER_PRESETS.find((p) => p.id === t.id);
            return (
              <button
                key={t.id}
                type="button"
                className="ohf-thumb"
                aria-pressed={t.id === preset}
                onClick={() => setPreset(t.id)}
              >
                <img src={t.url} alt={meta?.label ?? t.id} />
                <span>{meta?.label ?? t.id}</span>
              </button>
            );
          })}
        </div>

        <div className="ohf-row">
          <Btn variant="outline" onClick={() => setRotate((r) => ROTATIONS[(ROTATIONS.indexOf(r) + 1) % ROTATIONS.length] ?? 0)}><IconRefresh />旋转 90°
          </Btn>
          <span>{note}</span>
        </div>

        <div className="ohf-foot">
          <Btn variant="outline" onClick={onCancel} disabled={busy}>
            取消
          </Btn>
          <Btn variant="solid" tone="brand" onClick={() => void doApply()} disabled={!loaded || busy || !!err}>{busy ? "处理中…" : "应用"}</Btn>
        </div>
      </div>
    </div>,
    document.body,
  );
}
