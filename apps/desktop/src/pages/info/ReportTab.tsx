import { t as i18n, rich as i18nRich, useLocale as useUiLocale } from "../../i18n/index.js";
/**
 * 成绩页 —— getReport（thu-info-lib basics.ts getReport 同源解析）。
 * 学期分组表格 + 学期/学年/全部加权平均分统计（P 等非数字绩点不计入统计）。
 */
import { useMemo } from "react";
import type { ReportRow } from "@onethu/core";
import { Card, Empty, ErrorNote, SectionHead, SkeletonRows } from "../../components/Layout.js";
import { IconPen, IconRefresh } from "../../components/Icons.js";
import { useReport } from "../../state/data.js";

function weightedAverage(rows: ReportRow[]): number | null {
  let credits = 0;
  let points = 0;
  for (const r of rows) {
    if (!Number.isFinite(r.point) || !Number.isFinite(r.credit) || r.credit <= 0) continue;
    credits += r.credit;
    points += r.point * r.credit;
  }
  return credits > 0 ? points / credits : null;
}

/** 学期串 → 学年（"2024-2025秋" → "2024-2025"） */
function academicYear(semester: string): string {
  return semester.split("-").slice(0, 2).join("-");
}

function gradeClass(grade: string): string {
  if (/^A/.test(grade)) return "grade-a";
  if (/^B\+?$/.test(grade) || grade === "B") return "grade-b";
  if (/^[CD]/.test(grade) || grade === "F") return "grade-low";
  return "";
}

export function ReportTab() {
  const uiLocale = useUiLocale();

  const { data, state, error, reload } = useReport();

  const groups = useMemo(() => {
    if (!data) return [];
    const bySemester = new Map<string, ReportRow[]>();
    for (const row of data) {
      const key = row.semester || i18n("pages.info.reporttab.c58ec2570388");
      const list = bySemester.get(key);
      if (list) list.push(row);
      else bySemester.set(key, [row]);
    }
    // 学期倒序（最新在前）：semester 形如 "2024-2025秋"，字符串序即时间序
    return [...bySemester.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [uiLocale, data]);

  const overall = useMemo(() => (data ? weightedAverage(data) : null), [uiLocale, data]);
  const totalCredits = useMemo(
    () =>
      (data ?? [])
        .filter((r) => Number.isFinite(r.credit))
        .reduce((sum, r) => sum + r.credit, 0),
    [uiLocale, data],
  );
  const latestAvg = useMemo(() => (groups.length > 0 ? weightedAverage(groups[0]?.[1] ?? []) : null), [uiLocale, groups]);

  const yearStats = useMemo(() => {
    const byYear = new Map<string, ReportRow[]>();
    for (const row of data ?? []) {
      const year = academicYear(row.semester || "");
      const list = byYear.get(year);
      if (list) list.push(row);
      else byYear.set(year, [row]);
    }
    return [...byYear.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [uiLocale, data]);

  return (
    <>
      <div className="stats">
        <Card className="stat-card">
          <span className="stat-icon">
            <IconPen width={17} height={17} />
          </span>
          <div>
            <div className="stat-num">{state === "loading" && !data ? "–" : (data?.length ?? 0)}</div>
            <div className="stat-label">{i18n("pages.info.reporttab.dc6c9f070ee1")}</div>
          </div>
        </Card>
        <Card className="stat-card">
          <span className="stat-icon green">
            <IconRefresh width={17} height={17} />
          </span>
          <div>
            <div className="stat-num">{totalCredits ? totalCredits.toFixed(1) : "–"}</div>
            <div className="stat-label">{i18n("pages.info.reporttab.e842a5dff916")}</div>
          </div>
        </Card>
        <Card className="stat-card">
          <span className="stat-icon amber">
            <IconPen width={17} height={17} />
          </span>
          <div>
            <div className="stat-num">{overall === null ? "–" : overall.toFixed(3)}</div>
            <div className="stat-label">{i18n("pages.info.reporttab.499dfff8b69c")}</div>
          </div>
        </Card>
        <Card className="stat-card">
          <span className="stat-icon">
            <IconRefresh width={17} height={17} />
          </span>
          <div>
            <div className="stat-num">{latestAvg === null ? "–" : latestAvg.toFixed(3)}</div>
            <div className="stat-label">{i18nRich("pages.info.reporttab.cdf6c06897e6", { value: groups[0]?.[0] ?? "–" })}</div>
          </div>
        </Card>
      </div>

      {state === "error" ? <ErrorNote text={error ?? ""} onRetry={() => void reload()} /> : null}

      {state === "loading" && !data ? (
        <SkeletonRows rows={6} />
      ) : (data?.length ?? 0) === 0 ? (
        <Card>
          <Empty text={i18n("pages.info.reporttab.96b26224eb33")} />
        </Card>
      ) : (
        <>
          {groups.map(([semester, rows]) => {
            const avg = weightedAverage(rows);
            return (
              <div key={semester} style={{ marginBottom: 18 }}>
                <SectionHead
                  title={semester}
                  aside={i18n("pages.info.reporttab.8763e1ee9a80", { value: String(avg === null ? "–" : avg.toFixed(3)), length: String(rows.length) })}
                />
                <Card style={{ padding: 0, overflow: "hidden" }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>{i18n("pages.info.reporttab.60db1afb4022")}</th>
                        <th className="num">{i18n("pages.info.reporttab.f9d072c4804c")}</th>
                        <th className="num">{i18n("pages.info.reporttab.337717173807")}</th>
                        <th className="num">{i18n("pages.info.reporttab.6a678f86c93a")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={`${semester}-${i}`} style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
                          <td className="cell-title">{r.name}</td>
                          <td className="num">{Number.isFinite(r.credit) ? r.credit : "–"}</td>
                          <td className={`num ${gradeClass(r.grade)}`}>{r.grade || "–"}</td>
                          <td className="num">{Number.isFinite(r.point) ? r.point.toFixed(1) : "–"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              </div>
            );
          })}

          <SectionHead title={i18n("pages.info.reporttab.b16415ce0520")} aside={i18n("pages.info.reporttab.f8085fddfe0a")} />
          <Card style={{ padding: 0, overflow: "hidden" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>{i18n("pages.info.reporttab.61fd2cb63d18")}</th>
                  <th className="num">{i18n("pages.info.reporttab.60db1afb4022")}</th>
                  <th className="num">{i18n("pages.info.reporttab.f9d072c4804c")}</th>
                  <th className="num">{i18n("pages.info.reporttab.392d02e60ed7")}</th>
                </tr>
              </thead>
              <tbody>
                {yearStats.map(([year, rows]) => {
                  const avg = weightedAverage(rows);
                  const credits = rows
                    .filter((r) => Number.isFinite(r.credit))
                    .reduce((s, r) => s + r.credit, 0);
                  return (
                    <tr key={year}>
                      <td className="cell-title">{year}</td>
                      <td className="num">{rows.length}</td>
                      <td className="num">{credits.toFixed(1)}</td>
                      <td className="num">{avg === null ? "–" : avg.toFixed(3)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </>
  );
}
