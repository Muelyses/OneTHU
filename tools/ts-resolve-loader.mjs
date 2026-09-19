/** 测试用解析钩子：core 旧源码以 .js 后缀相互引用（tsc bundler 解析），
 *  Node 直跑时回退到同名 .ts，让 core 单元可在无编译产物下直测。 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export async function resolve(specifier, context, next) {
  if (specifier.endsWith(".js") && context.parentURL?.startsWith("file:")) {
    const candidate = fileURLToPath(new URL(specifier, context.parentURL));
    if (!existsSync(candidate) && existsSync(candidate.replace(/\.js$/, ".ts"))) {
      return next(specifier.replace(/\.js$/, ".ts"), context);
    }
  }
  return next(specifier, context);
}
