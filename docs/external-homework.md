# 外部作业源（exthw）

把非网络学堂的作业系统（雨课堂、TUOJ、Tyche）拉进统一的作业页：聚合截止、真实提交
判定、已批改得分，与原生作业并存。插件侧经 `onethu.exthw.snapshot()/refresh()`
消费（见 [api-reference.md §6](./api-reference.md)）。

## 1. 三源一览

| 源 | id | 登录方式 | 自动恢复 |
|---|---|---|---|
| 雨课堂 | `yuketang` | 扫码（长轮询）/ 短信（已停用，官方加图形验证码）/ 官方网页登录（应用内 WebView 读回 Cookie） | 扫码被掐同 token 续轮询；前台服务保活 |
| TUOJ（AI 版） | `tuoj` | 清华统一认证（复用主会话漫游）+ TUOJ 账密（可选） | 401/403 静默重漫游一次并重拉 |
| TUOJ（经典版） | `tuojClassic` | 同上 | 同上 |
| Tyche | `tyche` | 清华统一认证漫游 | 同 TUOJ 链路 |

## 2. 提交与批改判定

- **`submitted`（真实判定）**：三源各自查提交状态；查询失败/无法判定（如雨课堂试卷
  类叶子无权限）**保守为 false**。
- **雨课堂已批改**（R16）：`get_exercise_list` 的 status 4/3 + 分值占位符；作业/试卷
  深链走学生端 `/ai-workspace/lms-graph/...`。
- **Tyche 已批改**（R19 27.2）：`task/Status.submissionList[]`（pid/score/result/
  submitedTime）按 pid 取最新提交汇总——每题都有有效得分 → `graded=true`，
  `score=Σ`，`totalScore=100×题数`。

## 3. 会话失效自动恢复（R19 27.1）

TUOJ 系 401/403 时**静默自动重漫游一次并自动重拉**——此前只在「该源未配置」时触发，
已配置但 cookie 失效这条路径没有恢复手段。

| 约束 | 值 |
|---|---|
| 频控 | 同源两次自动重试 ≥10 分钟；每进程每源 ≤3 次 |
| 并发 | 同源 401 共享 in-flight Promise（去重） |
| 显式退出 | 用户登出后抑制自动重登 |
| 失败兜底 | 作业页条幅「已尝试自动重新登录，仍失败：<原因>」+ 去设置重登入口 |

## 4. 设置页

设置 → 外部作业源：按 OJ 平台归组（TUOJ AI 版 / 经典版 / Tyche / 雨课堂）；
扫码面板在移动端全屏 + 前台服务保活（常驻通知防 MIUI 冻结）；「另一台设备扫码 +
保持前台」提示。

## 5. 开发者：新增一个作业源

1. **core**：`packages/core/src/exthw/` 新建 `<source>.ts`，实现
   `ExternalHomework[]`（必填 id/source/courseName/title/deadline/kind；submitted
   真实判定；url 尽量给深链）。类型加进 `types.ts` 与 `index.ts` 导出。
2. **注册**：`ExtHwSourceId` 联合类型 + `extHwSourceName()` 显示名 + 设置页分组。
3. **凭据**：若需独立凭据，走 `ExtHwCreds` 结构与设置页表单；统一认证系源复用主会话
   漫游，不需要。
4. **测试**：`tools/exthw-status-test.mjs` 加断言（mock 数据，不依赖真实网络）；
   有登录态的再补 `tools/exthw-smoke.mjs` 真数据 smoke。
5. **文档**：本文件 §1 表格加一行；登录/自动恢复的源特有行为写进 §2/§3。

## 6. 测试与真数据验证

| 工具 | 覆盖 |
|---|---|
| `tools/exthw-status-test.mjs` | 聚合状态机 / 判定 / 频控（169 断言） |
| `tools/tuoj-cas-test.mjs` | CAS 漫游 / 2FA 文案 / 重漫游 |
| `tools/ykt-qr-test.mjs` | 扫码状态机 / 保活生命周期 / 传输超时 |
| `tools/exthw-smoke.mjs` | 真凭据 smoke（3/3 源成功 + Tyche 400/400 判定实录） |
