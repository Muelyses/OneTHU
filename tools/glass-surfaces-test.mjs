/** Missed-glass surfaces + YKT formula double-background regression.
 *
 * Two user-visible defects are locked here:
 *   1. "solid white" table headers and legacy reading plates stayed opaque under
 *      the glass skin, so the wallpaper stopped at the card edge. They must now
 *      take the reading-surface material (translucent + blurred), while the
 *      neutral skin keeps its original opaque appearance.
 *   2. The 雨课堂 (YKT) homework sandbox copied a translucent ancestor fill into the
 *      srcdoc document, painting the SAME glass twice behind formulas/LaTeX. The
 *      iframe must stay transparent when the ancestor is translucent, and an
 *      opaque ancestor must still be copied (plain-theme behaviour unchanged).
 *
 * Evidence is rendered pixels + computed styles in headless Chromium with mock
 * storage and synthetic wallpaper; it does not claim native WebView behaviour.
 *
 * Run: node tools/glass-surfaces-test.mjs
 *   ONETHU_TEST_URL to reuse a running Vite server (default http://127.0.0.1:5180);
 *   ONETHU_PLAYWRIGHT_PATH / CHROME_BIN select local tools;
 *   ONETHU_TEST_OUT overrides the report + screenshot directory.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(process.env.ONETHU_PLAYWRIGHT_PATH
  ? pathToFileURL(process.env.ONETHU_PLAYWRIGHT_PATH).href : "playwright");
const out = process.env.ONETHU_TEST_OUT ?? join(tmpdir(), "onethu-glass-surfaces");
mkdirSync(out, { recursive: true });

const checks = [];
const samples = [];
const errors = [];
const check = (ok, label) => {
  checks.push({ ok: Boolean(ok), label });
  if (!ok) errors.push(label);
  console.log((ok ? "✓ " : "✗ ") + label);
};

const requireDesktop = createRequire(new URL("../apps/desktop/package.json", import.meta.url));
let server, cacheDir;
let base = process.env.ONETHU_TEST_URL ?? "http://127.0.0.1:5180";
async function reachable(url) {
  try { const response = await fetch(url, { signal: AbortSignal.timeout(1500) }); return response.ok; } catch { return false; }
}
if (!(await reachable(base))) {
  const { createServer } = await import(pathToFileURL(join(dirname(requireDesktop.resolve("vite/package.json")), "dist/node/index.js")).href);
  cacheDir = join(tmpdir(), "onethu-surfaces-vite-" + process.pid);
  server = await createServer({
    root: resolve("apps/desktop"), configFile: resolve("apps/desktop/vite.config.ts"),
    cacheDir, logLevel: "error",
    server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false },
  });
  await server.listen();
  base = "http://127.0.0.1:" + server.httpServer.address().port;
}
const origin = new URL(base).origin;
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, headless: true });

const context = await browser.newContext({
  viewport: { width: 1400, height: 950 }, locale: "zh-CN", timezoneId: "Asia/Shanghai",
});
const page = await context.newPage();
page.setDefaultTimeout(25000);
/* The YKT iframe is intentionally sandboxed WITHOUT allow-same-origin, so any
   opaque-origin access to Web Storage throws by design. Chromium surfaces that as a
   page error from the child document; it is not an application failure and our own
   document script never touches storage (verified in tools/ykt-body-test.mjs). */
const sandboxNotes = [];
page.on("pageerror", error => {
  const message = String(error.message ?? error);
  if (/sandboxed and lacks the 'allow-same-origin' flag/.test(message)) sandboxNotes.push(message);
  else errors.push(message);
});
await page.routeWebSocket("**/*", socket => socket.close());
await page.route("**/*", route => {
  const url = new URL(route.request().url());
  return url.origin === origin || url.protocol === "data:" || url.protocol === "blob:"
    ? route.continue() : route.abort();
});
await page.addInitScript(() => {
  Object.defineProperty(navigator, "platform", { value: "Win32" });
  localStorage.setItem("onethu.experience.v1", "full");
  localStorage.setItem("onethu.privacy.v1", JSON.stringify({ acknowledged: true, cloud: true, oh: false }));
  localStorage.setItem("onethu.onboarded.phone", "1");
  localStorage.setItem("onethu.overlay.closed", "1");
});

const alphaOf = (color) => {
  if (!color || color === "transparent") return 0;
  const slash = color.match(/\/\s*([0-9.]+)(%?)\s*\)$/);
  if (slash) return slash[2] ? Number(slash[1]) / 100 : Number(slash[1]);
  const rgba = color.match(/^rgba?\(([^)]+)\)$/);
  if (!rgba) return 1;
  const parts = rgba[1].split(/[\s,/]+/).filter(Boolean);
  return parts.length < 4 ? 1 : Number(parts[3]);
};
const call = (suffix, name, args = []) => page.evaluate(async ({ suffix, name, args }) => {
  const module = await import(suffix);
  return module[name](...args);
}, { suffix, name, args });

try {
  await page.goto(base + "/?explorer-preview=home");
  await page.locator(".free-item:visible").first().waitFor();
  await page.waitForTimeout(500);
  await call("/src/lib/glassLevel.ts", "setGlassLevel", ["clear"]);
  await call("/src/state/wallpaper.ts", "setGlobalWallpaper", ["builtin:aurora"]);
  await page.waitForTimeout(1200);
  check(await page.evaluate(() => document.documentElement.dataset.ogSkin === "glass"), "glass skin active");

  /* ── 1. reading surfaces: table headers stop being opaque plates ─────── */
  const headers = await page.evaluate(() => {
    const fixture = document.createElement("div");
    fixture.id = "og-surface-fixture";
    fixture.innerHTML = `
      <table class="og-table"><thead><tr><th>课程</th><th>截止</th></tr></thead>
        <tbody><tr><td>示例</td><td>周五</td></tr></tbody></table>
      <table class="data-table"><thead><tr><th>旧表头</th></tr></thead>
        <tbody><tr><td>行</td></tr></tbody></table>
      <div class="dock-md"><pre><code>const x = 1;</code></pre></div>`;
    document.body.append(fixture);
    const read = (selector) => {
      const el = document.querySelector(selector);
      const style = el ? getComputedStyle(el) : null;
      return style ? {
        background: style.backgroundColor,
        image: style.backgroundImage,
        blur: style.backdropFilter,
      } : null;
    };
    return {
      og: read("#og-surface-fixture .og-table th"),
      legacy: read("#og-surface-fixture .data-table th"),
      code: read("#og-surface-fixture .dock-md pre"),
    };
  });
  samples.push({ headers });
  check(alphaOf(headers.og.background) > 0.4 && alphaOf(headers.og.background) < 0.9,
    "glass: .og-table header uses a translucent reading surface (" + alphaOf(headers.og.background).toFixed(2) + ")");
  check(headers.og.blur.includes("blur("), "glass: .og-table header keeps the surface blur");
  check(alphaOf(headers.legacy.background) === 0,
    "glass: legacy .data-table header is fully transparent (no white band at all)");
  check(alphaOf(headers.code.background) > 0.4 && alphaOf(headers.code.background) < 0.9,
    "glass: legacy markdown code plate uses the reading surface (" + alphaOf(headers.code.background).toFixed(2) + ")");

  // Neutral skin must not change: headers stay opaque (no new softness off-glass).
  await call("/src/lib/glassLevel.ts", "setGlassLevel", ["balanced"]);
  await page.waitForTimeout(400);
  const neutral = await page.evaluate(() => {
    const header = document.querySelector("#og-surface-fixture .og-table th");
    const legacy = document.querySelector("#og-surface-fixture .data-table th");
    return {
      skin: document.documentElement.dataset.ogSkin,
      og: header ? getComputedStyle(header).backgroundColor : null,
      legacy: legacy ? getComputedStyle(legacy).backgroundColor : null,
    };
  });
  samples.push({ neutral });
  check(neutral.skin === "neutral" && alphaOf(neutral.og) === 1 && alphaOf(neutral.legacy) === 1,
    "neutral skin keeps table headers opaque (no washed-out base theme)");

  // Back to the glass skin before shape/material fixtures (the neutral check above
  // deliberately left the base skin active).
  await call("/src/lib/glassLevel.ts", "setGlassLevel", ["clear"]);
  await page.waitForTimeout(700);

  // Controls keep ordinary rounded rectangles and never a pill/capsule shape.
  const shapes = await page.evaluate(() => {
    const radius = (selector) => {
      const el = document.querySelector(selector);
      return el ? parseFloat(getComputedStyle(el).borderTopLeftRadius) : null;
    };
    return {
      oneshot: radius(".oneshot-button"),
      capsule: radius(".ohx-capsule"),
      inputRadius: (() => {
        const shell = document.createElement("div");
        shell.className = "og-input";
        shell.id = "og-shape-fixture";
        shell.innerHTML = "<input class=\"og-input-el\">";
        document.body.append(shell);
        const value = parseFloat(getComputedStyle(shell).borderTopLeftRadius);
        shell.remove();
        return value;
      })(),
    };
  });
  samples.push({ shapes });
  check(shapes.oneshot !== null && shapes.oneshot > 100, "bottom quick-launch buttons are capsules again (" + shapes.oneshot + "px)");
  check(shapes.capsule !== null && shapes.capsule > 100, "top search bar is a true capsule (" + shapes.capsule + "px)");

  // Native control never paints a second (inner) focus ring.
  const focus = await page.evaluate(() => {
    const shell = document.createElement("div");
    shell.className = "og-input";
    shell.innerHTML = "<input class=\"og-input-el\" id=\"og-focus-fixture\">";
    document.body.append(shell);
    const input = shell.querySelector("input");
    input.focus();
    const value = {
      shadow: getComputedStyle(input).boxShadow,
      outline: getComputedStyle(input).outlineStyle,
      animation: getComputedStyle(input).animationName,
    };
    shell.remove();
    return value;
  });
  samples.push({ focus });
  check(focus.shadow === "none" && focus.outline === "none" && focus.animation === "none",
    "the native input owns no focus ring/animation (single ring on the shell only)");

  // List header (segmented track) and action buttons share the reading material.
  const material = await page.evaluate(() => {
    const fixture = document.createElement("div");
    fixture.id = "og-material-fixture";
    fixture.innerHTML = '<div class="segmented seg-track"><button>A</button><button>B</button></div>'
      + '<button class="og-btn og-btn--outline">查看全部作业</button>'
      + '<button class="task-entry">全部作业 →</button>'
      + '<div class="og-list og-list--flush" id="og-list-fixture"><div class="og-row">行一</div><div class="og-row">行二</div></div>';
    document.body.append(fixture);
    const read = (selector) => {
      const el = document.querySelector(selector);
      const style = getComputedStyle(el);
      return { bg: style.backgroundColor, border: style.borderTopColor, shadow: style.boxShadow.slice(0, 90), blur: style.backdropFilter };
    };
    return {
      segmented: read("#og-material-fixture .segmented"),
      outline: read("#og-material-fixture .og-btn--outline"),
      entry: read("#og-material-fixture .task-entry"),
      row: (() => {
        const el = document.querySelector("#og-material-fixture .og-list--flush .og-row");
        const style = getComputedStyle(el);
        return { radius: parseFloat(style.borderTopLeftRadius), corner: style.cornerShape, bg: style.backgroundColor };
      })(),
    };
    fixture.remove();
  });
  samples.push({ material });
  check(alphaOf(material.segmented.bg) > 0.4 && alphaOf(material.segmented.bg) < 0.9 && material.segmented.blur.includes("blur("),
    "glass: list header (segmented track) uses the reading material, not an opaque plate");
  check(alphaOf(material.outline.bg) < 0.9 && material.outline.border === "rgba(0, 0, 0, 0)",
    "glass: outline actions have a translucent veil and no hard border");
  check(alphaOf(material.entry.bg) < 0.9 && material.entry.border === "rgba(0, 0, 0, 0)",
    "glass: legacy .task-entry actions have the same glass veil without a hard border");
  check(material.row.radius > 0 && (material.row.corner === "squircle" || material.row.corner === "superellipse(2)"),
    "flush list rows are chamfered (not square blocks inside a superellipse container)");

  await call("/src/lib/glassLevel.ts", "setGlassLevel", ["clear"]);
  await page.waitForTimeout(900);
  await page.evaluate(() => document.getElementById("og-surface-fixture")?.remove());

  /* ── 2. YKT sandbox: the glass must be painted exactly once ──────────── */
  const yktUnit = await page.evaluate(async () => {
    const body = await import("/src/components/exthw/ProblemBody.tsx");
    const ykt = await import("/src/lib/yktBody.ts");
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;overflow:hidden";
    const glassParent = document.createElement("div");
    glassParent.style.cssText = "background:rgba(255,255,255,0.36)";
    const child = document.createElement("div");
    glassParent.append(child);
    const paper = document.createElement("div");
    paper.style.cssText = "background:#f4f1ea";
    const paperChild = document.createElement("div");
    paper.append(paperChild);
    host.append(glassParent, paper);
    document.body.append(host);
    const translucent = body.resolveEffectiveBg(child);
    const opaque = body.resolveEffectiveBg(paperChild);
    const flushCss = ykt.yktDocCss({ text: "#ffffff", textSoft: "#cccccc", bg: "transparent", border: "#333", link: "#9cf", fallbackBg: "#222", flush: true });
    const legacyCss = ykt.yktDocCss({ text: "#ffffff", textSoft: "#cccccc", bg: "transparent", border: "#333", link: "#9cf", fallbackBg: "#222" });
    host.remove();
    return { translucent, opaque, flushCss, legacyCss };
  });
  samples.push({ yktUnit });
  check(yktUnit.translucent.bg === "transparent" && yktUnit.translucent.flush === true,
    "translucent ancestor is NOT copied into the sandbox document (flush mode)");
  check(yktUnit.opaque.bg !== "transparent" && yktUnit.opaque.flush === false,
    "opaque paper ancestor is still copied (plain-theme behaviour unchanged)");
  check(yktUnit.flushCss.includes("background:transparent") && !yktUnit.flushCss.includes("#16181d")
    && !yktUnit.flushCss.includes("color-scheme:dark") && yktUnit.flushCss.includes("color-scheme:light"),
    "flush sandbox keeps a transparent canvas (no opaque dark paper plate)");
  check(yktUnit.legacyCss.includes("#16181d") && yktUnit.legacyCss.includes("color-scheme:dark"),
    "non-flush dark sandbox still falls back to an opaque dark paper");

  // Pixel proof: a transparent sandbox changes nothing behind it; a copied tint would.
  const yktPixel = await page.evaluate(async () => {
    const body = await import("/src/components/exthw/ProblemBody.tsx");
    const ykt = await import("/src/lib/yktBody.ts");
    const host = document.createElement("div");
    host.id = "og-ykt-bench";
    host.style.cssText = "position:fixed;left:40px;bottom:40px;width:360px;height:220px;z-index:9000;"
      + "background-image:repeating-linear-gradient(90deg,#000 0 10px,#fff 10px 20px)";
    const card = document.createElement("div");
    card.style.cssText = "position:absolute;inset:20px;border-radius:18px;background:var(--og-fill-surface)";
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:absolute;inset:10px;width:calc(100% - 20px);height:calc(100% - 20px);border:0;display:block;background:transparent";
    frame.setAttribute("sandbox", "allow-scripts");
    card.append(frame);
    host.append(card);
    document.body.append(host);
    const theme = body.readYktDocTheme(card);
    frame.srcdoc = ykt.buildYktProblemDoc({ html: "<p></p>", theme });
    await new Promise(resolve => {
      const done = () => setTimeout(resolve, 250);
      frame.addEventListener("load", done, { once: true });
      setTimeout(done, 900);
    });
    const rect = frame.getBoundingClientRect();
    return {
      theme,
      srcdoc: frame.getAttribute("srcdoc") ?? "",
      clip: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
    };
  });
  samples.push({ yktPixel: { theme: yktPixel.theme, hasTransparent: yktPixel.srcdoc.includes("background:transparent") } });
  check(yktPixel.theme.flush === true && yktPixel.theme.bg === "transparent",
    "real ProblemBody theme resolution flags the glass container as flush");
  check(yktPixel.srcdoc.includes("background:transparent") && !/background:rgba?\(255/.test(yktPixel.srcdoc),
    "the generated sandbox document paints no second glass tint");
  const withFrame = (await page.screenshot({ clip: yktPixel.clip, animations: "disabled" })).toString("base64");
  await page.evaluate(() => {
    const frame = document.querySelector("#og-ykt-bench iframe");
    if (frame) frame.style.visibility = "hidden";
  });
  await page.waitForTimeout(220);
  const withoutFrame = (await page.screenshot({ clip: yktPixel.clip, animations: "disabled" })).toString("base64");
  const diff = await page.evaluate(async ({ a, b }) => {
    const load = async (data) => {
      const image = new Image();
      image.src = "data:image/png;base64," + data;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, canvas.width, canvas.height);
    };
    const A = await load(a), B = await load(b);
    let sum = 0;
    for (let i = 0; i < A.data.length; i += 4) {
      sum += Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]);
    }
    return { mean: sum / (A.data.length / 4) };
  }, { a: withFrame, b: withoutFrame });
  samples.push({ yktPixelDiff: diff });
  check(diff.mean < 1.5, "sandbox is visually transparent (mean delta " + diff.mean.toFixed(2) + " vs hidden)");
  await page.evaluate(() => document.getElementById("og-ykt-bench")?.remove());

  /* ── 3. Dark scheme keeps the same single-layer rule ─────────────────── */
  await page.evaluate(() => { document.documentElement.dataset.scheme = "dark"; });
  await page.waitForTimeout(800);
  const darkTheme = await page.evaluate(async () => {
    const body = await import("/src/components/exthw/ProblemBody.tsx");
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;overflow:hidden;background:rgba(30,30,34,0.4)";
    const child = document.createElement("div");
    host.append(child);
    document.body.append(host);
    const theme = body.readYktDocTheme(child);
    host.remove();
    return theme;
  });
  samples.push({ darkTheme });
  check(darkTheme.flush === true && darkTheme.bg === "transparent", "dark glass sandbox also stays flush/transparent");

  /* ── 3b. 信息-成绩 data table: transparent header + chamfered row blocks ── */
  await page.goto(base + "/?explorer-preview=page&page=info");
  await page.waitForTimeout(2200);
  await call("/src/lib/glassLevel.ts", "setGlassLevel", ["clear"]);
  await page.waitForTimeout(800);
  const gradeTable = await page.evaluate(() => {
    const host = document.createElement("div");
    host.id = "grade-table-fixture";
    host.innerHTML = '<div class="card" style="padding:0;overflow:hidden">'
      + '<table class="data-table"><thead><tr><th>课程</th><th class="num">学分</th><th class="num">等级</th><th class="num">绩点</th></tr></thead>'
      + '<tbody><tr><td class="cell-title">高等数学</td><td class="num">5</td><td class="num">A</td><td class="num">4.0</td></tr>'
      + '<tr><td class="cell-title">大学物理</td><td class="num">4</td><td class="num">B+</td><td class="num">3.6</td></tr></tbody></table></div>';
    document.body.append(host);
    const read = (selector) => {
      const el = document.querySelector(selector);
      const style = getComputedStyle(el);
      return {
        bg: style.backgroundColor,
        radius: parseFloat(style.borderTopLeftRadius),
        radiusEnd: parseFloat(style.borderTopRightRadius),
        border: style.borderBottomWidth,
        blur: style.backdropFilter,
      };
    };
    const value = {
      table: getComputedStyle(document.querySelector("#grade-table-fixture table")).borderCollapse,
      th: read("#grade-table-fixture th"),
      firstTd: read("#grade-table-fixture tbody td:first-child"),
      lastTd: read("#grade-table-fixture tbody td:last-child"),
    };
    host.remove();
    return value;
  });
  samples.push({ gradeTable });
  const topGap = await page.evaluate(() => {
    const bar = document.querySelector(".onego-bookmarks")?.getBoundingClientRect();
    const first = [...document.querySelectorAll(".explorer-content .explorer-panel")]
      .map((el) => el.getBoundingClientRect())
      .find((rect) => rect.width > 200 && rect.height > 40 && rect.top > 0);
    return bar && first ? Math.round(first.top - bar.bottom) : null;
  });
  samples.push({ topGap });
  check(topGap !== null && topGap >= 12, "ordinary pages leave a top margin below the OneGO bookmarks bar (" + topGap + "px)");
  check(gradeTable.table === "separate", "grade table uses separated rows so each row can be chamfered");
  check(alphaOf(gradeTable.th.bg) === 0, "grade table header is transparent (no opaque white band)");
  check(gradeTable.firstTd.radius > 0 && gradeTable.lastTd.radiusEnd > 0, "grade table rows have rounded ends (chamfered list)");

  /* ── 4. Settings/我的 overlay: three solid regions ─────────────────────── */
  await page.evaluate(() => { document.documentElement.dataset.scheme = "light"; });
  await page.goto(base + "/?explorer-preview=overlay&settings-tab=外观");
  await page.waitForTimeout(2600);
  await call("/src/lib/glassLevel.ts", "setGlassLevel", ["clear"]);
  await page.waitForTimeout(900);
  const sheet = await page.evaluate(() => {
    const panel = document.querySelector(".settings-panel");
    const mask = panel?.parentElement;
    const head = panel?.querySelector(".settings-head");
    const layout = panel?.querySelector(".workbench-settings-layout");
    const nav = panel?.querySelector(".workbench-settings-nav");
    const content = panel?.querySelector(".workbench-settings-content");
    const card = content?.querySelector(".og-card");
    const read = (el) => {
      if (!el) return null;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        bg: style.backgroundColor, backdrop: style.backdropFilter,
        radius: parseFloat(style.borderTopLeftRadius),
        border: parseFloat(style.borderTopWidth),
        padding: style.padding, gap: style.gap,
        rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
      };
    };
    return {
      panel: read(panel), mask: read(mask), head: read(head), layout: read(layout),
      nav: read(nav), content: read(content), card: read(card),
      pagehead: Boolean(panel?.querySelector(".og-pagehead")),
      modeInContent: Boolean(content?.querySelector("[data-mode-control]") && content?.querySelector("[data-language-control]")),
      modeSectionTab: content?.querySelector("[data-mode-control]")?.closest("[data-settings-section]")?.getAttribute("data-settings-tab") ?? null,
      tabsGap: (() => { const tabs = panel?.querySelector(".workbench-settings-tabs"); return tabs ? getComputedStyle(tabs).gap : null; })(),
      activeTab: (() => {
        const el = panel?.querySelector(".workbench-settings-nav button.is-active");
        return el ? { bg: getComputedStyle(el).backgroundColor } : null;
      })(),
      idleTab: (() => {
        const el = panel?.querySelector(".workbench-settings-nav button:not(.is-active)");
        return el ? { bg: getComputedStyle(el).backgroundColor } : null;
      })(),
    };
  });
  samples.push({ sheet });
  const entrance = await page.evaluate(() => {
    const panel = document.querySelector(".settings-panel");
    const mask = document.querySelector(".settings-mask");
    return {
      panel: panel ? getComputedStyle(panel).animationName : null,
      mask: mask ? getComputedStyle(mask).animationName : null,
    };
  });
  samples.push({ entrance });
  check(entrance.panel === "none" && entrance.mask === "none",
    "settings entrance is script-owned (CSS cannot restart it after mount)");
  check(sheet.panel && alphaOf(sheet.panel.bg) === 0, "settings window itself is transparent so the glass navigation can show the wallpaper");
  check(sheet.head && alphaOf(sheet.head.bg) === 1, "top title bar is a solid full-width band");
  check(sheet.nav && alphaOf(sheet.nav.bg) < 0.9 && sheet.nav.backdrop.includes("blur(") && sheet.nav.padding !== "0px" && sheet.nav.radius === 0 && sheet.nav.border === 0,
    "left navigation is liquid glass with inner padding and no radius/border (" + (sheet.nav ? alphaOf(sheet.nav.bg).toFixed(2) : "-") + " + blur)");
  check(sheet.content && alphaOf(sheet.content.bg) === 1 && sheet.content.padding !== "0px" && sheet.content.radius === 0 && sheet.content.border === 0,
    "right content is a solid reading surface with natural inner padding");
  check(sheet.layout?.gap === "0px", "the two lower regions meet with no gap");
  check(sheet.nav && sheet.content && Math.abs(sheet.nav.rect.y - sheet.content.rect.y) < 0.5
    && Math.abs(sheet.nav.rect.h - sheet.content.rect.h) < 0.5
    && Math.abs((sheet.nav.rect.x + sheet.nav.rect.w) - sheet.content.rect.x) < 0.5,
    "navigation and content are aligned edge-to-edge and equal height");
  check(sheet.pagehead === false, "in-window page title row is removed");
  check(sheet.modeInContent === true && sheet.modeSectionTab === "功能", "使用模式 / 语言 now live inside the 功能 tab content");
  check(sheet.tabsGap && parseFloat(sheet.tabsGap) >= 6, "navigation tabs have breathing room between them (" + sheet.tabsGap + ")");
  check(sheet.activeTab && alphaOf(sheet.activeTab.bg) > 0 && alphaOf(sheet.activeTab.bg) < 1,
    "selected tab is marked by a translucent mask, not an opaque fill");
  check(sheet.idleTab && alphaOf(sheet.idleTab.bg) === 0, "unselected tabs have no background");
  check(sheet.card && alphaOf(sheet.card.bg) === 0, "cards inside the solid pane add no second white plate");
  check(sheet.mask?.backdrop.includes("blur("), "the scrim still isolates the window from the wallpaper behind it");
  /* Every settings tab carries an icon and its own subtitle (no shared generic line). */
  const tabMeta = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll(".workbench-settings-nav button")];
    const alignment = buttons.map((button) => {
      const label = button.querySelector(".og-btn-label");
      const icon = label?.querySelector("svg");
      if (!label || !icon) return null;
      const iconRect = icon.getBoundingClientRect();
      const node = [...label.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
      if (!node) return null;
      const range = document.createRange();
      range.selectNodeContents(node);
      const textRect = range.getBoundingClientRect();
      return {
        iconCenter: Math.round(iconRect.y + iconRect.height / 2),
        textCenter: Math.round(textRect.y + textRect.height / 2),
        gap: Math.round(textRect.x - iconRect.right),
      };
    });
    return {
      count: buttons.length,
      withIcon: buttons.filter((b) => !!b.querySelector("svg")).length,
      labels: buttons.map((b) => b.textContent.trim()),
      alignment,
    };
  });
  const subs = [];
  for (const label of tabMeta.labels) {
    await page.locator(".workbench-settings-nav button", { hasText: label }).first().click();
    await page.waitForTimeout(120);
    subs.push(await page.locator(".workbench-settings-title p").innerText());
  }
  samples.push({ tabMeta, subs });
  check(tabMeta.withIcon === tabMeta.count && tabMeta.count >= 7, "every settings tab has an icon indicator");
  check(tabMeta.alignment.every((a) => a && Math.abs(a.iconCenter - a.textCenter) <= 1 && a.gap >= 10),
    "tab icons and labels share one horizontal line with a readable gap (" + (tabMeta.alignment[0]?.gap ?? "-") + "px)");
  check(subs.every((text) => text.trim().length > 0) && new Set(subs).size === subs.length,
    "each settings tab has its own subtitle copy");
  /* Navigation and content scroll independently: the nav is pinned and reaches the
     window bottom; only the right pane scrolls. */
  await page.locator(".workbench-settings-nav button", { hasText: "外观" }).first().click();
  await page.waitForTimeout(350);
  const scrollBefore = await page.evaluate(() => {
    const body = document.querySelector(".explorer-settings-body");
    const nav = document.querySelector(".workbench-settings-nav");
    const content = document.querySelector(".workbench-settings-content");
    const navRect = nav.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    return {
      navTop: navRect.top, navBottom: navRect.bottom, bodyBottom: bodyRect.bottom,
      navOverflow: getComputedStyle(nav).overflowY,
      contentClient: content.clientHeight, contentScroll: content.scrollHeight,
      bodyScrollTop: body.scrollTop,
    };
  });
  await page.evaluate(() => { document.querySelector(".workbench-settings-content").scrollTop = 260; });
  await page.waitForTimeout(180);
  const scrollAfter = await page.evaluate(() => {
    const body = document.querySelector(".explorer-settings-body");
    const nav = document.querySelector(".workbench-settings-nav");
    const content = document.querySelector(".workbench-settings-content");
    return {
      navTop: nav.getBoundingClientRect().top,
      contentScrollTop: content.scrollTop,
      bodyScrollTop: body.scrollTop,
    };
  });
  samples.push({ scrollBefore, scrollAfter });
  check(scrollBefore.contentScroll > scrollBefore.contentClient,
    "settings content is taller than the window and becomes its own scroll container");
  check(scrollAfter.contentScrollTop > 0 && scrollAfter.bodyScrollTop === 0,
    "only the right content pane scrolls (shared outer scroller stays at 0)");
  check(Math.abs(scrollAfter.navTop - scrollBefore.navTop) < 0.5,
    "left navigation stays pinned while content scrolls");
  check(Math.abs(scrollBefore.navBottom - scrollBefore.bodyBottom) < 1,
    "left navigation extends to the bottom of the settings window");
  /* ── 4b. 名片 / 插件 = 普通实心页；Harness = 与设置页同构的三段式 ───── */
  const pageForm = async (label) => {
    await page.locator(".settings-seg-item", { hasText: label }).first().click();
    await page.waitForTimeout(650);
    return page.evaluate(() => {
      const panel = document.querySelector(".settings-panel");
      const body = document.querySelector(".explorer-settings-body");
      const nav = document.querySelector(".workbench-settings-nav");
      const content = document.querySelector(".workbench-settings-content");
      const read = (el) => {
        if (!el) return null;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return { bg: style.backgroundColor, padding: style.padding, overflow: style.overflowY, backdrop: style.backdropFilter, top: rect.top, bottom: rect.bottom, h: rect.height, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
      };
      return { panel: read(panel), body: read(body), nav: read(nav), content: read(content), bodyClass: body?.className };
    });
  };
  const profile = await pageForm("我的名片");
  const plugins = await pageForm("插件");
  const harness = await pageForm("Harness");
  samples.push({ profile, plugins, harness });
  check(profile.panel && alphaOf(profile.panel.bg) === 1, "名片页 background is solid again");
  check(profile.body && profile.body.padding === "24px" && profile.body.overflow === "auto", "名片页 keeps normal page margins and whole-page scrolling");
  check(plugins.panel && alphaOf(plugins.panel.bg) === 1, "插件页 background is solid again");
  check(plugins.body && plugins.body.padding === "24px" && plugins.body.overflow === "auto", "插件页 keeps normal page margins and whole-page scrolling");
  check(harness.nav && harness.nav.backdrop.includes("blur(") && alphaOf(harness.nav.bg) < 0.9,
    "Harness page reuses the settings layout: glass left navigation");
  check(harness.content && alphaOf(harness.content.bg) === 1 && harness.content.padding !== "0px",
    "Harness right content is a solid pane with inner padding");
  check(harness.content.scrollHeight > harness.content.clientHeight && harness.nav.top === harness.content.top,
    "Harness content scrolls inside the pane while its navigation stays pinned");
  check(harness.nav.bottom === harness.body.bottom, "Harness navigation reaches the bottom like the settings page");
  /* Harness 高级配置：内容不横向溢出；遗留设置行与分节标题对齐设置页；
     表单字段必须是单列竖排（sheet 模式），而不是被 Grid 挤成一行互相压字。 */
  await page.locator(".workbench-settings-nav button", { hasText: "高级配置" }).first().click();
  await page.waitForTimeout(700);
  const advanced = await page.evaluate(() => {
    const content = document.querySelector(".workbench-settings-content");
    content.scrollTop = 0;
    const contentRect = content.getBoundingClientRect();
    const padLeft = parseFloat(getComputedStyle(content).paddingLeft);
    const originX = contentRect.x + padLeft;
    const row = content.querySelector(".setting-row");
    const rowStyle = row ? getComputedStyle(row) : null;
    const section = content.querySelector(".og-section-titles");
    const sectionStyle = section ? getComputedStyle(section) : null;
    const sectionRect = section ? section.getBoundingClientRect() : null;
    // Sheet-mode settings body = one field per row (vertical stack).
    const fixture = document.createElement("div");
    fixture.className = "og-stack og-stack--gap-2";
    fixture.id = "oh-field-fixture";
    fixture.innerHTML = Array.from({ length: 5 }, (_, i) =>
      '<div class="og-field"><span class="og-field-label">字段 ' + (i + 1) + '</span><div class="og-input"><input class="og-input-el" /></div></div>').join("");
    content.append(fixture);
    const rects = [...fixture.querySelectorAll(".og-field")].map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    fixture.remove();
    return {
      contentWidth: content.clientWidth,
      contentScrollWidth: content.scrollWidth,
      originX,
      rowPaddingTop: rowStyle?.paddingTop,
      rowPaddingBottom: rowStyle?.paddingBottom,
      rowPaddingLeft: rowStyle?.paddingLeft,
      rowTitleSize: row ? getComputedStyle(row.querySelector(".setting-title")).fontSize : null,
      sectionPaddingLeft: sectionStyle?.paddingLeft,
      sectionX: sectionRect?.x,
      rects,
    };
  });
  samples.push({ advanced });
  check(advanced.contentScrollWidth <= advanced.contentWidth + 1,
    "Harness advanced content has no horizontal overflow");
  check(advanced.rowPaddingTop === "16px" && advanced.rowPaddingBottom === "16px" && advanced.rowPaddingLeft === "0px",
    "legacy settings rows use the settings-page rhythm (16px block rhythm, flush inline)");
  check(advanced.sectionPaddingLeft === "0px" && Math.abs(advanced.sectionX - advanced.originX) < 1,
    "Harness section titles align with the settings-page content origin");
  const stacked = advanced.rects.length === 5
    && advanced.rects.every((r, i) => i === 0 || (r.y > advanced.rects[i - 1].y && r.w > 100))
    && new Set(advanced.rects.map((r) => Math.round(r.w))).size === 1;
  check(stacked, "sheet-mode form fields stack vertically at full width (no squeezed grid row)");
  /* `.og-stack--fill` inside the (block-flow) content used to lock height:100% and
     shrink children below their content → rows/fields painted over each other.
     Regression: a fill stack with tall settings rows must keep natural heights. */
  const fillLock = await page.evaluate(() => {
    const content = document.querySelector(".workbench-settings-content");
    const fixture = document.createElement("div");
    fixture.className = "og-stack og-stack--fill og-stack--gap-3";
    fixture.id = "oh-fill-fixture";
    const row = (label) => '<div class="og-settings-row"><div class="og-settings-row-main">'
      + '<div class="og-settings-row-title">' + label + '</div>'
      + '<div class="og-settings-row-sub">这是一段会换成三行的说明文字，用来验证设置行不会把自身高度锁在单行。'
      + '这是一段会换成三行的说明文字，用来验证设置行不会把自身高度锁在单行。</div></div></div>';
    fixture.innerHTML = row("权限") + row("命令清单");
    content.append(fixture);
    const stackStyle = getComputedStyle(fixture);
    const rects = [...fixture.querySelectorAll(".og-settings-row")].map((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, h: r.height };
    });
    const out = {
      height: stackStyle.height,
      rows: rects,
      overflow: rects.length === 2 ? rects[1].top - rects[0].bottom : null,
    };
    fixture.remove();
    return out;
  });
  samples.push({ fillLock });
  check(fillLock.rows.every((r) => r.h > 80), "fill stacks no longer squeeze settings rows below their content");
  check(fillLock.overflow !== null && fillLock.overflow >= 0,
    "consecutive settings rows never overlap vertically");

  await page.screenshot({ path: join(out, "surfaces.png"), animations: "disabled" });
} catch (error) {
  await page.screenshot({ path: join(out, "failure.png") }).catch(() => undefined);
  errors.push(String(error?.message ?? error));
  if (error?.stack) console.error(error.stack);
} finally {
  writeFileSync(join(out, "report.json"), JSON.stringify({
    passed: errors.length === 0 && checks.every(item => item.ok), checks, samples, errors, sandboxNotes, out,
  }, null, 2));
  await context.close();
  await browser.close();
  if (server) await server.close();
}

const failed = checks.filter(item => !item.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (errors.length) {
  console.error("failures:\n" + errors.map(error => " - " + error).join("\n"));
  process.exitCode = 1;
}
