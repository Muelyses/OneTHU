/**
 * 小组件里「下沉原子」的实时数据：教室占用、洗衣机状态。
 *
 * 为什么单独成模块：这两类原子的价值全在**实时**上（教室本节空不空、洗衣机还要多久），
 * 而小组件进程既没有 WebView 也没有网络。应用在算快照时顺手把它们抓一遍（走与收藏夹
 * 方卡同一条缓存），小组件就能显示真实状态，而不是只有原子自带的静态说明。
 * 解读逻辑在 widgetLiveParse.ts（纯函数、可直测）；这里只管抓取与读缓存。
 *
 * 三条纪律：
 *   · 抓取**只在前台**发生，且带超时——算快照绝不能因为某个接口慢而卡住；
 *   · 抓不到就不写（老实用静态说明），绝不在桌面上编一个状态；
 *   · 与 LiveTiles 共用缓存键：同一楼栋/教室，方卡抓过的小组件直接用，不重复请求。
 */
import { getWasherDevices } from "@onethu/core";
import { cacheGet, cacheFetch } from "./cache.js";
import { universalFetch } from "../lib/transport.js";
import { info } from "../lib/clients.js";
import type { AtomRef } from "./favorites.js";
import {
  buildingDetail, roomDetail, todayColumn, washerBuildingDetail, washerMachineDetail,
  type LiveRow, type WasherInfo,
} from "./widgetLiveParse.js";

export type { LiveRow } from "./widgetLiveParse.js";

/** 洗衣机 60s / 教室列表 10min / 教室状态 3min 新鲜期（与 LiveTiles 同口径） */
export const WASHER_TTL = 60_000;
export const CLS_LIST_TTL = 10 * 60_000;
export const CLS_STATE_TTL = 3 * 60_000;

const splitKey = (key: string): string[] => key.split("~");

/** 新鲜度 + 单飞：TTL 内直接用缓存，过期才真正请求（与 LiveTiles 同口径） */
async function fetchFresh<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const e = cacheGet<T>(key);
  if (e && Date.now() - e.at < ttlMs) return e.data;
  return cacheFetch(key, fetcher);
}

/**
 * 按需把「桌面上正显示的那些原子」需要的实时数据抓一遍。
 *
 * 只认下沉到实体的原子（洗衣机、教室）；其余原子不需要联网，直接跳过。
 * 整体带超时：算快照的链路不该被任何一个接口拖住。
 */
export async function warmLiveData(refs: AtomRef[], timeoutMs = 6000): Promise<void> {
  const jobs: Array<Promise<unknown>> = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    if (ref.kind === "washer-m" || ref.kind === "washer-b") {
      const [bId, bName, hlsh] = splitKey(ref.key);
      if (!bId) continue;
      const key = `fav.washer.${bId}.${hlsh === "1" ? "h" : "j"}`;
      if (seen.has(key)) continue;
      seen.add(key);
      jobs.push(
        fetchFresh(key, WASHER_TTL, () => getWasherDevices(universalFetch, { id: bId, name: bName ?? "", hlsh: hlsh === "1" }))
          .catch(() => undefined),
      );
      continue;
    }
    if (ref.kind === "classroom-r" || ref.kind === "classroom-b") {
      const [searchName] = splitKey(ref.key);
      if (!searchName || seen.has(`cls.${searchName}`)) continue;
      seen.add(`cls.${searchName}`);
      jobs.push(warmClassroom(searchName).catch(() => undefined));
    }
  }
  if (jobs.length === 0) return;
  // 超时兜底：接口慢就先显示静态说明，下一轮快照再补实时状态
  await Promise.race([
    Promise.all(jobs),
    new Promise((r) => setTimeout(r, timeoutMs)),
  ]);
}

/** 教学楼 / 教室的状态数据（列表 + 本周状态），两项都走缓存 */
async function warmClassroom(searchName: string): Promise<void> {
  const list = await fetchFresh("fav.cls.list", CLS_LIST_TTL, () => info.getClassroomList());
  const b = list.find((x) => x.searchName === searchName);
  if (!b) return;
  await fetchFresh(
    `fav.cls.state.${searchName}.${b.weekNumber}`,
    CLS_STATE_TTL,
    () => info.getClassroomState(searchName, b.weekNumber),
  );
}

/** 从缓存里同步读洗衣机数据（warmLiveData 之后才可能有；没有返回 null，绝不猜） */
export function readWashers(key: string): WasherInfo[] | null {
  const floors = cacheGet<Array<{ floor?: string; washers?: WasherInfo[] }>>(key)?.data;
  if (!Array.isArray(floors)) return null;
  return floors.flatMap((f) => (f.washers ?? []).map((w) => ({ ...w, floor: f.floor })));
}

/** 从缓存里同步读教室数据（列表 + 本周状态），并切出「今天」那一列 */
export function readClassroom(searchName: string): { rooms: Array<{ name: string; day: number[] }> } | null {
  const list = cacheGet<Array<{ searchName: string; weekNumber: number }>>("fav.cls.list")?.data;
  if (!Array.isArray(list)) return null;
  const b = list.find((x) => x.searchName === searchName);
  if (!b) return null;
  const res = cacheGet<{ classroomStates: Array<{ name: string; status: number[] }> }>(`fav.cls.state.${searchName}.${b.weekNumber}`)?.data;
  if (!Array.isArray(res?.classroomStates)) return null;
  const now = Date.now();
  return {
    rooms: res.classroomStates
      .filter((r) => Array.isArray(r.status))
      .map((r) => ({ name: r.name, day: todayColumn([...r.status], now) ?? [] })),
  };
}

/**
 * 下沉原子的实时详情（同步读缓存）。返回 null 表示「这一刻没有实时数据」——
 * 调用方据此只用原子自带的静态说明，而不是编一个状态写到桌面上。
 */
export function liveDetail(ref: AtomRef, now = Date.now()): { rows: LiveRow[]; footer: string } | null {
  /* ── 洗衣机单台：还要多久 / 是否空闲 ── */
  if (ref.kind === "washer-m") {
    const [bId, bName, hlsh, dev] = splitKey(ref.key);
    if (!bId) return null;
    const all = readWashers(`fav.washer.${bId}.${hlsh === "1" ? "h" : "j"}`);
    if (!all) return null;
    const hit = all.find((x) => (x.name || x.location || x.type || "设备") === dev);
    return hit ? washerMachineDetail(hit, all, bName ?? "本楼") : null;
  }

  /* ── 洗衣机楼栋：空闲台数与空闲最多的楼层 ── */
  if (ref.kind === "washer-b") {
    const [bId, bName, hlsh] = splitKey(ref.key);
    if (!bId) return null;
    const all = readWashers(`fav.washer.${bId}.${hlsh === "1" ? "h" : "j"}`);
    return all && all.length ? washerBuildingDetail(all, bName ?? "本楼") : null;
  }

  /* ── 教室：本节占用 / 今日各节空闲 ── */
  if (ref.kind === "classroom-r") {
    const [searchName, , room] = splitKey(ref.key);
    if (!searchName) return null;
    const data = readClassroom(searchName);
    if (!data) return null;
    const me = data.rooms.find((r) => r.name === room);
    return me ? roomDetail(me.day, room ?? "本教室", now) : null;
  }

  /* ── 教学楼：本节/下一节空闲间数 + 全天空闲分布 ── */
  if (ref.kind === "classroom-b") {
    const [searchName, name] = splitKey(ref.key);
    if (!searchName) return null;
    const data = readClassroom(searchName);
    if (!data) return null;
    return buildingDetail(data.rooms, name ?? searchName, now);
  }

  return null;
}
