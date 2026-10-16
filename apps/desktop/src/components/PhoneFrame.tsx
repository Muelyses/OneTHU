/**
 * 竖屏取景框（dev 专用）：在**同一个应用**里给出一块真正的 390×844 级手机视口。
 *
 * 为什么需要它：把窗口拖窄**不等于**手机——窗口比例受屏幕上限（macOS 上高度约 700）、
 * 视口高度/宽度比与真机差很远，`env(safe-area-inset-*)` 也是 0，于是"总感觉不一样"。
 * 这里用**同源 iframe** 开一块固定尺寸的视口：里面的文档拿到的 innerWidth/innerHeight
 * 就是真机尺寸，`position: fixed` 与 vh 全部按它算；又因为是同源，localStorage 与
 * 登录态跟主应用**完全共享**——所以既是真的手机视口，又是你自己的数据。
 *
 * 入口：`?phone-frame=1`（dev 构建；DevPanel 里也有一个按钮直接跳过来）。
 * 已知差异：DPR 用宿主屏幕的（Mac 2x，真机 3x）；安全区不模拟（真机底部会多一条 home 指示条）。
 */
import { useEffect, useMemo, useRef, useState } from "react";

interface Device {
  id: string;
  name: string;
  w: number;
  h: number;
}

const DEVICES: Device[] = [
  { id: "15pro", name: "iPhone 15 Pro", w: 393, h: 852 },
  { id: "15pm", name: "iPhone 15 Pro Max", w: 430, h: 932 },
  { id: "se", name: "iPhone SE", w: 375, h: 667 },
  { id: "pixel8", name: "Pixel 8", w: 412, h: 915 },
  { id: "mini", name: "iPad mini", w: 744, h: 1133 },
];

/** 取景框里可选的场景：真实应用（不带参数，走登录态）或免登录预览场景 */
const SCENES: Array<{ id: string; name: string; q: string }> = [
  { id: "real", name: "真实应用（登录态）", q: "" },
  { id: "home", name: "首页（免登录预览）", q: "explorer-preview=home" },
  { id: "drawer", name: "标签页抽屉", q: "explorer-preview=drawer" },
  { id: "otherinfo", name: "其他 Info", q: "explorer-preview=otherinfo" },
  { id: "settings", name: "设置浮层", q: "explorer-preview=settings-tab" },
  { id: "page-schedule", name: "课表", q: "explorer-preview=page&page=schedule" },
  { id: "page-cloud", name: "云盘", q: "explorer-preview=page&page=cloud" },
  { id: "page-tasks", name: "待办/任务", q: "explorer-preview=page&page=tasks" },
  { id: "search", name: "搜索面板", q: "explorer-preview=search" },
  { id: "onego", name: "OneGO!", q: "explorer-preview=onego" },
];

export default function PhoneFrame() {
  /* 初值可从 URL 预置：`?phone-frame=1&device=15pm&scene=page-cloud&land=1&fit=0`
     —— 便于把"某个场景的手机形态"直接做成一个链接/截图。 */
  const q0 = new URLSearchParams(window.location.search);
  const [devId, setDevId] = useState(q0.get("device") ?? "15pro");
  const [land, setLand] = useState(q0.get("land") === "1");
  const [scene, setScene] = useState(q0.get("scene") ?? "real");
  const [fit, setFit] = useState(q0.get("fit") !== "0");
  const [nonce, setNonce] = useState(0);
  /* Tauri 桥状态：取景框是 iframe，Tauri 只注入主 frame —— 应用侧的 lib/tauriBridge.ts 会从父窗口认领。
     这里只是把结果**显示出来**，方便一眼确认"登录态/原生网络到底有没有接上"。 */
  const [bridge, setBridge] = useState<"unknown" | "ok" | "miss" | "none">("unknown");
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ w: window.innerWidth, h: window.innerHeight });

  const dev: Device = DEVICES.find((d) => d.id === devId) ?? DEVICES[0]!;
  const vw = land ? dev.h : dev.w;
  const vh = land ? dev.w : dev.h;

  useEffect(() => {
    const on = (): void => setBox({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);

  /* 适应窗口：只做 transform 缩放，**不改视口尺寸**——里面那份文档量到的仍是 vw×vh */
  const scale = useMemo(() => {
    if (!fit) return 1;
    const k = Math.min((box.w - 120) / vw, (box.h - 150) / vh, 1);
    return Math.max(0.25, Number(k.toFixed(3)));
  }, [fit, box.w, box.h, vw, vh]);

  const sceneQ = SCENES.find((s) => s.id === scene)?.q ?? "";
  const inner = `/?${sceneQ ? sceneQ + "&" : ""}__phone_frame=1${nonce ? `&_r=${nonce}` : ""}`;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9000, display: "flex", flexDirection: "column",
        alignItems: "center", background: "#14161c", color: "#cfd6e4",
        font: "13px/1.5 -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif",
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, padding: "10px 14px", width: "100%", boxSizing: "border-box", borderBottom: "1px solid #2a2f3a" }}>
        <strong style={{ color: "#eef2f8" }}>竖屏取景框</strong>
        <span style={{ opacity: 0.6 }}>{vw}×{vh}{land ? "（横屏）" : "（竖屏）"} · 缩放 {Math.round(scale * 100)}%</span>
        <select value={devId} onChange={(e) => setDevId(e.target.value)} style={sel}>
          {DEVICES.map((d) => <option key={d.id} value={d.id}>{d.name} · {d.w}×{d.h}</option>)}
        </select>
        <button style={btn} onClick={() => setLand((v) => !v)}>{land ? "切竖屏" : "切横屏"}</button>
        <select value={scene} onChange={(e) => setScene(e.target.value)} style={sel}>
          {SCENES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button style={btn} onClick={() => setFit((v) => !v)}>{fit ? "实际大小" : "适应窗口"}</button>
        <button style={btn} onClick={() => setNonce((n) => n + 1)}>重载</button>
        <span style={{ flex: 1 }} />
        <span style={{ color: bridge === "ok" ? "#7ee0a8" : bridge === "miss" ? "#ff9c8a" : "#8f9bb0" }}>
          Tauri 桥：
          {bridge === "ok" ? "已认领（会话/原生网络可用）"
            : bridge === "miss" ? "认领失败——会退化成浏览器预览（没有登录态）"
              : bridge === "none" ? "无（在浏览器里跑，本来就没有）"
                : "检测中…"}
        </span>
        <span style={{ opacity: 0.55 }}>同源 iframe：壁纸/主题/登录态与应用一致；DPR 与安全区不模拟</span>
        <button style={btn} onClick={() => { window.location.href = window.location.pathname; }}>返回应用</button>
      </div>
      <div ref={wrapRef} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", width: "100%" }}>
        <div
          style={{
            width: vw, height: vh, flex: "none", transform: `scale(${scale})`,
            borderRadius: 44, border: "10px solid #0b0d12", background: "#000",
            boxShadow: "0 24px 80px rgba(0,0,0,.55), inset 0 0 0 1px #333a46", overflow: "hidden", position: "relative",
          }}
        >
          <iframe
            key={`${dev.id}-${land}-${scene}-${nonce}`}
            title="手机视口"
            src={inner}
            onLoad={(e) => {
              const win = e.currentTarget.contentWindow;
              let has = false;
              try { has = !!win && "__TAURI_INTERNALS__" in win; } catch { has = false; }
              const hostHas = "__TAURI_INTERNALS__" in window;
              setBridge(has ? "ok" : hostHas ? "miss" : "none");
              /* 真机是**悬浮滚动条**（不占版心）；桌面 iframe 默认给经典滚动条，会把 393 挤成 383，
                 看起来就像"右边被切了一条"。这里注一份样式把它按真机口径抹掉。 */
              const doc = e.currentTarget.contentDocument;
              if (!doc || doc.getElementById("phone-frame-sim")) return;
              const st = doc.createElement("style");
              st.id = "phone-frame-sim";
              st.textContent =
                "html{scrollbar-width:none}html::-webkit-scrollbar,*::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}";
              doc.head.appendChild(st);
            }}
            style={{ width: vw, height: vh, border: 0, display: "block", background: "#fff" }}
          />
        </div>
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  height: 30, padding: "0 10px", borderRadius: 8, border: "1px solid #39404d",
  background: "#1e222b", color: "#dfe6f2", cursor: "pointer", font: "inherit",
};
const sel: React.CSSProperties = { ...btn, padding: "0 6px" };
