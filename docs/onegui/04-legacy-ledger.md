# OneGUI · 独立样式全量清点（迁移工作单）

> 生成物：`node tools/onegui-audit.mjs`（2026-10-14）。**用户定案：所有可见对象必须来自 OneGUI 或它的派生，
> 不允许任何独立手写的样式** —— 本清单就是那句话的执行面：清点 → 逐条消灭 → 末尾判据全部为 0。

## 0. 判据（完成 = 下列全部为 0）

| # | 独立样式源 | 当前 | 目标 |
|---|---|---:|---:|
| A | 旧样式表规则（apps/desktop/src/styles） | 2730 | 0 |
| B | 组件内嵌 CSS（`<style>` 块 / `*_CSS` 模板字符串） | 7 | 0 |
| C1 | 内联样式（含外观属性 `style={{…}}`） | 938 | 0 |
| C2 | 内联几何（纯定位/尺寸，迁移后由组件 prop 承担） | 296 | 0 |
| D | TSX 字面色值（`#rgb`/`rgba()`/`hsl()`） | 663 | 0 |
| E | 裸控件（`<button|input|select|textarea>`） | 396 | 0 |
| F | 运行时注入（createElement(style)/innerHTML/insertRule） | 4 | 0 |
| | **合计** | **4738** | **0** |

## A. 旧样式表（8 个文件 / 12443 行 / 1516 个类名 / 2730 条规则）

| 文件 | 行 | 规则 | 类名 | 零引用类名 | 过渡桥 |
|---|---|---|---|---|---|
| `apps/desktop/src/styles/global.css` | 8332 | 2002 | 1120 | 97 |  |
| `apps/desktop/src/styles/explorer-ui.css` | 926 | 201 | 98 | 3 |  |
| `apps/desktop/src/styles/motion.css` | 887 | 179 | 74 | 4 |  |
| `apps/desktop/src/styles/explorer-home.css` | 850 | 149 | 86 | 8 |  |
| `apps/desktop/src/styles/explorer.css` | 594 | 105 | 66 | 4 |  |
| `apps/desktop/src/styles/explorer-oh.css` | 437 | 76 | 42 | 1 |  |
| `apps/desktop/src/styles/onegui-bridge.css` | 304 | 12 | 30 | 8 | 是（TEMP） |
| `apps/desktop/src/styles/glass-levels.css` | 113 | 6 | 0 | 0 |  |

**零引用类名 125 个**（可先删；注意动态拼接类名要人工确认）——前 20：
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
- apps/desktop/src/styles/global.css: .tt-cell

## B. 组件内嵌 CSS（7 处）

| 文件 | 形态 | 约字节 |
|---|---|---|
| `apps/desktop/src/components/AttachActionsSheet.tsx` | 模板字符串 SHEET_CSS | 3547 |
| `apps/desktop/src/components/AttachTray.tsx` | 模板字符串 TRAY_CSS | 733 |
| `apps/desktop/src/components/FilePreview.tsx` | 模板字符串 DOCX_CSS | 678 |
| `apps/desktop/src/components/GlobalOrb.tsx` | <style> 块 | 10669 |
| `apps/desktop/src/components/ImageFilterSheet.tsx` | 模板字符串 SHEET_CSS | 2121 |
| `apps/desktop/src/lib/yktBody.ts` | <style> 块 | 10859 |
| `apps/desktop/src/pages/MailPage.tsx` | <style> 块 | 1116 |

## C1. 内联外观样式 Top 25（共 938 处 / 92 个文件）

| 文件 | 处数 |
|---|---|
| `apps/desktop/src/pages/zhjwxk/Courses.tsx` | 147 |
| `apps/desktop/src/components/FilePreview.tsx` | 74 |
| `apps/desktop/src/pages/Schedule.tsx` | 67 |
| `apps/desktop/src/pages/Settings.tsx` | 54 |
| `apps/desktop/src/pages/info/LibraryTab.tsx` | 33 |
| `apps/desktop/src/components/GlobalOrb.tsx` | 29 |
| `apps/desktop/src/pages/CloudPage.tsx` | 29 |
| `apps/desktop/src/pages/info/NetworkTab.tsx` | 24 |
| `apps/desktop/src/components/ThemePickerModal.tsx` | 20 |
| `apps/desktop/src/components/boardCards.tsx` | 20 |
| `apps/desktop/src/pages/info/KongjianTab.tsx` | 19 |
| `apps/desktop/src/pages/info/LibRoomTab.tsx` | 19 |
| `apps/desktop/src/pages/info/NewsTab.tsx` | 19 |
| `apps/desktop/src/pages/ScheduleAgenda.tsx` | 17 |
| `apps/desktop/src/pages/info/VenueSportsTab.tsx` | 17 |
| `apps/desktop/src/pages/Plugins.tsx` | 16 |
| `apps/desktop/src/pages/info/CardTab.tsx` | 16 |
| `apps/desktop/src/components/ConnectGate.tsx` | 15 |
| `apps/desktop/src/pages/learn/AssignmentDetailPage.tsx` | 15 |
| `apps/desktop/src/pages/info/SportsTab.tsx` | 14 |
| `apps/desktop/src/pages/ThubookPage.tsx` | 13 |
| `apps/desktop/src/pages/learn/Forum.tsx` | 13 |
| `apps/desktop/src/components/ExtHwLoginModal.tsx` | 12 |
| `apps/desktop/src/pages/info/CourseInfoTab.tsx` | 12 |
| `apps/desktop/src/lib/confirm.tsx` | 11 |

## C2. 内联几何 Top 15（共 296 处）

| 文件 | 处数 |
|---|---|
| `apps/desktop/src/pages/Settings.tsx` | 34 |
| `apps/desktop/src/pages/zhjwxk/Courses.tsx` | 26 |
| `apps/desktop/src/pages/learn/Forum.tsx` | 16 |
| `apps/desktop/src/components/FilePreview.tsx` | 13 |
| `apps/desktop/src/pages/Schedule.tsx` | 12 |
| `apps/desktop/src/pages/info/NewsTab.tsx` | 10 |
| `apps/desktop/src/components/HomeWidgets.tsx` | 9 |
| `apps/desktop/src/pages/Plugins.tsx` | 9 |
| `apps/desktop/src/components/ThemePickerModal.tsx` | 8 |
| `apps/desktop/src/pages/info/KongjianTab.tsx` | 7 |
| `apps/desktop/src/pages/info/SportsTab.tsx` | 7 |
| `apps/desktop/src/pages/learn/CourseDetailPage.tsx` | 7 |
| `apps/desktop/src/components/SoftwareUpdateSection.tsx` | 6 |
| `apps/desktop/src/pages/info/LibRoomTab.tsx` | 6 |
| `apps/desktop/src/pages/info/VenueSportsTab.tsx` | 6 |

## D. 字面色值 Top 25（共 663 处 / 63 个文件）

| 文件 | 处数 |
|---|---|
| `apps/desktop/src/state/theme.ts` | 111 |
| `apps/desktop/src/pages/zhjwxk/Courses.tsx` | 64 |
| `apps/desktop/src/components/FilePreview.tsx` | 60 |
| `apps/desktop/src/pages/Schedule.tsx` | 48 |
| `apps/desktop/src/components/GlobalOrb.tsx` | 25 |
| `apps/desktop/src/components/DevPanel.tsx` | 23 |
| `apps/desktop/src/components/AttachActionsSheet.tsx` | 22 |
| `apps/desktop/src/pages/ThubookPage.tsx` | 20 |
| `apps/desktop/src/lib/courseColor.ts` | 18 |
| `apps/desktop/src/components/ExtHwLoginModal.tsx` | 14 |
| `apps/desktop/src/lib/yktBody.ts` | 14 |
| `apps/desktop/src/pages/ScheduleAgenda.tsx` | 13 |
| `apps/desktop/src/state/wallpaper.ts` | 13 |
| `apps/desktop/src/components/ThemePickerModal.tsx` | 12 |
| `apps/desktop/src/components/OnboardingTourParticles.tsx` | 10 |
| `apps/desktop/src/lib/confirm.tsx` | 10 |
| `apps/desktop/src/components/ImageFilterSheet.tsx` | 9 |
| `apps/desktop/src/components/TabManageModal.tsx` | 9 |
| `apps/desktop/src/lib/textContrast.ts` | 9 |
| `apps/desktop/src/pages/MailPage.tsx` | 9 |
| `apps/desktop/src/pages/info/CardTab.tsx` | 9 |
| `apps/desktop/src/pages/info/NetworkTab.tsx` | 9 |
| `apps/desktop/src/lib/xklogic.ts` | 8 |
| `apps/desktop/src/state/explorer.ts` | 7 |
| `apps/desktop/src/components/exthw/ProblemBody.tsx` | 6 |

## E. 裸控件 Top 25（共 396 处 / 92 个文件）

| 文件 | 处数 |
|---|---|
| `apps/desktop/src/components/FreeBoard.tsx` | 27 |
| `apps/desktop/src/pages/Plugins.tsx` | 17 |
| `apps/desktop/src/pages/zhjwxk/Courses.tsx` | 17 |
| `apps/desktop/src/plugins/ChatDock.tsx` | 17 |
| `apps/desktop/src/pages/Today.tsx` | 16 |
| `apps/desktop/src/pages/FolderPage.tsx` | 15 |
| `apps/desktop/src/pages/TasksPage.tsx` | 15 |
| `apps/desktop/src/components/GlobalOrb.tsx` | 11 |
| `apps/desktop/src/components/explorer/HomeSpheres.tsx` | 10 |
| `apps/desktop/src/components/explorer/TabDrawer.tsx` | 10 |
| `apps/desktop/src/pages/GitLabPage.tsx` | 10 |
| `apps/desktop/src/pages/Schedule.tsx` | 10 |
| `apps/desktop/src/pages/Settings.tsx` | 8 |
| `apps/desktop/src/components/DevPanel.tsx` | 7 |
| `apps/desktop/src/components/boardCards.tsx` | 7 |
| `apps/desktop/src/components/explorer/TabStrip.tsx` | 7 |
| `apps/desktop/src/pages/info/NewsTab.tsx` | 7 |
| `apps/desktop/src/pages/learn/Forum.tsx` | 7 |
| `apps/desktop/src/components/AttachActionsSheet.tsx` | 6 |
| `apps/desktop/src/components/Collect.tsx` | 6 |
| `apps/desktop/src/components/Layout.tsx` | 6 |
| `apps/desktop/src/components/explorer/OneGoSheet.tsx` | 6 |
| `apps/desktop/src/pages/BoardPage.tsx` | 6 |
| `apps/desktop/src/pages/Learn.tsx` | 6 |
| `apps/desktop/src/pages/Login.tsx` | 6 |

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

---

## 附：批量改写的边界与实测记录（2026-10-14，别重复试）

**已经批完的族（工具：`tools/onegui-select-rewrite.mjs`，AST 级，干跑默认、`--apply` 落盘）**

| 族 | 数量 | 备注 |
|---|---:|---|
| `<button className="btn*">` → `Btn` | 430 | 早期 189 个用正则（简单标签），余下用 AST |
| `<input>/<textarea>` → `Input/TextArea` | 73 | 纯宽度样式丢弃；参与排版的转"几何外壳 div" |
| `<select>` → `Select` | 36 | 库侧配套：`Select` 接受 number 值 |
| `icon-btn` 单图标钮 → `IconBtn` | 5 | 需 `aria-label`/`title` 字面量 |
| 小按钮族（.ex-bbar-btn/.dock-btn/.hs-dock-btn…） | 1 | 实测可机械转换空间已见底 |

**明确不可批处理的族（三次失败，已回退，勿再试）**

1. **动态 `className` 拼接**（`className={cond ? "btn" : "btn-ghost"}`）：类名承载运行时分支语义，
   机械替换会丢分支 → 必须人工翻译成 `variant`/`selected`/`tone`。
2. **`.setting-row` 三元组**（标题 div + 说明 div + 控件）：嵌套结构语义，全仓一次跑会在大文件
   （`FolderPage.tsx` 两次成为警报器）误判并切碎 JSX。若将来要批，必须**按文件逐个跑 + 每文件立刻 typecheck**。
3. **正则处理 JSX 属性区**：属性里含 `>`（`=>`）与嵌套 `{{…}}`，正则必坏；要批只能用 AST。

**CSS 侧机械清理三重见底**（也都别重复试）：
① 单类裸规则 → ② 带伪类的孤儿 → ③ 主体孤儿＋祖先孤儿（并排除第三方前缀 `ql-`/`katex`/`leaflet`/`pdf`/`monaco`/`hls`…）。
第三次跑严格口径得 **0 条**：剩余 12.4k 行旧 CSS 全部"至少被真实引用或属于第三方"，**只能随页面迁移逐族删除**。

**逐行人工迁移的已验证节奏**：读一屏（20–40 行）→ 改 2–4 行 → `typecheck` → `vite build` →
`node tools/onegui-guard.mjs --write-baseline` 收紧 → 提交。`Settings.tsx` 前两行即按此完成（旧类名 142 → 138）。
