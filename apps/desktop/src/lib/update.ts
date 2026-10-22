/** Build version and comparison shared by automatic reminders and the updater. */
export { dismissTag, isDismissed } from "./updateReminder.js";

/** 版本代号（随主版本更新） */
export const APP_CODENAME = "Revolution";
declare const __APP_VERSION__: string;

/** 关于页与构建元数据共用 package.json 注入的版本。 */
export const APP_VERSION_LABEL = __APP_VERSION__;

/** "v0.9.1"/"0.9.1-beta" → [0,9,1]（取前三段数字） */
function toTuple(v: string): number[] {
  return v
    .replace(/^[vV]/, "")
    .split(/[.\-+]/)
    .slice(0, 3)
    .map((x) => parseInt(x, 10) || 0);
}

export function isNewer(latest: string, current: string): boolean {
  const a = toTuple(latest);
  const b = toTuple(current);
  for (let i = 0; i < 3; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

/** 当前应用版本（构建期由 package.json 注入） */
export function currentVersion(): string {
  return __APP_VERSION__;
}
