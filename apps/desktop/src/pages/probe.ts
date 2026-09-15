/**
 * 管线验收探针（dev2 移植定案验收，docs/INFOLIB-PIPELINE-REVIEW.md DoD）：
 * 登录后逐项调 thu-info-lib 公开 API——每项都走「包装域 + wengine SSO + 共享
 * jar」的完整单管线，任何一项红 = 该链路适配有缺口。设置页一键运行。
 */
import { helper } from "../lib/infoLib.js";

export interface ProbeItem {
  name: string;
  run: () => Promise<string>;
}

/** 验收矩阵：姓名 = lib API；期望 = 非空结构化结果 */
export const PROBE_ITEMS: ProbeItem[] = [
  {
    name: "个人信息（yyfw 漫游 + grjbxx）",
    run: async () => {
      const u = await helper.getUserInfo();
      return `${u.fullName} / 邮箱前缀 ${u.emailName}`;
    },
  },
  {
    name: "校历（info gxfw）",
    run: async () => {
      const c = await helper.getCalendar();
      return `${c.semesterId} / ${c.weekCount} 周（首日 ${c.firstDay}）`;
    },
  },
  {
    name: "课表（教务 jxrl 漫游）",
    run: async () => {
      const s = await helper.getSchedule();
      return `条目数=${s.schedule?.length ?? "?"}`;
    },
  },
  {
    name: "图书馆（ISeating 座位）",
    run: async () => {
      const l = await helper.getLibraryList();
      return `馆数=${Array.isArray(l) ? l.length : "?"}`;
    },
  },
  {
    name: "新闻（xxfb 列表）",
    run: async () => {
      const n = await helper.getNewsList(1, 10);
      return `条数=${n.length}（首条 ${n[0]?.name?.slice(0, 18) ?? "-"}）`;
    },
  },
  {
    name: "校园卡（card 域会话）",
    run: async () => {
      const info = await helper.getCampusCardInfo();
      return `${info.userName ?? "?"} / ${info.departmentName ?? "?"}`;
    },
  },
];

export interface ProbeResult {
  name: string;
  ok: boolean;
  detail: string;
  ms: number;
}

/** 顺序跑全矩阵（会话同一，避免并发互踩；单飞由调用方节流） */
export async function runProbeMatrix(): Promise<ProbeResult[]> {
  const out: ProbeResult[] = [];
  for (const item of PROBE_ITEMS) {
    const t0 = Date.now();
    try {
      const detail = await item.run();
      out.push({ name: item.name, ok: true, detail, ms: Date.now() - t0 });
    } catch (e) {
      out.push({ name: item.name, ok: false, detail: String(e).slice(0, 160), ms: Date.now() - t0 });
    }
  }
  return out;
}
