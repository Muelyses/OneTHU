# OneTHU 开发文档

OneTHU 是清华大学校园助手应用，基于 Tauri v2 与 React 实现，支持桌面与 Android
平台。应用集成课表、作业、日程、图书馆预约、校园卡、宿舍电费、校园网等日常功能，
并通过插件系统提供扩展能力。

## 文档索引

| 文档 | 内容 | 读者 |
|---|---|---|
| [plugin-development.md](./plugin-development.md) | 插件模型、清单规范、权限声明、三种插件形态的通信协议、对话面板协议、调试方法 | 插件开发者 |
| [api-reference.md](./api-reference.md) | `ctx.onethu.*` 命名空间与方法的完整参考 | 插件开发者 |
| [architecture.md](./architecture.md) | 进程模型、会话管线、插件宿主实现、主题系统、模型调度、构建流程 | 宿主贡献者 |
| [external-homework.md](./external-homework.md) | 外部作业源（雨课堂 / TUOJ / Tyche）的接入方式、凭据维护、故障恢复 | 功能使用者与贡献者 |

## 阅读路径

- 开发首个插件：先读 [plugin-development.md](./plugin-development.md)，接口细节查询
  [api-reference.md](./api-reference.md)。
- 开发主题（配色、字体、logo、深色档）：读 [plugin-development.md §3.4](./plugin-development.md)。
- 接入外部作业系统：读 [external-homework.md](./external-homework.md) §5。
- 修改宿主实现：读 [architecture.md](./architecture.md)，构建命令见该文档 §8。

## 接口真源

以下文件为接口定义的权威来源，文档与实现不一致时以代码为准：

| 文件 | 内容 |
|---|---|
| `apps/desktop/src/plugins/types.ts` | `onethu.*` API 面与权限枚举 |
| `apps/desktop/src/plugins/facade.ts` | 权限门禁与 API 实现 |
| `packages/core/src/info/types.ts` | 领域数据类型 |
| `apps/desktop/src/state/theme.ts` | 主题定义与昼夜调度 |
| `packages/core/src/exthw/types.ts` | 外部作业源类型 |

## 示例工程

- `examples/harness-skel/`：可编译的 Rust sidecar 插件骨架，实现宿主握手、
  `onethu.call` 转发与命令执行。
