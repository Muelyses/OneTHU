/**
 * 二维码识别（扫码兜底）：BarcodeDetector + 图片文件。不做实时相机预览，
 * 手机端用系统图片选择器拍照/选截图；桌面端选截图即可。不支持时明确报错。
 */
export interface BarcodeDetectorLike {
  detect(source: ImageBitmapSource): Promise<Array<{ rawValue: string }>>;
}
type Ctor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike;

export function qrScanSupported(): boolean {
  return typeof (globalThis as { BarcodeDetector?: Ctor }).BarcodeDetector === "function";
}

export async function decodeQrFile(file: File): Promise<string | null> {
  const Ctor = (globalThis as { BarcodeDetector?: Ctor }).BarcodeDetector;
  if (!Ctor) throw new Error("当前环境不支持二维码识别（需要较新的系统 WebView）");
  const bitmap = await createImageBitmap(file);
  try {
    const detector = new Ctor({ formats: ["qr_code"] });
    const detect = async (source: ImageBitmapSource): Promise<string | null> => {
      const codes = await Promise.race([
        detector.detect(source),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
      ]);
      return codes === null ? null : (codes[0]?.rawValue ?? null);
    };
    const direct = await detect(bitmap);
    if (direct) return direct;
    /* 截图/多屏截图里的二维码常太小：2 倍放大 + 白底再识别一次。 */
    if (typeof document !== "undefined") {
      const scale = 2;
      const w = Math.min(2048, bitmap.width * scale);
      const h = Math.min(2048, bitmap.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, w, h);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(bitmap, 0, 0, w, h);
        const up = await detect(canvas);
        if (up) return up;
      }
    }
    return null;
  } finally {
    bitmap.close();
  }
}
