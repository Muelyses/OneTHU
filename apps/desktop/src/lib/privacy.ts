/**
 * 脱敏层在应用侧的挂载点：把「所有取数入口」的返回值统一过一遍 desensitizeTree。
 *
 * - 用 Proxy 包住客户端实例（learn / info / thu-info-lib helper）：**方法名无需登记**，
 *   新增接口自动生效，不存在「忘了挂」的漏点。
 * - 正式分支 DESENSITIZE_ENABLED=false 时，desensitizeTree 原样返回，包裹几乎零开销；
 *   demo 分支打开后，姓名 / 学号 / 成绩在离开客户端的那一刻就被替换，界面代码零改动。
 */
import { desensitizeTree, isDesensitizeBuild, maskName, maskStudentId } from "@onethu/core";

/** 是否当前构建为脱敏版（界面据此显示角标）。 */
export const DESENSITIZE_BUILD = isDesensitizeBuild();

/** 包一层：同步与异步返回值都过脱敏；其它属性原样透传。 */
export function withPrivacy<T extends object>(target: T, seed: string): T {
  if (!DESENSITIZE_BUILD) return target;
  return new Proxy(target, {
    get(obj, prop, recv) {
      const value = Reflect.get(obj, prop, recv) as unknown;
      if (typeof value !== "function") return value;
      return (...args: unknown[]): unknown => {
        const label = `${seed}.${String(prop)}`;
        const out = (value as (...a: unknown[]) => unknown).apply(obj, args);
        if (out && typeof (out as { then?: unknown }).then === "function") {
          return (out as Promise<unknown>).then((r) => desensitizeTree(r, label));
        }
        return desensitizeTree(out, label);
      };
    },
  }) as T;
}

/** 单个值（状态层的 user、插件 push 的数据等）走这层。 */
export function maskValue<T>(value: T, seed = "value"): T {
  return desensitizeTree(value, seed);
}

/** 展示真实姓名（如登录账号对应的姓名）时使用：脱敏版替换为化名。 */
export function displayNameOf(real: string | undefined | null): string {
  if (!real) return real ?? "";
  return DESENSITIZE_BUILD ? maskName(real) : real;
}

/** 展示学号 / 登录账号时使用：脱敏版替换为编造学号（登录凭据本身仍是真实值）。 */
export function displayStudentId(real: string | undefined | null): string {
  if (!real) return real ?? "";
  return DESENSITIZE_BUILD ? maskStudentId(real) : real;
}
