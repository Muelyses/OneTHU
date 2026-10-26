import type { Schema } from '../validation.js';
export interface OperationContext {
  beforeWrite(): Promise<void>;
  signal: AbortSignal;
  deadline: number;
}
export interface ServiceOperation {
  name: string;
  description: string;
  parameters: Schema;
  permission: string;
  mutation?: boolean;
  authenticated?: boolean;
  localOnly?: boolean;
  run(args: any[], context: OperationContext): unknown | Promise<unknown>;
}
export const tuple = (items: Schema[], required = items.length): Schema => ({ type: 'array', items, minItems: required, maxItems: items.length, additionalItems: false });
export const string = { type: 'string', minLength: 1, maxLength: 4096 };
export const object = { type: 'object' };
