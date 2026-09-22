/**
 * pdf.js v6 运行时垫片的回归测试（R27：手机端 PDF 报
 * 「n(...).getOrInsertComputed is not a function」）。
 *
 * 这个 bug 只在老内核 WebView 上出现，本机无法复现，所以只能靠断言守：
 * 先把这些 API 从原型上删掉（模拟老内核），再验证垫片补齐后语义与规范一致。
 * 同时守一条纪律——垫片必须不可枚举，不能污染 for...in。
 *
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/pdf-runtime-test.mjs
 */
import { ensurePdfRuntimeShims, hasModernPdfRuntime } from "../apps/desktop/src/lib/pdf-runtime.ts";

let pass = 0;
function ok(cond, label) {
  if (!cond) {
    console.error(`  ✗ ${label}`);
    process.exit(1);
  }
  pass += 1;
  console.log(`  ✓ ${label}`);
}

const NEW_APIS = [
  [Map.prototype, "getOrInsertComputed"],
  [Map.prototype, "getOrInsert"],
  [WeakMap.prototype, "getOrInsertComputed"],
  [WeakMap.prototype, "getOrInsert"],
  [Promise, "withResolvers"],
];

console.log("[1] 模拟老内核：删掉新 API 后能力探测必须为 false");
{
  for (const [proto, name] of NEW_APIS) delete proto[name];
  ok(!hasModernPdfRuntime(), "缺 API 时 hasModernPdfRuntime() 为 false（→ 优先 legacy 构建）");
}

console.log("[2] 垫片补齐后能力探测为 true，且语义与规范一致");
{
  ensurePdfRuntimeShims();
  ok(hasModernPdfRuntime(), "补齐后 hasModernPdfRuntime() 为 true");
  ok(typeof Promise.withResolvers === "function", "Promise.withResolvers 已安装");

  let calls = 0;
  const m = new Map();
  const v1 = m.getOrInsertComputed("k", (k) => {
    calls += 1;
    return `computed:${k}`;
  });
  const v2 = m.getOrInsertComputed("k", () => {
    calls += 1;
    return "should-not-run";
  });
  ok(v1 === "computed:k" && v2 === "computed:k", "getOrInsertComputed 命中后返回缓存值");
  ok(calls === 1, "getOrInsertComputed 只计算一次（回调不会重复执行）");
  ok(m.get("k") === "computed:k", "getOrInsertComputed 把结果写回了 Map");

  const m2 = new Map([["a", 1]]);
  ok(m2.getOrInsert("a", 2) === 1, "getOrInsert 已存在时返回原值");
  ok(m2.getOrInsert("b", 2) === 2 && m2.get("b") === 2, "getOrInsert 不存在时写入并返回");

  const wm = new WeakMap();
  const key = {};
  ok(wm.getOrInsertComputed(key, () => 7) === 7, "WeakMap.getOrInsertComputed 可用");
  ok(wm.getOrInsertComputed(key, () => 9) === 7, "WeakMap.getOrInsertComputed 命中缓存");

  const d = Promise.withResolvers();
  ok(typeof d.resolve === "function" && typeof d.reject === "function" && d.promise instanceof Promise, "withResolvers 返回 {promise,resolve,reject}");
}

console.log("[3] 垫片纪律：不可枚举，且不覆盖已存在的原生实现");
{
  for (const [proto, name] of NEW_APIS) {
    ok(!Object.keys(proto).includes(name), `${name} 不在 Object.keys 里（不可枚举）`);
  }
  // 原生实现优先：塞一个假实现进去，再调垫片，不能被覆盖
  const sentinel = () => "native";
  Object.defineProperty(Map.prototype, "getOrInsert", { configurable: true, writable: true, value: sentinel });
  ensurePdfRuntimeShims();
  ok(Map.prototype.getOrInsert === sentinel, "已存在的方法不会被垫片覆盖");
}

console.log("[4] 真实调用点：loadPdfDoc 里先垫片、再按能力挑构建顺序");
{
  const src = await import("node:fs").then((fs) => fs.readFileSync("apps/desktop/src/components/FilePreview.tsx", "utf8"));
  const body = src.slice(src.indexOf("async function loadPdfDoc"));
  ok(/ensurePdfRuntimeShims\(\)/.test(body), "loadPdfDoc 开头调用 ensurePdfRuntimeShims()");
  ok(/const modernOk = hasModernPdfRuntime\(\)/.test(body), "loadPdfDoc 用 hasModernPdfRuntime() 决定顺序");
  ok(/modernOk \? \(\[modern, legacy\]/.test(body) && /\[legacy, modern\]/.test(body), "缺 API 时把 legacy 排在前面（仍保留兜底）");
  ok(/\[FILE-PREVIEW\]/.test(body), "留了 logcat 可抓的 console 痕迹");
}

console.log(`\npdf 运行时垫片：${pass} 断言全部通过`);
