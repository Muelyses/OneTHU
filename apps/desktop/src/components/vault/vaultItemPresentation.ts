import { t as i18n } from "../../i18n/index.js";
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
  get course(): Kind { return [i18n("components.vault.vaultitempresentation.60db1afb4022"), "book"]; }, get "courseX-c"(): Kind { return [i18n("components.vault.vaultitempresentation.60db1afb4022"), "book"]; }, get assignment(): Kind { return [i18n("components.vault.vaultitempresentation.b0dff016ff17"), "check"]; },
  get file(): Kind { return [i18n("components.vault.vaultitempresentation.2bb745fb2e6f"), "file"]; }, get notice(): Kind { return [i18n("components.vault.vaultitempresentation.f37a13fc55b3"), "bell"]; }, get mail(): Kind { return [i18n("components.vault.vaultitempresentation.3d708e8e8b1f"), "mail"]; },
  get news(): Kind { return [i18n("components.vault.vaultitempresentation.d39567b2b9f1"), "text"]; }, get "news-src"(): Kind { return [i18n("components.vault.vaultitempresentation.e26e5de89c0a"), "text"]; }, get folder(): Kind { return [i18n("components.vault.vaultitempresentation.796d20e91588"), "folder"]; },
  get widget(): Kind { return [i18n("components.vault.vaultitempresentation.783d638053ea"), "board"]; }, get action(): Kind { return [i18n("components.vault.vaultitempresentation.ed31fbb483ee"), "check"]; }, get forum(): Kind { return [i18n("components.vault.vaultitempresentation.909f281e0537"), "text"]; }, get "bbs-board"(): Kind { return [i18n("components.vault.vaultitempresentation.2dd2abd8ce5c"), "text"]; },
  get "gitlab-proj"(): Kind { return [i18n("components.vault.vaultitempresentation.6aa71ddd8364"), "gitlab"]; }, get "gitlab-issue"(): Kind { return [i18n("components.vault.vaultitempresentation.6955d2975471"), "gitlab"]; }, get "gitlab-mr"(): Kind { return [i18n("components.vault.vaultitempresentation.dd42589239f7"), "gitlab"]; },
  get library(): Kind { return [i18n("components.vault.vaultitempresentation.266e6cb77079"), "book"]; }, get "library-a"(): Kind { return [i18n("components.vault.vaultitempresentation.360ffb101c98"), "book"]; }, get "library-f"(): Kind { return [i18n("components.vault.vaultitempresentation.80dc57894c8c"), "book"]; },
  get "classroom-b"(): Kind { return [i18n("components.vault.vaultitempresentation.5c8d010fd9a3"), "location"]; }, get "classroom-r"(): Kind { return [i18n("components.vault.vaultitempresentation.df7a65bb1371"), "location"]; }, get "libroom-k"(): Kind { return [i18n("components.vault.vaultitempresentation.e4d40b4d6759"), "location"]; },
  get "kj-space"(): Kind { return [i18n("components.vault.vaultitempresentation.e81059e1a712"), "location"]; }, get "kj-room"(): Kind { return [i18n("components.vault.vaultitempresentation.96b2d406041b"), "location"]; }, get "sports-v"(): Kind { return [i18n("components.vault.vaultitempresentation.e00b99270be7"), "location"]; },
  get "washer-b"(): Kind { return [i18n("components.vault.vaultitempresentation.218e2d1b3853"), "location"]; }, get "washer-m"(): Kind { return [i18n("components.vault.vaultitempresentation.6acfa1db6a62"), "inbox"]; },
  get "thos-service"(): Kind { return [i18n("components.vault.vaultitempresentation.510e6ec15a9e"), "link"]; }, get infoapp(): Kind { return [i18n("components.vault.vaultitempresentation.d4f7864690bb"), "link"]; },
};
const PAYLOAD_KINDS: Record<string, Kind> = {
  get "cloud-folder"(): Kind { return [i18n("components.vault.vaultitempresentation.fc01d82d7556"), "folder"]; }, get "cloud-file"(): Kind { return [i18n("components.vault.vaultitempresentation.b5f224115dae"), "cloud"]; },
  get schedule(): Kind { return [i18n("components.vault.vaultitempresentation.a14f23af7016"), "calendar"]; }, get namecard(): Kind { return [i18n("components.vault.vaultitempresentation.fd5394f29856"), "card"]; }, get workspace(): Kind { return [i18n("components.vault.vaultitempresentation.37979829426b"), "workspace"]; },
  get "gitlab-project"(): Kind { return [i18n("components.vault.vaultitempresentation.6aa71ddd8364"), "gitlab"]; }, get theme(): Kind { return [i18n("components.vault.vaultitempresentation.788db1cfec2a"), "theme"]; }, get wallpaper(): Kind { return [i18n("components.vault.vaultitempresentation.bbaa9f06378b"), "image"]; },
  get plugin(): Kind { return [i18n("components.vault.vaultitempresentation.e806fbbe8ec6"), "plugin"]; }, get "learn-notice"(): Kind { return [i18n("components.vault.vaultitempresentation.f37a13fc55b3"), "bell"]; },
  get "learn-attachment"(): Kind { return [i18n("components.vault.vaultitempresentation.12bf9e7490d3"), "file"]; }, get "news-file"(): Kind { return [i18n("components.vault.vaultitempresentation.9eb3f2fa22ec"), "file"]; },
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
  if (mime === "application/pdf" || extension === "pdf") return [i18n("components.vault.vaultitempresentation.cdda5d2fdd8a"), "file"];
  if (mime.startsWith("image/") || /^(png|jpe?g|gif|webp|svg|heic|heif|bmp|avif|tiff?)$/.test(extension)) return [i18n("components.vault.vaultitempresentation.d24c10d37db0"), "image"];
  if (mime.startsWith("video/") || /^(mp4|mov|mkv|webm|avi|m4v)$/.test(extension)) return [i18n("components.vault.vaultitempresentation.c20f7618d330"), "video"];
  if (mime.startsWith("audio/") || /^(mp3|m4a|wav|ogg|flac|aac)$/.test(extension)) return [i18n("components.vault.vaultitempresentation.296c632ec857"), "audio"];
  if (/spreadsheet|excel/.test(mime) || /^(xlsx?|csv|ods)$/.test(extension)) return [i18n("components.vault.vaultitempresentation.22d9e7c54b88"), "table"];
  if (/presentation|powerpoint/.test(mime) || /^(pptx?|odp|key)$/.test(extension)) return [i18n("components.vault.vaultitempresentation.54f982631040"), "slides"];
  if (/zip|compressed|archive/.test(mime) || /^(zip|rar|7z|tar|gz|bz2|xz)$/.test(extension)) return [i18n("components.vault.vaultitempresentation.8b512613643a"), "archive"];
  if (/^(js|jsx|ts|tsx|py|java|c|cpp|h|html|css|json|xml|sh|rs|go|swift)$/.test(extension)) return [i18n("components.vault.vaultitempresentation.a8f2a0de5fdf"), "code"];
  if (mime.startsWith("text/") || /^(txt|md|rtf|docx?|odt|pages)$/.test(extension)) return [i18n("components.vault.vaultitempresentation.2687ccdbb1d2"), "file"];
  return [i18n("components.vault.vaultitempresentation.39932f24fe11"), "file"];
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
  let kind: Kind = [i18n("components.vault.vaultitempresentation.51aca5c2a97e"), "inbox"];
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
    kind = [i18n("components.vault.vaultitempresentation.14b69bd6eeb0"), "text"];
    detail = text(item.text) || detail;
  } else if (item.type === "board-item") {
    kind = [i18n("components.vault.vaultitempresentation.206359b4b54d"), "board"];
  } else if (item.atom) {
    const { kind: atomKind, key } = item.atom;
    if (atomKind === "page" || atomKind === "tab") {
      // Tab keys start with a page id followed by '~' and encoded parameters.
      kind = [atomKind === "tab" ? i18n("components.vault.vaultitempresentation.a626aad412b7") : i18n("components.vault.vaultitempresentation.5f2cfbfecf9f"), pageIcon(key.split("~")[0] ?? key)];
    } else kind = lookup(ATOM_KINDS, atomKind) ?? (atomKind.startsWith("plugin:") ? [i18n("components.vault.vaultitempresentation.0cffe0f50c72"), "plugin"] : [i18n("components.vault.vaultitempresentation.1fd167c6ae13"), "link"]);
  } else if (item.type === "payload") {
    const payload = record(item.payload), payloadKind = text(payload.kind);
    kind = lookup(PAYLOAD_KINDS, payloadKind) ?? (payload.routeId || payload.settingTitle ? [i18n("components.vault.vaultitempresentation.44bc7ccc3677"), "theme"] : kind);
    if (payloadKind === "namecard") {
      kind = payload.org ? [i18n("components.vault.vaultitempresentation.b1bd19b13336"), "organization"] : [i18n("components.vault.vaultitempresentation.fd5394f29856"), "card"];
      const card = record(payload.card);
      detail = text(item.sub) || text(card.bio) || text(card.brief) || text(card.name) || detail;
    } else if (payloadKind === "quick-entry") {
      const entry = record(payload.entry);
      kind = entry.kind === "workspace" ? [i18n("components.vault.vaultitempresentation.37979829426b"), "workspace"] : entry.kind === "board" ? ["OnePage", "board"] : [i18n("components.vault.vaultitempresentation.5f2cfbfecf9f"), pageIcon(text(entry.page))];
    } else if (payloadKind === "tab") {
      kind = [i18n("components.vault.vaultitempresentation.a626aad412b7"), pageIcon(text(payload.page))];
    } else if (payloadKind === "schedule") {
      detail = text(item.sub) || [text(payload.date), text(payload.location), text(payload.note)].filter(Boolean).join(" · ") || detail;
    } else if (payloadKind === "cloud-folder" || payloadKind === "cloud-file") {
      detail = text(item.sub) || text(payload.path) || detail;
    }
  }
  return { label: kind[0], detail: detail.slice(0, 120), icon: kind[1] };
}
