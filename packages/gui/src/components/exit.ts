/**
 * OneGUI · 浮层相位与宿主（内部工具，不对外导出）
 *
 * 退场动画必须有相位：open 变 false 时不能立刻卸载，否则"啪"地消失。
 * 旧的实现散在 lib/useExitPhase.ts + 各弹层里，现在只有这一份（EXIT_MS 与 --og-dur-2 同源）。
 */
import { useEffect, useRef, useState } from "react";

/** 默认退场时长（= --og-dur-2 200ms 档）：模态族传 --og-dur-3，锚定族传 --og-dur-2 */
export const EXIT_MS = 200;

export interface ExitPhase {
  /** 是否应该渲染节点（含退场期间） */
  mounted: boolean;
  /** 正在退场（用于挂 .is-closing） */
  closing: boolean;
}

export function useExitPhase(open: boolean, ms = EXIT_MS): ExitPhase {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (open) {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
      setMounted(true);
      setClosing(false);
      return;
    }
    if (!mounted) return;
    setClosing(true);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setClosing(false);
      setMounted(false);
    }, ms);
    return () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
    };
    // mounted 只在内部状态机里用，不进依赖，避免"关闭→重开"时相位抖动
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ms]);

  return { mounted, closing };
}

/* 注：浮层的 Portal / 焦点管理 / 滚动锁 / 落位算法都在 components/overlay.tsx
 * （那边有浮层栈：一次 Esc 只关最上面一层）。这里只保留退场相位这一个机制 ——
 * 同一件事只允许一份实现，这是 OneGUI 的契约。 */
