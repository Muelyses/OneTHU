/**
 * 在线服务名的口语容错匹配。
 *
 * 为什么单独一个模块：用户嘴里说的是「亲友预约」，学校门户里叫「亲友来访预约」——
 * 严格子串匹配会漏（"亲友预约" 不是 "亲友来访预约" 的子串），于是 OH 会答「本机没有
 * 这个入口」。这里给出可解释的打分规则，并让插件门面（services.search）与测试共用。
 */
export function normalizeServiceName(v: string): string {
  return v
    .toLowerCase()
    .replace(/[\s·・、，,。.：:（）()【】\[\]《》<>「」"']/g, "");
}

/** 匹配打分：完全相等 100 > 包含 80+ > 反向包含 70 > 子序列 40+；0 = 不匹配 */
export function serviceScore(name: string, query: string): number {
  const n = normalizeServiceName(name);
  const q = normalizeServiceName(query);
  if (!n || !q) return 0;
  if (n === q) return 100;
  if (n.includes(q)) return 80 + Math.min(15, (q.length / n.length) * 15);
  if (q.includes(n)) return 70;
  // 子序列：口语名常省中间字（亲友预约 ⊂ 亲友来访预约）
  let i = 0;
  for (const ch of n) {
    if (ch === q[i]) i += 1;
    if (i >= q.length) break;
  }
  if (i >= q.length) return 40 + (q.length / n.length) * 20;
  return 0;
}
