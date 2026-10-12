/** 内联线性图标 —— 1.6px 描边，墨色，克制 */
import type { ReactElement, SVGProps } from "react";

function base(props: SVGProps<SVGSVGElement>) {
  return {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...props,
  };
}

export const IconToday = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M3 6h18M3 12h18M3 18h11" />
    <circle cx="19.4" cy="18" r="1.4" fill="currentColor" stroke="none" />
  </svg>
);

export const IconLearn = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15.5H6.5A2.5 2.5 0 0 0 4 21z" />
    <path d="M20 18.5H6.5A2.5 2.5 0 0 0 4 21" />
  </svg>
);

export const IconSchedule = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="3.5" y="5" width="17" height="16" rx="1.5" />
    <path d="M3.5 10h17M8 2.5V6.5M16 2.5V6.5" />
  </svg>
);

export const IconSettings = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    {/* 真齿轮（heroicons cog，stroke 风格）——旧版「圆心+放射线」被用户认成太阳，2026-10-12 拍板换掉 */}
    <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const IconRefresh = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M20 11a8 8 0 1 0-2.3 6.3M20 5v6h-6" />
  </svg>
);

export const IconLogout = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M14 4h4.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14M10 8l-4 4 4 4M6 12h10" />
  </svg>
);

export const IconFile = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M6 2.5h8L19 8v13.5H6z" />
    <path d="M13.5 3v5.5H19" />
  </svg>
);

export const IconBell = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M6 16v-5.5a6 6 0 0 1 12 0V16l1.5 2.5h-15z" />
    <path d="M10 21h4" />
  </svg>
);

export const IconPen = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="m14.5 5 4.5 4.5L8 20.5l-5 1 1-5z" />
    <path d="m12.5 7 4.5 4.5" />
  </svg>
);

export const IconCamera = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h1.2a1.5 1.5 0 0 0 1.28-.72l.54-.9A1.5 1.5 0 0 1 9.8 4.6h4.4a1.5 1.5 0 0 1 1.28.72l.54.9A1.5 1.5 0 0 0 17.3 7h1.2A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5z" />
    <circle cx="12" cy="12.8" r="3.2" />
  </svg>
);

export const IconImage = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="1.8" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="m4.5 18 5-5 3.2 3.2 2.6-2.6 4.2 4.4" />
  </svg>
);

export const IconUpload = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 16V5" />
    <path d="m7 10 5-5 5 5" />
    <path d="M5 19h14" />
  </svg>
);

export const IconCloud = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M17.5 19a4.5 4.5 0 0 0 .4-8.98A7 7 0 0 0 4.3 12.1 4 4 0 0 0 6 19.9h11.5Z" />
  </svg>
);

export const IconBook = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
  </svg>
);

export const IconGitLab = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 21.5 3.6 9.9l1.6-6.4 2.6 4h8.4l2.6-4 1.6 6.4Z" />
    <path d="M7.8 7.5 12 21.5l4.2-14" />
  </svg>
);

export const IconMail = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3 7 9 6 9-6" />
  </svg>
);

export const IconIn = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 3v10.5M7.5 9.5 12 14l4.5-4.5" />
    <path d="M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V17" />
  </svg>
);

export const IconCheck = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="m4.5 12.5 5 5L19.5 7" />
  </svg>
);

export const IconChevron = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="m9 5 7 7-7 7" />
  </svg>
);

export const IconSearch = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </svg>
);

export const IconTrace = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 21s-6.5-5.2-6.5-10a6.5 6.5 0 0 1 13 0c0 4.8-6.5 10-6.5 10Z" />
    <circle cx="12" cy="10.6" r="2.3" />
    <path d="M19 16.5c1.6.6 2.5 1.4 2.5 2.3 0 1.7-4.3 3-9.5 3" strokeDasharray="0" />
  </svg>
);

export const IconCalendar = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="3.5" y="5" width="17" height="16" rx="1.5" />
    <path d="M3.5 10h17M8 2.5V6.5M16 2.5V6.5" />
  </svg>
);

export const IconDownload = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 3v11M7.5 10 12 14.5 16.5 10" />
    <path d="M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V17" />
  </svg>
);

export const IconFlag = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
  </svg>
);

/** 选课：勾选靶标（圆 + 对勾） */
export const IconXk = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8" />
    <path d="M8.5 12.5l2.5 2.5 4.5-5" />
  </svg>
);

/** 在线服务（THOS 服务大厅）：四格服务窗格 */
export const IconThos = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="4" y="4" width="6.6" height="6.6" rx="1.4" />
    <rect x="13.4" y="4" width="6.6" height="6.6" rx="1.4" />
    <rect x="4" y="13.4" width="6.6" height="6.6" rx="1.4" />
    <path d="M16.7 13.9v5.6M13.9 16.7h5.6" />
  </svg>
);

export const IconInfo = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="3" y="4.5" width="18" height="15" rx="2" />
    <circle cx="8.5" cy="10.5" r="1.8" />
    <path d="M6 16c.7-1.6 1.9-2.2 3-2.2s2.3.6 3 2.2M14.5 9.5h4M14.5 12.5h4M14.5 15.5h4" />
  </svg>
);

/** 标签页图标（explorer 底栏）：前卡 + 后卡层叠 */
export const IconTabsCards = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="7.5" y="4" width="12.5" height="10" rx="1.9" />
    <path d="M4 9.5v6.9A2.1 2.1 0 0 0 6.1 18.5H14" />
  </svg>
);

/** 复制当前标签页（explorer 顶栏「复制」钮）：双层方框 */
export const IconCopyTab = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 5V4.5A1.5 1.5 0 0 0 14.5 3H5.5A1.5 1.5 0 0 0 4 4.5v8A1.5 1.5 0 0 0 5.5 14H6" />
  </svg>
);

/** 竖版侧栏宽窄切换（一条竖线把方框分成左栏） */
export const IconSidebarRail = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="M9 4v16" />
  </svg>
);

export const IconCard = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="3" y="5.5" width="18" height="13" rx="2" />
    <path d="M3 10h18M6.5 14.5h4" />
  </svg>
);

export const IconExternal = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M13.5 5H19v5.5M19 5l-8 8" />
    <path d="M18 14.5v4A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6h4" />
  </svg>
);

/** 收藏夹（用户收藏夹/子收藏夹通用标识） */
export const IconFolder = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4l2 2.5h8A1.5 1.5 0 0 1 20.5 9v9A1.5 1.5 0 0 1 19 19.5H5A1.5 1.5 0 0 1 3.5 18z" />
  </svg>
);

/** 新建收藏夹（文件夹 + 加号） */
export const IconFolderPlus = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4l2 2.5h8A1.5 1.5 0 0 1 20.5 9v9A1.5 1.5 0 0 1 19 19.5H5A1.5 1.5 0 0 1 3.5 18z" />
    <path d="M12 10.5v5M9.5 13h5" />
  </svg>
);

/** 收藏星标（CollectStar 用；fill 由调用方以 CSS 控制） */
export const IconPin = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" {...p}>
    {/* 图钉（pushpin）：钉帽 + 钉身 + 针尖，避免与星号混淆 */}
    <path d="M9.6 1.6h4.8v1.6l-1.6 1.6v3.2L10.4 10.4H5.6L3.2 8V4.8L1.6 3.2V1.6z" />
    <path d="M8 10.4v4" />
  </svg>
);

export const IconStar = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="m12 3.6 2.5 5.2 5.7.7-4.2 3.9 1.1 5.6-5.1-2.8-5.1 2.8 1.1-5.6-4.2-3.9 5.7-.7z" />
  </svg>
);

/* ══════════ 收藏夹图标库（FavFolder.icon 键名持久化；未知键回退默认文件夹） ══════════ */

export const FOLDER_ICONS: Record<string, (p: SVGProps<SVGSVGElement>) => ReactElement> = {
  folder: IconFolder,
  fist: (p) => <IconFist {...p} />,
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

export const IconPlug = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M9 7.2V3.4M15 7.2V3.4M6.8 7.2h10.4v3.9a5.2 5.2 0 0 1-5.2 5.2 5.2 5.2 0 0 1-5.2-5.2V7.2ZM12 16.3v4.3" />
  </svg>
);
export const IconPlus = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconClock = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 3" />
  </svg>
);


/* OneGO 品牌标（dev-explorer 定稿）：👊 单色拳——path 取自 OpenMoji black U+1F44A（CC BY-SA 4.0，
   72 网格 stroke 单色），stroke 染 currentColor 与全库同语言。 */
export const IconFist = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 72 72" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="m41.94 37.24v7.074c-0.3346 2.512 1.428 4.82 3.936 5.156 2.509 0.3352 4.813-1.43 5.148-3.942 0.0536-0.4028 0.0536-0.8107 0-1.213l-5.19e-4 -20.48c0.3346-2.512-1.428-4.82-3.936-5.156s-4.813 1.43-5.148 3.942v1.301c0.3346-2.512-1.428-4.82-3.936-5.156s-4.813 1.43-5.148 3.942v2.427c0.3346-2.512-1.428-4.82-3.936-5.156s-4.813 1.43-5.148 3.942c-0.02619 0.8746-0.02488 1.613-0.08098 2.513 0.3346-2.512-1.428-4.82-3.936-5.156s-4.813 1.43-5.148 3.942c-0.0536 0.4028-0.0536 0.8107-0.02011 1.214l0.02064 11.19c-0.3346 2.512 1.428 4.82 3.936 5.156 2.509 0.3352 4.813-1.43 5.148-3.942 0.0536-0.4028 0.0536-0.8107 0-1.213v-1.341l0.04022-3.517-0.04023 11.27c-0.3346 2.512 1.428 4.82 3.936 5.156s4.813-1.43 5.148-3.942c0.0536-0.4028 0.0536-3.548 0-3.951v-5.012l-0.04075-4.248 0.04075 14.6c-0.3346 2.512 1.428 4.82 3.936 5.156s4.813-1.43 5.148-3.942c0.0536-0.4028 0.0536-0.8107 0-1.213l0.08046-15.82z"/>
    <path d="m57.43 52.08c-0.2117 2.896-2.598 5.149-5.497 5.19h-12.98"/>
    <line x1="57.43" x2="57.43" y1="52.08" y2="33.52"/>
    <path d="m38.95 57.27c-2.625 0-7.445 0.6149-7.445-3.105"/>
    <path d="m57.43 33.52c0-1.938 0-4.201-2.049-4.201"/>
  </svg>
);

export const IconX = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M7 7l10 10M17 7l-10 10" />
  </svg>
);

/** GitHub 标（品牌填充形，故单独覆盖 fill/stroke；16 号画布按 1.5 倍放到 24 网格） */
export const IconGithub = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ fill: "currentColor", stroke: "none", ...p })}>
    <g transform="scale(1.5)">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </g>
  </svg>
);
export const IconMenu = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);

export const IconMore = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1.7" fill="currentColor" stroke="none" />
  </svg>
);

export const IconArrowUp = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
);



/* ── 对话坞使用（ball-ui）：朗读 / 静音 / 悬浮球 ── */

/** 小喇叭（朗读这一条）：出声时两道声波由 `.dock-speak.is-on .dock-speak-wave` 呼吸 */
export const IconSpeak = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M11.4 5.2 6.9 8.6H4.3a1 1 0 0 0-1 1v4.8a1 1 0 0 0 1 1h2.6l4.5 3.4z" />
    <path className="dock-speak-wave" d="M15.2 9.4a4.2 4.2 0 0 1 0 5.2" />
    <path className="dock-speak-wave" d="M18.1 6.8a8.2 8.2 0 0 1 0 10.4" />
  </svg>
);

/** 小喇叭 + 斜杠（当前静音）：与 IconSpeak 同一副喇叭，只是没声波 */
export const IconSpeakOff = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M11.4 5.2 6.9 8.6H4.3a1 1 0 0 0-1 1v4.8a1 1 0 0 0 1 1h2.6l4.5 3.4z" />
    <path d="M15.4 9.6l4.2 4.8" />
  </svg>
);

/** 悬浮球（需求 5 的入口）：小球 + 一圈虚线轨道 */
export const IconOrb = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="5.8" />
    <circle cx="12" cy="12" r="2.1" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="9.6" strokeDasharray="1.2 3.2" opacity="0.55" />
  </svg>
);

export function FolderIcon({ name, ...rest }: { name?: string } & SVGProps<SVGSVGElement>) {
  const C = (name && FOLDER_ICONS[name]) || IconFolder;
  return <C {...rest} />;
}
