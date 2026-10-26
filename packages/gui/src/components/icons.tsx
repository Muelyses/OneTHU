/* ════════════════════════════════════════════════════════════════════════════
 * OneGUI · 图标集（自绘线性图标，24 网格，currentColor）
 *
 * 整表平移自 apps/desktop/src/components/Icons.tsx（用户拍板的设计）：图形孩子逐字照抄，
 * 不重画、不"改进"。尺寸与描边交给 <Icon> 壳 / CSS 令牌（.og-icon、--og-icon-*），
 * 图标本体只报 size / className / title，不落几何与描边属性、不落内联样式。
 * 两枚非 24 网格的图标（IconPin 16 网格、IconFist 72 网格）用 viewBox 声明自己的坐标系。
 * ══════════════════════════════════════════════════════════════════════════ */
import type { ReactNode } from "react";
import { Icon, type IconSize } from "./chip.js";

/** 图标通用入参：尺寸走壳（sm | md | lg | xl），描边由 CSS 令牌决定，图形不可覆盖 */
export interface IconGlyphProps {
  size?: IconSize;
  className?: string;
  /** 有语义时给标题（壳据此 role="img"）；纯装饰留空（壳挂 aria-hidden） */
  title?: string;
}

export function IconToday({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <path d="M3 6h18M3 12h18M3 18h11" />
      <circle cx="19.4" cy="18" r="1.4" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function IconLearn({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15.5H6.5A2.5 2.5 0 0 0 4 21z" />
      <path d="M20 18.5H6.5A2.5 2.5 0 0 0 4 21" />
    </Icon>
  );
}

export function IconSchedule({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <rect x="3.5" y="5" width="17" height="16" rx="1.5" />
      <path d="M3.5 10h17M8 2.5V6.5M16 2.5V6.5" />
    </Icon>
  );
}

/** 我的：头像轮廓，避免将个人中心误认成设置。 */
export function IconUser({ size, className, title }: IconGlyphProps): ReactNode {
  return <Icon size={size} className={className} title={title}><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></Icon>;
}

export function IconSettings({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      {/* 真齿轮（heroicons cog，stroke 风格）——旧版「圆心+放射线」被用户认成太阳，2026-10-12 拍板换掉 */}
      <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <circle cx="12" cy="12" r="3" />
    </Icon>
  );
}

export function IconRefresh({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <path d="M20 11a8 8 0 1 0-2.3 6.3M20 5v6h-6" />
    </Icon>
  );
}

export function IconLogout({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <path d="M14 4h4.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14M10 8l-4 4 4 4M6 12h10" />
    </Icon>
  );
}

export function IconFile({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <path d="M6 2.5h8L19 8v13.5H6z" />
      <path d="M13.5 3v5.5H19" />
    </Icon>
  );
}

export function IconBell({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <path d="M6 16v-5.5a6 6 0 0 1 12 0V16l1.5 2.5h-15z" />
      <path d="M10 21h4" />
    </Icon>
  );
}

export function IconPen({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <path d="m14.5 5 4.5 4.5L8 20.5l-5 1 1-5z" />
      <path d="m12.5 7 4.5 4.5" />
    </Icon>
  );
}

export function IconCamera({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h1.2a1.5 1.5 0 0 0 1.28-.72l.54-.9A1.5 1.5 0 0 1 9.8 4.6h4.4a1.5 1.5 0 0 1 1.28.72l.54.9A1.5 1.5 0 0 0 17.3 7h1.2A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5z" />
      <circle cx="12" cy="12.8" r="3.2" />
    </Icon>
  );
}

export function IconImage({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="1.8" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m4.5 18 5-5 3.2 3.2 2.6-2.6 4.2 4.4" />
    </Icon>
  );
}

export function IconUpload({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <path d="M12 16V5" />
      <path d="m7 10 5-5 5 5" />
      <path d="M5 19h14" />
    </Icon>
  );
}

export function IconCloud({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <path d="M17.5 19a4.5 4.5 0 0 0 .4-8.98A7 7 0 0 0 4.3 12.1 4 4 0 0 0 6 19.9h11.5Z" />
    </Icon>
  );
}

export function IconBook({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
    </Icon>
  );
}

export function IconGitLab({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <path d="M12 21.5 3.6 9.9l1.6-6.4 2.6 4h8.4l2.6-4 1.6 6.4Z" />
      <path d="M7.8 7.5 12 21.5l4.2-14" />
    </Icon>
  );
}

export function IconMail({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </Icon>
  );
}

export function IconIn({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <path d="M12 3v10.5M7.5 9.5 12 14l4.5-4.5" />
      <path d="M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V17" />
    </Icon>
  );
}

/** 收纳箱：常驻入口用盒盖与把手，和「存入」动作的向下箭头区分。 */
export function IconVault({ size, className, title }: IconGlyphProps): ReactNode {
  return <Icon size={size} className={className} title={title}>
    <rect x="3" y="4" width="18" height="5" rx="1.5" />
    <path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M9 13h6" />
  </Icon>;
}

export function IconCheck({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <path d="m4.5 12.5 5 5L19.5 7" />
    </Icon>
  );
}

export function IconChevron({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <path d="m9 5 7 7-7 7" />
    </Icon>
  );
}

export function IconSearch({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </Icon>
  );
}

export function IconTrace({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <path d="M12 21s-6.5-5.2-6.5-10a6.5 6.5 0 0 1 13 0c0 4.8-6.5 10-6.5 10Z" />
      <circle cx="12" cy="10.6" r="2.3" />
      <path d="M19 16.5c1.6.6 2.5 1.4 2.5 2.3 0 1.7-4.3 3-9.5 3" strokeDasharray="0" />
    </Icon>
  );
}

export function IconCalendar({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <rect x="3.5" y="5" width="17" height="16" rx="1.5" />
      <path d="M3.5 10h17M8 2.5V6.5M16 2.5V6.5" />
    </Icon>
  );
}

export function IconDownload({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <path d="M12 3v11M7.5 10 12 14.5 16.5 10" />
      <path d="M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V17" />
    </Icon>
  );
}

export function IconFlag({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
    </Icon>
  );
}

/** 选课：勾选靶标（圆 + 对勾） */
export function IconXk({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <circle cx="12" cy="12" r="8" />
      <path d="M8.5 12.5l2.5 2.5 4.5-5" />
    </Icon>
  );
}

/** 在线服务（THOS 服务大厅）：四格服务窗格 */
export function IconThos({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <rect x="4" y="4" width="6.6" height="6.6" rx="1.4" />
      <rect x="13.4" y="4" width="6.6" height="6.6" rx="1.4" />
      <rect x="4" y="13.4" width="6.6" height="6.6" rx="1.4" />
      <path d="M16.7 13.9v5.6M13.9 16.7h5.6" />
    </Icon>
  );
}

export function IconWrench({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </Icon>
  );
}

export function IconPalette({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
      <circle cx="13.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="17.5" cy="10.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="7.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="6.5" cy="12.5" r="1" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function IconHelpCircle({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </Icon>
  );
}

export function IconInfo({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <circle cx="8.5" cy="10.5" r="1.8" />
      <path d="M6 16c.7-1.6 1.9-2.2 3-2.2s2.3.6 3 2.2M14.5 9.5h4M14.5 12.5h4M14.5 15.5h4" />
    </Icon>
  );
}

/** 标签页图标（explorer 底栏）：前卡 + 后卡层叠 */
export function IconTabsCards({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <rect x="7.5" y="4" width="12.5" height="10" rx="1.9" />
      <path d="M4 9.5v6.9A2.1 2.1 0 0 0 6.1 18.5H14" />
    </Icon>
  );
}

/** 太阳（天气） */
export function IconSun({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6" />
    </Icon>
  );
}

/** 垃圾桶（球目录拖拽删除区等） */
export function IconTrash({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <path d="M4 7h16M9.5 7V4.8A1.3 1.3 0 0 1 10.8 3.5h2.4a1.3 1.3 0 0 1 1.3 1.3V7M6.5 7l.8 12.2A1.8 1.8 0 0 0 9.1 20.8h5.8a1.8 1.8 0 0 0 1.8-1.6L17.5 7" />
      <path d="M10 11v6M14 11v6" />
    </Icon>
  );
}

/** 复制当前标签页（explorer 顶栏「复制」钮）：双层方框 */
export function IconCopyTab({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 5V4.5A1.5 1.5 0 0 0 14.5 3H5.5A1.5 1.5 0 0 0 4 4.5v8A1.5 1.5 0 0 0 5.5 14H6" />
    </Icon>
  );
}

/** 竖版侧栏宽窄切换（一条竖线把方框分成左栏） */
export function IconSidebarRail({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M9 4v16" />
    </Icon>
  );
}

export function IconCard({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <path d="M3 10h18M6.5 14.5h4" />
    </Icon>
  );
}

export function IconExternal({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <path d="M13.5 5H19v5.5M19 5l-8 8" />
      <path d="M18 14.5v4A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6h4" />
    </Icon>
  );
}

/** 收藏夹（用户收藏夹/子收藏夹通用标识） */
export function IconFolder({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4l2 2.5h8A1.5 1.5 0 0 1 20.5 9v9A1.5 1.5 0 0 1 19 19.5H5A1.5 1.5 0 0 1 3.5 18z" />
    </Icon>
  );
}

/** 新建收藏夹（文件夹 + 加号） */
export function IconFolderPlus({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4l2 2.5h8A1.5 1.5 0 0 1 20.5 9v9A1.5 1.5 0 0 1 19 19.5H5A1.5 1.5 0 0 1 3.5 18z" />
      <path d="M12 10.5v5M9.5 13h5" />
    </Icon>
  );
}

/** 收藏星标（CollectStar 用；fill 由调用方以 CSS 控制） */
export function IconPin({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title} viewBox="0 0 16 16">
      {/* 图钉（pushpin）：钉帽 + 钉身 + 针尖，避免与星号混淆 */}
      <path d="M9.6 1.6h4.8v1.6l-1.6 1.6v3.2L10.4 10.4H5.6L3.2 8V4.8L1.6 3.2V1.6z" />
      <path d="M8 10.4v4" />
    </Icon>
  );
}

export function IconStar({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <path d="m12 3.6 2.5 5.2 5.7.7-4.2 3.9 1.1 5.6-5.1-2.8-5.1 2.8 1.1-5.6-4.2-3.9 5.7-.7z" />
    </Icon>
  );
}

export function IconPlug({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <path d="M9 7.2V3.4M15 7.2V3.4M6.8 7.2h10.4v3.9a5.2 5.2 0 0 1-5.2 5.2 5.2 5.2 0 0 1-5.2-5.2V7.2ZM12 16.3v4.3" />
    </Icon>
  );
}

export function IconPlus({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  );
}

/** 缩小（画布缩放控件）：与 IconPlus 同一套 24 网格与描边，只有一横 */
export function IconMinus({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <path d="M5 12h14" />
    </Icon>
  );
}

export function IconClock({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </Icon>
  );
}

/* OneGO 品牌标（dev-explorer 定稿）：👊 单色拳——path 取自 OpenMoji black U+1F44A（CC BY-SA 4.0，
   72 网格 stroke 单色），stroke 染 currentColor 与全库同语言。 */
export function IconFist({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title} viewBox="0 0 72 72">
      <path d="m41.94 37.24v7.074c-0.3346 2.512 1.428 4.82 3.936 5.156 2.509 0.3352 4.813-1.43 5.148-3.942 0.0536-0.4028 0.0536-0.8107 0-1.213l-5.19e-4 -20.48c0.3346-2.512-1.428-4.82-3.936-5.156s-4.813 1.43-5.148 3.942v1.301c0.3346-2.512-1.428-4.82-3.936-5.156s-4.813 1.43-5.148 3.942v2.427c0.3346-2.512-1.428-4.82-3.936-5.156s-4.813 1.43-5.148 3.942c-0.02619 0.8746-0.02488 1.613-0.08098 2.513 0.3346-2.512-1.428-4.82-3.936-5.156s-4.813 1.43-5.148 3.942c-0.0536 0.4028-0.0536 0.8107-0.02011 1.214l0.02064 11.19c-0.3346 2.512 1.428 4.82 3.936 5.156 2.509 0.3352 4.813-1.43 5.148-3.942 0.0536-0.4028 0.0536-0.8107 0-1.213v-1.341l0.04022-3.517-0.04023 11.27c-0.3346 2.512 1.428 4.82 3.936 5.156s4.813-1.43 5.148-3.942c0.0536-0.4028 0.0536-3.548 0-3.951v-5.012l-0.04075-4.248 0.04075 14.6c-0.3346 2.512 1.428 4.82 3.936 5.156s4.813-1.43 5.148-3.942c0.0536-0.4028 0.0536-0.8107 0-1.213l0.08046-15.82z"/>
      <path d="m57.43 52.08c-0.2117 2.896-2.598 5.149-5.497 5.19h-12.98"/>
      <line x1="57.43" x2="57.43" y1="52.08" y2="33.52"/>
      <path d="m38.95 57.27c-2.625 0-7.445 0.6149-7.445-3.105"/>
      <path d="m57.43 33.52c0-1.938 0-4.201-2.049-4.201"/>
    </Icon>
  );
}

export function IconX({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <path d="M7 7l10 10M17 7l-10 10" />
    </Icon>
  );
}

/** 创造模式（OH 小窗工具条）：四芒星 + 一颗小伴星——「凭空变出东西」的图形语义 */
export function IconSpark({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <path d="M11 3.5l1.8 5.7 5.7 1.8-5.7 1.8L11 18.5l-1.8-5.7-5.7-1.8 5.7-1.8z" />
      <path d="M18.6 15.6l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" />
    </Icon>
  );
}

/** GitHub 标（品牌填充形，故单独覆盖 fill/stroke；16 号画布按 1.5 倍放到 24 网格） */
export function IconGithub({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <g transform="scale(1.5)" fill="currentColor" stroke="none">
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
      </g>
    </Icon>
  );
}

export function IconMenu({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </Icon>
  );
}

export function IconMore({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.7" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function IconArrowUp({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <path d="M12 19V5M5 12l7-7 7 7" />
    </Icon>
  );
}

/** 小喇叭（朗读这一条）：出声时两道声波由 `.dock-speak.is-on .dock-speak-wave` 呼吸 */
export function IconSpeak({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <path d="M11.4 5.2 6.9 8.6H4.3a1 1 0 0 0-1 1v4.8a1 1 0 0 0 1 1h2.6l4.5 3.4z" />
      <path className="dock-speak-wave" d="M15.2 9.4a4.2 4.2 0 0 1 0 5.2" />
      <path className="dock-speak-wave" d="M18.1 6.8a8.2 8.2 0 0 1 0 10.4" />
    </Icon>
  );
}

/** 小喇叭 + 斜杠（当前静音）：与 IconSpeak 同一副喇叭，只是没声波 */
export function IconSpeakOff({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <path d="M11.4 5.2 6.9 8.6H4.3a1 1 0 0 0-1 1v4.8a1 1 0 0 0 1 1h2.6l4.5 3.4z" />
      <path d="M15.4 9.6l4.2 4.8" />
    </Icon>
  );
}

/** 悬浮球（需求 5 的入口）：小球 + 一圈虚线轨道 */
export function IconOrb({ size, className, title }: IconGlyphProps): ReactNode {
  return (
    <Icon size={size} className={className} title={title}>
      <circle cx="12" cy="12" r="5.8" />
      <circle cx="12" cy="12" r="2.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="9.6" strokeDasharray="1.2 3.2" opacity="0.55" />
    </Icon>
  );
}

/* ── 收藏夹图标库（FavFolder.icon 是持久化键名；未知键回退默认文件夹） ── */

export const FOLDER_ICONS: Record<string, (props: IconGlyphProps) => ReactNode> = {
  folder: IconFolder,
  fist: IconFist,
  star: IconStar,
  pin: IconPin,
  today: IconToday,
  learn: IconLearn,
  schedule: IconSchedule,
  pen: IconPen,
  check: IconCheck,
  flag: IconFlag,
  calendar: IconCalendar,
  bell: IconBell,
  file: IconFile,
  search: IconSearch,
  info: IconInfo,
  card: IconCard,
  refresh: IconRefresh,
  external: IconExternal,
  xk: IconXk,
  thos: IconThos,
  download: IconDownload,
  inbox: IconIn,
};

/** 按持久化键名取收藏夹图标（name 为空或未知 → IconFolder） */
export function FolderIcon({ name, ...glyph }: { name?: string } & IconGlyphProps): ReactNode {
  const C = (name && FOLDER_ICONS[name]) || IconFolder;
  return <C {...glyph} />;
}

/* ── 注册表：画廊 / 检查器按导出名迭代（default 导出同物） ── */

export const ICONS: Record<string, (props: IconGlyphProps) => ReactNode> = {
  IconToday,
  IconLearn,
  IconSchedule,
  IconSettings,
  IconUser,
  IconRefresh,
  IconLogout,
  IconFile,
  IconBell,
  IconPen,
  IconCamera,
  IconImage,
  IconUpload,
  IconCloud,
  IconBook,
  IconGitLab,
  IconMail,
  IconIn,
  IconVault,
  IconCheck,
  IconChevron,
  IconSearch,
  IconTrace,
  IconCalendar,
  IconDownload,
  IconFlag,
  IconXk,
  IconThos,
  IconInfo,
  IconTabsCards,
  IconSun,
  IconTrash,
  IconCopyTab,
  IconSidebarRail,
  IconCard,
  IconExternal,
  IconFolder,
  IconFolderPlus,
  IconPin,
  IconStar,
  IconPlug,
  IconPlus,
  IconClock,
  IconFist,
  IconX,
  IconWrench,
  IconPalette,
  IconHelpCircle,
  IconSpark,
  IconGithub,
  IconMenu,
  IconMore,
  IconArrowUp,
  IconSpeak,
  IconSpeakOff,
  IconOrb,
};

export default ICONS;
