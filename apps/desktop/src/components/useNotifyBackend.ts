/**
 * 后端类型（android / macos / windows / none）的 React 订阅。
 *
 * 小组件相关入口只在 Android 显示，而这些入口散落在设置页与收藏夹页——探测本身
 * 由 notifySources 在启动时做一次并缓存，这里只负责把「探测完成」这件事变成重渲染。
 */
import { useEffect, useState } from "react";
import { currentNotifyBackend, subscribeNotifyBackend } from "../state/notifySources.js";

export function useNotifyBackend(): string {
  const [kind, setKind] = useState<string>(() => currentNotifyBackend());
  useEffect(() => subscribeNotifyBackend(() => setKind(currentNotifyBackend())), []);
  return kind;
}
