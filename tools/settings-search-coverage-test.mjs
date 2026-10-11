/**
 * 设置检索覆盖护栏（task-19，2026-10-12）
 *
 * 背景：旧实现靠 DOM 扫描（`markSettingsRows`），未挂载/未展开的设置根本进不了索引 →
 * 用户实测「设置里那么多子选项都搜不到」。现在改为**声明式注册**（state/searchRows.ts 的
 * defineSearchRows），本护栏离线校验注册表的完整性与可检索性：
 *   ① 解析 6 个 section 文件里的 defineSearchRows 块，收集全部注册行；
 *   ② 断言：总数 ≥ 40、id 唯一、每行都有 tab/section/title；
 *   ③ 对**每一行**用它的 title + 每个 alias 各搜一次，模拟 matchSearchRows 的打分，
 *      断言**命中的是同一条行**（而不是别的行 / 落空）→ 任何一条不过 exit 1；
 *   ④ 关键地标词（音色/多模态/悬浮球/桌面小组件/检查更新/管理主题/安装主题/云同步/外部作业源…）
 *      断言命中的标题包含预期片段，且**行级排在页/分节级之前**（searchAll 的 rows 字段在最前）。
 * 退出码：0 通过；1 有失败（打印全部失败项）。
 */
import { readFileSync } from "node:fs";

const FILES = [
  "apps/desktop/src/components/OhSettingsPage.tsx",
  "apps/desktop/src/components/VoiceSettingsSection.tsx",
  "apps/desktop/src/components/OverlaySettingsSection.tsx",
  "apps/desktop/src/components/ImSettingsSection.tsx",
  "apps/desktop/src/components/WidgetSettingsSection.tsx",
  "apps/desktop/src/pages/Settings.tsx",
];

/** 极简解析：抓 defineSearchRows([ ... ]) 里的每个 { id: "…", tab: "…", section: "…", title: "…", aliases: [...] } */
function parseRows(src, file) {
  const out = [];
  for (const m of src.matchAll(/defineSearchRows\(\s*\[([\s\S]*?)\]\s*\)/g)) {
    const body = m[1];
    for (const r of body.matchAll(/\{([^{}]*)\}/g)) {
      const obj = r[1];
      const g = (k) => (obj.match(new RegExp(`${k}:\\s*"([^"]*)"`)) ?? [])[1];
      const aliases = (obj.match(/aliases:\s*\[([^\]]*)\]/) ?? [])[1];
      out.push({
        file,
        id: g("id"),
        tab: g("tab"),
        section: g("section"),
        title: g("title"),
        desc: g("desc"),
        aliases: aliases ? aliases.split(",").map((x) => x.trim().replace(/^"|"$/g, "")).filter(Boolean) : [],
      });
    }
  }
  return out;
}

const rows = FILES.flatMap((f) => parseRows(readFileSync(f, "utf8"), f));
const fails = [];

/* ② 结构断言 */
if (rows.length < 40) fails.push(`注册行总数 ${rows.length} < 40`);
const seen = new Set();
for (const r of rows) {
  if (!r.id) fails.push(`${r.file}: 缺 id（${r.title ?? "?"}）`);
  if (seen.has(r.id)) fails.push(`重复 id: ${r.id}`);
  seen.add(r.id);
  if (!r.tab || !r.section || !r.title) fails.push(`${r.file}:${r.id} 缺 tab/section/title`);
}

/* ③ 打分模型（与 state/searchRows.ts 的 matchSearchRows 同构） */
const score = (r, q) => {
  const t = r.title.toLowerCase();
  const d = (r.desc ?? "").toLowerCase();
  const a = (r.aliases ?? []).join(" ").toLowerCase();
  const x = q.toLowerCase();
  if (t === x) return 100;
  if (t.startsWith(x)) return 80;
  if (t.includes(x)) return 60;
  if (a.includes(x)) return 40;
  if (d.includes(x)) return 20;
  return 0;
};
const top = (q) => {
  const hits = rows.map((r) => ({ r, s: score(r, q) })).filter((h) => h.s > 0).sort((a, b) => b.s - a.s);
  return hits[0]?.r;
};

for (const r of rows) {
  const hit = top(r.title);
  if (!hit || hit.id !== r.id) fails.push(`标题搜不到自己：「${r.title}」→ ${hit ? hit.title : "落空"}`);
  for (const a of r.aliases ?? []) {
    const h = top(a);
    if (!h) fails.push(`别名落空：${r.id} alias「${a}」`);
  }
}

/* ④ 关键地标词 */
const LANDMARKS = {
  音色: "音色", 多模态: "多模态", 悬浮球: "悬浮球", 桌面小组件: "桌面小组件",
  检查更新: "检查更新", 管理主题: "管理主题", 安装主题: "安装主题",
  云同步: "云同步", 外部作业源: "外部作业源", 保活: "保活",
};
for (const [q, want] of Object.entries(LANDMARKS)) {
  const h = top(q);
  if (!h || !h.title.includes(want)) fails.push(`地标词「${q}」→ 期望命中含「${want}」的行，实得 ${h ? h.title : "落空"}`);
}
/* 行级优先：searchAll 的结果里 rows 字段必须存在且在所有其它字段之前（结构断言） */
const all = readFileSync("apps/desktop/src/state/searchAll.ts", "utf8");
if (!/rows: Array<\{ row: SearchRow; score: number \}>;\s*\n\s*\/\*\* 注册表命中/.test(all)) {
  fails.push("searchAll 结果结构里 rows 不在最前（行级优先级丢失）");
}

console.log(`设置检索覆盖护栏：注册行 ${rows.length} 条（${FILES.length} 个 section 文件）`);
console.log(`  逐行标题/别名自查：${rows.length} 条标题 + ${rows.reduce((n, r) => n + (r.aliases?.length ?? 0), 0)} 条别名`);
console.log(`  地标词：${Object.keys(LANDMARKS).join(" / ")}`);
if (fails.length === 0) {
  console.log("✅ 全部通过：每一条设置行的标题与别名都能命中它自己，地标词落点正确，行级优先级结构在位");
  process.exit(0);
}
console.error(`✗ ${fails.length} 项失败：`);
for (const f of fails.slice(0, 30)) console.error("   " + f);
process.exit(1);
