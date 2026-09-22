/**
 * pdf.js v6 的运行时依赖与垫片（R27 手机端 PDF 渲染失败修复）。
 *
 * 背景（2026-09-22 用户实录）：安卓手机预览 PDF 报
 * 「第 x 页渲染失败：n(...).getOrInsertComputed is not a function」。
 *
 * pdfjs-dist v6 的现代构建依赖若干新内核 API：
 *   - `Map/WeakMap.prototype.getOrInsertComputed`（Chromium 137+）
 *   - `Promise.withResolvers`（Chromium 119+）
 *   - `Math.sumPrecise`（ES2026 提案，Chromium 更晚才有）
 * 关键点是它**在渲染阶段**才调用这些 API——`getDocument()` 本身不抛错，所以
 * "解析失败就换 legacy 构建"这条既有兜底永远不会触发，用户看到的是渲染期 TypeError。
 * legacy 构建自带 core-js 垫片，老内核 WebView 可用。
 *
 * R27 补充（2026-09-22，课后练习题-01.pdf）：`Math.sumPrecise` 缺失**不会报错到 UI**，
 * 而是让 pdf.js 的字体翻译逐个字体抛 TypeError 后被吞掉，退化成"用系统字体画编码码位"。
 * 该 PDF 的内嵌子集字体只有 Mac(1,0) cmap，于是整页显示成 MacRoman 符号（`ü Ä ñ ™ ≤`），
 * 只有少数带 ToUnicode 的汉字可读——即用户看到的"大部分乱码、少部分可读"。
 * 本地 A/B 实测：缺该 API 时 pdf.js 用系统字体、画 MacRoman 码位；补上后立刻改用内嵌
 * 字体（合成字体 g_d0_fN + PUA 码位），渲染正常。
 *
 * 两层保险：
 *   ① `hasModernPdfRuntime()` 按能力挑构建（缺 API 时优先 legacy）；
 *   ② `ensurePdfRuntimeShims()` 补最小垫片——即使现代构建已经加载，也不会在渲染期炸。
 *
 * 单独成模块是为了可测：`tools/pdf-runtime-test.mjs` 会先把这些 API 删掉，
 * 再验证垫片语义（手机上无法复现的 bug，只能靠这类断言守）。
 */

type PdfRuntimeProto = {
  getOrInsertComputed?: (key: unknown, cb: (k: unknown) => unknown) => unknown;
  getOrInsert?: (key: unknown, value: unknown) => unknown;
};

type PromiseWithResolvers = {
  withResolvers?: <T>() => { promise: Promise<T>; resolve: (v: T | PromiseLike<T>) => void; reject: (r?: unknown) => void };
};

type MathSumPrecise = {
  sumPrecise?: (items: Iterable<number>) => number;
};

/** 内核是否具备 pdf.js v6 现代构建所需的全部 API（含本模块补上的垫片） */
export function hasModernPdfRuntime(): boolean {
  return (
    typeof (Map.prototype as PdfRuntimeProto).getOrInsertComputed === "function" &&
    typeof (WeakMap.prototype as PdfRuntimeProto).getOrInsertComputed === "function" &&
    typeof (Promise as PromiseWithResolvers).withResolvers === "function" &&
    typeof (Math as MathSumPrecise).sumPrecise === "function"
  );
}

/** 补齐缺失的运行时 API（已存在则不动）。语义按规范实现，走 this.has/get/set 以兼容子类。 */
export function ensurePdfRuntimeShims(): void {
  const install = (proto: object, name: string, value: unknown): void => {
    if (typeof (proto as Record<string, unknown>)[name] === "function") return;
    // defineProperty：默认不可枚举，避免 for...in 遍历到原型上的补丁
    Object.defineProperty(proto, name, { configurable: true, writable: true, value });
  };

  for (const proto of [Map.prototype, WeakMap.prototype]) {
    install(proto, "getOrInsertComputed", function (this: Map<unknown, unknown>, key: unknown, cb: (k: unknown) => unknown) {
      if (this.has(key)) return this.get(key);
      const v = cb(key);
      this.set(key, v);
      return v;
    });
    install(proto, "getOrInsert", function (this: Map<unknown, unknown>, key: unknown, value: unknown) {
      if (this.has(key)) return this.get(key);
      this.set(key, value);
      return value;
    });
  }

  install(Promise, "withResolvers", function <T>() {
    let resolve!: (v: T | PromiseLike<T>) => void;
    let reject!: (r?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  });

  // Neumaier 补偿求和（规范要求比朴素累加更精确）。pdf.js 用它在字体翻译里算累计量，
  // 缺了它会逐字体抛 TypeError 并被吞掉，退化成系统字体渲染（见文件头注释）。
  install(Math, "sumPrecise", function (items: Iterable<number>): number {
    let sum = 0;
    let compensation = 0;
    for (const value of items) {
      if (typeof value !== "number") throw new TypeError("Math.sumPrecise: 元素必须是 number");
      const t = sum + value;
      compensation += Math.abs(sum) >= Math.abs(value) ? sum - t + value : value - t + sum;
      sum = t;
    }
    return sum + compensation;
  });
}
