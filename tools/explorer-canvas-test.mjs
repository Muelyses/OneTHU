import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const layout = read("apps/desktop/src/components/Layout.tsx");
const homeTab = read("apps/desktop/src/components/explorer/HomeTab.tsx");
const tabHost = read("apps/desktop/src/components/explorer/TabHost.tsx");
const wallpaperLibrary = read("apps/desktop/src/components/explorer/WallpaperLibrary.tsx");
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
assert.match(layout, /explorer\.activeId === HOME_TAB_ID \? <HomeChrome \/> : null/);
assert.doesNotMatch(homeTab, /<HomeChrome\s*\/>/, "HomeChrome must not sit under page-in's transformed subtree");
const homeCanvas = block(homeCss, ".explorer-shell > .explorer-content.is-home-canvas", "explorer-home.css");
assert.match(homeCanvas, /width:\s*100%/);
assert.match(homeCanvas, /max-width:\s*none/);
assert.match(homeCanvas, /padding:\s*104px 0 0 !important/);
assert.match(homeCss, /html\.is-phone \.explorer-shell > \.explorer-content\.is-home-canvas[\s\S]*?padding: 46px 0/);
assert.match(homeCss, /html\.is-phone \.explorer-panel\.is-home-canvas\s*\{\s*overflow: auto/);
assert.match(homeCss, /\.home-chrome-layer\s*\{[\s\S]*?position: fixed/);
assert.match(homeCss, /html\.is-phone \.home-chrome-layer \.chrome-time\s*\{\s*top: calc\(var\(--home-canvas-top\) \+ 16px\)/);

/* Glass needs a controlled translucent fill; a tint-only gradient reads as an empty shadow frame. */
const freeItem = block(homeCss, ".free-item {\n  background:", "explorer-home.css");
assert.match(freeItem, /var\(--glass-fill-regular\)/);
const sharedCards = block(globalCss, ".card,\n.home-card,\n.setting-group,\n.ex-sheet-body .row-group", "global.css");
assert.match(sharedCards, /var\(--glass-fill-regular\)/);

/* Wallpaper contrast follows the theme's foreground token; don't reverse bare text by lum alone. */
assert.match(explorerCss, /data-wallpaper-lum="dark"\] \.ex-mobile-strip/);
assert.match(explorerCss, /data-wallpaper-lum="light"\] \.ex-mobile-strip/);
assert.doesNotMatch(explorerCss, /\.explorer-shell\[data-wallpaper-lum="dark"\] \.explorer-content h2/);
assert.match(explorerCss, /data-wallpaper-lum="dark"\] \.home-chrome-layer[\s\S]*?--text-1: #f2f4f8/);
assert.match(explorerCss, /data-wallpaper-lum="light"\] \.home-chrome-layer[\s\S]*?--text-1: #1c1f28/);

/* Home is a full-screen wallpaper target; file uploads and thumbnail picks share that target. */
assert.match(tabHost, /t\.kind === "home" \? "global"/);
assert.match(tabHost, /\.\.\.\(!isHome \? \[/);
assert.match(wallpaperLibrary, /scope === "global" \|\| tabKey === "global"/);

/* The shell-level chrome triggers a pre-existing NAV cycle; defer first store read. */
const spheresState = read("apps/desktop/src/state/homeSpheres.ts");
assert.match(spheresState, /let doc: SpheresDoc \| null = null/);
assert.match(spheresState, /function currentDoc\(\): SpheresDoc/);

console.log("Explorer canvas guard: full-width home/OnePage, shell-level chrome, wallpaper contrast, and glass fills ✓");
