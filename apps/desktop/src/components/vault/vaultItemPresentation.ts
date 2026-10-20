import type { VaultCatch } from "../../state/vault.js";

/** Shared 24 × 24 stroke paths for React cards and the pointer-following DOM ghost. */
export const VAULT_ICON_PATHS: Record<string, string> = {
  file: "M6 2.5h8L19 8v13.5H6z M13.5 3v5.5H19",
  text: "M5 5h14M5 10h14M5 15h14M5 20h9",
  image: "M5.3 4.5h13.4a1.8 1.8 0 0 1 1.8 1.8v11.4a1.8 1.8 0 0 1-1.8 1.8H5.3a1.8 1.8 0 0 1-1.8-1.8V6.3a1.8 1.8 0 0 1 1.8-1.8Z M10.6 10a1.6 1.6 0 1 1-3.2 0 1.6 1.6 0 0 1 3.2 0 M4.5 18l5-5 3.2 3.2 2.6-2.6 4.2 4.4",
  video: "M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z M10 8l6 4-6 4Z",
  audio: "M9 17V5l11-2v12 M9 7l11-2 M9 17a3 2.5 0 1 1-6 0 3 2.5 0 0 1 6 0 M20 15a3 2.5 0 1 1-6 0 3 2.5 0 0 1 6 0",
  archive: "M4 3h16v5H4Z M5 8v13h14V8 M10 12h4",
  table: "M3 4h18v16H3Z M3 9h18M9 9v11M15 9v11M3 15h18",
  slides: "M3 4h18v13H3Z M12 17v4M8 21h8M7 12l3-3 3 2 4-4",
  code: "M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16",
  folder: "M3.5 6.5A1.5 1.5 0 0 1 5 5h4l2 2.5h8A1.5 1.5 0 0 1 20.5 9v9A1.5 1.5 0 0 1 19 19.5H5A1.5 1.5 0 0 1 3.5 18Z",
  board: "M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z M8 4v16M8 11h13",
  workspace: "M3 4h13v12H3Z M8 20h13V9",
  calendar: "M5 5h14a1.5 1.5 0 0 1 1.5 1.5v13A1.5 1.5 0 0 1 19 21H5a1.5 1.5 0 0 1-1.5-1.5v-13A1.5 1.5 0 0 1 5 5Z M3.5 10h17M8 2.5v4M16 2.5v4",
  card: "M5 5.5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z M10 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0 M5 16a3 3 0 0 1 6 0 M14 10h4M14 14h4",
  organization: "M9 3h6v5H9Z M3 16h6v5H3Z M15 16h6v5h-6Z M12 8v4M6 16v-4h12v4",
  book: "M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15.5H6.5A2.5 2.5 0 0 0 4 21Z M20 18.5H6.5A2.5 2.5 0 0 0 4 21",
  mail: "M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z M3 7l9 6 9-6",
  bell: "M6 16v-5.5a6 6 0 0 1 12 0V16l1.5 2.5h-15Z M10 21h4",
  gitlab: "M12 21.5 3.6 9.9l1.6-6.4 2.6 4h8.4l2.6-4 1.6 6.4Z M7.8 7.5 12 21.5l4.2-14",
  cloud: "M17.5 19a4.5 4.5 0 0 0 .4-8.98A7 7 0 0 0 4.3 12.1 4 4 0 0 0 6 19.9h11.5Z",
  theme: "M20 12a8 8 0 1 1-8-8v16M12 4a8 8 0 0 1 8 8",
  plugin: "M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0Z M12 17v4",
  location: "M12 21s-6.5-5.2-6.5-10a6.5 6.5 0 0 1 13 0c0 4.8-6.5 10-6.5 10Z M14.3 10.6a2.3 2.3 0 1 1-4.6 0 2.3 2.3 0 0 1 4.6 0",
  link: "M13.5 5H19v5.5M19 5l-8 8 M18 14.5v4a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6h4",
  check: "M4.5 12.5l5 5L19.5 7",
  inbox: "M12 3v10.5M7.5 9.5 12 14l4.5-4.5 M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V17",
};

export interface VaultItemPresentation {
  /** Type label; the caller displays the item's original title separately. */
  label: string;
  detail: string;
  icon: string;
  /** The actual filename extension, never an invented preview or MIME inference. */
  badge?: string;
}

type Kind = readonly [label: string, icon: string];
const ATOM_KINDS: Record<string, Kind> = {
  course: ["课程", "book"], "courseX-c": ["课程", "book"], assignment: ["作业", "check"],
  file: ["课程文件", "file"], notice: ["课程通知", "bell"], mail: ["邮件", "mail"],
  news: ["新闻", "text"], "news-src": ["新闻订阅", "text"], folder: ["收藏夹", "folder"],
  widget: ["组件", "board"], action: ["操作", "check"], forum: ["论坛", "text"], "bbs-board": ["版面", "text"],
  "gitlab-proj": ["GitLab 项目", "gitlab"], "gitlab-issue": ["GitLab 议题", "gitlab"], "gitlab-mr": ["合并请求", "gitlab"],
  library: ["图书馆", "book"], "library-a": ["图书馆区域", "book"], "library-f": ["图书馆楼层", "book"],
  "classroom-b": ["教学楼", "location"], "classroom-r": ["教室", "location"], "libroom-k": ["研讨间", "location"],
  "kj-space": ["公共空间", "location"], "kj-room": ["房间", "location"], "sports-v": ["体育场馆", "location"],
  "washer-b": ["洗衣楼栋", "location"], "washer-m": ["洗衣机", "inbox"],
  "thos-service": ["校内服务", "link"], infoapp: ["Info 应用", "link"],
};
const PAYLOAD_KINDS: Record<string, Kind> = {
  "cloud-folder": ["云盘文件夹", "folder"], "cloud-file": ["云盘文件", "cloud"],
  schedule: ["日程", "calendar"], namecard: ["个人名片", "card"], workspace: ["工作区", "workspace"],
  "gitlab-project": ["GitLab 项目", "gitlab"], theme: ["主题", "theme"], wallpaper: ["壁纸", "image"],
  plugin: ["插件", "plugin"], "learn-notice": ["课程通知", "bell"],
  "learn-attachment": ["课程附件", "file"], "news-file": ["新闻附件", "file"],
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 120) : "";
}
function lookup(kinds: Record<string, Kind>, key: string): Kind | undefined {
  return Object.hasOwn(kinds, key) ? kinds[key] : undefined;
}
function pageIcon(page: string): string {
  if (page.startsWith("learn")) return "book";
  if (page.startsWith("mail")) return "mail";
  if (page.startsWith("plugin")) return "plugin";
  if (page.startsWith("board")) return "board";
  if (page.startsWith("gitlab")) return "gitlab";
  if (page.startsWith("cloud")) return "cloud";
  if (/^(schedule|reserve|trace)/.test(page)) return "calendar";
  if (/^(tasks|assignment)/.test(page)) return "check";
  if (/^(contacts|namecard)/.test(page)) return "card";
  if (/^(folder|favs)/.test(page)) return "folder";
  if (page === "vault") return "inbox";
  return "link";
}
function fileKind(name: string, mime: string): Kind {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  if (mime === "application/pdf" || extension === "pdf") return ["PDF 文件", "file"];
  if (mime.startsWith("image/") || /^(png|jpe?g|gif|webp|svg|heic|heif|bmp|avif|tiff?)$/.test(extension)) return ["图片", "image"];
  if (mime.startsWith("video/") || /^(mp4|mov|mkv|webm|avi|m4v)$/.test(extension)) return ["视频", "video"];
  if (mime.startsWith("audio/") || /^(mp3|m4a|wav|ogg|flac|aac)$/.test(extension)) return ["音频", "audio"];
  if (/spreadsheet|excel/.test(mime) || /^(xlsx?|csv|ods)$/.test(extension)) return ["表格", "table"];
  if (/presentation|powerpoint/.test(mime) || /^(pptx?|odp|key)$/.test(extension)) return ["演示文稿", "slides"];
  if (/zip|compressed|archive/.test(mime) || /^(zip|rar|7z|tar|gz|bz2|xz)$/.test(extension)) return ["压缩文件", "archive"];
  if (/^(js|jsx|ts|tsx|py|java|c|cpp|h|html|css|json|xml|sh|rs|go|swift)$/.test(extension)) return ["代码文件", "code"];
  if (mime.startsWith("text/") || /^(txt|md|rtf|docx?|odt|pages)$/.test(extension)) return ["文档", "file"];
  return ["文件", "file"];
}
function fileSize(size: unknown): string {
  if (typeof size !== "number" || !Number.isFinite(size) || size < 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** Synchronous metadata only: no registry initialization, file reads, or network requests. */
export function vaultItemPresentation(item: VaultCatch): VaultItemPresentation {
  let kind: Kind = ["已存内容", "inbox"];
  let detail = text(item.sub) || text(item.source);
  if (item.type === "file") {
    const name = item.file?.name || item.title;
    const extension = /(?:^|[/\\])[^/\\]*[^./\\]\.([a-z0-9]{1,10})$/i.exec(name)?.[1]?.toUpperCase();
    kind = fileKind(extension ? `file.${extension}` : "", item.file?.mime?.toLowerCase() ?? "");
    const size = fileSize(item.file?.size);
    // Captured file subtitles may already contain a size or repository path.
    detail = text(item.sub) || [size, text(item.source)].filter(Boolean).join(" · ");
    return { label: kind[0], detail: detail.slice(0, 120), icon: kind[1], ...(extension ? { badge: extension } : {}) };
  }
  if (item.type === "text") {
    kind = ["文字", "text"];
    detail = text(item.text) || detail;
  } else if (item.type === "board-item") {
    kind = ["白板组件", "board"];
  } else if (item.atom) {
    const { kind: atomKind, key } = item.atom;
    if (atomKind === "page" || atomKind === "tab") {
      // Tab keys start with a page id followed by '~' and encoded parameters.
      kind = [atomKind === "tab" ? "标签页" : "快捷入口", pageIcon(key.split("~")[0] ?? key)];
    } else kind = lookup(ATOM_KINDS, atomKind) ?? (atomKind.startsWith("plugin:") ? ["插件内容", "plugin"] : ["应用对象", "link"]);
  } else if (item.type === "payload") {
    const payload = record(item.payload), payloadKind = text(payload.kind);
    kind = lookup(PAYLOAD_KINDS, payloadKind) ?? (payload.routeId || payload.settingTitle ? ["设置项", "theme"] : kind);
    if (payloadKind === "namecard") {
      kind = payload.org ? ["组织名片", "organization"] : ["个人名片", "card"];
      const card = record(payload.card);
      detail = text(item.sub) || text(card.bio) || text(card.brief) || text(card.name) || detail;
    } else if (payloadKind === "quick-entry") {
      const entry = record(payload.entry);
      kind = entry.kind === "workspace" ? ["工作区", "workspace"] : entry.kind === "board" ? ["OnePage", "board"] : ["快捷入口", pageIcon(text(entry.page))];
    } else if (payloadKind === "tab") {
      kind = ["标签页", pageIcon(text(payload.page))];
    } else if (payloadKind === "schedule") {
      detail = text(item.sub) || [text(payload.date), text(payload.location), text(payload.note)].filter(Boolean).join(" · ") || detail;
    } else if (payloadKind === "cloud-folder" || payloadKind === "cloud-file") {
      detail = text(item.sub) || text(payload.path) || detail;
    }
  }
  return { label: kind[0], detail: detail.slice(0, 120), icon: kind[1] };
}
