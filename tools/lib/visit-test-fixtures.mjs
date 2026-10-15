/** 来访报备测试替身：表单模型取 2026-10-15 REA 实测结构（字段名/必填/确认句都是服务端原样）。 */
import * as core from "../../packages/core/src/visit/client.ts";

export const VisitClient = core.VisitClient;
export const VisitApiError = core.VisitApiError;
export const visitTokenExpiresAt = core.visitTokenExpiresAt;

export function buildVisitTestModel() {
  return {
    model: {
      formDid: "appointmentsFamilyArea",
      formName: "来访报备",
      ftid: "76d44d3e-6cd0-4472-8685-dbfc89c5ee91",
      list: [
        { type: "splitline", key: "splitline001", name: "来访基本信息" },
        {
          type: "Select",
          components: [
            { type: "select", key: "mfield16", title: "来访事由", catalogId: "adedf886-2c8e-46e5-807b-92328ef844e8", catalogType: "code", required: false, readonly: false },
            { type: "date", key: "mfield2", title: "来访日期", required: false, readonly: false },
          ],
        },
        {
          type: "EditList",
          key: "appointmentsFamilyArea2EditList",
          // 实测形状：列在 columns 下（不是 list）
          columns: [
            { type: "input", key: "sfield1", title: "来访人姓名", required: false, readonly: false },
            { type: "input", key: "sfield2", title: "来访人身份证", required: true, readonly: false },
            { type: "input", key: "sfield3", title: "来访人手机号", required: true, readonly: false },
            { type: "select", key: "sfield6", title: "入校校门", catalogId: "879f3fbc-e798-4c94-8ddc-7ccf42f9833f", catalogType: "code", required: false, readonly: false },
          ],
        },
        {
          type: "checkbox",
          key: "mfield17",
          styleClass: "term-checkbox",
          labelValue: "本人确认来访亲友关系属实、身份真实、来访事由合理、程序正当……本人知晓并同意：如存在为无关人员报备，学校将取消本人报备权限。",
        },
      ],
    },
  };
}
