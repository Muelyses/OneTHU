import { localizedList as i18nList } from "../i18n/index.js";
import { t as i18n, useLocale as useUiLocale } from "../i18n/index.js";
import { Btn, IconBtn, Inline, Progress, Sheet, Spacer, Stack, Text } from "@onethu/gui";
/**
 * 首启导览 · 手机简版（dev-explorer 二轮 A8，2026-10-13）：
 * 桌面 v3 七步在手机太大——手机只讲五件「当下就要会」的事：
 *   ① 标签页抽屉（手机横竖都没有标签条：换标签只走底栏「标签页」抽屉）
 *   ② 添加组件（首页右下「编」→「＋」）
 *   ③ OnePage 与 OneGO!（一本白板 + 工作区面板的常驻入口）
 *   ④ 搜索胶囊（底部长出半屏抽屉、可拉满；也搜得到插件）
 *   ⑤ OH 自我进化一句话（压轴：复用桌面 V3 的粒子舞台）
 *
 * 样式收编 OneGUI（2026-10-14）：卡片 = OG Sheet（手机贴底 + 抓手 + 安全区，
 * 桌面退化居中），骨架同桌面 V3；bullet 行复用 V3 导出的 TourBullet，
 * 专属档位统一在 OnboardingTourScope.ts 以 defineScope 登记。
 *
 * 偏好自持：与桌面 v3（flow3）分键——手机档落 `onethu.onboarded.phone`（同一偏好家族，
 * 模块内读写，不新增状态机）；「不再显示」与看完压轴都落盘并入设置页「导览」重走口径。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { askNotifyPermissionOnce } from "../state/notifyPermissionAsk.js";
import { isPhoneNow, useIsPhone } from "../state/phoneSheets.js";
import { IconX } from "./Icons.js";
import { TourParticles } from "./OnboardingTourParticles.js";
import { TOUR_CARD_SCOPE, defineOnboardingScopes } from "./OnboardingTourScope.js";
import { OnboardingTourV3, TourBullet } from "./OnboardingTourV3.js";

defineOnboardingScopes();

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

/* ─── 骨架与桌面 V3 同构：步点走 Progress、文案走 Text 字阶（见其 TourBullet 导出） ─── */
const STEPS = 5;

interface Doc {
  title: string;
  lead: string;
  bullets: string[];
  foot?: string;
}

const DOCS: Doc[] = [
  {
    get title() { return i18n("components.onboardingtourmobile.1ef4be486cc7"); },
    get lead() { return i18n("components.onboardingtourmobile.37533b435eb5"); },
    get bullets() { return i18nList(["components.onboardingtourmobile.2a93d6c21509","components.onboardingtourmobile.60a2e62fe82d","components.onboardingtourmobile.7599c8d0f2fd","components.onboardingtourmobile.70bec8e88b2c"]); },
    get foot() { return i18n("components.onboardingtourmobile.98af2b06c2d8"); },
  },
  {
    get title() { return i18n("components.onboardingtourmobile.c765edddbdf2"); },
    get lead() { return i18n("components.onboardingtourmobile.c5c41a9591a1"); },
    get bullets() { return i18nList(["components.onboardingtourmobile.55a3f02850c2","components.onboardingtourmobile.854174121d0a"]); },
    get foot() { return i18n("components.onboardingtourmobile.ef3094385769"); },
  },
  {
    get title() { return i18n("components.onboardingtourmobile.0195603ee49e"); },
    get lead() { return i18n("components.onboardingtourmobile.76a3f832bbfa"); },
    get bullets() { return i18nList(["components.onboardingtourmobile.59acb966c21f","components.onboardingtourmobile.6aebf4025ba6","components.onboardingtourmobile.28bf4e9d8cc7"]); },
  },
  {
    get title() { return i18n("components.onboardingtourmobile.8a900694ff18"); },
    get lead() { return i18n("components.onboardingtourmobile.21d113f5a8e8"); },
    get bullets() { return i18nList(["components.onboardingtourmobile.6957eb34bc44","components.onboardingtourmobile.8201fca38b06","components.onboardingtourmobile.70297c6559a9"]); },
    get foot() { return i18n("components.onboardingtourmobile.7c100b50261d"); },
  },
  {
    get title() { return i18n("components.onboardingtourmobile.7c2809268e55"); },
    get lead() { return i18n("components.onboardingtourmobile.514adbf12726"); },
    bullets: [],
    get foot() { return i18n("components.onboardingtourmobile.67ab2cc6012c"); },
  },
];

export function OnboardingTourMobile(): ReactNode {
  const uiLocale = useUiLocale();

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
    <Sheet
      open={open}
      onClose={() => setOpen(false)}
      maskClose={false}
      closeButton={false}
      aria-label={i18n("components.onboardingtourmobile.29b54acdd26a")}
      scope={TOUR_CARD_SCOPE}
      foot={
        <Inline gap={2} vAlign="center" wrap>
          <Btn variant="outline" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>{i18n("components.onboardingtourmobile.da336fdc0dbd")}</Btn>
          <Spacer />
          <Btn variant="ghost" titleAttr={i18n("components.onboardingtourmobile.1f5a2b96e178")} onClick={closeForever}>{i18n("components.onboardingtourmobile.a2d3a4eeefd7")}</Btn>
          {isLast ? (
            <Btn variant="solid" tone="brand" onClick={closeForever}>{i18n("components.onboardingtourmobile.715ee9dc842f")}</Btn>
          ) : (
            <Btn variant="solid" tone="brand" onClick={() => setStep((s) => Math.min(STEPS - 1, s + 1))}>{i18n("components.onboardingtourmobile.acfc4e74a650")}</Btn>
          )}
        </Inline>
      }
    >
      <Stack gap={2}>
        {/* 头：步进度 + 关闭本次（不写偏好） */}
        <Inline gap={2} vAlign="center">
          <div aria-label={i18n("components.onboardingtourmobile.9552fe3bd366") + (step + 1) + i18n("components.onboardingtourmobile.fd73c2773154") + STEPS + i18n("components.onboardingtourmobile.e010e3f578cc")}>
            <Progress value={(step + 1) / STEPS} size="sm" />
          </div>
          <Spacer />
          <IconBtn label={i18n("components.onboardingtourmobile.285daf1ff2f1")} icon={<IconX width={14} height={14} />} onClick={() => setOpen(false)} />
        </Inline>

        {isLast ? <TourParticles /> : null}
        <Text slot="subtitle" as="h3">{doc.title}</Text>
        <Text as="p">{doc.lead}</Text>
        <Stack gap={1}>
          {doc.bullets.map((b) => (
            <TourBullet key={b}>{b}</TourBullet>
          ))}
        </Stack>
        {doc.foot ? <Text slot="label" tone="faint" as="p">{doc.foot}</Text> : null}
      </Stack>
    </Sheet>
  );
}

/** App.tsx 挂载点分流：手机 → 简版五步；桌面 → 桌面 V3 七步 */
export function OnboardingTourGate(): ReactNode {
  const uiLocale = useUiLocale();

  const phone = useIsPhone();
  if (phone) return <OnboardingTourMobile />;
  return <OnboardingTourV3 />;
}

