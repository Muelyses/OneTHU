import { IconBtn } from "@onethu/gui";
import { Btn } from "@onethu/gui";
/**
 * 桌面端首启导览 v3（2026-10-13）：以桌面现状（dev-explorer 外壳）为基线的全新导览。
 *
 * 旧体系（OnboardingTour.tsx「逐项问界面 + 账号接入」与 OnboardingTourV2.tsx 三问灰度）
 * 已随本次改版删除，播放统一走本组件；偏好沿用 state/onboarding.ts：
 *  - 完成标记 onethu.onboarded.flow3（看完 / 跳过 /「不再显示」都落这里）；
 *  - 流程字段 onethu.onboarding.flow 新默认值 "v3"（旧存档兼容策略见该文件注释）。
 *
 * 七步：欢迎 → 标签页与工作区 → 首页白板 → 横竖栏与抽屉 → OnePage → 插件市场与搜索
 * → OH 自我进化（压轴：粒子舞台，见 OnboardingTourParticles.tsx）。
 * 文案纪律：禁词不碰、每条说明 ≤42 字；克制、准确，不口语不说明书腔。
 * 视觉纪律：液态玻璃 menu tier（--glass-menu-fill / menu-blur / rim 三件套），全令牌、无新色。
 *
 * 第二步的「真实拖拽演练」：卡片让位成一枚胶囊锚在底栏上方，交互全透传，
 * 用户自己把一张标签拖到另一张上（约 0.6s 出灰框、松手合并），点胶囊回来继续。
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { hasOnboardedV3, markOnboardedV3 } from "../state/onboarding.js";
import { askNotifyPermissionOnce } from "../state/notifyPermissionAsk.js";
import { IconX } from "./Icons.js";
import { TourParticles } from "./OnboardingTourParticles.js";

const STEPS = 7;
/** 每步一屏的结构化文案（bullets 全部 ≤42 字，直指真实可点的 UI） */
interface Doc {
  title: string;
  lead: string;
  bullets: string[];
  foot?: string;
}

/* ─── 玻璃层公共材质：液态玻璃 v4 的 menu tier（浮在任意内容上必须可读）─── */
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
  display: "flex", alignItems: "center", justifyContent: "center",
  background: "rgba(0, 0, 0, .45)", padding: 16,
  animation: "m-fade var(--dur-2) var(--ease-out) both",
};

const CARD: CSSProperties = {
  ...GLASS,
  zIndex: 2010,
  width: "min(600px, 100%)",
  maxHeight: "min(88vh, 720px)",
  overflowY: "auto",
  boxSizing: "border-box",
  borderRadius: "var(--r-lg)",
  color: "var(--text-1)",
  padding: "16px 20px 14px",
  animation: "m-spring-in var(--dur-3) var(--ease-out) both",
};

const H: CSSProperties = { margin: "4px 0 6px", fontSize: 20, lineHeight: 1.3, fontWeight: 600 };
const LEAD: CSSProperties = { margin: "0 0 8px", fontSize: 14, color: "var(--text-1)" };
const FOOT: CSSProperties = { margin: "10px 0 0", fontSize: 12, color: "var(--text-3)" };

const BULLET: CSSProperties = {
  display: "flex", gap: 8, alignItems: "baseline",
  margin: "6px 0", fontSize: 14, lineHeight: 1.6, color: "var(--text-2)",
};
const DOT: CSSProperties = {
  flex: "none", width: 4, height: 4, marginTop: 0,
  borderRadius: "var(--r-pill)", background: "var(--text-3)",
  transform: "translateY(-2px)",
};

const CHIPS_STYLE: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 8, margin: "2px 0 8px", padding: 0 };
const CHIP: CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "3px 12px", borderRadius: "var(--r-pill)",
  fontSize: 14, color: "var(--text-1)",
  background: "linear-gradient(180deg, var(--glass-tint-top), var(--glass-tint-bottom))",
  border: "1px solid var(--glass-border)",
  boxShadow: "inset 0 1px 0 var(--glass-rim-top)",
};

const DOCS_BASE: Doc[] = [
  {
    title: "欢迎使用 OneTHU",
    lead: "清华园随身工具箱。",
    bullets: [
      "七步一分钟，看完桌面端的主干。",
      "每步都可跳过；想重温，设置页右上角有「导览」。",
      "右上角 × 只关闭这一次，下次启动还会出现。",
    ],
  },
  {
    title: "标签页与工作区",
    lead: "页面都住在标签页里；拖一拖，就长成工作区。",
    bullets: [
      "顶部一排是标签页；换到竖版时在左侧栏。",
      "右键标签可复制、关闭，或一星收进 OnePage。",
      "把一张标签拖到另一张上，停 0.6 秒出灰框，松手合并。",
      "工作区底板就在标签栏上：右键可解散（标签保留）或删除。",
      "底栏「标签页」「OneGO!」抽屉里同样能看到工作区面板。",
    ],
  },
  {
    title: "首页是一张自由白板",
    lead: "大时间与一级功能区是骨架；其余组件随你摆。",
    bullets: [
      "骨架不动：右键大时间或功能区可调透明度（四档）。",
      "组件按住即拖，四角把手缩放，组件之间可以叠盖。",
      "选中即浮出小工具条：置顶、透明度四档、删除。",
      "右键空白（落点跟指针）或右侧 ＋：添加组件。",
      "双击空白就地建便笺；画笔恒在最高层，可撤销清空。",
    ],
    foot: "全是常态手势，没有要进出的「编辑模式」。",
  },
  {
    title: "横竖两副骨架",
    lead: "标签栏横竖随时切，窄一点也站得住。",
    bullets: [
      "横版：标签在顶部一排；竖版：标签在左侧一列。",
      "底栏「标签页」抽屉里有横版／竖版切换。",
      "设置里可定默认样式；竖栏底部按钮可切「窄」。",
      "窄栏悬停在栏上即展开，移开即收。",
      "底栏常驻：左「标签页」，中「搜索或问小OH」，右「OneGO!」。",
    ],
  },
  {
    title: "OnePage：你的一页",
    lead: "自带一块可以自由摆组件的白板页。",
    bullets: [
      "底栏「OneGO!」→ 我的 OnePage：起名后点「新建」。",
      "新建即得白板页，与首页同一套手势，摆什么都行。",
      "标签页右键「一星」：把内容收成一块 OnePage。",
      "OneGO 里还有 OneFlow：在 OH 对话里说「创建一个流程」。",
    ],
    foot: "命令面板（Ctrl+K）里也能直达你的白板。",
  },
  {
    title: "装插件、找一切",
    lead: "两条路就够：去搜索，去市场。",
    bullets: [
      "设置 → 插件：「我的插件 / 插件市场」两个视图随时切。",
      "「安装插件」支持仓库直装与市场一键安装。",
      "底部中央胶囊「搜索或问小OH」：点开打字即搜。",
      "任何页面按 Ctrl+K：输入即搜，回车直达。",
    ],
    foot: "检索同源：面板搜得到的，页面里也搜得到。",
  },
];

/** 第七步独立成 JSX：粒子舞台 + 词云席位 + 能力清单 */
const CHIPS = ["工具", "流程", "组件", "主题", "小组件", "插件"] as const;

function OhEvolutionStep(): ReactNode {
  return (
    <>
      <TourParticles />
      <div style={CHIPS_STYLE}>
        {CHIPS.map((c) => (
          <span key={c} style={CHIP}>{c}</span>
        ))}
      </div>
      <ul style={{ margin: "0", padding: 0, listStyle: "none" }}>
        <li style={BULLET}>
          <span aria-hidden style={DOT} />
          <span>一句话让 OH 建工具、跑流程、画组件、换主题、加手机小组件。</span>
        </li>
        <li style={BULLET}>
          <span aria-hidden style={DOT} />
          <span>插件也有两下：给个仓库地址可当场安装。</span>
        </li>
        <li style={BULLET}>
          <span aria-hidden style={DOT} />
          <span>本地插件能发布上 GitHub，并向市场提交收录。</span>
        </li>
      </ul>
    </>
  );
}

/** 第七步压轴：标题句直给能力本身，词云席位对应上一段画布散开的六个词 */
const DOCS: Doc[] = [
  ...DOCS_BASE,
  {
    title: "OH：说一句，长一样本领",
    lead: "在对话里说，它就动手。",
    bullets: [],
    foot: "工具箱自己会长：说到哪，就长到哪。",
  },
];

export function OnboardingTourV3(): ReactNode {
  const [open, setOpen] = useState<boolean>(() => !hasOnboardedV3());
  const [step, setStep] = useState(0);
  const [practice, setPractice] = useState(false);
  /** 通知权限的一次性申请：只在导览关掉之后问，避免两层弹窗（沿用 v1/v2 的接线口径） */
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

  /* Esc：演练中回到导览；否则关闭本次（不写偏好，下次启动还会出现） */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      if (practice) setPractice(false);
      else setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, practice]);

  if (!open) return null;

  const closeForever = (): void => {
    markOnboardedV3();
    setOpen(false);
  };

  if (practice) {
    return (
      <div
        role="dialog"
        aria-label="拖拽演练"
        style={{
          position: "fixed", left: "50%", bottom: "calc(var(--explorer-bar-h, 48px) + 16px)",
          transform: "translateX(-50%)", zIndex: 2110,
          display: "flex", gap: 12, alignItems: "center",
          padding: "8px 8px 8px 16px", borderRadius: "var(--r-pill)", ...GLASS,
          animation: "m-spring-in var(--dur-3) var(--ease-out) both",
        }}
      >
        <span style={{ fontSize: 14, color: "var(--text-1)" }}>
          演练中：把一张标签拖到另一张上，灰框出现就松手
        </span>
        <Btn variant="solid" tone="brand" onClick={() => setPractice(false)}>回到导览
        </Btn>
      </div>
    );
  }

  const isLast = step === STEPS - 1;
  /* 步索引恒在 0..6（STEPS 定长 + 上/下一步钳位），这里兜底取首步纯为收敛类型 */
  const doc = DOCS[step] ?? DOCS[0]!;

  return (
    <div style={MASK}>
      <div style={CARD} role="dialog" aria-modal="true" aria-label="OneTHU 桌面导览">
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

        <h3 style={H}>{doc.title}</h3>
        <p style={LEAD}>{doc.lead}</p>
        <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {doc.bullets.map((b) => (
            <li key={b} style={BULLET}>
              <span aria-hidden style={DOT} />
              <span>{b}</span>
            </li>
          ))}
        </ul>

        {/* ⑦ 压轴：粒子舞台 + 能力清单 */}
        {isLast ? <OhEvolutionStep /> : null}
        {/* ② 真实拖拽演练：进演练模式，卡片让位，交互透传 */}
        {step === 1 ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
            <Btn variant="solid" tone="brand" onClick={() => setPractice(true)}>自己拖一次</Btn>
            <span style={{ fontSize: 12, color: "var(--text-3)" }}>卡片让开，你动手；点胶囊回来继续</span>
          </div>
        ) : null}

        {doc.foot ? <p style={FOOT}>{doc.foot}</p> : null}

        {/* 脚：上一步 / 不再显示 / 下一步 */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 14, flexWrap: "wrap" }}>
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
