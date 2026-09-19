/**
 * 插件动态 tab 注册表（UI 自由化）——插件经 ctx.registerTab 在应用侧栏注册
 * 自己的功能页（pageKey = `plugin:<pluginId>:<tabId>`）；页面内容由插件在
 * 挂载容器内全权渲染（ui.getTabRoot / ui.onTabReady 拿 DOM）。
 * 插件停用/卸载时 unregisterPluginTabs 整体摘除。
 */

export interface PluginTabDef {
  /** 完整 pageKey：`plugin:<pluginId>:<tabId>` */
  pageKey: string;
  pluginId: string;
  title: string;
  /** 侧栏图标：inline SVG 字符串（16×16 视口；缺省用拼图占位） */
  iconSvg?: string;
  createdAt: number;
}

const tabs = new Map<string, PluginTabDef>();
const listeners = new Set<() => void>();
/** 快照缓存：useSyncExternalStore 的 getSnapshot 必须返回稳定引用，
 *  否则每次渲染都判定变更 → 无限重渲染（白屏教训） */
let snapCache: PluginTabDef[] = [];

/** tab 挂载容器（PluginTabHost 挂载时登记；切走时保留 DOM 引用不销毁） */
const roots = new Map<string, HTMLElement>();
const readyListeners = new Map<string, Set<(root: HTMLElement) => void>>();

function emit(): void {
  snapCache = [...tabs.values()];
  for (const l of listeners) l();
}

export function registerPluginTab(def: Omit<PluginTabDef, "createdAt">): void {
  tabs.set(def.pageKey, { ...def, createdAt: Date.now() });
  emit();
}

export function unregisterPluginTabs(pluginId: string): void {
  let changed = false;
  for (const [k, t] of tabs) {
    if (t.pluginId === pluginId) {
      tabs.delete(k);
      roots.delete(k);
      changed = true;
    }
  }
  if (changed) emit();
}

export function pluginTabsSnapshot(): PluginTabDef[] {
  return snapCache;
}

export function getPluginTab(pageKey: string): PluginTabDef | undefined {
  return tabs.get(pageKey);
}

export function subscribePluginTabs(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/* ── tab 挂载点 ── */

/** 最近一次插件渲染回调异常（宿主展示用；成功渲染后清除） */
export const lastTabError: { key: string; message: string } = { key: "", message: "" };

export function setTabRoot(pageKey: string, el: HTMLElement | null): void {
  if (el) {
    roots.set(pageKey, el);
    for (const cb of readyListeners.get(pageKey) ?? []) {
      try {
        cb(el);
        if (lastTabError.key === pageKey) {
          lastTabError.key = "";
          lastTabError.message = "";
        }
      } catch (e) {
        lastTabError.key = pageKey;
        lastTabError.message = e instanceof Error ? e.message : String(e);
        console.warn(`[PLUGIN] tab 渲染回调异常（${pageKey}）：`, e);
      }
    }
  } else {
    roots.delete(pageKey);
  }
}

export function getTabRoot(pageKey: string): HTMLElement | null {
  return roots.get(pageKey) ?? null;
}

/** 订阅 tab 容器就绪（已就绪则立即回调一次）；返回退订函数 */
export function onTabReady(pageKey: string, cb: (root: HTMLElement) => void): () => void {
  const existing = roots.get(pageKey);
  if (existing) {
    cb(existing);
  }
  let set = readyListeners.get(pageKey);
  if (!set) {
    set = new Set();
    readyListeners.set(pageKey, set);
  }
  set.add(cb);
  return () => {
    set?.delete(cb);
  };
}
