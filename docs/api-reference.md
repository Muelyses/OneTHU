# 插件 API 参考（0.11）

中文 · [English](en/api-surface.md)

完整接口不再维护一份容易滞后的人工清单。请使用从实际 TypeScript 类型和门面提取的 [完整 API 面](api-surface.md)：当前快照为 **36 个命名空间、255 个方法入口**，签名、参数和直接权限门禁均在表中。

## 真源与重新生成

- `apps/desktop/src/plugins/types.ts`：`OnethuApi` 类型、同步与异步签名。
- `apps/desktop/src/plugins/facade.ts`：宿主实现、权限、服务和平台检查。
- `docs/api-surface.json`：机器可读的同一份快照。

```bash
node tools/docs-api-surface.mjs
```

JS 通过 `ctx.onethu.<namespace>.<method>(...)` 调用；Rust sidecar 使用宿主定义的 `onethu.call` 协议，参数按位置传递。完整协议和 manifest 见 [插件开发](plugin-development.md)。

## 约定

以具体方法类型判断是否返回 Promise，不依赖一张旧例外列表。缺少权限时请求应拒绝；登录挑战、会话失效、服务限流和超时应分别处理，不能统一无限重试。学校返回对象需要沿调用链传递时不要自行拼造身份或预约对象。

自动表格标为「见门面实现」表示提取器没有识别到该路径上的直接字面量门禁，**不代表无权限限制**。部分能力由嵌套帮助函数、插件形态、模式或远端账户权限进一步约束。

OH 工具、MCP、普通插件和清小搭技能运行环境不同。QuickJS 不提供宿主文件、网络或进程能力；重型 skill 导出给外部 Agent。账号与数据同步还需要通过真实服务验证，不能用夹具测试代替真实双账号联调。
