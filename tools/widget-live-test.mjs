/**
 * 教室占用 / 洗衣机状态的解读测试（纯函数）。
 *
 * 「现在第几节」「哪几节空着」这类判读全在时间边界上出错（课间、夜里、周末），
 * 而它在桌面上是一句笃定的话——写错比不写更糟。逐条钉住。
 *
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/widget-live-test.mjs
 */
const {
  AVAILABLE, SLOT_TIMES, currentSlot, nextSlot, roomStatusLine, todayColumn, fmtClock,
  washerMachineDetail, washerBuildingDetail, roomDetail, buildingDetail,
} = await import("../apps/desktop/src/state/widgetLiveParse.ts");

let pass = 0, fail = 0;
const eq = (name, a, b) => {
  if (JSON.stringify(a) === JSON.stringify(b)) pass++;
  else { fail++; console.error(`✗ ${name}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

/** 2026-09-21 是周一 */
const at = (h, m = 0) => new Date(2026, 8, 21, h, m, 0).getTime();
const BUSY = 2;      // 非 AVAILABLE 即占用

/* ① 当前/下一节判读（含课间与夜里） */
{
  eq("09:00 在第 1 节内", currentSlot(at(9)), 0);
  eq("09:50（课间）不在任何节内", currentSlot(at(9, 50)), -1);
  eq("课间：下一节是第 2 节", nextSlot(at(9, 50)), 1);
  eq("13:00（午休）下一节是第 3 节", nextSlot(at(13)), 2);
  eq("22:50（夜里）没有下一节", nextSlot(at(22, 50)), -1);
  eq("22:50 不在任何节内", currentSlot(at(22, 50)), -1);
  eq("第 3 节的钟点写成 14:00–15:45", [fmtClock(SLOT_TIMES[2][0]), fmtClock(SLOT_TIMES[2][1])], ["14:00", "15:45"]);
}

/* ② 单间教室的一句话 */
{
  const free = [AVAILABLE, BUSY, AVAILABLE, AVAILABLE, BUSY, AVAILABLE];
  eq("上课时段：空闲", roomStatusLine(free, at(9)), "本节空闲");
  eq("上课时段：占用", roomStatusLine([BUSY, ...free.slice(1)], at(9)), "本节占用");
  eq("课间：给下一节", roomStatusLine(free, at(9, 50)), "下一节（第 2 节）占用");
  eq("夜里：今日结束", roomStatusLine(free, at(23)), "今日课程已结束");
}

/* ③ 单间教室的详情（本节 + 今日空闲节次 + 当前钟点） */
{
  const d = roomDetail([AVAILABLE, BUSY, AVAILABLE, AVAILABLE, BUSY, AVAILABLE], "6A215", at(9));
  eq("教室详情：首行是状态", [d.rows[0].text, d.rows[0].sub], ["本节空闲", "6A215"]);
  eq("教室详情：状态行大字加粗带色", [d.rows[0].size, d.rows[0].strong, d.rows[0].color], ["lg", true, "#1fa487"]);
  eq("教室详情：列出今日空闲节次", d.rows[1].text, "今日空闲：第 1、3、4、6 节");
  eq("教室详情：次要行小字", d.rows[1].size, "sm");
  eq("教室详情：给出当前钟点", d.rows[2].text, "现在第 1 节 08:00–09:45");
  eq("教室详情：脚注", d.footer, "6A215 · 今日占用总览");
  const full = roomDetail([BUSY, BUSY, BUSY, BUSY, BUSY, BUSY], "6A215", at(9));
  eq("全排满时如实说", full.rows[1].text, "今日已排满");
  eq("占用时状态行转红", full.rows[0].color, "#e5484d");
  eq("没有数据时不写", roomDetail([], "6A215", at(9)), null);
}

/* ④ 教学楼：本节（或下一节）空闲间数 + 全天空闲分布 */
{
  const rooms = [
    { name: "101", day: [AVAILABLE, BUSY, AVAILABLE, AVAILABLE, AVAILABLE, AVAILABLE] },
    { name: "102", day: [BUSY, BUSY, AVAILABLE, AVAILABLE, BUSY, AVAILABLE] },
    { name: "103", day: [AVAILABLE, AVAILABLE, BUSY, AVAILABLE, AVAILABLE, BUSY] },
  ];
  const d = buildingDetail(rooms, "六教", at(9));
  eq("教学楼：本节空闲间数", [d.rows[0].text, d.rows[0].sub], ["本节空闲 2 / 3 间", "六教"]);
  ok("教学楼：给出全天空闲分布", d.rows[1].text.startsWith("全天空闲：第1节 2 · 第2节 1"));
  const lunch = buildingDetail(rooms, "六教", at(13));
  eq("午休时给下一节（第 3 节 2 间空闲）", lunch.rows[0].text, "下一节空闲 2 / 3 间");
  eq("空楼不写", buildingDetail([], "六教", at(9)), null);
}

/* ⑤ 洗衣机：单台与楼栋 */
{
  const all = [
    { name: "洗衣机A", status: "working", eta: 23, floor: "1F" },
    { name: "洗衣机B", status: "idle", floor: "1F" },
    { name: "洗衣机C", status: "idle", floor: "2F" },
    { name: "洗衣机D", status: "idle", floor: "2F" },
  ];
  const one = washerMachineDetail(all[0], all, "紫荆1号楼");
  eq("单台：状态与剩余", [one.rows[0].text, one.rows[0].sub], ["使用中 · 剩 23 分钟", "1F · 洗衣机A"]);
  eq("单台：状态行大字加粗带色（桌面上要一眼看到）", [one.rows[0].size, one.rows[0].strong, one.rows[0].color], ["lg", true, "#e8873a"]);
  eq("单台：本楼空闲统计", one.rows[1].text, "紫荆1号楼 共 4 台，空闲 3 台");
  eq("单台：脚注给可用时间", one.footer, "约 23 分钟后可用");
  const idle = washerMachineDetail(all[1], all, "紫荆1号楼");
  eq("空闲设备的脚注是「换一台」而不是时间", idle.footer, "点开可换一台");
  eq("空闲状态用绿色", idle.rows[0].color, "#1fa487");
  const bld = washerBuildingDetail(all, "紫荆1号楼");
  eq("楼栋：总数", bld.rows[0].text, "空闲 3 / 4 台");
  eq("楼栋：按空闲数排楼层", bld.rows.slice(1).map((r) => r.text), ["2F 空闲 2 台", "1F 空闲 1 台"]);
  const unknown = washerMachineDetail({ name: "X", status: "weird" }, all, "紫荆1号楼");
  eq("状态不认得就说状态未知（不猜）", unknown.rows[0].text, "状态未知");
}

/* ⑥ 今天的列：周一=第 0 列 */
{
  const grid = Array.from({ length: 42 }, (_, i) => i);
  eq("周一取前 6 格", todayColumn(grid, at(9)), [0, 1, 2, 3, 4, 5]);
  const sunday = new Date(2026, 8, 27, 9, 0, 0).getTime();
  eq("周日取最后一列", todayColumn(grid, sunday), [36, 37, 38, 39, 40, 41]);
  eq("没有网格返回 null", todayColumn(null, at(9)), null);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
