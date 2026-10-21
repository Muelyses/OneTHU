# 暂存箱体验重做验收 · 2026-10-20

> 历史记录 / Historical record：本文保留当时的计划、研究或验收证据，不代表 0.11 当前能力全集。现行说明见 [文档入口](../../README.md)；英文入口见 [English overview](../../en/index.md)。


本轮覆盖共享管理面板与标签页、可移动贴边入口、预览雷达、收发口令和已发口令管理。验收通过实际浏览器点击、键盘及触摸事件完成，保留原有回归语义，并补充交互变化后的检查。

## 浏览器回归

| 命令 | 结果 | 主要范围 |
| --- | --- | --- |
| `node tools/vault-workspace-browser-test.mjs` | 136 项，进程自然 exit 0 | 1280×860、390×844、320×568、844×390；入口、面板、标签页、焦点、文件与文字预览 |
| `node tools/vault-browser-test.mjs` | 50 项，进程自然 exit 0 | 原暂存箱收纳、分享、接收、名片组合、权限与拖入回归 |
| `node tools/mobile-vault-browser-test.mjs` | 14 项，进程自然 exit 0 | 手机贴边入口、组合分享、名片及组织入口 |
| `node tools/short-share-browser-test.mjs` | 52 项，进程自然 exit 0 | 分享预览、显式生成与复制、短码兼容、匿名接收、过期与撤销 |

上述脚本均在浏览器正常关闭后才输出成功；未使用强制退出代替清理。Chrome 测试实例使用 `--disable-updater-scheduler`，隔离 HMR，顺序执行清理。四个脚本的 `node --check` 和工作区 `git diff --check` 均通过。

结构化结果见 [workspace-report.json](workspace-report.json)。短口令的截图和报告仍位于 [short-share-codes](../short-share-codes/report.json)。本次运行日志为 `/tmp/onethu-vault-workspace-final.log` 和 `/tmp/onethu-vault-regressions-final.log`。

## 本轮实际验收的行为

- 桌面鼠标拖动入口、手机长按拖动入口后保存左右边缘及相对高度；刷新恢复。手机从入口向内短滑打开完整管理面板，普通页面边缘滑动不误触。
- 雷达直接挂载到 `body`，三个不同内容的最近条目标题可读；整理按钮实际命中且不被 OneShot 遮挡。关闭和 Escape 均将焦点归还持久入口。
- 管理面板与标签页共用内容：新建、切换、搜索、清空搜索、更多菜单移除均通过实际控件操作。手机验证原生选择框的当前值，桌面验证标题和侧栏。
- 接收子弹层内 Tab 和 Shift+Tab 能前后移动，Escape 只关闭最上层。菜单退出后焦点回到对应条目；关闭管理面板回到入口。
- Enter 打开文字条目，验证超过 90 字后的完整末尾；Escape 关闭文字预览并保留管理面板。桌面点击真实拖入的文件后，管理面板先退出，独立文件预览显示完整字节内容，Escape 正常关闭。
- 一次冒泡的文件 drop 只进行一次指纹计算及暂存，且只进入目标箱。检查实际 hash 调用次数，避免内容去重掩盖重复处理。
- 分享先预览，显式点击才生成；生成不会静默复制，复制按钮写入相同完整口令。已发口令的复制、更多管理、改名、限定邮箱及撤销保留原覆盖。
- 四种尺寸均检查面板处于视口内、标签页无横向溢出且无页面运行时异常。

## 截图索引

管理面板主图均在滚动容器回到顶部、提示条消失后拍摄；短屏另外保留底部图，说明内容及已发口令入口可滚动到达。截图关闭动画，避免捕捉入场半透明帧。

| 尺寸 | 预览雷达 | 管理面板顶部 | 条目菜单 | 完整标签页 | 管理面板底部 |
| --- | --- | --- | --- | --- | --- |
| 1280×860 | [预览](radar-1280x860.png) | [顶部](manager-1280x860.png) | [菜单](item-menu-1280x860.png) | [标签页](page-1280x860.png) | — |
| 390×844 | [预览](radar-390x844.png) | [顶部](manager-390x844.png) | [菜单](item-menu-390x844.png) | [标签页](page-390x844.png) | — |
| 320×568 | [预览](radar-320x568.png) | [顶部](manager-320x568.png) | [菜单](item-menu-320x568.png) | [标签页](page-320x568.png) | [底部](manager-bottom-320x568.png) |
| 844×390 | [预览](radar-844x390.png) | [顶部](manager-844x390.png) | [菜单](item-menu-844x390.png) | [标签页](page-844x390.png) | [底部](manager-bottom-844x390.png) |

已人工查看最新 320×568 与 844×390 管理面板顶部、底部截图；顶部选择框/标题和操作区完整，长内容通过内部滚动可达。父任务另外查看了 1280×860 与 390×844 主图。

横屏最终复查发现标题区占用偏多，收紧短屏标题和间距后，另以 `ONETHU_TEST_SIZES=844x390 node tools/vault-workspace-browser-test.mjs` 复跑 33 项，进程自然 exit 0。新顶部截图中第一条文件完整可见，第二条标题也进入首屏；底部截图确认全部三项及已发口令入口仍可达。独立结果见 [landscape-compact-report.json](landscape-compact-report.json)；完整报告保留四种尺寸及 136 条记录，仅更新横屏对应检查和几何信息，其余三尺寸沿用上一轮完整运行。

## 并行专项结果

下列项目由同轮其他 agent 执行并报告，详细范围以各测试脚本为准：

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| `tools/vault-anchor-browser-test.mjs` | 33 项 | [edge-results.json](edge-results.json)；触屏横屏、避障、默认复位、返回和设备位置隔离 |
| `tools/vault-vertical-rail-browser-test.mjs` | 17 项，自然 exit 0 | [vertical-rail-report.json](vertical-rail-report.json)；固定与悬停展开的竖标签栏，保存左侧偏好时临时避让且不覆盖偏好 |
| `tools/vault-exchange-ui-test.mjs` | 36 项，自然 exit 0 | 含已删箱的口令管理、命名/确认/输入子弹层的返回、Tab/Shift+Tab/Escape 与 Promise 结算 |
| `tools/nav-stack-test.mjs` / `tools/mobile-nav-test.mjs` | 15 / 4 项 | 嵌套覆盖层返回栈 |
| `tools/private-share-browser-test.mjs` | 43 项 | `/tmp/onethu-vault-private-regression.log` |
| `pnpm guard` / `pnpm guard:onegui` | exit 0 | `/tmp/onethu-vault-guard-complete.log`、`/tmp/onethu-vault-onegui-final-state.log` |
| 桌面类型检查 / 生产构建 | exit 0 | `/tmp/onethu-vault-typecheck-final-state.log`、`/tmp/onethu-vault-build-final-state.log` |

入口专项截图：[手机](edge-phone390.png)、[触屏横屏](edge-landscape.png)、[暗色入口](edge-dark-phone390.png)、[玻璃入口](edge-glass-phone390.png)、[暗色面板](manager-dark-phone390.png)、[玻璃面板](manager-glass-phone390.png)。

桌面竖标签另见 [悬停展开与贴边入口](edge-vertical-rail.png)：真实鼠标悬停展开到 232px 时，入口与预览均避开标签栏，整理按钮仍实际可点，关闭面板后焦点返回入口。

## 验收边界

使用本机 Chrome 无头浏览器和假云盘夹具；没有实体 Android、真实 NFC 或真实云盘账号验收。手机拖动和轻滑使用 CDP 可信触摸事件；桌面系统文件拖入使用浏览器 DOM `DataTransfer`，不等同于实体系统文件管理器拖入。Workspace 套件的 844×390 是非触屏横屏；入口专项另外覆盖手机同一上下文旋转到 844×390 的触屏情况。

浏览器夹具只证明所列应用流程和回归行为；真实设备手感、原生文件选择、NFC 传送和生产云盘连通性仍需实机确认。

## 最终审阅与旧检查边界

主 agent 已实际查看桌面、390 手机、320 窄屏、844 横屏，以及暗色和玻璃主题截图。横屏头部过高的问题根据截图追加压紧，再次查看确认首条内容完整可见；短屏底部仍能滚动到达。最后一次横屏 CSS 修改后，CSS 结构检查、OneGUI 守卫与桌面生产构建再次通过，未提高任何守卫基线。

本轮相关浏览器回归通过，不代表仓库所有历史脚本都通过。迁移共享确认框时适配了三个旧静态脚本中的确认组件断言，其余既存失败没有删除或放宽：

| 脚本 | 仍失败的检查 | 基线核验 |
| --- | --- | --- |
| `tools/motion-test.mjs` | 347 行课表动画结构 | 独立 HEAD 副本同一首个失败 |
| `tools/hw-ignore-test.mjs` | 63 行首页作业过滤结构 | 独立 HEAD 副本同一首个失败 |
| `tools/session-img-prompt-test.mjs` | 132 行附件登录墙结构 | HEAD 原脚本先在 91 行旧 `</button>` 字面断言失败；独立对 HEAD 的 FilePreview 执行 132 行断言亦失败 |

核验采用 `git archive 4921a9c1d50248449e1b9da28c4b145dbfafb927` 解出的独立源码与原脚本。涉及的 FilePreview、boardCards、Schedule 文件与基线逐字节相同，本轮没有修改这些功能。完整静态检查结果的边界据此保留。
