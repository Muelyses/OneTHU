/**
 * R20-B2：雨课堂作业原生只读详情页（learn-ykt-detail，docs 28.7 B2）。
 *
 * 存在意义：雨课堂官方网页版未做移动端适配（霖实测：小字 + 横向滚动），此前移动端
 * 只能靠 R20-A 的桌面模式 WebView 整页缩放看。本页以**移动端优先**的排版原生呈现
 * 整卷明细：头部信息条（作业名 / 截止时间 / 重交上限 maxRetry / 是否允许迟交
 * lateAllowed / 我的得分与批改状态）+ 题目列表（序号 / 题型 typeText / 分值 score）
 * + 我的作答（myAnswerHtml + attachments）+ 老师评语（remark + comments）。
 * 桌面端同样可正常打开（单列自适应布局，不依赖触屏）。
 *
 * 数据：core getExerciseDetail（R20-B1）经 state 层薄包装 fetchYktExerciseDetail
 * （凭据 / universalFetch 注入）。loading / error 态齐备：失败**保留原始错误文案**
 * 并 log_debug 留痕，绝不静默吞；错误态提供「重试」与「浏览器打开」双出口。
 *
 * 入口（R20-B2b）：作业列表 / 今日页 / 搜索等所有作业行点击统一走 openHomeworkRow
 * 三态分流（lib/homeworkEntry.ts；纯判定 pickHomeworkRoute 在 lib/yktDetail.ts）——
 * 雨课堂 + 详情参数齐备 → **全平台默认**直达本页（不再限 Android 宿主，PC 同样原生），
 * 参数缺失才回退 R20-A。官方页降为页内备用出口：页头「浏览器打开」按钮
 * （openExternalHomework 分流不变：桌面 = 系统浏览器，移动 = 应用内桌面模式 WebView）。
 *
 * 红线（B2 只读，写死在渲染逻辑里）：
 *  - 本页**不渲染任何提交 / 作答输入入口**——提交属 R20-C1/C2；
 *  - 试卷（kind exam / 源 type 20）同样只读，无提交相关 UI；
 *  - 题型 9（外链 OJ）只显示外链跳转（externalUrl → 系统浏览器），不渲染作答区。
 *
 * R20-C1（本阶段）：详情页新增「作答 / 提交」入口，仅在资格判定
 * （lib/yktDetail.ts yktSubmitEligibility 纯函数）通过时渲染——未过截止（已过则须
 * 允许补交且未过补交截止）∧ 未超 max_retry；试卷（exam / type 20 / 6）与全外链题
 * （题型 9）永不出口（红线）。点击 → 应用内二次确认 → 应用内 WebView 打开 R16b
 * 学生端直链并注入当前会话 Cookie（lib/yktSubmitWebview.ts，桌面 Rust 窗口 /
 * 移动 Dialog WebView）；官方页内的确认与拦截原样保留，不替代、不绕过；关闭/返回后
 * 立即重新拉取真实状态（禁止乐观更新）。
 *
 * 题干渲染（R20-B3）：题干 / 我的作答 / 作业说明统一走 components/exthw/ProblemBody——
 * 本地内联沙箱文档（sandbox srcdoc iframe）：xuetangx-com-encrypted-font 加密字体经
 * loadYktFont 下载缓存（7 天 TTL / 失败 10min 退避 / magic 校验）挂 @font-face，
 * $…$ 与 $$…$$ 走内置 KaTeX（离线自包含），图片带 Cookie/Referer 代理重试，
 * 失败逐环降级（剥加密 span 保原文 / 保留 $ 原文 / 占位框+文件名），永不白屏。
 */
import { useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { YkExerciseDetail, YkProblem } from "@onethu/core";
import { BackButton, timeLeft } from "./shared.js";
import { Card, Empty, ErrorNote, PageHead, SkeletonRows } from "../../components/Layout.js";
import { ProblemBody } from "../../components/exthw/ProblemBody.js";
import { useApp } from "../../state/context.js";
import { fetchYktExerciseDetail, getYktCookie } from "../../state/exthw.js";
import { explainNetworkError } from "../../lib/transport.js";
import { confirmOk } from "../../lib/confirm.js";
import { openExternalHomework } from "../../lib/extHwBrowse.js";
import { openYktSubmitWebview } from "../../lib/yktSubmitWebview.js";
import { openExternal } from "../info/openExternal.js";
import {
  dedupeYktRemarks,
  yktAttachmentsText,
  yktExerciseSummary,
  yktIsExternalLinkProblem,
  yktScoreText,
  yktStatusChip,
  yktSubmitEligibility,
  yktTypeText,
} from "../../lib/yktDetail.js";

type LoadState = "loading" | "ok" | "error";

/** 重交上限文案（归一化保守口径：缺失/0 → 不可重交；docs 28.4 实测 max_retry=0/1/3 均有出现） */
function fmtMaxRetry(n: number | undefined): string {
  return n !== undefined && n > 0 ? `${n} 次` : "不可重交";
}

/** 老师评语（remark / comments）按纯文本渲染：实测快照均为纯文本（非 HTML），
 *  纯文本 + pre-wrap 不会吃掉换行，也避免把评语当 HTML 注入。
 *  R20-B3 fix：两字段同文时只渲染一处（dedupeYktRemarks，保留具名批注口径）。 */
function YktPlainText({ text }: { text: string }) {
  return <div className="ykt-plain">{text}</div>;
}

/** 单题卡：序号 + 题型 + 分值 + 批改徽标；题干 / 我的作答 + 附件 / 老师评语。
 *  题型 9（外链 OJ）：只渲染外链跳转（红线），作答与评语区一律不给。
 *  题干 / 作答正文（R20-B3）：ProblemBody 内联沙箱渲染（加密字体 + LaTeX + 图片代理）。 */
function ProblemCard({ p, fontUrl, cookies }: { p: YkProblem; fontUrl?: string; cookies: string }) {
  const chip = yktStatusChip(p);
  const ext9 = yktIsExternalLinkProblem(p);
  const attText = yktAttachmentsText(p.myAnswerAttachments);
  const hasAnswer = Boolean(p.myAnswerHtml || attText);
  // R20-B3 fix：remark 与 comment[] 同文时只渲染一处（雨课堂已批改题两字段常同文，
  // 详见 lib/yktDetail.ts dedupeYktRemarks 口径说明）；不同文时全部保留。
  const remarkView = dedupeYktRemarks(p);
  const hasRemark = Boolean(remarkView.remark || remarkView.comments?.length);
  return (
    <Card className="ykt-problem">
      <div className="ykt-problem-head">
        <b className="ykt-problem-no">第 {p.index} 题</b>
        <span className="ykt-problem-type">{yktTypeText(p)}</span>
        {p.score > 0 ? <span className="ykt-problem-score">{yktScoreText(p.score)} 分</span> : null}
        <span className={`chip ${chip.cls} ykt-problem-chip`}>
          <span className="dot" />
          {chip.text}
        </span>
      </div>
      {ext9 ? (
        <div className="ykt-problem-body">
          {p.bodyHtml ? <ProblemBody html={p.bodyHtml} fontUrl={fontUrl} cookies={cookies} title={`第 ${p.index} 题题干`} /> : null}
          {p.externalUrl ? (
            <button className="btn ykt-ext-btn" onClick={() => void openExternal(p.externalUrl!)}>
              打开外链题目 ↗
            </button>
          ) : (
            <div className="ykt-ans-empty">外链题目：未取到外链地址，请从雨课堂网页版打开。</div>
          )}
          {/* 红线：题型 9 只显示外链跳转，不渲染作答输入/评语区 */}
        </div>
      ) : (
        <>
          {p.bodyHtml ? (
            <div className="ykt-problem-body">
              <ProblemBody html={p.bodyHtml} fontUrl={fontUrl} cookies={cookies} title={`第 ${p.index} 题题干`} />
            </div>
          ) : null}
          {hasAnswer ? (
            <div className="ykt-ans">
              <div className="ykt-sec-label">我的作答</div>
              {p.myAnswerHtml ? <ProblemBody html={p.myAnswerHtml} fontUrl={fontUrl} cookies={cookies} title={`第 ${p.index} 题我的作答`} /> : null}
              {attText ? <div className="ykt-ans-att">附件：{attText}</div> : null}
            </div>
          ) : p.myStatus === "unanswered" ? (
            <div className="ykt-ans-empty">未作答</div>
          ) : null}
          {hasRemark ? (
            <div className="ykt-remark">
              <div className="ykt-sec-label">老师评语</div>
              {remarkView.remark ? <YktPlainText text={remarkView.remark} /> : null}
              {(remarkView.comments ?? []).map((c, i) => (
                <div className="ykt-remark-item" key={i}>
                  {c.name ? <b>{c.name}：</b> : null}
                  <YktPlainText text={c.content} />
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}

export function YktAssignmentDetailPage() {
  const { navParams } = useApp();
  const ykt = navParams?.ykt ?? null;
  const from = navParams?.from ?? "learn";
  const [detail, setDetail] = useState<YkExerciseDetail | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [errMsg, setErrMsg] = useState("");
  const [tick, setTick] = useState(0);
  // R20-C1：官方作答页拉起中 / 拉起失败提示（失败不静默吞，给重试）
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitErr, setSubmitErr] = useState("");

  const leafTypeId = ykt?.leafTypeId ?? "";
  const classroomId = ykt?.classroomId ?? "";

  useEffect(() => {
    // 参数缺失（深链残缺 / 列表行未透出 leafTypeId）不发请求：直接参数缺失错误态
    if (!leafTypeId || !classroomId) return;
    let cancelled = false;
    setState("loading");
    setErrMsg("");
    fetchYktExerciseDetail(leafTypeId, classroomId)
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
        setState("ok");
      })
      .catch((e: unknown) => {
        // 红线：保留原始错误文案（core 抛的 errcode / 会话失效上下文），log_debug 留痕，不静默吞
        const msg = explainNetworkError(e);
        if (cancelled) return;
        setErrMsg(msg);
        setState("error");
        void invoke(
          "log_debug",
          { line: `R20-B2 雨课堂作业详情拉取失败（leaf=${leafTypeId} classroom=${classroomId}）: ${msg.slice(0, 300)}` },
        ).catch(() => undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [leafTypeId, classroomId, tick]);

  /* 参数缺失：导航链路问题，明确提示（不在无参状态下瞎猜作业） */
  if (!ykt || !leafTypeId || !classroomId) {
    return (
      <>
        <PageHead title="雨课堂作业" actions={<BackButton to={from} />} />
        <Card>
          <Empty text="缺少雨课堂作业参数（leafTypeId/classroomId），请从作业列表重新进入。" />
        </Card>
      </>
    );
  }

  const meta = `${ykt.courseName || "雨课堂"}${ykt.deadline ? ` · ${ykt.deadline} 截止` : ""}`;
  const summary = yktExerciseSummary(detail?.problems ?? []);
  const left = timeLeft(ykt.deadline ?? "");
  // R20-C1：作答/提交入口资格（纯函数；试卷 / 全外链题 / 过截止 / 超次数 → 不出口）
  const eligibility = yktSubmitEligibility({
    kind: ykt.kind,
    deadline: ykt.deadline,
    lateAllowed: detail?.lateAllowed,
    lateDeadline: detail?.lateDeadline,
    maxRetry: detail?.maxRetry,
    problems: detail?.problems,
  });
  // R20-B3：题干渲染的资源通道 Cookie（未登录为空串，字体/图片侧自然降级）
  const yktCookie = getYktCookie();
  const openInWeb = (): void => {
    // R20-A 通道（分流在 openExternalHomework）：桌面 = 系统浏览器；移动 = 应用内桌面模式 WebView
    if (ykt.externalUrl) void openExternalHomework(ykt.externalUrl);
  };
  /** R20-C1：二次确认 → 应用内 WebView 打开官方作答页 → 关闭后重拉真实状态（禁止乐观更新）。 */
  const openSubmit = async (): Promise<void> => {
    const url = ykt.externalUrl;
    if (!url || submitBusy) return;
    const ok = await confirmOk(
      "将打开雨课堂官方作答页完成提交。\n\n页面内是雨课堂官方提交逻辑（含其自身的截止/次数校验与二次确认），请在其中确认后提交；关闭或返回后本页会自动刷新真实状态。",
    );
    if (!ok) return;
    setSubmitBusy(true);
    setSubmitErr("");
    try {
      // 当前会话 Cookie 仅作 invoke 参数内存传递（不打印 / 不落盘）
      await openYktSubmitWebview(url, getYktCookie());
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setSubmitErr(msg);
      void invoke("log_debug", { line: `R20-C1 打开官方作答页失败: ${msg.slice(0, 300)}` }).catch(() => undefined);
    } finally {
      setSubmitBusy(false);
      // 关闭/返回后立即重新拉取真实状态（禁止乐观更新）
      setTick((t) => t + 1);
    }
  };

  let body: ReactNode;
  if (state === "loading") {
    body = <SkeletonRows rows={5} />;
  } else if (state === "error") {
    body = (
      <>
        <Card>
          <ErrorNote text={errMsg} onRetry={() => setTick((t) => t + 1)} />
          <div className="detail-meta" style={{ padding: "0 16px 10px" }}>
            详情拉取失败不影响列表状态；可用右上角「浏览器打开」走官方页面（R20-A 通道）。
          </div>
        </Card>
      </>
    );
  } else {
    const d = detail!;
    body = (
      <>
        {/* 头部信息条：状态徽标（截止倒计时 / 整卷批改 / 试卷）+ 作业信息键值 */}
        <Card className="detail-head">
          <div className="chips">
            {left.text ? (
              <span className={`chip ${left.overdue ? "chip-red" : "chip-amber"}`}>
                <span className="dot" />
                {left.text}
              </span>
            ) : null}
            <span className={`chip ${summary.chip.cls}`}>{summary.chip.text}</span>
            {ykt.kind === "exam" ? (
              <span className="tag-exam" title="试卷（永不提供提交入口）">考试</span>
            ) : null}
          </div>
          {eligibility.eligible ? (
            <div className="detail-meta">提交将通过应用内官方作答页完成（雨课堂官方确认 / 拦截原样保留）。</div>
          ) : null}
        </Card>

        <Card className="detail-sec">
          <div className="detail-sec-head">作业信息</div>
          <div className="kv">
            <span>截止时间</span>
            <b>{ykt.deadline || "未知"}</b>
          </div>
          {d.lateDeadline ? (
            <div className="kv">
              <span>补交截止</span>
              <b>{d.lateDeadline}</b>
            </div>
          ) : null}
          <div className="kv">
            <span>重交上限</span>
            <b>{fmtMaxRetry(d.maxRetry)}</b>
          </div>
          <div className="kv">
            <span>是否允许迟交</span>
            <b>{d.lateAllowed ? "允许补交" : "不允许补交"}</b>
          </div>
          <div className="kv">
            <span>作答进度</span>
            <b>
              {summary.answered}/{summary.total} 题
            </b>
          </div>
          {summary.scoreSum !== undefined ? (
            <div className="kv">
              <span>我的得分</span>
              <b>{yktScoreText(summary.scoreSum)}（已批题目合计）</b>
            </div>
          ) : null}
        </Card>

        {d.description ? (
          <Card className="detail-sec">
            <div className="detail-sec-head">作业说明</div>
            <div className="ykt-problem-body">
              <ProblemBody html={d.description} fontUrl={d.fontUrl} cookies={yktCookie} title="作业说明" />
            </div>
          </Card>
        ) : null}

        {/* 题目列表（原生只读；R20-C1 的提交入口是页级「作答 / 提交」按钮，
            逐题原生作答输入属 R20-C2，此处永不渲染） */}
        {d.problems.length === 0 ? (
          <Card>
            <Empty text="本作业暂无题目明细（可能接口未返回 problems）。" />
          </Card>
        ) : (
          d.problems.map((p) => <ProblemCard key={p.problemId || p.index} p={p} fontUrl={d.fontUrl} cookies={yktCookie} />)
        )}
      </>
    );
  }

  return (
    <>
      <PageHead
        title={state === "ok" && detail?.name ? detail.name : ykt.title || "雨课堂作业"}
        meta={meta}
        actions={
          <>
            <BackButton to={from} />
            {eligibility.eligible && ykt.externalUrl ? (
              <button
                className="btn btn-primary"
                disabled={submitBusy}
                onClick={() => void openSubmit()}
                title="应用内打开雨课堂官方作答页（官方提交逻辑原样保留）"
              >
                {submitBusy ? "作答页已打开…" : "作答 / 提交"}
              </button>
            ) : null}
            {ykt.externalUrl ? (
              <button className="btn" onClick={openInWeb} title="桌面 = 系统浏览器打开官方页；移动 = 应用内桌面模式 WebView（R20-A 通道）">
                浏览器打开
              </button>
            ) : null}
          </>
        }
      />
      {submitErr ? (
        <Card>
          <ErrorNote text={`打开官方作答页失败：${submitErr}`} onRetry={() => void openSubmit()} />
        </Card>
      ) : null}
      {body}
    </>
  );
}
