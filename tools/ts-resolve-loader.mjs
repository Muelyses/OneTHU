/** 测试用解析钩子：core 旧源码以 .js 后缀相互引用（tsc bundler 解析），
 *  Node 直跑时回退到同名 .ts，让 core 单元可在无编译产物下直测。
 *
 *  做法是「先按原样解析，失败再试 .ts」而不是先做文件存在性判断：后者对
 *  裸包路径（`@onethu/core/src/learn/time.js`）会因为拼不出真实磁盘路径而失效，
 *  而裸包路径正是跨包复用窄模块（如纯计算内核）要用的写法。 */
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (e) {
    if (e?.code === "ERR_MODULE_NOT_FOUND" && specifier.endsWith(".js")) {
      return next(specifier.replace(/\.js$/, ".ts"), context);
    }
    throw e;
  }
}
