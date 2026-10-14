#!/usr/bin/env node
/**
 * OH → 门面接线护栏（2026-10-15，oh-wire / task-2）：白板导航桥 + 首页程序坞 + 收藏落点。
 *
 * 三块都在**门面这一层**（插件与 OH 唯一的执行入口，plugins/facade.ts）：
 *   ⑦ 首页程序坞 `ext.homeDock.set`：一级页 ∪ 插件功能页同权停靠/取消停靠，认不出的 id 报错；
 *   ⑧ 收藏落点 `ext.onePageAddAtom`：落首页（不给 boardId）或落某块 OnePage，重复/板不存在给原因。
 *
 * 白板导航桥盯的是两个缺口：
 *   ① `ext.tabOpen("board"/"boards")` 能不能过白名单（一级页名单副本漏页就会被拦成
 *      「不认识的页面」）；
 *   ② `nav.go("board", {boardId})` 会不会真的**切到那块板**——白板页渲染的是「当前板」
 *      （BoardDoc.activeBoardId，BoardPage.tsx:169），只把 params 塞进标签而不切板 =
 *      OH 说「打开旅行计划」实际停在上一块板，而且静默（用户看不出来）。
 *      正确链路 = 与 `#/board/<板 id>` 深链（explorer.openBoardFromHash）和 ext.onePageOpen
 *      同一对调用：openOnePage(id) + openTab("board")。
 *
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/board-nav-bridge-test.mjs
 *   （本文件自带极小的模块钩子，见「测试脚手架」段；只用 node 内置能力，不引第三方包，
 *    也不需要构建产物。）退出码：0 通过 / 1 违规。
 *
 * **测的是真模块**：state/board.ts、state/onePage.ts、state/explorer.ts、plugins/facade.ts
 * （buildApi）都在模块图里。桩只打在"与导航无关、node 直跑又进不来"的三类边上
 * （@onethu/core|info-lib 校园客户端、.tsx 组件、CJS 包具名导出）；断言不碰任何桩的行为
 * ——桩的意义只是把模块图接上。
 */

/* ───────────────────── 测试脚手架（DOM/事件替身 + 模块钩子） ───────────────────── */
/* 仓库自带的极简 DOM/存储替身（其余 node 测试同款） */
await import("./dom-stub.mjs");

/* explorer 写 hash 用 location；dom-stub 只给 document/localStorage，这里补齐 */
globalThis.location = { hash: "#/today" };
globalThis.history = { replaceState() {}, pushState() {} };
/* 事件总线：onePage.notifyBoardsChanged / explorerPrefs 的 storage 监听都靠它 */
const bus = new Map();
globalThis.Event = class Event { constructor(type) { this.type = type; } };
globalThis.CustomEvent = globalThis.Event;
globalThis.addEventListener = (t, f) => { if (!bus.has(t)) bus.set(t, new Set()); bus.get(t).add(f); };
globalThis.removeEventListener = (t, f) => { bus.get(t)?.delete(f); };
globalThis.dispatchEvent = (e) => { for (const f of bus.get(e?.type) ?? []) f(e); return true; };
/* userext / theme 在模块初始化时会起观察者 */
globalThis.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };

/* 模块钩子：把上面三类边接上。为什么不用真身：.tsx 需要 JSX 转换，而仓库没有可独立
   解析的 JSX 工具链（esbuild 只作为 Vite 的传递依赖躺在 .pnpm 里），所以组件一律只做
   模块图填充；校园客户端同理（真身 dist 是无后缀相对导入 + CJS 具名导出）。 */
{
  const { register } = await import("node:module");
  const REPO = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
  const loader = `
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
const REPO = ${JSON.stringify(REPO)};
const req = createRequire(REPO + "/package.json");
const bare = (specifier) => !/^(\\.|\\/|file:|data:|node:|#)/.test(specifier);
/* 万能桩：可调、可 new、可链式取值；字符串化给 ""、数值化给 0（模板串里不炸） */
const NOOP = [
  "const noop = new Proxy(function () {}, {",
  "  get: (_t, k) => {",
  "    if (typeof k === 'symbol' || k === 'then') return undefined;",
  "    if (k === 'valueOf') return () => 0;",
  "    if (k === 'toString') return () => '';",
  "    return noop;",
  "  },",
  "  apply: () => noop,",
  "  construct: () => noop,",
  "});",
].join("\\n");
const stubModule = (names) => NOOP + "\\nexport default noop;\\n" + names.map((n) => "export const " + n + " = noop;").join("\\n") + "\\n";
/** .tsx 一律只做模块图填充；**例外**：components/Layout.tsx 的 NAV 是纯数据数组
    （首页一级页目录，也是首页程序坞的白名单）—— 从源码里抠出来求值，桩掉会让坞的断言
    失去意义。求值走 Function + with(Proxy)：icon: IconPen 这类标识符统一取到 noop
    （symbol 键返回 undefined，否则 Symbol.unscopables 会被当成「全部不可作用域」→ ReferenceError）。 */
function tsxStub(file) {
  const names = namesOf(file);
  const out = stubModule(names.filter((n) => n !== "NAV"));
  try {
    const src = readFileSync(file, "utf8");
    const at = src.indexOf("export const NAV");
    if (at < 0) return out;
    const eq = src.indexOf("= [", at); /* 类型注解里可能有 Page[]，认赋值点才稳 */
    if (eq < 0) return out;
    const start = eq + 2;
    let depth = 0;
    let end = -1;
    for (let i = start; i >= 0 && i < src.length; i++) {
      if (src[i] === "[") depth++;
      else if (src[i] === "]") { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    if (end <= start) return out;
    const literal = src.slice(start, end);
    return out + "export const NAV = new Function('scope', 'with (scope) { return (' + "
      + JSON.stringify(literal) + " + '); }')(new Proxy({}, { has: () => true, get: (_t, k) => (typeof k === 'symbol' ? undefined : noop) }));\\n";
  } catch { return out; }
}
/** 桩出的具名导出清单：从真源码里扫 export，名字对齐后 import 才不会爆 */
function namesOf(file) {
  const src = readFileSync(file, "utf8");
  const names = new Set();
  for (const m of src.matchAll(/export\\s+(?:async\\s+)?(?:function|class|const|let|var)\\s+([A-Za-z_$][\\w$]*)/g)) names.add(m[1]);
  for (const m of src.matchAll(/export\\s*\\{([^}]*)\\}/g)) {
    for (const part of m[1].split(",")) {
      const n = part.trim().split(/\\s+as\\s+/).pop().trim();
      if (/^[A-Za-z_$][\\w$]*$/.test(n)) names.add(n);
    }
  }
  return [...names];
}
/** 校园客户端的具名导出清单（扫全仓 import 语句） */
function campusNames() {
  const files = [];
  const walk = (dir) => {
    let ents = []; try { ents = readdirSync(dir); } catch { return; }
    for (const e of ents) {
      const p = dir + "/" + e;
      let st; try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p); else if (/\\.(ts|tsx)$/.test(e)) files.push(p);
    }
  };
  walk(REPO + "/apps/desktop/src");
  try { for (const p of readdirSync(REPO + "/packages")) walk(REPO + "/packages/" + p + "/src"); } catch { /* 无 packages */ }
  const names = new Set();
  for (const f of files) {
    for (const m of readFileSync(f, "utf8").matchAll(/import\\s*\\{([^}]*)\\}\\s*from\\s*"@onethu\\/(?:core|info-lib)"/g)) {
      for (const part of m[1].split(",")) {
        const n = part.replace(/type\\s+/, "").trim().split(/\\s+as\\s+/)[0].trim();
        if (/^[A-Za-z_$][\\w$]*$/.test(n)) names.add(n);
      }
    }
  }
  return [...names];
}
/** CJS 包在 ESM 里具名导出探测会失败（react/jsx-runtime、he、jsencrypt…）：
    用 createRequire 取**真身**再显式重导出（不是替身） */
function cjsWrapper(specifier, parentURL) {
  const reqs = [req];
  try { if (parentURL?.startsWith("file:")) reqs.push(createRequire(fileURLToPath(parentURL))); } catch { /* 只用仓库根 */ }
  let resolved = ""; let mod = null;
  for (const r of reqs) { try { resolved = r.resolve(specifier); mod = r(specifier); break; } catch { /* 换起点 */ } }
  if (!mod) return null;
  const keys = Object.keys(mod).filter((k) => k !== "default" && /^[A-Za-z_$][\\w$]*$/.test(k));
  const src = "import def from " + JSON.stringify(pathToFileURL(resolved).href) + ";\\nexport default def;\\n"
    + keys.map((k) => "export const " + k + " = def[" + JSON.stringify(k) + "];").join("\\n") + "\\n";
  return { url: "data:text/javascript;base64," + Buffer.from(src).toString("base64"), shortCircuit: true };
}
export async function resolve(specifier, context, next) {
  if (specifier === "@onethu/core" || specifier === "@onethu/info-lib") {
    return { url: "data:text/javascript;base64," + Buffer.from(stubModule(campusNames())).toString("base64"), shortCircuit: true };
  }
  if (bare(specifier) && !specifier.startsWith("@onethu")) {
    const w = cjsWrapper(specifier, context.parentURL);
    if (w) return w;
  }
  try {
    return await next(specifier, context);
  } catch (e) {
    if (e?.code !== "ERR_MODULE_NOT_FOUND") throw e;
    if (!/\\.[a-z]+$/i.test(specifier)) { try { return await next(specifier + ".js", context); } catch { /* 继续回退 */ } }
    if (specifier.endsWith(".js")) {
      for (const ext of [".ts", ".tsx"]) { try { return await next(specifier.slice(0, -3) + ext, context); } catch { /* 继续回退 */ } }
    }
    throw e;
  }
}
export async function load(url, context, next) {
  const clean = url.split("?")[0];
  if (clean.endsWith(".tsx")) return { format: "module", source: tsxStub(fileURLToPath(clean)), shortCircuit: true };
  if (/\\.(css|svg|png|jpg)$/.test(url)) return { format: "module", source: "export default {};", shortCircuit: true };
  return next(url, context);
}
`;
  register("data:text/javascript;base64," + Buffer.from(loader).toString("base64"));
}

/* ───────────────────── 被测的真模块 ───────────────────── */
const { loadBoard } = await import("../apps/desktop/src/state/board.ts");
const onePage = await import("../apps/desktop/src/state/onePage.ts");
const explorer = await import("../apps/desktop/src/state/explorer.ts");
const { setNavBridge } = await import("../apps/desktop/src/plugins/bridges.ts");
const { buildApi } = await import("../apps/desktop/src/plugins/facade.ts");

const fails = [];
const ok = (cond, msg) => { if (cond) console.log("  ✓ " + msg); else fails.push(msg); };
const boardTabs = () => explorer.explorerSnapshot().tabs.filter((t) => t.page === "board");

/* 门面的导航桥由 App.tsx 每帧回填（App.tsx:31）；这里填 explorerNavigate = 同一件事 */
setNavBridge((page, params) => explorer.explorerNavigate(page, params));
/* 权限取 OH 自己那条清单（plugins/OneTHU-Harness/manifest.json 的 nav/ui） */
const api = buildApi("onethu.harness", new Set(["nav", "ui"]));

/* ① 两块板：先让「期末复习」当当前板 —— "不切板"的旧行为会当场露馅 */
const a = onePage.createOnePage("期末复习");
const b = onePage.createOnePage("旅行计划");
ok(!!a && !!b && a !== b, `建了两块白板：${a} / ${b}`);
onePage.openOnePage(a);

/* ② 带参：nav.go("board", {boardId}) 必须切板 + 标签标题取板名 */
const before = boardTabs().length;
api.nav.go("board", { boardId: b });
const active = boardTabs().find((t) => t.id === explorer.explorerSnapshot().activeId) ?? boardTabs()[boardTabs().length - 1];
ok(boardTabs().length === before + 1, "带参 nav.go(\"board\", {boardId}) 开出白板标签");
ok(active?.title === "旅行计划", `标签标题 = 板名（${active?.title}）`);
ok(loadBoard().activeBoardId === b, "当前板已切到目标板（白板页渲染的就是它）");

/* ③ 无参：沿用当前板，并且**复用**已开白板标签（不多开） */
const n0 = boardTabs().length;
api.nav.go("board");
ok(boardTabs().length === n0, `无参 nav.go("board") 复用已开白板标签（${n0} → ${boardTabs().length}）`);
ok(loadBoard().activeBoardId === b, "无参时不切板（沿用当前板）");

/* ④ 「所有白板」列表页 */
api.nav.go("boards");
ok(explorer.explorerSnapshot().tabs.some((t) => t.page === "boards"), "nav.go(\"boards\") 开出「所有白板」列表页");

/* ⑤ 未知板 id：必须当场报错（不静默打开上一块板） */
let threw = "";
try { api.nav.go("board", { boardId: "board.不存在" }); } catch (e) { threw = String(e?.message ?? e); }
ok(threw.includes("没有这块白板"), `未知板 id 明确报错（${threw.slice(0, 24)}…）`);
ok(loadBoard().activeBoardId === b, "报错后当前板没被改坏");

/* ⑦ 首页程序坞：只读快照 / 停靠 / 取消停靠 / 未注册 id 报错 */
const { spheresSnapshot } = await import("../apps/desktop/src/state/homeSpheres.ts");
const dock0 = spheresSnapshot().docked.slice();
const snap = api.ext.homeDock.set();
ok(Array.isArray(snap.docked) && snap.docked.length === dock0.length, `homeDock.set() 只读快照：坞上 ${snap.docked?.length} 颗球`);
ok(snap.dockable?.length >= 5, `可停靠清单含一级页（共 ${snap.dockable?.length} 项）`);
const DOCK_TARGET = "life"; /* 一级页（NAV 里；且不在默认前 8 颗里，停靠/取消停靠都能看见变化） */
if (dock0.includes(DOCK_TARGET)) api.ext.homeDock.set(DOCK_TARGET, false);
const docked = api.ext.homeDock.set(DOCK_TARGET, true);
ok(docked.docked.includes(DOCK_TARGET) && spheresSnapshot().docked.includes(DOCK_TARGET), "停靠一级页「生活」：状态层与返回值一致");
ok(!api.ext.homeDock.set(DOCK_TARGET, false).docked.includes(DOCK_TARGET), "取消停靠生效");
/* 本轮新能力：**插件功能页**也能进坞（pageKey = plugin:<插件>:<页>，注册在 plugins/tabs.ts） */
const { registerPluginTab, unregisterPluginTabs } = await import("../apps/desktop/src/plugins/tabs.ts");
registerPluginTab({ pageKey: "plugin:oh.wire.test:dock", pluginId: "oh.wire.test", title: "打卡" });
const pluginSnap = api.ext.homeDock.set();
ok(pluginSnap.dockable.includes("plugin:oh.wire.test:dock"), "插件功能页进了「可停靠」清单（一级页 ∪ 插件页）");
ok(api.ext.homeDock.set("plugin:oh.wire.test:dock", true).docked.includes("plugin:oh.wire.test:dock"), "插件功能页真正停靠进坞");
api.ext.homeDock.set("plugin:oh.wire.test:dock", false); /* 先取消停靠再注销插件 */
unregisterPluginTabs("oh.wire.test");
ok(spheresSnapshot().docked.join(",") === dock0.join(","), "坞回到初始状态（无残留）");
let dockErr = "";
try { api.ext.homeDock.set("plugin:不存在:main", true); } catch (e) { dockErr = String(e?.message ?? e); }
ok(dockErr.includes("不认识这个页面"), "未注册的插件页 id 报错（不静默停靠一颗看不见的球）");

/* ⑧ 收藏落点：落指定板 / 重复给 duplicate / 不给 boardId 落首页（系统板）/ 板不存在给 no-board */
const landingBoard = onePage.createOnePage("收藏落点板");
const toBoard = api.ext.onePageAddAtom({ boardId: landingBoard }, "course:oh-wire-1");
ok(toBoard.ok === true && toBoard.boardId === landingBoard, "落指定 OnePage 成功");
ok(api.ext.onePageAddAtom({ boardId: landingBoard }, "course:oh-wire-1").reason === "duplicate", "同板同原子 → reason=duplicate（自带查重）");
const toHome = api.ext.onePageAddAtom({ to: "home" }, "course:oh-wire-2");
const homeBoard = onePage.allOnePages().find((b) => b.id === toHome.boardId);
ok(toHome.ok === true && homeBoard?.kind === "system", "不给 boardId = 落首页（系统板）");
ok(onePage.onePagesWithAtom("course:oh-wire-2").length === 1, "首页上确实躺着那颗原子（可查回）");
ok(api.ext.onePageAddAtom({ boardId: "board.不存在" }, "course:oh-wire-3").reason === "no-board", "目标板不存在 → reason=no-board");

/* ⑥ 一级页名单副本：ext.tabOpen 对白板两页放行（漏了会被拦成「不认识的页面」） */
ok(!!api.ext.tabOpen("board")?.id, "ext.tabOpen(\"board\") 放行");
ok(!!api.ext.tabOpen("boards")?.id, "ext.tabOpen(\"boards\") 放行");

console.log(fails.length ? `\n✗ 白板导航桥 ${fails.length} 项失败` : "\n✅ 白板导航桥全绿");
for (const f of fails) console.error("   ✗ " + f);
process.exit(fails.length ? 1 : 0);
