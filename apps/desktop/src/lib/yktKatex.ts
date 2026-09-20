/**
 * R20-B3：KaTeX 渲染器懒加载胶水（vendor/katex → yktBody.LatexRender 签名适配）。
 *
 * 设计：
 *  - 动态 import → Vite 单独分包，**不含 $ 的作业一个字节都不加载**（katex.mjs + 内联
 *    CSS 合计约 1MB，不该摊到每个详情页）；
 *  - 进程内记忆：首个含公式的题干触发一次加载，之后同卷其余题目复用；
 *  - 加载失败（异常包 / 资源损坏）→ 返回 null：renderLatexInHtml 对 null 渲染结果
 *    逐段按字面保留 $…$ 原文，绝不白屏（降级链第三环）；
 *  - renderToString 用 throwOnError: true —— 单个公式解析失败抛错，由 yktBody.safeRender
 *    捕获后**该段**回退原文，同文档其余公式照常渲染（细粒度降级）；
 *  - trust: false：不信任输入里的 \href \url 等外链命令（题干是外部平台内容，
 *    公式不该成为第二个链接通道）。
 */
import type { LatexRender } from "./yktBody.js";

type KatexModule = typeof import("../vendor/katex/katex.mjs");

/** 一次懒加载的完整产物：渲染器 + srcdoc 注入用内联样式（katex CSS + base64 字体） */
export interface YktLatexBundle {
  render: LatexRender;
  /** vendor/katex/katexInlineCss.ts 的 KATEX_INLINE_CSS（仅含真渲染产物时由
   *  buildYktProblemDoc 拼进文档） */
  inlineCss: string;
}

let cached: Promise<YktLatexBundle | null> | null = null;

/** 加载 KaTeX 与内联样式；失败 resolve null（原文兜底），绝不 reject。 */
export function loadYktLatexBundle(): Promise<YktLatexBundle | null> {
  if (!cached) {
    cached = (async (): Promise<YktLatexBundle | null> => {
      try {
        // 两个大件（katex.mjs ≈ 610KB 源码 / 内联 CSS ≈ 360KB）都走动态 import：
        // Vite 单独分包，无公式作业一个字节都不进主包
        const [mod, cssMod] = await Promise.all([
          import("../vendor/katex/katex.mjs") as Promise<KatexModule>,
          import("../vendor/katex/katexInlineCss.js"),
        ]);
        // 命名导出优先，default（UMD 形态）兜底
        const rts = mod.renderToString ?? mod.default?.renderToString;
        const css = (cssMod as { KATEX_INLINE_CSS?: string }).KATEX_INLINE_CSS;
        if (typeof rts !== "function" || typeof css !== "string") return null;
        const render: LatexRender = (tex: string, displayMode: boolean): string | null =>
          rts(tex, {
            displayMode,
            throwOnError: true, // 单公式失败 → safeRender 捕获 → 该段保留原文
            trust: false, // \href/\url/\includegraphics 一律不展开
            strict: (code: string) => (code === "unknownSymbol" ? "ignore" : "warn"),
            output: "html",
          });
        return { render, inlineCss: css };
      } catch {
        return null;
      }
    })();
    cached.catch(() => undefined); // 防未处理拒绝（内部已全捕获，双保险）
  }
  return cached;
}

/** 仅渲染器（测试 / 只需渲染不需样式的调用方） */
export async function loadYktLatexRender(): Promise<LatexRender | null> {
  return (await loadYktLatexBundle())?.render ?? null;
}

/** 仅供测试重置进程内记忆（生产代码勿调） */
export function resetYktLatexRenderForTest(): void {
  cached = null;
}
