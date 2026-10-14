/* OneGUI · 表单族：全站唯一的输入件（Input / TextArea / Search / Number / Select / Check / Radio / Switch / Slider）
 *
 * 所有控件共享同一个"壳"（.og-input）：边框、底色、聚焦环、尺寸档、无效态都在壳里，
 * 页面永远拿不到改这些的能力 —— 想特殊就登记 scope，或者要求加一个正经变体。
 * UX 与旧实现保持一致：回车提交、Esc 清空搜索、拖拽用 pointer capture、方向键调值。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cx, one, scopeProps, type OGSize, type OneBase } from "./kit.js";

/* ── 字段包装 ─────────────────────────────────────────────────────────── */

export interface FieldProps extends OneBase {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
}

export function Field({ label, hint, error, required, scope, className, children }: FieldProps): ReactNode {
  return (
    <div {...scopeProps(scope)} className={cx("og-field", className)}>
      {label ? (
        <span className="og-field-label">
          {label}
          {required ? <span className="og-field-required" aria-hidden="true">*</span> : null}
        </span>
      ) : null}
      {children}
      {error ? <span className="og-field-error">{error}</span> : hint ? <span className="og-field-hint">{hint}</span> : null}
    </div>
  );
}

/* ── 输入壳（内部共用） ───────────────────────────────────────────────── */

interface ShellProps {
  size?: OGSize;
  invalid?: boolean;
  disabled?: boolean;
  focused: boolean;
  className?: string;
  children: ReactNode;
}

function Shell({ size, invalid, disabled, focused, className, children }: ShellProps): ReactNode {
  return (
    <div
      className={cx(
        one("input").size(size).state("invalid", invalid).state("disabled", disabled).state("focused", focused).toString(),
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ── Input ───────────────────────────────────────────────────────────── */

export interface InputProps extends OneBase {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  onEnter?: (value: string) => void;
  onEscape?: (value: string) => void;
  onFocusChange?: (focused: boolean) => void;
  placeholder?: string;
  type?: "text" | "password" | "email" | "tel" | "url" | "search" | "number";
  size?: OGSize;
  disabled?: boolean;
  readOnly?: boolean;
  invalid?: boolean;
  icon?: ReactNode;
  trailing?: ReactNode;
  name?: string;
  inputMode?: "text" | "numeric" | "decimal" | "tel" | "email" | "url" | "search";
  autoComplete?: string;
  autoFocus?: boolean;
  maxLength?: number;
  spellCheck?: boolean;
  /** 键盘处理：用方法语法声明 —— 参数按双变检查，既接受按具体元素注解的处理器，也能上下文推断 */
  onKeyDown?(e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): void;
  "aria-label"?: string;
}

export function Input({
  value, defaultValue, onChange, onEnter, onEscape, onFocusChange, placeholder, type = "text", size = "md",
  disabled, readOnly, invalid, icon, trailing, scope, className, name, inputMode, autoComplete, autoFocus, maxLength,
  spellCheck, onKeyDown, ...aria
}: InputProps): ReactNode {
  const [focused, setFocused] = useState(false);
  return (
    <Shell size={size} invalid={invalid} disabled={disabled} focused={focused} className={className}>
      {icon ? <span className="og-input-icon" aria-hidden="true">{icon}</span> : null}
      <input
        {...scopeProps(scope)}
        className="og-input-el"
        type={type}
        value={value}
        defaultValue={defaultValue}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        name={name}
        inputMode={inputMode}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        maxLength={maxLength}
        spellCheck={spellCheck}
        aria-invalid={invalid || undefined}
        aria-label={aria["aria-label"]}
        onChange={(e) => onChange?.(e.target.value)}
        onFocus={() => { setFocused(true); onFocusChange?.(true); }}
        onBlur={() => { setFocused(false); onFocusChange?.(false); }}
        onKeyDown={(e) => {
          onKeyDown?.(e);
          if (e.key === "Enter") onEnter?.((e.target as HTMLInputElement).value);
          if (e.key === "Escape") onEscape?.((e.target as HTMLInputElement).value);
        }}
      />
      {trailing ? <span className="og-input-icon">{trailing}</span> : null}
    </Shell>
  );
}

/* ── TextArea ────────────────────────────────────────────────────────── */

export interface TextAreaProps extends Omit<InputProps, "type" | "icon" | "inputMode" | "maxLength"> {
  rows?: number;
  autoGrow?: boolean;
  maxRows?: number;
}

export function TextArea({ value, defaultValue, onChange, onFocusChange, placeholder, size = "md", disabled, readOnly, invalid, rows = 4, autoGrow, maxRows, scope, className, autoFocus, spellCheck, onKeyDown }: TextAreaProps): ReactNode {
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (!autoGrow || !ref.current) return;
    const el = ref.current;
    el.style.height = "auto";
    const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight) || 20;
    const max = (maxRows ?? 12) * lineHeight;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }, [autoGrow, maxRows, value, defaultValue]);
  return (
    <Shell size={size} invalid={invalid} disabled={disabled} focused={focused} className={cx("og-input--area", className)}>
      <textarea
        ref={ref}
        {...scopeProps(scope)}
        className="og-input-el"
        rows={rows}
        value={value}
        defaultValue={defaultValue}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        autoFocus={autoFocus}
        spellCheck={spellCheck}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange?.(e.target.value)}
        onFocus={() => { setFocused(true); onFocusChange?.(true); }}
        onBlur={() => { setFocused(false); onFocusChange?.(false); }}
        onKeyDown={onKeyDown}
      />
    </Shell>
  );
}

/* ── SearchField ─────────────────────────────────────────────────────── */

export interface SearchFieldProps extends Omit<InputProps, "type" | "icon"> {
  /** 回车提交（搜索"真正生效"的时机由调用方决定） */
  onSearch?: (value: string) => void;
}

export function SearchField({ onSearch, onEnter, onEscape, value, defaultValue, onChange, size = "md", scope, className, placeholder = "搜索", ...rest }: SearchFieldProps): ReactNode {
  const [inner, setInner] = useState(defaultValue ?? "");
  const controlled = value !== undefined;
  const current = controlled ? value : inner;
  const set = useCallback((v: string) => {
    if (!controlled) setInner(v);
    onChange?.(v);
  }, [controlled, onChange]);
  return (
    <Input
      {...rest}
      {...scopeProps(scope)}
      className={cx("og-input--search", className)}
      size={size}
      value={current}
      placeholder={placeholder}
      icon={<svg className="og-icon og-icon--sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round"><circle cx="11" cy="11" r="6" /><path d="m20 20-4.3-4.3" /></svg>}
      trailing={current ? (
        <button type="button" className="og-input-clear" aria-label="清空" onClick={() => { set(""); onSearch?.(""); }}>×</button>
      ) : null}
      onChange={set}
      onEnter={(v) => { onSearch?.(v); onEnter?.(v); }}
      onEscape={(v) => { set(""); onEscape?.(v); }}
    />
  );
}

/* ── NumberField ─────────────────────────────────────────────────────── */

export interface NumberFieldProps extends Omit<InputProps, "type" | "onChange" | "value" | "defaultValue" | "icon"> {
  value?: number;
  defaultValue?: number;
  onChange?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}

export function NumberField({ value, defaultValue, onChange, min, max, step = 1, unit, scope, className, disabled, size = "md", ...rest }: NumberFieldProps): ReactNode {
  const [inner, setInner] = useState(defaultValue ?? 0);
  const controlled = value !== undefined;
  const current = controlled ? value : inner;
  const clamp = useCallback((n: number) => {
    let v = n;
    if (min !== undefined && v < min) v = min;
    if (max !== undefined && v > max) v = max;
    return v;
  }, [min, max]);
  const set = useCallback((n: number) => {
    const v = clamp(n);
    if (!controlled) setInner(v);
    onChange?.(v);
  }, [clamp, controlled, onChange]);
  const [focused, setFocused] = useState(false);
  return (
    <div {...scopeProps(scope)} className={cx("og-number", className)}>
      <button type="button" className="og-number-btn" aria-label="减" aria-disabled={min !== undefined && current <= min} onClick={() => set(current - step)}>−</button>
      <Shell size={size} disabled={disabled} focused={focused}>
        <input
          className="og-input-el"
          type="number"
          inputMode="decimal"
          value={String(current)}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(e) => {
            const n = Number.parseFloat(e.target.value);
            if (!Number.isNaN(n)) set(n);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          {...rest}
        />
        {unit ? <span className="og-input-icon">{unit}</span> : null}
      </Shell>
      <button type="button" className="og-number-btn" aria-label="加" aria-disabled={max !== undefined && current >= max} onClick={() => set(current + step)}>+</button>
    </div>
  );
}

/* ── Select ──────────────────────────────────────────────────────────── */

export interface SelectOption { value: string; label: string; disabled?: boolean }

export interface SelectProps extends OneBase {
  /** 原生 select 接受 number，这里也接受（内部转字符串；onChange 一律回 string） */
  value?: string | number;
  defaultValue?: string | number;
  onChange?: (value: string) => void;
  options?: SelectOption[];
  children?: ReactNode;
  placeholder?: string;
  size?: OGSize;
  disabled?: boolean;
  invalid?: boolean;
  "aria-label"?: string;
}

export function Select({ value, defaultValue, onChange, options, children, placeholder, size = "md", disabled, invalid, scope, className, ...aria }: SelectProps): ReactNode {
  return (
    <div {...scopeProps(scope)} className={cx(one("select").size(size).toString(), className)}>
      <Shell size={size} invalid={invalid} disabled={disabled} focused={false}>
        <select
          className="og-input-el og-select-el"
          value={value === undefined ? undefined : String(value)}
          defaultValue={defaultValue === undefined ? undefined : String(defaultValue)}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-label={aria["aria-label"]}
          onChange={(e) => onChange?.(e.target.value)}
        >
          {placeholder ? <option value="" disabled>{placeholder}</option> : null}
          {options ? options.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>) : children}
        </select>
        <svg className="og-icon og-icon--sm og-select-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round"><path d="m6 9 6 6 6-6" /></svg>
      </Shell>
    </div>
  );
}

/* ── Checkbox / Radio ────────────────────────────────────────────────── */

export interface CheckboxProps extends OneBase {
  checked?: boolean;
  defaultChecked?: boolean;
  indeterminate?: boolean;
  onChange?: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
}

export function Checkbox({ checked, defaultChecked, indeterminate, onChange, label, disabled, scope, className }: CheckboxProps): ReactNode {
  const [inner, setInner] = useState(defaultChecked ?? false);
  const on = checked ?? inner;
  return (
    <label {...scopeProps(scope)} className={cx(one("check").state("checked", on).state("indeterminate", indeterminate).state("disabled", disabled).toString(), className)}>
      <span className="og-check-box">
        <input
          type="checkbox"
          checked={on}
          disabled={disabled}
          onChange={(e) => {
            if (checked === undefined) setInner(e.target.checked);
            onChange?.(e.target.checked);
          }}
        />
      </span>
      {label !== undefined ? <span className="og-check-label">{label}</span> : null}
    </label>
  );
}

export interface RadioProps extends OneBase {
  value: string;
  label?: ReactNode;
  disabled?: boolean;
  checked?: boolean;
  onChange?: (value: string) => void;
  name?: string;
}

export function Radio({ value, label, disabled, checked, onChange, name, scope, className }: RadioProps): ReactNode {
  return (
    <label {...scopeProps(scope)} className={cx(one("check").variant("radio").state("checked", checked).state("disabled", disabled).toString(), className)}>
      <span className="og-check-box">
        <input type="radio" name={name} value={value} checked={checked} disabled={disabled} onChange={() => onChange?.(value)} />
      </span>
      {label !== undefined ? <span className="og-check-label">{label}</span> : null}
    </label>
  );
}

export interface RadioGroupProps extends OneBase {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  direction?: "row" | "column";
}

export function RadioGroup({ children, direction = "column", scope, className }: RadioGroupProps): ReactNode {
  return (
    <div {...scopeProps(scope)} className={cx("og-radiogroup", direction === "row" ? "og-radiogroup--row" : "", className)} role="radiogroup">
      {children}
    </div>
  );
}

/* ── Switch ──────────────────────────────────────────────────────────── */

export interface SwitchProps extends OneBase {
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
}

export function Switch({ checked, defaultChecked, onChange, disabled, scope, className, ...aria }: SwitchProps): ReactNode {
  const [inner, setInner] = useState(defaultChecked ?? false);
  const on = checked ?? inner;
  const toggle = (): void => {
    if (disabled) return;
    if (checked === undefined) setInner(!on);
    onChange?.(!on);
  };
  return (
    <span
      {...scopeProps(scope)}
      className={cx(one("switch").state("checked", on).state("disabled", disabled).toString(), className)}
      role="switch"
      aria-checked={on}
      aria-disabled={disabled || undefined}
      aria-label={aria["aria-label"]}
      tabIndex={disabled ? -1 : 0}
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggle(); }
      }}
    >
      <span className="og-switch-thumb" />
    </span>
  );
}

/* ── Slider / RangeSlider ────────────────────────────────────────────── */

export interface SliderProps extends OneBase {
  value?: number;
  defaultValue?: number;
  onChange?: (value: number) => void;
  /** 松手时回调（只在提交点触发，用于落盘/请求） */
  onCommit?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  showValue?: boolean;
  format?: (value: number) => string;
  "aria-label"?: string;
}

function useSliderGeometry(min: number, max: number) {
  return useCallback((n: number) => {
    const ratio = max === min ? 0 : (n - min) / (max - min);
    return `${Math.max(0, Math.min(1, ratio)) * 100}%`;
  }, [min, max]);
}

export function Slider({ value, defaultValue, onChange, onCommit, min = 0, max = 100, step = 1, disabled, showValue, format, scope, className, ...aria }: SliderProps): ReactNode {
  const [inner, setInner] = useState(defaultValue ?? min);
  const current = value ?? inner;
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const pos = useSliderGeometry(min, max)(current);

  const commit = useCallback((n: number, final: boolean) => {
    let v = Math.round((n - min) / step) * step + min;
    v = Math.max(min, Math.min(max, v));
    if (value === undefined) setInner(v);
    onChange?.(v);
    if (final) onCommit?.(v);
  }, [min, max, step, value, onChange, onCommit]);

  const fromEvent = useCallback((clientX: number, final: boolean) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const ratio = (clientX - rect.left) / rect.width;
    commit(min + ratio * (max - min), final);
  }, [commit, min, max]);

  return (
    <div
      {...scopeProps(scope)}
      className={cx(one("slider").state("disabled", disabled).state("dragging", dragging).toString(), className)}
    >
      <div
        ref={trackRef}
        className="og-slider-track"
        onPointerDown={(e) => {
          if (disabled) return;
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          setDragging(true);
          fromEvent(e.clientX, false);
        }}
        onPointerMove={(e) => { if (dragging && !disabled) fromEvent(e.clientX, false); }}
        onPointerUp={(e) => { if (!dragging) return; setDragging(false); fromEvent(e.clientX, true); }}
        onPointerCancel={() => setDragging(false)}
      >
        <span className="og-slider-fill" data-og-dynamic="slider" style={{ ["--og-c-slider-pos" as string]: pos } as React.CSSProperties} />
        <span
          className="og-slider-thumb"
          data-og-dynamic="slider"
          style={{ ["--og-c-slider-pos" as string]: pos } as React.CSSProperties}
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={current}
          aria-label={aria["aria-label"]}
          aria-disabled={disabled || undefined}
          onKeyDown={(e) => {
            if (disabled) return;
            const big = step * 10;
            const map: Record<string, number> = { ArrowRight: current + step, ArrowUp: current + step, ArrowLeft: current - step, ArrowDown: current - step, PageUp: current + big, PageDown: current - big, Home: min, End: max };
            const next = map[e.key];
            if (next !== undefined) { e.preventDefault(); commit(next, true); }
          }}
        />
      </div>
      {showValue ? <span className="og-slider-value">{format ? format(current) : current}</span> : null}
    </div>
  );
}

export interface RangeSliderProps extends Omit<SliderProps, "value" | "defaultValue" | "onChange" | "onCommit"> {
  value?: [number, number];
  defaultValue?: [number, number];
  onChange?: (value: [number, number]) => void;
  onCommit?: (value: [number, number]) => void;
}

export function RangeSlider({ value, defaultValue, onChange, onCommit, min = 0, max = 100, step = 1, disabled, showValue, scope, className }: RangeSliderProps): ReactNode {
  const [inner, setInner] = useState<[number, number]>(defaultValue ?? [min, max]);
  const [a, b] = value ?? inner;
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState<"a" | "b" | null>(null);
  const pct = useSliderGeometry(min, max);

  const commit = useCallback((next: [number, number], final: boolean) => {
    const clamp = (n: number): number => Math.max(min, Math.min(max, Math.round((n - min) / step) * step + min));
    let [x, y] = [clamp(next[0]), clamp(next[1])];
    if (x > y) [x, y] = [y, x];
    if (value === undefined) setInner([x, y]);
    onChange?.([x, y]);
    if (final) onCommit?.([x, y]);
  }, [min, max, step, value, onChange, onCommit]);

  const fromEvent = useCallback((clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return min;
    return min + ((clientX - rect.left) / rect.width) * (max - min);
  }, [min, max]);

  const pick = useCallback((n: number): "a" | "b" => (Math.abs(n - a) <= Math.abs(n - b) ? "a" : "b"), [a, b]);

  return (
    <div {...scopeProps(scope)} className={cx(one("slider").variant("range").state("disabled", disabled).toString(), className)}>
      <div
        ref={trackRef}
        className="og-slider-track"
        onPointerDown={(e) => {
          if (disabled) return;
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          const n = fromEvent(e.clientX);
          const which = pick(n);
          setActive(which);
          commit(which === "a" ? [n, b] : [a, n], false);
        }}
        onPointerMove={(e) => {
          if (!active || disabled) return;
          const n = fromEvent(e.clientX);
          commit(active === "a" ? [n, b] : [a, n], false);
        }}
        onPointerUp={(e) => {
          if (!active) return;
          const n = fromEvent(e.clientX);
          commit(active === "a" ? [n, b] : [a, n], true);
          setActive(null);
        }}
        onPointerCancel={() => setActive(null)}
      >
        <span className="og-slider-fill" data-og-dynamic="slider" style={{ ["--og-c-slider-pos-a" as string]: pct(a), ["--og-c-slider-pos-b" as string]: pct(b) } as React.CSSProperties} />
        <span className="og-slider-thumb" data-og-dynamic="slider" style={{ ["--og-c-slider-pos" as string]: pct(a) } as React.CSSProperties} role="slider" tabIndex={disabled ? -1 : 0} aria-valuemin={min} aria-valuemax={max} aria-valuenow={a} aria-label="下限" />
        <span className="og-slider-thumb" data-og-dynamic="slider" style={{ ["--og-c-slider-pos" as string]: pct(b) } as React.CSSProperties} role="slider" tabIndex={disabled ? -1 : 0} aria-valuemin={min} aria-valuemax={max} aria-valuenow={b} aria-label="上限" />
      </div>
      {showValue ? <span className="og-slider-value">{a}–{b}</span> : null}
    </div>
  );
}
