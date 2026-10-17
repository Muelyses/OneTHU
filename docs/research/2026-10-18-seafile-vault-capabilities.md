# 清华云盘（Seafile）能力与暂存箱/口令落地调研（2026-10-18）

> 只读调研，基线 `35cef40f`。结论用于 `docs/plans/2026-10-18-organization-vault-share.md` 的 Phase 2+ 设计。
> 本文每条事实都可在仓库内复核；标「待 live 验证」的条目在实现前必须先冒烟。

## 1. 现有能力盘点

Rust 真源在 `apps/desktop/src-tauri/src/seafile.rs`，TS 状态层在 `apps/desktop/src/state/seafile.ts`。

| 能力 | 现状 | 缺口/风险 |
|---|---|---|
| 账号/配额/资料库 | `seafile_account/repos`；可建库 | 只有总配额，无上传前检查 |
| 列目录/建目录 | `seafile_dir/mkdir` | 6 处各自逐级 mkdir，无统一封装 |
| 上传/覆写 | `seafile_upload/update_file`；整文件进内存；`replace` 覆盖 | 无进度/取消/分片；`update_file` 零调用；同名 replace 不能当去重 |
| 断点续传 | `seafile_uploaded_bytes/upload_resume` 已实现 | 零调用；仍整读文件；自注 >200MB 应改流式 |
| 下载/读字节 | `seafile_download/read_bytes`（上限 48MB 调用方） | 整包进内存；无进度 |
| 删除/移动/改名 | `seafile_delete/move` | 永久删除、无回收站；无改名 UI |
| **创建分享链接** | `seafile_share` 支持 `expire_days`、`password` | TS 全部 `password:""`；CloudPage 传 0=永久且文案说 7 天；**无查询/撤销/密码 UI** |
| 库内搜索 | `seafile_search` | 索引延迟；可用 |
| 系统文件选择直传 | `seafile_pick_upload` | 只在云盘页可用 |
| 共享给用户/群组 | 无 | 好友共享云盘需新增 API 并 live 验证 |
| 回收站/还原 | 无 | — |

插件门面只暴露 6 个：`cloud.repos/list/search/download/upload/share`；mkdir/delete/move/read_bytes/pick_upload 未进插件 API。

## 2. 现有同步模式可复用点

- 自动建库 + 建后按名复查：`memory/sync.ts:34-52`、`wallpsync.ts:41-65`。
- 小清单整文件 JSON + `replace` 上传：`wallpsync.ts:86-108`；暂存箱每箱一份 `manifest.json` 最稳。
- 本地账本 + 内容 sha1 + mtime 粗筛：memory 模式；但 memory 只「信任远端较新」、删除不传播、失败静默，暂存箱**不能照抄**。
- stage→确认→commit：IM 附件（`im/mediaPipe.ts`、`im/registry.ts`）；pending 需落盘。
- 读 manifest 用 `seafile_read_bytes`，不要下载到 Downloads。

## 3. 内容哈希/去重

- 现有只有文本 SHA-1（WebCrypto，`memory/format.ts:225-231`）和 updater 内部 Rust SHA-256（未暴露命令）。
- `vault.ts` 的 `file.hash` 目前没有生产者，`isDuplicate/fileHashIndex` 实际不生效。
- Seafile dirent `id`/上传返回 `id` 被丢弃；是否等于内容 oid 需 live 验证，不能当唯一去重键。
- 建议：新增 Rust `file_sha256(path)`（流式）；去重键 = sha256(bytes)；上传前查本地索引/云端 `_index/files.json`；同名 replace 绝不当秒传。

## 4. 分享链接生命周期（当前最大风险）

- **创建可用**；**查询/撤销/密码设置缺失**。
- 匿名可读性已实证：`lib/updater.ts:224-255` 通过固定 share token 匿名 GET dirents、`/d/<token>/files/?p=…&dl=1` 支持 Range → 链接泄露即可被下载/枚举。
- 目录分享未在清华实例验证（`seafile.rs:41-50` 有 403 提示）。
- 可行替代（按推荐度）：① zip/单文件 manifest 分享（只用已实测文件分享）；② 多文件逐个分享 + 清单内联；③ GitLab 不推荐；④ 邮件只做通知。
- 实现前必须 live 冒烟：创建目录分享、密码、有效期、`DELETE /api/v2.1/share-links/<token>/`、过期后访问表现。

## 5. 强制云盘影响

唯一断开入口：`CloudPage.tsx:614-623` → `clearSeafileToken()`。未连接时多个功能静默降级：OH 记忆、主对话、壁纸、IM 附件、OH 云盘工具、附件转存等。
登出/换账号**不清云盘 token**（`lib/clients.ts:645-668`），有跨账号泄露风险。
建议策略：**本地读可用；写/分享/新文件强制云盘**；移除断开 UI；启动 silent connect 失败改为阻塞式 ConnectGate；换账号清 token。

## 6. 统一文件中转（设计）

`lib/fileChannel.ts`（唯一出口）+ `state/transferQueue.ts`（持久化队列）+ `lib.rs`/`transfer.rs`：
`来源 → stage（本地暂存 + sha256）→ 去重 → 上传（进度/取消/重试）→ 写引用 → 清理暂存`。
Rust 最小新增：`file_sha256`、流式上传（进度/取消）、`share_link_list/delete`、可选 `share_read`（匿名读分享清单）。
本地暂存目录用 appCache 专用 `staging/<uuid>` + TTL，不要用固定名临时文件。

## 7. 课程共享方略

- 课程可分享：id/name/英文名/课号/教师。
- 作业：只分享 id/课程/title/DDL/类型；**不分享 content、提交内容、成绩、批语、答案附件、会话 URL**。
- 通知：只分享标题/发布者/时间/重要性；正文与附件留在本机。
- 课程文件：默认只分享引用+元数据，不复制字节；用户显式「存入我的云盘」才走文件通道；注意版权。
- OJ 红线：不碰提交/答案；只允许标题/截止的只读引用。
- 分享默认 7 天有效期，不默认永久。

## 8. 文字获取

- HTML→文本：`packages/core/src/info/htmltext.ts`；新闻用 `NewsDetail.plain`；邮件 text/html 需 stripTags。
- 本地文件文本预览：Rust `im_peek_text`（默认 400 字、上限 60k、>8MB 拒绝）。
- 选中文本：`ContextMenu.tsx` 的 `hasTextSelection()`；应用可 `navigator.clipboard.readText()`（用户手势内）。
- 净化顺序：剥 script/style → 去标签 → 解实体 → 压空白；不存 innerHTML；正文 ≤4KB、标题 ≤120 字、摘要 ≤512 字；来源指纹 + sha256 去重。
- 剪贴板可能含密码，需要显式提示/不默认入箱。

## 9. 对象可拖性普查（摘要）

- 只差一个属性：搜索/邮件/新闻/课程/作业/通知/文件/体育/图书馆/研讨间/公共空间/空教室（都有 `CollectStar` 原子，可直接做 `data-vault-catch`）——本轮已在 `CollectStar` 统一接上。
- 需要新对象类型/稳定 key：白板卡片（boardId+itemId）、日程（事件 uid/合成 key）、设置行（routeId）、主题、壁纸、选课、插件、OnePage、邀请/名片。
- 当前无入口：系统文件拖放/剪贴板文件/Android ACTION_SEND。
- 需要手势仲裁：白板卡片（500ms 长按/4px）、标签条（300/500ms）、作业轮播横向拖、OH 胶囊 450ms。

## 10. 风险清单

| 级别 | 风险 |
|---|---|
| 高 | 分享链接无法撤销/过期行为未验证；匿名可枚举下载 |
| 高 | 无内容哈希 → 去重失效、重复占配额 |
| 高 | 上传/下载整文件进内存、无进度/取消 |
| 高 | 强制云盘后离线/弱网体验与 6 处静默降级 |
| 高 | 换账号不清 token → 跨账号数据暴露 |
| 高 | 课程/作业分享触碰版权与学术红线 |
| 中 | 目录分享未验证；inline 口令可带任意 payload/cloudPath；FNV 非安全签名 |
| 中 | Android 无分享面板入口；本地暂存目录可能被系统清理 |

## 11. 下一步（Phase 2 决策）

1. 先做 `file_sha256` + 统一文件通道 + transfer 队列（不依赖分享撤销）。
2. live 验证分享链接生命周期；通过则实现 `vaultCloud` adapter（manifest 单文件 + 分享链接），不通过退化为 zip/manifest 单文件分享。
3. 口令升级 `ONV2`：sha256 摘要、过期、白名单/长度上限、只带云盘引用；`ONV1` 兼容读。
4. 强制云盘单独批次：移除断开、阻塞式连接、账号切换清 token、迁移提示。
5. 课程/文字分享按第 7/8 节口径实现，先做「只分享引用」。
