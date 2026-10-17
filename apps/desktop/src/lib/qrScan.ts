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
    /* 某些 WebView 的 detect 可能长时间不 resolve；UI 不能无限转圈。 */
    const codes = await Promise.race([
      detector.detect(bitmap),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
    ]);
    if (codes === null) throw new Error("二维码识别超时：换一张更清晰、留白更多的图再试");
    return codes[0]?.rawValue ?? null;
  } finally {
    bitmap.close();
  }
}
