/**
 * 插件通用表单弹窗（Promise 化）——插件经 onethu.ui.form(fields) 弹出结构化
 * 表单收集用户输入，resolve 为键值对象。DOM 覆盖层实现（Tauri WKWebView 的
 * 原生 window.prompt 静默返回 null，同 confirm.tsx 的教训）。
 * <FormModalHost/> 挂在应用根部一次即可。
 */
import { useSyncExternalStore } from "react";
import type { ReactNode } from "react";

export type FormField =
  | { key: string; label: string; kind?: "text" | "textarea" | "password"; placeholder?: string; default?: string; required?: boolean }
  | { key: string; label: string; kind: "select"; options: Array<{ value: string; label: string }>; default?: string; required?: boolean };

type Pending = {
  title: string;
  fields: FormField[];
  resolve: (v: Record<string, string> | null) => void;
};
let pending: Pending | null = null;
const listeners = new Set<() => void>();

export function openFormModal(title: string, fields: FormField[]): Promise<Record<string, string> | null> {
  return new Promise((resolve) => {
    // 新请求顶掉旧请求（旧者按取消结算，防悬挂）
    pending?.resolve(null);
    pending = { title, fields, resolve };
    listeners.forEach((l) => l());
  });
}

export function FormModalHost(): ReactNode {
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => pending,
    () => null,
  );
  if (!pending) return null;
  const close = (v: Record<string, string> | null): void => {
    pending?.resolve(v);
    pending = null;
    listeners.forEach((l) => l());
  };
  const fields = pending.fields;
  const title = pending.title;
  const draft: Record<string, string> = {};
  for (const f of fields) draft[f.key] = f.default ?? (f.kind === "select" ? f.options[0]?.value ?? "" : "");
  return (
    <div className="plg-form-overlay" onClick={() => close(null)}>
      <div className="plg-form-modal" onClick={(e) => e.stopPropagation()}>
        <div className="plg-form-title">{title}</div>
        {fields.map((f) => (
          <label key={f.key} className="plg-form-field">
            <span className="plg-form-label">
              {f.label}
              {f.required ? <i style={{ color: "var(--red)", fontStyle: "normal" }}> *</i> : null}
            </span>
            {f.kind === "textarea" ? (
              <textarea
                className="input"
                rows={4}
                placeholder={f.placeholder}
                defaultValue={draft[f.key]}
                onChange={(e) => (draft[f.key] = e.target.value)}
              />
            ) : f.kind === "select" ? (
              <select className="input" defaultValue={draft[f.key]} onChange={(e) => (draft[f.key] = e.target.value)}>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            ) : (
              <input
                className="input"
                type={f.kind === "password" ? "password" : "text"}
                placeholder={f.placeholder}
                defaultValue={draft[f.key]}
                onChange={(e) => (draft[f.key] = e.target.value)}
              />
            )}
          </label>
        ))}
        <div className="plg-form-ops">
          <button className="btn btn-ghost" onClick={() => close(null)}>取消</button>
          <button
            className="btn btn-primary"
            onClick={() => {
              for (const f of fields) {
                if (f.required && !String(draft[f.key] ?? "").trim()) return;
              }
              close(draft);
            }}
          >
            提交
          </button>
        </div>
      </div>
    </div>
  );
}
