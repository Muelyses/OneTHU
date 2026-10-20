import { localizedList as i18nList } from "../i18n/index.js";
import { t as i18n, useLocale as useUiLocale } from "../i18n/index.js";
import { Btn, Chip, IconBtn, Inline, Modal, Progress, Spacer, Stack, Surface, Text } from "@onethu/gui";
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
 * 视觉纪律：讲解框收编 OneGUI（2026-10-14）——卡片 = OG Modal 面板（浮层面阶、
 * head/body/foot 解剖与退场相位全归库),文案件走 Text 字阶、步点走 Progress、
 * 词云走 Chip；专属档位统一在 OnboardingTourScope.ts 以 defineScope 登记。
 *
 * 第二步的「真实拖拽演练」：卡片让位成一枚胶囊锚在底栏上方，交互全透传，
 * 用户自己把一张标签拖到另一张上（约 0.6s 出灰框、松手合并），点胶囊回来继续。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { hasOnboardedV3, markOnboardedV3 } from "../state/onboarding.js";
import { askNotifyPermissionOnce } from "../state/notifyPermissionAsk.js";
import { IconX } from "./Icons.js";
import { TourParticles } from "./OnboardingTourParticles.js";
import { TOUR_CARD_SCOPE, defineOnboardingScopes } from "./OnboardingTourScope.js";

defineOnboardingScopes();

const STEPS = 7;
/** 每步一屏的结构化文案（bullets 全部 ≤42 字，直指真实可点的 UI） */
interface Doc {
  title: string;
  lead: string;
  bullets: string[];
  foot?: string;
}

/** bullet 行：圆点几何走唯一允许的纯几何内联，颜色引用 OG 语义令牌（tour scope 已锁档） */
export function TourBullet({ children }: { children: ReactNode }): ReactNode {
  const uiLocale = useUiLocale();

  return (
    <Inline gap={2} vAlign="baseline">
      <span
        aria-hidden="true"
        style={{
          flex: "none",
          width: 4,
          height: 4,
          borderRadius: "var(--og-radius-full)",
          background: "var(--og-content-3)",
        }}
      />
      <Text as="span">{children}</Text>
    </Inline>
  );
}

const DOCS_BASE: Doc[] = [
  {
    get title() { return i18n("components.onboardingtourv3.dd3208ca2917"); },
    get lead() { return i18n("components.onboardingtourv3.2f8345141c89"); },
    get bullets() { return i18nList(["components.onboardingtourv3.c57439b82df9","components.onboardingtourv3.4ff4a0dbc4ef","components.onboardingtourv3.281c7d16e5bd"]); },
  },
  {
    get title() { return i18n("components.onboardingtourv3.280832e11f57"); },
    get lead() { return i18n("components.onboardingtourv3.768ddf66b868"); },
    get bullets() { return i18nList(["components.onboardingtourv3.b9f53c665e03","components.onboardingtourv3.16db14984ce5","components.onboardingtourv3.c0536a13ccc3","components.onboardingtourv3.d750e7aaed28","components.onboardingtourv3.3313a0968f97"]); },
  },
  {
    get title() { return i18n("components.onboardingtourv3.d6a2506f30a7"); },
    get lead() { return i18n("components.onboardingtourv3.0b3cb95bce97"); },
    get bullets() { return i18nList(["components.onboardingtourv3.c575f6222266","components.onboardingtourv3.925a3ec4a592","components.onboardingtourv3.99ffd3d1a875","components.onboardingtourv3.290f85ad4f6a","components.onboardingtourv3.1878863a8e7b"]); },
    get foot() { return i18n("components.onboardingtourv3.e18fe8598d89"); },
  },
  {
    get title() { return i18n("components.onboardingtourv3.794833cba26d"); },
    get lead() { return i18n("components.onboardingtourv3.dde91a15ff1f"); },
    get bullets() { return i18nList(["components.onboardingtourv3.8f2ad7768678","components.onboardingtourv3.a2de4ccdce72","components.onboardingtourv3.23f450edd90e","components.onboardingtourv3.6d3d4feb0c1a","components.onboardingtourv3.0ca382e2edca"]); },
  },
  {
    get title() { return i18n("components.onboardingtourv3.0195603ee49e"); },
    get lead() { return i18n("components.onboardingtourv3.06d3cfb40d27"); },
    get bullets() { return i18nList(["components.onboardingtourv3.dc819c398a78","components.onboardingtourv3.fded5e53272d","components.onboardingtourv3.c071633e0902","components.onboardingtourv3.cb17e22bf3f0"]); },
    get foot() { return i18n("components.onboardingtourv3.30633ea11f9b"); },
  },
  {
    get title() { return i18n("components.onboardingtourv3.8a12026f5cee"); },
    get lead() { return i18n("components.onboardingtourv3.0afabdd4308c"); },
    get bullets() { return i18nList(["components.onboardingtourv3.f73a8a19c591","components.onboardingtourv3.2b6332b718e8","components.onboardingtourv3.62a2fe77cea8","components.onboardingtourv3.f3ff6e20abc7"]); },
    get foot() { return i18n("components.onboardingtourv3.2cbb006447b1"); },
  },
];

/** 第七步独立成 JSX：粒子舞台 + 词云席位 + 能力清单 */
const CHIPS = ["工具", "流程", "组件", "主题", "小组件", "插件"] as const;

function OhEvolutionStep(): ReactNode {
  const uiLocale = useUiLocale();

  return (
    <>
      <TourParticles />
      <Inline gap={2} wrap>
        {CHIPS.map((c) => (
          <Chip key={c}>{c}</Chip>
        ))}
      </Inline>
      <Stack gap={1}>
        <TourBullet>{i18n("components.onboardingtourv3.5f0c74b96547")}</TourBullet>
        <TourBullet>{i18n("components.onboardingtourv3.5021907844de")}</TourBullet>
        <TourBullet>{i18n("components.onboardingtourv3.aa01e1d7252b")}</TourBullet>
      </Stack>
    </>
  );
}

/** 第七步压轴：标题句直给能力本身，词云席位对应上一段画布散开的六个词 */
const DOCS: Doc[] = [
  ...DOCS_BASE,
  {
    get title() { return i18n("components.onboardingtourv3.7c2809268e55"); },
    get lead() { return i18n("components.onboardingtourv3.514adbf12726"); },
    bullets: [],
    get foot() { return i18n("components.onboardingtourv3.67ab2cc6012c"); },
  },
];

export function OnboardingTourV3(): ReactNode {
  const uiLocale = useUiLocale();

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

  /* Esc：演练中回到导览；否则关闭本次（不写偏好，下次启动还会出现）
     —— OG Modal 自带浮层栈的 Esc 出口，与这里专职监听并存（栈顶优先语义一致） */
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

  const closeForever = (): void => {
    markOnboardedV3();
    setOpen(false);
  };

  if (practice) {
    /* 演练 HUD：胶囊 = OG 浮层 Surface（pos 定位交给外层纯几何壳——底栏高是应用侧变量，
       fixed 参数与居中属于 C2 几何，不属于外观）；胶囊材质完全由 overlay 面阶提供 */
    return (
      <div
        role="dialog"
        aria-label={i18n("components.onboardingtourv3.edaec615b68d")}
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: "calc(var(--explorer-bar-h, 48px) + var(--og-space-4))",
          width: "max-content",
          marginInline: "auto",
        }}
      >
        <Surface overlay radius="2xl" scope={TOUR_CARD_SCOPE} pad="sm">
          <Inline gap={3} vAlign="center">
            <Text as="span">{i18n("components.onboardingtourv3.d45c9dc68d4b")}</Text>
            <Btn variant="solid" tone="brand" onClick={() => setPractice(false)}>{i18n("components.onboardingtourv3.35915ce8d259")}</Btn>
          </Inline>
        </Surface>
      </div>
    );
  }

  const isLast = step === STEPS - 1;
  /* 步索引恒在 0..6（STEPS 定长 + 上/下一步钳位），这里兜底取首步纯为收敛类型 */
  const doc = DOCS[step] ?? DOCS[0]!;

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      maskClose={false}
      closeButton={false}
      size="md"
      aria-label={i18n("components.onboardingtourv3.958b344e82b3")}
      scope={TOUR_CARD_SCOPE}
      foot={
        <Inline gap={2} vAlign="center" wrap>
          <Btn variant="outline" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>{i18n("components.onboardingtourv3.da336fdc0dbd")}</Btn>
          <Spacer />
          <Btn variant="ghost" titleAttr={i18n("components.onboardingtourv3.1f5a2b96e178")} onClick={closeForever}>{i18n("components.onboardingtourv3.a2d3a4eeefd7")}</Btn>
          {isLast ? (
            <Btn variant="solid" tone="brand" onClick={closeForever}>{i18n("components.onboardingtourv3.715ee9dc842f")}</Btn>
          ) : (
            <Btn variant="solid" tone="brand" onClick={() => setStep((s) => Math.min(STEPS - 1, s + 1))}>{i18n("components.onboardingtourv3.acfc4e74a650")}</Btn>
          )}
        </Inline>
      }
    >
      <Stack gap={2}>
        {/* 头：步进度 + 关闭本次（不写偏好）——浮动卡骨架的 body 顶部与旧版同位 */}
        <Inline gap={2} vAlign="center">
          <div aria-label={i18n("components.onboardingtourv3.9552fe3bd366") + (step + 1) + i18n("components.onboardingtourv3.fd73c2773154") + STEPS + i18n("components.onboardingtourv3.e010e3f578cc")}>
            <Progress value={(step + 1) / STEPS} size="sm" />
          </div>
          <Spacer />
          <IconBtn label={i18n("components.onboardingtourv3.285daf1ff2f1")} icon={<IconX width={14} height={14} />} onClick={() => setOpen(false)} />
        </Inline>

        <Text slot="title" as="h3">{doc.title}</Text>
        <Text as="p">{doc.lead}</Text>
        <Stack gap={1}>
          {doc.bullets.map((b) => (
            <TourBullet key={b}>{b}</TourBullet>
          ))}
        </Stack>

        {/* ⑦ 压轴：粒子舞台 + 能力清单 */}
        {isLast ? <OhEvolutionStep /> : null}
        {/* ② 真实拖拽演练：进演练模式，卡片让位，交互透传 */}
        {step === 1 ? (
          <Inline gap={3} vAlign="center" wrap>
            <Btn variant="solid" tone="brand" onClick={() => setPractice(true)}>{i18n("components.onboardingtourv3.f8d9c42c331f")}</Btn>
            <Text slot="label" tone="faint">{i18n("components.onboardingtourv3.bcd7acd491b0")}</Text>
          </Inline>
        ) : null}

        {doc.foot ? <Text slot="label" tone="faint" as="p">{doc.foot}</Text> : null}
      </Stack>
    </Modal>
  );
}
