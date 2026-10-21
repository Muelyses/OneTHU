# 反馈修复验收（2026-10-18）

> 历史记录 / Historical record：本文保留当时的计划、研究或验收证据，不代表 0.11 当前能力全集。现行说明见 [文档入口](../../README.md)；英文入口见 [English overview](../../en/index.md)。


用户 8 页 PDF 的 30 条反馈 + 长 Segment 指示条，逐项验收见 `docs/plans/2026-10-18-feedback-repairs.md`。

## 怎么复跑

```bash
# 1) 起 dev server（浏览器预览要用真实组件，不另造 mock 页面）
pnpm --filter @onethu/desktop dev            # 默认 5180
# 2) 跑验收（会写回本目录的截图与 report.json）
node tools/feedback-repairs-browser-test.mjs
# 可选：换地址
ONETHU_TEST_URL=http://127.0.0.1:5199 node tools/feedback-repairs-browser-test.mjs
```

`report.json` 是逐项断言结果：`checks` 为通过数，`errors` 必须为空（浏览器预览没有 Tauri 桥，
`reading 'invoke'` 一类的预览环境噪声已在该脚本里过滤，真机不存在）。

## 产物

| 文件 | 说明 |
| --- | --- |
| `desktop-home.png` | 桌面首页：三栏（标签条/底栏/OneGO）不重叠、白板工具栏带文字 |
| `vertical-rail.png` | 竖版标签栏 30 个标签：底部动作仍在屏内、OneGO 不被盖 |
| `oh-composer.png` | OH 面板底部 composer 可见、与胶囊共享草稿 |
| `segments.png` | 长 Segment 拖动指示条 + Surface 内边距 + 按钮行高 + 胶囊几何 |
| `home-390.png` / `home-320.png` | 手机两档：无横向溢出、白板工具/硬刷新钮互不遮挡 |
| `glass-blur.png` | glass 皮肤下设置浮层真模糊（backdrop-filter 生效） |
| `wallpaper-ink.png` | 深色壁纸下前景标题自动转亮 |

## 这一轮修的根因（不是逐条打补丁）

- **导航三栏**：底栏与顶栏都 fixed 在 `top:0`，z 高的底栏把标签条整个盖住 → 改成两行。
- **`.og-surface` 漏 padding**：`pad` 属性全站失效（清小搭气泡、卡片全中）。
- **backdrop root**：遮罩入场动画 `forwards` 留下永久 backdrop root，`backdrop-filter` 全失效 → 改 `backwards`。
- **卡片点击**：`Card` 把 children 包进带 padding 的 `.og-card-body`，入口按钮只占内侧 → `stat-click/course-card` 走 flush。
- **滚动条噪声**：组件卡体原本 `overflow:auto`，溢出 2px 就画拇指 → 静默滚动（保留滚动能力）。
- **拖动裁切**：画布尺寸按落库 rect 算，拖动中不跟手 → 按实时 rect 算。
- **壁纸前景色**：亮度采样被外层不透明画布“洗白” → 采样到 `.explorer-shell` 为止。
- **取色开关与昼夜调度打架**（护栏回归）：`deactivateTheme/activateTheme` 会一并清掉 `followSystem`，
  取色一进一出「跟随昼夜」就丢 → 新增 `detachAppliedTheme()`（只摘当前主题）与 `setFallbackTheme()`
  （只切视觉，不动用户选择）。

## 已知边界

- 浏览器预览没有 Tauri 命令与校园网服务：登录、OH 模型、清小搭技能接口只能验到“错误分流/交互反馈”，
  真实联调走桌面端手测。
- 清小搭技能广场与 OH 技能的互通（OH 侧技能注册 + 管理）是独立大活，用户已指示暂缓；本轮只补交互反馈。
- 7 个 oneGUI 之前遗留的护栏仍红（类名已下线），与本轮反馈无关，已在基线复现，单独排期。
