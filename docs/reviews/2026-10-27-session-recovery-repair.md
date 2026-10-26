# 0.11.4 登录恢复与学习会话回归修复

日期：2026-10-27。用户报告 Windows 长期停留在登录页，诊断为 `Session recovery is still in progress.`，学习页面也反复失去登录态。

## 已确认的问题

1. `packages/cli/src/daemon.mjs` 将除 status 之外的桌面私有请求全部等待 `runtime.start()`。后者包含学校身份探测和学习初始化。后台网络慢时，桌面 exportSession 无法返回；十秒后 UI 结束加载，`clients.login()` 仍被未结束的 resumeRequest 拒绝。报错字串与用户诊断一致。尚未取得该 Windows 设备的底层日志，具体是哪一次网络请求悬挂仍需真机复核。
2. SDK 把学习 CSRF 初始化放在学校登录／恢复完成前。学习站故障会拖住整个恢复流程，尽管学校身份已经有效。
3. 桌面启动使用可触发宿主认证钩子的共享 LearnClient，且 nativeFetch 没有向 Rust 传入调用方 timeoutMs，也没有实现 signal。UI 的十秒计时并未终止这个学习探测。
4. 后台在相同 epoch 从 idle 变为 ready 时，桌面会重复导入后台 cookie，可能覆盖桌面更新过的服务 cookie 和 CSRF。非阻塞快照需要明确区分持久化记录与完成身份验证的快照。
5. 本机原生日志显示主登录成功，随后学习恢复失败、学习请求 403，以及旧 `course/student/index` 页面 404。info-lib 的 Learn 首页常量确实仍指向该旧地址。

## 修复

- 私有快照读取、状态、明确的登录移交、退出和执行策略控制不再等待启动网络恢复。账户 epoch、现有授权和 MCP 隔离继续生效。
- SDK 学校身份恢复单飞，并在提交状态前核对 epoch；学习初始化移到实际学习操作。新的退出或登录移交能够使旧恢复失效。
- 桌面使用独立候选 LearnClient 做八秒、有取消边界的只读探测。候选没有密码来源和宿主登录钩子；成功后在当前 generation 内提交 CSRF，迟到响应不能继续种 cookie 或覆盖当前令牌。
- nativeFetch 实际传入 Rust timeout_ms，处理 AbortSignal，并在异步序列化后、IPC 之前再次检查取消。原生账户 epoch 保护保留。
- 相同 epoch 的启动完成状态不重新覆盖已就绪 GUI 的服务会话。后台尚未验证的快照只允许匹配的本地持久化账户使用自身原生仓进行探测；不同归属直接拒绝导入。
- 修正 Learn 首页地址，补充失败漫游的脱敏原因日志，并将本次挂起场景纳入 release workflow。

## 验证证据

- 真实 daemon 子进程，只有合成学校请求：将启动身份请求挂起，快照导出、退出、明确登录移交三个场景全部通过。相同测试执行修复前的 daemon 源码时三项均超时失败；无需真实账号或学校网络即可复现。
- SDK **198** 项通过，CLI **77** 项通过；私有会话移交 **11** 项、共享运行时 **21** 项、原生 epoch／取消 **10** 项、登录设备及互斥 **67** 项、学习准备 **7** 项、独立学习探测 **5** 项通过。
- 桌面 TypeScript、生产前端构建、i18n **7665/7665，errors 0** 通过。
- 在原缓存 dev App 内验收，没有启动另一份 App。刷新前学习页可复现 HTTP 403；加载修复后未输入密码，恢复首页与课程刷新。原生日志中课程、作业、课件与通知请求返回 200。
- 通过同一常驻 CLI 实际读取：学期 4 项、课程 11 项，某课程作业 4 项，作业详情及 1 个附件引用可用，通知 2 项及通知正文可读，详情 issues 为空。仅记录计数，不把课程名、ID 或正文写进仓库。
- 本轮没有提交作业、预约、邮件或 IM 消息。UI 验收点到过一个“忽略作业”确认层，已取消，未确认忽略。

本地证据：`output/session-recovery-20261027/`，相关运行日志为 `/tmp/onethu-session-*.log`。Windows 验证包和构建结果将在下方补记。

## Windows 原生检查补充

第一轮 Actions `40359638345` 在 SDK 的实际 Windows 会话存储检查中出现 `AUTH_STORAGE_ACL_FAILED`，会话还没有进入学校网络探测就已失败。为取回失败日志并停止已经失败的测试等待，终止了本轮验证；既有发布构建未动。原始异常被通用 catch 隐去，不能据此断定具体 Windows 权限错误。

后续将私有 DACL 构造改为明确的 .NET 构造函数和文件／目录 ACL API，保留当前用户唯一允许规则、受保护继承和所有者设置。PowerShell 调用有 15 秒期限，只传回固定阶段码，不输出带私人路径的 stderr。Windows smoke test 会在合成目录上实际验证 DACL、持久化、原子替换、剔除额外 Everyone 显式授权，且先于整套 SDK 测试执行。参考 [Directory.SetAccessControl](https://learn.microsoft.com/en-us/dotnet/api/system.io.directory.setaccesscontrol?view=netframework-4.8.1) 和 [File.SetAccessControl](https://learn.microsoft.com/en-us/dotnet/api/system.io.file.setaccesscontrol?view=netframework-4.8.1) 的按修改区段持久化语义；最终有效性以 Windows 执行结果为准。

第二轮 `40362445373` 已成功创建私有会话仓，随后测试侧的 `Get-Acl` 报出 `Microsoft.PowerShell.Security` 自动加载失败。旧生产代码的 `Set-Acl` 同样依赖该模块；这是 Windows 子进程环境的兼容性问题，不能把 macOS 的 chmod 测试当成 Windows ACL 验收。验证器也改为直接查询真实 .NET ACL，不依赖 PowerShell 模块或 JSON 转换命令。

首轮完整 SDK 测试还发现 Windows 插件子进程尚未关闭就清理目录的 `EBUSY`。宿主的停用、卸载、设置重启、失败启动和关闭现在等待实际 process/stdio close，保留立即撤销权限及 500ms 强制终止，并以三秒退出期限避免再次无限等待。修正一个测试里重开宿主先于旧清理 hook 关闭的顺序。新增测试验证停用、卸载与关闭返回时 worker 已真正关闭；本机 SDK **199/199** 通过。

桌面恢复末尾另有两个无关服务等待：Info 的预热和 CLI 通知／任务迁移。前者使用带恢复钩子的客户端，后者可能被常驻启动排队拖住。现在 Info 在实际操作时建立；任务同步继续按其账户／epoch 护栏后台执行并报告错误，不再占用前台登录互斥锁。新增实际生产函数测试，把两项服务永久挂起，验证前台仍能就绪；私有会话移交现为 **12/12**，登录状态 **67/67** 通过。

## 交付边界

这些修复首先进入 main / dev3 和原 dev。既有 v0.11.4 标签与公开安装包保留；Windows Actions 产物用于开发者真机验证，不能将 Windows Node 协议测试表述为真实 Windows GUI 登录已经通过。正式渠道尚未替换。
