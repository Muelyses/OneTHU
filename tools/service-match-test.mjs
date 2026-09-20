/**
 * 在线服务名的口语容错匹配（回归护栏）。
 * 事故原型：用户说「打开亲友预约」，门户里的正式名是「亲友来访预约」，严格子串匹配
 * 漏掉 → OH 回「本机没有这个入口」，用户白问一轮。
 */
import assert from "node:assert/strict";
import { normalizeServiceName, serviceScore } from "../apps/desktop/src/lib/serviceMatch.ts";

const hit = (name, q) => serviceScore(name, q) > 0;
const miss = (name, q) => serviceScore(name, q) === 0;

// ① 事故原型：省字/换词的口语名必须命中
assert.ok(hit("亲友来访预约", "亲友预约"), "亲友预约 应命中 亲友来访预约");
assert.ok(hit("亲友来访预约", "亲友来访"), "前缀应命中");
assert.ok(hit("亲友入校报备", "亲友入校"), "前缀应命中亲友入校报备");
const weak = serviceScore("亲友入校报备", "亲友来访");
assert.ok(weak > 0 && weak < 40, "「亲友」同前缀 → 候选档（低于把握线，不自动打开）");

// ② 常规：完全相等 > 包含 > 反向包含，且排序可用
assert.ok(serviceScore("亲友来访预约", "亲友来访预约") > serviceScore("亲友来访预约", "亲友"), "完全相等应最高");
assert.ok(serviceScore("补办学生证", "学生证") > serviceScore("补办学生证", "补办"), "包含更贴合的应更高");

// ③ 归一化：大小写/空格/标点/全角括号不该影响
assert.equal(serviceScore("VPN 申请（校内）", "vpn申请校内"), serviceScore("vpn申请校内", "vpn申请校内"), "归一化后应完全相等");

// ④ 不相干的名字必须为 0（否则会把用户带到错的页面）
assert.ok(miss("会议活动及场地申请", "亲友预约"), "无关服务不应命中");
assert.ok(miss("在读证明申请", "研讨间"), "无关服务不应命中");
assert.equal(serviceScore("亲友来访预约", ""), 0, "空查询为 0");

// ⑤ 近似档：换了后半截但关键词一致 → 低分候选（不该自动跳转）
const near = serviceScore("亲友入校报备", "亲友预约");
assert.ok(near > 0, "亲友预约 应把 亲友入校报备 列为候选");
assert.ok(near < 40, "近似档必须低于把握线（只看候选、不自动打开）");
assert.ok(serviceScore("亲友来访预约", "亲友预约") >= 40, "子序列档应达到把握线（可直达）");

// ⑥ 子序列分档：省字越多分越低，供排序用
const tight = serviceScore("亲友来访预约", "亲友来访");
const loose = serviceScore("亲友来访预约", "亲友预约");
assert.ok(tight > loose, "省字更少的口语名应排更前");

console.log("结果：在线服务口语名匹配 ✓（10 组断言）");
