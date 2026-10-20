import { Input, Modal, Stack } from "@onethu/gui";
import { Select } from "@onethu/gui";
import { Btn } from "@onethu/gui";
/**
 * 插件通用表单弹窗（Promise 化）——插件经 onethu.ui.form(fields) 弹出结构化
 * 表单收集用户输入，resolve 为键值对象。DOM 覆盖层实现（Tauri WKWebView 的
 * 原生 window.prompt 静默返回 null，同 confirm.tsx 的教训）。
 * <FormModalHost/> 挂在应用根部一次即可。
 */
import { useMemo, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { useOverlayBack } from "../state/navStack.js";
import { resolveMessage, t, useLocale, type UiText } from "../i18n/index.js";

export interface FormField {
  key: string;
  label: UiText;
  kind?: "text" | "textarea" | "password" | "select";
  placeholder?: UiText;
  options?: Array<{ value: string; label: UiText }>;
  default?: string;
  required?: boolean;
}

type Pending = {
  title: UiText;
  fields: FormField[];
  resolve: (v: Record<string, string> | null) => void;
};
let pending: Pending | null = null;
const listeners = new Set<() => void>();

export function openFormModal(title: UiText, fields: FormField[]): Promise<Record<string, string> | null> {
  return new Promise((resolve) => {
    // 新请求顶掉旧请求（旧者按取消结算，防悬挂）
    pending?.resolve(null);
    pending = { title, fields, resolve };
    listeners.forEach((l) => l());
  });
}

export function FormModalHost(): ReactNode {
  useLocale();
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => pending,
    () => null,
  );
  const draft = useMemo<Record<string,string>>(()=>Object.fromEntries((pending?.fields??[]).map(f=>[f.key,f.default??(f.kind==="select"?f.options?.[0]?.value??"":"")])),[pending]);
  const close = (v: Record<string, string> | null): void => {
    pending?.resolve(v);
    pending = null;
    listeners.forEach((l) => l());
  };
  useOverlayBack("shared-form-modal", Boolean(pending), () => close(null));
  if (!pending) return null;
  const fields = pending.fields;
  const title = resolveMessage(pending.title);
  return (
    <Modal open title={title} onClose={()=>close(null)} className="plg-form-modal" size="sm">
      <Stack gap={3}>
        {fields.map((f) => (
          <label key={f.key} className="plg-form-field">
            <span className="plg-form-label">
              {resolveMessage(f.label)}
              {f.required ? <i style={{ color: "var(--red)", fontStyle: "normal" }}> *</i> : null}
            </span>
            {f.kind === "textarea" ? (
              <textarea
                className="input"
                rows={4}
                placeholder={resolveMessage(f.placeholder)}
                defaultValue={draft[f.key]}
                onChange={(e) => (draft[f.key] = e.target.value)}
              />
            ) : f.kind === "select" ? (
              <Select defaultValue={draft[f.key]} onChange={(value) => (draft[f.key] = value)}>{(f.options ?? []).map((o) => (
                  <option key={o.value} value={o.value}>{resolveMessage(o.label)}</option>
                ))}</Select>
            ) : (
              <Input type={f.kind === "password" ? "password" : "text"} placeholder={resolveMessage(f.placeholder)} defaultValue={draft[f.key]} onChange={(value) => (draft[f.key] = value)} />
            )}
          </label>
        ))}
        <div className="plg-form-ops">
          <Btn variant="ghost" onClick={() => close(null)}>{t("common.cancel")}</Btn>
          <Btn variant="solid" tone="brand" onClick={() => {
              for (const f of fields) {
                if (f.required && !String(draft[f.key] ?? "").trim()) return;
              }
              close(draft);
            }}>{t("common.submit")}
          </Btn>
        </div>
      </Stack>
    </Modal>
  );
}
