import type { VaultCatch } from "../../state/vault.js";

export { CONTENT_ICON_PATHS as VAULT_ICON_PATHS } from "../contentIconPaths.js";

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
