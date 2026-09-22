/**
 * 预览交互护栏（R26）：PDF/pptx **连续滚动** + pptx 真渲染接线 + 旧版 Office 明确提示。
 *
 * 背景（霖 2026-09-22）：
 *  - 「预览界面必须要做成翻页吗？有没有直接滚动的可行性」→ 翻页不是必须，改成连续滚动；
 *  - 「pptx 没法预览」= 看不到渲染好的幻灯片页面（此前只有文字大纲）→ 自写渲染器出真页面。
 *
 * 跑法：node tools/preview-scroll-test.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let pass = 0;
const ok = (cond, label) => {
  assert.ok(cond, label);
  pass++;
  console.log(`  ✓ ${label}`);
};

const read = (p) => readFileSync(new URL(`../apps/desktop/src/${p}`, import.meta.url), "utf8");
const fp = read("components/FilePreview.tsx");
const render = read("lib/pptxRender.ts");
const pkg = JSON.parse(readFileSync(new URL("../apps/desktop/package.json", import.meta.url), "utf8"));

console.log("[1] PDF：翻页 → 连续滚动");
{
  ok(/function PdfPage\(/.test(fp), "抽出单页组件 PdfPage（逐页占位 + 逐页渲染）");
  ok(/overflow: "auto"/.test(fp) && /onScroll=\{onScroll\}/.test(fp), "滚动容器 + 滚动回调（当前页跟随）");
  ok(/active=\{Math\.abs\(no - cur\) <= 2\}/.test(fp), "只渲染当前页 ±2，其余留占位（长讲义不吃满内存）");
  ok(/position: "relative", overflow: "auto"/.test(fp), "滚动容器 position:relative（页码定位用 offsetTop）");
  ok(/Array\.from\(\{ length: doc\.numPages \}/.test(fp), "按总页数铺满全部页面（不再一次只画一页）");
  ok(/scrollTo\(\{ top: Math\.max\(0, node\.offsetTop - 8\)/.test(fp), "页码按钮变成「跳转到该页」（保留快速定位）");
  ok(/适应宽度/.test(fp) && /setZoom/.test(fp), "保留缩放与「适应宽度」");
  ok(/getViewport\(\{ scale: 1 \}\)/.test(fp) && /setRatio\(base\.height \/ base\.width\)/.test(fp), "先用页面宽高比占位，滚动条长度稳定");
  // 旧的"单画布 + pageNo 状态"翻页实现必须已被替换
  ok(!/const \[pageNo, setPageNo\]/.test(fp), "旧的一次只渲染一页的 pageNo 状态已移除");
}

console.log("[1b] PDF：同一 canvas 不得并发 render（霖实测「第 3 页渲染失败」）");
{
  ok(/const taskRef = useRef<\{ cancel: \(\) => void; promise: Promise<void> \} \| null>\(null\)/.test(fp),
    "跟踪在飞的 render task（cancel + promise）");
  ok(/prev\.cancel\(\)/.test(fp) && /await prev\.promise/.test(fp),
    "发起新渲染前：先取消上一次并等它真正结束");
  ok(/taskRef\.current = task;/.test(fp), "新任务登记到 taskRef");
  ok(/const t = taskRef\.current;[\s\S]{0,120}t\.cancel\(\)/.test(fp), "效果清理时取消在飞任务");
  ok(/RenderingCancelledException/.test(fp), "取消异常不弹给用户（不是失败）");
  ok(/render\(o: \{ canvasContext[^)]*\}\): \{ promise: Promise<void>; cancel: \(\) => void \}/.test(fp),
    "PdfPageLike.render 类型带 cancel（pdf.js RenderTask 接口）");
  ok(/setErr\(null\); \/\/ 重新进入渲染窗口/.test(fp), "重新进入渲染窗口清掉上一轮失败提示");
}

console.log("[2] pptx：文字大纲 → 真渲染页面");
{
  ok(/parsePptxModel/.test(fp), "FilePreview 调用 pptx 渲染模型");
  ok(/function PptxSlidesView\(/.test(fp), "存在幻灯片页面视图 PptxSlidesView");
  ok(/data-pptx-page=\{sl\.no\}/.test(fp), "每页渲染为一个页面容器（可断言/可定位）");
  ok(/PPTX_LOGICAL_W = 960/.test(fp) && /transform: `scale\(\$\{k\}\)`/.test(fp), "按逻辑页宽等比缩放适应面板");
  ok(/PptxShapeView/.test(fp) && /position: "absolute"/.test(fp), "形状按几何绝对定位（不是流水线式堆文字）");
  ok(/kind === "image"/.test(fp) && /objectFit: "contain"/.test(fp), "图片按原始位置渲染");
  ok(/kind === "table"/.test(fp), "表格渲染为真实表格");
  ok(/个图表\/对象未渲染/.test(fp), "渲染不了的元素显式提示数量，不静默丢内容");
  ok(/连续滚动查看全部页面/.test(fp), "页面视图说明是连续滚动");
  // 回退链：渲染模型失败 → 文字大纲 → 文件树
  ok(/pptx-outline/.test(fp) && /已回退为文字大纲/.test(fp), "渲染失败退回文字大纲并明说");
  ok(/extractPptxSlides/.test(fp), "大纲回退仍在（不删旧能力）");
  ok(/kind: "zip", zip, office: true, size,/.test(fp), "再失败仍回退内部文件列表 + 下载");
}

console.log("[3] 旧版 Office：明确告知无法预览");
{
  for (const ext of ["ppt", "doc", "xls", "dps", "wps", "et"]) {
    ok(new RegExp(`^\\s*${ext}: "旧版`, "m").test(fp), `.${ext} 有明确的"不支持应用内预览"提示`);
  }
  ok(/hint: LEGACY_OFFICE_HINT\[ext\]/.test(fp), "other 视图带上该提示");
  ok(/view\.hint \?\? "该格式暂不支持在线预览"/.test(fp), "有提示时优先显示明确原因");
}

console.log("[4] 渲染模型自身：零依赖 + 覆盖关键元素");
{
  ok(!/from "(?!\.\/zipTree)/.test(render.replace(/import \{ extractEntryBytes[^}]*\} from "\.\/zipTree\.js";/, "")), "渲染模型只依赖 zipTree（无第三方）");
  ok(/parseXmlTree/.test(render) && !/DOMParser/.test(render), "自带 XML 解析（Node 单测可直接跑）");
  ok(render.includes("slideLayouts\\/slideLayout\\d+\\.xml"), "读取幻灯片版式");
  ok(/collectPlaceholders/.test(render), "占位符几何继承（真实 pptx 位置写在版式里）");
  ok(/schemeColor/.test(render) && /clrScheme/.test(render), "解析主题配色（schemeClr）");
  ok(/chOff/.test(render) && /applyGroup/.test(render), "组合形状坐标变换");
  ok(/图表|SmartArt/.test(render), "图表/SmartArt 给占位标签");
  for (const dep of ["pptx-preview", "echarts", "jszip", "lodash", "uuid"]) {
    ok(!pkg.dependencies?.[dep] && !pkg.devDependencies?.[dep], `未引入 ${dep}（自写渲染，不加包体积）`);
  }
}

console.log(`\n预览交互护栏：${pass} 断言全部通过（PDF/pptx 连续滚动 + pptx 真渲染 + 旧版格式提示）`);
