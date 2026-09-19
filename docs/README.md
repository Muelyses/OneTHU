# OneTHU 文档

**OneTHU** 是清华大学校园助手应用（Tauri v2 + React，桌面三端 + Android）：内置课表、
作业、日程、图书馆座位、校园卡、电费、校园网等日常功能的统一界面，并提供插件系统
让任何人扩展它。

## 我该读哪份

| 你的目的 | 读这份 |
|---|---|
| 写一个插件（比如"每天早上播报今日课表"） | [插件开发指南](./plugin-development.md) → 需要查接口时翻 [API 参考](./api-reference.md) |
| 查某个接口的参数、返回值、报错 | [`onethu.*` API 参考](./api-reference.md) |
| 理解应用内部怎么运作（会话自愈、MadModel 免费档、主题系统…） | [系统架构](./architecture.md) |
| 使用 / 扩展雨课堂、TUOJ、Tyche 作业聚合 | [外部作业源](./external-homework.md) |
| 在宿主本体上做开发（贡献者） | [系统架构](./architecture.md) §8 构建与发布 |

## 文档职责

| 文档 | 回答的问题 |
|---|---|
| [plugin-development.md](./plugin-development.md) | 插件怎么写、怎么打包成三种形态、协议长什么样、怎么调试 |
| [api-reference.md](./api-reference.md) | `ctx.onethu.*` 每个命名空间是什么系统、每个方法收什么返回什么、怎么报错 |
| [architecture.md](./architecture.md) | 进程模型、各子系统的设计决策与踩坑记录 |
| [external-homework.md](./external-homework.md) | 作业聚合功能的登录方式、自动恢复行为、如何新增一个源 |

## 接口真源（与文档冲突时以代码为准）

| 真源 | 内容 |
|---|---|
| `apps/desktop/src/plugins/types.ts` | `onethu.*` API 面与权限枚举 |
| `apps/desktop/src/plugins/facade.ts` | 权限门禁与 API 实现 |
| `packages/core/src/info/types.ts` | 领域类型 |
| `apps/desktop/src/state/theme.ts` | 主题定义与昼夜调度 |
| `packages/core/src/exthw/types.ts` | 外部作业源类型 |

## 示例

- `examples/harness-skel/` — 可直接 `cargo build` 的 Rust sidecar 插件骨架。
