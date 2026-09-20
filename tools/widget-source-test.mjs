/**
 * 「这块小组件显示什么」的解析测试（纯函数 + 注入依赖）。
 *
 * 这段逻辑把「用户挑的东西」变成桌面上能画的数据，边角最容易出错：删掉的原子、空收藏夹、
 * 子收藏夹条目、放不下的图标、失效的插件原子。逐条钉住。
 *
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/widget-source-test.mjs
 */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
};

const { resolveWidgetSource } = await import("../apps/desktop/src/state/widgetSource.ts");
const { encodeWidgetTarget, parseWidgetTarget } = await import("../apps/desktop/src/state/widgetTarget.ts");
const {
  loadWidgetInstances, bindWidgetInstance, unbindWidgetInstance, bindingOf,
  setWidgetFallback, pruneWidgetInstances, describeBinding,
} = await import("../apps/desktop/src/state/widgetInstances.ts");

let pass = 0, fail = 0;
const eq = (name, a, b) => {
  if (JSON.stringify(a) === JSON.stringify(b)) pass++;
  else { fail++; console.error(`✗ ${name}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

/* 原子元数据表：键 "kind:key" */
const atoms = {
  "page:learn": { title: "网络学堂", sub: "作业与通知", target: { page: "learn" } },
  "page:card": { title: "校园卡", sub: "余额 ¥23.4", target: { page: "info", params: { infoTab: "card" } } },
  "course:1~数据结构~张三~2025": { title: "数据结构", sub: "张三 · 课程", target: { page: "learn-course", params: { courseId: "1" } } },
  "washer-m:b1~紫荆1号楼~0~洗衣机A": {
    title: "洗衣机A", sub: "紫荆1号楼",
    // 与真实原子一致：落到洗衣机页要带一整套参数，少一个就退回生活首页
    target: { page: "life", params: { lifeTab: "washer", washerBuildingId: "b1", washerBuildingName: "紫荆1号楼", washerBuildingHlsh: false, washerMachine: "洗衣机A" } },
  },
  "news:n1~某条新闻~信息门户": { title: "某条新闻", sub: "信息门户", target: { page: "info", params: { infoNewsId: "n1" } } },
};

const deps = (extra = {}) => ({
  folders: {
    f1: {
      title: "常用",
      items: [
        { t: "a", atom: { kind: "page", key: "learn" } },
        { t: "f", id: "f2" },
        { t: "a", atom: { kind: "page", key: "card" } },
      ],
    },
    f2: { title: "子夹", items: [{ t: "a", atom: { kind: "page", key: "card" } }] },
    empty: { title: "空夹", items: [] },
  },
  resolveAtom: (ref) => atoms[`${ref.kind}:${ref.key}`] ?? null,
  ...extra,
});

/* ① 收藏夹 → 图标组（子收藏夹不进图标组：那里没有可画的图标） */
{
  const r = resolveWidgetSource({ kind: "folder", folderId: "f1" }, deps());
  eq("图标组：形态", r.kind, "grid");
  eq("图标组：标题", r.title, "常用");
  eq("图标组：只取原子，跳过子夹", r.items.map((i) => i.label), ["网络学堂", "校园卡"]);
  eq("图标组：每个图标带自己的落点", r.items[0].target, "learn");
  ok("图标组：带参数的落点不能被吃掉（洗衣机/课程这类原子全靠它）",
     resolveWidgetSource({ kind: "folder", folderId: "washers" }, {
       folders: { washers: { title: "洗衣机", items: [{ t: "a", atom: { kind: "washer-m", key: "b1~紫荆1号楼~0~洗衣机A" } }] } },
       resolveAtom: (ref) => atoms[`${ref.kind}:${ref.key}`] ?? null,
     }).items[0].target.startsWith("life?lifeTab=washer&washerBuildingId=b1"));
  eq("详情：落点带参数（课程要带 courseId，否则是一片空白课）",
     resolveWidgetSource({ kind: "detail", atom: { kind: "course", key: "1~数据结构~张三~2025" } }, deps()).target,
     "learn-course?courseId=1");
  eq("快捷方式：落点带参数",
     resolveWidgetSource({ kind: "shortcut", atom: { kind: "page", key: "card" } }, deps()).target,
     "info?infoTab=card");
  eq("图标组：标题落点是那个收藏夹", r.target, "folder?folderId=f1");
  const empty = resolveWidgetSource({ kind: "folder", folderId: "empty" }, deps());
  eq("空夹：返回 null（回落日程与 DDL，而不是空面板）", empty, null);
  const gone = resolveWidgetSource({ kind: "folder", folderId: "nope" }, deps());
  eq("夹被删：返回 null", gone, null);
}

/* ② 图标组容量：放不下的截断（原生按占位算容量） */
{
  const many = { title: "很多", items: [] };
  for (let i = 0; i < 20; i++) many.items.push({ t: "a", atom: { kind: "page", key: `k${i}` } });
  const lookup = (ref) => ({ title: `原子${ref.key.slice(1)}`, target: { page: "today" } });
  const r = resolveWidgetSource({ kind: "folder", folderId: "many" }, {
    folders: { many }, resolveAtom: lookup, maxIcons: 4,
  });
  eq("容量：最多按 maxIcons 取", r.items.length, 4);
  eq("容量：标签截断到 6 字", resolveWidgetSource({ kind: "folder", folderId: "many" }, {
    folders: { many }, resolveAtom: () => ({ title: "一二三四五六七八九十", target: { page: "today" } }), maxIcons: 1,
  }).items[0].label, "一二三四五六…");
}

/* ③ 单个原子 → 详情（原子自己 + 注入的补充行） */
{
  const r = resolveWidgetSource({ kind: "detail", atom: { kind: "course", key: "1~数据结构~张三~2025" } }, deps({
    detail: () => ({ rows: [{ text: "明天 10:00 六教6A215", sub: "还有 18 小时" }], footer: "3 次待上" }),
  }));
  eq("详情：形态", r.kind, "detail");
  eq("详情：首行是原子自己", [r.rows[0].text, r.rows[0].sub], ["数据结构", "张三 · 课程"]);
  eq("详情：接上补充行", r.rows[1].text, "明天 10:00 六教6A215");
  eq("详情：脚注来自补充行", r.footer, "3 次待上");
  eq("详情：落点到原子本身（含参数）", r.target, "learn-course?courseId=1");
  const noExtra = resolveWidgetSource({ kind: "detail", atom: { kind: "news", key: "n1~某条新闻~信息门户" } }, deps());
  eq("详情：没有补充行时只用原子自己", noExtra.rows.length, 1);
  eq("详情：没有补充行时脚注为空", noExtra.footer, "");
  eq("详情：原子失效 → null", resolveWidgetSource({ kind: "detail", atom: { kind: "page", key: "gone" } }, deps()), null);
}

/* ④ 快捷方式：图标 + 名称 */
{
  const r = resolveWidgetSource({ kind: "shortcut", atom: { kind: "page", key: "card" } }, deps());
  eq("快捷方式：形态", r.kind, "shortcut");
  eq("快捷方式：名称", r.label, "校园卡");
  eq("快捷方式：副标题", r.sub, "余额 ¥23.4");
  eq("快捷方式：落点", r.target, "info?infoTab=card");
  eq("快捷方式：带着原子引用（供栅格化图标）", r.ref, { kind: "page", key: "card" });
  eq("快捷方式：长名字截断到 8 字", resolveWidgetSource({ kind: "shortcut", atom: { kind: "page", key: "card" } },
    { folders: {}, resolveAtom: () => ({ title: "一二三四五六七八九十", target: { page: "today" } }) }).label, "一二三四五六七八…");
  eq("快捷方式：原子失效 → null", resolveWidgetSource({ kind: "shortcut", atom: { kind: "page", key: "gone" } }, deps()), null);
}

/* ⑤ 绑定存储：按实例存、缺省兜底、解绑、清理 */
{
  store.clear();
  eq("初始：无绑定", Object.keys(loadWidgetInstances().byId).length, 0);
  eq("初始缺省：日程与 DDL", loadWidgetInstances().fallback, { kind: "today" });
  bindWidgetInstance(12, { kind: "shortcut", atom: { kind: "page", key: "card" } });
  bindWidgetInstance(13, { kind: "folder", folderId: "f1" });
  eq("绑定：两块各存各的", Object.keys(loadWidgetInstances().byId).sort(), ["12", "13"]);
  eq("绑定：按 id 取", bindingOf(13).kind, "folder");
  eq("绑定：未绑定的块用缺省", bindingOf(99), { kind: "today" });
  setWidgetFallback({ kind: "detail", atom: { kind: "page", key: "learn" } });
  eq("缺省可改：未绑定的块跟着变", bindingOf(99), { kind: "detail", atom: { kind: "page", key: "learn" } });
  eq("缺省可改：已绑定的块不受影响", bindingOf(13).kind, "folder");
  unbindWidgetInstance(12);
  eq("解绑：回到缺省", bindingOf(12).kind, "detail");
  pruneWidgetInstances([13]);
  eq("清理：桌面上没了的块，绑定也清掉", Object.keys(loadWidgetInstances().byId), ["13"]);
  pruneWidgetInstances(["13"]);
  eq("清理：还在的块不动", bindingOf(13).kind, "folder");
}

/* ⑥ 坏存储：跳过坏条目，不拖累其他块 */
{
  store.clear();
  store.set("onethu.widget.instances.v1", JSON.stringify({
    fallback: { kind: "nonsense" },
    byId: { "1": { kind: "folder", folderId: "f1" }, "2": { kind: "detail", atom: { kind: "page" } }, "3": null, "4": { kind: "today" } },
  }));
  const d = loadWidgetInstances();
  eq("坏存储：坏缺省回落日程与 DDL", d.fallback, { kind: "today" });
  eq("坏存储：只保留合法条目", Object.keys(d.byId).sort(), ["1", "4"]);
  store.set("onethu.widget.instances.v1", "{不是 JSON");
  eq("坏存储：整份坏掉也不抛", loadWidgetInstances().byId, {});
}

/* ⑦ 从上一版的全局配置迁移：老用户升级后桌面内容不变 */
{
  store.clear();
  store.set("onethu.widget.v1", JSON.stringify({ source: { kind: "folder", folderId: "f1" }, openPage: null }));
  const d = loadWidgetInstances();
  eq("迁移：老的「全局收藏夹」成为缺省内容", d.fallback, { kind: "folder", folderId: "f1" });
  store.clear();
  store.set("onethu.widget.v1", JSON.stringify({ source: { kind: "atom", atom: { kind: "page", key: "learn" } } }));
  eq("迁移：老的「全局原子」成为缺省详情", loadWidgetInstances().fallback, { kind: "detail", atom: { kind: "page", key: "learn" } });
}

/* ⑧ 摘要文案 */
{
  eq("摘要：日程与 DDL", describeBinding({ kind: "today" }), "日程与 DDL");
  eq("摘要：收藏夹图标组", describeBinding({ kind: "folder", folderId: "f1" }, { folder: "常用" }), "收藏夹「常用」图标组");
  eq("摘要：详情", describeBinding({ kind: "detail", atom: { kind: "page", key: "learn" } }, { atom: "网络学堂" }), "原子详情：网络学堂");
  eq("摘要：快捷方式", describeBinding({ kind: "shortcut", atom: { kind: "page", key: "learn" } }, { atom: "网络学堂" }), "快捷方式：网络学堂");
}

/* ⑨ 落点编码：原生只存一个字符串，编码/解码必须自洽 */
{
  eq("落点：无参数", encodeWidgetTarget("today"), "today");
  eq("落点：单参数", encodeWidgetTarget("folder", { folderId: "f1" }), "folder?folderId=f1");
  eq("落点：布尔被还原（字符串 \"false\" 是真值，必须还原成布尔）",
     parseWidgetTarget("life?washerBuildingHlsh=false&on=true"),
     { page: "life", params: { washerBuildingHlsh: false, on: true } });
  eq("落点：布尔往返", parseWidgetTarget(encodeWidgetTarget("life", { hlsh: false })),
     { page: "life", params: { hlsh: false } });
  eq("落点：空值参数被丢弃", encodeWidgetTarget("folder", { a: "", b: null, c: undefined, d: 0 }), "folder?d=0");
  eq("落点：坏编码跳过该项而不是整体失效", parseWidgetTarget("a?good=1&bad=%E0%A4"), { page: "a", params: { good: "1" } });
  eq("落点：空串解析为 null", parseWidgetTarget("  "), null);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
