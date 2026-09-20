/**
 * 「小组件显示什么」解析测试（纯函数 + 注入依赖）。
 *
 * 这段逻辑把「用户挑的收藏夹/原子」变成桌面上的几行字，边角最容易出错：
 * 删掉的原子、空收藏夹、子收藏夹条目、原子不在任何收藏夹里。逐条钉住。
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
const { loadWidgetSettings, saveWidgetSettings, describeWidgetSource, subscribeWidgetSettings } =
  await import("../apps/desktop/src/state/widgetSettings.ts");

let pass = 0, fail = 0;
const eq = (name, a, b) => {
  if (JSON.stringify(a) === JSON.stringify(b)) pass++;
  else { fail++; console.error(`✗ ${name}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const atoms = {
  "page:learn": { title: "网络学堂", sub: "作业与通知" },
  "page:card": { title: "校园卡", sub: "余额 ¥23.4" },
  "page:lib": { title: "图书馆座位", sub: "3F-12 13:00" },
  "page:dead": null,                                   // 已失效原子
  "plugin:onethu.habit:main~count:3": { title: "Hello 计数 3", sub: "来自 Hello 插件" },   // 可解析但未被收藏
};
const deps = {
  folders: {
    f1: { title: "我的收藏", items: [
      { t: "a", atom: { kind: "page", key: "learn" } },
      { t: "a", atom: { kind: "page", key: "card" } },
      { t: "f", id: "f2" },
      { t: "a", atom: { kind: "page", key: "dead" } },  // 失效
      { t: "a", atom: { kind: "page", key: "lib" } },
    ] },
    f2: { title: "子夹", items: [{ t: "a", atom: { kind: "page", key: "card" } }] },
    empty: { title: "空的", items: [] },
  },
  resolveAtom: (ref) => atoms[`${ref.kind}:${ref.key}`] ?? null,
  maxRows: 3,
};

/* ① 收藏夹来源 */
{
  const r = resolveWidgetSource({ source: { kind: "folder", folderId: "f1" }, openPage: null }, deps);
  eq("标题为收藏夹名", r.title, "我的收藏");
  eq("最多三行", r.rows.length, 3);
  eq("首行是第一个原子", r.rows[0], { text: "网络学堂", sub: "作业与通知" });
  eq("子收藏夹单独成行", r.rows[2], { text: "子夹", sub: "收藏夹" });
  ok("失效原子被跳过", r.rows.every((x) => x.text !== "图书馆座位"));
  eq("脚注统计总项数并提示截断", r.footer, "4 项 · 还有 1 项");
  eq("落点为该收藏夹", r.target, "folder");
  eq("带上 folderId 参数", r.params, { folderId: "f1" });
}
{
  const r = resolveWidgetSource({ source: { kind: "folder", folderId: "empty" }, openPage: null }, deps);
  eq("空收藏夹提示明确", r.footer, "收藏夹是空的");
  eq("空收藏夹无行", r.rows.length, 0);
}
eq("收藏夹不存在 → null（回落默认视图）",
   resolveWidgetSource({ source: { kind: "folder", folderId: "不存在" }, openPage: null }, deps), null);

/* ② 单个原子来源 */
{
  const r = resolveWidgetSource({ source: { kind: "atom", atom: { kind: "page", key: "learn" } }, openPage: null }, deps);
  eq("标题为该原子", r.title, "网络学堂");
  eq("首行是它自己", r.rows[0].text, "网络学堂");
  ok("后续行接上同一收藏夹的其余项", r.rows.length >= 2);
  ok("脚注指出所属收藏夹", r.footer.startsWith("我的收藏"));
  eq("落点为所属收藏夹", r.params, { folderId: "f1" });
}
{
  const r = resolveWidgetSource({ source: { kind: "atom", atom: { kind: "page", key: "card" } }, openPage: null }, deps);
  ok("原子同时出现在两个夹时取先找到的", r.footer.startsWith("我的收藏"));
}
{
  const r = resolveWidgetSource({ source: { kind: "atom", atom: { kind: "plugin:onethu.habit", key: "main~count:3" } }, openPage: null }, deps);
  eq("可解析但未收藏的原子也能显示", r.footer, "未收藏");
  eq("未收藏时仍有一行", r.rows.length, 1);
  eq("未收藏时显示原子自身标题", r.rows[0].text, "Hello 计数 3");
}
eq("原子失效 → null（回落默认视图）",
   resolveWidgetSource({ source: { kind: "atom", atom: { kind: "page", key: "dead" } }, openPage: null }, deps), null);
eq("原子 key 缺失 → null",
   resolveWidgetSource({ source: { kind: "atom", atom: { kind: "page", key: "" } }, openPage: null }, deps), null);

/* ③ today 来源不归本模块管 */
eq("today → null（由默认快照负责）",
   resolveWidgetSource({ source: { kind: "today" }, openPage: null }, deps), null);

/* ④ 配置持久化与容错 */
{
  store.clear();
  eq("默认是今天", loadWidgetSettings().source.kind, "today");
  eq("默认点击跟随内容", loadWidgetSettings().openPage, null);
  saveWidgetSettings({ source: { kind: "folder", folderId: "f1" } });
  eq("收藏夹来源已保存", loadWidgetSettings().source, { kind: "folder", folderId: "f1" });
  saveWidgetSettings({ source: { kind: "atom", atom: { kind: "page", key: "learn" } } });
  eq("原子来源已保存", loadWidgetSettings().source.atom, { kind: "page", key: "learn" });
  store.set("onethu.widget.v1", "{坏 JSON");
  eq("坏存储回落今天", loadWidgetSettings().source.kind, "today");
  store.set("onethu.widget.v1", JSON.stringify({ source: { kind: "folder" } }));
  eq("folder 缺 folderId → 回落今天", loadWidgetSettings().source.kind, "today");
  store.set("onethu.widget.v1", JSON.stringify({ source: { kind: "atom", atom: { key: "x" } } }));
  eq("atom 缺 kind → 回落今天", loadWidgetSettings().source.kind, "today");
}

/* ⑤ 订阅：改配置要通知（否则要等 15 分钟定时重算才在桌面看到） */
{
  store.clear();
  let hits = 0;
  const unsub = subscribeWidgetSettings(() => hits++);
  saveWidgetSettings({ source: { kind: "folder", folderId: "f1" } });
  eq("保存触发一次通知", hits, 1);
  unsub();
  saveWidgetSettings({ source: { kind: "today" } });
  eq("退订后不再通知", hits, 1);
}

/* ⑥ 摘要文案 */
{
  eq("摘要：今天", describeWidgetSource({ source: { kind: "today" }, openPage: null }), "今天（课程与截止）");
  eq("摘要：收藏夹（带名字）",
     describeWidgetSource({ source: { kind: "folder", folderId: "f1" }, openPage: null }, { folder: "我的收藏" }),
     "收藏夹「我的收藏」");
  eq("摘要：原子（带名字）",
     describeWidgetSource({ source: { kind: "atom", atom: { kind: "page", key: "learn" } }, openPage: null }, { atom: "网络学堂" }),
     "收藏原子「网络学堂」");
}

/* ⑦ 落点编码：原生只存一个字符串，编码/解码必须自洽 */
{
  const { encodeWidgetTarget, parseWidgetTarget } = await import("../apps/desktop/src/state/widgetTarget.ts");
  eq("落点：无参数", encodeWidgetTarget("today"), "today");
  eq("落点：空页面", encodeWidgetTarget(""), "");
  eq("落点：单参数", encodeWidgetTarget("folder", { folderId: "f1" }), "folder?folderId=f1");
  eq("落点：中文参数被转义", encodeWidgetTarget("learn-course", { name: "微积分 A" }), "learn-course?name=%E5%BE%AE%E7%A7%AF%E5%88%86%20A");
  eq("落点：空值参数被丢弃", encodeWidgetTarget("folder", { a: "", b: null, c: undefined, d: 0 }), "folder?d=0");
  eq("落点：解析无参数", parseWidgetTarget("today"), { page: "today", params: {} });
  eq("落点：解析单参数", parseWidgetTarget("folder?folderId=f1"), { page: "folder", params: { folderId: "f1" } });
  eq("落点：解析多参数", parseWidgetTarget("learn-course?courseId=1&name=%E5%BE%AE"),
     { page: "learn-course", params: { courseId: "1", name: "微" } });
  eq("落点：布尔被还原（字符串 \"false\" 是真值，必须还原成布尔）",
     parseWidgetTarget("life?washerBuildingHlsh=false&on=true"),
     { page: "life", params: { washerBuildingHlsh: false, on: true } });
  eq("落点：空串解析为 null", parseWidgetTarget("  "), null);
  eq("落点：坏编码跳过该项而不是整体失效", parseWidgetTarget("a?good=1&bad=%E0%A4"), { page: "a", params: { good: "1" } });
  eq("落点：编码→解析往返", parseWidgetTarget(encodeWidgetTarget("info", { infoTab: "news", q: "a b&c" })),
     { page: "info", params: { infoTab: "news", q: "a b&c" } });
  eq("落点：布尔往返", parseWidgetTarget(encodeWidgetTarget("life", { hlsh: false })),
     { page: "life", params: { hlsh: false } });
}

/* ⑧ 原子来源的落点：点开应到原子本身，而不是它所在的收藏夹 */
{
  const withTarget = (key, extra) => ({
    folders: { f1: { title: "常用", items: [{ t: "a", atom: { kind: "page", key } }] } },
    resolveAtom: () => ({ title: "网络学堂", sub: "作业与通知", ...extra }),
  });
  const s = { source: { kind: "atom", atom: { kind: "page", key: "learn" } }, openPage: null };
  const a = resolveWidgetSource(s, withTarget("learn", { target: { page: "learn", params: { learnOpen: true } } }));
  eq("原子落点：到原子本身", a.target, "learn");
  eq("原子落点：带上原子的参数", a.params, { learnOpen: true });
  const b = resolveWidgetSource(s, withTarget("learn", {}));
  eq("原子落点：拿不到原子落点时回落到收藏夹", [b.target, b.params], ["folder", { folderId: "f1" }]);
  const c = resolveWidgetSource(
    { source: { kind: "atom", atom: { kind: "page", key: "gone" } }, openPage: null },
    { folders: {}, resolveAtom: () => ({ title: "孤儿原子" }) });
  eq("未收藏的原子：无落点信息时回落收藏夹页", [c.target, c.params], ["folder", undefined]);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
