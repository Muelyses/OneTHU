/**
 * 附件动作面板（需求 7）：拿到附件后选「转存云盘 / 交作业（网络学堂 + 雨课堂）/ 发讨论区」。
 *
 * 组件自包含（自带样式、portal 到 body）：宿主只需要给 `files`，入口挂载由 Lead / 悬浮面板负责。
 * 三个动作的执行全在 `lib/attachActions.ts`；本组件只做：上下文选择 + 确认 + 结果呈现。
 *
 * ## 设计口径
 *  - **确认在面板内完成**（内联确认条，`ConfirmFn` 注入给 lib）：悬浮窗里不依赖宿主是否挂了
 *    `<ConfirmHost/>`，也保证用户在按下「提交」前一眼看到「交到哪份作业、带哪个文件」。
 *  - **上下文不凭空猜**：云盘资料库/目录、课程、作业、板块都要用户看得见地选；
 *    能自动带出的（最近截止的作业）会带出来并**明确标注「可改」**，不静默决定。
 *  - **结果诚实**：`ok / needUi / error` 三态直出；`needUi` 时给出下一步（应用内路由提示，
 *    雨课堂还会给「打开官方作答页」的真实可点按钮）。
 *  - 不用 `useApp()`：本组件要能在悬浮窗里跑（那里没有 AppProvider）。需要回本体时走
 *    `onDone(result)`，由宿主决定怎么导航。
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { CourseInfo, Homework } from "@onethu/core";
import { formatSize, sendToOh, type AttachFile } from "../lib/attach.js";
import {
  postDiscussion, rememberedCloudTarget, saveAllToCloud, submitHomework,
  type AttachActionUi, type AttachActionResult, type ConfirmFn,
} from "../lib/attachActions.js";
import { getLearnSnapshot, refreshLearnDataSilently, subscribeLearnData } from "../state/data.js";
import { getExtHwSnapshot, getYktCookie, refreshExtHw, subscribeExtHw } from "../state/exthw.js";
import { ensureSeafileLoaded, openDir, refreshRepos, useSeafile, type SeafileEntry } from "../state/seafile.js";
import { learn, logLine } from "../lib/clients.js";
import { openYktSubmitWebview } from "../lib/yktSubmitWebview.js";
import { confirmOk } from "../lib/confirm.js";
import { isTauri } from "../lib/transport.js";
import { IconX } from "./Icons.js";

export type AttachActionId = "cloud" | "homework" | "discussion" | "oh";

export interface AttachActionDone {
  action: AttachActionId;
  result: AttachActionResult;
  files: AttachFile[];
}

export interface AttachActionsSheetProps {
  /** 待处理的附件（生命周期归调用方：本组件不回收 previewUrl） */
  files: AttachFile[];
  /** 关闭面板 */
  onClose?: () => void;
  /** 动作跑完（宿主可据此导航 `result.ui.route` / 记日志 / 刷新列表） */
  onDone?: (done: AttachActionDone) => void;
  initialAction?: AttachActionId;
}

const ACTIONS: Array<{ id: AttachActionId; label: string }> = [
  { id: "cloud", label: "转存云盘" },
  { id: "homework", label: "交作业" },
  { id: "discussion", label: "发讨论区" },
  { id: "oh", label: "问 OH" },
];

/** 路由 → 人话（`needUi` 提示用；不引导航，导航归宿主） */
const ROUTE_LABEL: Record<string, string> = {
  cloud: "云盘页",
  learn: "网络学堂",
  "learn-assignments": "全部作业",
  "learn-assignment-detail": "作业详情页",
  "learn-ykt-detail": "雨课堂作业页",
  "learn-forum-thread": "课程讨论区",
};

function uiHint(ui: AttachActionUi | undefined): string {
  if (!ui) return "";
  const where = ui.route ? ROUTE_LABEL[ui.route] ?? ui.route : "";
  return where ? `${ui.message}（位置：${where}）` : ui.message;
}

/** 截止时间升序里第一份「未交」的作业 —— 只用于**带出默认值**（面板会标注可改） */
function mostUrgent<T>(list: T[], deadline: (x: T) => string, done: (x: T) => boolean): T | undefined {
  const pending = list.filter((x) => !done(x));
  const pool = pending.length > 0 ? pending : list;
  return [...pool].sort((a, b) => (deadline(a) || "9999").localeCompare(deadline(b) || "9999"))[0];
}

const SHEET_CSS = `
.ohaa-backdrop { position: fixed; inset: 0; z-index: 10060; background: rgba(0, 0, 0, .45);
  display: flex; align-items: flex-end; justify-content: center; }
.ohaa-panel { width: 100%; max-width: 560px; max-height: 92vh; overflow: auto;
  background: var(--dsw-alias-bg-layer-1, #fff); color: var(--dsw-alias-label-primary, #1c1f24);
  border-radius: var(--dsw-radius-xl, 20px) var(--dsw-radius-xl, 20px) 0 0;
  border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, .08));
  box-shadow: 0 -12px 40px rgba(0, 0, 0, .28); padding: 16px 16px calc(16px + env(safe-area-inset-bottom, 0px)); }
@media (min-width: 600px) {
  .ohaa-backdrop { align-items: center; }
  .ohaa-panel { border-radius: var(--dsw-radius-xl, 20px); }
}
.ohaa-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ohaa-title { font-size: 16px; font-weight: 600; }
.ohaa-files { display: flex; flex-direction: column; gap: 6px; margin: 10px 0 12px; }
.ohaa-file { display: flex; align-items: center; gap: 8px; font-size: 13px;
  color: var(--dsw-alias-label-secondary, #5c6370); }
.ohaa-file img { width: 34px; height: 34px; object-fit: cover; border-radius: var(--dsw-radius-xs, 4px);
  border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, .08)); }
.ohaa-tabs { display: flex; gap: 6px; margin-bottom: 12px; }
.ohaa-tab { flex: 1; height: 36px; cursor: pointer; font-size: 13px;
  border-radius: var(--dsw-radius-sm, 8px); border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, .1));
  background: var(--dsw-alias-bg-layer-2, #f4f4f6); color: inherit; }
.ohaa-tab[aria-selected="true"] { border-color: var(--dsw-alias-brand-primary, #1c1f24);
  background: transparent; font-weight: 600; }
.ohaa-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
.ohaa-label { font-size: 12px; color: var(--dsw-alias-label-secondary, #5c6370); }
.ohaa-note { font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary, #5c6370); margin: 4px 0 10px; }
.ohaa-note.warn { color: var(--dsw-alias-state-warn-primary, #f59e0b); }
.ohaa-row { display: flex; gap: 8px; align-items: center; }
.ohaa-dirs { max-height: 132px; overflow: auto; margin-top: 6px; border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08));
  border-radius: var(--dsw-radius-sm, 8px); padding: 4px; }
.ohaa-dir { display: block; width: 100%; text-align: left; background: transparent; border: none; cursor: pointer;
  padding: 6px 8px; border-radius: var(--dsw-radius-xs, 4px); color: inherit; font-size: 13px; }
.ohaa-dir:hover { background: var(--dsw-alias-bg-layer-2, #f4f4f6); }
.ohaa-foot { margin-top: 8px; display: flex; gap: 8px; justify-content: flex-end; align-items: center; }
.ohaa-result { margin-top: 10px; padding: 10px 12px; border-radius: var(--dsw-radius-sm, 8px); font-size: 13px;
  line-height: 1.6; white-space: pre-wrap; word-break: break-word;
  background: var(--dsw-alias-bg-layer-2, #f4f4f6); border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, .08)); }
.ohaa-result.ok { color: var(--dsw-alias-state-success-primary, #22c55e); }
.ohaa-result.warn { color: var(--dsw-alias-state-warn-primary, #f59e0b); }
.ohaa-result.err { color: var(--dsw-alias-state-error-primary, #f25a5a); }
.ohaa-confirm { margin-top: 12px; padding: 12px; border-radius: var(--dsw-radius-md, 12px);
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, .16)); background: var(--dsw-alias-bg-layer-2, #f4f4f6); }
.ohaa-confirm-msg { font-size: 13px; line-height: 1.65; white-space: pre-wrap; word-break: break-word; }
`;

const inputStyle: CSSProperties = { width: "100%", boxSizing: "border-box" };

export function AttachActionsSheet({
  files, onClose, onDone, initialAction = "cloud",
}: AttachActionsSheetProps): ReactNode {
  const [action, setAction] = useState<AttachActionId>(initialAction);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ action: AttachActionId; r: AttachActionResult } | null>(null);

  const first = files[0];
  const many = files.length > 1;

  /* ── 面板内联确认（注入给 lib；本组件不依赖宿主是否挂了 ConfirmHost） ──
   * resolver 放 ref 不放 state：结算走函数调用而不是「在 updater 里做副作用」
   * （StrictMode 下 updater 可能被调两次，resolve 只能有一次真动作）。 */
  const confirmResolve = useRef<((v: boolean) => void) | null>(null);
  const [confirmMsg, setConfirmMsg] = useState<string | null>(null);
  const askConfirm = useCallback<ConfirmFn>(
    (msg) =>
      new Promise<boolean>((resolve) => {
        confirmResolve.current?.(false); // 新请求顶掉旧请求（旧者按取消结算，防悬挂）
        confirmResolve.current = resolve;
        setConfirmMsg(msg);
      }),
    [],
  );
  const answerConfirm = useCallback((v: boolean): void => {
    const fn = confirmResolve.current;
    confirmResolve.current = null;
    setConfirmMsg(null);
    fn?.(v);
  }, []);

  const close = useCallback((): void => {
    // 面板关掉时若有悬着的确认条：按「取消」结算，绝不让写入悬空
    answerConfirm(false);
    onClose?.();
  }, [answerConfirm, onClose]);

  const finish = useCallback((id: AttachActionId, r: AttachActionResult): void => {
    setResult({ action: id, r });
    onDone?.({ action: id, result: r, files });
  }, [files, onDone]);

  /* ══════════ ① 云盘：资料库 / 目录 ══════════ */
  const sf = useSeafile();
  const [sfReady, setSfReady] = useState(false);
  const [repoId, setRepoId] = useState("");
  const [dir, setDir] = useState("/OH附件");
  const [dirEntries, setDirEntries] = useState<SeafileEntry[] | null>(null);
  const [dirMsg, setDirMsg] = useState("");

  useEffect(() => {
    const memo = rememberedCloudTarget();
    if (memo) {
      setRepoId((cur) => cur || memo.repoId);
      setDir(memo.dir || "/OH附件");
    }
    void ensureSeafileLoaded().then(() => setSfReady(true)).catch(() => setSfReady(true));
  }, []);

  useEffect(() => {
    if (!sfReady || !sf.configured || sf.repos.length > 0) return;
    void refreshRepos().catch(() => undefined);
  }, [sfReady, sf.configured, sf.repos.length]);

  // 只有一个资料库就带出来（用户看得见）；多个库**不猜**，让他自己选
  useEffect(() => {
    if (repoId) return;
    const only = sf.repos.length === 1 ? sf.repos[0] : undefined;
    if (only) setRepoId(only.id);
  }, [repoId, sf.repos]);

  const browseDir = useCallback(async (): Promise<void> => {
    if (!repoId) return;
    setDirMsg("正在读目录…");
    setDirEntries(null);
    try {
      const entries = await openDir(repoId, dir);
      setDirEntries(entries.filter((e) => e.kind === "dir"));
      setDirMsg(entries.length === 0 ? "这个目录还是空的" : "");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setDirMsg(`读目录失败：${msg}（目录还不存在的话，上传时会自动创建）`);
    }
  }, [dir, repoId]);

  /* ══════════ ② 交作业：课程 / 作业 ══════════ */
  const learnBundle = useSyncExternalStore(subscribeLearnData, getLearnSnapshot);
  const [learnLoading, setLearnLoading] = useState(false);
  const [platform, setPlatform] = useState<"learn" | "ykt">("learn");
  const [courseId, setCourseId] = useState("");
  const [hwId, setHwId] = useState("");
  const [content, setContent] = useState("");
  const [autoPicked, setAutoPicked] = useState("");

  const courses: CourseInfo[] = learnBundle?.courses ?? [];
  const homeworks: Homework[] = useMemo(
    () => (learnBundle?.homework ?? []).filter((h) => !h.source),
    [learnBundle],
  );
  const courseHw = useMemo(() => homeworks.filter((h) => h.courseId === courseId), [courseId, homeworks]);

  const loadLearn = useCallback(async (): Promise<void> => {
    setLearnLoading(true);
    try {
      await refreshLearnDataSilently();
    } finally {
      setLearnLoading(false);
    }
  }, []);

  // 数据还没进内存（悬浮窗口刚起来时常见）：不自动跑重活，交给用户点「加载」——
  // 但主界面里通常已经有缓存，这里就顺手带出「最近截止的未交作业」。
  useEffect(() => {
    if (action !== "homework" && action !== "discussion") return;
    if (courseId || hwId || platform !== "learn" || homeworks.length === 0) return;
    const urgent = mostUrgent(homeworks, (h) => h.deadline, (h) => h.submitted);
    if (!urgent) return;
    setCourseId(urgent.courseId);
    setHwId(urgent.id);
    const cn = courses.find((c) => c.id === urgent.courseId)?.name ?? urgent.courseId;
    setAutoPicked(`已带出最近截止的作业：${cn} · ${urgent.title}（可改）`);
  }, [action, courseId, courses, homeworks, hwId, platform]);

  const yktItems = useSyncExternalStore(subscribeExtHw, getExtHwSnapshot).items.filter((i) => i.source === "yuketang");
  const [yktCourse, setYktCourse] = useState("");
  const [yktLeaf, setYktLeaf] = useState("");
  const [extLoading, setExtLoading] = useState(false);
  const yktCourses = useMemo(
    () => Array.from(new Set(yktItems.map((i) => i.courseName))).sort(),
    [yktItems],
  );
  const yktRows = useMemo(() => yktItems.filter((i) => i.courseName === yktCourse), [yktCourse, yktItems]);

  useEffect(() => {
    if (platform !== "ykt" || yktCourse || yktItems.length === 0) return;
    const urgent = mostUrgent(yktItems, (i) => i.deadline, (i) => i.submitted);
    if (!urgent) return;
    setYktCourse(urgent.courseName);
    setYktLeaf(urgent.id);
    setAutoPicked(`已带出最近截止的雨课堂作业：${urgent.courseName} · ${urgent.title}（可改）`);
  }, [platform, yktCourse, yktItems]);

  const selectedYkt = yktRows.find((i) => i.id === yktLeaf) ?? undefined;
  const selectedLearnHw = courseHw.find((h) => h.id === hwId) ?? undefined;

  /* ══════════ ③ 发讨论区 ══════════ */
  const [mode, setMode] = useState<"new" | "reply">("new");
  const [boardId, setBoardId] = useState("");
  const [boards, setBoards] = useState<Array<{ bqid: string; name: string }>>([]);
  const [boardsMsg, setBoardsMsg] = useState("");
  const [title, setTitle] = useState(first ? `附件：${first.name}` : "");
  const [body, setBody] = useState("");
  const [threadId, setThreadId] = useState("");

  useEffect(() => {
    if (action !== "discussion" || !courseId) return;
    let alive = true;
    setBoardsMsg("正在拉板块…");
    learn.getBbsBoards(courseId)
      .then((b) => {
        if (!alive) return;
        setBoards(b);
        setBoardsMsg(b.length === 0 ? "这门课没有拿到板块列表（可能未开放讨论区）" : "");
      })
      .catch((e: unknown) => {
        if (alive) setBoardsMsg(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [action, courseId]);

  /* ══════════ 动作执行 ══════════ */
  const runCloud = useCallback(async (): Promise<void> => {
    if (!repoId) {
      finish("cloud", { ok: false, needUi: true, error: "先选一个云盘资料库", ui: { route: "cloud", message: "去云盘页选一个资料库" } });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const r = await saveAllToCloud(files, { repoId, dir, confirm: askConfirm });
      finish("cloud", r);
    } finally {
      setBusy(false);
    }
  }, [askConfirm, dir, files, finish, repoId]);

  const runHomework = useCallback(async (): Promise<void> => {
    if (!first) return;
    setBusy(true);
    setResult(null);
    try {
      if (platform === "ykt") {
        if (!selectedYkt) {
          finish("homework", { ok: false, needUi: true, error: "先选一份雨课堂作业", ui: { route: "learn-assignments", message: "去「全部作业」里选" } });
          return;
        }
        const r = await submitHomework(first, {
          platform: "ykt",
          assignmentId: selectedYkt.leafTypeId ?? "",
          classroomId: selectedYkt.classroomId ?? "",
          externalUrl: selectedYkt.url,
          title: selectedYkt.title,
          courseName: selectedYkt.courseName,
          confirm: askConfirm,
        });
        finish("homework", r);
        return;
      }
      if (!courseId || !hwId || !selectedLearnHw) {
        finish("homework", { ok: false, needUi: true, error: "先选课程和作业（作业要属于所选课程）", ui: { route: "learn-assignments", message: "去「全部作业」里选一份" } });
        return;
      }
      const cn = courses.find((c) => c.id === courseId)?.name ?? "";
      const r = await submitHomework(first, {
        platform: "learn",
        courseId,
        assignmentId: hwId,
        title: selectedLearnHw.title,
        courseName: cn,
        content,
        confirm: askConfirm,
      });
      finish("homework", r);
    } finally {
      setBusy(false);
    }
  }, [askConfirm, content, courseId, courses, finish, first, hwId, platform, selectedLearnHw, selectedYkt]);

  const runDiscussion = useCallback(async (): Promise<void> => {
    setBusy(true);
    setResult(null);
    try {
      const cn = courses.find((c) => c.id === courseId)?.name ?? "";
      const bn = boards.find((b) => b.bqid === boardId)?.name ?? "";
      const r = await postDiscussion(first ?? null, {
        courseId,
        boardId: mode === "new" ? boardId : undefined,
        threadId: mode === "reply" ? threadId : undefined,
        title: mode === "new" ? title : undefined,
        body,
        courseName: cn,
        boardName: bn,
        confirm: askConfirm,
      });
      finish("discussion", r);
    } finally {
      setBusy(false);
    }
  }, [askConfirm, boardId, boards, body, courseId, courses, finish, first, mode, threadId, title]);

  /** ④ 问 OH（需求 6 的「OH 直接收附件」）：把附件作为一条完整消息发给 OH。
   *  图片会随消息带上字节，**是否真按图像喂模型由 harness 的多模态开关决定**
   *  （前端不镜像那个状态）；答案直接显示在结果区。 */
  const runOh = useCallback(async (): Promise<void> => {
    setBusy(true);
    setResult(null);
    try {
      const r = await sendToOh(files);
      finish("oh", { ok: true, answer: r.answer, images: r.images });
    } catch (e) {
      finish("oh", { ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }, [files, finish]);

  /** needUi 的官方页兜底：雨课堂官方作答页（带当前会话 Cookie，用户自己提交） */
  const [officialBusy, setOfficialBusy] = useState(false);
  const openOfficial = useCallback(async (url: string): Promise<void> => {
    if (officialBusy) return;
    const ok = await confirmOk(
      "将打开雨课堂官方作答页完成提交。\n\n附件要在官方页里再选一次；页面内是雨课堂官方提交逻辑（含其自身的截止/次数校验与二次确认），"
        + "请在其中确认后提交。关闭或返回后回到本面板。",
    );
    if (!ok) return;
    const cookie = getYktCookie();
    if (!cookie) {
      setResult((cur) => (cur ? { ...cur, r: { ...cur.r, error: "雨课堂未登录：请先在 设置 → 外部作业源 登录雨课堂" } } : cur));
      return;
    }
    setOfficialBusy(true);
    try {
      await openYktSubmitWebview(url, cookie);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      void logLine(`[附件] 打开雨课堂官方作答页失败：${msg}`).catch(() => undefined);
      setResult((cur) => (cur ? { ...cur, r: { ...cur.r, error: msg } } : cur));
    } finally {
      setOfficialBusy(false);
    }
  }, [officialBusy]);

  if (!first) return null;

  const showResult = result !== null;
  const r = result?.r;

  return createPortal(
    <div className="ohaa-backdrop" onClick={(e) => e.target === e.currentTarget && close()}>
      <style>{SHEET_CSS}</style>
      <div className="ohaa-panel" role="dialog" aria-label="附件动作">
        <div className="ohaa-head">
          <div className="ohaa-title">附件动作</div>
          <button className="btn" type="button" aria-label="关闭" onClick={close}><IconX /></button>
        </div>

        <div className="ohaa-files">
          {files.map((f, i) => (
            <div className="ohaa-file" key={`${f.name}-${i}`}>
              {f.previewUrl ? <img src={f.previewUrl} alt="" /> : null}
              <span>{f.name}</span>
              <span>· {formatSize(f.size)}</span>
            </div>
          ))}
        </div>

        <div className="ohaa-tabs" role="tablist">
          {ACTIONS.map((a) => (
            <button
              key={a.id}
              className="ohaa-tab"
              type="button"
              role="tab"
              aria-selected={action === a.id}
              onClick={() => { setAction(a.id); setResult(null); }}
            >
              {a.label}
            </button>
          ))}
        </div>

        {/* ── ① 转存云盘 ── */}
        {action === "cloud" ? (
          <div>
            {!sfReady ? <div className="ohaa-note">正在读云盘配置…</div> : null}
            {sfReady && !sf.configured ? (
              <div className="ohaa-note warn">
                云盘还没连接：到「云盘」页连上清华云盘后才能转存（这条通道不做静默降级）。
              </div>
            ) : null}
            <div className="ohaa-field">
              <span className="ohaa-label">资料库（不替你猜库）</span>
              <select className="input" style={inputStyle} value={repoId} onChange={(e) => setRepoId(e.target.value)}>
                <option value="">— 请选择 —</option>
                {sf.repos.map((rp) => (
                  <option key={rp.id} value={rp.id}>{rp.name}</option>
                ))}
              </select>
            </div>
            <div className="ohaa-field">
              <span className="ohaa-label">目标目录（不存在会自动创建）</span>
              <div className="ohaa-row">
                <input className="input" style={inputStyle} value={dir} onChange={(e) => { setDir(e.target.value); setDirEntries(null); }} />
                <button className="btn" type="button" disabled={!repoId} onClick={() => void browseDir()}>看子目录</button>
              </div>
              {dirMsg ? <span className="ohaa-note">{dirMsg}</span> : null}
              {dirEntries && dirEntries.length > 0 ? (
                <div className="ohaa-dirs">
                  {dirEntries.map((e) => (
                    <button
                      className="ohaa-dir"
                      type="button"
                      key={e.name}
                      onClick={() => {
                        const base = dir.endsWith("/") ? dir.slice(0, -1) : dir;
                        setDir(`${base}/${e.name}`);
                        setDirEntries(null);
                      }}
                    >
                      📁 {e.name}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="ohaa-note">
              远端名 = 文件名；同名会被覆盖。{many ? `共 ${files.length} 个文件，按顺序逐个上传。` : ""}
            </div>
            <div className="ohaa-foot">
              <button className="btn" type="button" onClick={close}>取消</button>
              <button className="btn btn-primary" type="button" disabled={busy || !repoId || !sf.configured} onClick={() => void runCloud()}>
                {busy ? "上传中…" : "上传到云盘"}
              </button>
            </div>
          </div>
        ) : null}

        {/* ── ② 交作业 ── */}
        {action === "homework" ? (
          <div>
            <div className="ohaa-tabs" role="tablist">
              <button className="ohaa-tab" type="button" role="tab" aria-selected={platform === "learn"}
                onClick={() => { setPlatform("learn"); setAutoPicked(""); setResult(null); }}>
                网络学堂
              </button>
              <button className="ohaa-tab" type="button" role="tab" aria-selected={platform === "ykt"}
                onClick={() => { setPlatform("ykt"); setAutoPicked(""); setResult(null); }}>
                雨课堂
              </button>
            </div>

            {many ? <div className="ohaa-note warn">交作业一次只交一份，这里用第 1 个：{first.name}</div> : null}

            {homeworks.length === 0 ? (
              <div className="ohaa-note">
                本机还没有课程/作业缓存。
                <button className="btn" type="button" style={{ marginLeft: 8 }} disabled={learnLoading} onClick={() => void loadLearn()}>
                  {learnLoading ? "加载中…" : "加载课程与作业"}
                </button>
              </div>
            ) : null}
            {autoPicked ? <div className="ohaa-note">{autoPicked}</div> : null}

            {platform === "learn" ? (
              <>
                <div className="ohaa-field">
                  <span className="ohaa-label">课程</span>
                  <select className="input" style={inputStyle} value={courseId}
                    onChange={(e) => { setCourseId(e.target.value); setHwId(""); }}>
                    <option value="">— 请选择 —</option>
                    {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="ohaa-field">
                  <span className="ohaa-label">作业（网络学堂在线提交的）</span>
                  <select className="input" style={inputStyle} value={hwId}
                    onChange={(e) => setHwId(e.target.value)} disabled={!courseId}>
                    <option value="">— 请选择 —</option>
                    {courseHw.map((h) => (
                      <option key={h.id} value={h.id}>{h.title}{h.submitted ? "（已交）" : ""}</option>
                    ))}
                  </select>
                </div>
                <div className="ohaa-field">
                  <span className="ohaa-label">正文（可选；留空会清空该作业此前的正文）</span>
                  <textarea className="input" style={{ ...inputStyle, minHeight: 56 }} value={content}
                    onChange={(e) => setContent(e.target.value)} placeholder="一般不填；附件就是全部内容" />
                </div>
                <div className="ohaa-note">
                  提交前会再确认一次；提交是**整体覆盖**（正文与附件以本次为准）。
                </div>
                <div className="ohaa-foot">
                  <button className="btn" type="button" onClick={close}>取消</button>
                  <button className="btn btn-primary" type="button" disabled={busy || !selectedLearnHw}
                    onClick={() => void runHomework()}>
                    {busy ? "提交中…" : "提交作业"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="ohaa-note warn">
                  雨课堂没有可用的附件提交通道：本面板**不会**替你在雨课堂提交，只会把你带到官方作答页，
                  由你在页面里把附件随作答一起交上去（页面自带雨课堂的截止/次数校验）。
                </div>
                {yktItems.length === 0 ? (
                  <div className="ohaa-note">
                    本机还没有雨课堂作业缓存。
                    <button className="btn" type="button" style={{ marginLeft: 8 }} disabled={extLoading}
                      onClick={() => { setExtLoading(true); void refreshExtHw().finally(() => setExtLoading(false)); }}>
                      {extLoading ? "刷新中…" : "刷新雨课堂作业"}
                    </button>
                  </div>
                ) : null}
                <div className="ohaa-field">
                  <span className="ohaa-label">雨课堂课程</span>
                  <select className="input" style={inputStyle} value={yktCourse}
                    onChange={(e) => { setYktCourse(e.target.value); setYktLeaf(""); }}>
                    <option value="">— 请选择 —</option>
                    {yktCourses.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="ohaa-field">
                  <span className="ohaa-label">雨课堂作业</span>
                  <select className="input" style={inputStyle} value={yktLeaf}
                    onChange={(e) => setYktLeaf(e.target.value)} disabled={!yktCourse}>
                    <option value="">— 请选择 —</option>
                    {yktRows.map((i) => (
                      <option key={i.id} value={i.id}>{i.title}{i.submitted ? "（已交）" : ""}</option>
                    ))}
                  </select>
                </div>
                <div className="ohaa-foot">
                  <button className="btn" type="button" onClick={close}>取消</button>
                  <button className="btn btn-primary" type="button" disabled={busy || !selectedYkt}
                    onClick={() => void runHomework()}>
                    {busy ? "处理中…" : "去官方页提交"}
                  </button>
                </div>
              </>
            )}
          </div>
        ) : null}

        {/* ── ③ 发讨论区 ── */}
        {action === "discussion" ? (
          <div>
            <div className="ohaa-tabs" role="tablist">
              <button className="ohaa-tab" type="button" role="tab" aria-selected={mode === "new"}
                onClick={() => { setMode("new"); setResult(null); }}>发新话题</button>
              <button className="ohaa-tab" type="button" role="tab" aria-selected={mode === "reply"}
                onClick={() => { setMode("reply"); setResult(null); }}>回复话题</button>
            </div>
            <div className="ohaa-field">
              <span className="ohaa-label">课程</span>
              <select className="input" style={inputStyle} value={courseId}
                onChange={(e) => { setCourseId(e.target.value); setBoardId(""); setHwId(""); }}>
                <option value="">— 请选择 —</option>
                {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {courses.length === 0 ? (
                <span className="ohaa-note">
                  本机还没有课程缓存。
                  <button className="btn" type="button" style={{ marginLeft: 8 }} disabled={learnLoading}
                    onClick={() => void loadLearn()}>
                    {learnLoading ? "加载中…" : "加载课程列表"}
                  </button>
                </span>
              ) : null}
            </div>
            {mode === "new" ? (
              <>
                <div className="ohaa-field">
                  <span className="ohaa-label">板块</span>
                  <select className="input" style={inputStyle} value={boardId}
                    onChange={(e) => setBoardId(e.target.value)} disabled={!courseId}>
                    <option value="">— 请选择 —</option>
                    {boards.map((b) => <option key={b.bqid} value={b.bqid}>{b.name}</option>)}
                  </select>
                  {boardsMsg ? <span className="ohaa-note">{boardsMsg}</span> : null}
                </div>
                <div className="ohaa-field">
                  <span className="ohaa-label">标题</span>
                  <input className="input" style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} />
                </div>
              </>
            ) : (
              <div className="ohaa-field">
                <span className="ohaa-label">话题 id（tltid）</span>
                <input className="input" style={inputStyle} value={threadId} onChange={(e) => setThreadId(e.target.value)}
                  placeholder="从讨论区页面复制；也可以直接粘贴话题链接" />
              </div>
            )}
            <div className="ohaa-field">
              <span className="ohaa-label">正文（纯文本，发出去会自动排版）</span>
              <textarea className="input" style={{ ...inputStyle, minHeight: 72 }} value={body}
                onChange={(e) => setBody(e.target.value)} placeholder="可以只发附件，正文留空" />
            </div>
            <div className="ohaa-note">
              附件：{first.name}（{formatSize(first.size)}）· 发布前会再确认一次，发出去全班可见。
            </div>
            <div className="ohaa-foot">
              <button className="btn" type="button" onClick={close}>取消</button>
              <button className="btn btn-primary" type="button" disabled={busy || !courseId}
                onClick={() => void runDiscussion()}>
                {busy ? "发布中…" : "发布"}
              </button>
            </div>
          </div>
        ) : null}

        {/* ── ④ 问 OH（把附件作为一条消息发给 OH） ── */}
        {action === "oh" ? (
          <div>
            <div className="ohaa-note">
              把附件作为**一条完整消息**发给 OH（不弹输入框，直接发）。
              {files.some((f) => f.mime.startsWith("image/"))
                ? "图片会随消息带上：开了「多模态」开关时按图像模态直接喂给模型（图片文字都能读）；没开时只发送文字说明与预览。"
                : "非图片附件只带名称/类型/大小与文本预览。"}
              开关位置：设置 → 插件 → OneTHU Harness → 多模态。
            </div>
            <div className="ohaa-note">
              {many ? `${files.length} 个附件会一起发；` : ""}
              图片单条最多 4 张、单张 ≤6MB，超出的会在正文里写明原因（不会静默丢件）。
            </div>
            <div className="ohaa-foot">
              <button className="btn" type="button" onClick={close}>取消</button>
              <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void runOh()}>
                {busy ? "发送中…" : "发给 OH"}
              </button>
            </div>
          </div>
        ) : null}

        {/* ── 结果 ── */}
        {showResult && r ? (
          <div className={`ohaa-result ${r.ok ? "ok" : r.needUi ? "warn" : "err"}`}>
            {r.ok ? `✅ ${r.path ? `已上传：${r.path}` : "已完成"}` : `${r.needUi ? "⚠️ 需要你继续一步" : "❌ 没做成"}\n${r.error ?? ""}`}
            {r.needUi ? `\n${uiHint(r.ui)}` : ""}
            {r.ok && r.answer ? `\n\nOH：${r.answer}` : ""}
            {r.ok && typeof r.images === "number" ? `\n（本次随消息附带 ${r.images} 张图片）` : ""}
            {r.needUi && r.ui?.officialUrl && r.ui.officialChannel === "ykt-submit-webview" && isTauri ? (
              <div style={{ marginTop: 8 }}>
                <button className="btn btn-primary" type="button" disabled={officialBusy}
                  onClick={() => void openOfficial(r.ui!.officialUrl!)}>
                  {officialBusy ? "打开中…" : "打开雨课堂官方作答页"}
                </button>
              </div>
            ) : null}
            {r.ok ? (
              <div style={{ marginTop: 8 }}>
                <button className="btn" type="button" onClick={close}>完成</button>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* ── 内联确认（写操作的最后一道闸） ── */}
        {confirmMsg ? (
          <div className="ohaa-confirm">
            <div className="ohaa-confirm-msg">{confirmMsg}</div>
            <div className="ohaa-foot">
              <button className="btn" type="button" onClick={() => answerConfirm(false)}>取消</button>
              <button className="btn btn-danger" type="button" onClick={() => answerConfirm(true)}>确认执行</button>
            </div>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
