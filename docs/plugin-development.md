# 插件开发指南

**这份文档教你为 OneTHU 写插件。** 一个插件 = 一段你写的代码，装进 OneTHU 后可以：
调 `ctx.onethu.*` 读改用户的清华业务数据（查课表、订座位、发邮件、问 AI……）、往
界面里注册命令按钮、拥有自己的常驻对话面板、或干脆换掉整个应用配色。你不需要碰
OneTHU 本体代码，也不用管登录态、会话过期、网络重试——宿主全包了。

读完你能：写出并装上一个能跑的插件（§1），按需求选形态（§2），按协议实现 Rust 版
（§6），以及知道怎么调试（§9）。每个接口的收发细节在
[api-reference.md](./api-reference.md)（接口行为以真源代码为准，与文档冲突时以代码为
准）。

## 1. 快速开始

最小可用插件是一个 ES 模块，导出 `manifest` 与默认激活函数：

```js
export const manifest = {
  id: "onethu.hello",
  name: "Hello",
  version: "0.1.0",
  description: "查余额并跳转的最小演示",
  permissions: ["user:read", "card:read", "nav", "ui"],
};

export default async function activate(ctx) {
  ctx.registerCommand(
    { id: "demo", title: "查余额并跳转" },
    async () => {
      const c = await ctx.onethu.card.info();
      ctx.onethu.ui.toast(`${c.userName} 余额 ¥${c.balance.toFixed(2)}`);
      ctx.onethu.nav.go("life", { lifeTab: "card" });
      return `余额 ${c.balance} 元`;
    },
  );
}
```

安装：设置 → 插件 → 粘贴代码 → 安装 → 展开卡片点命令。命令返回的 string 直接展示，
异常显示前 200 字符。

## 2. 插件形态

| 形态 | 载体 | 运行位置 | 平台 | 安装方式 |
|---|---|---|---|---|
| JS 模块（默认） | ES 模块文本 | 应用 webview | 全平台 | 粘贴代码 / 选文件 |
| Rust sidecar | 二进制 + manifest.json | 独立进程（stdio JSON-RPC） | 仅桌面 | 选 manifest.json（二进制同目录） |
| Rust 内嵌 | 核心编进 App | App 进程内（Tauri 命令桥） | 仅 Android（官方内置） | 随 APK 分发 |

三种形态共用同一套权限门禁与 `onethu.*` 数据面；Rust 侧经
`onethu.call { ns, method, args }` 调用同一 API（§6.2）。

**边界约定**：插件是受信代码（同域执行 / 本机二进制），权限门禁约束的是 `onethu.*`
可见面而非代码沙箱；插件不得触碰应用内部状态与 DOM，一切经公共原子接口。

## 3. manifest 规范

### 3.1 字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | ✓ | 唯一 id，反域名风格（`onethu.harness`）；`[a-z0-9.-]` |
| `kind` | `"js" \| "rust"` | | 默认 `js` |
| `bin` | string | rust | 二进制文件名（与 manifest.json 同目录） |
| `name` / `version` / `author` / `description` | string | name/version ✓ | 展示信息 |
| `permissions` | string[] | ✓ | 权限清单，安装时用户逐项确认（见 §4） |
| `settings` | SettingField[] | | 设置表单，应用代渲染 |
| `commands` | Command[] | | 管理页命令按钮（rust 插件也可在 activate 应答里给） |

### 3.2 settings 项

| 字段 | 说明 |
|---|---|
| `key` | 设置键，插件经 `onethu.settings.get()` 读取 |
| `label` | 表单标签 |
| `type` | `"text" \| "password" \| "textarea" \| "select"` |
| `options` | select 专用：`[{ value, label }]` |
| `placeholder` / `default` | 占位与默认值 |

### 3.3 command 项

| 字段 | 说明 |
|---|---|
| `id` | 命令 id（`run` 的 `command` 参数） |
| `title` | 管理页按钮文案 |
| `inputLabel` / `inputPlaceholder` | 输入框；不填则无输入框 |
| `dock` | rust 专用：标记为对话面板命令（§7） |

### 3.4 生命周期

- 安装即激活；启动时自动恢复已启用插件。
- 停用 = 调 dispose 后卸载；删除 = 停用 + 清私有存储。
- `activate` 返回值可含 `dispose()` 供停用清理。
- 安装记录含 `builtin`（App 一部分，不可卸载）与 `embedded`（核心编进 App）标志。
- **内置清单自愈**：内置插件的 manifest 与镜像不一致时，启动自动重注册（用户设置值保留）。

## 4. 权限模型

manifest `permissions` 声明 → 安装时用户确认 → 未授权调用抛 `PluginPermissionError`。
三形态同一套门禁，无绕过路径。全表见
[api-reference.md §2 权限总表](./api-reference.md#2-权限总表)。

两条硬性法规边界：

1. **体育场馆**：宿主不提供预约提交接口（只有查询/我的预约/退订/跳官方页）。依据
   清华体育部场馆中心 2025-12-03 公告第七条第 12 款，脚本预订封禁 6 个月——插件同样
   不得绕行。
2. **不暴露**充值、改密等资金与凭据写操作。

## 5. 通用约定

### 5.1 网络三约定

1. **票据通道**：CAS 票据兑在哪个通道，会话建在哪个通道——宿主内部处理，经
   `onethu.*` 的调用完全无感。`net.fetch` 直访清华内网需自行负责（内网域校外不可达）。
2. **会话自愈**：会话失效自动重建后重试；重建失败抛 `AuthRequiredError`——提示用户
   重新登录，**不要**重试。
3. **45s 超时**：所有请求（含 `net.fetch`）兜底超时，不会无限悬挂。

### 5.2 错误处理

| 错误 | 判定 | 插件应当 |
|---|---|---|
| `PluginPermissionError` | 类名 / message 含「未获授权」 | 提示用户重装并授予对应权限 |
| `AuthRequiredError` | message 含「会话未能建立」 | 提示重新登录，不要重试 |
| 其余 `Error` | — | 可重试一次再报错 |

### 5.3 数据规约

- 日期一律 `"YYYY-MM-DD"`，时间 `"HH:MM"`；`dateChoice` 是枚举（0=今天 1=明天）。
- **对象传递**：链式调用（如 `library.list → floors → sections → seats → book`）
  的后一步入参必须是前一步返回的元素本体，不要按 id 自行构造对象。

## 6. Rust sidecar 协议

### 6.1 消息表（stdio，每行一个 JSON）

宿主 → 插件：

| 消息 | 说明 |
|---|---|
| `activate { settings, permissions }` | 拉起后握手；**必须应答** `{"commands":[…]}` |
| `run { command, input }` | 执行命令；长任务边跑边 progress；**必须应答** |
| `interrupt {}` | 打断（通知，无 id）——立即停止当前 run |
| `dispose {}` | 优雅退出；应答后 `exit(0)` |

插件 → 宿主：

| 消息 | 说明 |
|---|---|
| `onethu.call { ns, method, args }` | 调用任一 API（按位置传参），宿主回 `result` / `error` |
| `progress { text?, step?, total?, kind? }` | 进度 / 对话面板流式通知 |
| `log { line }` | 轨迹面板日志 |

### 6.2 实现红线

- **stdin 锁不可重入**：`for line in stdin().lock().lines()` 全程持锁，循环体内再
  lock 读应答必死锁。全程 lock 一次，helper 复用同一 `&mut StdinLock`
  （完整骨架见 `examples/harness-skel/`，可直接 `cargo build`）。
- **run 应答超时 10 分钟**（progress 不重置）；超时只是该次调用报错，进程仍可继续。
- 不要依赖工作目录；退出码非 0 / stdout 关闭 → 宿主发 `exit` 事件并清理进程表。

## 7. 对话面板（dock）协议

任何 rust 插件在 activate 应答中声明 `dock: true` 的命令，宿主即为其渲染常驻对话面板：

```json
{ "commands": [
  { "id": "chat", "title": "对话", "inputLabel": "对 OH 说", "dock": true }
] }
```

面板发消息 = `run { command: "<dock 命令 id>", input }`。chat 命令返回结构化 JSON：

| 字段 | 说明 |
|---|---|
| `answer` / `sessionId` / `interrupted` | 回答、会话、是否被打断 |
| `confirm: { summary }` | 非空时面板渲染两段式确认（用户确认 = 发送「确认」）。**所有写操作必须走此流程** |
| `usage` / `sessionUsage` / `totalUsage` | token 用量与预算 |

progress 扩展（`params.kind`）：`delta`（回答增量）、`think`（思考增量）、`tool`（工具轨迹）、
`notice`（状态行）、`usage`（用量刷新）。

会话管理命令约定命名：`new_session` / `list_sessions` / `switch_session` / `delete_session` /
`export_session` / `import_session` / `usage_report` / `selftest`。

## 8. Android 内嵌形态（官方）

Android WebView 沙箱无任意二进制执行权限，sidecar 不可用。官方 Harness 将同一份 Rust
核心直接编进 App 进程（Tauri 命令桥代替 stdio）。核心要点：

- 工作区 `plugins/OneTHU-Harness`：`core/`（宿主无关库，只依赖 `Host`/`Emit` 两个
  trait）+ `bin/`（桌面 stdio 薄壳）。宿主无关性是内嵌的前提。
- 宿主命令全部 **async**（Tauri v2 同步命令占主线程——曾致安卓全局冻结，红线）。
- 调用链：core `Host::call` → 桥线程 → mpsc 队列 → JS 泵 `harness_bridge_take`
  长轮询批量取走 → webview 门面（同一套权限门禁）→ `harness_rpc_reply` 回写。
- loader 在 Android 宿主开机种入 `onethu.harness`（`builtin + embedded`，不可删）；
  manifest 与镜像不一致自动重注册（设置保留）。

## 9. 调试

| 手段 | 说明 |
|---|---|
| `ctx.log(line)` / `log` 通知 / stderr | 进应用调试通道，前缀 `[PLUGIN:<id>]` |
| 桌面日志 | `/tmp/onethu-debug.log` |
| Android | `adb logcat -s onethu`（或 `--pid=$(adb shell pidof app.onethu.desktop)`） |
| 端到端自测 | OneTHU-Harness `test/sim_host.mjs`（假 OpenAI SSE + 宿主门面，全链断言） |

## 10. 版本记录

| 版本 | 要点 |
|---|---|
| v1.3 | 文档重写为标准格式（本版）；新增 `llm` / `theme` / `exthw:read` / `exthw:refresh` / `webview` 权限与 `llm` / `theme` / `exthw` 命名空间、`ui.webModal`；`select` 设置项类型 |
| v1.2 | `cal` 日程云同步（CalDAV）；权限 19 项 |
| v1.1 / v1.0 / v0 | learn/venue/xk/kongjiang 扩展；异步内嵌桥；初版 |
