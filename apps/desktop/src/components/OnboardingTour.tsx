/**
 * 首启导览：**逐项问一遍**——侧栏所有内置功能 + 各页二级页签（选课除外），再把收藏夹教一次。
 *
 * 硬约束（用户定案 2026-09-20）：
 *  - 不新增机制、不动原子收藏、不删功能：侧栏折叠直接写**既有** `foldSidebar(id, isDefault)`
 *    （NAV 的 foldedDefaults 就是它的消费方），二级页签写**既有** `saveTabLayout`；
 *  - 判定"是否第一次"：onethu.onboarded.v1；设置页有常驻「重新导览」。
 */
import { useEffect, useState } from "react";
import { PRESETS, SCENARIOS, applyTodayCards, cardsForScenarios, cardsOfScenario, hasOnboarded, markOnboarded, todayChoosableCards, type Preset } from "../state/onboarding.js";
import { askNotifyPermissionOnce } from "../state/notifyPermissionAsk.js";
import { TABS as INFO_TABS } from "../pages/info/InfoPage.js";
import { TABS as LIFE_TABS } from "../pages/info/LifePage.js";
import { loadTabLayout, saveTabLayout } from "../lib/tabLayout.js";
import type { HomeCardId, HomeOrientation } from "../lib/homeCards.js";
import { useApp } from "../state/context.js";
import { useFavs } from "../state/favs.js";
import { NAV } from "./Layout.js";

/** 当前朝向（判据与 Today.tsx 一致）：首页布局按横竖屏各存一份，
 *  导览的卡片取舍必须落到用户此刻在看的那一份，否则等于没生效。 */
function currentOrientation(): HomeOrientation {
  if (typeof window === "undefined") return "portrait";
  return window.matchMedia("(orientation: portrait)").matches ? "portrait" : "landscape";
}

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
  /** 今日页可勾选的卡（默认全留 = 现在的全面版首页；只勾掉不要的） */
  const CARD_CHOICES = todayChoosableCards();
  const [keepCards, setKeepCards] = useState<HomeCardId[]>(CARD_CHOICES.map((c) => c.id));
  /** 首屏二选一：自行选择（逐项）/ 按场景预设 */
  const [mode, setMode] = useState<"manual" | "preset">("manual");
  /** 示例收藏夹是否已创建（hooks 必须全部在早退之前，见下方 return null） */
  const [seeded, setSeeded] = useState(false);
  const [preset, setPreset] = useState<Preset | null>(null);
  /** 选预设时同步卡片勾选：卡片步骤所见即所得（此后以勾选为准） */
  const choosePreset = (pr: Preset): void => {
    setPreset(pr);
    setKeepCards(cardsForScenarios(pr.cards));
  };

  // R21：导览结束（或本就无需导览）后一次性申请通知权限——与定位权限同一套
  // 「在用户第一次真正需要时问」的原则；已问过则静默跳过，不打扰。
  useEffect(() => {
    if (open) return; // 导览开着时先不弹，避免两层弹窗叠在一起
    const t = window.setTimeout(() => {
      void askNotifyPermissionOnce();
    }, 800);
    return () => window.clearTimeout(t);
  }, [open]);

  if (!open) return null;

  const finish = (): void => {
    try {
      applySelection();
    } catch {
      /* 任一步写入失败都不能影响应用可用性：忽略并照常结束导览 */
    } finally {
      markOnboarded();
      setOpen(false);
    }
  };

  /** 把当前选择落到既有存储（预设 / 手动两条路径共用；异常由调用方兜住） */
  const applySelection = (): void => {
    if (mode === "preset" && preset) {
      // 预设路径：页面折叠 + 页签显隐 + 首页卡片，全部写既有存储
      for (const n of NAV_ITEMS) {
        const foldedNow = favs.data.foldedDefaults.includes(n.page as never);
        const wantFolded = !preset.pages.includes(n.page);
        if (wantFolded !== foldedNow) favs.foldSidebar(n.page, true);
      }
      for (const g of TAB_GROUPS) {
        const ids = g.tabs.map((t) => t.id);
        const keepIds = preset.tabs[g.key] ?? [];
        saveTabLayout(g.key, { order: ids, hidden: ids.filter((id) => !keepIds.includes(id)) });
      }
      applyTodayCards(keepCards, currentOrientation());
      return;
    }

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
    // ③ 今日页卡片：取消的收进「添加卡片」，其余保持现状（全面版默认不被动过）
    applyTodayCards(keepCards as HomeCardId[], currentOrientation());
  };

  /** 示例收藏夹：点击即完成一次完整收藏流程（建夹 → 放原子），并说明"万物皆可收藏"。
   *  三项覆盖三种粒度：一级页面（网络学堂）、一级页面（选课）、二级页签（预约页 · 空教室）。 */
  const SEED_ATOMS = [
    { kind: "page", key: "learn" },              // 网络学堂（一级）
    { kind: "page", key: "zhjwxk" },             // 选课（一级）
    { kind: "page", key: "reserve-classroom" },  // 空教室（预约页的二级页签）
  ];
  const seedDemoFolder = (goTo: boolean): void => {
    const id = favs.create("示例收藏夹", null);
    if (!id) return;
    for (const atom of SEED_ATOMS) favs.addAtom(id, atom);
    setSeeded(true);
    // 必须带 folderId 跳转：FolderPage 以 navParams.folderId 为根（缺省渲染"不存在"的空夹）
    if (goTo) {
      markOnboarded();
      setOpen(false);
      navigate("folder", { folderId: id });
    }
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

  const STEPS = 5;
  return (
    <div style={panel} role="dialog" aria-modal="true" aria-label="首次使用导览">
      <div style={box}>
        {step === 0 ? (
          <>
            <h3 style={{ margin: "0 0 8px", fontSize: 17 }}>欢迎使用 OneTHU</h3>
            <p style={{ margin: "0 0 6px", fontSize: 13.5, lineHeight: 1.75, color: "var(--text-2, #555)" }}>
              接下来用四步把界面调成你自己的样子：<b>侧栏功能 → 各页页签 → 今日页卡片 → 收藏夹</b>。
            </p>
            <p style={{ margin: "0 0 14px", fontSize: 13.5, lineHeight: 1.75, color: "var(--text-2, #555)" }}>
              功能一个都不会少，只是不常用的先折起来，随时能展开。
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {([
                ["manual", "自行选择", "逐项决定侧栏功能与页签"],
                ["preset", "按场景预设", "完整 / 极简 / 预约狂人 / 信息大师"],
              ] as const).map(([m, label, hint]) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  style={{
                    textAlign: "left", padding: "12px 13px", borderRadius: 10, cursor: "pointer",
                    border: mode === m ? "1px solid var(--accent, #4176e6)" : "1px solid var(--border, #e5e6eb)",
                    background: mode === m ? "var(--accent-soft, rgba(65,118,230,.08))" : "var(--surface, #fff)",
                  }}
                >
                  <span style={{ display: "block", fontWeight: 600, fontSize: 14 }}>{label}</span>
                  <span style={{ display: "block", marginTop: 2, fontSize: 12, color: "var(--text-3, #999)", lineHeight: 1.5 }}>
                    {hint}
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : null}

        {step === 1 && mode === "preset" ? (
          <>
            <h3 style={{ margin: "0 0 4px", fontSize: 17 }}>选一个场景</h3>
            <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--text-3, #999)" }}>
              选定后仍可返回上一步改选手动逐项，或随时在设置里重来。
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {PRESETS.map((pr) => (
                <button
                  key={pr.id}
                  onClick={() => choosePreset(pr)}
                  style={{
                    textAlign: "left", padding: "12px 13px", borderRadius: 10, cursor: "pointer",
                    border: preset?.id === pr.id ? "1px solid var(--accent, #4176e6)" : "1px solid var(--border, #e5e6eb)",
                    background: preset?.id === pr.id ? "var(--accent-soft, rgba(65,118,230,.08))" : "var(--surface, #fff)",
                  }}
                >
                  <span style={{ display: "block", fontWeight: 600, fontSize: 14 }}>{pr.label}</span>
                  <span style={{ display: "block", marginTop: 2, fontSize: 12, color: "var(--text-3, #999)", lineHeight: 1.5 }}>
                    {pr.hint}
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : null}

        {step === 1 && mode === "manual" ? (
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

        {step === 2 && mode === "manual" ? (
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
            <h3 style={{ margin: "0 0 4px", fontSize: 17 }}>
              今日页留哪些卡？
              <span style={{ marginLeft: 8, fontSize: 12.5, fontWeight: 400, color: "var(--text-3, #999)" }}>
                已留 {keepCards.length} 张
              </span>
            </h3>
            <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--text-3, #999)", lineHeight: 1.6 }}>
              现在默认是<b>全面版</b>首页：内容一次给全。点一下取消 = 这张卡先收进「添加卡片」，
              以后在首页「编辑 → 添加卡片」里随时能加回来。
              <b>「最近使用 / 猜你喜欢」要先用一阵才有内容</b>（刚装好时会显示一句说明），
              想第一眼就看到东西的话，留着「今日概览 / 日程与提醒 / 未提交作业」这几张。
            </p>
            {keepCards.length === 0 ? (
              <p style={{ margin: "0 0 10px", fontSize: 12.5, lineHeight: 1.7, color: "var(--red, #d33)" }}>
                一张都没留的话，今日页会没有任何卡片。至少留一张（推荐「今日概览」）。
              </p>
            ) : null}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {CARD_CHOICES.map((c) => {
                const on = keepCards.includes(c.id);
                return (
                  <button
                    key={c.id}
                    className={on ? "btn btn-primary" : "btn"}
                    style={{ fontSize: 12.5, padding: "4px 10px", opacity: on ? 1 : 0.5 }}
                    title={c.hint ?? ""}
                    onClick={() => setKeepCards((p) => (p.includes(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id]))}
                  >
                    {on ? "✓ " : ""}{c.title}
                  </button>
                );
              })}
            </div>
          </>
        ) : null}

        {step === 4 ? (
          <>
            <h3 style={{ margin: "0 0 8px", fontSize: 17 }}>最后一步：完成一次收藏</h3>
            <p style={{ margin: "0 0 10px", fontSize: 13.5, lineHeight: 1.8, color: "var(--text-2, #555)" }}>
              点下面的按钮，会为你建一个<b>示例收藏夹</b>，并放入三项：
              <b>网络学堂</b>（一级页面）、<b>选课</b>（一级页面）、<b>空教室</b>（预约页里的二级页签）。
            </p>
            <p style={{ margin: "0 0 12px", fontSize: 13.5, lineHeight: 1.8, color: "var(--text-2, #555)" }}>
              收藏夹建好后可以改名、拖拽排序、放桌面小组件——<b>万物皆可收藏</b>：
              任何页面、任何页签、任何一门课、任何一项作业、任何一台洗衣机，都能收进来，下次一点直达。
            </p>
            <button
              className={seeded ? "btn" : "btn btn-primary"}
              disabled={seeded}
              style={{ width: "100%", marginBottom: 10 }}
              onClick={() => seedDemoFolder(false)}
            >
              {seeded ? "✓ 示例收藏夹已创建（含 3 项）" : "创建示例收藏夹并进入（含 3 项）"}
            </button>
            <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--text-3, #999)" }}>
              下面还可按场景收起首页卡片，不需要的直接点掉。
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {SCENARIOS.map((sc) => {
                const cards = cardsOfScenario(sc.id);
                const on = cards.length > 0 && cards.every((c) => keepCards.includes(c));
                return (
                  <button
                    key={sc.id}
                    className={on ? "btn btn-primary" : "btn"}
                    style={{ fontSize: 12.5 }}
                    onClick={() =>
                      setKeepCards((p) =>
                        on ? p.filter((x) => !cards.includes(x)) : [...new Set([...p, ...cards])],
                      )
                    }
                  >
                    {on ? "✓ " : "收起"}{sc.label}
                  </button>
                );
              })}
            </div>
          </>
        ) : null}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
          {step > 0 ? <button className="btn" onClick={() => setStep((n) => n - 1)}>上一步</button> : null}
          <button className="btn btn-ghost" onClick={finish}>跳过</button>
          {step < STEPS - 1 ? (
            <button
              className="btn btn-primary"
              disabled={step === 1 && mode === "preset" && !preset}
              onClick={() => setStep((n) => (mode === "preset" && n === 1 ? 3 : n + 1))}
            >
              下一步
            </button>
          ) : (
            <button className="btn btn-primary" onClick={finish}>完成</button>
          )}
        </div>
      </div>
    </div>
  );
}
