/* ════════════════════════════════════════════════════════════════════════════
 * OneGUI · React 接线层
 *
 * 组件与页面读轴、读 scope、改轴，全走这几个入口 —— 不允许直接碰 document 属性。
 * ══════════════════════════════════════════════════════════════════════════ */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode,
} from "react";
import { og, installOneGUI, type OGAxes, type OGScopeSpec, type OGTheme, type StyleDirector } from "./director.js";

interface OGContextValue {
  director: StyleDirector;
}

const OGContext = createContext<OGContextValue>({ director: og });

export interface OneGUIProviderProps {
  children: ReactNode;
  /** 首次安装的轴（之后再改走 useOneGUI().set） */
  initial?: Partial<OGAxes>;
  /** 主题（强调色）—— 应用把已有主题系统转成这个形状喂进来 */
  theme?: OGTheme | string | null;
  /** 明暗跟随系统变化 */
  watchSystemScheme?: boolean;
  /** 平台判定（宿主自己的断点/触屏逻辑） */
  platform?: () => "desktop" | "mobile";
  /** 存档（默认 localStorage） */
  storage?: { getItem(k: string): string | null; setItem(k: string, v: string): void } | null;
}

export function OneGUIProvider({ children, initial, theme, watchSystemScheme, platform, storage }: OneGUIProviderProps): ReactNode {
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    const dispose = installOneGUI({ initial, watchSystemScheme, platform, storage });
    return dispose;
    // 只装一次：轴的后续变更走 director.set()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (theme !== undefined) og.set({ theme }, { persist: false });
  }, [theme]);
  const value = useMemo<OGContextValue>(() => ({ director: og }), []);
  return <OGContext.Provider value={value}>{children}</OGContext.Provider>;
}

/** 拿管线本体（改轴、登记 scope、订阅） */
export function useOneGUI(): StyleDirector {
  return useContext(OGContext).director;
}

/** 读轴快照（只有轴变化才重渲染） */
export function useAxes(): Readonly<OGAxes> {
  const director = useOneGUI();
  return useSyncExternalStore(
    useCallback((fn) => director.subscribe(fn), [director]),
    useCallback(() => director.axes(), [director]),
    useCallback(() => director.axes(), [director]),
  );
}

/** 已解析明暗（auto 已落地成 light/dark） */
export function useScheme(): "light" | "dark" {
  const director = useOneGUI();
  const axes = useAxes();
  return useMemo(() => director.resolvedScheme(), [director, axes]);
}

export interface ScopeProps {
  /** 在管线里登记过的 scope 名；未登记时退化为普通 div（不报错，方便渐进迁移） */
  name: string;
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "li" | "td" | "span";
  /** 语义标签：section/li 之外默认 div */
  style?: never;
}

/**
 * 特殊要求的唯一入口：<Scope name="cloud.fileCard"> 之后，子树里的组件读到的是该 scope 的令牌。
 * scope 的取值由 defineScope() 在管线里登记，选项受枚举约束 —— 页面拿不到"随便写样式"的能力。
 */
export function Scope({ name, children, className, as: Tag = "div" }: ScopeProps): ReactNode {
  const director = useOneGUI();
  const spec: OGScopeSpec | undefined = director.scope(name);
  return (
    <Tag data-og-scope={spec ? name : undefined} className={className}>
      {children}
    </Tag>
  );
}

/** 组件内部用的 scope 令牌读取（供需要把 scope 值再往下传的复合组件） */
export function useScopeSpec(name?: string): OGScopeSpec | undefined {
  const director = useOneGUI();
  return name ? director.scope(name) : undefined;
}
