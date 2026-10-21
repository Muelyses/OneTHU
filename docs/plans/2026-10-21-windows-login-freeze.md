# Windows 登录冻结排查（2026-10-21）

## 现场与结论边界

- Windows 0.11.0：输入账号密码后尚未进入二次验证，窗口能拖动，页面无法点击，刷新无效。
- 用户关闭 TUN 并重启后仍复现，不能归因于代理或 Fake-IP。
- 旧日志只有启动与 MadModel 请求成功记录，没有登录阶段信息。原有 NATIVE-HOP 在响应后写入，缺少该记录不能证明请求未发出。
- 尚无 Windows 实机复现环境；以下修复消除已发现的阻塞风险，不能据此宣称现场问题已解决。

## 本轮修改

- 登录前清理 Cookie 的两个原生命令改为异步 IPC，在阻塞线程池等待 Cookie 仓锁。原来同步 IPC 在后台保存 Cookie 时可能等锁，拖住 WebView2 的调用线程。
- log_debug 的文件操作移到阻塞线程池，避免日志目录、轮转、磁盘操作占用同步 IPC 回调。
- 增加 AUTH-PHASE：提交、模块导入、指纹获取、Cookie 清理、登录握手、返回状态；不记录账号、密码、验证码或指纹值。
- 增加 NATIVE-START：进入原生 HTTP 命令时记录方法和脱敏 URL，配合已有响应日志区分请求前后。异步日志可能乱序，按阶段名称判断，不依赖相邻行。

## 验证

- 原生锁竞争回归：独立线程持有 Cookie 写锁，两个清理命令等待期间，单线程异步执行器仍能运行定时器；通过。
- `node tools/windows-login-browser-test.mjs`：真实 React 登录与刷新控件，在模拟 Cookie 清理悬挂、网络请求悬挂两种情况下，输入、事件循环及刷新仍可用，共 13 项断言通过。
- 浏览器测试使用 macOS Chromium 和 Windows UA、模拟 Tauri IPC，不访问学校接口，不使用真实凭据；不能代替 Windows WebView2 实机验收。
- 桌面 TypeScript 检查、i18n 检查、diff 空白检查通过。

## 下一步现场复测

提供本次提交对应的 Windows Actions 包。若仍卡住，保留 `%APPDATA%\app.onethu.desktop\logs\onethu-debug.log` 中的 AUTH-PHASE、NATIVE-START 和响应阶段以定位；不要提供凭据文件或验证码。重点判断是否停在导入前、Cookie 清理、握手前，或发出请求后。
