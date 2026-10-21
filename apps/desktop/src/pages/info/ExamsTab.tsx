import { localizedList as i18nList } from "../../i18n/index.js";
import { t as i18n, rich as i18nRich, useLocale as useUiLocale } from "../../i18n/index.js";
/**
 * 考试安排页 —— getExams（zhjw 课表 JSONP 中分类 fl="考试" 的条目，
 * 与 thu-info-lib parseJSON 同源数据；RN 端同样以课表分类呈现考试）。
 */
import { useMemo } from "react";
import type { ExamEntry } from "@onethu/core";
import { Card, Empty, ErrorNote, SectionHead, SkeletonRows } from "../../components/Layout.js";
import { useExams } from "../../state/data.js";

const WEEKDAYS = i18nList(["pages.info.examstab.85217f7aff77","pages.info.examstab.51a75f4634df","pages.info.examstab.084b42f6e95e","pages.info.examstab.a4c3313deb18","pages.info.examstab.754a9d5828d5","pages.info.examstab.c9b87f516a38","pages.info.examstab.de07b5383874"]);

function weekdayOf(date: string): string {
  const d = new Date(date.replace(/-/g, "/"));
  return Number.isNaN(d.getTime()) ? "" : i18n("pages.info.examstab.9491e7091592", { value: String(WEEKDAYS[d.getDay()]) });
}

function countdown(date: string, startTime?: string): { text: string; cls: string } {
  const base = startTime ? `${date}T${startTime}` : date.replace(/-/g, "/");
  const t = new Date(base).getTime();
  if (Number.isNaN(t)) return { text: i18n("pages.info.examstab.b10b29ca43f2"), cls: "chip-gray" };
  const days = Math.ceil((t - Date.now()) / 86400000);
  if (days < 0) return { text: i18n("pages.info.examstab.d79b1d0e5c61"), cls: "chip-gray" };
  if (days === 0) return { text: i18n("pages.info.examstab.d5f5a7a01073"), cls: "chip-red" };
  if (days <= 3) return { text: i18n("pages.info.examstab.aa9435b82109", { days: String(days) }), cls: "chip-amber" };
  if (days <= 14) return { text: i18n("pages.info.examstab.aa9435b82109", { days: String(days) }), cls: "chip-blue" };
  return { text: i18n("pages.info.examstab.aa9435b82109", { days: String(days) }), cls: "chip-gray" };
}

/** "2025-06-20" → "6月20日 周五" */
function dateTitle(date: string): string {
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  return i18n("pages.info.examstab.0e5071b93d57", { month: String(month), day: String(day), value: String(weekdayOf(date)) });
}

export function ExamsTab() {
  const uiLocale = useUiLocale();

  const { data, state, error, reload } = useExams();

  const groups = useMemo(() => {
    if (!data) return [];
    const byDate = new Map<string, ExamEntry[]>();
    for (const exam of data) {
      const list = byDate.get(exam.date);
      if (list) list.push(exam);
      else byDate.set(exam.date, [exam]);
    }
    return [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [uiLocale, data]);

  const upcoming = useMemo(
    () => (data ?? []).filter((e) => countdown(e.date, e.startTime).cls !== "chip-gray").length,
    [uiLocale, data],
  );

  return (
    <>
      <SectionHead
        title={i18n("pages.info.examstab.88df420f8207")}
        aside={state === "ready" && data ? i18n("pages.info.examstab.9dec2ce0d8fc", { length: String(data.length), upcoming: String(upcoming) }) : i18n("pages.info.examstab.3cdc60a174f2")}
      />
      {state === "error" && !data ? <ErrorNote text={error ?? ""} onRetry={() => void reload()} /> : null}
      {state === "loading" && !data ? (
        <SkeletonRows rows={4} />
      ) : state === "error" && !data ? null : (data?.length ?? 0) === 0 ? (
        <Card>
          <Empty text={i18n("pages.info.examstab.c490e6cc45d9")} />
        </Card>
      ) : (
        groups.map(([date, exams]) => (
          <div key={date} style={{ marginBottom: 18 }}>
            <SectionHead title={dateTitle(date)} aside={i18n("pages.info.examstab.dac4254b777c", { length: String(exams.length) })} />
            <Card className="list">
              {exams.map((e, i) => {
                const chip = countdown(e.date, e.startTime);
                return (
                  <div
                    className="row"
                    key={`${e.courseName}-${i}`}
                    style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}
                  >
                    <div className="row-when">
                      <b>{e.startTime ?? "--:--"}</b>
                      <span>{i18nRich("pages.info.examstab.7736a85c89ff", { value: e.endTime ?? "--:--" })}</span>
                    </div>
                    <div className="row-main">
                      <div className="row-title">{e.courseName}</div>
                      <div className="row-sub">{e.location || i18n("pages.info.examstab.d4b794824720")}</div>
                    </div>
                    <span className={`chip ${chip.cls}`}>
                      <span className="dot" />
                      {chip.text}
                    </span>
                  </div>
                );
              })}
            </Card>
          </div>
        ))
      )}
    </>
  );
}
