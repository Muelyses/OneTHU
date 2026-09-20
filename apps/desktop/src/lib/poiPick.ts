/**
 * 寻迹的 POI 候选筛选与排序（纯函数，可直测）。
 *
 * 为什么单独成模块：这段判读决定了「前往」按钮把用户带到哪栋楼，而它全是启发式规则
 * （外校同名楼、停车场/出入口、同名多条目），必须能脱离网络与 Tauri 反复核对。
 * 与 trace.ts 的分工：那边负责调高德接口，这边只认候选列表。
 */

export interface PoiCandidate {
  lng: number;
  lat: number;
  name: string;
  address: string;
  district: string;
}

/**
 * 别的学校名：高德会把「清华东路35号北京林业大学」也算作「清华」命中——
 * 实测查「清华大学第一教学楼」的第一条海淀结果就是「北京林业大学第一教学楼」。
 */
export const OTHER_SCHOOL = /北京林业大学|北京大学|中国人民大学|北京航空航天大学|北京语言大学|中国地质大学|北京科技大学|中国矿业大学|中国石油大学|中国农业大学|北京师范大学|北京邮电大学|中央财经大学/;

/** 附属设施词：用户要去的是楼，不是楼边上的停车场或某个出入口 */
export const UTILITY = /停车场|停车位|公交站|入口|出口|大门|东南门|西南门|东北门|西北门|东门|西门|南门|北门|附近|周边|充电桩|快递|自动售货/;

/** 校园限定词：调用方给什么词都保证带前缀（少了它高德会把「第一教学楼」匹配到外校点位） */
export function withCampusPrefix(raw: string): string {
  const q = raw.trim();
  if (!q) return q;
  return /^清华/.test(q) ? q : `清华大学${q}`;
}

/** 这个候选是不是真在清华园里（名字或地址提到清华，且不是别家的楼） */
export function isTsinghuaPoi(p: { name: string; address: string }): boolean {
  const text = `${p.name}${p.address}`;
  if (OTHER_SCHOOL.test(text)) return false;
  return /清华大学|清华园|清华学堂/.test(text);
}

/**
 * 候选排序（分数越小越优先）：联想结果里同一个地方会有「本体 / 东门 / 停车场 / 三段/北门」
 * 多个条目，直接取第一条经常拿到大门、停车场或某个分区（实测「清华大学建筑馆」的第一条是
 * 报告厅、「第三教室楼」的第一条是三段、「综合体育馆」的一条是周边停车场）。
 */
export function poiRank(p: { name: string }, query: string): number {
  const n = p.name.trim();
  const q = query.trim();
  let score = 0;
  if (n === q) score -= 100;
  else if (n.startsWith(q)) score -= 20;
  // 检索词是名字的延长（「舜德楼北」→「舜德楼」）：本体比「(北门)」这类出入口更该被选中
  else if (q.startsWith(n)) score -= 40;
  if (!/[（(]/.test(n)) score -= 10;
  if (n.length > q.length + 8) score += 10;
  if (UTILITY.test(n) && !UTILITY.test(q)) score += 30;
  return score;
}

/**
 * 从候选里挑一个落点：
 *   ① 只留海淀（校园都在海淀，跨区命中基本是重名）；
 *   ② 有「确实在清华园」的候选就只在它们里面挑，避免外校同名楼；
 *   ③ 按 poiRank 排序取最优；
 *   ④ 一个都没有时返回 null（宁可不定位，也不要把用户指到别的楼）。
 */
export function pickPoi(candidates: PoiCandidate[], query: string): PoiCandidate | null {
  const haidian = (candidates ?? []).filter((p) => p.district.includes("海淀"));
  if (haidian.length === 0) return null;
  const inCampus = haidian.filter(isTsinghuaPoi);
  const pool = inCampus.length > 0 ? inCampus : haidian;
  return [...pool].sort((a, b) => poiRank(a, query) - poiRank(b, query))[0] ?? null;
}
