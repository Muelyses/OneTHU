/**
 * 网络学堂附件名解析回归（纯函数）。
 *
 * 用户 2026-10-25 反馈：从网络学堂下载文件时落盘名是「下载」且没有后缀。
 * 根因：附件锚点文本常是动作词（下载/点击下载/附件），旧解析把它当文件名。
 * 本测试锁住「动作词必须被忽略、真名从属性/URL/downloadUrl 路径里取」。
 *
 * 运行：node --import ./tools/ts-resolve-register.mjs tools/learn-attachment-name-test.mjs
 */
import assert from "node:assert/strict";
import { attachmentNameFromUrl, learnAttachmentName } from "../packages/core/src/learn/attachmentName.ts";

let pass = 0;
const cases = [];
function eq(actual, expected, name) {
  cases.push({ name, actual, expected });
  assert.equal(actual, expected, name);
  pass++;
  console.log("  ✓ " + name);
}

console.log("\n[网络学堂附件名]");
eq(
  learnAttachmentName({ text: "下载", href: "https://learn.tsinghua.edu.cn/b/wlxt/kj/wlkc_kjxxb/student/downloadFile?sfgk=0&wjid=123" }),
  "",
  "动作词「下载」不再被当成文件名（交给 id 兜底 + Content-Type 后缀）",
);
eq(
  learnAttachmentName({ text: "下载", attributes: { title: "第 3 章 课件.pdf" } }),
  "第 3 章 课件.pdf",
  "锚点 title 属性里的真名优先",
);
eq(
  learnAttachmentName({ text: "点击下载", href: "/b/wlxt/wj/download?wjmc=%E5%AE%9E%E9%AA%8C%E6%8A%A5%E5%91%8A.docx&wjid=9" }),
  "实验报告.docx",
  "URL 参数 wjmc 里的 Unicode 文件名",
);
eq(
  learnAttachmentName({
    text: "下载",
    href: "/b/wlxt/wj/download?downloadUrl=%2Fb%2Fwlxt%2Ffile%2F%E8%AF%BE%E4%BB%B6%E6%80%BB%E8%A7%88.pdf",
  }),
  "课件总览.pdf",
  "downloadUrl 参数里的路径 basename",
);
eq(
  learnAttachmentName({ text: "作业要求.zip（下载）", attributes: {} }),
  "作业要求.zip",
  "装饰文本里夹着的文件名",
);
eq(attachmentNameFromUrl("?filename=lecture-01.pptx"), "lecture-01.pptx", "filename 参数");
eq(learnAttachmentName({ text: "附件", attributes: { download: "notes.md" } }), "notes.md", "download 属性");
eq(learnAttachmentName({ text: "下载", href: "?wjid=1" }), "", "确实没有真名时返回空串（不伪造）");

console.log(`\n${pass} 个附件名断言通过`);
