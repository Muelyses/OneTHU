#!/usr/bin/env node
/**
 * 临时来访人员报备「二级功能」注册护栏（2026-10-15）。
 *
 * 为什么单独立一条：它是**预约页里的第二个功能层**，入口分散在六处，漏掉任何一处都不报错，
 * 只表现为「目录里没有 / 搜索搜不到 / OH 填了数据页面不收」——静默少一个入口最难查。
 * 更要命的一处是 ③④：注册表条目（navigation）与页面原子（atoms）必须**同 key、同参数**，
 * 否则 CommandPalette / OH 搜索点行会走原子那条路，注册表里写的参数被静默忽略（落回图书馆座位）。
 *
 * 断言分三组：
 *   ① 契约与页面接线（app.tsx 的参数联合 / ReservePage 的 tab 三件套）
 *   ② 目录 + 搜索（注册表条目 + 页面原子 + 真跑一遍 matchNavQuery）
 *   ③ OH 一侧（门面 visit.fill 只填草稿、不许代提交；页面必须订阅草稿）
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const appTsx = read("apps/desktop/src/state/app.tsx");
const reserve = read("apps/desktop/src/pages/info/ReservePage.tsx");
const nav = read("apps/desktop/src/state/navigation.ts");
const atoms = read("apps/desktop/src/state/atoms.tsx");
const facade = read("apps/desktop/src/plugins/facade.ts");
const types = read("apps/desktop/src/plugins/types.ts");
const tab = read("apps/desktop/src/pages/info/VisitTab.tsx");
const adapter = read("apps/desktop/src/lib/visit.ts");

/* ── ① 契约与页面接线 ── */
assert.ok(
  /reserveTab\?:[^;]*"visit"/.test(appTsx),
  'LearnNav.reserveTab 必须含 "visit"（否则 navigate("reserve",{reserveTab:"visit"}) 类型不通）',
);
assert.ok(/export type ReserveTab = [^;]*"visit"/.test(reserve), "ReservePage 的 ReserveTab 联合必须含 visit");
assert.ok(/\{ id: "visit", label: "来访报备" \}/.test(reserve), "预约页 TABS 必须有「来访报备」这一栏");
assert.ok(/visit: "visit"/.test(reserve), "PARAM_TO_TAB 必须把契约值 visit 映到页内栏 visit");
assert.ok(
  /visited\.has\("visit"\) \? <VisitTab \/> : null/.test(reserve),
  "VisitTab 必须按既有惰性挂载模式渲染（visited + hidden）",
);

/* ── ② 目录 + 搜索：注册表与页面原子同 key 同参数 ── */
const navRowStart = nav.indexOf('{ id: "reserve-visit"');
assert.ok(navRowStart >= 0, "NAV_REGISTRY 必须有 reserve-visit 条目（这就是「进功能目录」的那一处）");
const navRow = nav.slice(navRowStart, nav.indexOf("\n", navRowStart));
assert.ok(/category: "预约"/.test(navRow), "条目必须挂在「预约」一级功能区下");
assert.ok(/page: "reserve"/.test(navRow) && /reserveTab: "visit"/.test(navRow), "条目要指向 reserve 页的 visit 栏");
assert.ok(/keywords:/.test(navRow), "条目要带 keywords（搜索栏同时匹配 name 与 keywords）");
assert.ok(!/advanced/.test(navRow), "不能落 advanced（matchNavQuery 与 byCategory 都会静默过滤）");

const atomRowStart = atoms.indexOf('key: "reserve-visit"');
assert.ok(atomRowStart >= 0, "PAGE_ATOMS 必须有 reserve-visit 页面原子");
const atomRow = atoms.slice(atomRowStart, atoms.indexOf("\n", atomRowStart));
assert.ok(/page: "reserve"/.test(atomRow) && /reserveTab: "visit"/.test(atomRow), "页面原子必须与注册表同参数");
const navParams = /reserveTab: "([a-z]+)"/.exec(navRow)?.[1];
const atomParams = /reserveTab: "([a-z]+)"/.exec(atomRow)?.[1];
assert.equal(navParams, atomParams, "两处 reserveTab 必须一致（否则搜索点行走原子、注册表参数被忽略）");

const { matchNavQuery } = await import(new URL("../apps/desktop/src/state/navigation.ts", import.meta.url).href);
for (const q of ["临时来访", "亲友来访", "报备"]) {
  const hits = matchNavQuery(q);
  assert.ok(
    hits.some((e) => e.id === "reserve-visit" && e.page === "reserve" && e.params?.reserveTab === "visit"),
    `搜索「${q}」必须命中 reserve-visit（实际命中 ${hits.map((e) => e.id).join(",") || "无"}）`,
  );
}

/* ── ③ OH：门面只填草稿，不许代提交；页面必须收草稿 ── */
const visitNs = facade.slice(facade.indexOf("  visit: {"), facade.indexOf("  gitlab: {"));
assert.ok(/requestVisitDraft\(/.test(visitNs), "门面 visit 命名空间必须把内容交给草稿（requestVisitDraft）");
assert.ok(/navGo\("reserve", \{ reserveTab: "visit" \}\)/.test(visitNs), "门面必须能把预约页切到该栏");
assert.ok(!/submitReport/.test(visitNs), "⛔ OH 不许代提交：门面里不得出现提交调用（真实报备只能用户确认后发）");
assert.ok(/gate\(perms, "nav", "visit\.fill"\)/.test(visitNs), "新能力要走既有权限门（nav），不新增权限项");
assert.ok(/visit:\s*\{[\s\S]{0,400}fill\(/.test(types), "plugins/types.ts 必须声明 visit.fill（插件作者看得到的能力面）");
assert.ok(
  /subscribeVisitDraft/.test(tab) && /peekVisitDraft/.test(tab) && /clearVisitDraft/.test(tab),
  "报备页必须订阅草稿、消费后清空（否则 OH 填了没人收）",
);
assert.ok(!/confirmed:\s*true/.test(tab), "⛔ 页面不得替用户勾「本人确认」（勾选必须由用户自己来）");
assert.ok(/onethu\.visitSession/.test(adapter), "桌面适配层要有自己的登录态存放位（与清小搭同款）");

console.log("结果：临时来访人员报备的四处落点（预约栏 / 功能目录 / 搜索栏 / OH 填草稿）注册齐，且 OH 无代提交能力 ✓");
