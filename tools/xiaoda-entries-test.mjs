#!/usr/bin/env node
/**
 * 清小搭入口注册护栏（2026-10-15 用户点名「加入一级功能区程序坞、搜索栏注册可搜索、OH 可调用」）。
 *
 * 为什么单独立一条：这三处入口分散在五个文件里，漏掉任何一处都不报错，只会静默少一个入口。
 * 首进程序坞时就断在这里——`Layout.NAV` 没有这颗球 ⇒ homeSpheres 的已知球白名单
 * （= NAV ∪ 插件页）也没有 "xiaoda" ⇒ `sanitize` 每次读档都把持久化那颗球吃掉，
 * 表现为「坞上有时看得到、一刷新就没了」；注册表/搜索栏各自看着都在。
 *
 * ①–④ 是源码级断言（四处注册各钉一条）；⑤ 是**行为**断言：把 state/homeSpheres.ts
 * 真导入（Layout 换数据替身，见 lib/xiaoda-guard-loader.mjs），用假 localStorage 走
 * 「老存档补停靠 / 用户移除不回填 / 新装默认坞」三条路径 —— 只做文本断言证明不了行为。
 */
import assert from "node:assert/strict";
import { readUiSource as readFileSync } from "./i18n/source-view.mjs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const layout = read("apps/desktop/src/components/Layout.tsx");
const icons = read("apps/desktop/src/components/Icons.tsx");
const spheres = read("apps/desktop/src/state/homeSpheres.ts");
const atoms = read("apps/desktop/src/state/atoms.tsx");
const nav = read("apps/desktop/src/state/navigation.ts");
const facade = read("apps/desktop/src/plugins/facade.ts");
const tabStrip = read("apps/desktop/src/components/explorer/TabStrip.tsx");

/* ── ① 程序坞：NAV 数据表 + 图标 ── */
assert.ok(
  /\{ page: "xiaoda", label: "清小搭", icon: IconXiaoda \}/.test(layout),
  "Layout.NAV 必须有清小搭这颗球（否则程序坞与 homeSpheres 白名单都没有它）",
);
const layoutHead = layout.slice(0, layout.indexOf("export const NAV"));
assert.ok(/IconXiaoda/.test(layoutHead), "Layout 必须 import IconXiaoda");
assert.ok(/export const IconXiaoda/.test(icons), "Icons.tsx 必须定义 IconXiaoda（NAV 球用）");
assert.ok(
  /function knownSphereIds\(\): Set<string> \{[\s\S]{0,200}NAV\.map\(\(n\) => n\.page as string\)/.test(spheres),
  "homeSpheres 的已知球白名单必须仍从 NAV 派生（球不进 NAV 就会被读档吃掉）",
);

/* ── ② 一次性补停靠：AUTO_DOCK + added 字段 ── */
const autoBlock = spheres.slice(spheres.indexOf("const AUTO_DOCK"), spheres.indexOf("const KEY"));
assert.ok(/"xiaoda"/.test(autoBlock), "AUTO_DOCK 必须登记 xiaoda（老用户存档要一次性补停靠）");
assert.ok(/added: string\[\]/.test(spheres), "SpheresDoc 必须有 added 字段（补过一次就不再回填）");
assert.ok(/if \(added\.has\(id\) \|\| !known\.has\(id\)\) continue/.test(spheres), "fillAutoDock 必须按 added 去重（用户手动移除是最终态）");
assert.ok(
  /added: \[\.\.\.AUTO_DOCK\]/.test(spheres),
  "新装默认档必须把 AUTO_DOCK 记为已补（否则默认坞里会重复追加一颗）",
);

/* ── ③ 搜索栏：页面原子 + 注册表条目（含运行时命中） ── */
const atomsHead = atoms.slice(0, atoms.indexOf("export const PAGE_ATOMS"));
const atomBlock = atoms.slice(atoms.indexOf("export const PAGE_ATOMS"), atoms.indexOf("export function recordPageAtomUse"));
assert.ok(/IconXiaoda/.test(atomsHead), "atoms.tsx 必须 import IconXiaoda");
assert.ok(
  /\{ kind: "page", key: "xiaoda", title: "清小搭",[^}]*page: "xiaoda" \}/.test(atomBlock),
  "PAGE_ATOMS 必须有 xiaoda 页面原子（搜索栏与 OH open_page 同一份数据）",
);
const navRowStart = nav.indexOf('{ id: "xiaoda"');
assert.ok(navRowStart >= 0, "NAV_REGISTRY 必须有清小搭条目");
const navRow = nav.slice(navRowStart, nav.indexOf("\n", navRowStart));
assert.ok(/name: "清小搭"/.test(navRow) && /page: "xiaoda"/.test(navRow), "注册表条目要指向 name 清小搭 / page xiaoda");
assert.ok(!/advanced/.test(navRow), "清小搭不能落 advanced（高级能力不进标准搜索）");
assert.ok(/keywords:/.test(navRow), "注册表条目要带 keywords（搜索栏同时匹配 name 与 keywords）");
/* 运行时命中：搜索栏（命令面板/底栏检索条/OH 搜索）走的 matchNavQuery 真跑一遍 */
const { matchNavQuery } = await import(new URL("../apps/desktop/src/state/navigation.ts", import.meta.url).href);
const q = matchNavQuery("清小搭");
assert.ok(
  q.some((e) => e.id === "xiaoda" && e.page === "xiaoda"),
  `搜索栏按「清小搭」必须命中注册表条目（实际命中 ${q.map((e) => e.id).join(",") || "无"}）`,
);
assert.ok(q.some((e) => e.id === "xiaoda" && e.keywords.some((k) => k.toLowerCase().includes("ai"))), "口语关键词也要能命中（AI 学伴/智能体）");

/* ── ④ OH 可调用：tabOpen 白名单 + 标签图标 ── */
assert.ok(
  /const TOP_PAGES = new Set\(\[[\s\S]*?"xiaoda"[\s\S]*?\]\);/.test(facade),
  "facade.TOP_PAGES 必须含 xiaoda（OH/插件经 ext_tab open 才开得了这一页）",
);
assert.ok(/if \(page === "xiaoda"\) return IconXiaoda|case "xiaoda": return IconXiaoda/.test(tabStrip), "标签条图标表要给清小搭自己的图标");

/* ── ⑤ 读档行为（真模块 + 假 localStorage）：补停靠一次 / 移除不回填 / 新装默认坞 ── */
const KEY = "onethu.home.spheres.v3";
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
};
const put = (doc) => {
  store.clear();
  if (doc) store.set(KEY, JSON.stringify(doc));
};
const fresh = (tag) => import(new URL(`../apps/desktop/src/state/homeSpheres.ts?v=${tag}`, import.meta.url).href);
const { pages } = JSON.parse(read("tools/lib/xiaoda-guard-nav.json"));

/** 与 Layout.NAV 同形的替身页序（清小搭在第 9 位＝前八颗默认球之外） */
const FIRST8 = pages.slice(0, 8).map((p) => p.page);

/* A. 老存档（v3：坞上只有前两颗、没有 added 字段）→ 一次性补停靠并把结果落盘 */
put({ v: 1, docked: ["tasks", "learn"], timeOpacity: 1, dockOpacity: 1 });
const legacy = await fresh("legacy");
assert.deepEqual(legacy.spheresSnapshot().docked.slice(0, 2), ["tasks", "learn"], "补停靠只追加在坞尾，不动用户原有顺序");
assert.ok(legacy.spheresSnapshot().docked.includes("xiaoda"), "老存档必须补停靠清小搭");
assert.ok(JSON.parse(store.get(KEY)).docked.includes("xiaoda"), "补停靠结果必须落盘（否则每次读档都从头补一遍）");
assert.ok(JSON.parse(store.get(KEY)).added.includes("xiaoda"), "补过的 id 要记进 added");

/* B. 用户用「更多功能」的 × 移除后，不再回填 */
legacy.undockSphere("xiaoda");
assert.ok(!JSON.parse(store.get(KEY)).docked.includes("xiaoda"), "移除要落盘");
const removed = await fresh("removed");
assert.ok(!removed.spheresSnapshot().docked.includes("xiaoda"), "用户手动移除过就不再回填（added 是最终态）");

/* C. 新装（无任何存档）→ 前八颗默认球 + AUTO_DOCK（清小搭、通讯录）追加在尾 */
put(null);
const installed = await fresh("fresh");
assert.deepEqual(installed.spheresSnapshot().docked, [...FIRST8, "xiaoda", "contacts"], "新装默认坞 = 前八颗 + 清小搭 + 通讯录（AUTO_DOCK 追加在尾）");

console.log("结果：清小搭四处入口（程序坞 / 补停靠 / 搜索栏 / OH）注册齐，且读档补停靠行为正确 ✓");
