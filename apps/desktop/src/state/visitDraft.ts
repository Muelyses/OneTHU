/**
 * 来访报备草稿（OH / 插件 → 报备页面的**唯一**交接面）。
 *
 * 为什么单独落一格状态：OH 与页面之间不能互相 import（页面在 pages/，OH 走插件门面），
 * 只有经过这里才能做到「OH 说一句话 → 表单被填好」。约定三条：
 *   ① 只能**填充**草稿：提交永远由用户在页面上点「提交报备」并勾选确认；
 *   ② 页面消费掉草稿后立刻清空（clearVisitDraft），避免下次进页面又被旧草稿覆盖；
 *   ③ 订阅用版本号（useSyncExternalStore 可直接用 visitDraftVersion 当快照）。
 */
import type { VisitReportDraft } from "@onethu/core";

export type VisitDraftPatch = Partial<VisitReportDraft>;

let pending: VisitDraftPatch | null = null;
let version = 0;
const subs = new Set<() => void>();

function emit(): void {
  for (const f of subs) f();
}

/** OH / 插件调用：把准备好的内容放进来（合并式，多次调用以后一次为准） */
export function requestVisitDraft(patch: VisitDraftPatch): void {
  pending = { ...(pending ?? {}), ...patch };
  version += 1;
  emit();
}

export function peekVisitDraft(): VisitDraftPatch | null {
  return pending;
}

/** 页面消费后清空（消费方负责，见 VisitTab） */
export function clearVisitDraft(): void {
  if (pending === null) return;
  pending = null;
  version += 1;
  emit();
}

export function subscribeVisitDraft(f: () => void): () => void {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
}

export function visitDraftVersion(): number {
  return version;
}
