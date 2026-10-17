/**
 * 修改后的 searchRows：检索行注册块的**唯一离线解析器**（tools 共享；2026-10-12 task-22）。
 *
 * 为什么是它：`state/searchRows.ts` 是运行时唯一真源，而护栏（coverage / landing / gen / sync）
 * 全部离线跑 —— 若每份脚本自己解析一遍，任何 token 集合的漂移都会让 4 份口径悄悄开叉。
 * parseSearchRows：覆盖 defineSearchRows([...]) 块、识别リテラル字段与数组/嵌套对象，
 * 额外携带 breadcrumb/visible/fallbackNote/root/landOn（gen-oh-routes 用它们生成子字段）。
 */
import { readFileSync } from "node:fs";

/** 全部注册了定域检索行的文件（改这行清单 = 同步 coverage / landing / gen） */
export const SEARCH_ROW_FILES = [
  "apps/desktop/src/components/OhSettingsPage.tsx",
  "apps/desktop/src/components/VoiceSettingsSection.tsx",
  "apps/desktop/src/components/OverlaySettingsSection.tsx",
  "apps/desktop/src/components/ImSettingsSection.tsx",
  "apps/desktop/src/components/WidgetSettingsSection.tsx",
  "apps/desktop/src/components/NameCardSection.tsx",
  "apps/desktop/src/pages/Settings.tsx",
  "apps/desktop/src/pages/Plugins.tsx",
];

const REPO_ROOT = new URL("../../", import.meta.url).pathname;

/** 从「defineSearchRows 的块体」里剥掉函数型字段（go: () => {…} / go: () => xxx / visible: () => …）：
 *  行注册对象里**函数字段带着对象花括号**（go 闭包），朴素的花括号正则

 *  `\{([^{}]*)\}` 会被它切成碎片 —— 并因此把同一行数出两次、把插件行数没。行扫描前删除函数字段。 */
function stripFnFields(body, landOnOut) {
  let out = "";
  let i = 0;
  const n = body.length;
  while (i < n) {
    const g = nextKey(body, i);
    if (g === null) {
      out += body.slice(i);
      break;
    }
    out += body.slice(i, g);
    if (body.startsWith("landOn:", g)) {
      /* landOn: { section, note } —— 剥掉嵌套对象（字符串取值回传给消费方，按出现顺序贴合行） */
      const braceOpen = body.indexOf("{", g);
      let depth = 0;
      let k = braceOpen;
      for (; k < n; k++) {
        if (body[k] === "{") depth++;
        else if (body[k] === "}") { depth--; if (depth === 0) { k++; break; } }
      }
      const blk = body.slice(braceOpen, Math.min(k, n));
      const secM = blk.match(/section:\s*"([^"]*)"/);
      const noteM = blk.match(/note:\s*"([^"]*)"/);
      landOnOut.push({ at: out.length, section: secM ? secM[1] : "", note: noteM ? noteM[1] : "" });
      i = k;
      while (i < n && /[,\s]/.test(body[i])) i++;
      continue;
    }
    /* go / visible：箭头函数字段，一律剥掉（消费方只看声明字段） */
    let j = body.indexOf("=>", g);
    if (j < 0) {
      out += body.slice(g);
      break;
    }
    j += 2;
    while (j < n && /\s/.test(body[j])) j++;
    if (body[j] === "{") {
      let depth = 0;
      let k = j;
      for (; k < n; k++) {
        if (body[k] === "{") depth++;
        else if (body[k] === "}") { depth--; if (depth === 0) { k++; break; } }
      }
      i = k;
    } else {
      let k = body.indexOf(",", j);
      let q = body.indexOf("}", j);
      if (k < 0) k = q < 0 ? n : q;
      if (q >= 0 && q < k) k = q;
      i = k;
    }
    while (i < n && /[,\s]/.test(body[i])) i++;
  }
  return out;
}

/** 找下一个「函数对象字段」的起点（go:/visible:/landOn:），没有则 null */
function nextKey(body, from) {
  let best = null;
  for (const k of ["go:", "visible:", "landOn:"]) {
    const i = body.indexOf(k, from);
    if (i >= 0 && (best === null || i < best)) best = i;
  }
  return best;
}

/** 单行对象字面量宽松解析：field 最初值（字符串数组/字符串/布尔），供四种消费方统一。 */
export function parseSearchRows() {
  const rows = [];
  for (const rel of SEARCH_ROW_FILES) {
    const src = readFileSync(REPO_ROOT + rel, "utf8");
    for (const m of src.matchAll(/defineSearchRows\(\s*\[([\s\S]*?)\]\s*\)\s*;/g)) {
      const landOns = [];
      const body = stripFnFields(m[1], landOns);
      for (const r of body.matchAll(/\{([^{}]*)\}/g)) {
        const obj = r[1];
        const str = (k) => {
          const hit = obj.match(new RegExp(`${k}:\\s*"([^"]*)"`)) ?? [];
          return hit[1] ? hit[1] : "";
        };
        const aliasesM = obj.match(/aliases:\s*\[([^\]]*)\]/);
        const aliases = aliasesM
          ? aliasesM[1].split(",").map((x) => x.trim().replace(/^"|"$/g, "")).filter(Boolean)
          : [];
        const bcM = obj.match(/breadcrumb:\s*\[([^\]]*)\]/);
        const breadcrumb = bcM
          ? bcM[1].split(",").map((x) => x.trim().replace(/^"|"$/g, "")).filter(Boolean)
          : [];
        /* visible/fallbackNote/root/landOn：够 sync 护栏识别该行**期望落点形态**
           （go 表达式/箭头函数不去动字面量化——只在 fn 与 note 断言齐了） */
        /* landOn 贴行：记录剥离时的 out 位置，落在哪个行字面量开区间内就归谁 */
        const li = landOns.find((l) => l.at >= r.index && l.at <= r.index + r[0].length) ?? null;
        rows.push({ file: rel.split("/").pop(), id: str("id"), tab: str("tab"), section: str("section"),
                    title: str("title"), desc: str("desc"), aliases, breadcrumb,
                    displayRoot: str("displayRoot"), note: str("fallbackNote"),
                    landOn: li ? { section: li.section, note: li.note } : null });
      }
    }
  }
  return rows;
}
