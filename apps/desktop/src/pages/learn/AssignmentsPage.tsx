/** 全部作业（learnX Assignments）：按状态分组（进行中/已逾期/已交/已批改），组内按截止时间排序 */
import { useMemo, useState } from "react";
import { parseLearnTime, SOURCE_NAMES } from "@onethu/core";
import { PageAtomStar } from "../..//components/Collect.js";
import { SegmentedOverflow, Card, Empty, ErrorNote, PageHead, SkeletonRows } from "../../components/Layout.js";
import { IconRefresh } from "../../components/Icons.js";
import { useApp } from "../../state/context.js";
import { useLearnData } from "../../state/data.js";
import { ExtHwLoginModal } from "../../components/ExtHwLoginModal.js";
import {
  dismissExtHwGuide,
  isExtHwGuideDismissed,
  requestExtHwScroll,
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
 *  仅「尚未配置任何外部源」时显示，配置后自动消失；「知道了」持久忽略（localStorage）。
 *  R11 16.3：主文案改为「接入多平台作业聚合」；主按钮「登录雨课堂」弹登录通道 modal
 *  （微信扫码；R17 23.2 短信通道因图形验证码已停用，UI 参考校园卡充值弹窗）；次按钮「去设置」跳设置页 extHw 区。
 *  R13 18.3：文案改两段式——雨课堂人人可用（主按钮仍登录雨课堂）；OJ 平台按个人情况
 *  在设置页登录，不再把三类平台并列平铺。 */
function ExtHwGuide() {
  const { navigate } = useApp();
  const ext = useExternalHomework();
  const [dismissed, setDismissed] = useState(() => isExtHwGuideDismissed());
  const [loginOpen, setLoginOpen] = useState(false);
  // 等凭据解密完成（state=ready）再判断，避免已配置用户瞬时闪一下横幅
  if (ext.state !== "ready" || ext.configured || dismissed) return null;
  return (
    <>
      <div className="browser-hint ext-hw-hint">
        <span className="ext-hw-hint-text">
          <div>雨课堂人人可用；OJ 平台（TUOJ、Tyche 等）按个人情况在设置页登录。</div>
          <div style={{ opacity: 0.8, marginTop: 2 }}>
            登录后把各平台作业 DDL 合并到「全部作业」与「今日」。
          </div>
          {/* R11 16.2：TUOJ 自动漫游已过统一认证但未返回课程——条幅提示，不算错误 */}
          {ext.tuojAuto.tuoj.kind === "no-courses" ? (
            <div style={{ opacity: 0.8, marginTop: 2 }}>
              TUOJ 统一认证已通过，但未返回课程（可能未注册 / 未选课）。
            </div>
          ) : null}
        </span>
        <button className="btn btn-primary" onClick={() => setLoginOpen(true)}>
          登录雨课堂
        </button>
        <button
          className="btn"
          onClick={() => {
            requestExtHwScroll();
            navigate("settings");
          }}
        >
          去设置
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
      <ExtHwLoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </>
  );
}

/* R19 27.1：TUOJ 会话失效已静默自动重漫游过、但该源最终仍失败时，作业页明示
 * 「已尝试自动重新登录，仍失败：<原因>」（文案由 core 组装进 errors）并保留手动入口
 * ——「去设置重新登录」跳设置页 extHw 区的「统一认证登录」。不弹窗，仅条幅；
 * 其余源错误仍只在设置页展示（与既有行为一致）。 */
function ExtHwTuojErrorNote() {
  const { navigate } = useApp();
  const ext = useExternalHomework();
  const rows = (["tuoj", "tuojClassic"] as const)
    .map((id) => ({ id, name: SOURCE_NAMES[id], err: ext.errors[id] }))
    .filter((r) => Boolean(r.err));
  // 等凭据解密完成再判断，避免就绪前闪一下
  if (ext.state !== "ready" || rows.length === 0) return null;
  return (
    <div className="browser-hint ext-hw-hint">
      <span className="ext-hw-hint-text">
        {rows.map(({ id, name, err }) => (
          <div key={id} style={{ color: "var(--danger, #c04848)" }}>
            {name}：{err}
          </div>
        ))}
      </span>
      <button
        className="btn"
        onClick={() => {
          requestExtHwScroll();
          navigate("settings");
        }}
      >
        去设置重新登录
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

      {/* R19 27.1：TUOJ 自动重漫游仍失败的静默条幅（含「去设置重新登录」手动入口） */}
      <ExtHwTuojErrorNote />

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
