/**
 * 二级课表格子 id 解析单测（修复「周5第4大节 被读成 周4第5大节」的回归）。
 *
 * 真机实录（2026-09-20，实验室科研探究 / 二级课表）：
 *   getElementById('a4_5') ↔ overlib '04_54( 待定，第4周)'  → 周五第4大节
 *   getElementById('a4_4') ↔ '05_44(…)'
 *   getElementById('a3_3') ↔ '06_33(…)'
 * 即：格子 id = a{节次}_{星期}，提示串末两位 = 星期+节次（两者倒序）。
 * info app 的 parseScript 也正是 basic[1]=节次、basic[3]=星期。
 *
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/secondary-anchor-test.mjs
 */
const { parseCellAnchor } = await import("../packages/core/src/zhjwxk/anchor.ts");

let pass = 0, fail = 0;
const eq = (name, a, b) => {
  if (JSON.stringify(a) === JSON.stringify(b)) pass++;
  else { fail++; console.error(`✗ ${name}: 实际 ${JSON.stringify(a)} 期望 ${JSON.stringify(b)}`); }
};

// 真机样本：格子 id → 节次/星期（与 overlib 末两位互为倒序）
eq("a4_5 = 第4大节·周五", parseCellAnchor("a4_5"), { session: 4, day: 5 });
eq("a4_4 = 第4大节·周四", parseCellAnchor("a4_4"), { session: 4, day: 4 });
eq("a3_3 = 第3大节·周三", parseCellAnchor("a3_3"), { session: 3, day: 3 });
eq("a1_4 = 第1大节·周四（此前被读成周一第4节）", parseCellAnchor("a1_4"), { session: 1, day: 4 });
eq("a6_1 = 第6大节·周一", parseCellAnchor("a6_1"), { session: 6, day: 1 });
eq("a2_7 = 第2大节·周日", parseCellAnchor("a2_7"), { session: 2, day: 7 });

// 越界与畸形一律拒绝（宁可少一条记录，也不猜错时间）
eq("节次 0 越界", parseCellAnchor("a0_3"), null);
eq("节次 7 越界（节次只到 6）", parseCellAnchor("a7_3"), null);
eq("星期 8 越界", parseCellAnchor("a3_8"), null);
eq("空串", parseCellAnchor(""), null);
eq("非格子 id", parseCellAnchor("strHTML"), null);

// 与提示串的一致性：末两位 = 星期+节次（真机三个样本闭环）
for (const [gid, tip] of [["a4_5", "04_54"], ["a4_4", "05_44"], ["a3_3", "06_33"]]) {
  const { session, day } = parseCellAnchor(gid);
  eq(`${gid} 与提示串 ${tip} 一致（${tip.slice(3)} = 周${day}节${session}）`,
     `${day}${session}`, tip.slice(3));
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
