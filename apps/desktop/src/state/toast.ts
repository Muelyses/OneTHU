import { useEffect, useState } from "react";
/** 全局轻提示（原子操作反馈用）：单条覆盖式，2.8s 自动消失 */
let current: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<(m: string | null) => void>();
function emit(): void {
  listeners.forEach((fn) => fn(current));
}
/**
 * 静音区间：后台任务（推小组件快照等）会在「非用户操作」上下文中复用交互函数，
 * 那些函数可能弹提示；进静音区后提示被丢弃，避免用户莫名看到一句反馈。
 */
let muted = false;
export function muteToasts<T>(fn: () => T): T {
  const prev = muted;
  muted = true;
  try {
    return fn();
  } finally {
    muted = prev;
  }
}
export function showToast(text: string): void {
  if (muted) return;
  current = text;
  if (timer) clearTimeout(timer);
  emit();
  timer = setTimeout(() => {
    current = null;
    emit();
  }, 2800);
}
export function hideToast(): void {
  current = null;
  if (timer) clearTimeout(timer);
  emit();
}
export function useToastHost(): string | null {
  const [msg, setMsg] = useState<string | null>(current);
  useEffect(() => {
    listeners.add(setMsg);
    return () => {
      listeners.delete(setMsg);
    };
  }, []);
  return msg;
}
