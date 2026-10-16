import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const layout = read("apps/desktop/src/components/Layout.tsx");
const homeTab = read("apps/desktop/src/components/explorer/HomeTab.tsx");
const tabHost = read("apps/desktop/src/components/explorer/TabHost.tsx");
const wallpaperLibrary = read("apps/desktop/src/components/explorer/WallpaperLibrary.tsx");
void wallpaperLibrary; // 壁纸库仍在（虽然断言已改为按新模型写）
const homeCss = read("apps/desktop/src/styles/explorer-home.css");
const explorerCss = read("apps/desktop/src/styles/explorer.css");
const globalCss = read("apps/desktop/src/styles/global.css");

function block(source, selector, file) {
  const at = source.indexOf(selector);
  assert.notEqual(at, -1, `${file}: missing ${selector}`);
  const open = source.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(open + 1, i);
  }
  assert.fail(`${file}: unclosed block ${selector}`);
}

/* Home and OnePage escape the generic 1160px reader column; other pages keep it. */
assert.match(layout, /explorer\.activeId === HOME_TAB_ID[\s\S]*?is-home-canvas/);
assert.match(layout, /activePageTab\?\.page === "board"[\s\S]*?is-onepage-canvas/);
/* 固定层（时钟 + 一级程序坞）的归属：2026-10-14 拍板「挂进滚动容器随内容滚动」→ 它长在 HomeTab
   （画布的一部分）里；Layout **不许**再渲染一份（两份 = 双时钟 + 双坞，且那层没有画布上下文）。
   注意别把它挪到任何**持久** transform/contain 的祖先下面：那会造出包含块，内部固定层会相对该祖先定位。
   （page-in 的末帧是 transform:none，只在 260ms 入场动画期间短暂形成包含块，属可接受。） */
assert.doesNotMatch(layout, /<HomeChrome\s*\/>/, "HomeChrome 只许在 HomeTab 渲染一份，Layout 不许有");
assert.match(homeTab, /<HomeChrome\s*\/>/, "HomeTab 必须渲染固定层（时钟 + 一级坞）");
const homeCanvas = block(homeCss, ".explorer-shell > .explorer-content.is-home-canvas", "explorer-home.css");
assert.match(homeCanvas, /width:\s*100%/);
assert.match(homeCanvas, /max-width:\s*none/);
assert.match(homeCanvas, /padding:\s*104px 0 0 !important/);
assert.match(homeCss, /html\.is-phone \.explorer-shell > \.explorer-content\.is-home-canvas[\s\S]*?padding: 46px 0/);
assert.match(homeCss, /html\.is-phone \.explorer-panel\.is-home-canvas\s*\{\s*overflow: auto/);
assert.match(homeCss, /\.home-chrome-layer\s*\{[\s\S]*?position: fixed/);
assert.match(homeCss, /html\.is-phone \.home-chrome-layer \.chrome-time\s*\{\s*top: calc\(var\(--home-canvas-top\) \+ 16px\)/);

/* Glass needs a controlled translucent fill; a tint-only gradient reads as an empty shadow frame.
   断言按**意图**写、不锁具体令牌名与排版：曾经锁 `--glass-fill-regular` + 两行选择器列表，
   后来令牌收编成 `--glass-card-fill-2`、CSS 也压紧了 → 老写法恒红（2026-10-15 校正）。
   规则：这些"块"的填充必须来自 --glass-* 家族（也就是受控的半透明玻璃档），不能是裸色。 */
const blocksMatching = (src, re) => [...src.matchAll(re)].map((m) => m[0]);
/* 自由块的两段式：explorer-home.css 给不透明底座（--surface），global.css 的「玻璃 v4」块
   再覆盖成受控玻璃填充 —— 所以这里查**两个文件合起来**的规则集。 */
const freeItemFills = blocksMatching(homeCss + "\n" + globalCss, /\.free-item[^{]*\{[^}]*\}/g);
assert.ok(freeItemFills.length > 0, "找不到 .free-item 规则");
assert.ok(
  freeItemFills.some((b) => /background:[^;]*var\(--glass-/.test(b.replace(/\n/g, " "))),
  ".free-item 的填充必须来自 --glass-* 玻璃档（受控半透明填充）",
);
const sharedCardFills = blocksMatching(globalCss, /\.ex-sheet-body \.row-group[^{]*\{[^}]*\}/g)
  .concat(blocksMatching(globalCss, /\.card,[^{]*\.home-card[^{]*\{[^}]*\}/g));
assert.ok(sharedCardFills.length > 0, "global.css: 找不到卡片族共享填充规则");
assert.ok(
  sharedCardFills.some((b) => /background:[^;]*var\(--glass-/.test(b.replace(/\n/g, " "))),
  "卡片族共享填充必须来自 --glass-* 玻璃档",
);

/* Wallpaper contrast follows the theme's foreground token; don't reverse bare text by lum alone.
   2026-10-16：底部标签条（.ex-mobile-strip）退役——横竖都没有标签条、换标签只走标签页抽屉，
   所以这两条断言改钉**还在的栏体**（底栏 / 顶栏），守的语义不变：明暗两档都得有分支。 */
assert.match(explorerCss, /data-wallpaper-lum="dark"\] \.ex-bbar/);
assert.match(explorerCss, /data-wallpaper-lum="dark"\] \.explorer-topbar/);
assert.match(explorerCss, /data-wallpaper-lum="light"\] \.ex-bbar/);
assert.match(explorerCss, /data-wallpaper-lum="light"\] \.explorer-topbar/);
assert.doesNotMatch(explorerCss, /\.explorer-shell\[data-wallpaper-lum="dark"\] \.explorer-content h2/);
assert.match(explorerCss, /data-wallpaper-lum="dark"\] \.home-chrome-layer[\s\S]*?--text-1: #f2f4f8/);
assert.match(explorerCss, /data-wallpaper-lum="light"\] \.home-chrome-layer[\s\S]*?--text-1: #1c1f28/);

/* 壁纸模型（2026-10-15 校正）：已从"按 tab 存壁纸"演进为**单一 global 全屏档 + library**，
   旧 per-tab 文档在迁移时把一张提升为全屏档（优先常驻 home 键），绝不丢用户壁纸。
   断言按现模型写：模型里 global 是"整个软件的底色"、壳层读它、迁移路径存在。 */
const wallpaperState = read("apps/desktop/src/state/wallpaper.ts");
assert.match(wallpaperState, /global: string \| null/, "wallpaper.ts: global 全屏档字段");
assert.match(tabHost, /wallpaperSnapshot\(\)\.global/, "TabHost: 壳层读 global 全屏档");
assert.match(wallpaperState, /优先常驻 home 键|把一张提升为全屏档/, "wallpaper.ts: 旧 per-tab → global 的迁移路径");

/* The shell-level chrome triggers a pre-existing NAV cycle; defer first store read. */
const spheresState = read("apps/desktop/src/state/homeSpheres.ts");
assert.match(spheresState, /let doc: SpheresDoc \| null = null/);
assert.match(spheresState, /function currentDoc\(\): SpheresDoc/);

console.log("Explorer canvas guard: full-width home/OnePage, shell-level chrome, wallpaper contrast, and glass fills ✓");
