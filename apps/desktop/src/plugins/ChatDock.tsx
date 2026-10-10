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
import { IconClock, IconDownload, IconOrb, IconPlus, IconSpeak, IconSpeakOff, IconUpload, IconX } from "../components/Icons";
import { AttachTray } from "../components/AttachTray.js";
import { buildOhMessage, formatSize, releaseAttachPreviews, type AttachFile } from "../lib/attach.js";
import { HarnessMark } from "../components/HarnessMark.js";
import { useIslandText } from "../state/island.js";
import { speechAvailable, speechLevel, speechPoll, speechStart, speechStop, speechUnavailableHint } from "../lib/speech.js";
import { onTtsDone, previewSpeak, speakReply, ttsStop, ttsSupported } from "../lib/tts.js";
import { readVoicePrefs, setVoicePrefs, useVoicePrefs } from "../state/voicePrefs.js";
import { requestSettingsTab } from "../state/settingsMode.js";
import { isOverlayClosedByUser, onOverlayEvent, overlayHide, overlayShow, overlaySupported, setOverlayClosedByUser } from "../lib/overlay.js";
import { isAndroidNavigator } from "../lib/androidHost.js";
import { openExternal } from "../pages/info/openExternal.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const OPEN_KEY = "onethu.chatdock.open";

/* 平台判定：安卓才有「显示在其他应用上层」这道系统权限窗。
   桌面端现在 overlayDesktop 还是骨架（supported=false）→ 按钮本就不渲染；
   等桌面适配器落地、按钮在桌面出现时，这条判定能保证不去误跳安卓授权页。 */
const IS_ANDROID = isAndroidNavigator(typeof navigator !== "undefined" ? navigator : undefined);

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
/** 上划取消的位移阈值（px）：与微信同量级——按住后向上拉过它，松手就丢弃识别文本、不发送 */
const CANCEL_PULL_PX = 56;
/** 波纹点个数（5~9 档，取 7：克制的节奏感）——高度/透明度由电平驱动 */
const WAVE_DOTS = 7;
/** 电平轮询间隔：比转写轮询（180ms）快一点，波纹才跟得上嘴 */
const LEVEL_POLL_MS = 90;
/** 雾状字幕只显示转写末尾若干字：长句保持一行，突出「最新说出的词」 */
const LIVE_TAIL_CHARS = 34;
/** 语音结束后字幕多留一拍再淡出（渐出；与条收窄的 300ms 节奏对齐） */
const SUB_LINGER_MS = 240;

/** 语音态条内内容（灵动岛与面板入口条共用）：只剩**随音量跳动的波纹点** + 一行提示。
 *  识别出的字一律放条**上方**那层雾状字幕带（VoiceSubtitle）——两处不重复显示（Lead 2026-10-10 口径）。
 *  点的高度/透明度由 ChatDock 的电平循环直接写 DOM 样式（不进 React 状态，60fps 不重渲染）。 */
function VoiceBar({ hint }: { hint: string }): ReactNode {
  return (
    <span className="dock-voicebar">
      <span className="dock-wave" aria-hidden="true">
        {Array.from({ length: WAVE_DOTS }, (_, i) => (
          <i className="dock-wave-dot" key={i} />
        ))}
      </span>
      <span className="dock-voicebar-hint">{hint}</span>
    </span>
  );
}

/** 条**上方**的雾状字幕带：雾里显示目前识别出来的字（用户原话：「上面稍微一层雾状，
 *  上面显示着目前识别出来的字」）。比条更宽、更淡，雾与字两端渐隐（mask / 动画都在 CSS）。
 *  key=text：识别结果一变就重新淡入一次（140ms，只动透明度不动位置——不抖）。 */
function VoiceSubtitle({ text, out }: { text: string; out: boolean }): ReactNode {
  return (
    <div className={"dock-voice-sub" + (out ? " is-out" : "")} role="status" aria-live="polite">
      <span className="dock-voice-sub-text" key={text}>{text}</span>
    </div>
  );
}

interface ViewMsg {
  role: "user" | "assistant";
  text: string;
  /** 链元数据（R7）：本条回答的思考链与工具调用链，折叠可展开回看 */
  meta?: { think?: string; trace?: string[] };
}

/** 水合结果与本地视图的合并 —— 修 2026-10-10「语音发出的消息在面板里被吞」的竞态。
 *
 *  `export_session` 的快照可能比本地视图**旧**：本地刚 push 的用户消息、或刚落定还没落库的回答，
 *  都可能不在快照里。所以这里**绝不能整体替换**（旧实现是 `setMsgs(view)`）——那正是「两边消息都被吞」
 *  的成因。规则（纯函数）：
 *   ① export 是本地视图的前缀（本地更新）→ 原样保留本地视图；
 *   ② 否则以 export 为底，把本地多出来（export 里没有的）按原顺序续在后面。 */
function mergeHydrated(view: ViewMsg[], cur: ViewMsg[]): ViewMsg[] {
  // 索引取值可能是 undefined（noUncheckedIndexedAccess）：显式收窄
  const same = (a: ViewMsg | undefined, b: ViewMsg | undefined): boolean =>
    !!a && !!b && a.role === b.role && a.text === b.text;
  if (view.length <= cur.length && view.every((m, i) => same(m, cur[i]))) return cur;
  const tail = cur.filter((m) => !view.some((x) => same(x, m)));
  return tail.length > 0 ? [...view, ...tail] : view;
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
  /** 本机有无原生 TTS（桌面 false → 不渲染朗读按钮，不留死按钮） */
  ttsOk: boolean;
  /** 「自动朗读」开关：只用来保证按钮文案/状态与设置页一致（真出声与否由 lib/tts 判） */
  autoSpeak: boolean;
  /** 正在朗读的那一条（按文本认；null = 没在念） */
  speakingText: string | null;
  onSpeak: (t: string) => void;
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
            {/* 需求 4：朗读这一条（手动＝明确意图，无视静音开关；再点一次＝停） */}
            {p.ttsOk ? (
              <div className="dock-msg-ops">
                <button
                  className={"dock-speak" + (p.speakingText === m.text ? " is-on" : "")}
                  onClick={() => p.onSpeak(m.text)}
                  title={
                    p.speakingText === m.text ? "停止朗读"
                      : p.autoSpeak ? "朗读这一条（已开自动朗读）" : "朗读这一条（当前静音，点它就念）"
                  }
                  aria-label={p.speakingText === m.text ? "停止朗读" : "朗读这一条"}
                  aria-pressed={p.speakingText === m.text}
                >
                  <IconSpeak width={15} height={15} />
                </button>
              </div>
            ) : null}
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
  /* 需求 4（TTS）：朗读状态。autoSpeak 默认 false＝静音，所有自动朗读路径都靠 lib/tts 现读偏好兜底；
     组件这份 prefs 只负责界面一致（按钮文案/状态与设置页同一份快照）。 */
  const prefs = useVoicePrefs();
  const [ttsOk, setTtsOk] = useState(false); // 本机有无原生 TTS（桌面 false）
  const [speakingText, setSpeakingText] = useState<string | null>(null); // 正在念的那条（按文本认）
  /* 朗读代次：每次"开始念"+1。Tauri 的事件通道与 invoke 回执没有顺序保证——自己发起的
     ttsStop() 回来的那个 done 属于上一代，不能拿它把新一轮刚点亮的图标灭掉。 */
  const speakGen = useRef(0);
  const [subLinger, setSubLinger] = useState(false); // 语音结束后字幕多留一拍（渐出）
  /* 需求 5：OH 对话界面里的悬浮球入口。能力先探测（桌面 false → 不渲染按钮）；
     「本次已关闭」标记与设置页共用同一份 localStorage（lib/overlay.ts 的 CLOSED_KEY）。 */
  const [overlayOk, setOverlayOk] = useState(false);
  const [overlayOff, setOverlayOff] = useState(() => isOverlayClosedByUser());
  const [slidIn, setSlidIn] = useState(false); // 语音开面板用滑动进场（区别于点击 morph）
  const islandText = useIslandText();
  const pressTimer = useRef<number | null>(null); // 长按计时（null=未按/已触发语音）
  /* 上划取消：按下点 + 连续进度 + 是否越过阈值——**判定一律读 ref**，
     渲染快照（state）会滞后一帧，松手瞬间按快照判会误发/误取消。 */
  const holdStartY = useRef<number | null>(null);
  const cancelPctRef = useRef(0);
  const cancelArmedRef = useRef(false);
  const [cancelling, setCancelling] = useState(false); // 只驱动文案与类名（颜色连续量走 --dock-cancel）
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
  /* 「这个 pid 至少成功水合过一次」——关面板会清 hydratedFor（允许下次重开重水合），
     但 ohAsk 直达路径要据此判断本地视图可不可信（见 ohReq effect）。 */
  const everHydratedFor = useRef<string | null>(null);
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
          // 合并而非整体替换：export 快照可能比本地视图旧（在途轮次还没落库）——见 mergeHydrated
          setMsgs((cur) => mergeHydrated(view, cur));
          if (s.usage) setUsage((u) => ({ ...u, sessionPrompt: s.usage.prompt, sessionCompletion: s.usage.completion, sessionCostUsd: s.cost_usd }));
        } else if (!busyRef.current) {
          setMsgs([]); // 读不到会话：本地无在途运行才允许清空（有在途时宁可不刷新）
        }
      } catch {
        if (!busyRef.current) setMsgs([]);
      }
      everHydratedFor.current = pid; // 记「本 pid 已水合过」：ohAsk 直达时据此跳过重水合
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
    /* 需求 4 自动朗读的**触发点**：就在「回复完成」这一步（紧随回答入列）。
       只念真回答（报错/空响应不念）；静音保证＝speakReply 内部**现读** voicePrefs.autoSpeak
       （默认 false）后直接 return false，连 TTS 引擎都不问。这里刻意不读组件的 prefs 快照：
       finalize 会被 send() 的旧闭包调用，读渲染快照会陈旧（漏判用户刚在设置页打开的开关）。 */
    if (r?.error == null && answer.trim()) {
      void speakReply(answer).then((ok) => {
        if (ok) {
          speakGen.current += 1; // 真出声了才点亮图标（静音/不支持时不假装在念）
          setSpeakingText(answer);
        }
      });
    }
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

  const send = useCallback(async (raw: string, bubble?: string): Promise<void> => {
    const text = raw.trim();
    if (!pid || busyRef.current || !text) return;
    void ttsStop(); // 朗读中用户发新消息：先掐掉，别和新回答抢耳朵
    setSpeakingText(null);
    const seq = ++runSeq.current;
    finalizedFor.current = 0;
    foreignRun.current = false; // 本地运行启动：此后的事件都属本地（IM 单飞队列不会并发进来）
    streamRef.current = "";
    lastEvAt.current = Date.now();
    busyRef.current = true;
    setBusy(true);
    setMsgs((v) => [...v, { role: "user", text: bubble?.trim() || text }]);
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
    /* 修竞态（用户实录「我的消息和他的消息都被吞掉了」）：这条路径 = **关着的面板被打开 + 立刻发送**，
       而关面板时 hydratedFor 已被清空 → 水合 effect 会紧接着拉 export_session，且很可能在新一轮
       落库**之前**取到快照 → 旧实现的 setMsgs(view) 会把刚 push 的用户消息（甚至整轮问答）冲掉。
       本地视图只要已水合过就是可信的，于是**在本帧（setOpen 之前）把水合标记补上**，
       水合 effect 的 deps 里 open 会变，必须赶在它之前生效。 */
    if (pid && everHydratedFor.current === pid) hydratedFor.current = pid;
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
    void ttsStop(); // 会话换掉了：正在念的那条一起停，图标状态同步收
    setSpeakingText(null);
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
    void ttsStop();
    setSpeakingText(null);
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
        const dim = 1 - 0.55 * cancelPctRef.current; // 上划取消候选：波纹整体压暗（随位移连续）
        dots.forEach((el, i) => {
          const s = 0.5 + 0.5 * Math.sin(t * 5.2 - i * 0.62);
          const h = Math.min(1.28, Math.max(0.18, 0.26 + s * amp));
          el.style.transform = `scaleY(${h.toFixed(3)})`;
          el.style.opacity = ((0.34 + 0.66 * s * (0.5 + 0.5 * smooth)) * dim).toFixed(3);
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

  // 卸载：语音还在进行就按取消收尾（停识别器 + 清掉全局的取消进度变量）
  useEffect(() => () => {
    if (voicePhaseRef.current !== "idle") {
      voicePhaseRef.current = "idle";
      speechStop();
    }
    document.documentElement.style.setProperty("--dock-cancel", "0");
  }, []);

  // 文本输入模式展开即聚焦（移动端顺势弹出键盘）
  useEffect(() => {
    if (inputMode) inputRef.current?.focus();
  }, [inputMode]);

  /* 本机 TTS 能力（一次探测）：桌面端插件如实回 false → 不渲染朗读按钮，也不会出现点不动的死状态 */
  useEffect(() => {
    void ttsSupported().then(setTtsOk);
  }, []);

  /* 原生「念完了 / 被停了 / 出错了」→ 收口图标；error 不弹任何东西，最多 console 一行（Lead 口径） */
  useEffect(() => {
    let alive = true;
    let dispose: (() => void) | null = null;
    void onTtsDone((reason) => {
      if (!alive) return;
      /* 只收"自己这一代"的图标：代次已被新一轮顶掉 = 这条 done 是上一代的残留（120ms 后核对） */
      const g = speakGen.current;
      window.setTimeout(() => {
        if (alive && speakGen.current === g) setSpeakingText(null);
      }, 120);
      if (reason.startsWith("error")) console.warn("[dock] 朗读异常结束：", reason);
    }).then((d) => {
      dispose = d;
      if (!alive) d(); // 订阅比卸载晚到：立刻退订，别泄漏
    });
    return () => {
      alive = false;
      dispose?.();
    };
  }, []);

  /* 悬浮球：本机能力（桌面端 supported=false → 按钮根本不渲染，不留死按钮） */
  useEffect(() => {
    void overlaySupported().then(setOverlayOk);
  }, []);

  /* 重读「本次已关闭」标记的时机（同一文档内改 localStorage 不会触发 storage 事件）：
     ① 面板每次打开（设置页 → 通知与提醒 → 悬浮球 里可能刚改过）；② 应用重新获得焦点
     （从系统悬浮层授权页回来时也走这条）。 */
  useEffect(() => {
    if (open) setOverlayOff(isOverlayClosedByUser());
  }, [open]);
  useEffect(() => {
    const sync = (): void => setOverlayOff(isOverlayClosedByUser());
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  /* 用户在悬浮层的雾上点「本次关闭」→ 原生回传 closed → 把本按钮同步成已关闭态
     （订阅一次，卸载退订；桌面无适配器时 overlay.ts 会给一个 no-op 退订函数） */
  useEffect(() => {
    let alive = true;
    let dispose: (() => void) | null = null;
    void onOverlayEvent((e) => {
      if (alive && e.type === "closed") setOverlayOff(true);
    }).then((d) => {
      dispose = d;
      if (!alive) d();
    });
    return () => {
      alive = false;
      dispose?.();
    };
  }, []);

  /* 字幕渐出：语音结束后多留 SUB_LINGER_MS（也覆盖「识别完 → 面板滑入」那一拍），
     否则条一收窄字幕就瞬闪消失。 */
  useEffect(() => {
    if (voice !== "off") {
      setSubLinger(true);
      return;
    }
    const t = window.setTimeout(() => setSubLinger(false), SUB_LINGER_MS);
    return () => window.clearTimeout(t);
  }, [voice]);

  // 兜底：按住期间窗口失焦（Cmd+Tab、切换空间等），pointerup 不会到达按钮，语音会
  // 悬死。失焦时若语音仍在进行则立即收尾。
  useEffect(() => {
    const onBlur = (): void => {
      if (voicePhaseRef.current !== "idle") void finishVoice(true); // 失焦：按取消（不误发）
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
   *  不进输入框、不建新会话（2026-10-10 用户拍板：识别结果就是一条完整消息）。
   *  cancel=true（上划取消 / pointercancel / 失焦）→ 丢弃识别文本，**不发送**。 */
  const finishVoice = async (cancel = false): Promise<void> => {
    // 守卫读 phase ref（真时序），不读渲染快照的 voice——启动窗口内松手也能正确收尾
    if (voicePhaseRef.current === "idle") return;
    const started = voicePhaseRef.current === "active";
    voicePhaseRef.current = "idle";
    setPressing(false);
    resetCancelPull();
    if (!started) {
      // 尚未进入监听：无需等识别器收尾
      speechStop();
      setVoice("off");
      setVoiceText("");
      return;
    }
    if (cancel) {
      // 上划取消：直接收，不等最终结果（反正要丢），也不发送
      speechStop();
      setVoice("off");
      setVoiceText("");
      showVoiceFail("已取消");
      return;
    }
    setVoice("sending");
    speechStop();
    await new Promise((r) => setTimeout(r, VOICE_FINAL_GRACE_MS)); // 识别器收尾出最终结果
    const final = (await speechPoll()).trim();
    setVoice("off");
    if (!final) {
      setVoiceText(""); // 什么都没听到：安静收场，不发空消息
      return;
    }
    // 这里**不清** voiceText：字幕要多留一拍做渐出（清空由下次 enterVoice 负责）
    if (busyRef.current) {
      // ohAsk 的 send 被 busy 守卫挡住会静默吞掉这一句——明说，别让用户以为识别失败了
      showVoiceFail("小OH 正在回答，稍后再长按说");
      return;
    }
    setSlidIn(true); // 面板滑动进场（区别于点击的 morph）
    ohAsk(final); // ← 唯一出口：完整一条消息直接发给 OH
    window.setTimeout(() => setSlidIn(false), 700);
  };

  /** 「自动朗读」开关（对话界面的入口；设置页 通知与提醒 → 语音合成 是同源开关，同一份 prefs）：
   *  点击 = 切 autoSpeak（读现读值，不用渲染快照，避免连点丢状态）；长按/右键 = 跳到设置页那个分区。 */
  const toggleAutoSpeak = (): void => {
    const next = !readVoicePrefs().autoSpeak;
    setVoicePrefs({ autoSpeak: next });
    setNotice(next ? "已开启自动朗读：OH 的回复会念出来" : "已静音：OH 的回复不再自动朗读");
  };
  const openVoiceSettings = (): void => {
    requestSettingsTab("通知与提醒"); // 语音合成分区在这个页签（Settings.tsx 的 SETTINGS_TAB_OF）
    if (!navGo("settings")) return;
    if (open) toggle(); // 面板挡着设置页：顺手收起，落点就是那个分区
  };

  /** 悬浮球入口：关着 → 先要「显示在其他应用上层」权限，再清标记 + overlayShow()；
   *  开着 → overlayHide() + 记「本次已关闭」（用户在本体的这个入口随时能重开）。 */
  const toggleOverlay = useCallback(async (): Promise<void> => {
    if (!isOverlayClosedByUser()) {
      // 本次关闭
      try {
        await overlayHide();
        setOverlayClosedByUser(true);
        setOverlayOff(true);
        setNotice("悬浮球已本次关闭（这里可随时重开）");
      } catch (e) {
        setNotice(`悬浮球关闭失败：${e instanceof Error ? e.message : String(e)}`);
      }
      return;
    }
    // 重新打开：安卓系统悬浮窗必须先把权限拿到（动态引入：桌面端不该被带进这个模块）
    if (IS_ANDROID) {
      const { hasOverlayPermission, requestOverlayPermission } = await import("../lib/overlayAndroid.js");
      if (!(await hasOverlayPermission())) {
        await requestOverlayPermission(); // 拉起系统授权页（应用内不弹自定义弹窗）
        setNotice("已跳转系统授权页：打开「显示在其他应用上层」后回来再点一次");
        return;
      }
    }
    setOverlayClosedByUser(false);
    setOverlayOff(false);
    try {
      await overlayShow();
      setNotice("悬浮球已打开");
    } catch (e) {
      // 起不来就别假装开着：标记退回「已关闭」，用户可再点一次重试
      setOverlayClosedByUser(true);
      setOverlayOff(true);
      setNotice(`悬浮球打开失败：${e instanceof Error ? e.message : String(e)}（可再点一次重试）`);
    }
  }, []);

  /** 附件（需求 6）：AttachTray 取到文件 → 面板里加一条**用户气泡** +
   *  经既有 chat 通道把附件消息交给 OH（等价于给 sendToOh 注入一个宿主发送器，但不动全局）。
   *  默认通道只是 `askOh()` 问一次，面板里看不到这条气泡——所以这里必须自己接管。 */
  const sendAttached = useCallback(async (files: AttachFile[]): Promise<void> => {
    if (files.length === 0) return;
    try {
      if (busyRef.current) {
        setNotice("小OH 正在回答，稍后再发附件");
        return;
      }
      const label = `［附件］${files.map((f) => `${f.name}（${formatSize(f.size)}）`).join("、")}`;
      const message = await buildOhMessage(files); // 含名称/类型/大小/本地路径（文本类还带内容预览）
      await send(message, label);
    } catch (e) {
      setNotice(`附件发送失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      releaseAttachPreviews(files); // 所有权已交给宿主：预览地址由宿主回收
    }
  }, [send]);

  /** 手动「朗读这一条」：用户当场点的＝明确意图，走 previewSpeak 强制出声（无视静音开关）；
   *  再点同一条＝停。自动朗读那条路径完全交给 speakReply 内部判 autoSpeak（见 finalize）。 */
  const speakOne = useCallback((text: string): void => {
    if (speakingText === text) {
      void ttsStop();
      setSpeakingText(null);
      return;
    }
    void (async () => {
      await ttsStop(); // 换条目：先掐上一条，避免两段叠着念
      if (await previewSpeak(text)) {
        speakGen.current += 1;
        setSpeakingText(text);
      }
    })();
  }, [speakingText]);

  /* ── 上划取消（微信式）─────────────────────────────────────────────
     位移进度 0..1 连续写进 :root 的 --dock-cancel（CSS 用它做颜色渐变，不引发重渲染）；
     是否算「取消」只读 cancelArmedRef（迟滞：跨 56px 才算取消，回落到 0.85×阈值以下算反悔）。 */
  const applyCancelPull = (clientY: number): void => {
    const y0 = holdStartY.current;
    if (y0 == null) return;
    const dy = y0 - clientY; // 向上为正
    const pct = Math.max(0, Math.min(1, dy / CANCEL_PULL_PX));
    cancelPctRef.current = pct;
    document.documentElement.style.setProperty("--dock-cancel", pct.toFixed(3));
    const armed = cancelArmedRef.current ? pct > 0.85 : pct >= 1;
    if (armed !== cancelArmedRef.current) {
      cancelArmedRef.current = armed;
      setCancelling(armed);
    }
  };
  const resetCancelPull = (): void => {
    holdStartY.current = null;
    cancelPctRef.current = 0;
    cancelArmedRef.current = false;
    document.documentElement.style.setProperty("--dock-cancel", "0");
    setCancelling(false);
  };
  /** 按住期间的 pointermove：两个宿主共用（指针已被 setPointerCapture 捕获，事件必到按钮） */
  const onHoldMove = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    if (holdStartY.current == null) return; // 没在按住（正常移动/惯性滑动）
    applyCancelPull(e.clientY);
  };

  /* ── 长按语音的按下/抬起：灵动岛与面板入口条共用同一套 450ms 语义 ── */
  const beginHold = (host: "island" | "entry", clientY: number): void => {
    holdStartY.current = clientY;
    cancelPctRef.current = 0;
    cancelArmedRef.current = false;
    document.documentElement.style.setProperty("--dock-cancel", "0");
    void ttsStop(); // 开始长按说话 → 正在念的回答立刻让路（两个声音别打架）
    setSpeakingText(null);
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
  /** 抬起：未到阈值 → 走调用方的点击语义；已进语音 → 收尾（取消判定读 ref，不看快照） */
  const endHold = (onTap: () => void): void => {
    setPressing(false);
    const pulled = cancelArmedRef.current;
    if (pressTimer.current != null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
      resetCancelPull();
      if (pulled) return; // 还没进语音就上划离开：点击也一并取消（微信式，不发不点）
      onTap();
      return;
    }
    const cancel = cancelArmedRef.current;
    void finishVoice(cancel);
  };

  const onIslandPointerDown = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    beginHold("island", e.clientY);
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
    if (voicePhaseRef.current !== "idle") void finishVoice(true); // 捕获丢失：宁可丢一句，也不误发
  };
  const onIslandPointerCancel = (): void => {
    setPressing(false);
    if (pressTimer.current != null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
      resetCancelPull();
      return;
    }
    void finishVoice(true); // 系统手势抢占：按取消处理
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
    beginHold("entry", e.clientY);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* 捕获失败仍可长按 */
    }
  };
  const onEntryPointerUp = (): void => endHold(() => setInputMode(true));
  const onEntryLostCapture = (): void => {
    if (voicePhaseRef.current !== "idle") void finishVoice(true);
  };
  const onEntryPointerCancel = (): void => {
    if (pressTimer.current != null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
      resetCancelPull();
      return;
    }
    void finishVoice(true);
  };
  const onEntryKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setInputMode(true);
    }
  };

  if (!pid) return null;
  const budgetPct = usage.budgetUsd ? Math.min(100, ((usage.totalCostUsd ?? 0) / usage.budgetUsd) * 100) : 0;
  /* 语音态：条内只留一行提示（波纹在上），识别出的字一律进条上方的雾状字幕带 —— 两处不重复 */
  const voiceHint = cancelling && voice !== "off"
    ? "松开取消"
    : voice === "arming" ? "首次需弹窗允许" : voice === "sending" ? "正在发送…" : "松手直发 OH";
  const liveShown = voiceText.length > LIVE_TAIL_CHARS ? `…${voiceText.slice(-LIVE_TAIL_CHARS)}` : voiceText;
  const subText = cancelling && voice !== "off"
    ? "松开取消"
    : voice === "off" ? liveShown : voice === "arming" ? "正在启动语音…" : liveShown || "请说话…";

  return (
    <>
      {/* 条**上方**的雾状字幕带：长按期间雾里显示目前识别出来的字（比条更宽、更淡、两端渐隐） */}
      {(voice !== "off" || subLinger) && subText.trim() ? (
        <VoiceSubtitle text={subText} out={voice === "off"} />
      ) : null}

      {/* 灵动岛胶囊：底部中央（单击=面板入口，长按=语音；长按期间自然变长 + 雾 + 波纹） */}
      <button
        className={"dock-island" + (pressing ? " is-press" : "") + (voice !== "off" ? " is-voice" : "") + (open ? " is-open" : "")}
        aria-label="OneTHU 对话（点击输入，长按说话）"
        onPointerDown={onIslandPointerDown}
        onPointerMove={onHoldMove}
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
            {/* 条内：随音量跳动的点点波纹 + 一行提示（识别出的字在条上方的雾状字幕带里） */}
            <span className="dock-island-voice">
              <VoiceBar hint={voiceHint} />
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
              {ttsOk ? (
                <button
                  className={"btn dock-btn dock-ico dock-tts" + (prefs.autoSpeak ? " is-on" : "")}
                  title={prefs.autoSpeak ? "自动朗读已开启（点击改静音；长按进语音合成设置）" : "当前静音（点击开自动朗读；长按进语音合成设置）"}
                  aria-label={prefs.autoSpeak ? "关闭自动朗读" : "开启自动朗读"}
                  aria-pressed={prefs.autoSpeak}
                  onClick={toggleAutoSpeak}
                  onContextMenu={(e) => { e.preventDefault(); openVoiceSettings(); }}
                >
                  {prefs.autoSpeak ? <IconSpeak /> : <IconSpeakOff />}
                </button>
              ) : null}
              {overlayOk ? (
                <button
                  className={"btn dock-btn dock-ico dock-orb" + (overlayOff ? " is-off" : "")}
                  title={overlayOff ? "悬浮球已关闭，点此重新打开" : "悬浮球已开启，再点一次可本次关闭"}
                  aria-label={overlayOff ? "打开悬浮球" : "本次关闭悬浮球"}
                  aria-pressed={!overlayOff}
                  onClick={() => void toggleOverlay()}
                >
                  <IconOrb />
                </button>
              ) : null}
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
            ttsOk={ttsOk}
            autoSpeak={prefs.autoSpeak}
            speakingText={speakingText}
            onSpeak={speakOne}
            scrollRef={scrollRef}
            onSend={(t) => void send(t)}
            onPick={(t) => { setInput(t); setInputMode(true); }}
            onToggleThink={() => setThinkOpen((o) => !o)}
            onMsgsClick={onMsgsClick}
          />
          {/* 附件入口（需求 6）：输入行之上，薄薄一条——不抢输入框的视觉重心 */}
          <div className="dock-attach">
            <AttachTray onPicked={sendAttached} />
          </div>
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
                onPointerMove={onHoldMove}
                onPointerUp={onEntryPointerUp}
                onPointerCancel={onEntryPointerCancel}
                onLostPointerCapture={onEntryLostCapture}
                onKeyDown={onEntryKeyDown}
              >
                {voice !== "off" ? (
                  <VoiceBar hint={voiceHint} />
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
