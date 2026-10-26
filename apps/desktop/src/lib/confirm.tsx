import { createPortal } from "react-dom";
import { Banner, Btn, Input, Modal, Text } from "@onethu/gui";
/**
 * 应用内确认弹窗（Promise 化）——Tauri WKWebView 的原生 window.confirm
 * 静默返回 false（无对话框 UI），所有 confirm 门控的破坏性操作因此
 * 从未执行（暂存 ✕/清空/退选/草稿提交/场馆退订 2026-09-03 实录）。
 * 用 DOM 覆盖层替代，<ConfirmHost/> 挂在应用根部一次即可。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useOverlayBack } from "../state/navStack.js";
import { msg as uiMessage, resolveMessage, t, useLocale, type UiText } from "../i18n/index.js";

type Pending = {
  msg: UiText;
  resolve: (v: boolean) => void;
  danger?: boolean;
  /** 弹窗标题与按钮文案：由调用方按场景给（非危险档用 confirmChoice，可选标题） */
  title?: UiText;
  confirmText?: UiText;
  /** 次按钮（否定项）文案：默认「取消」；二选一场景把它说成用户实际得到的结果（如「忽略」） */
  cancelText?: UiText;
};
// Plugin callbacks can outlive a Vite HMR module instance. Keep the request and
// subscribers on this window's global so old callbacks reach the current host.
// Each native window has its own JS global; confirmations never cross windows.
type ConfirmStore = { pending: Pending | null; listeners: Set<() => void> };
const CONFIRM_STORE_KEY = Symbol.for("onethu.confirm.store.v1");
const shared = globalThis as typeof globalThis & { [CONFIRM_STORE_KEY]?: ConfirmStore };
const store = shared[CONFIRM_STORE_KEY] ??= { pending: null, listeners: new Set<() => void>() };

export function confirmOk(msg: UiText): Promise<boolean> {
  return new Promise((resolve) => {
    // 新请求顶掉旧请求（旧者按取消结算，防悬挂）
    store.pending?.resolve(false);
    store.pending = { msg, resolve };
    store.listeners.forEach((l) => l());
  });
}

/**
 * 危险操作确认（退课等不可逆操作）：大号玻璃弹窗 + ⚠️ + 红色确认钮。
 * 用户令：有人没意识到退选是真实退课——每退一门课都要醒目警告。
 */
/** 危险操作确认。标题与确认按钮文案**由调用方给**：
 *  R21c 教训——组件里曾把「即将退选 / 确认退选」写死，忽略作业复用时整屏照抄退选文案，
 *  用户当场发现。默认值只作通用兜底，具体场景（退选/忽略/删除…）一律显式传。 */
export function confirmDanger(
  msg: UiText,
  opts: { title?: UiText; confirmText?: UiText } = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    store.pending?.resolve(false);
    store.pending = {
      msg,
      resolve,
      danger: true,
      title: opts.title ?? uiMessage("confirm.dangerTitle"),
      confirmText: opts.confirmText ?? uiMessage("confirm.execute"),
    };
    store.listeners.forEach((l) => l());
  });
}

/**
 * 非危险档的二选一（同款玻璃卡，无 ⚠️、主按钮用主题色）：两个选项都是**正常动作**、
 * 只是用户要挑一个时用（如「正文图片加载失败」→ 重新登录 / 忽略）。
 * 与 `confirmOk` 的区别：两边都要说清点下去会发生什么，所以两个文案都必填——
 * 「取消 / 确定」在二选一里等于没说。
 */
export function confirmChoice(
  msg: UiText,
  opts: { title?: UiText; confirmText: UiText; cancelText: UiText; signal?: AbortSignal },
): Promise<boolean> {
  return new Promise((resolve) => {
    if (opts.signal?.aborted) { resolve(false); return; }
    store.pending?.resolve(false);
    const request: Pending = {
      msg,
      resolve: (value) => { opts.signal?.removeEventListener("abort", abort); resolve(value); },
      title: opts.title,
      confirmText: opts.confirmText,
      cancelText: opts.cancelText,
    };
    const abort = () => {
      if (store.pending === request) { store.pending = null; store.listeners.forEach((l) => l()); }
      request.resolve(false);
    };
    store.pending = request;
    opts.signal?.addEventListener("abort", abort, { once: true });
    store.listeners.forEach((l) => l());
  });
}

/** 场景措辞预设：**措辞属于场景、不属于组件**——组件只提供通用兜底。
 *  R21c 实录：忽略作业复用了退选弹窗，整屏照抄「即将退选 / 确认退选」，用户当场发现。 */
export const CONFIRM_DROP_COURSE = { title: uiMessage("confirm.dropCourseTitle"), confirmText: uiMessage("confirm.dropCourseAction") } as const;
export const CONFIRM_IGNORE_HW = { title: uiMessage("confirm.ignoreHomeworkTitle"), confirmText: uiMessage("confirm.ignoreHomeworkAction") } as const;
/** 正文图片因登录状态失效没加载出来：**非危险档**二选一——主按钮去重新登录，次按钮就地
 *  关掉（2026-10-12 用户令：改用带按钮的弹窗，别再弹会自己消失的中央提示；且不该用
 *  「不可撤销」那套红色警告档——两个选项都是正常动作）。 */
export const CONFIRM_IMG_RELOGIN = { title: uiMessage("confirm.imageReloginTitle"), confirmText: uiMessage("confirm.relogin"), cancelText: uiMessage("confirm.ignore") } as const;

export function answerConfirm(v: boolean): void {
  const request = store.pending;
  store.pending = null;
  request?.resolve(v);
  store.listeners.forEach((l) => l());
}

/* ---------- 文本输入弹层（云盘新建资料库/文件夹等命名场景） ----------
 * 与 confirmOk 同款 DOM 覆盖层（WKWebView 的 window.prompt 同样不可用）。 */

type PromptPending = {
  title: UiText;
  placeholder: UiText;
  initial: string;
  resolve: (v: string | null) => void;
};
let promptPending: PromptPending | null = null;
const promptListeners = new Set<() => void>();

/** 应用内输入弹窗：确认返回文本（trim 后非空），取消返回 null。 */
export function promptText(
  title: UiText,
  opts: { placeholder?: UiText; initial?: string } = {},
): Promise<string | null> {
  return new Promise((resolve) => {
    promptPending?.resolve(null); // 新请求顶掉旧请求（旧者按取消结算）
    promptPending = {
      title,
      placeholder: opts.placeholder ?? "",
      initial: opts.initial ?? "",
      resolve,
    };
    promptListeners.forEach((l) => l());
  });
}

export function answerPrompt(v: string | null): void {
  promptPending?.resolve(v);
  promptPending = null;
  promptListeners.forEach((l) => l());
}

function PromptField({ request, value, onChange, onSubmit }: { request: PromptPending | null; value: string; onChange: (value: string) => void; onSubmit: () => void }): React.ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Let Modal remember the invoking control before moving focus to the input.
    const frame = requestAnimationFrame(() => ref.current?.querySelector("input")?.focus());
    return () => cancelAnimationFrame(frame);
  }, [request]);
  return <div ref={ref}><Input aria-label={request ? resolveMessage(request.title) : t("prompt.input")} placeholder={resolveMessage(request?.placeholder)} value={value} onChange={onChange} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); onSubmit(); } }} /></div>;
}

function PromptHost(): React.ReactNode {
  useLocale();
  const cur = useSyncExternalStore(
    (l) => {
      promptListeners.add(l);
      return () => promptListeners.delete(l);
    },
    () => promptPending,
  );
  const last = useRef<PromptPending | null>(null);
  if (cur) last.current = cur;
  const shown = cur ?? last.current;
  const [val, setVal] = useState("");
  useEffect(() => {
    if (cur) setVal(cur.initial);
  }, [cur]);
  useOverlayBack("shared-prompt", Boolean(cur), () => answerPrompt(null));
  const submit = (): void => {
    const t = val.trim();
    if (cur && t) answerPrompt(t);
  };
  return <Modal open={!!cur} onClose={() => answerPrompt(null)} title={shown ? resolveMessage(shown.title) : t("prompt.input")} className="shared-prompt-modal" size="sm" foot={<div className="shared-confirm-actions">
    <Btn variant="outline" onClick={() => answerPrompt(null)}>{t("common.cancel")}</Btn>
    <Btn variant="solid" tone="brand" disabled={!cur || !val.trim()} onClick={submit}>{t("common.confirm")}</Btn>
  </div>}>
    <PromptField request={shown} value={val} onChange={setVal} onSubmit={submit} />
  </Modal>;
}

function subscribe(l: () => void): () => void {
  store.listeners.add(l);
  return () => store.listeners.delete(l);
}

export function ConfirmHost(): React.ReactNode {
  return createPortal(<>
      <ConfirmBody />
      <PromptHost />
    </>, document.body);
}

function ConfirmBody(): React.ReactNode {
  useLocale();
  const cur = useSyncExternalStore(subscribe, () => store.pending);
  const last = useRef<Pending | null>(null);
  if (cur) last.current = cur;
  const shown = cur ?? last.current;
  useOverlayBack("shared-confirm", Boolean(cur), () => answerConfirm(false));
  return <Modal open={!!cur} onClose={() => answerConfirm(false)} title={shown?.title !== undefined ? resolveMessage(shown.title) : t(shown?.danger ? "confirm.dangerTitle" : "confirm.title")} className={`shared-confirm-modal${shown?.danger ? " is-danger" : ""}`} size="sm" foot={<div className="shared-confirm-actions">
    <Btn variant="outline" onClick={() => answerConfirm(false)}>{shown?.cancelText !== undefined ? resolveMessage(shown.cancelText) : t("common.cancel")}</Btn>
    <Btn variant="solid" tone={shown?.danger ? "error" : "brand"} disabled={!cur} onClick={() => answerConfirm(true)}>{shown?.confirmText !== undefined ? resolveMessage(shown.confirmText) : t(shown?.danger ? "confirm.execute" : "common.confirm")}</Btn>
  </div>}>
    {shown?.danger ? <Banner tone="error" icon={<span className="shared-confirm-warning" aria-hidden="true">⚠</span>}><Text as="div" className="shared-confirm-message">{resolveMessage(shown.msg)}</Text></Banner> : <Text as="div" className="shared-confirm-message">{resolveMessage(shown?.msg)}</Text>}
  </Modal>;
}
