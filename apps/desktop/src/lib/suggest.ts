/**
 * 「猜你喜欢」推荐：**纯本机、可解释、不写收藏**。
 *
 * 输入只有两样：本机使用统计（lib/usage.ts）与静态原子注册表（页面 / 今日组件）。
 * 规则（刻意做得简单、可解释——推荐不该是个黑盒）：
 *   1. 先按「用户用得最多的那几个分组」找同类里的其它页面（同类 = 同一 group）；
 *   2. 再补上「默认藏在『添加卡片』里、多数人其实天天用」的起步项；
 *   3. 已用过的、已经收进收藏夹的、注册表里解析不出的，一律不推。
 * 永远不会替用户收藏任何东西——卡片点开即跳转，收不收由用户自己按星号。
 */
import { PAGE_ATOMS, WIDGET_ATOMS } from "../state/atoms.js";
import { loadFavs, atomKeyOf, type AtomRef } from "../state/favorites.js";
import { recentAtomUses, topAtomUses } from "./usage.js";

export interface Suggestion {
  ref: AtomRef;
  title: string;
  sub?: string;
  group: string;
  /** 一句话说明「为什么推给你」（界面直接显示，务必短） */
  why: string;
}

/** 起步项：必须是**真实存在的页面原子 key**（此前写了 "thos"，注册表里没有这个 key，
 *  会被 resolveAtom 静默丢掉——推荐位看着"没内容"就是这么来的）。 */
const STARTER_KEYS = [
  "reserve-lib",
  "reserve-classroom",
  "reserve-sports",
  "learn-assignments",
  "learn-search",
  "mail",
];

function favIds(): Set<string> {
  const out = new Set<string>();
  try {
    const d = loadFavs();
    for (const f of Object.values(d.folders)) {
      for (const it of f.items) if (it.t === "a") out.add(atomKeyOf(it.atom));
    }
  } catch {
    /* 收藏读不出来就别排除，宁可多推一条 */
  }
  return out;
}

/** 推荐条目（最多 limit 条；无依据可推时返回空数组，界面整卡隐藏） */
export function suggestAtoms(limit = 5): Suggestion[] {
  // 与收藏用的同一套身份归一（atomKeyOf），否则「课程 A 的作业」这类多段 key 对不上
  const used = new Set(recentAtomUses(60).map((e) => atomKeyOf({ kind: e.kind, key: e.key })));
  const favs = favIds();
  const affinity = new Set(topAtomUses(5).map((e) => e.group).filter((g): g is string => !!g));

  const pool: Suggestion[] = [
    ...PAGE_ATOMS.map((a) => ({
      ref: { kind: "page", key: a.key } as AtomRef,
      title: a.title,
      sub: a.sub,
      group: a.group,
    })),
    ...WIDGET_ATOMS.map((a) => ({
      ref: { kind: "widget", key: a.key } as AtomRef,
      title: a.title,
      sub: a.sub,
      group: a.group,
    })),
  ].map((x) => ({ ...x, why: "" }));

  const out: Suggestion[] = [];
  const taken = new Set<string>();
  const pushIfFree = (s: Suggestion) => {
    const id = atomKeyOf(s.ref);
    if (used.has(id) || favs.has(id) || taken.has(id)) return;
    taken.add(id);
    out.push(s);
  };

  // ① 同类推荐：用户常出现的分组里，他还没碰过的页面
  if (affinity.size > 0) {
    for (const s of pool) {
      if (!affinity.has(s.group)) continue;
      pushIfFree({ ...s, why: "和你在用的地方同类" });
      if (out.length >= limit) return out;
    }
  }

  // ② 起步项：默认收在「添加卡片」里、但基本人人要用
  for (const key of STARTER_KEYS) {
    if (out.length >= limit) break;
    const s = pool.find((x) => x.ref.kind === "page" && x.ref.key === key);
    if (s) pushIfFree({ ...s, why: "多数人天天用" });
  }

  // ③ 还不够就按注册表顺序补（仍排除已用/已收藏），说明留白
  for (const s of pool) {
    if (out.length >= limit) break;
    pushIfFree({ ...s, why: "顺手看看" });
  }
  return out;
}
