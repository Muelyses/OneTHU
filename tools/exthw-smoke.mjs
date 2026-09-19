/**
 * 外部作业源冒烟脚本（真连各平台）。
 *
 * 运行：source ~/.onethu-creds.env && node tools/exthw-smoke.mjs
 * 环境变量：YKT_COOKIE / YKT_UV / TUOJ_COOKIE / TUOJ_CLASSIC_COOKIE / TYCHE_BASIC /
 *           TYCHE_COOKIE / DSA_COOKIE
 * 逐源打印条数 + 条目（含 `submitted` 提交状态）；单源失败打印错误但不中断。
 * 未提供某源凭据 → 静默跳过该源（不报错、不计失败）。
 *
 * 注意：core 源码内部用 .js 扩展名互相引用（TS bundler 解析），Node 类型剥离
 * 不能把 .js 映射到 .ts —— 故这里直接引入各源文件（它们仅有 type-only 相对依赖）。
 */
import { createYuketangSource } from "../packages/core/src/exthw/yuketang.ts";
import { createTuojSource, CLASSIC_BASE } from "../packages/core/src/exthw/tuoj.ts";
import { createTycheSource } from "../packages/core/src/exthw/tyche.ts";
import { createDsaSource } from "../packages/core/src/exthw/dsa.ts";

/** Node 原生 fetch 包成 FetchLike */
const fetchLike = (url, init) => fetch(url, init);

const env = process.env;
const creds = {
  yuketang: env.YKT_COOKIE ? { cookie: env.YKT_COOKIE, uvId: env.YKT_UV || "2598" } : null,
  tuoj: env.TUOJ_COOKIE ? { cookie: env.TUOJ_COOKIE } : null,
  tuojClassic: env.TUOJ_CLASSIC_COOKIE ? { cookie: env.TUOJ_CLASSIC_COOKIE } : null,
  tyche: env.TYCHE_COOKIE ? { basic: env.TYCHE_BASIC || "cs:thuc++", cookie: env.TYCHE_COOKIE } : null,
  dsa: env.DSA_COOKIE ? { cookie: env.DSA_COOKIE } : null,
};

const sources = [];
if (creds.yuketang) sources.push(createYuketangSource(creds.yuketang, fetchLike, 30));
if (creds.tuoj) sources.push(createTuojSource(creds.tuoj, fetchLike, 30));
if (creds.tuojClassic)
  sources.push(
    createTuojSource(creds.tuojClassic, fetchLike, 30, {
      base: CLASSIC_BASE,
      id: "tuojClassic",
      name: "TUOJ（经典版）",
    }),
  );
if (creds.tyche) sources.push(createTycheSource(creds.tyche, fetchLike, 30));
if (creds.dsa) sources.push(createDsaSource(creds.dsa, fetchLike, 30));

if (sources.length === 0) {
  console.log(
    "未提供任何凭据（YKT_COOKIE / TUOJ_COOKIE / TUOJ_CLASSIC_COOKIE / TYCHE_COOKIE / DSA_COOKIE）——无事可做。",
  );
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
      // R9：考试 / 旁听标注与考试分数（仅已出分时打印）
      const tags = [it.kind === "exam" ? "考试" : "", it.audited ? "旁听" : ""].filter(Boolean).join("/");
      const tagText = tags ? ` [${tags}]` : "";
      const score = it.score !== undefined ? ` score=${it.score}/${it.totalScore ?? "?"}` : "";
      console.log(
        `  · [${it.kind}]${tagText} submitted=${it.submitted}${prog}${score} | ${it.deadline} | ${it.courseName} | ${it.title}${it.url ? " | " + it.url : ""}`,
      );
    }
  } catch (e) {
    failed++;
    console.log(`错误：${e instanceof Error ? e.message : String(e)}`);
  }
}

console.log(`\n完成：${sources.length - failed}/${sources.length} 源成功。`);
