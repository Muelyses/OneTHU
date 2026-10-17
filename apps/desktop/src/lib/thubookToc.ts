/**
 * THUBook（thubook.help，VuePress 2）目录解析。
 *
 * 唯一可靠来源是**首页 navbar 的下拉菜单**：站点把「根级页面 + 四个分组 + 组内全部页面」
 * 都预渲染进首页（`ul.nav-dropdown`），一次请求即可拿到完整两级目录。
 *
 * 不能用「抓每个分组页侧边栏再合并」：VuePress 的侧边栏在每个页面都会把**整站**目录
 * 再渲染一遍，按组合并会把所有页面塞进每个组 → 标题重复、层级全平。
 * 侧边栏只在 navbar 结构变化时作兜底（此时组的子项可能不全，但至少根页可用）。
 */

export const THUBOOK_BASE = "https://thubook.help";

export interface ThubookPageLink {
  label: string;
  /** 规范化后的站内路径：解码、去 `.html`、去 hash；首页为 `/thubook/` */
  path: string;
}

export interface ThubookGroup {
  label: string;
  items: ThubookPageLink[];
}

export interface ThubookToc {
  title: string;
  /** 根级页面（导航栏直属链接，保持站点顺序） */
  pages: ThubookPageLink[];
  /** 分组及其页面（保持站点顺序） */
  groups: ThubookGroup[];
}

function cleanLabel(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s+/g, " ").trim();
}

/** 把 href 归一成站内路径；外链、资源、非 /thubook 页面返回 null。 */
export function normalizeThubookPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const href = raw.split("#")[0] ?? "";
  if (!href || href.startsWith("//")) return null;
  let url: URL;
  try {
    url = new URL(href, `${THUBOOK_BASE}/thubook/`);
  } catch {
    return null;
  }
  if (url.origin !== THUBOOK_BASE) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  const path = decoded.replace(/\.html$/i, "");
  if (path !== "/thubook" && !path.startsWith("/thubook/")) return null;
  if (path === "/thubook" || path === "/thubook/") return "/thubook/";
  return path.replace(/\/+$/, "");
}

function linkOf(a: Element, seen: Set<string>): ThubookPageLink | null {
  const label = cleanLabel(a.textContent);
  const path = normalizeThubookPath(a.getAttribute("href"));
  if (!label || !path || seen.has(path)) return null;
  seen.add(path);
  return { label, path };
}

/** 从首页 HTML 解析完整目录（navbar 优先，sidebar 兜底）。 */
export function parseThubookToc(html: string): ThubookToc {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const title = cleanLabel(doc.querySelector("title")?.textContent).split(" - ")[0]?.trim() ?? "";
  const seen = new Set<string>();
  const pages: ThubookPageLink[] = [];
  const groups: ThubookGroup[] = [];

  /* ① 首选：navbar 的下拉菜单（根页 = 直属链接，组 = dropdown）。 */
  for (const item of Array.from(doc.querySelectorAll(".navbar .nav-item"))) {
    const dropdown = item.querySelector(".dropdown-wrapper");
    if (dropdown) {
      const label = cleanLabel(
        dropdown.querySelector(".dropdown-title .title")?.textContent
        ?? dropdown.querySelector(".dropdown-title")?.getAttribute("aria-label"),
      );
      const items = Array.from(dropdown.querySelectorAll("ul.nav-dropdown > li.dropdown-item > a.nav-link"))
        .map((a) => linkOf(a, seen))
        .filter((x): x is ThubookPageLink => Boolean(x));
      if (label && items.length) groups.push({ label, items });
      continue;
    }
    const a = item.querySelector(":scope > a.nav-link");
    if (!a) continue;
    const link = linkOf(a, seen);
    if (link) pages.push(link);
  }

  /* ② 兜底：navbar 结构变了就退回侧边栏（组子项只在当前展开组里有，可能不全）。 */
  if (!pages.length && !groups.length) {
    for (const li of Array.from(doc.querySelectorAll("aside.sidebar > ul.sidebar-links > li"))) {
      const group = li.querySelector(":scope > section.sidebar-group");
      if (group) {
        const label = cleanLabel(group.querySelector(".sidebar-heading .title")?.textContent);
        const items = Array.from(group.querySelectorAll(":scope > ul.sidebar-links > li > a.sidebar-link.sidebar-page"))
          .map((a) => linkOf(a, seen))
          .filter((x): x is ThubookPageLink => Boolean(x));
        if (label && items.length) groups.push({ label, items });
        continue;
      }
      const a = li.querySelector(":scope > a.sidebar-link.sidebar-page");
      if (!a) continue;
      const link = linkOf(a, seen);
      if (link) pages.push(link);
    }
  }

  return { title, pages, groups };
}
