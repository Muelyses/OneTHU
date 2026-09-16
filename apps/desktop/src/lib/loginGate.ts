/** 全局登录节流闸（2026-09-17 实录：恢复环每秒整套登录链，id 服务器对设备
 *  限流——落地页变封锁页，public key 全家失败）。一次尝试计入冷却，成败都算。
 *  独立模块：clients ↔ infoLib 循环依赖，两边都要无环引用它。 */
let lastLoginAttemptAt = 0;
const COOLDOWN_MS = 20_000;

export function markLoginAttempt(): void {
  lastLoginAttemptAt = Date.now();
}

export function loginCooldownLeftMs(): number {
  return Math.max(0, COOLDOWN_MS - (Date.now() - lastLoginAttemptAt));
}

/** 「Failed to get public key」= 落地封锁页（id 按会话 cookie 封设备）。
 *  下次 libLogin 前清原生 cookie 仓换新身份（一次性）。 */
let loginFailedPublicKey = false;

export function markLoginFailedPublicKey(): void {
  loginFailedPublicKey = true;
}

export function consumeLoginFailedPublicKey(): boolean {
  const v = loginFailedPublicKey;
  loginFailedPublicKey = false;
  return v;
}
