/**
 * 在线服务名的口语容错匹配。
 *
 * 为什么单独一个模块：用户嘴里说的是「亲友预约」，门户里可能叫「亲友来访预约」
 * （省字）甚至「亲友入校报备」（换了后半截）——严格子串匹配会全部漏掉，于是 OH
 * 只能答「本机没有这个入口」，用户白问一轮。这里给出可解释的分档规则，插件门面
 * （services.search）与测试共用。
 *
 * 分档（分数越高越像）：
 *   100        完全相等
 *   80 ~ 95    名字包含查询（越长越像）
 *   70         查询包含名字（用户说得比正式名还长）
 *   40 ~ 60    子序列命中：省字但顺序一致（亲友预约 ⊂ 亲友来访预约）
 *   20 ~ 35    近似命中：最长公共子串 ≥2 字（亲友预约 ↔ 亲友入校报备）——
 *              这一档只作为**候选**给用户确认，不该直接跳转
 *   0          不匹配
 */
export const SERVICE_CONFIDENT = 40;

export function normalizeServiceName(v: string): string {
  return v
    .toLowerCase()
    .replace(/[\s·・、，,。.：:（）()【】\[\]《》<>「」"']/g, "");
}

/** 最长公共子串长度（中文按字比较；用于「换了后半截」的近似判定） */
function longestCommonSubstring(a: string, b: string): number {
  if (!a || !b) return 0;
  let best = 0;
  const prev: number[] = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    let diag = 0;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = prev[j] ?? 0;
      const cur = a[i - 1] === b[j - 1] ? diag + 1 : 0;
      prev[j] = cur;
      diag = tmp;
      if (cur > best) best = cur;
    }
  }
  return best;
}

/** 匹配打分：见文件头分档表；0 = 不匹配 */
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
  // 近似：换了后半截但前缀/关键词一致（亲友预约 ↔ 亲友入校报备）。
  // 中文 2 字共享已足够有意义；拉丁文要求 4 字，避免 "on"/"app" 这类噪声。
  const lcs = longestCommonSubstring(n, q);
  const cjk = /[\u4e00-\u9fff]/.test(q);
  const need = cjk ? 2 : 4;
  if (lcs >= need) return 20 + Math.min(15, lcs * 3);
  return 0;
}
