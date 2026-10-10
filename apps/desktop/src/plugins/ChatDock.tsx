/** 常驻对话面板（宿主胶水，R2/R4/R5 的 dock 面）：
 *  发现 activate 返回 dock:true 命令的已启用 rust 插件 → 显示常驻气泡；
 *  对话/会话/导出/用量全部走该插件的 JSON-RPC run 命令（结构化契约见
 *  OneTHU-Harness README 与接口指南 §九），本组件不含任何业务逻辑。
 *
 *  v3 交互（用户拍板，灵动岛）：
 *  - 底部中央胶囊（左 OH 标识 + 右智能文本），不再拖拽；
 *  - 智能文本：30 分钟内日程 → 「地点·还有X分钟」；提醒窗口内作业 → 「作业名·还有X分钟」；
 *    默认「点击输入，长按说话」（state/island.ts 的入口文案）；文本切换键盘下坠动画，胶囊宽度随内容伸缩；
 *  - 点击向上展开 50% 高 × 86% 宽面板（不全屏），关闭缩回；
 *  - 长按（≥450ms）→ 胶囊**自然变长**（宽度/圆角/高度/背景 300ms 同过渡）+ 一层雾
 *    （backdrop-filter）+ 随音量跳动的点点波纹，雾里实时显示识别出的字；
 *    松手 → 整句经 ohAsk() **作为完整一条消息直接喂给 OH**（不进输入框，2026-10-10 用户拍板）；
 *  - 单击 → 展开面板；面板底部默认只留一行入口按钮「点击输入，长按说话」，
 *    点它才展开原来的文本输入框（长按它同样进语音；桌面无原生识别时明确降级提示）；
 *  - 会话切换不清空累计用量（总量跨会话持久，仅本会话计数归零）。
 */
import {
  memo, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore,
  type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import Markdown from "react-markdown";
import { navGo } from "./bridges.js";
import remarkGfm from "remark-gfm";
import { callRust, notifyRust } from "./rust.js";
import { commandsSnapshot, subscribeCommands } from "./loader.js";
import { EMPTY_EVENTS, pluginEvents, subscribePluginEvents } from "./events.js";
import { IconClock, IconDownload, IconPlus, IconUpload, IconX } from "../components/Icons";
import { HarnessMark } from "../components/HarnessMark.js";
import { useIslandText } from "../state/island.js";
import { speechAvailable, speechLevel, speechPoll, speechStart, speechStop, speechUnavailableHint } from "../lib/speech.js";
import { openExternal } from "../pages/info/openExternal.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const OPEN_KEY = "onethu.chatdock.open";

/* ══════════ OH 直达（UI/UX 改造 §2.7 P0：搜索页「问 OH」透传） ══════════
 * 模块级 pending 请求 + useSyncExternalStore：外部（如 ServicesPage 搜索）调
 * ohAsk(text) → ChatDock 消费：打开面板并直接以该文本发送。未挂载（登录前）
 * 则请求留在模块级，挂载后消费。seq 防同文本重复触发。 */
interface OhPromptReq {
  text: string;
  seq: number;
}
let ohPrompt: OhPromptReq | null = null;
const ohPromptListeners = new Set<() => void>();
export function ohAsk(text: string): void {
  const t = text.trim();
  if (!t) return;
  ohPrompt = { text: t, seq: (ohPrompt?.seq ?? 0) + 1 };
  for (const l of ohPromptListeners) l();
}
function subscribeOhPrompt(fn: () => void): () => void {
  ohPromptListeners.add(fn);
  return () => {
    ohPromptListeners.delete(fn);
  };
}
function ohPromptSnapshot(): OhPromptReq | null {
  return ohPrompt;
}
/** 灵动岛：长按判定时长（毫秒）——超过即进入语音，未超过视为点击 */
const VOICE_HOLD_MS = 450;
/** 松手后等待识别器吐最终结果的宽限 */
const VOICE_FINAL_GRACE_MS = 320;
/** 波纹点个数（5~9 档，取 7：克制的节奏感）——高度/透明度由电平驱动 */
const WAVE_DOTS = 7;
/** 电平轮询间隔：比转写轮询（180ms）快一点，波纹才跟得上嘴 */
const LEVEL_POLL_MS = 90;
/** 雾里只显示转写末尾若干字：长句保持一行，突出「最新说出的词」 */
const LIVE_TAIL_CHARS = 34;

/** 语音态内容（灵动岛与面板入口条共用）：波纹点 + 雾中实时转写 + 一行提示。
 *  点的高度/透明度由 ChatDock 的电平循环直接写 DOM 样式（不进 React 状态，60fps 不重渲染）。 */
function VoiceBar({ live, hint }: { live: string; hint: string }): ReactNode {
  return (
    <span className="dock-voicebar">
      <span className="dock-wave" aria-hidden="true">
        {Array.from({ length: WAVE_DOTS }, (_, i) => (
          <i className="dock-wave-dot" key={i} />
        ))}
      </span>
      <span className="dock-voicebar-live">{live}</span>
      <span className="dock-voicebar-hint">{hint}</span>
    </span>
  );
}

interface ViewMsg {
  role: "user" | "assistant";
  text: string;
  /** 链元数据（R7）：本条回答的思考链与工具调用链，折叠可展开回看 */
  meta?: { think?: string; trace?: string[] };
}

/** 可折叠链块：思考过程 / 工具调用（流式期展开，落定折叠，随时展开回看） */
function ChainBlock({ label, lines, defaultOpen = false }: { label: string; lines: string[]; defaultOpen?: boolean }): ReactNode {
  const [open, setOpen] = useState(defaultOpen);
  if (lines.length === 0) return null;
  const total = lines.reduce((n, l) => n + l.length, 0);
  return (
    <div className="dock-think">
      <button className="dock-think-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="dock-think-label">{label}</span>
        <span className="dock-think-meta">{open ? "点击收起" : `${lines.length} 条 · ${total} 字`}</span>
        <i className={"plg-caret" + (open ? " is-open" : "")} />
      </button>
      {open ? (
        <div className="dock-think-body">
          {lines.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
interface UsageInfo {
  sessionCostUsd?: number;
  totalCostUsd?: number;
  budgetUsd?: number;
  budgetLeftUsd?: number;
  sessionPrompt?: number;
  sessionCompletion?: number;
  totalPrompt?: number;
  totalCompletion?: number;
  totalCalls?: number;
}
interface SessionRow {
  id: string;
  title: string;
  updatedAt: number;
  messages: number;
  costUsd: number;
}

function readOpen(): boolean {
  const raw = localStorage.getItem(OPEN_KEY);
  return raw == null ? true : raw === "1"; // 首次安装默认弹出
}
function fmtUsd(v?: number): string {
  if (v == null) return "-";
  if (v === 0) return "$0";
  return v < 0.01 ? `$${v.toFixed(5)}` : `$${v.toFixed(4)}`;
}

/* ───────── 消息区（memo：拖拽期间 FAB 每帧改位不重排 markdown） ───────── */

interface MsgListProps {
  msgs: ViewMsg[];
  stream: string | null;
  status: string | null;
  think: string;
  thinkOpen: boolean;
  trace: string[];
  confirmCard: string | null;
  busy: boolean;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onSend: (t: string) => void;
  onPick: (t: string) => void;
  onToggleThink: () => void;
  onMsgsClick: (e: MouseEvent) => void;
}

/** 开场三行（左对齐、逐字下落）：展开成 [行][字+延迟] 一次性算好 */
const HERO_LINES = ["你好！", "我是小OH，", "有什么能帮你的吗？"];
const HERO_CHARS: Array<Array<{ ch: string; delay: number }>> = (() => {
  let n = 0;
  return HERO_LINES.map((line) => [...line].map((ch) => ({ ch, delay: 0.06 + n++ * 0.07 })));
})();

const SUGGESTIONS = ["明天图书馆哪有空座？", "这周考试安排", "卡里还有多少钱", "明天下午有什么日程"];

const DockMsgList = memo(function DockMsgList(p: MsgListProps): ReactNode {
  return (
    <div className="dock-msgs" ref={p.scrollRef} onClick={p.onMsgsClick}>
      {p.msgs.length === 0 && p.stream == null ? (
        <div className="dock-empty">
          {/* 新会话开场：左对齐、逐字下落的三行大字（每次新建对话重挂载即重演） */}
          <div className="dock-hero" aria-label="你好！我是小OH，有什么能帮你的吗？">
            {HERO_CHARS.map((line, i) => (
              <div className="dock-hero-line" key={i}>
                {line.map((c, j) => (
                  <span className="dock-hero-ch" style={{ animationDelay: `${c.delay}s` }} key={j}>{c.ch}</span>
                ))}
              </div>
            ))}
          </div>
          <div className="dock-empty-chips">
            {SUGGESTIONS.map((s) => (
              <button key={s} className="dock-chip" onClick={() => p.onPick(s)}>{s}</button>
            ))}
          </div>
        </div>
      ) : null}
      {p.msgs.map((m, i) =>
        m.role === "assistant" ? (
          <div key={i} className="dock-msg-assistant">
            {m.meta?.think ? <ChainBlock label="思考过程" lines={[m.meta.think]} /> : null}
            {m.meta?.trace?.length ? <ChainBlock label="工具调用" lines={m.meta.trace} /> : null}
            <div className="dock-msg dock-md">
              <Markdown remarkPlugins={[remarkGfm]}>{m.text}</Markdown>
            </div>
          </div>
        ) : (
          <div key={i} className="dock-msg dock-msg-user">{m.text}</div>
        ),
      )}
      {p.trace.length > 0 ? <ChainBlock label="工具调用" lines={p.trace} defaultOpen /> : null}
      {p.think ? (
        <div className="dock-think">
          <button className="dock-think-head" onClick={p.onToggleThink} aria-expanded={p.thinkOpen}>
            <span className="dock-think-label">思考过程</span>
            <span className="dock-think-meta">{p.thinkOpen ? "点击收起" : `${p.think.length} 字 · 已折叠`}</span>
            <i className={"plg-caret" + (p.thinkOpen ? " is-open" : "")} />
          </button>
          {p.thinkOpen ? <div className="dock-think-body">{p.think}</div> : null}
        </div>
      ) : null}
      {p.stream != null ? (
        <div className="dock-msg dock-msg-assistant dock-streaming">
          {p.stream ? (
            <div className="dock-md">
              <Markdown remarkPlugins={[remarkGfm]}>{p.stream}</Markdown>
            </div>
          ) : (
            <span className="dock-thinking">{p.status ?? "思考中…"}</span>
          )}
          {p.stream ? <span className="dock-caret" /> : null}
        </div>
      ) : null}
      {p.confirmCard ? (
        <div className="dock-confirm">
          <div className="dock-confirm-text">{p.confirmCard}</div>
          <div className="dock-confirm-ops">
            <button className="btn btn-primary dock-btn" disabled={p.busy} onClick={() => p.onSend("确认")}>确认执行</button>
            <button className="btn dock-btn" disabled={p.busy} onClick={() => p.onSend("取消")}>取消</button>
          </div>
        </div>
      ) : null}
    </div>
  );
});

export function ChatDock(): ReactNode {
  const cmds = useSyncExternalStore(subscribeCommands, commandsSnapshot);
  const dockCmd = cmds.find((c) => c.dock && c.id === "chat");
  const pid = dockCmd?.pluginId ?? null;

  const [open, setOpen] = useState(readOpen);
  const [closing, setClosing] = useState(false); // 关闭动画期：面板仍挂载
  /* 灵动岛：语音会话状态机 off→arming（等授权窗）→listening（轮询转写）→sending（等最终结果） */
  const [voice, setVoice] = useState<"off" | "arming" | "listening" | "sending">("off");
  // 语音会话的真实时序源（state 是渲染快照，存在竞态）：idle=未进行；starting=enterVoice
  // 启动中（含 await speechAvailable/speechStart 的窗口）；active=已开始监听
  const voicePhaseRef = useRef<"idle" | "starting" | "active">("idle");
  const [voiceText, setVoiceText] = useState("");
  const [voiceFail, setVoiceFail] = useState<string | null>(null); // 失败原因：在本次长按的宿主上亮 2.6s 再散
  const [voiceHost, setVoiceHost] = useState<"island" | "entry">("island"); // 失败文案落在哪（岛 / 面板入口条）
  const [pressing, setPressing] = useState(false); // 按住未到长按阈值：给一点「准备」反馈
  const [inputMode, setInputMode] = useState(false); // 文本输入框是否展开（默认收起，只留入口按钮）
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [slidIn, setSlidIn] = useState(false); // 语音开面板用滑动进场（区别于点击 morph）
  const islandText = useIslandText();
  const pressTimer = useRef<number | null>(null); // 长按计时（null=未按/已触发语音）
  const [msgs, setMsgs] = useState<ViewMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [stream, setStream] = useState<string | null>(null);
  const [trace, setTrace] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [confirmCard, setConfirmCard] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageInfo>({});
  const [history, setHistory] = useState<SessionRow[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  /* 思维链（R4 think 事件聚合）：流式期间展开，首个回答 delta 到达自动折叠，可手动展开回看 */
  const [think, setThink] = useState("");
  const [thinkOpen, setThinkOpen] = useState(true);
  const hydratedFor = useRef<string | null>(null);
  const seenEv = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  /* 运行代次：打断/强停/换插件后作废迟到回包；busyRef 是 busy 的即时镜像（异步闭包防陈旧） */
  const runSeq = useRef(0);
  const busyRef = useRef(false);
  const deadman = useRef<number | null>(null);
  /* 链镜像：finalize 时随回答落库为 meta；delta 节流缓冲（markdown 逐帧重解析会卡 UI） */
  const thinkRef = useRef("");
  const traceRef = useRef<string[]>([]);
  const deltaBuf = useRef("");
  const deltaTimer = useRef<number | null>(null);
  /* 自愈看门狗：流式文本镜像 + 最后事件时刻 + 本代次是否已落定（防回复链路丢失后永久 busy） */
  const streamRef = useRef("");
  const lastEvAt = useRef(Date.now());
  const finalizedFor = useRef(0);
  const closeTimer = useRef<number | null>(null);
  /* 导入会话：真按钮 + 隐藏 input（label 方案在触屏密度层下渲染高度与 button 不一致） */
  const fileRef = useRef<HTMLInputElement>(null);
  /* 外部运行标记：IM 入口的对话事件不进本地视图（见事件泵 foreignRun 分支） */
  const foreignRun = useRef(false);

  const flushDelta = (): void => {
    deltaTimer.current = null;
    const t = deltaBuf.current;
    if (!t) return;
    deltaBuf.current = "";
    streamRef.current += t;
    setStream((v) => (v ?? "") + t);
  };

  const toggle = useCallback((): void => {
    if (open) {
      localStorage.setItem(OPEN_KEY, "0");
      setClosing(true); // 先演退场动画，再卸载
      // 关面板即允许下次重开重水合：期间 IM/云盘可能写入了新轮次（2026-10-10）
      hydratedFor.current = null;
      if (closeTimer.current) clearTimeout(closeTimer.current);
      closeTimer.current = window.setTimeout(() => {
        closeTimer.current = null;
        setClosing(false);
        setOpen(false);
      }, 200); // ≥退场动画 190ms
    } else {
      localStorage.setItem(OPEN_KEY, "1");
      setClosing(false);
      setOpen(true);
      setUnread(0);
    }
  }, [open]);

  /** 只清本会话计数，累计用量（跨会话持久）保留并刷新 */
  const keepTotals = (): void => {
    setUsage((u) => ({
      budgetUsd: u.budgetUsd, budgetLeftUsd: u.budgetLeftUsd,
      totalCostUsd: u.totalCostUsd, totalPrompt: u.totalPrompt,
      totalCompletion: u.totalCompletion, totalCalls: u.totalCalls,
    }));
  };

  // 插件变更：清视图，重挂水合标记；作废旧插件迟到回包与死人开关
  useEffect(() => {
    hydratedFor.current = null;
    setMsgs([]);
    setStream(null);
    setThink("");
    setThinkOpen(true);
    setTrace([]);
    thinkRef.current = "";
    traceRef.current = [];
    if (deltaTimer.current) {
      clearTimeout(deltaTimer.current);
      deltaTimer.current = null;
    }
    deltaBuf.current = "";
    setConfirmCard(null);
    setUsage({});
    seenEv.current = 0;
    setHistory(null);
    runSeq.current++;
    if (deadman.current) {
      clearTimeout(deadman.current);
      deadman.current = null;
    }
    busyRef.current = false;
    setBusy(false);
    return () => {
      if (closeTimer.current) {
        clearTimeout(closeTimer.current);
        closeTimer.current = null;
      }
    };
  }, [pid]);

  // 水合：打开面板且尚未载入当前会话 → 导出会话 JSON 还原视图（R5）+ 拉累计用量。
  // foreignTick：外部入口（IM 微信/飞书）完成对话后打点——本地无运行在途时静默重水合，
  // 把 IM 轮次并入视图（IM 的 delta 会被 R10 迟到守卫拦掉，回答回执只走 IM 通道，
  // 不重水合主界面就永远看不到 IM 的新轮次；2026-10-10 用户实录）。
  const [foreignTick, setForeignTick] = useState(0);
  useEffect(() => {
    if (!pid || !open || hydratedFor.current === pid) return;
    hydratedFor.current = pid;
    // 重水合先清流式残影：此刻若 busy 必为本地在途（foreignTick 分支只在 !busy 时打点），
    // 若非 busy 则 stream/think 里只可能是外部入口（IM）事件的残留——一并冲掉
    if (!busyRef.current) {
      if (deltaTimer.current) {
        clearTimeout(deltaTimer.current);
        deltaTimer.current = null;
      }
      deltaBuf.current = "";
      streamRef.current = "";
      setStream(null);
      setThink("");
    }
    void (async () => {
      try {
        const res: any = await callRust(pid, "run", { command: "export_session", input: "" });
        if (res?.ok && res.json) {
          const s = JSON.parse(res.json);
          const view: ViewMsg[] = [];
          for (const m of s.messages ?? []) {
            if (m.role === "user" && m.content) view.push({ role: "user", text: m.content });
            else if (m.role === "assistant" && m.content) view.push({ role: "assistant", text: m.content });
          }
          setMsgs(view);
          if (s.usage) setUsage((u) => ({ ...u, sessionPrompt: s.usage.prompt, sessionCompletion: s.usage.completion, sessionCostUsd: s.cost_usd }));
        } else {
          setMsgs([]);
        }
      } catch {
        setMsgs([]);
      }
      try {
        const t: any = await callRust(pid, "run", { command: "usage_report" });
        if (t?.ok && t.totals) {
          setUsage((u) => ({
            ...u,
            totalPrompt: t.totals.prompt, totalCompletion: t.totals.completion,
            totalCalls: t.totals.calls, totalCostUsd: t.totals.costUsd,
          }));
        }
      } catch { /* 保留现值 */ }
    })();
  }, [pid, open, foreignTick]);

  // 事件泵：流式增量 / 工具轨迹 / 用量（R4）
  const events = useSyncExternalStore(subscribePluginEvents, pid ? () => pluginEvents(pid) : () => EMPTY_EVENTS);
  useEffect(() => {
    if (!pid) return;
    const fresh = events.slice(seenEv.current);
    seenEv.current = events.length;
    if (fresh.length === 0) return;
    lastEvAt.current = Date.now();
    for (const e of fresh) {
      if (e.method === "exit") {
        hardStop("插件已停止");
        return;
      }
      const kind = (e as any).kind;
      // 外部运行（IM 微信/飞书入口的对话）：本地无运行在途时收到的 delta/think/tool/log
      // 一律不进本地视图——否则 IM 回复会流进本地流式气泡（永不 finalize → 幽灵光标
      // 常闪、多轮拼成一长串，2026-10-10 用户实录）。轮次由 usage 事件后的重水合并入。
      if (!busyRef.current && (kind === "delta" || kind === "think" || kind === "tool" || kind === "log" || kind === "notice")) {
        foreignRun.current = true;
        continue;
      }
      // R10：已落定的对话不得再吃迟到事件——Tauri 事件通道与 invoke 回执无顺序保证，
      // 迟到 delta 会复活流式气泡（幽灵光标一直闪）
      if (finalizedFor.current === runSeq.current && runSeq.current > 0 && (kind === "delta" || kind === "think" || kind === "tool")) {
        continue;
      }
      if (kind === "delta" && e.text) {
        setThinkOpen(false); // 回答开始 → 思考过程自动折叠
        deltaBuf.current += e.text;
        if (!deltaTimer.current) deltaTimer.current = window.setTimeout(flushDelta, 120);
      } else if (kind === "think" && e.text) {
        thinkRef.current += e.text;
        setThink((t) => t + e.text);
      } else if (kind === "tool" && e.text) {
        traceRef.current = [...traceRef.current.slice(-60), e.text!];
        setTrace((t) => [...t.slice(-40), e.text!]);
      }
      else if (kind === "log" && e.text) {
        // R7 结构化日志（LLM 请求/响应行）同样进「工具调用」链——模型源可证：
        // 「→ LLM 请求 <model> · … · <端点 URL>」直接显示这一轮打到哪个服务
        traceRef.current = [...traceRef.current.slice(-60), e.text!];
        setTrace((t) => [...t.slice(-40), e.text!]);
      }
      else if (kind === "notice" && e.text) setStatus(e.text);
      else if (kind === "usage" && (e as any).payload) {
        setUsage((u) => ({ ...u, ...(e as any).payload }));
        // 外部入口（IM）对话完成：清掉其残留（不进气泡的保证 + 兜底清 stream/think），
        // 静默重水合把新轮次（含 IM 侧的用户消息）并入视图
        if (foreignRun.current || !busyRef.current) {
          foreignRun.current = false;
          if (!busyRef.current) {
            if (deltaTimer.current) {
              clearTimeout(deltaTimer.current);
              deltaTimer.current = null;
            }
            deltaBuf.current = "";
            streamRef.current = "";
            setStream(null);
            thinkRef.current = "";
            setThink("");
            hydratedFor.current = null;
            setForeignTick((t) => t + 1);
          }
        }
      }
    }
    const sc = scrollRef.current;
    if (sc) sc.scrollTop = sc.scrollHeight;
  }, [events, pid]);

  const finalize = (r: any): void => {
    if (finalizedFor.current === runSeq.current && runSeq.current > 0) return; // 已落定（看门狗兜底后真回复迟到）
    finalizedFor.current = runSeq.current;
    // 冲掉在途 delta 缓冲：否则落定后迟到的定时器会把残余增量拼回 stream，冒出幽灵流式气泡
    if (deltaTimer.current) {
      clearTimeout(deltaTimer.current);
      deltaTimer.current = null;
    }
    deltaBuf.current = "";
    const answer = typeof r?.answer === "string" ? r.answer : r?.error != null ? `⚠ ${r.error}` : "(空响应)";
    setMsgs((v) => [...v, { role: "assistant", text: answer, meta: { think: thinkRef.current, trace: traceRef.current } }]);
    setStream(null);
    setThinkOpen(false); // 回答落定 → 链折叠（随 meta 挂在本条回答上，可展开回看）
    setTrace([]);
    setStatus(null);
    setConfirmCard(r?.confirm?.summary ?? null);
    if (r?.totalUsage || r?.sessionUsage) {
      setUsage((u) => ({ ...u, ...(r.sessionUsage ?? {}), ...(r.totalUsage ?? {}) }));
    }
    if (!open) setUnread((n) => n + 1);
    requestAnimationFrame(() => {
      const sc = scrollRef.current;
      if (sc) sc.scrollTop = sc.scrollHeight;
    });
  };

  /** 强制收尾：清 busy + 作废迟到回包（打断超时/插件死亡/换插件时的 UI 兜底） */
  const hardStop = (note: string): void => {
    if (deadman.current) {
      clearTimeout(deadman.current);
      deadman.current = null;
    }
    if (!busyRef.current) return;
    runSeq.current++;
    busyRef.current = false;
    setBusy(false);
    setMsgs((v) => [...v, { role: "assistant", text: `■ ${note}` }]);
    setStream(null);
    setTrace([]);
    setStatus(null);
    setConfirmCard(null);
  };

  const send = useCallback(async (raw: string): Promise<void> => {
    const text = raw.trim();
    if (!pid || busyRef.current || !text) return;
    const seq = ++runSeq.current;
    finalizedFor.current = 0;
    foreignRun.current = false; // 本地运行启动：此后的事件都属本地（IM 单飞队列不会并发进来）
    streamRef.current = "";
    lastEvAt.current = Date.now();
    busyRef.current = true;
    setBusy(true);
    setMsgs((v) => [...v, { role: "user", text }]);
    setStream("");
    setThink("");
    setThinkOpen(true);
    setTrace([]);
    thinkRef.current = "";
    traceRef.current = [];
    setConfirmCard(null);
    setStatus("思考中…");
    // 自愈看门狗（R9）：流式文本已非空且 8s 无任何新事件 → 视为已完成，
    // 用已流出的内容落定并解锁——无论 run 应答卡在链路哪一环，UI 都不再永久 busy
    const watchdog = window.setInterval(() => {
      if (seq !== runSeq.current || !busyRef.current) {
        window.clearInterval(watchdog);
        return;
      }
      const idle = Date.now() - lastEvAt.current;
      if (streamRef.current && idle > 8_000) {
        window.clearInterval(watchdog);
        console.warn("[dock] 应答链路超时，看门狗按已流出内容落定");
        if (seq === runSeq.current) finalize({ answer: streamRef.current });
        busyRef.current = false;
        setBusy(false);
      }
    }, 1000);
    try {
      const res: any = await callRust(pid, "run", { command: "chat", input: text });
      window.clearInterval(watchdog);
      if (seq !== runSeq.current) return; // 已被打断/强停：迟到回包作废
      finalize(res);
    } catch (e) {
      window.clearInterval(watchdog);
      if (seq !== runSeq.current) return;
      finalize({ answer: "", error: e instanceof Error ? e.message : String(e) });
    } finally {
      if (seq === runSeq.current) {
        busyRef.current = false;
        setBusy(false);
      }
      if (deadman.current) {
        clearTimeout(deadman.current);
        deadman.current = null;
      }
    }
  }, [pid, open]);

  /* OH 直达：外部请求（搜索页「问 OH」）→ 开面板并直接发送（seq 去重，绝不重复发） */
  const ohReq = useSyncExternalStore(subscribeOhPrompt, ohPromptSnapshot, ohPromptSnapshot);
  const ohDoneSeq = useRef(ohPrompt?.seq ?? 0);
  useEffect(() => {
    if (!ohReq || ohReq.seq === ohDoneSeq.current) return;
    ohDoneSeq.current = ohReq.seq;
    localStorage.setItem(OPEN_KEY, "1");
    setClosing(false);
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setOpen(true);
    setUnread(0);
    void send(ohReq.text);
  }, [ohReq, send]);

  const runCmd = async (command: string, input = ""): Promise<any> => {
    if (!pid) return null;
    try {
      return await callRust(pid, "run", { command, input });
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
      return null;
    }
  };

  /** 累计用量刷新（usage_report：跨会话总量，切换/新建后立即可见） */
  const refreshTotals = async (): Promise<void> => {
    if (!pid) return;
    try {
      const r: any = await callRust(pid, "run", { command: "usage_report" });
      if (r?.ok && r.totals) {
        setUsage((u) => ({
          ...u,
          totalPrompt: r.totals.prompt, totalCompletion: r.totals.completion,
          totalCalls: r.totals.calls, totalCostUsd: r.totals.costUsd,
        }));
      }
    } catch { /* 保留现值 */ }
  };

  const newSession = async (): Promise<void> => {
    if (busyRef.current) {
      // 打断中也能开新会话：强制解锁，迟到回包作废
      hardStop("已打断，开新会话");
      await new Promise((r) => setTimeout(r, 60));
    }
    await runCmd("new_session");
    hydratedFor.current = pid;
    setMsgs([]);
    setConfirmCard(null);
    keepTotals();
    void refreshTotals();
    setNotice("已新建会话");
  };

  const openHistory = async (): Promise<void> => {
    const r = await runCmd("list_sessions");
    setHistory(Array.isArray(r?.sessions) ? r.sessions : []);
  };

  const switchSession = async (id: string): Promise<void> => {
    if (busyRef.current) {
      hardStop("已打断，切换会话");
      await new Promise((r) => setTimeout(r, 60));
    }
    await runCmd("switch_session", id);
    hydratedFor.current = pid;
    setMsgs([]);
    setConfirmCard(null);
    keepTotals();
    setHistory(null);
    void refreshTotals();
    // 立即水合新会话
    try {
      const res: any = await callRust(pid!, "run", { command: "export_session", input: id });
      if (res?.ok && res.json) {
        const s = JSON.parse(res.json);
        const view: ViewMsg[] = [];
        for (const m of s.messages ?? []) {
          if (m.role === "user" && m.content) view.push({ role: "user", text: m.content });
          else if (m.role === "assistant" && m.content) view.push({ role: "assistant", text: m.content });
        }
        setMsgs(view);
        if (s.usage) setUsage((u) => ({ ...u, sessionPrompt: s.usage.prompt, sessionCompletion: s.usage.completion, sessionCostUsd: s.cost_usd }));
      }
    } catch {
      /* 保持空视图 */
    }
  };

  const deleteSession = async (id: string): Promise<void> => {
    const r = await runCmd("delete_session", id);
    setHistory(Array.isArray(r?.sessions) ? r.sessions : []);
    if (r?.ok) {
      // 修（老 bug，云盘之前就存在）：删除的若是当前显示会话，视图会残留旧对话——
      // 关开面板也不重水合（hydratedFor 已等于 pid 短路了 345 行的 effect）。
      // 删除成功即重置水合标记，让 effect 按 core 返回的新 active 立即重建视图。
      setMsgs([]);
      setStream(null);
      setConfirmCard(null);
      setStatus(null);
      setNotice("已删除");
      hydratedFor.current = null;
    } else {
      setNotice(r?.error ?? "删除失败");
    }
  };

  const exportSession = async (): Promise<void> => {
    const r = await runCmd("export_session", "");
    if (!r?.ok || !r.json) {
      setNotice(r?.error ?? "导出失败");
      return;
    }
    // R10：WKWebView 无下载管理器，a[download] 点击静默无效——宿主代写 ~/Downloads
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const path = await invoke<string | null>("save_text_file", {
        filename: `onethu-harness-${(r.sessionId ?? "session").slice(0, 18)}.json`,
        contents: r.json,
      });
      setNotice(path ? `已导出：${path}` : "已取消导出");
    } catch (e) {
      setNotice(`导出失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const importSession = async (f: File): Promise<void> => {
    const text = await f.text();
    const r = await runCmd("import_session", text);
    if (r?.ok) {
      hydratedFor.current = pid;
      setMsgs([]);
      setNotice(`已导入：${r.title ?? "会话"}`);
      void switchSession(r.sessionId);
    } else {
      setNotice(r?.error ?? "导入失败");
    }
  };

  const stop = (): void => {
    if (!pid) return;
    void notifyRust(pid, "interrupt").catch(() => undefined);
    setStatus("正在打断…");
    // 死人开关：插件 12s 内没自行收尾就强制解锁——打断永不卡死 UI
    if (!deadman.current && busyRef.current) {
      deadman.current = window.setTimeout(() => {
        deadman.current = null;
        hardStop("已打断（插件未及时响应，已强制解锁）");
      }, 12_000);
    }
  };

  /** 消息区链接一律外跳系统浏览器（webview 内导航会带走整个应用） */
  const onMsgsClick = (e: MouseEvent): void => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    const href = a.getAttribute("href");
    if (!href) return;
    e.preventDefault();
    // onethu-news://<xxid> = 站内新闻直达（小OH 新闻链接专用），不开浏览器
    const m = /^onethu-news:\/\/(.+)$/.exec(href);
    if (m?.[1]) {
      navGo("info", { infoNewsId: decodeURIComponent(m[1]) });
      return;
    }
    void openExternal(href);
  };

  /* ───────── 灵动岛：点击展开 / 长按语音 ───────── */

  // 语音轮询：listening 期间每 180ms 拉一次部分转写
  useEffect(() => {
    if (voice !== "listening") return;
    const t = window.setInterval(() => {
      void speechPoll().then(setVoiceText);
    }, 180);
    return () => window.clearInterval(t);
  }, [voice]);

  /* 波纹点动画：音量电平（speech_level → 0..1）驱动。
     - 直接写 DOM 样式（转写文本仍走 180ms 的 state 通道）——60fps 不引发 React 重渲染；
     - 电平每 LEVEL_POLL_MS 拉一次 + 指数平滑：变化滞后一拍 → 观感「柔」，不抖；
     - 取不到电平（桌面端 / 识别器不给 onRmsChanged）时振幅有下限 0.42 —— 退化为**时间正弦**，
       始终在动；NaN/越界一律夹回 0..1，不存在空转或 NaN；
     - 宿主可能是岛、也可能是面板里的入口条，两个都刷（只有可见的那个看得见）。 */
  useEffect(() => {
    if (voice === "off") return;
    const dots = Array.from(document.querySelectorAll<HTMLElement>(".dock-wave-dot"));
    if (dots.length === 0) return;
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let alive = true;
    let raf = 0;
    let target = 0; // 最新电平
    let smooth = 0; // 平滑后电平：驱动振幅与透明度
    let poll: number | null = null;

    const pull = (): void => {
      void speechLevel().then((v) => {
        if (alive) target = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
      });
    };
    if (voice === "listening") {
      pull();
      poll = window.setInterval(pull, LEVEL_POLL_MS);
    }

    if (reduce) {
      // 系统「减弱动态效果」：静帧点列（只留轻微高低差），连 rAF 都不开
      dots.forEach((el, i) => {
        el.style.transform = `scaleY(${(0.44 + (i % 3) * 0.14).toFixed(2)})`;
        el.style.opacity = "0.55";
      });
    } else {
      const t0 = performance.now();
      const tick = (now: number): void => {
        if (!alive) return;
        const t = (now - t0) / 1000;
        smooth += (target - smooth) * 0.16; // 电平跳变被摊平（ease-in-out 的观感）
        if (!Number.isFinite(smooth)) smooth = 0;
        const amp = 0.42 + 0.58 * smooth; // 无电平时 0.42：正弦照常呼吸
        dots.forEach((el, i) => {
          const s = 0.5 + 0.5 * Math.sin(t * 5.2 - i * 0.62);
          const h = Math.min(1.28, Math.max(0.18, 0.26 + s * amp));
          el.style.transform = `scaleY(${h.toFixed(3)})`;
          el.style.opacity = (0.34 + 0.66 * s * (0.5 + 0.5 * smooth)).toFixed(3);
        });
        raf = window.requestAnimationFrame(tick);
      };
      raf = window.requestAnimationFrame(tick);
    }
    return () => {
      alive = false;
      if (raf) window.cancelAnimationFrame(raf);
      if (poll != null) window.clearInterval(poll);
    };
  }, [voice]);

  // 文本输入模式展开即聚焦（移动端顺势弹出键盘）
  useEffect(() => {
    if (inputMode) inputRef.current?.focus();
  }, [inputMode]);

  // 兜底：按住期间窗口失焦（Cmd+Tab、切换空间等），pointerup 不会到达按钮，语音会
  // 悬死。失焦时若语音仍在进行则立即收尾。
  useEffect(() => {
    const onBlur = (): void => {
      if (voicePhaseRef.current !== "idle") void finishVoice();
    };
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, []);

  /** 语音失败：在本次长按的那个宿主上亮 2.6s（岛=雾状浮片，面板内=入口条内联；notice 看不见） */
  const showVoiceFail = (msg: string): void => {
    setVoice("off");
    setVoiceText("");
    setVoiceFail(msg);
    window.setTimeout(() => setVoiceFail(null), 2600);
  };

  const enterVoice = async (): Promise<void> => {
    if (voicePhaseRef.current !== "starting") return; // 防重入
    if (!(await speechAvailable())) {
      voicePhaseRef.current = "idle";
      // 桌面端/未提供系统识别服务的机子：明确降级文案，别静默（需求 5）
      showVoiceFail(speechUnavailableHint());
      return;
    }
    setVoice("arming");
    setVoiceText("");
    try {
      await speechStart(); // 首次会同步等待系统授权窗（麦克风+语音识别）
      // 启动期间用户已松手（finishVoice 置 idle）：立即收尾，杜绝「无人监听却停不下来」
      if (voicePhaseRef.current !== "starting") {
        speechStop();
        setVoice("off");
        setVoiceText("");
        return;
      }
      voicePhaseRef.current = "active";
      setVoice("listening");
    } catch (e) {
      voicePhaseRef.current = "idle";
      showVoiceFail(`语音启动失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  /** 松手：收最终文本 → **整句直接喂给 OH**（ohAsk：开面板 + 直接发送）。
   *  不进输入框、不建新会话（2026-10-10 用户拍板：识别结果就是一条完整消息）。 */
  const finishVoice = async (): Promise<void> => {
    // 守卫读 phase ref（真时序），不读渲染快照的 voice——启动窗口内松手也能正确收尾
    if (voicePhaseRef.current === "idle") return;
    const started = voicePhaseRef.current === "active";
    voicePhaseRef.current = "idle";
    setPressing(false);
    if (!started) {
      // 尚未进入监听：无需等识别器收尾
      speechStop();
      setVoice("off");
      setVoiceText("");
      return;
    }
    setVoice("sending");
    speechStop();
    await new Promise((r) => setTimeout(r, VOICE_FINAL_GRACE_MS)); // 识别器收尾出最终结果
    const final = (await speechPoll()).trim();
    setVoice("off");
    setVoiceText("");
    if (!final) return; // 什么都没听到：安静收场，不发空消息
    if (busyRef.current) {
      // ohAsk 的 send 被 busy 守卫挡住会静默吞掉这一句——明说，别让用户以为识别失败了
      showVoiceFail("小OH 正在回答，稍后再长按说");
      return;
    }
    setSlidIn(true); // 面板滑动进场（区别于点击的 morph）
    ohAsk(final); // ← 唯一出口：完整一条消息直接发给 OH
    window.setTimeout(() => setSlidIn(false), 700);
  };

  /* ── 长按语音的按下/抬起：灵动岛与面板入口条共用同一套 450ms 语义 ── */
  const beginHold = (host: "island" | "entry"): void => {
    setVoiceFail(null);
    setVoiceHost(host);
    setPressing(true); // 先给「准备中」的轻微反馈，越过 450ms 才真的长起来
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null;
      setPressing(false);
      voicePhaseRef.current = "starting";
      void enterVoice();
    }, VOICE_HOLD_MS);
  };
  /** 抬起：未到阈值 → 走调用方的点击语义；已进语音 → 收尾 */
  const endHold = (onTap: () => void): void => {
    setPressing(false);
    if (pressTimer.current != null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
      onTap();
      return;
    }
    void finishVoice();
  };

  const onIslandPointerDown = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    beginHold("island");
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* 捕获失败仍可长按 */
    }
  };
  const onIslandPointerUp = (): void => endHold(toggle); // 未到阈值 = 点击：开/收面板
  // 兜底：pointer capture 被 WebView 丢弃（系统手势等）时，指针事件不再到达按钮，
  // 语音会悬死。捕获丢失且语音仍在进行 → 立即收尾（正常路径 up 先释放捕获，此处 idle 无副作用）。
  const onIslandLostCapture = (): void => {
    setPressing(false);
    if (voicePhaseRef.current !== "idle") void finishVoice();
  };
  const onIslandPointerCancel = (): void => {
    setPressing(false);
    if (pressTimer.current != null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
      return;
    }
    void finishVoice();
  };
  const onIslandKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
  };

  /* 面板入口条：点 = 展开原文本输入框；长按 = 语音（与岛同一套手势，文案说得到做得到） */
  const onEntryPointerDown = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    beginHold("entry");
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* 捕获失败仍可长按 */
    }
  };
  const onEntryPointerUp = (): void => endHold(() => setInputMode(true));
  const onEntryLostCapture = (): void => {
    if (voicePhaseRef.current !== "idle") void finishVoice();
  };
  const onEntryPointerCancel = (): void => {
    if (pressTimer.current != null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
      return;
    }
    void finishVoice();
  };
  const onEntryKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setInputMode(true);
    }
  };

  if (!pid) return null;
  const budgetPct = usage.budgetUsd ? Math.min(100, ((usage.totalCostUsd ?? 0) / usage.budgetUsd) * 100) : 0;
  /* 语音态：雾里的实时转写（只留末尾几字，长句也保持一行）+ 右侧一行提示 */
  const voiceHint = voice === "arming" ? "首次需在系统弹窗里允许" : voice === "sending" ? "正在发送…" : "松手直发 OH";
  const liveShown = voiceText.length > LIVE_TAIL_CHARS ? `…${voiceText.slice(-LIVE_TAIL_CHARS)}` : voiceText;

  return (
    <>
      {/* 灵动岛胶囊：底部中央（单击=面板入口，长按=语音；长按期间自然变长 + 雾 + 波纹） */}
      <button
        className={"dock-island" + (pressing ? " is-press" : "") + (voice !== "off" ? " is-voice" : "") + (open ? " is-open" : "")}
        aria-label="OneTHU 对话（点击输入，长按说话）"
        onPointerDown={onIslandPointerDown}
        onPointerUp={onIslandPointerUp}
        onPointerCancel={onIslandPointerCancel}
        onLostPointerCapture={onIslandLostCapture}
        onKeyDown={onIslandKeyDown}
      >
        {/* 常态内容：标识 + 智能文本（语音态淡出，位置让给波纹条；仍在流里，不给宽度过渡添乱） */}
        <span className="dock-island-idle">
          <span className="dock-island-logo"><HarnessMark size={15} /></span>
          <span className="dock-island-text" key={islandText}>
            {[...islandText].map((ch, i) => (
              <i key={i} style={{ animationDelay: `${i * 26}ms` }}>{ch === " " ? "\u00A0" : ch}</i>
            ))}
          </span>
        </span>
        {voice !== "off" ? (
          <>
            {/* 雾：backdrop-filter 模糊 + 顶部柔和高光（深浅色都成立） */}
            <span className="dock-island-fog" aria-hidden="true" />
            {/* 雾里的内容：随音量跳动的点点波纹 + 实时识别出的字 + 一行提示 */}
            <span className="dock-island-voice">
              <VoiceBar live={voice === "arming" ? "正在启动语音…" : liveShown || "请说话…"} hint={voiceHint} />
            </span>
          </>
        ) : null}
        {unread > 0 && !open ? <span className="dock-badge">{unread > 9 ? "9+" : unread}</span> : null}
      </button>

      {/* 语音失败的雾状浮片：本次长按发生在岛上时（发生在面板里时落在入口条内联） */}
      {voiceFail && voiceHost === "island" ? (
        <div className="dock-voice-toast" role="status" aria-live="polite">{voiceFail}</div>
      ) : null}

      {open || closing ? (
        <div
          className={"dock-panel" + (closing ? " is-closing" : "") + (slidIn ? " is-slide" : "")}
          role="dialog"
          aria-label="OneTHU Harness 对话"
        >
          <div className="dock-head">
            <span className="dock-title" title="小OH"><HarnessMark size={15} /></span>
            <div className="dock-ops">
              <button className="btn dock-btn dock-ico" title="新会话" aria-label="新会话" onClick={() => void newSession()}>
                <IconPlus />
              </button>
              <button className="btn dock-btn dock-ico" title="历史会话" aria-label="历史会话" onClick={() => void openHistory()}>
                <IconClock />
              </button>
              <button className="btn dock-btn dock-ico" title="导出当前会话 JSON" aria-label="导出会话" onClick={() => void exportSession()}>
                <IconDownload />
              </button>
              <button className="btn dock-btn dock-ico" title="导入会话 JSON" aria-label="导入会话" onClick={() => fileRef.current?.click()}>
                <IconUpload />
              </button>
              <input
                ref={fileRef}
                type="file" accept=".json,application/json"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void importSession(f);
                  e.target.value = "";
                }}
              />
              <button className="btn dock-btn dock-ico" title="收起" aria-label="收起" onClick={toggle}>
                <IconX />
              </button>
            </div>
          </div>
          {notice ? (
            <div className="dock-notice" onClick={() => setNotice(null)}>{notice}</div>
          ) : null}
          <DockMsgList
            msgs={msgs}
            stream={stream}
            status={status}
            think={think}
            thinkOpen={thinkOpen}
            trace={trace}
            confirmCard={confirmCard}
            busy={busy}
            scrollRef={scrollRef}
            onSend={(t) => void send(t)}
            onPick={(t) => { setInput(t); setInputMode(true); }}
            onToggleThink={() => setThinkOpen((o) => !o)}
            onMsgsClick={onMsgsClick}
          />
          <div className="dock-input-row">
            {inputMode ? (
              <textarea
                ref={inputRef}
                className="dock-input"
                rows={1}
                placeholder={busy ? "执行中，可打断…" : "问点什么，回车发送"}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onBlur={() => { if (!input.trim()) setInputMode(false); }} // 空着点走 = 收起，回到入口按钮
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    const t = input;
                    setInput("");
                    void send(t);
                  } else if (e.key === "Escape") {
                    setInputMode(false);
                  }
                }}
              />
            ) : (
              /* 默认形态：一行入口按钮（点=输入框，长按=语音）——不再是常驻的「问点什么」输入框 */
              <button
                className={"dock-entry" + (voice !== "off" ? " is-voice" : "") + (voiceFail && voiceHost === "entry" ? " is-fail" : "")}
                aria-label="点击输入，长按说话"
                onPointerDown={onEntryPointerDown}
                onPointerUp={onEntryPointerUp}
                onPointerCancel={onEntryPointerCancel}
                onLostPointerCapture={onEntryLostCapture}
                onKeyDown={onEntryKeyDown}
              >
                {voice !== "off" ? (
                  <VoiceBar live={voice === "arming" ? "正在启动语音…" : liveShown || "请说话…"} hint={voiceHint} />
                ) : voiceFail && voiceHost === "entry" ? (
                  <span className="dock-entry-fail">{voiceFail}</span>
                ) : (
                  <span className="dock-entry-label">点击输入，长按说话</span>
                )}
              </button>
            )}
            {busy ? (
              <button className="btn dock-send" aria-label="打断" onClick={stop}>■</button>
            ) : inputMode ? (
              <button
                className="btn btn-primary dock-send" aria-label="发送" disabled={!input.trim()}
                onClick={() => {
                  const t = input;
                  setInput("");
                  void send(t);
                }}
              >↑</button>
            ) : null}
          </div>
          <div className="dock-foot" title="R6：token 用量与价格统计（由插件精确上报；累计跨会话保留）">
            <span>本会话 {usage.sessionPrompt ?? 0}+{usage.sessionCompletion ?? 0} tok · {fmtUsd(usage.sessionCostUsd)}</span>
            <span>累计 {fmtUsd(usage.totalCostUsd)} / 预算 {fmtUsd(usage.budgetUsd)}</span>
            <div className="dock-budget"><div className="dock-budget-bar" style={{ width: `${budgetPct}%` }} /></div>
          </div>
          {history != null ? (
            <div className="dock-history" role="menu">
              <div className="dock-history-head">
                <b>历史会话</b>
                <button className="btn dock-btn" onClick={() => setHistory(null)}>关闭</button>
              </div>
              {history.length === 0 ? <div className="dock-empty">（无会话）</div> : history.map((s, idx) => (
                <div key={s.id} className="dock-hist-row">
                  <button className="dock-hist-main" onClick={() => void switchSession(s.id)}>
                    <span className="dock-hist-title">{idx === 0 ? "① " : ""}{s.title || "未命名"}</span>
                    <span className="dock-hist-meta">{idx === 0 ? "主对话 · " : ""}{s.messages} 轮 · {fmtUsd(s.costUsd)}</span>
                  </button>
                  {idx === 0 ? (
                    /* 1 号主对话永久保留（用户定案）：不提供删除入口 */
                    <span className="dock-hist-meta" style={{ alignSelf: "center", padding: "0 10px" }} title="主对话不可删除">—</span>
                  ) : (
                    <button className="btn dock-btn dock-hist-del" aria-label="删除" onClick={() => void deleteSession(s.id)}>✕</button>
                  )}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
