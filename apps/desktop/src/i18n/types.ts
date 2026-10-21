import type { ReactNode } from "react";

/** Registered locale filenames supply the codes; adding a language needs no union edit. */
export type Locale = string;
export interface LocaleDef {
  label: string;
  messages: Readonly<Record<string, string>>;
}
export type MessageValue = string | number | boolean | null | undefined;
export type MessageParams = Readonly<Record<string, MessageValue>>;
export interface MessageDescriptor {
  readonly kind: "i18n";
  readonly key: string;
  readonly params?: MessageParams;
}
/** Raw plugin/user text is intentionally not translated. */
export type UiText = string | MessageDescriptor;
export type RichSlots = Readonly<Record<string, ReactNode>>;
export type PluralMessages = Readonly<Partial<Record<Intl.LDMLPluralRule, string>> & { other: string }>;
