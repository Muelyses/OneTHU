/**
 * 预览数据层（霖 2026-10-12）。
 *
 * 抽屉里的组件预览渲染的是**真组件**，它们各自 useCard / useReport / useCampusData… 取数——
 * 于是"挑一个组件"这件小事会顺带把整套数据爬一遍（慢、且把真实数字显示在预览里）。
 *
 * 这里把示例数据**写进数据层缓存**（cacheSeedPreview：时间戳取远未来，各 hook 的 SWR 判定
 * 永不触发刷新，因此一次真实请求都不会发），预览子树挂载时 seed、卸载时还原。
 * 好处是组件代码与各 hook 一行不用改，且不会污染真实缓存与持久化数据。
 *
 * **先 seed 再挂载子节点**（关键）：子节点的 `useState(() => cacheGet(...))` 发生在**首次渲染**里，
 * 而 effect 的顺序是"子先父后"——若在父的普通 useEffect 里 seed，子节点首屏已经读到旧缓存、
 * 该发的请求也已经发了。所以这里先用 layout effect seed 并把 `ready` 置真，再渲染 children。
 */
import { useLayoutEffect, useState, type ReactNode } from "react";
import { seedPreviewData } from "../state/data.js";
import { setPreviewMode } from "../state/cache.js";

export function PreviewDataProvider({ children }: { children: ReactNode }): ReactNode {
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    setPreviewMode(true);
    /* 返回的还原函数即 cleanup：卸载时撤掉示例数据、放回原条目，并复位预览开关 */
    const restore = seedPreviewData();
    setReady(true);
    return () => {
      restore();
      setPreviewMode(false);
    };
  }, []);
  if (!ready) return null;
  return <>{children}</>;
}
