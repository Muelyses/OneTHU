# 外部作业源

清华大学的课程作业分布在多个系统中：网络学堂仅覆盖其中一部分，雨课堂承载课堂练习与
试卷，TUOJ 承载编程作业（AI 版与经典版两个实例），Tyche 承载部分院系的作业，DSA OJ
承载数据结构课的 OJ 作业。

外部作业源功能将上述系统的作业聚合到应用的作业页面，提供统一的截止时间展示、提交
状态判定与批改结果。插件通过 `onethu.exthw.snapshot()` 与 `onethu.exthw.refresh()`
使用该功能（见 [api-reference.md §4](./api-reference.md)）。

本文档说明各源的接入与凭据维护方式、故障恢复机制，以及新增作业源的实现步骤。

## 1. 数据模型

所有源统一映射为 `ExternalHomework`：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 源内唯一标识，用于列表去重 |
| `source` | string | 源标识，见 §2 |
| `courseName` / `title` | string | 课程名与作业标题 |
| `deadline` | string | 截止时间，格式 `"YYYY-MM-DD HH:MM"` |
| `kind` | `"homework"` \| `"exam"` | 作业或试卷 |
| `url` | string? | 详情链接 |
| `submitted` | boolean | 提交状态 |
| `graded` | boolean? | 批改状态，仅部分源提供 |
| `score` | number? | 得分，仅已批改时有效 |

## 2. 源与登录方式

| 源 | 标识 | 登录方式 | 恢复机制 |
|---|---|---|---|
| 雨课堂 | `yuketang` | 扫码登录（长轮询）；官方网页登录（应用内 WebView 读取 Cookie）。短信通道已停用，官方已增加图形验证码校验 | 传输层中断按未扫码处理，沿用同一令牌继续轮询；移动端由前台服务保活 |
| TUOJ（AI 版） | `tuoj` | 复用清华统一认证会话漫游；可选配置 TUOJ 独立账密 | 接口返回 401 / 403 时自动重新漫游一次 |
| TUOJ（经典版） | `tuojClassic` | 同上 | 同上 |
| Tyche | `tyche` | 复用清华统一认证会话漫游 | 同 TUOJ |
| DSA OJ | `dsa` | 邮箱 + 密码登录（站点无统一认证，仅手动账密）；亦可手填会话 Cookie | 会话失效抛 `DsaSessionError`，由设置页引导重新登录；不自动重漫游 |

## 3. 状态判定

**提交状态**：由各源独立查询得出。查询失败或无法判定时（例如雨课堂试卷类条目缺少
访问权限）统一判定为未提交，避免出现「已提交」的误报。DSA OJ 属此类：其
`assignment.status` 字段语义尚未确认（R15 20.1 实测未定），故保守判定为未提交，
待真机联调后补判定。

**批改状态**：

- 雨课堂：读取 `get_exercise_list` 返回的 `status` 字段（取值 4 与 3 表示已批改），
  并结合分值占位符判定；作业与试卷的详情链接指向学生端页面
  `/ai-workspace/lms-graph/...`。
- Tyche：读取 `task/Status` 的 `submissionList[]`（含 `pid`、`score`、`result`、
  `submitedTime`），按 `pid` 取最新一次提交汇总。所有题目均有有效得分时判定为已
  批改，`score` 为各题得分之和。
- DSA OJ：不提供批改结果——课程详情接口的 `assignmentList[]` 只有标题与截止时间，
  无得分字段，故 `graded` 与 `score` 恒为空。

## 4. 会话失效恢复

TUOJ 系源在接口返回 401 或 403 时自动重新漫游一次并重新拉取数据。此前的自动漫游仅
在源未配置时触发，已配置但凭据失效的情况缺少恢复手段。

| 约束 | 取值 |
|---|---|
| 重试间隔 | 同一源两次自动重试间隔不小于 10 分钟 |
| 重试上限 | 每进程每源不超过 3 次 |
| 并发处理 | 同一源的并发 401 共享同一请求 |
| 退出抑制 | 用户显式退出登录后不自动重登 |
| 失败提示 | 自动重登仍失败时，作业页显示提示条并附设置页重登入口 |

DSA OJ 不接入清华统一认证，没有可用的自动恢复通道：会话失效时（`user.php`
`checklogin` 返回未登录、业务 `error≠0`、或响应非 JSON）抛出 `DsaSessionError`，
由作业页错误提示与设置页重登入口引导用户重新输入邮箱与密码。

## 5. 新增作业源

1. **实现数据获取**：在 `packages/core/src/exthw/` 下新增源实现文件，返回
   `ExternalHomework[]`。提交与批改状态需真实查询得出，无法判定时判定为未提交。
   类型定义加入 `types.ts` 并从 `index.ts` 导出。
2. **注册源标识**：扩展 `ExtHwSourceId` 联合类型，在 `extHwSourceName()` 中补充显示
   名称，并在设置页按平台归组。
3. **处理凭据**：需要独立凭据的源使用 `ExtHwCreds` 结构并在设置页提供表单；复用清华
   统一认证的源不需要独立凭据。无统一认证的站点（如 DSA OJ）在 `login.ts` 中实现
   账密登录工具函数，登录成功后拼出会话 Cookie 交回设置页保存。
4. **补充测试**：在 `tools/exthw-status-test.mjs` 中增加断言（使用模拟数据，不依赖
   真实网络）；具备登录态的源可在 `tools/exthw-smoke.mjs` 中增加真实数据验证。
5. **更新文档**：在本文档 §2 表格中新增一行，源特有的登录与恢复行为补充至 §3、§4。

## 6. 界面与测试

**设置页**：设置 → 外部作业源，按平台归组。移动端扫码面板为全屏显示，并提示使用
另一台设备扫码、保持应用在前台。DSA OJ 位于「OJ 平台」分组（默认折叠），提供邮箱 +
密码登录，并保留手填会话 Cookie 的高级入口。

**测试工具**：

| 工具 | 覆盖范围 |
|---|---|
| `tools/exthw-status-test.mjs` | 聚合状态机、状态判定、频控逻辑；DSA OJ 的 `endDate` 容错解析与会话失效判定 |
| `tools/tuoj-cas-test.mjs` | CAS 漫游、二次认证提示、重新漫游 |
| `tools/ykt-qr-test.mjs` | 扫码状态机、保活服务生命周期、传输层超时 |
| `tools/exthw-smoke.mjs` | 真实凭据下的端到端验证（环境变量 `YKT_COOKIE`、`TUOJ_COOKIE`、`TUOJ_CLASSIC_COOKIE`、`TYCHE_COOKIE`、`DSA_COOKIE`） |

## 7. 接入记录

各源的接入批次、实测结论与已知限制。批次号与源码注释中的编号一致，便于回溯到具体
实现与实测记录。

| 源 | 引入批次 | 实测结论与已知限制 |
|---|---|---|
| 雨课堂 | 初始版本 | 扫码登录（长轮询）与官方网页登录（应用内 WebView 读 Cookie）两条通道；短信通道已停用；试卷提交状态经 `/v/exam/cover` 取得；作业与试卷详情链接指向学生端 `/ai-workspace/lms-graph/...` |
| TUOJ（AI 版） | 初始版本 | 统一认证漫游为默认通道，另可配置独立账密直连；返回 401 / 403 触发一次自动重漫游，设备信任与二次认证均有可操作引导 |
| Tyche | 初始版本 | 复用统一认证漫游；批改结果取 `task/Status` 的 `submissionList[]`，按 `pid` 汇总最新一次提交 |
| TUOJ（经典版） | R15 20.1 | 站点 `oj.cs.tsinghua.edu.cn` 与 AI 版接口行为一致，复用同一套客户端实现，仅 base URL 与漫游回调不同 |
| DSA OJ | R15 20.1 / 20.2 | 站点 `dsa.cs.tsinghua.edu.cn/oj/`，老式 Bootstrap/jQuery 站，接口均为 `POST` form-urlencoded，会话靠 Cookie；登录为邮箱 + 密码，无统一认证；截止时间取 `assignment.endDate`，其格式不确定（站点标注 UTC+8），故按多格式容错解析；提交状态保守判定为未提交（`status` 语义待联调确认）；不提供批改结果；只读——仅拉标题、课程与截止时间，不提交、不抓题目正文 |
