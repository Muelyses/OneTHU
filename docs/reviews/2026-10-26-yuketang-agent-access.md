# 雨课堂 CLI／OH 查询接入修补

日期：2026-10-26；工作目录：`/Volumes/PortableSSD/Projects/thuapp/OneTHU`。

## 根因

GUI 原有雨课堂课程、作业、课件、视频和公告客户端。独立 SDK 虽有部分 `exthw.*` 查询，GUI 插件 facade 只发布外部作业快照与刷新，OH 工具及系统提示词没有雨课堂查询入口。桌面与 CLI 也没有共享单独的雨课堂登录配置。两个内置 Harness 清单还缺少 `exthw:read` 权限，因此仅增加方法仍会被权限门禁拒绝。

## 处理

- 新增 core `createYuketangQueries`，GUI 与独立 SDK 复用同一只读客户端。`yuketang.status/courses/contents/homework/homeworkDetail/leafDetail/noticeDetail` 全部登记到 CLI 目录，保留旧 `exthw.*` 命令。
- OH 内置 `query_yuketang`，说明每种查询的参数来源、独立扫码登录及错误含义。`classroomId`、`leafTypeId`、`leafId`、公告候选 id 直接沿用目录结果。两个 Harness 清单增加只读权限；独立 Agent 提示词也说明雨课堂已支持。
- 状态不返回 Cookie，`configured` 仅表示有配置；实时会话用课程查询验证。明确区分未配置、过期、账号变化、课堂不存在。CLI 对已知错误提供静态可操作提示，并继续屏蔽外部响应原文和秘密值。
- 新的代理查询逐页读取课程日志，超过 200 条继续请求下一页；去重重叠活动，重复分页报告不完整并停止。部分课堂失败返回已获得的数据和 `issues`，过期会话拒绝返回旧结果。此行为通过可选 query hooks 启用，保留原 GUI 缓存调用方式。
- 课程内容目录获取全部可用页。作业沿用已有 GUI 语义：保留既往作业，未来截止 horizon 通常 30 天；可显式传 1–3660 天，结果携带范围说明。
- `desktop.yuketangSync` 仅存在于本机私有原生／daemon 通道，不登记到公共服务或 MCP。按学校账号与会话 epoch 隔离；独立 CLI 已配置的不同会话保留并报告冲突，桌面断开仅撤销自身同步配置。同步不会携带其他平台密码。
- 桌面扫码或断开后自动同步给常驻 CLI，学校登录保持原有共用方式。请求等待期间凭据改变会丢弃旧快照并转交新配置；撤销授权、切换账号与临时连接失败有回归。雨课堂心跳延迟返回的 Cookie 也不能覆盖新的账号／会话。
- 补充中英 CLI 文档和权限说明，词条进入 seed 后重新生成。

## 验证

- SDK 全量 195 项、CLI 全量 74 项通过。
- 新的雨课堂专项 17 项：查询目录、真实客户端请求形状、单课堂范围、跨 200 条分页、重叠去重、重复页、不完整来源、过期会话、异常结构、账号／Cookie 变化、截止范围、详情路由及私有同步安全。
- 桌面私有同步编排 5 项；CLI 服务边界 48 项、共享运行时 20 项；原通知附件／资源枚举 27 组、CLI 学习服务 32 组继续通过。
- Harness 全量 66 项通过，含新 OH 工具的七种动作、发现、只读及非法参数拒绝。原雨课堂课程、作业详情、外部作业状态回归通过。
- 全工作区类型检查、生产构建、原生 `cargo build`、Harness release sidecar 构建通过。中英 i18n 7649 条，errors 0。

## 真实运行状态与范围

已更新现有 dev wrapper 和实际使用的 Harness sidecar／独立 CLI bundle；桌面原有雨课堂配置已自动同步到 CLI，`desktopSync=synced`，学校主登录保持 ready。

真实只读测试中，GUI 查询桥返回雨课堂 HTTP401，独立 CLI 同样无法取得课程。该结果说明现有雨课堂 Cookie 已失效；已补充 `YUKETANG_SESSION_EXPIRED` 的扫码重登提示。成功读取真实课程／内容仍需要用户重新扫码，当前验收覆盖模拟完整查询及真实失败链路，未把 HTTP401 计为查询成功。

联调最后一次重启又遇到 CLI 开关关闭，用户确认没有手动关闭。检查发现启动阶段授权默认 false，在读取保存授权之前调用同步可能把该临时值写回后台。`syncCliRuntime` 现先等待 `initPrivacyConsent` 完成；新增回归验证读取期间保持后台开关及保存授权读入后的状态。已恢复此前 enabled=true，并保持 automatic=false／逐次写操作审批；实际重启后学校 ready、雨课堂 desktopSync=synced，课程查询明确返回 `YUKETANG_SESSION_EXPIRED`，未再次变成 CLI_DISABLED。

所有代码位于原主仓库，保留既有未提交 CLI、共享后台与通知附件开发。此任务没有发布或替换安装包。
