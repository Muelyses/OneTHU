/**
 * 通知 id 约定与插件通知归组测试（纯函数）。
 *
 * 这两个函数是「宿主重排不误撤插件通知」与「用户能看到并撤销插件通知」的唯一依据，
 * 各错一条的后果分别是：插件提醒凭空消失 / 设置页显示一堆看不懂的 id。
 *
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/notify-ids-test.mjs
 */
const { pluginNotifyId, isPluginNotifyId, groupPluginNotifications } = await import("../apps/desktop/src/state/notifyIds.ts");

let pass = 0, fail = 0;
const eq = (name, a, b) => {
  if (JSON.stringify(a) === JSON.stringify(b)) pass++;
  else { fail++; console.error(`✗ ${name}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

/* ① 构造与识别 */
eq("构造 id", pluginNotifyId("onethu.habit", "today"), "plugin:onethu.habit:today");
ok("识别插件 id", isPluginNotifyId("plugin:onethu.habit:today"));
eq("宿主 DDL 不是插件 id", isPluginNotifyId("ddl:h1:120"), false);
eq("宿主课程不是插件 id", isPluginNotifyId("class:2026-09-22:10:00:15"), false);
eq("空串安全", isPluginNotifyId(""), false);
eq("非字符串安全", isPluginNotifyId(undefined), false);

/* ② 归组：按插件聚合、按条数降序 */
{
  const ids = [
    "ddl:h1:120",                       // 宿主：不该出现
    "plugin:onethu.habit:today",
    "plugin:onethu.habit:tomorrow",
    "plugin:onethu.habit:later",
    "plugin:onethu.words:review",
  ];
  const groups = groupPluginNotifications(ids);
  eq("只留插件通知并聚合", groups.map((g) => g.pluginId), ["onethu.habit", "onethu.words"]);
  eq("条数多的在前", groups[0].ids.length, 3);
  eq("id 保持原样", groups[0].ids[0], "plugin:onethu.habit:today");
  eq("宿主通知被排除", groups.some((g) => g.ids.some((i) => i.startsWith("ddl:"))), false);
}

/* ③ 坏结构一律丢弃：猜不如不显示 */
{
  const groups = groupPluginNotifications([
    "plugin:",                    // 缺插件与 key
    "plugin:onethu.habit",        // 缺 key
    "plugin::today",              // 插件 id 为空
    "plugin:onethu.habit:",       // key 为空
    "plugin:onethu.ok:fine",      // 唯一合法
  ]);
  eq("只有合法条目留下", groups.length, 1);
  eq("留下的是合法那条", groups[0].ids, ["plugin:onethu.ok:fine"]);
}

/* ④ 边界：空输入与 null */
eq("空数组", groupPluginNotifications([]), []);
eq("null 容错", groupPluginNotifications(null), []);
eq("同一插件 id 含冒号（反域名不带冒号，此例验证解析取第一段）", groupPluginNotifications(["plugin:a:b:c"]).map((g) => g.pluginId), ["a"]);

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
