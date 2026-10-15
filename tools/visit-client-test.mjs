#!/usr/bin/env node
/**
 * 临时来访人员报备客户端的**离线协议回归**（2026-10-15 REA 实测形状的钉子）。
 *
 * 全部走替身取数：不发任何真实请求。钉住的是「服务端长什么样、我们怎么解」——
 * 将来官方改字段名/改包封（code/message/data）时，这里先红，而不是用户先发现表单空了。
 * 运行：node --import ./tools/ts-resolve-register.mjs tools/visit-client-test.mjs
 */
import assert from "node:assert/strict";
import { VisitApiError, VisitClient, buildVisitTestModel, visitTokenExpiresAt } from "./lib/visit-test-fixtures.mjs";

/* ── ① token 到期解析 ── */
const payload = Buffer.from(JSON.stringify({ aud: "2025013332", exp: 1792103166 })).toString("base64url");
const fakeJwt = `header.${payload}.sig`;
assert.equal(visitTokenExpiresAt(fakeJwt), 1792103166 * 1000, "JWT 到期时刻要按 exp 解析（毫秒）");
assert.equal(visitTokenExpiresAt("not-a-jwt"), null, "解不出要返回 null（按未知处理，不当作已过期）");

/* ── ② 取数替身：按 REA 实测形状回包 ── */
const calls = [];
const M = buildVisitTestModel();
const routes = (url, init) => {
  const u = new URL(url);
  const p = u.pathname.replace("/visitor/mbpm", "");
  calls.push(`${init?.method ?? "GET"} ${p}`);
  const envelope = (data) => new Response(JSON.stringify({ code: 200, message: "success", data }), { status: 200, headers: { "content-type": "application/json" } });
  if (p === "/identity/ssoLogin") return envelope({ token: fakeJwt, user: { userId: "2025013332", userName: "郭嘉乐", userNo: "2025013332", orgName: "组织机构", roles: [] } });
  if (p === "/function/getAllMobileMenus") return envelope([{ path: "/a", name: "a", isCatalog: true, meta: { title: "临时来访报备" }, children: [{ path: "/a/b", name: "b", isCatalog: false, meta: { title: "亲友来访报备", url: "inviteVisitList" }, children: [] }] }]);
  if (p === "/form/preLoad") return envelope(JSON.stringify({ ftid: "ftid-1", publishedDate: 1754559157000, frontParam: "fp-1" }));
  if (p.startsWith("/form/load/")) return envelope(JSON.stringify(M.model));
  if (p === "/form-select/getSelectItemsData") return envelope(JSON.stringify({ mfield16: [{ label: "亲友来访", value: "5" }, { label: "其它", value: "4" }] }));
  if (p === "/form/loadData") return envelope({ total: 2, rows: [{ mBizId: "biz-1", mfield2: "2026-09-28 00:00:00", mBizStatus: "3", createDate: "2026-09-28 12:23:25", mfield12: "5" }] });
  if (p === "/form-collaborate/isSelectTransition") return envelope(JSON.stringify({ flag: "false" }));
  if (p === "/form-collaborate/createAndStartProcess") return envelope({ ok: true });
  return new Response(JSON.stringify({ code: 404, message: "no_model_msg", data: null }), { status: 200 });
};

const client = new VisitClient({ fetch: async (u, init) => routes(u, init) });

/* ── ③ 登录：checkSingle 那条路（不吃密码）+ 换 token ── */
const html = `登录确认<form action="/do/off/ui/auth/login/checkSingle" method="POST"><input type="hidden" name="i_rem"/></form>` +
  `<a href="/visitor/mobile/sso?ticket=TICKET-ABC">继续</a>`;
const loginCalls = [];
const loginClient = new VisitClient({
  fetch: async (u, init) => {
    loginCalls.push(new URL(u).pathname);
    if (u.includes("id.tsinghua.edu.cn")) {
      // 会话活着时 ITS 给「确认页」：没有 SM2 公钥、只有一个 checkSingle 表单（不吃密码）
      const body = init?.method === "POST" ? html : '<form action="/do/off/ui/auth/login/checkSingle" method="POST" id="logined"><input type="hidden" name="i_rem" value="1"/></form>';
      return new Response(body, { status: 200, headers: { "set-cookie": "JSESSIONID=its-1; Path=/" } });
    }
    return Promise.resolve(routes(u, init));
  },
});
const user = await loginClient.login("2025013332", "secret", "fp", "fp3");
assert.equal(user?.userName, "郭嘉乐", "统一身份那一步之后要能换到内部登录态并带回姓名");
assert.equal(loginClient.session().token, fakeJwt, "token 要落进登录态（与 cookie 成对）");
assert.ok(loginCalls.some((p) => p.endsWith("/checkSingle")), "会话活着时走的是确认页那条路");
assert.ok(loginCalls.some((p) => p === "/visitor/mbpm/identity/ssoLogin"), "换 token 走 identity/ssoLogin");

/* ── ④ 目录 / 表单模型 / 字典 / 我的报备 ── */
const menus = await client.menus();
assert.equal(menus[0].children[0].title, "亲友来访报备", "功能目录按 meta.title 归一化（小程序与网页同一份）");

const model = await client.formModel("appointmentsFamilyArea", { mBizId: "biz", pdid: "pd", adid: "ad" });
assert.equal(model.ftid, "76d44d3e-6cd0-4472-8685-dbfc89c5ee91", "表单模型的 ftid 取服务端下发值");
assert.ok(calls.some((c) => c.includes("/form/load/appointmentsFamilyArea_1754559157000.json")), "取模型要用 preLoad 给的发布日期拼文件名");
assert.ok(model.fields.some((f) => f.key === "mfield2" && f.label === "来访日期"), "来访日期要认出来");
assert.deepEqual(model.visitorFields.filter((f) => f.required).map((f) => f.key), ["sfield2", "sfield3"], "明细表必填项 = 身份证号 + 手机号");
assert.ok(model.confirmLabel.includes("本人知晓并同意"), "「本人确认」整句承诺要原样带出（页面上照抄，不自己写）");
const preloadCall = calls.find((c) => c.endsWith("/form/preLoad"));
assert.ok(preloadCall, "表单模型必须先走 preLoad（否则服务端回 no_model_msg）");

const options = await client.catalogOptions("mfield16", "adedf886-2c8e-46e5-807b-92328ef844e8");
assert.deepEqual(options[0], { label: "亲友来访", value: "5" }, "下拉字典按组件 key 取（sourceSelect 结构不能改）");

const mine = await client.myReports();
assert.equal(mine.total, 2, "我的报备要带回总数");
assert.equal(mine.rows[0].visitDate, "2026-09-28 00:00:00", "来访日期按服务端原样保留");
assert.equal(mine.rows[0].status, "3", "状态码原样保留（字典未公开，不替服务端编文案）");

/* ── ⑤ 提交前的硬门槛：没勾确认 / 证件不齐 都不许发 ── */
const draft = { visitDate: "2026-10-16", visitors: [{ idCard: "110101199001010011", mobile: "13800000000" }], confirmed: true };
await assert.rejects(() => client.submitReport({ ...draft, confirmed: false }, model), VisitApiError, "没勾「本人确认」必须直接拒绝");
await assert.rejects(
  () => client.submitReport({ ...draft, visitors: [{ idCard: "", mobile: "13800000000" }] }, model),
  VisitApiError,
  "身份证号为空必须直接拒绝（不许把半条报备发到学校系统）",
);
assert.ok(!calls.some((c) => c.includes("createAndStartProcess")), "上面两次都不该触到提交端点");

/* ── ⑥ 提交路径：isSelectTransition 先探分支，再 createAndStartProcess ── */
const before = calls.length;
await client.submitReport(draft, model);
const tail = calls.slice(before).map((c) => c.split(" ")[1]);
assert.deepEqual(tail, ["/form-collaborate/isSelectTransition", "/form-collaborate/createAndStartProcess"], "提交顺序：先探流转分支，再建流程");
const sent = client.buildReportForm(draft, model);
assert.equal(sent.get("mfield2"), "2026-10-16", "来访日期映射到 mfield2");
assert.equal(sent.get("plateId"), "cb862bfa-4402-49f2-9999-18c89877b2b7", "plateId 必须是那条流程的业务号");
assert.equal(sent.get("pdid"), "centralizedDeclaraTeachOnPrivateProcess", "流程定义号要带对");
assert.ok(String(sent.get("appointmentsFamilyArea2EditList[1].sfield2")).length > 0, "来访人明细按序号提交");

console.log("结果：来访报备客户端的登录 / 表单 / 字典 / 列表 / 提交门槛与顺序全部按实测形状对得上 ✓");
