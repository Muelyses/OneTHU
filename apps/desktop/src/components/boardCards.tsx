/**
 * 白板侧的可独立渲染注册表（霖 2026-10-11）。
 *
 * **为什么需要它**：卡片的"身体"原先由来源页在运行时发布 JSX（`publishCards`），于是
 * 只有那条页面挂载过、白板上才有内容——没进过「我的」/「信息」的组件，加到白板上只会显示
 * "内容由原页面提供"。这与白板的初衷（任意组件可任意组合到一个页面）相悖。
 *
 * 这里给每个组件一份**自足实现**：直接读同一批状态层 hooks，因此
 *   · 在任何页面（含白板）都能渲染；
 *   · 数据是**活**的（来源页发布的是发布那一刻的快照，这里不是）；
 *   · 抽屉预览也能用它（比示例数据更真实）。
 *
 * 新增组件时在此登记即可，白板的 `mergeRenderers` 会优先取这里的实现。
 */
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { useCountUp } from "./CountUp.js";
import { useCard, useProfile, useReport } from "../state/data.js";
import { useApp } from "../state/context.js";
import { displayStudentId } from "../lib/privacy.js";
import { creditsOf, weightedAverage } from "../lib/grades.js";
import { Card } from "./Layout.js";
import { cardRendererKey } from "../state/liveCards.js";
import type { WidgetSize } from "../state/widgetMeta.js";
import { StatTile } from "../pages/info/reportParts.js";
import { IconCheck, IconCard, IconExternal, IconPen, IconSchedule } from "./Icons.js";
import { refreshWeather, subscribeWeather, weatherAgeText, weatherSnapshot, weatherText } from "../state/weather.js";

/** 渲染器可接收"具体条目"的定位参数（§7 行级元素）与**当前档位尺寸**（按尺寸排版）。 */
type CardRenderer = (props?: Record<string, unknown>, size?: WidgetSize) => ReactNode;
import { CalendarTab } from "../pages/info/CalendarTab.js";
import { CourseInfoTab } from "../pages/info/CourseInfoTab.js";
import { EvaluationTab } from "../pages/info/EvaluationTab.js";
import { ExamsTab } from "../pages/info/ExamsTab.js";
import { FitnessTab } from "../pages/info/FitnessTab.js";
import { NewsTab } from "../pages/info/NewsTab.js";
import { ProfileTab } from "../pages/info/ProfileTab.js";
import { ReportTab } from "../pages/info/ReportTab.js";
import { HOME_CARD_META } from "../lib/homeCards.js";
import { CardTab } from "../pages/info/CardTab.js";
import { DormTab } from "../pages/info/DormTab.js";
import { GradIncomeTab } from "../pages/info/GradIncomeTab.js";
import { HygieneTab } from "../pages/info/HygieneTab.js";
import { InvoiceTab } from "../pages/info/InvoiceTab.js";
import { LibRoomTab } from "../pages/info/LibRoomTab.js";
import { LibraryTab } from "../pages/info/LibraryTab.js";
import { PayrollTab } from "../pages/info/PayrollTab.js";
import { WasherTab } from "../pages/info/WasherTab.js";
import { SemesterSelectionPage } from "../pages/learn/SemesterSelectionPage.js";
import { SearchPage } from "../pages/learn/SearchPage.js";
import { ZhjwxkCoursesPage } from "../pages/zhjwxk/Courses.js";
import { useCampusData, useLearnData, useTodayReservations } from "../state/data.js";
import { AgendaWidget, NewsRows, ResvRows, TodayOverviewWidget, hm, useSubsNewsFeed } from "./HomeWidgets.js";
import { minText, pickNextClass, ymd } from "./HomeWidgets.js";
import { FileRow, HomeworkRow, NoticeRow } from "../pages/learn/shared.js";
import {
  ReportScoreRows,
  ReportStatCredit,
  ReportStatDone,
  ReportStatLatest,
  ReportStatOverall,
} from "../pages/info/reportParts.js";

/* 三张数字卡统一走 StatTile（与信息页四张统计卡同一块骨架、同一套档位排版）：
   1×1 只留数值、2×1 补名称、2×2 再补一行上下文。取数与递增动画不变。 */

/** 校园卡余额。 */
function MineBalanceCard(): ReactNode {
  const card = useCard(1);
  const text = useCountUp(card.data?.info.balance ?? null, (v) => "¥" + v.toFixed(2));
  return <StatTile icon={<IconCard width={17} height={17} />} num={text} label="校园卡余额" cap="生活页 · 流水与充值" />;
}

/** 已修学分。2×2 补一行已修门数。 */
function MineCreditCard(): ReactNode {
  const rows = useReport().data ?? [];
  const credits = creditsOf(rows);
  const text = useCountUp(credits > 0 ? credits : null, (v) =>
    Number.isInteger(credits) ? String(Math.round(v)) : v.toFixed(1),
  );
  return (
    <StatTile
      tone="green"
      icon={<IconCheck width={17} height={17} />}
      num={text}
      label="学分"
      cap="已修学分合计"
      sub={rows.length ? "已修 " + rows.length + " 门" : null}
    />
  );
}

/** 加权平均分（GPA）。2×2 补一行口径说明。 */
function MineGpaCard(): ReactNode {
  const rows = useReport().data ?? [];
  const allGpa = weightedAverage(rows);
  const text = useCountUp(allGpa, (v) => v.toFixed(2));
  return (
    <StatTile
      tone="amber"
      icon={<IconPen width={17} height={17} />}
      num={text}
      label="GPA"
      cap="实际均绩 / 4.0"
      sub={rows.length ? "已修 " + rows.length + " 门" : null}
    />
  );
}

/**
 * 学生卡（显示型）。学号兜底登录账号，与「信息 → 个人信息」一字不差。
 *
 * 三档按「随档位加信息层」组织（霖 2026-10-12）：
 *   2×1 → 姓名 + 学号；4×1 → 再加院系，横向铺开（姓名在左、两行信息在右）；4×2 → 三行分层，姓名放大。
 */
function MineStudentCard(): ReactNode {
  const profile = useProfile();
  const { user: sessionUser } = useApp();
  const user = profile.data ?? null;
  const studentId = displayStudentId(user?.studentId || sessionUser?.username);
  return (
    <div className="mine-student-tiered">
      <b className="mine-name">{user?.name ?? "未获取"}</b>
      <span className="mine-student-meta">
        <i className="mine-sid">学号 {studentId || "未获取"}</i>
        <i className="mine-meta-value">{user?.department || "—"}</i>
      </span>
    </div>
  );
}

/**
 * 入口型组件（选课 / 全部作业 / 全部课程文件 / 卫生成绩 …）：
 * 它们是"跳转入口"，卡体本就是**一行入口**——图标语义用名称与说明表达，点击直达对应页面。
 * 这类组件原先没有渲染器，加到白板上只会显示"内容由原页面提供"（霖 2026-10-11 指出的那一批）。
 */
function EntryCard({ title, hint, page, params, size }: { title: string; hint?: string; page: string; params?: Record<string, unknown>; size?: WidgetSize }): ReactNode {
  const { navigate } = useApp();
  const text = entryHintFor(hint, size?.w ?? 4);
  return (
    <button
      type="button"
      className="wg-entry"
      onClick={() => navigate(page as never, params as never)}
    >
      <span className="wg-entry-name">{title}</span>
      <span className="wg-entry-side">
        {text ? <span className="wg-entry-hint">{text}</span> : null}
        <span className="wg-entry-chevron" aria-hidden="true">›</span>
      </span>
    </button>
  );
}

/**
 * 入口行的说明文字**按宽度分档**（霖 2026-10-11 定）：4 宽给完整说明、3 宽给缩句、
 * 2 宽只写「进入」、1 宽不写。缩句规则取完整说明里「·」之后的部分（如「信息门户 · 订阅动态」→「订阅动态」），
 * 没有分隔符时退回完整说明。渲染器没拿到尺寸时按最宽处理。
 */
function entryHintFor(hint: string | undefined, w: number): string | null {
  if (!hint) return null;
  if (w <= 1) return null;
  if (w === 2) return "进入";
  if (w === 3) return hint.split("·").pop()?.trim() || hint;
  return hint;
}

/**
 * 余额速览（霖 2026-10-11 定稿的两档排版）。
 *
 *   · 4×1（推荐档）：左校园卡、右宿舍电费并排，中间一条分隔线（保持现状）。
 *   · 4×2：改为上下两行，每行「左侧名称、右侧数值」。
 *
 * 这一份是**自足实现**：此前它只由今日页发布快照，没进过今日页的白板上会显示「内容由原页面提供」。
 * 宿舍电费仍是入口（需要宿舍上下文，数据链未接），因此右侧显示「去查询」。
 */
function BalanceStripCard({ size }: { size?: WidgetSize }): ReactNode {
  const card = useCard(1);
  const { navigate } = useApp();
  const balance = card.data?.info.balance != null ? "¥" + card.data.info.balance : "—";
  const toCard = (): void => navigate("life", { lifeTab: "card" } as never);
  const toDorm = (): void => navigate("life", { lifeTab: "dorm", dormSection: "ele" } as never);
  if ((size?.h ?? 1) >= 2) {
    return (
      <div className="balance-strip is-stacked">
        <button type="button" className="balance-row" onClick={toCard}>
          <span className="balance-label">校园卡</span>
          <span className="balance-value">{balance}</span>
        </button>
        <span className="balance-hsep" aria-hidden="true" />
        <button type="button" className="balance-row" onClick={toDorm}>
          <span className="balance-label">宿舍电费</span>
          <span className="balance-value balance-value-dim">去查询</span>
        </button>
      </div>
    );
  }
  return (
    <div className="balance-strip">
      <button type="button" className="balance-cell" onClick={toCard}>
        <span className="balance-label">校园卡</span>
        <span className="balance-value">{balance}</span>
      </button>
      <span className="balance-sep" aria-hidden="true" />
      <button type="button" className="balance-cell" onClick={toDorm}>
        <span className="balance-label">宿舍电费</span>
        <span className="balance-value balance-value-dim">去查询</span>
      </button>
    </div>
  );
}

/**
 * 订阅新闻（自足实现，霖 2026-10-12）。
 *
 * 三档按信息量递增：1×1 → 条数（+名称）；2×1 → 再加最新一条标题；4×2 → 整列表（标题、来源、时间，复用今日页行组件）。
 */
function NewsCard({ size }: { size?: WidgetSize }): ReactNode {
  const { navigate } = useApp();
  const news = useSubsNewsFeed();
  const list = news.data?.list ?? [];
  if (news.state !== "ready" || !list.length) return <div className="wg-card-empty">暂无订阅新闻</div>;
  if ((size?.w ?? 4) >= 4) return <NewsRows feed={news.data!} navigate={navigate} />;
  const first = list[0];
  return (
    <div className="stat-card stat-tiered stat-cap-2x1">
      <span className="stat-icon"><IconExternal width={17} height={17} /></span>
      <span className="stat-label">订阅新闻</span>
      <span className="stat-num">{list.length}</span>
      {first ? <span className="stat-cap">{first.name}</span> : null}
    </div>
  );
}

/**
 * 今日预约（自足实现，霖 2026-10-12）。
 *
 * 三档按信息量递增：1×1 → 条数（+名称）；2×1 → 再加最近一条的时间与场馆；4×2 → 逐条时间与地点（复用今日页的行组件）。
 */
function ResvCard({ size }: { size?: WidgetSize }): ReactNode {
  const resv = useTodayReservations();
  const { navigate } = useApp();
  const list = resv.state === "ready" ? resv.list ?? [] : [];
  if (!list.length) return <div className="wg-card-empty">今天没有预约</div>;
  if ((size?.w ?? 4) >= 4) return <ResvRows list={list} navigate={navigate} />;
  const first = list[0];
  const where = first ? (first.kind === "room" ? first.place || first.venue : first.venue) : "";
  return (
    <div className="stat-card stat-tiered stat-cap-2x1">
      <span className="stat-icon green"><IconSchedule width={17} height={17} /></span>
      <span className="stat-label">今日预约</span>
      <span className="stat-num">{list.length}</span>
      {first ? <span className="stat-cap">{hm(first.start) + " · " + where}</span> : null}
    </div>
  );
}

/**
 * 校园卡余额卡片（自足实现，霖 2026-10-12）。
 *
 * 此前只由今日页发布快照；现在直接读校园卡数据，任何页面都能渲染。
 * 排版复用统计卡那五个槽位（图标 / 名称 / 数值 / 口径）：1×1 金额+名称、2×1 图标+两栏、2×2 再加一行入口说明。
 */
function CardEntryCard(): ReactNode {
  const card = useCard(1);
  const { navigate } = useApp();
  const balance = card.data?.info.balance ?? null;
  return (
    <Card className="stat-card stat-click">
      <button
        type="button"
        className="stat-link stat-tiered"
        onClick={() => navigate("life", { lifeTab: "card" } as never)}
        aria-label="校园卡余额"
      >
        <span className="stat-icon amber"><IconCard width={17} height={17} /></span>
        <span className="stat-label">校园卡余额</span>
        <span className="stat-num">{balance != null ? "¥" + balance.toFixed(2) : "–"}</span>
        <span className="stat-cap">生活页 · 流水与充值</span>
      </button>
    </Card>
  );
}

/**
 * 下一节课（自足实现，霖 2026-10-12）。
 *
 * 此前它只由今日页发布快照；现在直接读状态层的课表，任何页面都能渲染。三档随信息层递增：
 *   1×1 → 只给倒计时（"23 分钟后" / "进行中"）；2×1 → 倒计时 + 课程名；
 *   4×2 → 倒计时 + 时间 + 课程名 + 地点 + 一节进度条。
 */
function NextClassCard({ size }: { size?: WidgetSize }): ReactNode {
  const schedule = useCampusData().data?.schedule ?? [];
  const [nowMin, setNowMin] = useState<number>(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });
  /* 每 30s 走一格：倒计时与进度条要能自己往下走，同时这个定时器只在这张卡挂载期间存在。 */
  useEffect(() => {
    const t = window.setInterval(() => {
      const d = new Date();
      setNowMin(d.getHours() * 60 + d.getMinutes());
    }, 30000);
    return () => window.clearInterval(t);
  }, []);
  const today = useMemo(() => {
    const d = new Date();
    const wd = d.getDay() === 0 ? 7 : d.getDay();
    const key = ymd(d);
    return schedule.filter((s) => (s.date ? s.date === key : s.dayOfWeek === wd));
  }, [schedule, nowMin]);
  const next = useMemo(() => pickNextClass(today, nowMin), [today, nowMin]);
  if (!next) return <div className="wg-card-empty">今天没有课</div>;
  const leftText = next.left > 0 ? next.left + " 分钟后" : "进行中";
  const span = Math.max(1, next.en - next.st);
  const pct = Math.max(0, Math.min(100, Math.round(((nowMin - next.st) / span) * 100)));
  return (
    <div className="next-class-tiered">
      <div className="next-class-head">
        <span className="next-class-left">{leftText}</span>
        <span className="next-class-time">{minText(next.st) + "–" + minText(next.en)}</span>
      </div>
      <div className="next-class-name">{next.s.courseName}</div>
      {next.s.location ? <div className="next-class-where">{next.s.location}</div> : null}
      <span className="next-class-bar" aria-hidden="true">
        <i style={{ width: String(pct) + "%" }} />
      </span>
    </div>
  );
}

/** 白板侧注册表：key 与白板文档里的 spec 同口径（custom:<id>）。 */
/**
 * 「全部课程文件」的**紧凑卡体**：复用原页面的行组件（FileRow），只截前几条。
 *
 * 霖 2026-10-11 的要求：入口型组件不该只是一个跳转入口，而应当**像在原页面那样直接显示信息**。
 * 做法就是"原页面的行 + 只截前 N 条"——外观与信息层级完全一致，尺寸适配卡片。
 */
function LearnFilesCard(): ReactNode {
  const learn = useLearnData();
  const data = learn.data;
  const files = (data?.files ?? [])
    .slice()
    .sort((a, b) => String(b.uploadTime).localeCompare(String(a.uploadTime)))
    .slice(0, 5);
  if (!files.length) return <div className="wg-card-empty">暂无课程文件</div>;
  return (
    <div className="wg-card-rows">
      {files.map((file) => (
        <FileRow key={file.courseId + "-" + file.id} f={file} from="learn-files" sem={data?.semester.id} />
      ))}
    </div>
  );
}

/** 课程名映射（原页面同款）：行组件需要它才显示"课程 · 标题"。 */
function courseNames(courses: { id: string; name: string }[] | undefined): Map<string, string> {
  return new Map((courses ?? []).map((c) => [c.id, c.name]));
}

/**
 * 「全部作业」的紧凑卡体：复用原页面的 `HomeworkRow`，按截止时间取最近 5 条。
 * 与「全部课程文件」同一套做法（原页面的行 + 截前 N 条）。
 */
function LearnAssignmentsCard(): ReactNode {
  const data = useLearnData().data;
  const byCourse = courseNames(data?.courses);
  const list = (data?.homework ?? [])
    .slice()
    .sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)))
    .slice(0, 5);
  if (!list.length) return <div className="wg-card-empty">暂无待办作业</div>;
  return (
    <div className="wg-card-rows">
      {list.map((h) => (
        <HomeworkRow
          key={h.courseId + "-" + h.id}
          h={h}
          courseName={byCourse.get(h.courseId)}
          from="learn-assignments"
          sem={data?.semester.id}
        />
      ))}
    </div>
  );
}

/** 「全部通知」的紧凑卡体：复用原页面的 `NoticeRow`，取最新 5 条。 */
function LearnNoticesCard(): ReactNode {
  const data = useLearnData().data;
  const byCourse = courseNames(data?.courses);
  const list = (data?.notifications ?? [])
    .slice()
    .sort((a, b) => String(b.publishTime).localeCompare(String(a.publishTime)))
    .slice(0, 5);
  if (!list.length) return <div className="wg-card-empty">暂无课程通知</div>;
  return (
    <div className="wg-card-rows">
      {list.map((n) => (
        <NoticeRow
          key={n.courseId + "-" + n.id}
          n={n}
          courseName={byCourse.get(n.courseId)}
          from="learn-notices"
          sem={data?.semester.id}
        />
      ))}
    </div>
  );
}

/**
 * 采集来的**某一个具体文件行**（§7 7.5 的行级元素）。
 *
 * 定位参数放在 `spec.props`（courseId / itemId），渲染时回到数据里取那一条——
 * 于是白板上显示的是这条文件的**真实信息**，而不是一个跳转入口。
 */
function LearnFileAtomCard({ props }: { props?: Record<string, unknown> }): ReactNode {
  const data = useLearnData().data;
  const courseId = String(props?.courseId ?? "");
  const itemId = String(props?.itemId ?? "");
  const file = (data?.files ?? []).find((x) => x.courseId === courseId && x.id === itemId);
  if (!file) {
    return <div className="wg-card-empty">{String(props?.title ?? "该文件已不在本学期数据里")}</div>;
  }
  return (
    <div className="wg-card-rows">
      <FileRow
        f={file}
        courseName={courseNames(data?.courses).get(file.courseId)}
        from="learn-files"
        sem={data?.semester.id}
      />
    </div>
  );
}

/** 遍历首页卡片元数据，把所有"入口型"一次性登记（新增入口无需再改这里）。 */
const ENTRY_RENDERERS: Record<string, CardRenderer> = {};
/* 已做出真实卡体的入口型：登记的渲染器覆盖下面的通用入口行。 */
/*
 * 生活页 / 预约页的栏目：这些栏目本身就是独立组件（与信息页同一套），登记即可直接显示信息。
 * 元素级拆分（如「全部成绩」拆为统计卡 + 列表）见后续批次。
 */
const ENTRY_REAL: Record<string, CardRenderer> = {
  [cardRendererKey("learn-files")]: LearnFilesCard,
  [cardRendererKey("learn-assignments")]: LearnAssignmentsCard,
  [cardRendererKey("learn-notices")]: LearnNoticesCard,
  [cardRendererKey("life-dorm")]: () => <DormTab />,
  [cardRendererKey("life-washer")]: () => <WasherTab />,
  [cardRendererKey("life-card")]: () => <CardTab />,
  [cardRendererKey("life-hygiene")]: () => <HygieneTab />,
  [cardRendererKey("life-invoice")]: () => <InvoiceTab />,
  [cardRendererKey("life-payroll")]: () => <PayrollTab />,
  [cardRendererKey("life-gradincome")]: () => <GradIncomeTab />,
  [cardRendererKey("reserve-lib")]: () => <LibraryTab />,
  [cardRendererKey("reserve-room")]: () => <LibRoomTab />,
  /* 成绩的元素级拆分（口径 B）：四张统计卡 + 明细列表，与信息页 ReportTab 同源。 */
  [cardRendererKey("report-done")]: () => <ReportStatDone />,
  [cardRendererKey("report-credit")]: () => <ReportStatCredit />,
  [cardRendererKey("report-overall")]: () => <ReportStatOverall />,
  [cardRendererKey("report-latest")]: () => <ReportStatLatest />,
  [cardRendererKey("report-list")]: () => <ReportScoreRows />,
  /* B4 余项：这三个组件本身就是自足页面/工具，登记即可直接显示（无复合结构可拆）。 */
  [cardRendererKey("xk")]: () => <ZhjwxkCoursesPage />,
  [cardRendererKey("learn-search")]: () => <SearchPage />,
  [cardRendererKey("learn-semester")]: () => <SemesterSelectionPage />,
  /* 行级（§7 7.5）：采集来的具体条目按 props 渲染真实信息。 */
  [cardRendererKey("learn-file")]: (props) => <LearnFileAtomCard props={props} />,
};

/* ══════════ 便笺（2026-10-13，霖：白板要能随手写字、能收起来）══════════
   props：text（内容）、tone（纸色）、folded（收起=只留标题条）。收起/展开就地切换，
   文字走白板既有的「属性」抽屉编辑（editableProps 已声明）。 */

const NOTE_TONES: Record<string, string> = {
  yellow: "rgba(232, 196, 106, 0.24)",
  pink: "rgba(226, 154, 166, 0.22)",
  blue: "rgba(122, 168, 220, 0.22)",
  green: "rgba(140, 196, 156, 0.22)",
};

function NoteCard(props?: Record<string, unknown>): ReactNode {
  const text = typeof props?.text === "string" && props.text.trim() ? props.text : "长按这张便笺，选「属性」写字";
  const tone = typeof props?.tone === "string" && NOTE_TONES[props.tone] ? props.tone : "yellow";
  const folded = props?.folded === true;
  const [localFolded, setLocalFolded] = useState<boolean | null>(null);
  const isFolded = localFolded ?? folded;
  return (
    <div
      className={"board-note" + (isFolded ? " is-folded" : "")}
      data-tone={tone}
      style={{ background: NOTE_TONES[tone] }}
      onClick={(e) => {
        e.stopPropagation();
        setLocalFolded(!isFolded);
      }}
      title={isFolded ? "点开便笺" : "点一下收起"}
    >
      <div className="board-note-strip">
        <span className="board-note-dot" aria-hidden="true" />
        <span className="board-note-hint">{isFolded ? "便笺（已收起）" : "便笺"}</span>
      </div>
      {!isFolded ? <div className="board-note-text">{text}</div> : null}
    </div>
  );
}

/* ══════════ 环境/时钟组件（2026-10-13，霖：首页白板要有时间、日期、天气） ══════════
   这三张不依赖 THU 会话：时钟/日期走本地时间，天气走 open-meteo 免 key 直连（state/weather.ts）。
   自由尺寸（内容自适应），小格只留主信息，大格逐层加上下文——与档位组件「随尺寸加信息层」同一口吻。 */

/** 数字时钟：1 行高显示 HH:MM，2 行高加秒与日期 */
export function ClockCard({ size }: { size?: WidgetSize }): ReactNode {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const tall = (size?.h ?? 1) >= 2;
  return (
    <div className="env-clock" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 4 }}>
      <div style={{ fontSize: tall ? 34 : 24, fontVariantNumeric: "tabular-nums", fontWeight: 650, letterSpacing: 1, color: "var(--text-1)", lineHeight: 1.1 }}>
        {hh}:{mm}
        {tall ? <span style={{ fontSize: 14, color: "var(--text-3)", marginLeft: 4 }}>{ss}</span> : null}
      </div>
      {tall ? <div style={{ fontSize: "var(--text-xs)", color: "var(--text-3)" }}>{weekdayCn(now.getDay())} · {now.getMonth() + 1} 月 {now.getDate()} 日</div> : null}
    </div>
  );
}

function weekdayCn(d: number): string {
  const c = "日一二三四五六"[d];
  return c ? "周" + c : "";
}

/** 日期卡：大字日期 + 星期（高格再加农历风格的月相文案就免了——保持干净） */
export function DateCard({ size }: { size?: WidgetSize }): ReactNode {
  const now = new Date();
  const tall = (size?.h ?? 1) >= 2;
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const d = now.getDate();
  return (
    <div className="env-date" style={{ display: "flex", flexDirection: tall ? "column" : "row", alignItems: tall ? "center" : "baseline", justifyContent: "center", height: "100%", gap: tall ? 4 : 8 }}>
      <div style={{ fontSize: tall ? 30 : 22, fontVariantNumeric: "tabular-nums", fontWeight: 650, color: "var(--text-1)", lineHeight: 1.15 }}>
        {m} 月 {d} 日
      </div>
      <div style={{ fontSize: tall ? "var(--text-md)" : "var(--text-sm)", color: "var(--text-3)", display: "flex", alignItems: "center", gap: 8 }}>
        <span>{weekdayCn(now.getDay())}</span>
        {tall ? <span>{y} 年</span> : null}
      </div>
    </div>
  );
}

/** 天气卡：拉 open-meteo（免 key 免会话），失败留旧值 + 手动刷新 */
export function WeatherCard({ size }: { size?: WidgetSize }): ReactNode {
  const snap = useSyncExternalStore(subscribeWeather, weatherSnapshot, weatherSnapshot);
  useEffect(() => {
    void refreshWeather();
  }, []);
  const w = snap.data;
  const wide = (size?.w ?? 2) >= 4;
  const tall = (size?.h ?? 2) >= 2;
  const staleNote = w ? weatherAgeText() : "";
  return (
    <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", height: "100%", gap: 4, padding: "2px 4px" }}>
      {!w ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, height: "100%" }}>
          <span style={{ fontSize: "var(--text-sm)", color: "var(--text-3)" }}>{snap.reason ? "天气拉取失败，可重试" : "天气加载中"}</span>
          <button type="button" className="btn btn-ghost" style={{ height: 22, fontSize: "var(--text-xs)" }} onClick={() => void refreshWeather(true)}>
            重试
          </button>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, justifyContent: wide ? "space-between" : "flex-start" }}>
            <span style={{ fontSize: wide ? 32 : 24, fontVariantNumeric: "tabular-nums", fontWeight: 650, color: "var(--text-1)", lineHeight: 1.1 }}>
              {Math.round(w.now.temp)}°
            </span>
            <span style={{ fontSize: "var(--text-sm)", color: "var(--text-2)" }}>{weatherText(w.now.code)}</span>
          </div>
          <div style={{ display: "flex", gap: 8, fontSize: "var(--text-xs)", color: "var(--text-3)", flexWrap: "wrap" }}>
            <span>体感 {Math.round(w.now.feels)}°</span>
            <span>湿度 {Math.round(w.now.humidity)}%</span>
            <span style={{ marginLeft: "auto" as const }} title="点按刷新">
              <button
                type="button"
                style={{ border: 0, background: "transparent", color: "var(--text-3)", fontSize: "var(--text-xs)", cursor: "pointer", padding: 0 }}
                onClick={() => void refreshWeather(true)}
              >
                {staleNote}
              </button>
            </span>
          </div>
          {tall && w.days.length > 1 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 2 }}>
              {w.days.slice(1, 4).map((day) => (
                <div key={day.date} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--text-xs)", color: "var(--text-2)" }}>
                  <span style={{ width: 28, color: "var(--text-3)" }}>{weekdayCn(new Date(day.date + "T12:00:00").getDay())}</span>
                  <span style={{ flex: 1 }}>{weatherText(day.code)}</span>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>
                    {Math.round(day.min)}° / {Math.round(day.max)}°
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

for (const c of HOME_CARD_META) {
  const entry = c.entry;
  if (c.kind !== "entry" || !entry || !entry.page) continue;
  ENTRY_RENDERERS[cardRendererKey(c.id)] = (_props, size) => (
    <EntryCard
      title={c.title}
      hint={c.hint}
      page={entry.page}
      params={entry.params as Record<string, unknown> | undefined}
      size={size}
    />
  );
}

export const BOARD_CARD_RENDERERS: Record<string, CardRenderer> = {
  ...ENTRY_RENDERERS,
  ...ENTRY_REAL,
  /* 时钟/日期/天气：自足（本地时间 + open-meteo），自由尺寸随格加信息层。 */
  [cardRendererKey("note")]: (props) => <NoteCard {...(props ?? {})} />,
  [cardRendererKey("clock")]: (_props, size) => <ClockCard size={size} />,
  [cardRendererKey("date")]: (_props, size) => <DateCard size={size} />,
  [cardRendererKey("weather")]: (_props, size) => <WeatherCard size={size} />,
  /* 余额速览：自足实现 + 两档排版（4×1 并排 / 4×2 上下两行）。 */
  [cardRendererKey("balance-strip")]: (_props, size) => <BalanceStripCard size={size} />,
  /* 下一节课：自足实现 + 三档排版（1×1 倒计时 / 2×1 加课程名 / 4×2 加时间、地点与进度）。 */
  [cardRendererKey("next-class")]: (_props, size) => <NextClassCard size={size} />,
  /* 校园卡余额卡片：自足实现 + 三档排版（复用统计卡的五个槽位）。 */
  [cardRendererKey("cardEntry")]: () => <CardEntryCard />,
  /* 今日预约：自足实现 + 三档排版（1×1 条数 / 2×1 加最近一条 / 4×2 逐条）。 */
  [cardRendererKey("resv")]: (_props, size) => <ResvCard size={size} />,
  /* 订阅新闻：自足实现 + 三档排版（1×1 条数 / 2×1 加最新标题 / 4×2 整列表）。 */
  [cardRendererKey("news")]: (_props, size) => <NewsCard size={size} />,
  /* 今日概览：自足（自持取数）+ 三档排版（4×1 计数 / 4×2 加最近截止 / 4×4 再铺开今日课程）。 */
  [cardRendererKey("today-overview")]: (_props, size) => <TodayOverviewWidget size={size} />,
  /* 日程与提醒：自足（自持取数）+ 两档（4×2 最近两条 / 4×4 铺满）。 */
  [cardRendererKey("agenda")]: (_props, size) => <AgendaWidget size={size} />,
  [cardRendererKey("mine-balance")]: MineBalanceCard,
  [cardRendererKey("mine-credit")]: MineCreditCard,
  [cardRendererKey("mine-gpa")]: MineGpaCard,
  [cardRendererKey("mine-student")]: MineStudentCard,
  /* 信息页 8 个栏目本来就是独立组件，登记即可自足渲染。 */
  [cardRendererKey("info-report")]: () => <ReportTab />,
  [cardRendererKey("info-fitness")]: () => <FitnessTab />,
  [cardRendererKey("info-exams")]: () => <ExamsTab />,
  [cardRendererKey("info-evaluation")]: () => <EvaluationTab />,
  [cardRendererKey("info-calendar")]: () => <CalendarTab />,
  [cardRendererKey("info-news")]: () => <NewsTab />,
  [cardRendererKey("info-profile")]: () => <ProfileTab />,
  [cardRendererKey("info-courseinfo")]: () => <CourseInfoTab />,
};
