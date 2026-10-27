# OneTHU 独立 CLI / SDK / 常驻助理验收

日期：2026-10-25。工作目录在 `main`，基于原有未提交工作继续。版本字段沿用 0.11.3，未创建发布、推送或替换安装渠道。

后续更新：桌面与 CLI 已统一到常驻后台，并在 macOS 完成真实会话、11 门课程双入口一致、关闭 dev 后只读任务继续执行及重开恢复验收。SDK 最终 178/178，i18n 7639/7639。详见 [统一后台续验](2026-10-25-unified-resident-runtime.md) 与 [实际执行证据](../../output/unified-resident-acceptance/live-result.json)。下文保留首次独立 CLI 验收记录，较早的待联调说明以续验结果为准；Windows 和真实 IM 仍待实机联调。

## 交付物

- `packages/sdk/`：独立 Node 运行时、学校服务、任务、通知、IM、插件和模型工具循环。
- `packages/cli/`：终端、独立 daemon、MCP 和 macOS/Windows 安装器。
- `apps/desktop/src/components/CliTasksSettings.tsx`：真实桌面任务管理和收件箱。
- `plugins/OneTHU-Harness` 子模块：OH 内建 `tasks_query` / `tasks_manage`，共享 host `cli.call` 本机授权，不需要用户手动添加 MCP。
- `output/onethu-cli/onethu-cli-0.11.3.tgz` 与 SHA-256 文件：CLI 开发包。
- `packages/sdk/artifacts/onethu-sdk-0.11.3.tgz` 与 SHA-256 文件：独立 SDK 开发包。
- 安装/用法：`packages/cli/README.md`、`README.en.md`；架构：`docs/onethu-cli.md`、`docs/en/onethu-cli.md`；SDK API：包内双语 README。

产物由源码本地生成，目录未加入 Git。检查命令见下文，精确哈希以各产物旁的 `.sha256` 为准。

## 可复现检查

```sh
pnpm build:cli
pnpm --filter @onethu/sdk test
pnpm --filter @onethu/cli test
pnpm test:cli
pnpm --filter @onethu/sdk typecheck
pnpm --filter @onethu/desktop typecheck
pnpm --filter @onethu/cli typecheck
pnpm i18n:handoff
pnpm i18n:check
node packages/sdk/scripts/pack.mjs
node packages/sdk/scripts/test-pack.mjs
```

SDK 夹具使用合成学校响应，覆盖实际 InfoHelper 的 SM2、2FA、回调与学习会话恢复。下载测试实际写入文件，验证 SHA、原始字节、跨块登录页识别、取消、目录安全与最终发布回滚。独立 runtime 的测试通过真实 bundle 调用服务、执行任务、写入收件箱、关闭重开、运行插件 worker，并校验本地批准/MCP权限/账号及策略变化。

CLI 测试使用真实子进程，覆盖参数、标准输出、错误、HTTP/stdio、归档、macOS 安装器和 daemon。daemon 验收检查随机端口鉴权、Origin 拒绝、非 ASCII 令牌不崩溃、调用期限、MCP 配置权限拒绝和正常退出。CLI tgz 在仓库外的空目录完成 `npm install --offline --ignore-scripts` 后运行目录及状态查询，发现 183 项真实登记操作，无工作区依赖、没有认证会话。

SDK 的独立 pack 保留工作区源码出口，另外生成自包含发布目录；270 份公开及依赖声明。空项目离线安装、实际 import/create/list、全部公开子路径的 strict NodeNext / `skipLibCheck:false` 检查通过；消费者已有 `@types/node` 的情况也通过。不需要安装者下载 workspace 包或运行编译脚本。

## 最终结果

| 验证 | 结果 |
| --- | --- |
| 独立 SDK 全套测试 | 150/150 |
| CLI 子进程、MCP、归档与 daemon | 63/63 |
| 桌面服务安全边界 | 48/48 |
| 桌面任务集成 | 8/8 |
| Harness core（含 OH 任务工具） | 64/64 |
| Harness MCP 生命周期 | 44/44 |
| 原生下载 | 16/16 |
| SDK / 桌面 TypeScript、CLI 语法 | 通过 |
| 仓库外 CLI 离线安装 | 通过，183 项操作 |
| SDK 离线安装与严格公开类型检查 | 通过，183 项操作、270 份声明 |
| 中英词典与动态键 | 7636/7636，errors 0 |
| Git 与 Harness diff 格式 | 通过 |

构建运行环境为 macOS、Node.js 22；运行包声明最低 Node.js 20.18.1，与所捆绑 Cheerio 的要求一致。Windows 相关实现仍按下方实机边界记录。

## UI 与国际化

真实 OneGUI 任务组件在隔离 Vite 环境挂载，仅状态和学校查询注入模拟数据。中英文 1440×1000、英文 430×932、中文 390×844，实际点击课程选择、创建、编辑保存、暂停、历史与收件箱；窄窗未发现横向溢出，底部确认按钮可滚到并点击。

证据：`output/cli-task-ui-fixture/QA.md` 及五张截图。没有添加生产演示路由，没有读取真实账号。

中英词典均为 7636/7636，`i18n:check` errors 0，Android 62 项模板一致。动态任务状态改为静态翻译键分支，批次已重新生成。

## 安全与稳定性修补

- 本机配置、凭据、自动授权不暴露给 MCP/IM/插件工具。
- 并发写锁只由实际获得锁的调用释放；异步批准返回后重新检查账号与策略。
- 下载提交、IM发送、插件反向调用保留原始取消及最终账号守卫。
- 固定 IM 发件人、账号和聊天对象；任务通道绑定具体接收者，密钥轮换与接收者改变分别处理。
- 初始存储失败具有显式错误处理；关闭等待初始化、排队与在途 I/O，避免进程退出后的迟到写入。
- 存储失败也关闭宿主、释放会话锁；保存自动执行配置失败时不启用该权限。
- 下载与外发写前记账；重启后结果未知时保留审计记录，不重复执行。
- 校园定时检查在同一个 manager 中顺序执行，避免一次唤醒同时打出几十轮学校请求；暂停/关闭阻止后续检查启动。

## 实机边界

独立学校真实登录、Windows WebView/安装/ACL/自启动、真实微信/飞书及所选模型尚待联调。以前桌面伴随 CLI 的真实课程下载证据不替代独立宿主认证验收。本轮没有创建真实学校预约、发邮件/IM、产生模型费用或注册真实设备信任。

macOS 自启动已在下述本机加载验收中实际注册并启动；Windows 自启动仍待真机验收。独立微信扫码、独立 MadModel 登录、免打扰时段、会话失效专门去重提醒尚未包含。任务失败可从历史查看，CLI 可以继续查询和管理已授权任务。

## 本机更新、加载与常驻验收

2026-10-25，重新执行 `pnpm build:cli`，通过 `packages/cli/scripts/install-macos.sh` 安装到 `~/.local/share/onethu-cli`，启动器为 `~/.local/bin/onethu`。执行 `onethu daemon install --confirm`，当前用户 LaunchAgent `edu.tsinghua.onethu.cli.1252d4534d22` 注册成功。`launchctl print` 返回 `state = running`，`onethu daemon status` 返回 `running: true`、版本 `0.11.3`。启动程序与 CLI 都位于本机盘，常驻进程无需仓库所在的外置盘。

独立 CLI 当前 `authenticated: false`，需要用户在终端执行 `onethu auth login`。没有迁移桌面凭据、开启自动执行或创建学校检查任务。登录后创建并批准任务，调度器才会执行相应检查；机器睡眠、关机或离线期间暂停联网工作。

桌面执行 `pnpm --filter @onethu/desktop tauri:dev` 完成编译、签名和 dev wrapper 重启。新版 debug Harness 已原子放入桌面资源目录，启动安装链自动复制到 AppData。构建产物、资源副本、已安装副本 SHA-256 前缀均为 `19cfb6e59cccf058`，包含 `tasks_manage`，新 sidecar 作为新 dev App 的子进程运行。桌面 `--desktop status` 返回 `connected: true`、会话 `ready`、140 项操作；`--desktop tasks list` 返回空数组。

桌面 OH 与独立 daemon 目前分别持有账号会话和任务列表。桌面任务需要桌面进程运行；通过独立 CLI 创建的任务由 daemon 执行。`tauri:dev` 会重编主程序，Harness 源码变更还需要先构建并更新 sidecar 资源，单纯刷新页面不会更换已运行的 sidecar。

本机已安装自启动项后，更新独立 CLI 的顺序（仓库根目录）：

```sh
pnpm build:cli
onethu daemon uninstall --confirm
bash packages/cli/scripts/install-macos.sh
onethu daemon install --confirm
onethu daemon status
```

此流程保留 CLI 数据目录。`onethu daemon stop` 停止当前进程，`onethu daemon start` 手动恢复；移除登录自启动用 `onethu daemon uninstall --confirm`。
