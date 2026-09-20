/**
 * 首启导览（3 步，可跳过、可重放）。
 *
 * 设计约束（用户定案 2026-09-20）：**不动原子收藏、不删功能、不新增机制**。
 * 所以导览只做两件事，全部写既有存储：
 *   ① 按场景收起用不到的首页卡片（走 homeCards 的现成布局）；
 *   ② 把用户带到「收藏夹」页，教会一次"把页面/作业收进收藏夹"。
 * 判定"是否第一次"：onethu.onboarded.v1；设置页有常驻「重新导览」入口。
 */
import { useState } from "react";
import { SCENARIOS, applyScenarios, hasOnboarded, markOnboarded } from "../state/onboarding.js";
import { useApp } from "../state/context.js";

export function OnboardingTour(): React.ReactNode {
  const { navigate } = useApp();
  const [open, setOpen] = useState(() => !hasOnboarded());
  const [step, setStep] = useState(0);
  const [picked, setPicked] = useState<string[]>(["learn", "schedule"]);

  if (!open) return null;

  const finish = (goFavorites: boolean): void => {
    markOnboarded();
    applyScenarios(picked, "portrait");
    setOpen(false);
    if (goFavorites) navigate("folder");
  };

  const panel: React.CSSProperties = {
    position: "fixed", inset: 0, zIndex: 2000, display: "flex", alignItems: "center",
    justifyContent: "center", background: "rgba(0,0,0,.45)", padding: 20,
  };
  const box: React.CSSProperties = {
    width: "100%", maxWidth: 460, background: "var(--surface, #fff)", color: "var(--text-1, #1f2329)",
    borderRadius: 14, padding: "18px 20px", boxShadow: "0 18px 50px rgba(0,0,0,.28)",
  };

  return (
    <div style={panel} role="dialog" aria-modal="true" aria-label="首次使用导览">
      <div style={box}>
        {step === 0 ? (
          <>
            <h3 style={{ margin: "0 0 8px", fontSize: 17 }}>欢迎使用 OneTHU</h3>
            <p style={{ margin: "0 0 6px", fontSize: 13.5, lineHeight: 1.75, color: "var(--text-2, #555)" }}>
              OneTHU 里东西很多——但你不必一次都用。
            </p>
            <p style={{ margin: "0 0 16px", fontSize: 13.5, lineHeight: 1.75, color: "var(--text-2, #555)" }}>
              下一步按你要做的事选几个场景，我们把用不到的卡片先收起来；随时能在设置里改回来。
            </p>
          </>
        ) : null}

        {step === 1 ? (
          <>
            <h3 style={{ margin: "0 0 8px", fontSize: 17 }}>你主要用它做什么？</h3>
            <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--text-3, #999)" }}>可多选，之后随时能改。</p>
            {SCENARIOS.map((s) => {
              const on = picked.includes(s.id);
              return (
                <button
                  key={s.id}
                  className={on ? "btn btn-primary" : "btn"}
                  style={{ width: "100%", textAlign: "left", marginBottom: 8, display: "block" }}
                  onClick={() => setPicked((p) => (on ? p.filter((x) => x !== s.id) : [...p, s.id]))}
                >
                  <b>{s.label}</b>
                  <span style={{ opacity: 0.72, marginLeft: 8, fontSize: 12.5 }}>{s.hint}</span>
                </button>
              );
            })}
          </>
        ) : null}

        {step === 2 ? (
          <>
            <h3 style={{ margin: "0 0 8px", fontSize: 17 }}>最后一件事：收藏夹</h3>
            <p style={{ margin: "0 0 6px", fontSize: 13.5, lineHeight: 1.75, color: "var(--text-2, #555)" }}>
              OneTHU 里任何东西——一门课、一项作业、洗衣机、成绩单——都能收进收藏夹，
              下次一点直达，也能放到桌面小组件。
            </p>
            <p style={{ margin: "0 0 16px", fontSize: 13.5, lineHeight: 1.75, color: "var(--text-2, #555)" }}>
              现在带你去建第一个收藏夹，顺手把「今日日程」放进去试一次。
            </p>
          </>
        ) : null}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
          {step > 0 ? <button className="btn" onClick={() => setStep((n) => n - 1)}>上一步</button> : null}
          <button className="btn btn-ghost" onClick={() => finish(false)}>跳过</button>
          {step < 2 ? (
            <button className="btn btn-primary" onClick={() => setStep((n) => n + 1)}>下一步</button>
          ) : (
            <button className="btn btn-primary" onClick={() => finish(true)}>去建收藏夹</button>
          )}
        </div>
      </div>
    </div>
  );
}
