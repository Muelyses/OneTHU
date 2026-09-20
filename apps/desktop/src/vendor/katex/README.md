# vendor/katex —— R20-B3 题干 LaTeX 离线渲染（katex 0.16.22）

离线自包含内置：题干 / 我的作答里的 `$…$`、`$$…$$` 公式用 KaTeX 在**父文档**渲染成
HTML 字符串，再随内联文档进 `sandbox="allow-scripts"` 的 srcdoc iframe（iframe 是
opaque origin，加载不了应用包内相对资源，所以样式与字体一并以字符串注入）。

| 文件 | 来源 | 说明 |
| --- | --- | --- |
| `katex.mjs` | npm `katex@0.16.22` → `dist/katex.mjs` 原样拷贝 | ESM 入口（组件按需动态 import，Vite 单独分包，无公式的作业零加载） |
| `katex.d.mts` | npm `katex@0.16.22` → `types/katex.d.ts` 原样拷贝改名 | `.mjs` 导入的 TS 类型（官方无 d.mts，内容未动） |
| `katexInlineCss.ts` | 本目录生成脚本产出（勿手改） | `dist/katex.min.css` 把全部 20 个 `@font-face` 的 src 改写为**仅 woff2 的 data:font/woff2;base64**（woff/ttf 段丢弃：Android System WebView / WebView2 / WKWebView / WebKitGTK 全支持 woff2），供 srcdoc 注入 |
| `LICENSE` | npm `katex@0.16.22` → `LICENSE` 原样拷贝 | MIT |

不采用运行时 CDN：一是内网/离线场景直接失效，二是往第三方域发公式内容有泄露疑虑。

## 再生成

```bash
# 在任意可联网处：
npm pack katex@0.16.22
tar xzf katex-0.16.22.tgz
cp package/dist/katex.mjs katex.mjs
cp package/types/katex.d.ts katex.d.mts
cp package/LICENSE LICENSE
# 内联 CSS：用 .tmp-katex/gen-inline-css.mjs 同款脚本（改路径指向 package/）重跑，
# 产物覆盖 katexInlineCss.ts；脚本自带「未内联干净即报错」守卫
```

升级 katex 版本时同步核对：`yktBody.ts` 的 LaTeX 定界扫描、
`katexInlineCss.ts` 生成脚本守卫（`count >= 15`）、`katex.d.mts` 与新版本 API。
