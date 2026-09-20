/**
 * 插件 UI 自由化纯逻辑测试：动态 tab 注册表 / 插件原子注册表（无 DOM / 无 React）。
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/plugin-ui-test.mjs
 */
import { registerPluginTab, unregisterPluginTabs, pluginTabsSnapshot, getPluginTab, setTabRoot, getTabRoot, onTabReady } from "../apps/desktop/src/plugins/tabs.js";
import { registerPluginAtom, unregisterPluginAtoms, getPluginAtom, pluginAtomKindOf } from "../apps/desktop/src/plugins/pluginAtoms.js";

let pass = 0, fail = 0;
function eq(name, a, b) {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (ok) pass++;
  else { fail++; console.error(`✗ ${name}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); }
}

/* ── tabs ── */
registerPluginTab({ pageKey: "plugin:demo:main", pluginId: "demo", title: "打卡", iconSvg: "<svg/>" });
registerPluginTab({ pageKey: "plugin:demo:stats", pluginId: "demo", title: "统计" });
registerPluginTab({ pageKey: "plugin:other:main", pluginId: "other", title: "其他页" });
eq("snapshot 数量", pluginTabsSnapshot().length, 3);
eq("pageKey 查找", getPluginTab("plugin:demo:main")?.title, "打卡");
eq("重复注册覆盖", (registerPluginTab({ pageKey: "plugin:demo:main", pluginId: "demo", title: "打卡2" }), getPluginTab("plugin:demo:main")?.title), "打卡2");
eq("snapshot 去重后", pluginTabsSnapshot().length, 3);

// roots：String 充当假 HTMLElement（Map 只存引用）
const fakeRoot = new String("root-el");
setTabRoot("plugin:demo:main", /** @type {any} */ (fakeRoot));
eq("root 登记", getTabRoot("plugin:demo:main") === fakeRoot, true);
let fired = 0;
const dispose = onTabReady("plugin:demo:main", () => fired++);
eq("已就绪立即回调", fired, 1);
dispose();
setTabRoot("plugin:demo:main", null);
eq("root 摘除", getTabRoot("plugin:demo:main"), null);
eq("摘除后 onTabReady 不回调", (onTabReady("plugin:demo:main", () => fired++)(), fired), 1);

// 卸载整体摘除
unregisterPluginTabs("demo");
eq("卸载摘除本插件全部 tab", pluginTabsSnapshot().some((t) => t.pluginId === "demo"), false);
eq("卸载不动其他插件", pluginTabsSnapshot().some((t) => t.pluginId === "other"), true);

/* ── atoms ── */
const kind = pluginAtomKindOf("demo");
eq("kind 约定", kind, "plugin:demo");
registerPluginAtom({
  kind, pluginId: "demo", group: "打卡",
  resolve: (key) => key === "main~streak:3" ? { title: "连续打卡 3 天", sub: "打卡" } : null,
});
eq("原子解析", getPluginAtom(kind)?.resolve("main~streak:3")?.title, "连续打卡 3 天");
eq("失效 key → null", getPluginAtom(kind)?.resolve("main~gone"), null);
unregisterPluginAtoms("demo");
eq("卸载后原子消失", getPluginAtom(kind), undefined);

console.log(`结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
