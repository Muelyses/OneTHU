/**
 * pptx 本地渲染护栏（R26）。
 *
 * 背景（霖实测）：「没法预览」= **看不到渲染好的幻灯片页面**（此前只有文字大纲）。
 * 本测试在 Node 里自建一份最小 pptx（含版式占位符继承、图片、表格、图表占位、备注），
 * 直接跑渲染模型解析，钉住：
 *  1. 几何：没有显式 xfrm 的标题/正文占位符必须**从版式继承**位置与尺寸（真实 pptx 常态）；
 *  2. 文本：段落对齐/层级、run 字号（sz/100）、粗体、颜色（srgbClr / schemeClr→主题色）；
 *  3. 图片：blip r:embed → rels → media → data URL；
 *  4. 表格：a:tbl 行列文本；
 *  5. 图表/SmartArt：给 unsupported 占位并计数（不静默丢内容）；
 *  6. 备注：notesSlide 文本；
 *  7. 幻灯片尺寸：presentation.xml 的 sldSz。
 *
 * 跑法：node tools/pptx-render-test.mjs（自带 TS 解析注册）
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import { crc32, deflateRawSync } from "node:zlib";

// 本测试要 import 渲染模型（.ts）：自带 TS 解析注册，`node tools/pptx-render-test.mjs` 直接可跑
register(new URL("./ts-resolve-loader.mjs", import.meta.url));

let pass = 0;
const ok = (cond, label) => {
  assert.ok(cond, label);
  pass++;
  console.log(`  ✓ ${label}`);
};
const eq = (a, b, label) => {
  assert.deepEqual(a, b, `${label}（实际 ${JSON.stringify(a)} / 期望 ${JSON.stringify(b)}）`);
  pass++;
  console.log(`  ✓ ${label}`);
};

/* ---------- 最小 ZIP 写入（method=8 deflate，central directory 完整） ---------- */
function makeZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, "utf8");
    const comp = deflateRawSync(data);
    const crc = crc32(data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 名
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, comp);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([cd, name]));
    offset += 30 + name.length + comp.length;
  }
  const cdBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cdBuf, eocd]);
}

/* ---------- 合成 pptx ---------- */
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);

const PRESENTATION = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="x" xmlns:a="y"><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`;

const THEME = `<?xml version="1.0"?><a:theme xmlns:a="y"><a:themeElements><a:clrScheme name="Office">
<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
<a:accent1><a:srgbClr val="4472C4"/></a:accent1>
</a:clrScheme></a:themeElements></a:theme>`;

const MASTER = `<?xml version="1.0"?><p:sldMaster xmlns:p="x" xmlns:a="y">
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2"/>
<p:spTree><p:nvGrpSpPr/><p:grpSpPr/></p:spTree></p:sldMaster>`;

// 版式：标题占位符（838200,365125,10515600,1325563）+ 正文占位符 idx=1
const LAYOUT = `<?xml version="1.0"?><p:sldLayout xmlns:p="x" xmlns:a="y">
<p:clrMap bg1="lt1" tx1="dk1"/>
<p:spTree>
<p:nvGrpSpPr/><p:grpSpPr/>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="838200" y="365125"/><a:ext cx="10515600" cy="1325563"/></a:xfrm></p:spPr>
<p:txBody><a:lstStyle><a:lvl1pPr><a:defRPr sz="4000" b="1"/></a:lvl1pPr></a:lstStyle><a:p/></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="Content"/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="838200" y="1825625"/><a:ext cx="10515600" cy="4351338"/></a:xfrm></p:spPr>
<p:txBody><a:lstStyle><a:lvl1pPr><a:defRPr sz="2000"/></a:lvl1pPr></a:lstStyle><a:p/></p:txBody></p:sp>
</p:spTree></p:sldLayout>`;

// 幻灯片：标题（无 xfrm，继承版式）+ 正文（无 xfrm，继承版式）+ 图片 + 表格 + 图表
const SLIDE = `<?xml version="1.0"?><p:sld xmlns:p="x" xmlns:a="y" xmlns:r="rel">
<p:cSld><p:spTree>
<p:nvGrpSpPr/><p:grpSpPr/>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
<p:spPr/>
<p:txBody><a:p><a:r><a:t>第一页标题</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr>
<p:spPr/>
<p:txBody>
<a:p><a:pPr lvl="0" algn="ctr"/><a:r><a:rPr sz="2400" b="1"/><a:t>要点一</a:t></a:r></a:p>
<a:p><a:pPr lvl="1"/><a:r><a:rPr sz="1800"/><a:t>要点二</a:t></a:r><a:r><a:rPr sz="1800"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:rPr><a:t>（红色）</a:t></a:r></a:p>
<a:p><a:pPr><a:buNone/></a:pPr><a:r><a:rPr sz="1600"/><a:t>无符号行</a:t></a:r></a:p>
</p:txBody></p:sp>
<p:pic><p:nvPicPr><p:cNvPr id="4" name="Pic"/><p:nvPr/></p:nvPicPr>
<p:blipFill><a:blip r:embed="rId2"/></p:blipFill>
<p:spPr><a:xfrm><a:off x="1000000" y="4000000"/><a:ext cx="2000000" cy="1000000"/></a:xfrm></p:spPr></p:pic>
<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="5" name="Table"/></p:nvGraphicFramePr>
<p:xfrm><a:off x="4000000" y="4000000"/><a:ext cx="3000000" cy="1200000"/></p:xfrm>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl>
<a:tr><a:tc><a:txBody><a:p><a:r><a:t>单元格A</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>单元格B</a:t></a:r></a:p></a:txBody></a:tc></a:tr>
</a:tbl></a:graphicData></a:graphic></p:graphicFrame>
<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="7" name="Line"/></p:nvCxnSpPr>
<p:spPr><a:xfrm><a:off x="500000" y="3000000"/><a:ext cx="3000000" cy="0"/></a:xfrm>
<a:ln><a:solidFill><a:srgbClr val="4472C4"/></a:solidFill></a:ln></p:spPr></p:cxnSp>
<p:sp><p:nvSpPr><p:cNvPr id="8" name="PageNo"/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="8000000" y="6500000"/><a:ext cx="800000" cy="300000"/></a:xfrm></p:spPr>
<p:txBody><a:p><a:fld id="{X}" type="slidenum"><a:t>‹#›</a:t></a:fld></a:p></p:txBody></p:sp>
<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="6" name="Chart"/></p:nvGraphicFramePr>
<p:xfrm><a:off x="8000000" y="4000000"/><a:ext cx="3000000" cy="1500000"/></p:xfrm>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="c" r:id="rId3"/></a:graphicData></a:graphic></p:graphicFrame>
</p:spTree></p:cSld></p:sld>`;

const SLIDE_RELS = `<?xml version="1.0"?><Relationships xmlns="rel">
<Relationship Id="rId1" Type="http://x/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
<Relationship Id="rId2" Type="http://x/image" Target="../media/image1.png"/>
<Relationship Id="rId3" Type="http://x/chart" Target="../charts/chart1.xml"/>
</Relationships>`;

const NOTES = `<?xml version="1.0"?><p:notes xmlns:p="x" xmlns:a="y"><p:cSld><p:spTree>
<p:sp><p:txBody><a:p><a:r><a:t>这是备注文字</a:t></a:r></a:p></p:txBody></p:sp>
</p:spTree></p:cSld></p:notes>`;

const zip = makeZip([
  { name: "ppt/presentation.xml", data: PRESENTATION },
  { name: "ppt/theme/theme1.xml", data: THEME },
  { name: "ppt/slideMasters/slideMaster1.xml", data: MASTER },
  { name: "ppt/slideLayouts/slideLayout1.xml", data: LAYOUT },
  { name: "ppt/slides/slide1.xml", data: SLIDE },
  { name: "ppt/slides/_rels/slide1.xml.rels", data: SLIDE_RELS },
  { name: "ppt/notesSlides/notesSlide1.xml", data: NOTES },
  { name: "ppt/media/image1.png", data: PNG_1x1 },
  { name: "[Content_Types].xml", data: `<?xml version="1.0"?><Types/>` },
]);

const { readZipEntries } = await import("../apps/desktop/src/lib/zipTree.ts");
const { parsePptxModel, parseXmlTree, child, allText } = await import("../apps/desktop/src/lib/pptxRender.ts");

console.log("[0] 极简 XML 解析器");
{
  const doc = parseXmlTree(`<?xml version="1.0"?><a:root x="1" y='2'><a:child>文字 &amp; 转义</a:child><empty/></a:root>`);
  eq(doc.children.length, 1, "根元素唯一");
  const root = doc.children[0];
  eq(root.name, "root", "去命名空间前缀");
  eq(root.attrs.x, "1", "双引号属性");
  eq(root.attrs.y, "2", "单引号属性");
  eq(allText(child(root, "child")), "文字 & 转义", "实体解码");
  ok(child(root, "empty") !== undefined, "自闭合标签");
}

console.log("[1] pptx 渲染模型");
const entries = readZipEntries(new Uint8Array(zip));
const model = await parsePptxModel(new Uint8Array(zip), entries);
eq(model.cx, 12192000, "幻灯片宽度取自 sldSz");
eq(model.cy, 6858000, "幻灯片高度取自 sldSz");
eq(model.slides.length, 1, "解析出 1 页");
const slide = model.slides[0];
eq(slide.no, 1, "页码为 1");

const texts = slide.shapes.filter((s) => s.kind === "text");
const title = texts.find((t) => t.paras[0]?.runs[0]?.text === "第一页标题");
ok(title, "标题文本框存在");
eq(title.x, 838200, "标题 x 从版式占位符继承");
eq(title.y, 365125, "标题 y 从版式占位符继承");
eq(title.w, 10515600, "标题宽度从版式继承");
eq(title.placeholder, true, "标题标记为占位符");

const body = texts.find((t) => t.paras.some((p) => p.runs.some((r) => r.text === "要点一")));
ok(body, "正文文本框存在");
eq(body.x, 838200, "正文 x 从版式 idx=1 占位符继承");
eq(body.y, 1825625, "正文 y 从版式继承");
eq(body.paras[0].align, "ctr", "段落对齐 algn=ctr");
eq(body.paras[0].runs[0].sizePt, 24, "run 字号 sz=2400 → 24pt");
eq(body.paras[0].runs[0].bold, true, "run 粗体 b=1");
eq(body.paras[0].bullet, "•", "正文占位符段落默认带项目符号");
eq(body.paras[1].lvl, 1, "段落层级 lvl=1");
eq(body.paras[1].runs[1].color, "#ff0000", "run 颜色 srgbClr → #rrggbb");
eq(body.paras[2].bullet, null, "buNone → 明确无符号");

const img = slide.shapes.find((s) => s.kind === "image");
ok(img, "图片形状存在");
eq(img.x, 1000000, "图片 x 用显式 xfrm");
eq(img.w, 2000000, "图片宽度用显式 xfrm");
ok(img.dataUrl.startsWith("data:image/png;base64,"), "图片解析为 data URL");

const table = slide.shapes.find((s) => s.kind === "table");
ok(table, "表格形状存在");
eq(table.rows[0][0][0].runs[0].text, "单元格A", "表格首格文本");
eq(table.rows[0][1][0].runs[0].text, "单元格B", "表格次格文本");

const line = slide.shapes.find((s) => s.kind === "line");
ok(line, "连接线渲染为真实细线（不占「未渲染」计数）");
eq(line.h, 0, "连接线保留原始几何（0 高度 → 画横线）");
eq(line.color, "#4472c4", "连接线颜色取 a:ln 的 solidFill");

const pageNo = slide.shapes.find((s) => s.kind === "text" && s.paras.some((p) => p.runs.some((r) => r.text === "1")));
ok(pageNo, "页码字段 slidenum 渲染为真实页码（不露 ‹#›）");
ok(!slide.shapes.some((s) => s.kind === "text" && s.paras.some((p) => p.runs.some((r) => /‹#›/.test(r.text)))), "不出现 ‹#› 字面量");

const unsupported = slide.shapes.filter((s) => s.kind === "unsupported");
eq(unsupported.length, 1, "图表计入 unsupported 占位");
eq(unsupported[0].label, "图表", "占位标签写明「图表」");
eq(model.unsupported, 1, "全局 unsupported 计数");

ok(slide.notes.includes("这是备注文字"), "备注页文本");

console.log("[2] 版式主题色与方案色");
{
  // schemeClr 走主题：accent1 = 4472C4
  const slideWithScheme = SLIDE.replace(
    `<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>`,
    `<a:solidFill><a:schemeClr val="accent1"/></a:solidFill>`,
  );
  const zip2 = makeZip([
    { name: "ppt/presentation.xml", data: PRESENTATION },
    { name: "ppt/theme/theme1.xml", data: THEME },
    { name: "ppt/slideMasters/slideMaster1.xml", data: MASTER },
    { name: "ppt/slideLayouts/slideLayout1.xml", data: LAYOUT },
    { name: "ppt/slides/slide1.xml", data: slideWithScheme },
    { name: "ppt/slides/_rels/slide1.xml.rels", data: SLIDE_RELS },
    { name: "ppt/media/image1.png", data: PNG_1x1 },
  ]);
  const m2 = await parsePptxModel(new Uint8Array(zip2), readZipEntries(new Uint8Array(zip2)));
  const b2 = m2.slides[0].shapes.find((s) => s.kind === "text" && s.paras.some((p) => p.runs.some((r) => r.text === "要点一")));
  eq(b2.paras[1].runs[1].color, "#4472c4", "schemeClr accent1 解析为主题色");
}

console.log("[3] 缺幻灯片时抛错（调用方据此回退/提示）");
{
  const bad = makeZip([{ name: "ppt/presentation.xml", data: PRESENTATION }]);
  await assert.rejects(() => parsePptxModel(new Uint8Array(bad), readZipEntries(new Uint8Array(bad))), /未找到 ppt\/slides/);
  pass++;
  console.log("  ✓ 非 pptx / 缺 slideN.xml 抛中文错误");
}

console.log(`\npptx 渲染护栏：${pass} 断言全部通过（几何继承/文本/图片/表格/图表占位/备注/主题色）`);
