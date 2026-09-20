/**
 * R20-B3：题干 / 我的作答正文渲染组件（docs 28.10）。
 *
 * 方案：**本地内联沙箱文档**——把服务端 HTML 加工成一份完整 HTML 文档字符串
 * （yktBody.buildYktProblemDoc：sanitize → 加密字体 → KaTeX → 图片加固），塞进
 * `sandbox="allow-scripts"`（**无 allow-same-origin**，opaque origin）的 srcdoc iframe。
 * 选 iframe 而非应用内 WebView 的理由（成本最低且两端一致）：
 *  - 桌面（WebView2 / WKWebView / WebKitGTK）与移动（Android System WebView）对
 *    srcdoc + sandbox + postMessage + document.fonts 支持完全同源，**一套代码两端跑**，
 *    不需要「桌面 iframe / 移动再起一套 WebView 桥」的平台分叉；
 *  - 内容是外部平台 HTML，opaque origin 天然隔离（碰不到应用存储 / Cookie / DOM），
 *    比同源 dangerouslySetInnerHTML 少一整层注入面；
 *  - 高度自适应、图片二次代理、字体失效强刷全部走 postMessage 与父组件通信。
 *
 * 降级链（永不白屏，任一环失败都只降级该环）：
 *  1. katex 加载 / 单公式解析失败 → 原样保留 $…$ 原文（yktKatex + safeRender）；
 *  2. 加密字体拿不到（404 / 超时 / 退避窗口 / 非字体 magic）→ stripEncryptedFontClass
 *     剥加密 span，普通字体显示原文（宁错字不丢字）；
 *  3. 字体挂上了但 iframe 内 document.fonts 校验失败 → force 重取一次，仍失败保持剥 class 形态；
 *  4. 图片直挂失败 → fetch_binary 带 Referer/Cookie 代理重试一次 → 仍失败占位框 + 文件名。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  YKT_DOC_BASE,
  YKT_FRAME_MIN_H,
  buildYktProblemDoc,
  clampDocHeight,
  needsEncryptedFont,
} from "../../lib/yktBody.js";
import { fetchYktImageAsDataUrl, loadYktFont } from "../../lib/yktAssets.js";
import { loadYktLatexBundle, type YktLatexBundle } from "../../lib/yktKatex.js";
import { openExternal } from "../../pages/info/openExternal.js";

export interface ProblemBodyProps {
  /** 服务端 HTML（题干 bodyHtml / 我的作答 contentHtml / 作业说明 description） */
  html: string;
  /** 整卷加密字体 URL（YkExerciseDetail.fontUrl；缺省 = 放弃字体，直接剥 class 兜底） */
  fontUrl?: string;
  /** 雨课堂会话 Cookie（字体下载与图片代理用；不向非雨课堂域附加） */
  cookies: string;
  /** 无障碍标题（iframe title） */
  title?: string;
  className?: string;
}

/** 文档内发来的消息（与 yktBody.YKT_DOC_SCRIPT_TEMPLATE 一一对应） */
interface YktDocMessage {
  type?: string;
  h?: unknown;
  src?: unknown;
  href?: unknown;
  dataUrl?: unknown;
}

export function ProblemBody({ html, fontUrl, cookies, title = "题目内容", className }: ProblemBodyProps) {
  const [doc, setDoc] = useState("");
  const [height, setHeight] = useState(YKT_FRAME_MIN_H);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  /** 当前生效的 katex 产物（渲染器 + 内联样式；字体强刷重建文档时复用，避免二次加载） */
  const bundleRef = useRef<YktLatexBundle | null>(null);
  /** 构建序号：html/fontUrl 变更后，旧异步结果一律作废 */
  const buildSeq = useRef(0);
  /** 字体强刷只许一次（防「缓存坏 → 强刷 → 又坏」打转） */
  const fontRetried = useRef(false);

  /** 用当前入参 + 已加载的渲染器/字体重建文档（初建与强刷共用；调用方先核对 buildSeq） */
  const rebuild = useCallback(
    (fontDataUrl: string | undefined) => {
      setDoc(
        buildYktProblemDoc({
          html,
          fontDataUrl,
          render: bundleRef.current?.render,
          extraCss: bundleRef.current?.inlineCss,
        }),
      );
      setHeight(YKT_FRAME_MIN_H);
    },
    [html],
  );

  /* 首建：渲染器与字体并行取，任一失败各自降级，不影响另一环 */
  useEffect(() => {
    const seq = ++buildSeq.current;
    fontRetried.current = false; // 新一轮构建重置强刷额度（每份文档允许一次 force 重取）
    const fu = fontUrl; // 局部别名：闭包内窄化（fontUrl?: string）
    void (async () => {
      const [bundle, font] = await Promise.all([
        html.includes("$") ? loadYktLatexBundle() : Promise.resolve(null),
        fu && needsEncryptedFont(html) ? loadYktFont(fu, { cookies }) : Promise.resolve(null),
      ]);
      if (seq !== buildSeq.current) return; // 期间入参已变，丢弃
      bundleRef.current = bundle;
      rebuild(font?.dataUrl);
    })();
  }, [html, fontUrl, cookies, rebuild]);

  /* 文档 → 组件消息：高度 / 图片失败代理 / 字体校验强刷 / 链接外开 */
  useEffect(() => {
    const onMsg = (ev: MessageEvent): void => {
      if (ev.source !== frameRef.current?.contentWindow) return; // 只认自己的 iframe
      const d = (ev.data ?? {}) as YktDocMessage;
      if (typeof d.type !== "string") return;
      if (d.type === "ykt:height") {
        setHeight(clampDocHeight(d.h));
        return;
      }
      if (d.type === "ykt:img-fail" && typeof d.src === "string") {
        const src = d.src;
        // 图片二次机会：fetch_binary 带 Referer/Cookie 代理（无 CORS 限制）
        fetchYktImageAsDataUrl(src, cookies)
          .then((dataUrl) => {
            frameRef.current?.contentWindow?.postMessage({ type: "ykt:img-data", src, dataUrl }, "*");
          })
          .catch(() => {
            frameRef.current?.contentWindow?.postMessage({ type: "ykt:img-giveup", src }, "*");
          });
        return;
      }
      if (d.type === "ykt:font-fail") {
        // 字体挂上了但 iframe 内校验失败（缓存污染 / CDN 换 key）：force 绕缓存重取一次
        if (!fontUrl || fontRetried.current) return;
        fontRetried.current = true;
        const seq = buildSeq.current;
        void loadYktFont(fontUrl, { force: true, cookies }).then((f) => {
          if (seq === buildSeq.current && f) rebuild(f.dataUrl);
          // f 为空：维持现状（若初建就没字体，文档已是剥 class 的兜底形态）
        });
        return;
      }
      if (d.type === "ykt:link" && typeof d.href === "string") {
        const href = d.href.trim();
        if (!href) return;
        try {
          const abs = new URL(href, YKT_DOC_BASE);
          if (abs.protocol === "http:" || abs.protocol === "https:") void openExternal(abs.toString());
        } catch {
          /* 相对地址解析失败 → 忽略（不外开非法链接） */
        }
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [cookies, fontUrl, rebuild]);

  if (!html) return null;
  return (
    <div className={className}>
      <iframe
        ref={frameRef}
        title={title}
        sandbox="allow-scripts"
        srcDoc={doc}
        loading="lazy"
        style={{ width: "100%", height, border: 0, display: "block", background: "transparent" }}
      />
    </div>
  );
}
