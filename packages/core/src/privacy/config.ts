/**
 * 脱敏开关（编译期常量，分支差异的唯一一处）。
 *
 * - 正式分支（dev3 / main）：恒为 `false` —— 不含任何运行时行为，数据原样透出。
 * - `demo` 分支：改为 `true` —— 构建出的 OneTHU Demo 在数据进入界面前做脱敏：
 *   姓名 / 学号 → 化名与编造学号；成绩 → 按 GRADE_SCALE 编造成绩；
 *   清洗 / 课表 / 教室 / 洗衣机等非敏感数据照旧走真实接口。
 *
 * 登录流程与正式版完全一致（真实清华统一认证 + 2FA），仅展示层被脱敏。
 */
export const DESENSITIZE_ENABLED = false;

/** 脱敏版应用标识（demo 分支构建时用于界面角标与日志；正式分支不使用）。 */
export const DESENSITIZE_BUILD_LABEL = "OneTHU Demo";
