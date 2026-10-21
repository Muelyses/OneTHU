# 暂存箱长按来源大补 + 文件自动缓存 + 日程可选入日程 + OH 自动报备（2026-10-19）

> 历史记录 / Historical record：本文保留当时的计划、研究或验收证据，不代表 0.11 当前能力全集。现行说明见 [文档入口](../README.md)；英文入口见 [English overview](../en/index.md)。


用户原话：
- 「手机上怎么长按拖动没有雷达弹出」；
- 「补充几个基础的应该被拖动放到暂存箱的东西：任意一个日程（时间块）；云盘里的任意一个文件夹和文件；
  课程里面通知、作业里任意具体的附件；新闻里的文件附件；任意一个 gitlab 项目；任意一个在标签页栏的
  标签页与工作区」；
- 「文件拖进去就是自动缓存到暂存箱云盘了（可能比较复杂的下载再上传），日程则是可以选择是否
  添加到自己的日程」；
- 「预约报备那里是不是不对劲，怎么还要我手动点击！这玩意应该是自动的，且 OH 能操作的！」

## 暂存箱长按来源

新增 `lib/vaultCatch.ts`（统一构造 `data-vault-catch`）：

| 来源 | 文件 | 拖入后的行为 |
| --- | --- | --- |
| 日程（周时间块/列表） | `Schedule.tsx` / `ScheduleAgenda.tsx` | 存快照；点开时问「添加到我的日程？」 |
| 云盘文件 | `CloudPage.tsx` | **自动下载 → 缓存进暂存箱云盘** |
| 云盘文件夹 | `CloudPage.tsx` | 保留资料库引用，点开落云盘 |
| GitLab 项目 | `GitLabPage.tsx` | 点开落 project（gitlabProject 深链） |
| 课程通知附件 / 作业附件 | `NoticeDetailPage.tsx` / `AssignmentDetailPage.tsx` | 自动下载缓存 |
| 新闻附件 | `NewsTab.tsx` | 自动下载缓存 |
| 桌面标签页 | `TabStrip.tsx` | 点开回到该页 |
| 工作区 | `TabDrawer.tsx` / `OneGoSheet.tsx` | 点开恢复工作区 |

- OneGUI `Row` / `Card` 现在会透传 `data-*`（`kit.tsx` 的 `pickDataAttrs`）——以前属性直接被组件吞掉；
- 手机长按：`longPressSlop` 触摸放宽到 14px（手指抖动不再被当成滚动取消），并在长按期间吞掉
  Android 原生 contextmenu（否则系统「复制/全选」菜单会掐断指针）。

## 文件自动缓存

`lib/vaultRemote.ts`：

1. 云盘文件用 `seafile_download`；附件用 `downloadLearnUrl`；
2. `read_file_base64` 读字节 → `crypto.subtle` 算 SHA-256 → 回写暂存箱条目
   （`state/vault.updateVaultItem`，含 size/mime/hash/stagedPath）；
3. `state/vaultCloud.cacheVaultFiles()` 把仍有 `stagedPath` 的条目上传到 OneTHU 资料库
   `/Vault/cache` 并回写 `cloudPath`；
4. 云盘未连接/浏览器预览时保留引用并提示「已加入暂存箱；缓存失败…」，不丢内容。

## 日程拖入后可加入我的日程

`vaultCatchSchedule` 带 `startMs/endMs`（列表日程来自条目，周时间块来自当天日期）；
`vaultRegistry` 打开日程快照时调用 `offerScheduleToCalendar()`：
`confirmChoice("添加到我的日程？" / [添加到日程] [先留在暂存箱])`，选添加走
`putLocalEvent`（缺省 09:00–10:00，可再编辑）。

## 来访报备自动 + OH 可操作

- `state/visitDraft.ts`：`requestVisitDraft(patch, { submit?: boolean })`，新增 `pendingSubmit` /
  `peekVisitAutoSubmit()`；
- `VisitTab`：消费草稿时若带 submit，自动勾选确认并置 `autoSubmit`；模型就绪后直接 `submit()`，
  不再要求用户手点（默认仍只填草稿，保持可核对）；
- `facade.visit.fill(patch, { submit: true })` 透传；
- Rust Harness 新增工具 **`visit_fill`**（`plugins/OneTHU-Harness/core/src/tools.rs`）：
  默认草稿，`submit: true` 时委托 `visit.fill` 自动提交；子模块已构建并推送
  （`OneTHU-Harness` f7eb971）。

## 测试

- 新增 `tools/vault-catch-browser-test.mjs` 6 条：云盘/文件/标签页 `data-vault-catch`、
  CDP 触摸长按 → 雷达浮出 → 拖入暂存箱计数 +1、无运行时错误；
- 静态守卫扩：所有来源文件含 `data-vault-catch`、registry 含各 kind、文件缓存链路、
  日程二选一、visitDraft/facade/VisitTab/Rust visit_fill；
- `pnpm guard` 全绿。
