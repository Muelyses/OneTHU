import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Card, PageHead } from "../components/Layout.js";
import { universalFetch } from "../lib/transport.js";

/** THUbook（thubook.help，VuePress 2 预渲染静态站）内嵌阅读器。
 *  站点 CORS *，universalFetch 直抓；sitemap.xml 建目录，正文取 <main>。
 *  x-frame-options: DENY → 不能 iframe，正文注入自带排版样式。 */

const BASE = "https://thubook.help";
const CACHE = new Map<string, { title: string; html: string }>();

/** 从预渲染 HTML 提取正文可注入片段：main 优先，剔除 script/style/nav 等壳层 */
function extractMain(html: string): { title: string; html: string } {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, nav, header, footer, .navbar, .sidebar").forEach((n) => n.remove());
  const main = doc.querySelector("main") ?? doc.body;
  const title: string = doc.querySelector("title")?.textContent?.trim() ?? "";
  return { title, html: main?.innerHTML ?? "" };
}

function labelOf(loc: string): string {
  const dec = decodeURIComponent(loc);
  const parts = dec.replace(/https?:\/\/thubook\.help/, "").replace(/\.html$/, "").split("/").filter(Boolean);
  return parts.length ? (parts[parts.length - 1] as string) : "首页";
}

const BODY_STYLE = `
.thubook-body { font-size: 14px; line-height: 1.75; color: var(--text, #1f2329); }
.thubook-body h1, .thubook-body h2, .thubook-body h3, .thubook-body h4 { margin: 1.2em 0 .5em; line-height: 1.4; }
.thubook-body h1 { font-size: 1.5em; } .thubook-body h2 { font-size: 1.3em; } .thubook-body h3 { font-size: 1.12em; }
.thubook-body p { margin: .6em 0; }
.thubook-body ul, .thubook-body ol { padding-left: 1.5em; margin: .5em 0; }
.thubook-body li { margin: .25em 0; }
.thubook-body a { color: #3d8bfd; text-decoration: none; }
.thubook-body a:hover { text-decoration: underline; }
.thubook-body code { background: var(--bg-hover, #f4f5f7); padding: .1em .4em; border-radius: 4px; font-size: .9em; }
.thubook-body pre { background: var(--bg-hover, #f4f5f7); padding: 12px; border-radius: 8px; overflow-x: auto; }
.thubook-body pre code { background: none; padding: 0; }
.thubook-body table { border-collapse: collapse; margin: .8em 0; width: 100%; }
.thubook-body th, .thubook-body td { border: 1px solid var(--border, #e5e6eb); padding: 6px 10px; font-size: 13px; }
.thubook-body th { background: var(--bg-hover, #f4f5f7); }
.thubook-body blockquote { border-left: 3px solid var(--border, #e5e6eb); margin: .8em 0; padding: .2em 1em; color: var(--text-2, #555); }
.thubook-body img { max-width: 100%; border-radius: 6px; }
.thubook-body hr { border: none; border-top: 1px solid var(--border, #e5e6eb); margin: 1.2em 0; }
`;

export default function ThubookPage(): ReactNode {
  const [toc, setToc] = useState<string[]>([]);
  const [current, setCurrent] = useState<string>("/thubook/");
  const [page, setPage] = useState<{ title: string; html: string } | null>(CACHE.get("/thubook/") ?? null);
  const [loading, setLoading] = useState(false);
  const [tocLoading, setTocLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await universalFetch(`${BASE}/sitemap.xml`);
        const xml = new DOMParser().parseFromString(await res.text(), "text/xml");
        const locs = Array.from(xml.getElementsByTagName("loc"))
          .map((n) => (n.textContent ?? "").trim())
          .map((u) => u.replace(/^https?:\/\/thubook\.help/, "") || "/thubook/");
        setToc(locs.length ? locs : ["/thubook/"]);
      } catch (e) {
        setErr(`目录加载失败：${e instanceof Error ? e.message : String(e)}（检查网络）`);
      } finally {
        setTocLoading(false);
      }
    })();
  }, []);

  const load = useCallback(async (path: string): Promise<void> => {
    const hit = CACHE.get(path);
    if (hit) {
      setCurrent(path);
      setPage(hit);
      return;
    }
    setLoading(true);
    setErr("");
    try {
      const res = await universalFetch(`${BASE}${path}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ext = extractMain(await res.text());
      CACHE.set(path, ext);
      setCurrent(path);
      setPage(ext);
    } catch (e) {
      setErr(`页面加载失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  // 正文内的链接拦截：站内 → 阅读器跳转；外链 → 系统浏览器
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const onClick = (ev: Event): void => {
      const a = (ev.target as HTMLElement | null)?.closest?.("a");
      const href = a?.getAttribute("href") ?? "";
      if (!a || !href) return;
      ev.preventDefault();
      if (href.startsWith("/")) {
        void load(href.split("#")[0] || "/thubook/");
      } else if (/^https?:\/\//.test(href)) {
        void import("@tauri-apps/plugin-opener").then((m) => m.openUrl(href)).catch(() => undefined);
      }
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [page, load]);

  const filtered = useMemo(
    () => (q ? toc.filter((t) => decodeURIComponent(t).toLowerCase().includes(q.toLowerCase())) : toc),
    [toc, q],
  );

  return (
    <>
      <PageHead title="THUbook" meta="清华手册 · thubook.help" />
      <div style={{ display: "grid", gridTemplateColumns: "250px 1fr", gap: 10, height: "calc(100vh - 150px)" }}>
        <Card style={{ overflowY: "auto", padding: 10 }}>
          <input
            className="input"
            placeholder="搜索目录…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ width: "100%", marginBottom: 8, fontSize: 12.5 }}
          />
          {tocLoading ? <div style={{ fontSize: 12, color: "var(--text-3, #999)" }}>目录加载中…</div> : null}
          <div style={{ display: "grid", gap: 1 }}>
            {filtered.map((t) => (
              <button
                key={t}
                onClick={() => void load(t)}
                style={{
                  textAlign: "left", fontSize: 12.5, padding: "6px 8px", borderRadius: 7, border: "none",
                  cursor: "pointer", background: t === current ? "var(--accent, #6d7ff0)" : "transparent",
                  color: t === current ? "#fff" : "var(--text, #1f2329)", lineHeight: 1.4, wordBreak: "break-all",
                }}
              >
                {labelOf(t)}
              </button>
            ))}
            {!tocLoading && !filtered.length ? <div style={{ fontSize: 12, color: "var(--text-3, #999)" }}>无匹配</div> : null}
          </div>
        </Card>
        <Card style={{ overflowY: "auto", padding: "16px 22px" }}>
          {page ? <style>{BODY_STYLE}</style> : null}
          {err ? <div style={{ color: "#e5484d", fontSize: 13, marginBottom: 10 }}>{err}</div> : null}
          {loading ? <div style={{ fontSize: 12.5, color: "var(--text-3, #999)" }}>加载中…</div> : null}
          {/* 正文：站点预渲染 HTML 注入（script/nav 已剔除，站内链接已拦截） */}
          <div className="thubook-body" ref={bodyRef} dangerouslySetInnerHTML={{ __html: page?.html ?? "" }} />
          {!page && !loading && !err ? <div style={{ fontSize: 13, color: "var(--text-3, #999)" }}>左侧选择一页开始阅读</div> : null}
        </Card>
      </div>
    </>
  );
}
