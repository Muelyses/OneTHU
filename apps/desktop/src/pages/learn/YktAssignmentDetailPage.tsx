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
 * 并 log_debug 留痕，绝不静默吞；错误态提供「重试」与「在网页中打开」双出口。
 *
 * 入口（R20-B2）：移动端（Android 宿主）作业列表的雨课堂条目点击直达本页
 * （分流纯函数 pickYktDetailEntry，见 lib/yktDetail.ts）；R20-A 的桌面模式 WebView
 * 保留为页内备用入口（页头「在网页中打开」按钮，openExternalHomework 分流不变）。
 *
 * 红线（B2 只读，写死在渲染逻辑里）：
 *  - 本页**不渲染任何提交 / 作答输入入口**——提交属 R20-C1/C2；
 *  - 试卷（kind exam / 源 type 20）同样只读，无提交相关 UI；
 *  - 题型 9（外链 OJ）只显示外链跳转（externalUrl → 系统浏览器），不渲染作答区。
 *
 * 题干渲染（B2 基础占位）：bodyHtml 直接 innerHTML（雨课堂 CDN 图片交给 WebView
 * 原生加载，不走 learn 图片管道）。
 * TODO(R20-B3)：xuetangx-com-encrypted-font 加密字体（data.fontUrl 下载后 @font-face）
 * 与 $…$ LaTeX 公式渲染（docs 28.7 B3）；加密 span 当前显示占位字形，属已知形态。
 */
import { useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { YkExerciseDetail, YkProblem } from "@onethu/core";
import { BackButton, timeLeft } from "./shared.js";
import { Card, Empty, ErrorNote, PageHead, SkeletonRows } from "../../components/Layout.js";
import { useApp } from "../../state/context.js";
import { fetchYktExerciseDetail } from "../../state/exthw.js";
import { explainNetworkError } from "../../lib/transport.js";
import { openExternalHomework } from "../../lib/extHwBrowse.js";
import { openExternal } from "../info/openExternal.js";
import {
  yktAttachmentsText,
  yktExerciseSummary,
  yktIsExternalLinkProblem,
  yktScoreText,
  yktStatusChip,
  yktTypeText,
} from "../../lib/yktDetail.js";

type LoadState = "loading" | "ok" | "error";

/** 重交上限文案（归一化保守口径：缺失/0 → 不可重交；docs 28.4 实测 max_retry=0/1/3 均有出现） */
function fmtMaxRetry(n: number | undefined): string {
  return n !== undefined && n > 0 ? `${n} 次` : "不可重交";
}

/** 题干 / 作答正文的基础渲染（B2 占位，见文件头 TODO(R20-B3)）。
 *  内容来自雨课堂服务端 HTML（与官方页同源信任级别）；B3 接字体/LaTeX 时替换本组件。 */
function YktBasicHtml({ html }: { html: string }) {
  return <div className="ykt-rich" dangerouslySetInnerHTML={{ __html: html }} />;
}

/** 老师评语（remark / comments）按纯文本渲染：实测快照均为纯文本（非 HTML），
 *  纯文本 + pre-wrap 不会吃掉换行，也避免把评语当 HTML 注入。 */
function YktPlainText({ text }: { text: string }) {
  return <div className="ykt-plain">{text}</div>;
}

/** 单题卡：序号 + 题型 + 分值 + 批改徽标；题干 / 我的作答 + 附件 / 老师评语。
 *  题型 9（外链 OJ）：只渲染外链跳转（红线），作答与评语区一律不给。 */
function ProblemCard({ p }: { p: YkProblem }) {
  const chip = yktStatusChip(p);
  const ext9 = yktIsExternalLinkProblem(p);
  const attText = yktAttachmentsText(p.myAnswerAttachments);
  const hasAnswer = Boolean(p.myAnswerHtml || attText);
  const hasRemark = Boolean(p.remark || p.comments?.length);
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
          {p.bodyHtml ? <YktBasicHtml html={p.bodyHtml} /> : null}
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
              <YktBasicHtml html={p.bodyHtml} />
            </div>
          ) : null}
          {hasAnswer ? (
            <div className="ykt-ans">
              <div className="ykt-sec-label">我的作答</div>
              {p.myAnswerHtml ? <YktBasicHtml html={p.myAnswerHtml} /> : null}
              {attText ? <div className="ykt-ans-att">附件：{attText}</div> : null}
            </div>
          ) : p.myStatus === "unanswered" ? (
            <div className="ykt-ans-empty">未作答</div>
          ) : null}
          {hasRemark ? (
            <div className="ykt-remark">
              <div className="ykt-sec-label">老师评语</div>
              {p.remark ? <YktPlainText text={p.remark} /> : null}
              {(p.comments ?? []).map((c, i) => (
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
  const openInWeb = (): void => {
    if (ykt.externalUrl) void openExternalHomework(ykt.externalUrl);
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
            详情拉取失败不影响列表状态；可用右上角「在网页中打开」走官方页面（R20-A 通道）。
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
              <span className="tag-exam" title="试卷（B2 只读，无提交入口）">考试</span>
            ) : null}
          </div>
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
              {/* TODO(R20-B3)：加密字体 + LaTeX（同题干口径） */}
              <YktBasicHtml html={d.description} />
            </div>
          </Card>
        ) : null}

        {/* 题目列表（B2 只读；提交入口属 R20-C，此处永不渲染） */}
        {d.problems.length === 0 ? (
          <Card>
            <Empty text="本作业暂无题目明细（可能接口未返回 problems）。" />
          </Card>
        ) : (
          d.problems.map((p) => <ProblemCard key={p.problemId || p.index} p={p} />)
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
            {ykt.externalUrl ? (
              <button className="btn" onClick={openInWeb} title="R20-A：应用内桌面模式 WebView（移动端）/ 系统浏览器（桌面）">
                在网页中打开
              </button>
            ) : null}
          </>
        }
      />
      {body}
    </>
  );
}
