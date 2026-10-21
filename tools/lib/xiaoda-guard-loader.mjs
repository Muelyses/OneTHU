/**
 * 护栏专用解析钩子：把 `components/Layout.js`（React 组件 + 大依赖图）换成纯数据替身，
 * 于是 state/homeSpheres.ts 能在 Node 里被真实导入——程序坞的「读档补停靠」是行为，
 * 只做源码文本断言证明不了它。
 *
 * 替身 NAV 的页序取自 tools/lib/xiaoda-guard-nav.json（与 Layout.NAV 同形：清小搭在第 9 位，
 * 即「前八颗默认球」之外，正好检验 defaultDoc 的追加分支）。
 * 其余说明符沿用仓库既有约定：core 旧源码以 .js 相互引用 → 本钩子回退同名 .ts / .tsx。
 */
import { readFileSync } from "node:fs";
import { register } from "node:module";

const NAV_JSON = new URL("./xiaoda-guard-nav.json", import.meta.url);
const STUB_URL = "onethu-stub:layout";

export async function resolve(specifier, context, next) {
  if (/\/components\/Layout\.js$/.test(specifier)) {
    return { url: STUB_URL, shortCircuit: true, format: "module" };
  }
  try {
    return await next(specifier, context);
  } catch (e) {
    if (e?.code === "ERR_MODULE_NOT_FOUND" && specifier.endsWith(".js")) {
      try {
        return await next(specifier.replace(/\.js$/, ".ts"), context);
      } catch (e2) {
        if (e2?.code === "ERR_MODULE_NOT_FOUND") return next(specifier.replace(/\.js$/, ".tsx"), context);
        throw e2;
      }
    }
    throw e;
  }
}

export async function load(url, context, next) {
  if (url === STUB_URL) {
    const { pages } = JSON.parse(readFileSync(NAV_JSON, "utf8"));
    const nav = pages.map((p) => ({ page: p.page, label: p.label, icon: () => null }));
    return { format: "module", shortCircuit: true, source: `export const NAV = ${JSON.stringify(nav)};` };
  }
  return next(url, context);
}

register(new URL(import.meta.url));
