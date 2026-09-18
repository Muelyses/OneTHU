/**
 * Tyche（清华程序在线评测，内网）只读客户端。
 *
 * 实测（2026-09-18）：
 * - 用户 GET user/UserFetchSetting
 * - 课程组 GET group/GroupList → { groupList: [{ gid, name }] }
 * - 组详情+作业 GET group/ShowGroup?gid=42 → { group: { gid, name, tasks: [...] } }
 *   任务字段：{ tid, title, startTime, endTime, judgeEndTime, description, restricted }
 * - 鉴权**两层**：`Authorization: Basic base64("cs:thuc++")` **且** Cookie（JSESSIONID/username/uid）
 * - DDL = judgeEndTime || endTime，形如 "2026-09-27T16:00:00"（**无时区**）
 *   → 必须按**本地时间**解析（直接 new Date 会当 UTC，差 8 小时）
 * - 会话失效 → 响应 {"status":"login"}
 * ⚠️ 服务端地址与 Basic 头均硬编码，凭据不再携带 base
 */
import type { FetchLike } from "../http.js";
import type { ExternalHomework, HomeworkSource } from "./types.js";

export const BASE = "http://166.111.236.164:6080/tyche";
/** 外层 Basic 认证（写死，不向用户暴露） */
const DEFAULT_BASIC = "cs:thuc++";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.88 Safari/537.36";

interface TycheCred {
  cookie: string;
}

/** 无时区的本地日期时间串 → 毫秒（"2026-09-27T16:00:00" 按本地时间，绝不按 UTC） */
function parseLocalDateTime(s: string): number {
  const t = s.trim();
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(t);
  if (!m) {
    const p = Date.parse(t);
    return Number.isNaN(p) ? NaN : p;
  }
  return new Date(+m[1]!, +m[2]! - 1, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)).getTime();
}

/** 毫秒时间戳 → "YYYY-MM-DD HH:MM"（本地时区） */
function fmtLocal(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Basic 头：原始 "user:pass" 现场 base64；已带 "Basic " 前缀或已是 base64 的原样保留 */
export function basicHeader(raw: string): string {
  const v = (raw ?? "").trim() || DEFAULT_BASIC;
  if (/^basic\s+/i.test(v)) return v;
  if (v.includes(":")) return `Basic ${BufferLike.base64(v)}`;
  return `Basic ${v}`;
}

/** 免依赖 base64（core 不能假设 Buffer 可用；纯 ASCII 输入） */
const BufferLike = {
  base64(s: string): string {
    const g = globalThis as { btoa?: (x: string) => string; Buffer?: { from: (x: string) => { toString: (e: string) => string } } };
    if (typeof g.btoa === "function") return g.btoa(s);
    if (g.Buffer) return g.Buffer.from(s).toString("base64");
    throw new Error("当前环境缺少 base64 编码能力");
  },
};

async function getJson(fetchLike: FetchLike, url: string, headers: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetchLike(url, { method: "GET", headers });
  if (res.status === 401 || res.status === 403) {
    throw new Error(`Tyche 鉴权失败（HTTP ${res.status}），请检查 Basic / Cookie（校外需 WebVPN）`);
  }
  const body = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new Error("Tyche 返回非 JSON（会话可能已失效）");
  }
  const obj = (json ?? {}) as Record<string, unknown>;
  if (obj["status"] === "login") throw new Error("Tyche 会话已失效（status=login），请在设置页更新 Cookie");
  return obj;
}

/**
 * 查单个作业（task）是否已提交：`GET task/Status?tid={tid}&gid={gid}`（**不带 all=true**）。
 * 实测：不带 `all=true` 时只返回**当前用户**的提交（`submissionList[].name` = 自己，
 * `uid` = 自己）；带 `all=true` 则返回全组。故 `submissionCount > 0` → 已提交。
 * ⚠️ 不用 `task/ProblemStatus`：其实测返回 sid/uid/submitedTime 全为 null、
 *    result/score 恒定（与是否提交无关），**不是**用户维度的提交状态。
 */
async function fetchTycheStatus(
  fetchLike: FetchLike,
  base: string,
  headers: Record<string, string>,
  gid: unknown,
  tid: unknown,
): Promise<{ submitted: boolean; submittedCount?: number }> {
  const st = await getJson(
    fetchLike,
    `${base}/task/Status?tid=${encodeURIComponent(String(tid))}&gid=${encodeURIComponent(String(gid))}`,
    headers,
  );
  const cnt = st["submissionCount"];
  const list = Array.isArray(st["submissionList"]) ? st["submissionList"] : [];
  const count = typeof cnt === "number" && Number.isFinite(cnt) ? cnt : list.length;
  return { submitted: count > 0, submittedCount: count > 0 ? count : undefined };
}

export function createTycheSource(cred: TycheCred, fetchLike: FetchLike, days: number): HomeworkSource {
  const base = BASE;
  const headers = {
    Authorization: basicHeader(DEFAULT_BASIC),
    Cookie: (cred.cookie ?? "").trim(),
    "User-Agent": UA,
    Accept: "application/json, text/plain, */*",
  };
  return {
    id: "tyche",
    name: "Tyche",
    async fetch(): Promise<ExternalHomework[]> {
      const groupsBody = await getJson(fetchLike, `${base}/group/GroupList`, headers);
      const groups = Array.isArray(groupsBody["groupList"])
        ? (groupsBody["groupList"] as Array<Record<string, unknown>>)
        : [];
      const limit = Date.now() + (days > 0 ? days : 30) * 86400000;
      const out: ExternalHomework[] = [];
      for (const g of groups) {
        const gid = g["gid"];
        if (gid === undefined || gid === null) continue;
        const groupName = String(g["name"] ?? "Tyche 课程");
        // 逐课程组隔离：单个失败只跳过
        try {
          const detail = await getJson(fetchLike, `${base}/group/ShowGroup?gid=${gid}`, headers);
          const group = (detail["group"] ?? {}) as Record<string, unknown>;
          const tasks = Array.isArray(group["tasks"])
            ? (group["tasks"] as Array<Record<string, unknown>>)
            : [];
          for (const t of tasks) {
            const tid = t["tid"];
            if (tid === undefined || tid === null) continue;
            const raw = t["judgeEndTime"] ?? t["endTime"];
            if (typeof raw !== "string" || !raw.trim()) continue;
            const ms = parseLocalDateTime(raw);
            if (!Number.isFinite(ms)) continue;
            if (ms > limit) continue;
            // 提交状态（仅对时间窗内的 task 查）；失败只跳过（保守 false）
            let status: { submitted: boolean; submittedCount?: number } = { submitted: false };
            try {
              status = await fetchTycheStatus(fetchLike, base, headers, gid, tid);
            } catch {
              /* 状态查询失败：保守保持未提交 */
            }
            const hw: ExternalHomework = {
              id: `tyche-${gid}-${tid}`,
              source: "tyche",
              courseName: groupName,
              title: String(t["title"] ?? "作业"),
              deadline: fmtLocal(ms),
              kind: "homework",
              url: `${base}/#!html/Task.html&tid=${tid}`,
              submitted: status.submitted,
            };
            if (status.submittedCount !== undefined) hw.submittedCount = status.submittedCount;
            out.push(hw);
          }
        } catch {
          /* 单课程组失败跳过 */
        }
      }
      return out;
    },
  };
}
