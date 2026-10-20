import { t as i18n, localizedList as i18nList } from "../i18n/index.js";
/**
 * 日期文案格式化。
 *
 * 单独放一个不依赖 JSX 的模块，是为了让 tools/date-text-test.mjs 能直接 import 它跑行为测试。
 *
 * 由来（2026-02 真机 BUG）：Today 页头曾显示 "81月28日" —— 那行是裸 + 串接：
 *   (expanded ? greet + " · " : "") + now.getMonth() + 1 + "月" + ...
 * JS 的 + 从左往右算，第一个操作数是字符串时，后面全程变字符串拼接：
 *   "" + 8  → "8"，再 + 1 → "81"。数字格式化统一收在这里，别在外面裸拼。（护栏 tools/date-text-test.mjs 扫裸拼时会跳过注释行，所以这里可以直接写反例。）
 */

/** 星期名（getDay() 下标，0 = 周日） */
export const WEEKDAYS = i18nList(["lib.datetext.85217f7aff77","lib.datetext.51a75f4634df","lib.datetext.084b42f6e95e","lib.datetext.a4c3313deb18","lib.datetext.754a9d5828d5","lib.datetext.c9b87f516a38","lib.datetext.de07b5383874"]);

/** "9月28日 星期一" */
export function fmtMonthDayWeek(d: Date): string {
  return i18n("lib.datetext.a619476ecb90", { value: String(d.getMonth() + 1), value2: String(d.getDate()), value3: String(WEEKDAYS[d.getDay()]) });
}
