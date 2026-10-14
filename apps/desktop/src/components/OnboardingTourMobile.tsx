import { IconBtn } from "@onethu/gui";
import { Btn } from "@onethu/gui";
/**
 * 首启导览 · 手机简版（dev-explorer 二轮 A8，2026-10-13）：
 * 桌面 v3 七步在手机太大——手机只讲五件「当下就要会」的事：
 *   ① 底部标签条拖动（换位 / 停留并成工作区 / 长按菜单）
 *   ② 添加组件（首页右下「编」→「＋」）
 *   ③ OnePage 与 OneGO!（一本白板 + 工作区面板的常驻入口）
 *   ④ 搜索胶囊（底部长出半屏抽屉、可拉满；也搜得到插件）
 *   ⑤ OH 自我进化一句话（压轴：复用桌面 V3 的粒子舞台）
 * 样式复用桌面 V3 的同源令牌（menu tier 玻璃 / 步点 / bullet）；粒子组件直接引 v3 的。
 *
 * 偏好自持：与桌面 v3（flow3）分键——手机档落 `onethu.onboarded.phone`（同一偏好家族，
 * 模块内读写，不新增状态机）；「不再显示」与看完压轴都落盘并入设置页「导览」重走口径。
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { askNotifyPermissionOnce } from "../state/notifyPermissionAsk.js";
import { isPhoneNow, useIsPhone } from "../state/phoneSheets.js";
import { IconX } from "./Icons.js";
import { TourParticles } from "./OnboardingTourParticles.js";
import { OnboardingTourV3 } from "./OnboardingTourV3.js";

const KEY_PHONE = "onethu.onboarded.phone";

export function hasOnboardedPhone(): boolean {
  try {
    return globalThis.localStorage?.getItem(KEY_PHONE) === "1";
  } catch {
    return true; /* 存不下时别反复弹 */
  }
}

export function markOnboardedPhone(): void {
  try {
    globalThis.localStorage?.setItem(KEY_PHONE, "1");
  } catch {
    /* ignore */
  }
}

export function resetOnboardingPhone(): void {
  try {
    globalThis.localStorage?.removeItem(KEY_PHONE);
  } catch {
    /* ignore */
  }
}

/* ─── 与桌面 V3 同源的材质/文案样式（menu tier 玻璃；步点、 Drugs 与 bullet 同尺寸） ─── */
const STEPS = 5;

interface Doc {
  title: string;
  lead: string;
  bullets: string[];
  foot?: string;
}

const GLASS: CSSProperties = {
  background: "var(--glass-menu-fill)",
  backdropFilter: "var(--glass-menu-blur)",
  WebkitBackdropFilter: "var(--glass-menu-blur)",
  border: "1px solid var(--glass-border)",
  boxShadow:
    "var(--glass-shadow), inset 0 1px 0 var(--glass-rim-top)," +
    " inset 0 0 0 1px var(--glass-rim-hairline), inset 0 -1px 0 var(--glass-rim-bottom)",
};

const MASK: CSSProperties = {
  position: "fixed", inset: 0, zIndex: 2000,
  display: "flex", alignItems: "flex-end", justifyContent: "center",
  background: "rgba(0, 0, 0, .45)",
  padding: 12,
  animation: "m-fade var(--dur-2) var(--ease-out) both",
};

const CARD: CSSProperties = {
  ...GLASS,
  zIndex: 2010,
  width: "100%",
  maxHeight: "min(72vh, 560px)",
  overflowY: "auto",
  boxSizing: "border-box",
  borderRadius: "var(--r-lg, 16px)",
  color: "var(--text-1)",
  padding: "14px 16px 12px",
  animation: "m-spring-in var(--dur-3) var(--ease-out) both",
};

const H: CSSProperties = { margin: "4px 0 6px", fontSize: 16, lineHeight: 1.3, fontWeight: 600 };
const LEAD: CSSProperties = { margin: "0 0 6px", fontSize: 14, color: "var(--text-1)" };
const FOOT: CSSProperties = { margin: "8px 0 0", fontSize: 12, color: "var(--text-3)" };

const BULLET: CSSProperties = {
  display: "flex", gap: 8, alignItems: "baseline",
  margin: "4px 0", fontSize: 14, lineHeight: 1.6, color: "var(--text-2)",
};
const DOT: CSSProperties = {
  flex: "none", width: 4, height: 4, marginTop: 0,
  borderRadius: "var(--r-pill)", background: "var(--text-3)",
  transform: "translateY(-2px)",
};

const DOCS: Doc[] = [
  {
    title: "底部的标签条",
    lead: "标签页全在这儿，手指说了算。",
    bullets: [
      "按住一个标签拖一拖，就换了顺序。",
      "拖到另一个标签上停一停（0.6 秒灰框），松手合并成工作区。",
      "按住 0.5 秒不动出菜单：聚焦、复制、关闭、解散工作区。",
      "标签太多会横向滚动：按住后左右滑就能翻页。",
    ],
  },
  {
    title: "添加组件：白板随你摆",
    lead: "首页右下角开始。",
    bullets: [
      "点「编」进编辑，再点「＋」选组件放到白板上。",
      "组件长按出菜单，可调尺寸、固定与删除。",
    ],
    foot: "「添加组件」抽屉从底部长出来，也不挡白板。",
  },
  {
    title: "OnePage：你的一页",
    lead: "OneGO! 里管它们。",
    bullets: [
      "底栏右侧「OneGO!」→ 我的 OnePage：起名后「新建」。",
      "新建即得一块白板，跟首页同一套手势。",
      "抽屉里还有工作区面板，手机同样能解散与建组。",
    ],
  },
  {
    title: "搜索胶囊",
    lead: "底栏中央那颗胶囊，不只是输入框。",
    bullets: [
      "点一下：从底部长出半屏搜索窗，可拉满全屏。",
      "能搜页面、面板与插件；结果直接点开。",
      "长按 0.45 秒开始说话；松手直发，上划取消。",
    ],
    foot: "OH 的对话窗也长在同一个胶囊上。",
  },
  {
    title: "OH：说一句，长一样本领",
    lead: "在对话里说，它就动手。",
    bullets: [],
    foot: "工具箱自己会长：说到哪，就长到哪。",
  },
];

export function OnboardingTourMobile(): ReactNode {
  /* 手机专列：非手机一律不渲染（App 的挂载点负责在两端分流，见同文件 OnboardingTourGate） */
  const phone = useIsPhone();
  const [open, setOpen] = useState<boolean>(() => isPhoneNow() && !hasOnboardedPhone());
  const [step, setStep] = useState(0);
  /** 通知权限的一次性申请：导观关掉之后问（与桌面 V3 相同的接线口径） */
  const shown = useRef(false);

  useEffect(() => {
    if (open) {
      shown.current = true;
      return;
    }
    if (!shown.current) return;
    const t = window.setTimeout(() => {
      void askNotifyPermissionOnce();
    }, 800);
    return () => window.clearTimeout(t);
  }, [open]);

  if (!phone || !open) return null;

  const isLast = step === STEPS - 1;
  const doc = DOCS[step] ?? DOCS[0]!;

  const closeForever = (): void => {
    markOnboardedPhone();
    setOpen(false);
  };

  return (
    <div style={MASK}>
      <div style={CARD} role="dialog" aria-modal="true" aria-label="OneTHU 手机导览">
        {/* 头：步点 + 关闭本次（不写偏好） */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <div style={{ display: "flex", gap: 5, alignItems: "center" }} aria-label={"第 " + (step + 1) + " 步，共 " + STEPS + " 步"}>
            {Array.from({ length: STEPS }, (_, i) => (
              <span
                key={i}
                aria-hidden
                style={{
                  width: i === step ? 16 : 6,
                  height: 6,
                  borderRadius: "var(--r-pill)",
                  background: i === step ? "var(--accent)" : i < step ? "var(--accent-soft)" : "var(--glass-border)",
                }}
              />
            ))}
          </div>
          <span style={{ flex: 1 }} />
          <IconBtn label="关闭本次导览" icon={<IconX width={14} height={14} />} onClick={() => setOpen(false)} />
        </div>

        {isLast ? <TourParticles /> : null}
        <h3 style={H}>{doc.title}</h3>
        <p style={LEAD}>{doc.lead}</p>
        <ul style={{ margin: "0", padding: 0, listStyle: "none" }}>
          {doc.bullets.map((b) => (
            <li key={b} style={BULLET}>
              <span aria-hidden style={DOT} />
              <span>{b}</span>
            </li>
          ))}
        </ul>
        {doc.foot ? <p style={FOOT}>{doc.foot}</p> : null}

        {/* 脚：上一步 / 不再显示 / 下一步 */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
          <Btn variant="outline" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>上一步
          </Btn>
          <span style={{ flex: 1 }} />
          <Btn variant="ghost" titleAttr="完成标记：此后不再自动出现" onClick={closeForever}>
            不再显示
          </Btn>
          {isLast ? (
            <Btn variant="solid" tone="brand" onClick={closeForever}>开始使用</Btn>
          ) : (
            <Btn variant="solid" tone="brand" onClick={() => setStep((s) => Math.min(STEPS - 1, s + 1))}>下一步
            </Btn>
          )}
        </div>
      </div>
    </div>
  );
}

/** App.tsx 挂载点分流：手机 → 简版五步；桌面 → 桌面 V3 七步 */
export function OnboardingTourGate(): ReactNode {
  const phone = useIsPhone();
  if (phone) return <OnboardingTourMobile />;
  return <OnboardingTourV3 />;
}

