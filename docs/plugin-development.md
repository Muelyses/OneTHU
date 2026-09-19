# 插件开发指南

本文档说明 OneTHU 插件的开发流程：插件模型、清单规范、权限声明、通信协议与调试
方法。`ctx.onethu.*` 接口的逐方法说明见 [api-reference.md](./api-reference.md)。

## 目录

1. [插件能力与形态](#1-插件能力与形态)
2. [最小插件](#2-最小插件)
3. [清单规范](#3-清单规范)
4. [权限模型](#4-权限模型)
5. [通用约定](#5-通用约定)
6. [Rust sidecar 协议](#6-rust-sidecar-协议)
7. [对话面板协议](#7-对话面板协议)
8. [Android 内嵌形态](#8-android-内嵌形态)
9. [调试](#9-调试)
10. [版本记录](#10-版本记录)

---

## 1. 插件能力与形态

插件通过 `ctx.onethu.*` 访问宿主提供的全部数据能力（课表、作业、日程、图书馆预约、
邮件、云盘、模型对话等），并可注册命令按钮、渲染常驻对话面板、定义主题。宿主承担
会话维护、超时控制、重试与权限校验，插件只需处理业务语义。

插件为受信代码（JS 插件在应用 webview 同域执行，Rust 插件为本机进程），权限门禁
约束的是 `ctx.onethu.*` 的可见范围，不是代码沙箱。插件不得直接访问应用内部状态或
DOM，全部操作应经公共接口完成。

三种插件形态共用同一套权限门禁与 API 面：

| 形态 | 载体 | 运行位置 | 支持平台 | 安装方式 |
|---|---|---|---|---|
| JS 模块 | ES 模块文本 | 应用 webview | 全部 | 设置 → 插件 → 粘贴代码或选择文件 |
| Rust sidecar | 二进制与 manifest.json | 独立进程（stdio JSON-RPC） | 仅桌面 | 选择 manifest.json，二进制置于同目录 |
| Rust 内嵌 | 编译进应用 | 应用进程内（Tauri 命令桥） | 仅 Android | 随安装包分发，由官方提供 |

## 2. 最小插件

JS 插件为一个 ES 模块，导出 `manifest` 与默认激活函数：

```js
export const manifest = {
  id: "onethu.example",
  name: "示例插件",
  version: "0.1.0",
  description: "查询校园卡余额并跳转至对应页面",
  permissions: ["user:read", "card:read", "nav", "ui"],
};

export default async function activate(ctx) {
  ctx.registerCommand({ id: "balance", title: "查询余额" }, async () => {
    const card = await ctx.onethu.card.info();
    ctx.onethu.ui.toast(`余额 ¥${card.balance.toFixed(2)}`);
    ctx.onethu.nav.go("life", { lifeTab: "card" });
    return `余额 ${card.balance} 元`;
  });
}
```

安装步骤：设置 → 插件 → 粘贴代码 → 安装 → 展开插件卡片 → 点击命令。命令返回的
字符串直接展示在卡片中，异常展示前 200 字符。

## 3. 清单规范

### 3.1 字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 唯一标识，建议反域名形式（如 `onethu.harness`），允许 `[a-z0-9.-]` |
| `kind` | `"js"` \| `"rust"` | 否 | 插件形态，默认 `js` |
| `bin` | string | Rust 形态必填 | 二进制文件名，与 manifest.json 同目录 |
| `name` | string | 是 | 显示名称 |
| `version` | string | 是 | 版本号 |
| `author` | string | 否 | 作者 |
| `description` | string | 否 | 描述 |
| `permissions` | string[] | 是 | 权限清单，安装时由用户逐项确认 |
| `settings` | SettingField[] | 否 | 设置表单，由应用渲染 |
| `commands` | Command[] | 否 | 命令按钮；Rust 插件也可在激活应答中返回 |

### 3.2 设置项（SettingField）

| 字段 | 类型 | 说明 |
|---|---|---|
| `key` | string | 设置键，插件通过 `onethu.settings.get()` 读取 |
| `label` | string | 表单标签 |
| `type` | `"text"` \| `"password"` \| `"textarea"` \| `"select"` | 控件类型 |
| `options` | `{ value, label }[]` | `select` 类型的选项 |
| `placeholder` | string | 输入占位符 |
| `default` | string | 默认值 |

### 3.3 命令（Command）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 命令标识，对应 `run` 请求的 `command` 字段 |
| `title` | string | 按钮文案 |
| `inputLabel` / `inputPlaceholder` | string | 输入框标签与占位符；未设置时不渲染输入框 |
| `dock` | boolean | 标记为对话面板命令，见 §7 |

### 3.4 主题插件

主题是一种特殊插件：清单声明 `category: "theme"`，模块导出 `theme` 对象
（`ThemeDef`）而非 `default` 激活函数。宿主在安装与启动时将其注册进主题库，
与其他主题（内置或第三方）同权：可应用、可停用、可删除。

```js
export const manifest = {
  id: "onethu.theme.example",
  name: "示例主题",
  version: "1.0.0",
  category: "theme",
  permissions: [],
};

export const theme = {
  id: "onethu.theme.example",
  name: "示例主题",
  version: "1.0.0",
  description: "替换强调色与页面底色",
  vars: {
    "--accent": "#0d9488",
    "--accent-soft": "#e0f4f1",
    "--bg": "#f9fcfb",
  },
};
```

**ThemeDef 字段**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 主题唯一标识，建议 `onethu.theme.<名称>`；与清单 id 一致便于管理 |
| `name` / `version` | string | 是 | 展示信息 |
| `author` / `description` | string | 否 | 展示信息 |
| `vars` | `Record<string, string>` | 是 | CSS 变量覆盖，键为设计令牌名（可覆盖清单见下表） |
| `fonts` | `{ ui?, mono? }` | 否 | 字体栈覆盖 |
| `logo` | string | 否 | 品牌 logo 替换，inline SVG 字符串（viewBox 24×24 最佳） |
| `css` | string | 否 | 附加 CSS；必须以 `:root[data-theme="<主题 id>"]` 限定作用域 |
| `dark` | boolean | 否 | 声明为深色主题。激活时应用 `color-scheme: dark`（原生控件与滚动条同步），并可在昼夜调度中作为「黑夜主题」档位 |

**可覆盖的设计令牌**（定义于 `packages/ui/src/tokens.css`）：

| 类别 | 变量 |
|---|---|
| 面 | `--bg`、`--bg-soft`、`--surface`、`--surface-2`、`--surface-3`、`--skeleton` |
| 线 | `--border`、`--border-soft`、`--border-strong` |
| 文字 | `--text-1`、`--text-2`、`--text-3`、`--text-dim` |
| 品牌与强调 | `--primary`、`--primary-hover`、`--on-primary`、`--accent`、`--accent-soft`、`--accent-border` |
| 功能色 | `--red`、`--red-soft`、`--amber`、`--amber-soft`、`--green`、`--green-soft` |
| 交互态 | `--hover`、`--active`、`--ring` |
| 阴影 | `--shadow-1`、`--shadow-2`、`--shadow-3` |
| 字体 | `--font-ui`、`--font-mono` |
| 字号 | `--text-xxs` 至 `--text-xl` |
| 间距与形状 | `--gap-1` 至 `--gap-6`、`--r-sm`、`--r-md`、`--r-lg`、`--r-pill`、`--sidebar-w` |

**实现边界**（边界契约）：主题只做令牌覆盖，不得改变组件结构与布局骨架。深色主题
如需修正应用内硬编码的浅色元素，通过 `css` 字段附加作用域限定的规则，示例：

```js
css: `
:root[data-theme="onethu.theme.example"] .plg-pin.is-oh { background: var(--surface-2); color: var(--text-1); }
`,
```

**与昼夜调度的关系**：`dark: true` 的主题可被用户选为「黑夜主题」档（设置 → 外观），
系统深色模式切换时自动生效。主题插件无激活函数，因此不使用 `settings` 设置项；
需要变体时发布多个主题即可。

### 3.5 生命周期

- 安装后立即激活；应用启动时自动恢复所有已启用插件。
- 停用：调用 `dispose` 后卸载。删除：停用并清除插件私有存储。
- 激活函数可返回 `{ dispose() }`，用于停用时释放资源。
- 安装记录包含 `builtin`（应用组成部分，不可卸载）与 `embedded`（编译进应用）标记。
- 内置插件的清单与镜像不一致时，启动阶段自动重新注册，用户设置值保留。

## 4. 权限模型

插件在清单中声明 `permissions`，安装时由用户确认。调用未声明权限的方法抛出
`PluginPermissionError`。三种形态使用同一套门禁，无绕过路径。权限与 API 的对应关系
见 [api-reference.md §0.1](./api-reference.md#01-权限总表)。

以下两类能力受平台规则限制，宿主不提供对应接口：

1. **体育场馆预约提交**。宿主仅提供查询、退订与官方页面跳转。依据清华大学体育部
   场馆中心 2025-12-03 公告第七条第 12 款，通过脚本预订场地将被暂停预订权限 6 个月，
   插件不得以任何方式绕过。
2. **资金与凭据写操作**。不提供充值、修改密码等接口。

## 5. 通用约定

### 5.1 网络与超时

- **通道一致性**：CAS 票据的兑换通道决定会话建立通道，该过程由宿主内部处理，
  经 `ctx.onethu.*` 发起的调用无需关心。`net.fetch` 直连清华内网域时需自行处理，
  且校内域名在校外不可达；校内业务应统一使用 `ctx.onethu.*`。
- **会话自愈**：会话失效时宿主自动重建并重试原请求。重建失败抛出
  `AuthRequiredError`，此时应提示用户重新登录，不应重试。
- **超时**：所有请求（含 `net.fetch`）设有 45 秒上限。

### 5.2 错误处理

| 错误 | 判定方式 | 处理建议 |
|---|---|---|
| `PluginPermissionError` | 类名或消息含「未获授权」 | 提示用户重新安装并授予对应权限 |
| `AuthRequiredError` | 消息含「会话未能建立」 | 提示用户重新登录，不应重试 |
| 其他 `Error` | — | 可重试一次，失败后向用户报告 |

### 5.3 数据规约

- 日期格式为 `"YYYY-MM-DD"`，时间格式为 `"HH:MM"`。
- `dateChoice` 为枚举参数（0 表示今天，1 表示明天），不是日期字符串。
- **链式调用的对象传递**：形如 `library.list → floors → sections → seats → book`
  的调用链，后一步的入参必须是前一步返回的元素本体。工具实现中应按标识符查找元素
  后再传入，不应构造对象。

## 6. Rust sidecar 协议

### 6.1 通信格式

stdio 上的行分隔 JSON-RPC。宿主发往插件：

| 消息 | 说明 |
|---|---|
| `activate`（含 `settings`、`permissions`） | 进程启动后的握手请求，必须应答，`result` 需包含命令清单 `{"commands":[…]}` |
| `run`（含 `command`、`input`） | 执行命令。长任务可先返回进度通知，最后必须应答最终结果 |
| `interrupt` | 打断请求（通知，无 `id`），应立即终止当前执行 |
| `dispose` | 停用或卸载前的退出请求，应答后进程应自行退出 |

插件发往宿主：

| 消息 | 说明 |
|---|---|
| `onethu.call`（含 `ns`、`method`、`args`） | 调用 API，参数按位置传递；宿主以 `result` 或 `error` 回写 |
| `progress` | 进度通知；对话面板场景支持 `kind` 字段，见 §7 |
| `log` | 日志行，展示于轨迹面板 |

### 6.2 实现约束

- **标准输入锁不可重入**：`for line in stdin().lock().lines()` 会在整个循环期间持有
  锁，循环体内再次调用 `stdin().lock()` 读取应答会造成死锁。应全程只加锁一次，
  并在辅助函数中复用同一个 `&mut StdinLock`。完整实现见
  `examples/harness-skel/`（可直接执行 `cargo build`）。
- **应答超时**：`run` 请求的应答超时为 10 分钟，进度通知不重置计时。超时仅使该次
  调用报错，进程继续运行，仍可发送进度与接收打断。
- 不应依赖工作目录；宿主不保证当前目录。
- 退出码非 0 或标准输出关闭时，宿主发出 `exit` 事件并清理进程记录。

## 7. 对话面板协议

Rust 插件在激活应答中将某命令标记 `dock: true`，宿主即为其渲染常驻对话面板：

```json
{ "commands": [
  { "id": "chat", "title": "对话", "inputLabel": "输入指令", "dock": true }
] }
```

面板提交消息等价于 `run { command: "<该命令 id>", input: "<用户输入>" }`。

对话命令的应答为结构化 JSON：

| 字段 | 说明 |
|---|---|
| `answer` | 最终回答文本 |
| `sessionId` | 会话标识 |
| `interrupted` | 是否被用户打断 |
| `confirm` | 非空时面板渲染确认控件，用户确认等价于发送文本「确认」。所有写操作必须经此确认流程 |
| `usage` / `sessionUsage` / `totalUsage` | 本次、会话与累计用量及预算 |

进度通知的 `kind` 取值：`delta`（回答增量）、`think`（思考增量）、`tool`（工具调用
轨迹）、`notice`（状态行）、`usage`（用量刷新）。

会话管理命令的约定命名：`new_session`、`list_sessions`、`switch_session`、
`delete_session`、`export_session`、`import_session`、`usage_report`、`selftest`。

## 8. Android 内嵌形态

Android WebView 环境不允许执行任意路径的二进制文件，sidecar 形态在移动端不可用。
官方 Harness 插件采用同一份 Rust 核心编译进应用进程的方式实现，通信经 Tauri 命令桥
而非 stdio。要点：

- 工程结构：`plugins/OneTHU-Harness` 为 Cargo 工作区，`core/` 为宿主无关库（仅依赖
  `Host` 与 `Emit` 两个 trait），`bin/` 为桌面 stdio 外壳。
- 宿主命令必须为异步。Tauri v2 的同步命令在主线程执行，曾因同步实现的
  `harness_bridge_take` 阻塞主线程 25 秒，导致 Android 端全局操作停顿。
- 调用链：core 的 `Host::call` → 桥线程 → 消息队列 → JS 泵长轮询批量取走 →
  webview 门面（同一套权限门禁）→ 经 Rust 传输层发出请求 → 回写结果。
- loader 在 Android 宿主开机时写入 `onethu.harness` 内置记录
  （`builtin` + `embedded`），不可删除；清单与镜像不一致时自动重新注册，设置保留。

第三方 Rust 插件不提供移动端形态。

## 9. 调试

| 方式 | 说明 |
|---|---|
| `ctx.log(line)` / `log` 通知 / 标准错误输出 | 写入应用调试通道，前缀 `[PLUGIN:<id>]` |
| 桌面端日志文件 | `/tmp/onethu-debug.log` |
| Android 日志 | `adb logcat -s onethu`，或 `adb logcat -d --pid=$(adb shell pidof app.onethu.desktop)` |
| 端到端自测 | OneTHU-Harness 的 `test/sim_host.mjs`：模拟宿主门面与 OpenAI SSE 服务，覆盖握手、工具调用、流式输出、用量统计、会话管理与两段式确认 |

## 10. 版本记录

| 版本 | 变更 |
|---|---|
| v1.3 | 文档重写为标准格式；新增 `llm`、`theme`、`exthw:read`、`exthw:refresh`、`webview` 权限，新增 `llm`、`theme`、`exthw` 命名空间与 `ui.webModal`；设置项新增 `select` 类型 |
| v1.2 | 新增 `cal` 命名空间与日程云同步（CalDAV） |
| v1.1 | 新增 `learn`、`venue`、`xk`、`kongjian`、`coursex` 命名空间 |
| v1.0 | 首个公开版本 |
