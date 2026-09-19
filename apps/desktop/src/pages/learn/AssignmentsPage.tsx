/** 全部作业（learnX Assignments）：按状态分组（进行中/已逾期/已交/已批改），组内按截止时间排序 */
import { useMemo, useState } from "react";
import { parseLearnTime } from "@onethu/core";
import { PageAtomStar } from "../..//components/Collect.js";
import { SegmentedOverflow, Card, Empty, ErrorNote, PageHead, SkeletonRows } from "../../components/Layout.js";
import { IconRefresh } from "../../components/Icons.js";
import { useApp } from "../../state/context.js";
import { useLearnData } from "../../state/data.js";
import {
  dismissExtHwGuide,
  isExtHwGuideDismissed,
  toHomework,
  useExternalHomework,
} from "../../state/exthw.js";
import { BackButton, HomeworkRow, semesterText } from "./shared.js";
import { useLearnNavSemester } from "./shared.js";

type Filter = "unfinished" | "overdue" | "submitted" | "graded" | "all";

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "unfinished", label: "进行中" },
  { key: "overdue", label: "已逾期" },
  { key: "submitted", label: "已交" },
  { key: "graded", label: "已批" },
  { key: "all", label: "全部" },
];

/** 逾期未交（12.2）：未提交且截止时间已过。解析统一走 core parseLearnTime（与 shared.tsx
 *  同源；兼容外部源 "YYYY-MM-DD HH:mm" 与 ISO 串）；解析失败不判逾期 → 留在「进行中」，
 *  避免把拿不到 deadline 的条目误分类。 */
function isOverdue(h: { submitted: boolean; deadline: string }): boolean {
  if (h.submitted) return false;
  const d = parseLearnTime(h.deadline);
  return d !== null && d.getTime() < Date.now();
}

/** 外部作业源引导横幅：新用户不知道雨课堂/TUOJ 要单独登录。
 *  仅「尚未配置任何外部源」时显示，配置后自动消失；「知道了」持久忽略（localStorage）。 */
function ExtHwGuide() {
  const { navigate } = useApp();
  const ext = useExternalHomework();
  const [dismissed, setDismissed] = useState(() => isExtHwGuideDismissed());
  // 等凭据解密完成（state=ready）再判断，避免已配置用户瞬时闪一下横幅
  if (ext.state !== "ready" || ext.configured || dismissed) return null;
  return (
    <div className="browser-hint ext-hw-hint">
      <span className="ext-hw-hint-text">
        外部作业来自雨课堂 / TUOJ / Tyche，首次使用请到「设置 → 外部作业源」登录（雨课堂支持微信扫码，TUOJ
        支持清华统一认证一键登录）。
      </span>
      <button className="btn" onClick={() => navigate("settings")}>
        去登录
      </button>
      <button
        className="btn btn-ghost"
        onClick={() => {
          dismissExtHwGuide();
          setDismissed(true);
        }}
      >
        知道了
      </button>
    </div>
  );
}

export function AssignmentsPage() {
  useLearnNavSemester();
  const { data, state, error, reload } = useLearnData();
  const ext = useExternalHomework();
  const [filter, setFilter] = useState<Filter>("unfinished");

  const byCourse = useMemo(
    () => new Map((data?.courses ?? []).map((c) => [c.id, c.name])),
    [data],
  );

  /** 外部作业（雨课堂/TUOJ/Tyche）归一化；未配置凭据时恒为空数组（零回归） */
  const extHw = useMemo(() => ext.items.map(toHomework), [ext.items]);

  const groups = useMemo(() => {
    const hw = [...(data?.homework ?? []), ...extHw].sort((a, b) => a.deadline.localeCompare(b.deadline));
    return {
      // 进行中 = 未交且未逾期（含 deadline 解析失败者，保守不判逾期）
      unfinished: hw.filter((h) => !h.submitted && !isOverdue(h)),
      overdue: hw.filter(isOverdue),
      submitted: hw.filter((h) => h.submitted && !h.graded),
      graded: hw.filter((h) => h.graded),
      all: hw,
    };
  }, [data, extHw]);

  const list = groups[filter];
  // R10 15.4：页头只留学期文本；各分组计数已并入 SegmentedOverflow 各 tab（含「全部」），
  // 「外部 N」删除（已融入各组、无信息量）
  const meta = data ? semesterText(data.semester.id) : "按截止时间排序";

  return (
    <>
      <PageHead
        title="全部作业"
        meta={meta}
        actions={
          <>
            <PageAtomStar atomKey="learn-assignments" title="全部作业" />
            <BackButton to="learn" label="课程列表" />
            <button className="btn" onClick={() => void reload()} disabled={state === "loading"}>
              <IconRefresh width={14} height={14} />
              刷新
            </button>
          </>
        }
      />

      {state === "error" ? <ErrorNote text={error ?? ""} onRetry={() => void reload()} /> : null}

      <ExtHwGuide />

      <SegmentedOverflow>
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            role="tab"
            aria-selected={filter === key}
            className={filter === key ? "is-active" : ""}
            onClick={() => setFilter(key)}
          >
            {label}
            <span className="tab-count">{groups[key].length}</span>
          </button>
        ))}
      </SegmentedOverflow>

      {state === "loading" && !data ? (
        <SkeletonRows rows={6} />
      ) : state === "error" && !data ? null : list.length === 0 ? (
        <Card><Empty text={filter === "unfinished" ? "没有进行中的作业。" : filter === "overdue" ? "没有已逾期未交的作业。" : "该分组暂无作业。"} /></Card>
      ) : (
        <Card className="list">
          {list.map((h, i) => (
            <HomeworkRow key={`${h.courseId}-${h.id}`} h={h} courseName={h.courseName ?? byCourse.get(h.courseId)} sem={data?.semester.id} from="learn-assignments" remind style={{ animationDelay: `${i * 25}ms` }} />
          ))}
        </Card>
      )}
    </>
  );
}
