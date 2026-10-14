# OneGUI · 独立样式全量清点（迁移工作单）

> 生成物：`node tools/onegui-audit.mjs`（2026-10-14）。**用户定案：所有可见对象必须来自 OneGUI 或它的派生，
> 不允许任何独立手写的样式** —— 本清单就是那句话的执行面：清点 → 逐条消灭 → 末尾判据全部为 0。

## 0. 判据（完成 = 下列全部为 0）

| # | 独立样式源 | 当前 | 目标 |
|---|---|---:|---:|
| A | 旧样式表规则（apps/desktop/src/styles） | 2667 | 0 |
| B | 组件内嵌 CSS（`<style>` 块 / `*_CSS` 模板字符串） | 4 | 0 |
| C1 | 内联样式（含外观属性 `style={{…}}`） | 572 | 0 |
| C2 | 内联几何（纯定位/尺寸，迁移后由组件 prop 承担） | 271 | 0 |
| D | TSX 字面色值（`#rgb`/`rgba()`/`hsl()`） | 376 | 0 |
| E | 裸控件（`<button|input|select|textarea>`） | 336 | 0 |
| F | 运行时注入（createElement(style)/innerHTML/insertRule） | 4 | 0 |
| | **合计** | **3959** | **0** |

## A. 旧样式表（8 个文件 / 12130 行 / 1487 个类名 / 2667 条规则）

| 文件 | 行 | 规则 | 类名 | 零引用类名 | 过渡桥 |
|---|---|---|---|---|---|
| `apps/desktop/src/styles/global.css` | 8047 | 1948 | 1093 | 105 |  |
| `apps/desktop/src/styles/explorer-ui.css` | 928 | 201 | 98 | 3 |  |
| `apps/desktop/src/styles/motion.css` | 887 | 179 | 74 | 4 |  |
| `apps/desktop/src/styles/explorer-home.css` | 850 | 149 | 86 | 8 |  |
| `apps/desktop/src/styles/explorer.css` | 594 | 105 | 66 | 4 |  |
| `apps/desktop/src/styles/explorer-oh.css` | 367 | 66 | 40 | 1 |  |
| `apps/desktop/src/styles/onegui-bridge.css` | 344 | 13 | 30 | 8 | 是（TEMP） |
| `apps/desktop/src/styles/glass-levels.css` | 113 | 6 | 0 | 0 |  |

**零引用类名 133 个**（可先删；注意动态拼接类名要人工确认）——前 20：
- apps/desktop/src/styles/explorer-home.css: .home-searchbar
- apps/desktop/src/styles/explorer-home.css: .home-resume
- apps/desktop/src/styles/explorer-home.css: .home-resume-chip
- apps/desktop/src/styles/explorer-home.css: .is-workspace
- apps/desktop/src/styles/explorer-home.css: .home-catalog-row
- apps/desktop/src/styles/explorer-home.css: .is-sm
- apps/desktop/src/styles/explorer-home.css: .hs-logo
- apps/desktop/src/styles/explorer-home.css: .hs-detail-btn
- apps/desktop/src/styles/explorer-oh.css: .ohx-searchbar
- apps/desktop/src/styles/explorer-ui.css: .ex-input
- apps/desktop/src/styles/explorer-ui.css: .ex-tab-star
- apps/desktop/src/styles/explorer-ui.css: .explorer-tabstrip-wrap
- apps/desktop/src/styles/explorer.css: .settings-close
- apps/desktop/src/styles/explorer.css: .settings-title
- apps/desktop/src/styles/explorer.css: .wall-thumb-box
- apps/desktop/src/styles/explorer.css: .wall-lib-upload
- apps/desktop/src/styles/global.css: .brand-mark
- apps/desktop/src/styles/global.css: .brand-name
- apps/desktop/src/styles/global.css: .btn-danger
- apps/desktop/src/styles/global.css: .exthw-oj-head

## B. 组件内嵌 CSS（4 处）

| 文件 | 形态 | 约字节 |
|---|---|---|
| `apps/desktop/src/components/FilePreview.tsx` | <style> 块 | 33330 |
| `apps/desktop/src/components/FilePreview.tsx` | 模板字符串 DOCX_CSS | 678 |
| `apps/desktop/src/lib/yktBody.ts` | <style> 块 | 10859 |
| `apps/desktop/src/pages/MailPage.tsx` | <style> 块 | 1116 |

## C1. 内联外观样式 Top 25（共 572 处 / 91 个文件）

| 文件 | 处数 |
|---|---|
| `apps/desktop/src/pages/info/LibraryTab.tsx` | 33 |
| `apps/desktop/src/pages/Schedule.tsx` | 21 |
| `apps/desktop/src/components/ThemePickerModal.tsx` | 20 |
| `apps/desktop/src/components/boardCards.tsx` | 20 |
| `apps/desktop/src/pages/info/KongjianTab.tsx` | 19 |
| `apps/desktop/src/pages/info/LibRoomTab.tsx` | 19 |
| `apps/desktop/src/pages/info/NetworkTab.tsx` | 19 |
| `apps/desktop/src/pages/info/NewsTab.tsx` | 19 |
| `apps/desktop/src/pages/ScheduleAgenda.tsx` | 17 |
| `apps/desktop/src/pages/info/VenueSportsTab.tsx` | 17 |
| `apps/desktop/src/pages/Plugins.tsx` | 16 |
| `apps/desktop/src/pages/info/CardTab.tsx` | 16 |
| `apps/desktop/src/pages/learn/AssignmentDetailPage.tsx` | 15 |
| `apps/desktop/src/components/FilePreview.tsx` | 14 |
| `apps/desktop/src/pages/info/SportsTab.tsx` | 14 |
| `apps/desktop/src/pages/learn/Forum.tsx` | 13 |
| `apps/desktop/src/components/ExtHwLoginModal.tsx` | 12 |
| `apps/desktop/src/pages/ThubookPage.tsx` | 12 |
| `apps/desktop/src/pages/info/CourseInfoTab.tsx` | 12 |
| `apps/desktop/src/pages/zhjwxk/Courses.tsx` | 12 |
| `apps/desktop/src/lib/confirm.tsx` | 11 |
| `apps/desktop/src/components/GlobalOrb.tsx` | 10 |
| `apps/desktop/src/components/VoiceSettingsSection.tsx` | 10 |
| `apps/desktop/src/components/explorer/TabStrip.tsx` | 10 |
| `apps/desktop/src/components/NotifySettingsSection.tsx` | 9 |

## C2. 内联几何 Top 15（共 271 处）

| 文件 | 处数 |
|---|---|
| `apps/desktop/src/components/FilePreview.tsx` | 22 |
| `apps/desktop/src/pages/learn/Forum.tsx` | 16 |
| `apps/desktop/src/pages/zhjwxk/Courses.tsx` | 14 |
| `apps/desktop/src/components/ExtHwSettingsSection.tsx` | 10 |
| `apps/desktop/src/pages/info/NewsTab.tsx` | 10 |
| `apps/desktop/src/components/HomeWidgets.tsx` | 9 |
| `apps/desktop/src/pages/Plugins.tsx` | 9 |
| `apps/desktop/src/pages/Schedule.tsx` | 9 |
| `apps/desktop/src/components/GlobalOrb.tsx` | 8 |
| `apps/desktop/src/components/ThemePickerModal.tsx` | 8 |
| `apps/desktop/src/pages/info/KongjianTab.tsx` | 7 |
| `apps/desktop/src/pages/info/SportsTab.tsx` | 7 |
| `apps/desktop/src/pages/learn/CourseDetailPage.tsx` | 7 |
| `apps/desktop/src/components/SoftwareUpdateSection.tsx` | 6 |
| `apps/desktop/src/pages/info/LibRoomTab.tsx` | 6 |

## D. 字面色值 Top 25（共 376 处 / 49 个文件）

| 文件 | 处数 |
|---|---|
| `apps/desktop/src/state/theme.ts` | 111 |
| `apps/desktop/src/components/DevPanel.tsx` | 23 |
| `apps/desktop/src/lib/courseColor.ts` | 18 |
| `apps/desktop/src/pages/ThubookPage.tsx` | 15 |
| `apps/desktop/src/lib/yktBody.ts` | 14 |
| `apps/desktop/src/pages/ScheduleAgenda.tsx` | 13 |
| `apps/desktop/src/state/wallpaper.ts` | 13 |
| `apps/desktop/src/components/FilePreview.tsx` | 11 |
| `apps/desktop/src/components/OnboardingTourParticles.tsx` | 10 |
| `apps/desktop/src/lib/textContrast.ts` | 9 |
| `apps/desktop/src/pages/MailPage.tsx` | 9 |
| `apps/desktop/src/lib/xklogic.ts` | 8 |
| `apps/desktop/src/components/ExtHwLoginModal.tsx` | 7 |
| `apps/desktop/src/state/explorer.ts` | 7 |
| `apps/desktop/src/components/exthw/ProblemBody.tsx` | 6 |
| `apps/desktop/src/lib/dynamicRoles.ts` | 6 |
| `apps/desktop/src/pages/learn/Forum.tsx` | 6 |
| `apps/desktop/src/components/explorer/TabStrip.tsx` | 5 |
| `apps/desktop/src/components/explorer/WorkspaceEditor.tsx` | 5 |
| `apps/desktop/src/pages/Trace.tsx` | 5 |
| `apps/desktop/src/pages/info/CardTab.tsx` | 5 |
| `apps/desktop/src/pages/learn/AssignmentDetailPage.tsx` | 5 |
| `apps/desktop/src/components/RootErrorBoundary.tsx` | 4 |
| `apps/desktop/src/components/boardCards.tsx` | 4 |
| `apps/desktop/src/components/explorer/FolderIconPicker.tsx` | 4 |

## E. 裸控件 Top 25（共 336 处 / 84 个文件）

| 文件 | 处数 |
|---|---|
| `apps/desktop/src/components/FreeBoard.tsx` | 27 |
| `apps/desktop/src/pages/Plugins.tsx` | 17 |
| `apps/desktop/src/plugins/ChatDock.tsx` | 17 |
| `apps/desktop/src/pages/Today.tsx` | 16 |
| `apps/desktop/src/pages/FolderPage.tsx` | 15 |
| `apps/desktop/src/pages/TasksPage.tsx` | 15 |
| `apps/desktop/src/components/explorer/HomeSpheres.tsx` | 10 |
| `apps/desktop/src/components/explorer/TabDrawer.tsx` | 10 |
| `apps/desktop/src/pages/GitLabPage.tsx` | 10 |
| `apps/desktop/src/components/DevPanel.tsx` | 7 |
| `apps/desktop/src/components/boardCards.tsx` | 7 |
| `apps/desktop/src/components/explorer/TabStrip.tsx` | 7 |
| `apps/desktop/src/pages/info/NewsTab.tsx` | 7 |
| `apps/desktop/src/pages/learn/Forum.tsx` | 7 |
| `apps/desktop/src/components/Collect.tsx` | 6 |
| `apps/desktop/src/components/Layout.tsx` | 6 |
| `apps/desktop/src/components/explorer/OneGoSheet.tsx` | 6 |
| `apps/desktop/src/pages/BoardPage.tsx` | 6 |
| `apps/desktop/src/pages/Learn.tsx` | 6 |
| `apps/desktop/src/pages/Login.tsx` | 6 |
| `apps/desktop/src/pages/ServicesPage.tsx` | 6 |
| `apps/desktop/src/pages/MailPage.tsx` | 5 |
| `apps/desktop/src/pages/info/NetworkTab.tsx` | 5 |
| `apps/desktop/src/pages/info/ThosPage.tsx` | 5 |
| `apps/desktop/src/components/explorer/WallpaperLibrary.tsx` | 4 |

## F. 运行时样式注入（4 个文件）

| 文件 | 处数 |
|---|---|
| `apps/desktop/src/lib/dynamicColor.ts` | 1 |
| `apps/desktop/src/plugins/loader.ts` | 1 |
| `apps/desktop/src/state/theme.ts` | 1 |
| `apps/desktop/src/state/userext.ts` | 1 |

## 迁移顺序（按"可见性 × 代价"排）

1. **E 裸控件 + C1 内联外观**：直接换成 OneGUI 组件（形态最明确，收益最大）。
2. **D 字面色值**：换成组件 tone/variant 或语义令牌。
3. **B 组件内嵌 CSS / F 运行时注入**：先搬进 OneGUI 的组件样式表，再删注入点。
4. **A 旧样式表**：随页面迁移逐族删除；过渡桥（TEMP）最后与旧样式表一起删。
5. **C2 内联几何**：迁到组件 prop（`pos`/`Grid`/`Stack`）后清零。
