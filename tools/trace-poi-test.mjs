/**
 * 寻迹 POI 落点选择测试（纯函数）。
 *
 * 这段判读决定「前往」按钮把用户带到哪栋楼，全是启发式规则，错了就是把人导到别的学校去：
 * 实测查「清华大学第一教学楼」，高德第一条海淀结果是「北京林业大学第一教学楼」
 * （地址「清华东路35号北京林业大学」——「清华」是路名）。逐条钉住。
 *
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/trace-poi-test.mjs
 */
const { pickPoi, poiRank, isTsinghuaPoi, withCampusPrefix } = await import("../apps/desktop/src/lib/poiPick.ts");

let pass = 0, fail = 0;
const eq = (name, a, b) => {
  if (JSON.stringify(a) === JSON.stringify(b)) pass++;
  else { fail++; console.error(`✗ ${name}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);
const P = (name, address, district = "海淀区") => ({ lng: 116.3, lat: 40.0, name, address, district });

/* ① 校园前缀兜底 */
{
  eq("补前缀", withCampusPrefix("第一教学楼"), "清华大学第一教学楼");
  eq("已有前缀不重复加", withCampusPrefix("清华大学第六教学楼"), "清华大学第六教学楼");
  eq("「清华园」开头也不重复加", withCampusPrefix("清华园车站"), "清华园车站");
  eq("空串原样", withCampusPrefix("  "), "");
}

/* ② 清华园判读：外校同名楼必须被排除 */
{
  ok("北林的第一教学楼不算清华园", !isTsinghuaPoi(P("北京林业大学第一教学楼", "清华东路35号北京林业大学")));
  ok("清华大学的楼算", isTsinghuaPoi(P("清华大学第一教室楼", "双清路30号")));
  ok("地址提到清华园也算", isTsinghuaPoi(P("某楼", "清华园1号")));
  ok("别家大学的楼一律不算", !isTsinghuaPoi(P("北京大学某楼", "颐和园路5号北京大学")));
}

/* ③ 落点选择：这是「北京林业大学一教」那个 bug 的回归测试 */
{
  const westwood = [
    P("北京林业大学第一教学楼", "清华东路35号北京林业大学"),
    P("清华大学西楼", "近春路清华园住宅小区内"),
    P("清华大学第三教室楼一段", "双清路30号清华大学第三教学楼"),
  ];
  eq("候选里有外校同名楼时选校内的", pickPoi(westwood, "清华大学第一教学楼").name, "清华大学西楼");
  const real = [
    P("清华大学第一教室楼(东门)", "双清路30号清华大学第一教室楼"),
    P("清华大学第一教室楼", "双清路30号"),
  ];
  eq("有本体时优先本体而不是东门", pickPoi(real, "清华大学第一教室楼").name, "清华大学第一教室楼");
  eq("非海淀候选一律不考虑", pickPoi([P("清华大学某楼", "双清路30号", "朝阳区")], "清华大学某楼"), null);
  eq("空候选返回 null（宁可不定位，也不指错楼）", pickPoi([], "x"), null);
}

/* ④ 排序细节：附属设施与分区让位给本体 */
{
  eq("完全同名最优", poiRank(P("清华大学建筑馆"), "清华大学建筑馆") < poiRank(P("清华大学建筑馆报告厅"), "清华大学建筑馆"), true);
  eq("检索词是名字的延长时选本体而非北门", poiRank(P("清华大学舜德楼"), "清华大学舜德楼北") < poiRank(P("清华大学舜德楼(北门)"), "清华大学舜德楼北"), true);
  eq("停车场排在本体之后", poiRank(P("清华大学综合体育中心"), "清华大学综合体育馆") < poiRank(P("清华大学综合体育馆周边停车场"), "清华大学综合体育馆"), true);
  const stadium = [
    P("清华大学综合体育馆周边停车场", "双清路30号清华大学"),
    P("清华大学综合体育馆", "双清路30号清华大学"),
    P("清华大学综合体育中心", "成府路45-1号清华园1号清华大学"),
  ];
  eq("综合体育馆：选中本体而不是周边停车场", pickPoi(stadium, "清华大学综合体育馆").name, "清华大学综合体育馆");
  const third = [
    P("清华大学第三教室楼三段", "双清路30号清华大学"),
    P("清华大学第三教室楼", "双清路30号清华大学"),
  ];
  eq("第三教室楼：选不带分区后缀的那个", pickPoi(third, "清华大学第三教室楼").name, "清华大学第三教室楼");
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
