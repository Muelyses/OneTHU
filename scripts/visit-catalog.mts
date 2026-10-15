/** 词典/下拉候选源探测：找出「来访类别/区域/事由/人员类型/入校校门」这些 code 目录的取数端点。 */
import { visitLogin } from "./lib/visit-login.mjs";

const CATALOGS = {
  来访类别: "cf4fcbf4-0141-42ec-867f-0f4a9fecffbe",
  来访区域: "33e78deb-4c98-4d4d-81db-95bdb45f79eb",
  来访事由: "adedf886-2c8e-46e5-807b-92328ef844e8",
  人员类型: "06fcb4c9-ba9d-48e9-acd8-43f4c7a34df1",
  入校校门: "879f3fbc-e798-4c94-8ddc-7ccf42f9833f",
};
const cid = CATALOGS.来访事由;

const http = await visitLogin();
console.log(`[cat] 登录成功 token=${http.token.slice(0, 12)}… cookie=${http.cookies.split(";")[0]}`);

const candidates = [
  `/form-select/getSelectItemsData?catalogId=${cid}&catalogType=code`,
  `/form-select/getCodeItems?catalogId=${cid}&catalogType=code`,
  `/form-select/getItems?catalogId=${cid}&catalogType=code`,
  `/form-select/getSelectData?catalogId=${cid}&catalogType=code`,
  `/form-catalog/getItems?catalogId=${cid}&catalogType=code`,
  `/catalog/getCodeItems?catalogId=${cid}`,
  `/code/getItems?catalogId=${cid}`,
  `/form/getCodeItems?catalogId=${cid}&catalogType=code`,
  `/form-code/getItems?catalogId=${cid}`,
  `/form-expression/codeItems?catalogId=${cid}`,
];
for (const p of candidates) {
  const r = await http.get(p);
  const body = r.text.slice(0, 160).replace(/\s+/g, " ");
  console.log(`  ${p.slice(0, 60)} -> ${r.status} ${body}`);
}
