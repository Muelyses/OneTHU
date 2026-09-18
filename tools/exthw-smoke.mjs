/**
 * 外部作业源冒烟脚本（真连三平台）。
 *
 * 运行：source ~/.onethu-creds.env && node tools/exthw-smoke.mjs
 * 环境变量：YKT_COOKIE / YKT_UV / TUOJ_COOKIE / TYCHE_BASIC / TYCHE_COOKIE
 * 逐源打印条数 + 条目（含 `submitted` 提交状态）；单源失败打印错误但不中断。
 *
 * 注意：core 源码内部用 .js 扩展名互相引用（TS bundler 解析），Node 类型剥离
 * 不能把 .js 映射到 .ts —— 故这里直接引入三个源文件（它们仅有 type-only 依赖）。
 */
import { createYuketangSource } from "../packages/core/src/exthw/yuketang.ts";
import { createTuojSource } from "../packages/core/src/exthw/tuoj.ts";
import { createTycheSource } from "../packages/core/src/exthw/tyche.ts";

/** Node 原生 fetch 包成 FetchLike */
const fetchLike = (url, init) => fetch(url, init);

const env = process.env;
const creds = {
  yuketang: env.YKT_COOKIE ? { cookie: env.YKT_COOKIE, uvId: env.YKT_UV || "2598" } : null,
  tuoj: env.TUOJ_COOKIE ? { cookie: env.TUOJ_COOKIE } : null,
  tyche: env.TYCHE_COOKIE ? { basic: env.TYCHE_BASIC || "cs:thuc++", cookie: env.TYCHE_COOKIE } : null,
};

const sources = [];
if (creds.yuketang) sources.push(createYuketangSource(creds.yuketang, fetchLike, 30));
if (creds.tuoj) sources.push(createTuojSource(creds.tuoj, fetchLike, 30));
if (creds.tyche) sources.push(createTycheSource(creds.tyche, fetchLike, 30));

if (sources.length === 0) {
  console.log("未提供任何凭据（YKT_COOKIE / TUOJ_COOKIE / TYCHE_COOKIE）——无事可做。");
  process.exit(0);
}

let failed = 0;
for (const src of sources) {
  console.log(`\n=== ${src.name}（${src.id}）===`);
  try {
    const items = await src.fetch();
    console.log(`条数：${items.length}`);
    for (const it of items) {
      const prog =
        it.submittedCount !== undefined || it.totalCount !== undefined
          ? ` ${it.submittedCount ?? "?"}/${it.totalCount ?? "?"}`
          : "";
      console.log(
        `  · [${it.kind}] submitted=${it.submitted}${prog} | ${it.deadline} | ${it.courseName} | ${it.title}${it.url ? " | " + it.url : ""}`,
      );
    }
  } catch (e) {
    failed++;
    console.log(`错误：${e instanceof Error ? e.message : String(e)}`);
  }
}

console.log(`\n完成：${sources.length - failed}/${sources.length} 源成功。`);
