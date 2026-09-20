/**
 * 首启导览：**逐项问一遍**——侧栏所有内置功能 + 各页二级页签（选课除外），再把收藏夹教一次。
 *
 * 硬约束（用户定案 2026-09-20）：
 *  - 不新增机制、不动原子收藏、不删功能：侧栏折叠直接写**既有** `foldSidebar(id, isDefault)`
 *    （NAV 的 foldedDefaults 就是它的消费方），二级页签写**既有** `saveTabLayout`；
 *  - 判定"是否第一次"：onethu.onboarded.v1；设置页有常驻「重新导览」。
 */
import { useState } from "react";
import { SCENARIOS, applyScenarios, hasOnboarded, markOnboarded } from "../state/onboarding.js";
import { TABS as INFO_TABS } from "../pages/info/InfoPage.js";
import { TABS as LIFE_TABS } from "../pages/info/LifePage.js";
import { loadTabLayout, saveTabLayout } from "../lib/tabLayout.js";
import { useApp } from "../state/context.js";
import { useFavs } from "../state/favs.js";
import { NAV } from "./Layout.js";

/** 侧栏内置功能：直接复用 Layout 的 NAV（含图标），只补一句"里面有啥"。
 *  选课按用户要求不参与询问。 */
const PAGE_HINTS: Record<string, string> = {
  today: "未交作业 · 截止 · 今日课程",
  learn: "作业 · 通知 · 文件 · 讨论区",
  schedule: "课表 · 日程 · 提醒",
  trace: "今日日程地图 · 去哪 · 多久",
  mail: "清华邮箱收发",
  cloud: "清华云盘文件",
  thubook: "清华手册 · 校园指南",
  info: "成绩 · 考试 · 学籍 · 新闻",
  life: "校园卡 · 电费 · 洗衣机 · 网络",
  reserve: "座位 · 研讨间 · 场馆",
  thos: "学校在线服务（报备等）",
  otherinfo: "其他 Info 应用入口",
};
const NAV_ITEMS = NAV.filter((n) => n.page !== "zhjwxk").map((n) => ({
  page: n.page as string,
  label: n.label,
  icon: n.icon,
}));

/** 二级页签清单（key 与各页 loadTabLayout 一致） */
const TAB_GROUPS: Array<{ key: string; title: string; tabs: Array<{ id: string; label: string }> }> = [
  { key: "info", title: "信息页的页签", tabs: INFO_TABS as Array<{ id: string; label: string }> },
  { key: "life", title: "生活页的页签", tabs: LIFE_TABS as Array<{ id: string; label: string }> },
];

export function OnboardingTour(): React.ReactNode {
  const { navigate } = useApp();
  const favs = useFavs();
  const [open, setOpen] = useState(() => !hasOnboarded());
  const [step, setStep] = useState(0);
  // 默认全留（与现状一致）：只勾掉不要的
  const [keepPages, setKeepPages] = useState<string[]>(NAV_ITEMS.map((n) => n.page));
  const [keepTabs, setKeepTabs] = useState<string[]>(
    TAB_GROUPS.flatMap((g) => g.tabs.map((t) => `${g.key}:${t.id}`)),
  );
  const [keepCards, setKeepCards] = useState<string[]>(["learn", "schedule"]);

  if (!open) return null;

  const finish = (goFavorites: boolean): void => {
    // ① 侧栏：没勾的收进「已折叠」区（既有机制，用户随时能展开）
    for (const n of NAV_ITEMS) {
      const foldedNow = favs.data.foldedDefaults.includes(n.page as never);
      const wantFolded = !keepPages.includes(n.page);
      if (wantFolded !== foldedNow) favs.foldSidebar(n.page, true);
    }
    // ② 二级页签：没勾的隐藏（写既有 tabLayout）
    for (const g of TAB_GROUPS) {
      const ids = g.tabs.map((t) => t.id);
      const hidden = ids.filter((id) => !keepTabs.includes(`${g.key}:${id}`));
      saveTabLayout(g.key, { order: ids, hidden });
    }
    // ③ 首页卡片：按场景收起其余
    applyScenarios(keepCards, "portrait");
    markOnboarded();
    setOpen(false);
    if (goFavorites) navigate("folder");
  };

  const panel: React.CSSProperties = {
    position: "fixed", inset: 0, zIndex: 2000, display: "flex", alignItems: "center",
    justifyContent: "center", background: "rgba(0,0,0,.45)", padding: 20,
  };
  const box: React.CSSProperties = {
    width: "100%", maxWidth: 520, maxHeight: "86vh", overflowY: "auto",
    background: "var(--surface, #fff)", color: "var(--text-1, #1f2329)",
    borderRadius: 14, padding: "18px 20px", boxShadow: "0 18px 50px rgba(0,0,0,.28)",
  };
  const row = (on: boolean, label: string, hint: string, onClick: () => void): React.ReactNode => (
    <button
      key={label}
      className={on ? "btn btn-primary" : "btn"}
      style={{ width: "100%", textAlign: "left", marginBottom: 6, display: "block" }}
      onClick={onClick}
    >
      <b>{on ? "✓ " : ""}{label}</b>
      {hint ? <span style={{ opacity: 0.7, marginLeft: 8, fontSize: 12.5 }}>{hint}</span> : null}
    </button>
  );

  const STEPS = 4;
  return (
    <div style={panel} role="dialog" aria-modal="true" aria-label="首次使用导览">
      <div style={box}>
        {step === 0 ? (
          <>
            <h3 style={{ margin: "0 0 8px", fontSize: 17 }}>欢迎使用 OneTHU</h3>
            <p style={{ margin: "0 0 6px", fontSize: 13.5, lineHeight: 1.75, color: "var(--text-2, #555)" }}>
              接下来用三步把界面调成你自己的样子：<b>侧栏功能 → 各页页签 → 收藏夹</b>。
            </p>
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.75, color: "var(--text-2, #555)" }}>
              功能一个都不会少，只是不常用的先折起来，随时能展开。
            </p>
          </>
        ) : null}

        {step === 1 ? (
          <>
            <h3 style={{ margin: "0 0 4px", fontSize: 17 }}>侧栏要放哪些？</h3>
            <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--text-3, #999)" }}>
              点一下取消 = 收进「已折叠」，不是删掉。
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {NAV_ITEMS.map((n) => {
                const on = keepPages.includes(n.page);
                const Icon = n.icon as (p: { width?: number; height?: number }) => React.ReactNode;
                return (
                  <button
                    key={n.page}
                    onClick={() =>
                      setKeepPages((p) => (p.includes(n.page) ? p.filter((x) => x !== n.page) : [...p, n.page]))
                    }
                    style={{
                      display: "flex", gap: 9, alignItems: "flex-start", textAlign: "left",
                      padding: "10px 11px", borderRadius: 10, cursor: "pointer",
                      border: on ? "1px solid var(--accent, #4176e6)" : "1px solid var(--border, #e5e6eb)",
                      background: on ? "var(--accent-soft, rgba(65,118,230,.08))" : "var(--surface, #fff)",
                      opacity: on ? 1 : 0.55,
                    }}
                  >
                    <span style={{ flex: "none", marginTop: 1, color: on ? "var(--accent, #4176e6)" : "var(--text-3, #999)" }}>
                      <Icon width={16} height={16} />
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "block", fontWeight: 600, fontSize: 13.5 }}>{n.label}</span>
                      <span style={{ display: "block", fontSize: 11.5, color: "var(--text-3, #999)", lineHeight: 1.5 }}>
                        {PAGE_HINTS[n.page] ?? ""}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <h3 style={{ margin: "0 0 4px", fontSize: 17 }}>各页里的页签呢？</h3>
            <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--text-3, #999)" }}>
              同上一页：点一下取消 = 该页签先隐藏（在该页的「管理」里能加回来）。
            </p>
            {TAB_GROUPS.map((g) => (
              <div key={g.key} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12.5, color: "var(--text-3, #999)", margin: "6px 0 8px" }}>{g.title}</div>
                {/* 页签按 chip 排（与页内页签栏同观感），不做成大方块 */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {g.tabs.map((t) => {
                    const k = `${g.key}:${t.id}`;
                    const on = keepTabs.includes(k);
                    return (
                      <button
                        key={k}
                        className={on ? "btn btn-primary" : "btn"}
                        style={{ fontSize: 12.5, padding: "4px 10px", opacity: on ? 1 : 0.5 }}
                        onClick={() =>
                          setKeepTabs((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]))
                        }
                      >
                        {on ? "✓ " : ""}{t.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </>
        ) : null}

        {step === 3 ? (
          <>
            <h3 style={{ margin: "0 0 8px", fontSize: 17 }}>最后：收藏夹怎么用</h3>
            <p style={{ margin: "0 0 4px", fontSize: 13.5, lineHeight: 1.8 }}>
              <b>第一步</b>：在侧栏点「＋ 新建收藏夹」，起个名字（例如「今天要做的」）。
            </p>
            <p style={{ margin: "0 0 10px", fontSize: 13.5, lineHeight: 1.8 }}>
              <b>第二步</b>：打开任意页面或条目（一门课、一项作业、洗衣机、成绩单），
              点标题旁的 ☆ 收进刚才那个收藏夹——以后一点直达，也能放到桌面小组件。
            </p>
            <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--text-3, #999)" }}>
              下面还有按场景收起首页卡片，可点掉不要的。
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {SCENARIOS.map((s) => (
                <button
                  key={s.id}
                  className={keepCards.includes(s.id) ? "btn btn-primary" : "btn"}
                  style={{ fontSize: 12.5 }}
                  onClick={() =>
                    setKeepCards((p) => (p.includes(s.id) ? p.filter((x) => x !== s.id) : [...p, s.id]))
                  }
                >
                  {s.label}
                </button>
              ))}
            </div>
          </>
        ) : null}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
          {step > 0 ? <button className="btn" onClick={() => setStep((n) => n - 1)}>上一步</button> : null}
          <button className="btn btn-ghost" onClick={() => finish(false)}>跳过</button>
          {step < STEPS - 1 ? (
            <button className="btn btn-primary" onClick={() => setStep((n) => n + 1)}>
              下一步（{step + 1}/{STEPS - 1}）
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => finish(true)}>完成，去建收藏夹</button>
          )}
        </div>
      </div>
    </div>
  );
}
