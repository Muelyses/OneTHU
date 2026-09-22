/**
 * 下载完成提示「打开文件 / 打开目录」护栏（R25）。
 *
 * 事故（霖实测）：R23 加按钮时**加错了位置**——加在 PDF 画布内部与 Windows 门闸里，
 * 而用户实际看到的是面板底部那条蓝字（`color: var(--accent)`），于是「两个按钮没出现」；
 * 同时 `FileDetailPage` / `Forum` / `NewsTab` 三处下载提示完全没接（Forum 的提示位甚至
 * 从未渲染）。教训：这类"每个下载点都要挂"的需求必须**逐个点名 + 动态扫描新增点**。
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC = new URL("../apps/desktop/src", import.meta.url).pathname;
const read = (p) => readFileSync(join(SRC, p), "utf8");

/** 所有「下载成功提示」位点（新增下载点必须登记到这里） */
const SITES = [
  ["components/FilePreview.tsx", "预览面板底部提示（用户实际看到的那条蓝字）"],
  ["pages/learn/AssignmentDetailPage.tsx", "作业附件"],
  ["pages/learn/NoticeDetailPage.tsx", "通知附件"],
  ["pages/learn/FileDetailPage.tsx", "课程文件"],
  ["pages/learn/Forum.tsx", "讨论区附件"],
  ["pages/info/NewsTab.tsx", "信息门户新闻附件"],
];

for (const [path, label] of SITES) {
  const src = read(path);
  assert.ok(/import \{ DownloadOpenButtons \}/.test(src), `${label}（${path}）必须引入 DownloadOpenButtons`);
  assert.ok(/<DownloadOpenButtons path=\{[^}]+\} \/>/.test(src), `${label}（${path}）必须渲染「打开文件/打开目录」`);
}

/* 动态扫描：任何出现「已下载到：」的文件都必须在上面登记（防以后新增下载点漏接） */
const registered = new Set(SITES.map(([p]) => p));
const offenders = [];
(function walk(dir) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      walk(full);
      continue;
    }
    if (!/\.tsx$/.test(ent.name)) continue;
    const rel = full.replace(SRC + "/", "");
    if (rel === "components/DownloadOpenButtons.tsx") continue;
    if (readFileSync(full, "utf8").includes("已下载到：") && !registered.has(rel)) offenders.push(rel);
  }
})(SRC);
assert.deepEqual(offenders, [], `出现下载提示但未接「打开文件/打开目录」的文件：${offenders.join(", ")}`);

/* 组件自身：桌面才显示（Android 下载落在私有目录，无「定位」语义）+ 失败降级为 toast */
const btn = read("components/DownloadOpenButtons.tsx");
assert.ok(/isAndroidNavigator/.test(btn) && /return null/.test(btn), "Android 上必须不显示（无定位语义）");
assert.ok(/openPath\(path\)/.test(btn) && /revealItemInDir\(path\)/.test(btn), "两个动作分别是打开文件与定位文件");
assert.ok(/showToast/.test(btn), "失败要降级为 toast，不得抛出");

/* 样式：图标按钮可见、且提示条不与按钮两端拉开 */
const css = readFileSync(join(SRC, "styles/global.css"), "utf8");
assert.ok(/\.dl-open-btns \{[\s\S]*?display: inline-flex/.test(css), "按钮组必须可见（inline-flex）");
assert.ok(/\.dl-done-note \{[\s\S]*?justify-content: flex-start/.test(css), "提示条文字与按钮必须相邻");

console.log(`下载按钮护栏：${SITES.length} 处位点全部接线 + 无未登记下载点 + 样式与 Android 口径 ✓`);
