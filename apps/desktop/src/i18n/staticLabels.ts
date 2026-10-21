import { t } from "./index.js";

/** Explicit labels for stable built-in IDs. Never apply to arbitrary user content. */
export function labelForId(value: string): string {
  switch (value) {
    case "雨课堂": return t("components.exthwsettingssection.38b9eabcae1b");
    case "TUOJ（AI 版）": return t("enum.label.tuojAI");
    case "TUOJ（经典版）": return t("enum.label.tuojClassic");
    case "OJ 平台": return t("enum.label.ojPlatforms");

    case "学习": return t("enum.label.2118cbc10988");
    case "日程": return t("enum.label.a14f23af7016");
    case "生活": return t("enum.label.15d208d1b4c9");
    case "预约": return t("enum.label.352cdc807892");
    case "行政": return t("enum.label.e79890c96ee6");
    case "插件": return t("enum.label.e806fbbe8ec6");
    case "全部": return t("enum.label.5c55a67935af");
    case "在线服务": return t("enum.label.1760b98532ec");
    case "科研": return t("enum.label.8289e67df525");
    case "人事": return t("enum.label.6ac380cbd716");
    case "党建": return t("enum.label.aaabe42b5a23");
    case "财务": return t("enum.label.506c068a2a1e");
    case "外事": return t("enum.label.b0938ffbd07c");
    case "采购": return t("enum.label.6e098153a586");
    case "实验设备": return t("enum.label.ef94275bd96f");
    case "资产": return t("enum.label.5f45bb826b16");
    case "校园生活": return t("enum.label.21255f717947");
    case "公共服务": return t("enum.label.3deae16f1adb");
    case "就业离校": return t("enum.label.a0f88ca9398c");
    case "满意度调查": return t("enum.label.31c5f1aaa0d5");
    case "北大": return t("enum.label.e310bbf0e506");
    case "北大研": return t("enum.label.a17b8666e5d9");
    case "北外": return t("enum.label.d7d6b21c2cf5");
    case "课程编号": return t("enum.label.e96da2049129");
    case "课程名称": return t("enum.label.bd2d74b297d1");
    case "总学时数": return t("enum.label.fc0c0d12a458");
    case "总学分": return t("enum.label.e842a5dff916");
    case "课程内容简介": return t("enum.label.3b806a76e492");
    case "Course Description": return t("enum.label.541fbddf4725");
    case "考核安排": return t("enum.label.be67cc45b9f0");
    case "联系人": return t("enum.label.3303b56982a0");
    case "教材及参考书": return t("enum.label.a914a7b52cec");
    case "上课教师": return t("enum.label.4a3572036143");
    case "选课指导语": return t("enum.label.8459c1e91bc0");
    case "先修要求": return t("enum.label.ea664afac033");
    case "教师教学特色": return t("enum.label.75bd5f68e277");
    case "Office Hour": return t("enum.label.1eed24ed8f6f");
    case "成绩评定标准": return t("enum.label.f2260568b289");
    case "参考书": return t("enum.label.f24ccb00a8ab");
    case "GitLab": return t("enum.label.9151a836f996");
    case "Info 应用": return t("enum.label.d4f7864690bb");
    case "courseX": return t("enum.label.26ee9467d4b0");
    case "体育": return t("enum.label.ef7be5be3c13");
    case "公共空间": return t("enum.label.e81059e1a712");
    case "图书馆": return t("enum.label.266e6cb77079");
    case "我的收藏夹": return t("enum.label.4c11cd93c142");
    case "操作": return t("enum.label.ed31fbb483ee");
    case "新闻": return t("enum.label.d39567b2b9f1");
    case "标签页": return t("enum.label.a626aad412b7");
    case "洗衣机": return t("enum.label.6acfa1db6a62");
    case "研讨间": return t("enum.label.e4d40b4d6759");
    case "空教室": return t("enum.label.ecc11c8afea8");
    case "组件": return t("enum.label.783d638053ea");
    case "网络学堂": return t("enum.label.aa39cac2b409");
    case "邮件": return t("enum.label.3d708e8e8b1f");
    case "页面": return t("enum.label.452c7b10d57a");
    default: return value;
  }
}
