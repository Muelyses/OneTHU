/**
 * 洗衣机数据源测试（三家：捷利 / 海乐生活 / 小兰智慧）。
 *
 * 小兰智慧是上游 2026-09 新增的数据源（thu-info-app utils/washer.ts），它把「离线 / 待机 /
 * 未知」单列出来——不能都塞进「故障」，离线是掉线、待机是可用但没启动、故障是坏了。
 * 楼栋 id 在不同数据源之间会重名，故 provider 编码（原子 key 第三段）与缓存键后缀必须一致，
 * 否则用户点开收藏的楼栋会落到另一家的同名楼栋上。逐条钉住。
 *
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/washer-source-test.mjs
 */
const {
  xiaolanStatus, compareWasherNames, washerProviderCode, washerProviderOf, washerCacheSuffix,
  WASHER_PROVIDER_LABEL, getWasherBuildingGroups, getWasherDevices,
} = await import("../packages/core/src/info/washer.ts");

let pass = 0, fail = 0;
const eq = (name, a, b) => {
  if (JSON.stringify(a) === JSON.stringify(b)) pass++;
  else { fail++; console.error(`✗ ${name}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

/* ① provider 编码：原子 key 第三段与缓存键后缀必须一一对应（老收藏只有 "0"/"1"） */
{
  eq("编码：捷利", washerProviderCode("jieli"), "0");
  eq("编码：海乐生活", washerProviderCode("haile"), "1");
  eq("编码：小兰智慧", washerProviderCode("xiaolan"), "2");
  eq("解码：老收藏的 \"0\"", washerProviderOf("0"), "jieli");
  eq("解码：老收藏的 \"1\"", washerProviderOf("1"), "haile");
  eq("解码：\"2\"", washerProviderOf("2"), "xiaolan");
  eq("解码：缺省与空值按捷利（不能因为新数据源让老收藏失效）", [washerProviderOf(undefined), washerProviderOf(""), washerProviderOf("9")], ["jieli", "jieli", "jieli"]);
  eq("缓存后缀：三家各不相同", [washerCacheSuffix("0"), washerCacheSuffix("1"), washerCacheSuffix("2")], ["j", "h", "x"]);
  eq("数据源显示名", [WASHER_PROVIDER_LABEL.jieli, WASHER_PROVIDER_LABEL.haile, WASHER_PROVIDER_LABEL.xiaolan], ["捷利楼栋", "海乐生活点位", "小兰智慧"]);
}

/* ② 小兰智慧状态判读：离线 > 故障 > 运行状态 */
{
  eq("离线（isOnline=0）优先于一切", xiaolanStatus({ isOnline: 0, fault: 1, runState: 5 }), "offline");
  eq("离线（字符串 0）", xiaolanStatus({ isOnline: "0" }), "offline");
  eq("故障（fault 非 0）", xiaolanStatus({ isOnline: 1, fault: 3 }), "error");
  eq("fault=0 不算故障", xiaolanStatus({ isOnline: 1, fault: 0, runState: 7 }), "idle");
  eq("fault=false 不算故障", xiaolanStatus({ isOnline: 1, fault: false, runState: 7 }), "idle");
  eq("runState 7 = 空闲", xiaolanStatus({ isOnline: 1, runState: 7 }), "idle");
  eq("runState 5 = 使用中", xiaolanStatus({ isOnline: 1, runState: 5 }), "working");
  eq("runState 1 = 待机（可用但没启动，不是故障）", xiaolanStatus({ isOnline: 1, runState: 1 }), "standby");
  eq("其它 runState = 未知", xiaolanStatus({ isOnline: 1, runState: 3 }), "unknown");
  eq("在离线字段缺失时也判未知（不猜空闲）", xiaolanStatus({ runState: 7 }), "unknown");
  eq("空对象 = 未知", xiaolanStatus({}), "unknown");
}

/* ③ 设备名排序：中文数字序（洗衣机2 在 洗衣机10 前） */
{
  const list = ["洗衣机10", "洗衣机2", "烘干机1"];
  eq("中文数字序排序", [...list].sort(compareWasherNames), ["烘干机1", "洗衣机2", "洗衣机10"]);
}

/* ④ 楼栋列表：三家合并；小兰用 /buildings/list 的嵌套结构 */
{
  const xiaolanList = {
    "67ce4044ba854c556508830e": {
      buildings: {
        a1: { buildingId: "a1", name: "紫荆1号楼" },
        a2: { name: "紫荆10号楼" },
      },
      fetchedAt: "2026-09-20T10:00:00Z",
    },
  };
  const calls = [];
  const fetchLike = async (url, init) => {
    calls.push([url, init?.method ?? "GET"]);
    const body = (u) => ({ ok: true, status: 200, text: async () => JSON.stringify(u), json: async () => u });
    if (url.includes("cleverschool.cn/washapi4/device/tower")) {
      return body({ errorCode: null, data: [{ text: "紫荆1号楼", value: "b1" }, { text: "南区8号楼", value: "b2" }] });
    }
    if (url.includes("haier-ioc.com/position/nearPosition")) {
      return body({ code: 0, data: { items: [{ id: 7, name: "清华紫荆公寓洗衣房" }, { id: 8, name: "清华中学" }] } });
    }
    if (url.includes("wash-ltd-thu.aajax.top/buildings/list")) return body(xiaolanList);
    throw new Error("unexpected url " + url);
  };
  const groups = await getWasherBuildingGroups(fetchLike);
  const names = groups.map((g) => g.name);
  eq("分组依次为捷利四组 + 海乐 + 小兰", names, ["紫荆公寓", "南区宿舍", "双清公寓", "其他位置", "海乐生活", "小兰智慧"]);
  eq("捷利：按名字归类", groups[0].buildings.map((b) => b.id), ["b1"]);
  eq("捷利：provider 标记", groups[0].buildings[0].provider, "jieli");
  eq("海乐：只收含「清华」且非「清华中学」的点位", groups[4].buildings.map((b) => [b.id, b.provider]), [["7", "haile"]]);
  eq("小兰：楼栋 id 与名字（缺 buildingId 时回落键名）", groups[5].buildings.map((b) => [b.id, b.name]), [["a1", "紫荆1号楼"], ["a2", "紫荆10号楼"]]);
  eq("小兰：按名字数字序排（1 号楼在 10 号楼前）", groups[5].buildings.map((b) => b.name), ["紫荆1号楼", "紫荆10号楼"]);
  ok("请求带上三家端点", calls.some((c) => c[0].includes("cleverschool")) && calls.some((c) => c[0].includes("haier")) && calls.some((c) => c[0].includes("aajax")));
}

/* ⑤ 某一家挂了不影响另外两家（小兰是第三方代理，最容易挂） */
{
  const fetchLike = async (url) => {
    const body = (u) => ({ ok: true, status: 200, text: async () => JSON.stringify(u), json: async () => u });
    if (url.includes("cleverschool")) return body({ errorCode: null, data: [{ text: "紫荆2号楼", value: "b9" }] });
    if (url.includes("haier")) return body({ code: 0, data: { items: [{ id: 7, name: "清华紫荆公寓洗衣房" }] } });
    return { ok: false, status: 502, text: async () => "", json: async () => ({}) };
  };
  const groups = await getWasherBuildingGroups(fetchLike);
  eq("小兰挂掉时其余两家仍在", groups.filter((g) => g.buildings.length > 0).map((g) => g.name), ["紫荆公寓", "海乐生活"]);
}

/* ⑥ 小兰智慧楼栋内设备：房间 → 设备，类型码与剩余时间 */
{
  const detail = {
    "67ce4044ba854c556508830e": {
      buildings: {
        a1: {
          facilities: [
            {
              store: { storeId: "s1", floor: "2", opStoreName: "二层洗衣房" },
              storeDetail: { storeId: "s1", name: "二层东侧" },
              devices: [
                { deviceId: "d1", deviceCode: "洗衣机A", type: 1, deviceState: { isOnline: 1, runState: 5 }, inUseBit: { estimatedCompleteTime: new Date(Date.now() + 25 * 60_000).toISOString() } },
                { deviceId: "d2", deviceCode: "洗鞋机B", type: 4, deviceState: { isOnline: 1, runState: 7 } },
              ],
            },
            {
              store: { storeId: "s2", floor: "1" },
              storeDetail: { storeId: "s2", name: "一层洗衣房" },
              devices: [{ deviceId: "d3", deviceCode: "烘干机C", type: 2, deviceState: { isOnline: 0, runState: 1 } }],
            },
          ],
        },
      },
    },
  };
  const fetchLike = async () => ({ ok: true, status: 200, text: async () => JSON.stringify(detail), json: async () => detail });
  const floors = await getWasherDevices(fetchLike, { id: "a1", name: "紫荆1号楼", provider: "xiaolan" });
  eq("按楼层号 → 房间名排序", floors.map((f) => f.floor), ["一层洗衣房", "二层东侧"]);
  const room = floors[1];
  const washer = room.washers.find((w) => w.name === "洗衣机A");
  const shoe = room.washers.find((w) => w.name === "洗鞋机B");
  eq("设备：设备名取 deviceCode 并按中文数字序排", room.washers.map((w) => w.name), ["洗鞋机B", "洗衣机A"]);
  eq("设备：类型码 1/4 → 名称", [washer.type, shoe.type], ["洗衣机", "洗鞋机"]);
  eq("设备：状态", [washer.status, shoe.status], ["working", "idle"]);
  ok("设备：使用中按预计完成时间算出剩余分钟（ISO 串形态）", washer.eta >= 24 && washer.eta <= 25);
  eq("设备：空闲不给剩余分钟", shoe.eta, -1);
  eq("设备：离线设备单独标出", floors[0].washers[0].status, "offline");
}

/* ⑥b 预计完成时间实测是毫秒时间戳数字（不是 ISO 串）：两种形态都要认 */
{
  const ms = Date.now() + 18 * 60_000;
  const payload = {
    "67ce4044ba854c556508830e": {
      buildings: {
        z1: {
          facilities: [
            {
              store: { storeId: "s1", floor: "5" },
              storeDetail: { name: "5层东洗衣房" },
              devices: [
                { deviceId: "n1", deviceCode: "101", type: 1, deviceState: { isOnline: 1, runState: 5 }, inUseBit: { estimatedCompleteTime: ms } },
                { deviceId: "n2", deviceCode: "102", type: 1, deviceState: { isOnline: 1, runState: 5 }, inUseBit: { estimatedCompleteTime: String(ms) } },
                { deviceId: "n3", deviceCode: "103", type: 1, deviceState: { isOnline: 1, runState: 5 }, inUseBit: { estimatedCompleteTime: null } },
              ],
            },
          ],
        },
      },
    },
  };
  const fetchLike = async () => ({ ok: true, status: 200, text: async () => JSON.stringify(payload), json: async () => payload });
  const floors = await getWasherDevices(fetchLike, { id: "z1", name: "14号学生公寓", provider: "xiaolan" });
  const [w1, w2, w3] = floors[0].washers;
  ok("数字时间戳能算出剩余分钟", w1.eta >= 17 && w1.eta <= 18);
  ok("纯数字串时间戳同样认", w2.eta >= 17 && w2.eta <= 18);
  eq("没有预计完成时间时不编剩余分钟", w3.eta, -1);
}

/* ⑦ 捷利解析保持原样（回归）：状态串逐段判读 */
{
  const status = {
    errorCode: null,
    data: [
      { floorName: "1F", macUnionCode: "洗衣机 洗衣机A", status: "待机 更新:10:32" },
      { floorName: "1F", macUnionCode: "洗衣机 洗衣机B", status: "工作 剩余:23分钟 更新:10:31" },
    ],
  };
  const fetchLike = async (url) => {
    const body = (u) => ({ ok: true, status: 200, text: async () => JSON.stringify(u), json: async () => u });
    if (url.includes("washapi4/device/status")) return body(status);
    return body({ 洗衣机A: "一层东侧" });
  };
  const floors = await getWasherDevices(fetchLike, { id: "b1", name: "紫荆1号楼", provider: "jieli" });
  eq("捷利：楼层", floors.map((f) => f.floor), ["1F"]);
  eq("捷利：待机 → idle", floors[0].washers[0].status, "idle");
  eq("捷利：更新时刻原文保留", floors[0].washers[0].updateTime, "10:32");
  eq("捷利：工作 → working + 剩余分钟", [floors[0].washers[1].status, floors[0].washers[1].eta], ["working", 23]);
  eq("捷利：安装位置 best-effort 带出", floors[0].washers[0].location, "一层东侧");
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
