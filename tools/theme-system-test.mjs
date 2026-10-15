/**
 * 主题 × System 层护栏：防"主题只改了 Compat、System 组件看不到"。
 *
 * 背景（真回归）：§3.5 B1 把按钮从 Compat 名（--surface/--border/--primary）迁到 System 角色
 * （--md-sys-color-*），而 7 个内置主题的覆盖值一直写在 Compat 层——Compat 是单向别名，
 * 覆盖它不回流 System，于是"换主题按钮不变色"。
 * 修法是注入时镜像（见 state/theme.ts 的 COMPAT_TO_SYSTEM），这里逐条钉死：
 *   1) 镜像表 == tokens.css Compat 层的逆映射（双向，任何漂移直接红）；
 *   2) 每个主题的每个覆盖键都必须能镜像（新主题写了没人认识的键 → 红）；
 *   3) 行为：逐个主题应用后，注入 CSS 里 Compat 行与 System 行成对出现且同值；
 *      按钮读的角色（surface-container-lowest / outline-variant / on-surface / primary）确实被改到。
 */
import { dom } from "./dom-stub.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

globalThis.window.__TAURI_INTERNALS__ = { invoke: async () => null };
const T = await import("../apps/desktop/src/state/theme.ts");
const { COMPAT_TO_SYSTEM } = T;

/* [1] 与 tokens.css 的 Compat 层逐条一致 */
const tokens = readFileSync("packages/ui/src/tokens.css", "utf8");
const expected = new Map();
for (const line of tokens.split("\n")) {
  const m = /^\s*(--(?!md-sys-)[\w-]+):\s*var\((--md-sys-[\w-]+)\);\s*$/.exec(line);
  if (m) expected.set(m[1], m[2]);
}
assert.ok(expected.size >= 30, "Compat 层解析异常，只解析到 " + expected.size + " 条");
assert.deepEqual(
  Object.keys(COMPAT_TO_SYSTEM).sort(),
  [...expected.keys()].sort(),
  "镜像表与 tokens.css Compat 层的键不一致",
);
for (const [k, v] of expected) {
  assert.equal(COMPAT_TO_SYSTEM[k], v, "映射错位：" + k + " → " + COMPAT_TO_SYSTEM[k] + "，tokens.css 里是 " + v);
}

/* [2] 主题覆盖键全部可镜像 */
const themes = T.listThemes();
const unmapped = new Set();
for (const t of themes) for (const k of Object.keys(t.vars ?? {})) if (!COMPAT_TO_SYSTEM[k]) unmapped.add(k);
assert.deepEqual([...unmapped], [], "有主题覆盖键映射不到 System 角色（主题改了 Compat、System 组件看不到）");

/* [2b] 页面底与卡片底色要成对给：页面底现在读 container-low（= --bg-soft 的镜像），
   只给 --bg 会让页面停在默认灰、只有卡片变色（§3.5 B2 之后新增主题最容易踩的坑） */
for (const t of themes) {
  const vars = t.vars ?? {};
  if (!Object.keys(vars).length) continue; // 基础令牌（ivory）本来就没有覆盖
  assert.ok(
    vars["--bg"] && vars["--bg-soft"],
    t.id + "：页面底与卡片底色必须成对给（--bg + --bg-soft），否则页面不跟随主题",
  );
}

/* [3] 行为：逐主题应用，Compat 行与 System 行成对同值 */
const BUTTON_COMPAT = ["--surface", "--border", "--text-1", "--text-2", "--primary", "--hover", "--ring"];
const themeStyle = () => {
  const el = [...dom.styles.values()].find((s) => String(s.id).includes("theme"));
  return el ? String(el.textContent) : "";
};
const decls = (css) => {
  const out = new Map();
  for (const m of css.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out.set(m[1], m[2].trim());
  return out;
};
let checkedPairs = 0;
/* 表面填充家族＝玻璃档独占（2026-10-14 大一统定案，theme.ts 的 SURFACE_FAMILY 会跳过它们）：
   主题不再注入 bg/surface 五级，断言随设计更新——这些键不该出现在注入 CSS 里。 */
const SURFACE_FAMILY = new Set(["--bg", "--bg-soft", "--surface", "--surface-2", "--surface-3"]);
for (const t of themes) {
  T.activateTheme(t.id);
  const css = themeStyle();
  assert.ok(css.includes(':root[data-theme="' + t.id + '"]'), t.id + "：注入的选择器不对");
  const got = decls(css);
  for (const [k, v] of Object.entries(t.vars ?? {})) {
    if (SURFACE_FAMILY.has(k)) {
      assert.equal(got.get(k), undefined, t.id + "：" + k + " 属表面族，应由玻璃档独占，不该被主题注入");
      continue;
    }
    assert.equal(got.get(k), v, t.id + "：" + k + " 的 Compat 行没写进去");
    const sys = COMPAT_TO_SYSTEM[k];
    assert.equal(got.get(sys), v, t.id + "：" + k + " 没有镜像到 " + sys + "（System 组件将不跟随主题）");
    checkedPairs++;
  }
  // 按钮真正读的角色必须被改到（主题覆盖了对应 Compat 键时）
  const overridden = new Set(Object.keys(t.vars ?? {}));
  for (const k of BUTTON_COMPAT) {
    if (!overridden.has(k)) continue;
    /* 表面族由玻璃档独占（同 SURFACE_FAMILY 判定）：主题不注入 → 不看这条 */
    if (SURFACE_FAMILY.has(k)) continue;
    const sys = COMPAT_TO_SYSTEM[k];
    assert.ok(got.has(sys), t.id + "：按钮读的 " + sys + " 没被主题改到");
  }
}
T.deactivateTheme();
assert.equal(themeStyle(), "", "回到基础令牌时必须清空注入样式");

/* 桥的取色来源必须「直取主题定义」而不是读 DOM 变量：onegui-bridge.css 用
   html:root:not([data-og-skin])（0,2,1）把 --accent / --md-sys-color-secondary 都重指成
   var(--og-accent…)，压过主题注入层 :root[data-theme]（0,2,0）——读变量＝读自己的输出，
   表现就是「换什么主题都是默认蓝」（2026-10-15 用户实测 + 无头 Chrome 级联复现）。 */
const BRIDGE = readFileSync("apps/desktop/src/lib/oneguiBridge.ts", "utf8");
assert.ok(/activeThemeAccent/.test(BRIDGE), "桥没有从主题定义直取强调色（会自我吞噬成默认蓝）");
assert.ok(!/themeId && themeId !== "onethu\.theme\.ivory"\) \{\s*accent = getComputedStyle/.test(BRIDGE), "主题分支又在读 DOM 变量了");

console.log(
  "主题×System 护栏：镜像表 " +
    Object.keys(COMPAT_TO_SYSTEM).length +
    " 条与 tokens.css 一致 / " +
    themes.length +
    " 个主题 " +
    checkedPairs +
    " 对 Compat→System 同值 ✓ / 按钮读的角色确实被主题改到 ✓",
);
