/** 市场仓库地址解析测试（parseRepoInput / rawEntryUrl，纯函数） */
import { parseRepoInput, rawEntryUrl } from "../apps/desktop/src/lib/market.ts";

let pass = 0, fail = 0;
const eq = (a, e, l) => { if (JSON.stringify(a) === JSON.stringify(e)) { pass++; } else { fail++; console.error(`✗ ${l}\n  期望: ${JSON.stringify(e)}\n  实际: ${JSON.stringify(a)}`); } };
const throws = (fn, l) => { try { fn(); fail++; console.error(`✗ ${l}：未按预期抛错`); } catch { pass++; } };

// 简写
eq(parseRepoInput("someone/one-thu-demo"), { owner: "someone", repo: "one-thu-demo" }, "user/repo");
eq(parseRepoInput("someone/one-thu-demo@dev"), { owner: "someone", repo: "one-thu-demo", branch: "dev" }, "user/repo@branch");
// 完整 URL
eq(parseRepoInput("https://github.com/someone/one-thu-demo"), { owner: "someone", repo: "one-thu-demo" }, "完整 URL");
eq(parseRepoInput("https://github.com/someone/one-thu-demo.git"), { owner: "someone", repo: "one-thu-demo" }, "URL 带 .git");
eq(parseRepoInput("github.com/someone/one-thu-demo"), { owner: "someone", repo: "one-thu-demo" }, "省略协议");
// /tree/ 形态（含子路径）
eq(parseRepoInput("https://github.com/someone/one-thu-demo/tree/dev/plugins/demo"),
  { owner: "someone", repo: "one-thu-demo", branch: "dev", subPath: "plugins/demo" }, "tree 分支子路径");
// SSH 形态
eq(parseRepoInput("git@github.com:someone/one-thu-demo.git"), { owner: "someone", repo: "one-thu-demo" }, "SSH 地址");
// 非法输入
throws(() => parseRepoInput(""), "空输入");
throws(() => parseRepoInput("https://gitlab.com/a/b"), "非 GitHub 域");
throws(() => parseRepoInput("https://github.com/only-owner"), "缺 repo 段");
// raw URL 组装
eq(rawEntryUrl({ owner: "a", repo: "b" }, "main", "plugin.js"), "https://raw.githubusercontent.com/a/b/main/plugin.js", "raw URL");
eq(rawEntryUrl({ owner: "a", repo: "b", subPath: "p/x" }, "dev", "index.js"), "https://raw.githubusercontent.com/a/b/dev/p/x/index.js", "raw URL 子路径");

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
