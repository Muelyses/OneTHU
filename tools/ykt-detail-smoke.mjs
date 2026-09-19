// R20-B1 真数据冒烟：getExerciseDetail 打真实雨课堂接口（只读）
import fs from "node:fs";
import { createYuketangSource } from "../packages/core/src/exthw/yuketang.ts";

const raw = fs.readFileSync(process.env.HOME + "/.onethu-creds.env", "utf8");
const env = {};
for (const line of raw.split("\n")) {
  const s = line.replace(/^export\s+/, "");
  const i = s.indexOf("=");
  if (i > 0) env[s.slice(0, i).trim()] = s.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}
const UV = env.YKT_UV || "2598";
const BASE = "https://pro.yuketang.cn";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.88 Safari/537.36";
let cookie = (env.YKT_COOKIE || "").trim();
for (const k of ["uv_id", "university_id", "platform_id", "xtbz", "django_language"]) {
  if (!new RegExp(`(?:^|;\\s*)${k}=`).test(cookie)) {
    cookie += `; ${k}=${k === "uv_id" || k === "university_id" ? UV : k === "platform_id" ? "3" : k === "xtbz" ? "ykt" : "zh-cn"}`;
  }
}
const H = { Cookie: cookie, "User-Agent": UA, Accept: "application/json, text/plain, */*", XTBZ: "ykt" };
const j = async (u) => JSON.parse(await (await fetch(u, { headers: H })).text());
const fetchLike = (u, init) => fetch(u, init);

const courses = await j(`${BASE}/v2/api/web/courses/list?identity=2`);
let done = 0;
for (const c of courses?.data?.list || []) {
  const logs = await j(`${BASE}/v2/api/web/logs/learn/${c.classroom_id}?page=0&offset=200&sort=0&actype=-1`);
  for (const a of logs?.data?.activities || []) {
    if (a.type !== 19) continue;
    const lid = a?.content?.leaf_type_id;
    if (!lid) continue;
    const src = createYuketangSource({ cookie, uvId: UV }, fetchLike, 30);
    const d = await src.getExerciseDetail(String(lid), String(c.classroom_id), UV);
    console.log(`\n== ${c.name} | ${d.name}`);
    console.log(`   maxRetry=${d.maxRetry} lateAllowed=${d.lateAllowed} answerCount=${d.answerCount} fontUrl=${d.fontUrl ? "有" : "无"}`);
    for (const p of d.problems.slice(0, 6)) {
      console.log(`   #${p.index} type=${p.type}(${p.typeText}) score=${p.score} status=${p.myStatus} myScore=${p.myScore ?? "-"} allow=${p.allowResults.join("/")} 题干${p.bodyHtml ? "有" : "无"} 评语${p.remark ? "有" : "无"}`);
    }
    console.log(`   （共 ${d.problems.length} 题）`);
    if (++done >= 2) process.exit(0);
    break;
  }
}
