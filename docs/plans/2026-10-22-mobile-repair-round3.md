# Mobile repair round 3 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复移动端操作阻塞，完善白板编辑与悬浮入口，为完整和实用模式提供可选导航布局，完成验收后发布 0.11.1。

**Architecture:** 沿用现有 React 状态源与 OneGUI。设备导航偏好独立保存，极简模式保持固定布局；白板历史按板和朝向隔离，自动内容拟合保持透明；异步按钮具备明确的失败、取消与重试出口。

**Tech Stack:** React / TypeScript / OneGUI / Tauri / Playwright。

---

### Task 1: 操作阻塞

- 检查 `components/NameCardSection.tsx`、`components/OrganizationSection.tsx`、`pages/Organization.tsx`、`state/explorer.ts` 的导航与浮层生命周期。
- 在真实手机视口复现“管理组织”、组织编辑表单，检查命中元素与弹窗层级；确认导航时关闭原设置浮层。
- 修复 `components/SoftwareUpdateSection.tsx` 与 `lib/updater.ts`：有界超时、主备源回退、状态 finally 释放、可取消与重试。
- 验收成功、拒绝、悬挂请求；更新检查只读取清单。

### Task 2: 手机白板编辑

- 修改 `components/FreeBoard.tsx`、`state/freeBoard.ts`、`packages/gui/src/recipes/workbench.css`。
- 去掉编辑入口双层边框；进入编辑保留竖屏阅读布局；自由画布由单独操作开启；键盘缩小视口保持实际朝向。
- 增加撤销上一步、确认后恢复默认。历史按板/朝向隔离，自动拟合高度及其他窗口写入经过兼容检查；恢复也可撤销。
- 验收首页与 OnePage、拖动、尺寸、删除、添加、文字、模板、恢复、返回、键盘和横竖屏。

### Task 3: 悬浮入口

- `onethu-overlay` Android 原生悬浮窗：手机收起按钮使用清晰图标、文字和高对比样式。
- `state/vaultAnchor.ts`、`components/vault/useVaultAnchor.ts`、`VaultDropTarget.tsx`：手机拖到边缘吸附，可收起半边并可直接唤回；展开/传输时目标完整可达。
- 保留自由拖动、点击打开及长按传输，测试边缘点击和拖动、屏幕旋转、安全区和底栏避让。

### Task 4: 可选导航与导览

- 新建设备导航偏好与复用布局选择组件，设置在“外观与布局”。
- 手机完整/实用模式支持底部快捷入口和侧边快捷导航，保留 OH 与搜索；极简不展示选择。
- 修改 `components/explorer/OneShot.tsx` 复用现有入口及顺序；页面为侧栏留出空间。
- `components/OnboardingTour.tsx` 在模式选择后给完整/实用手机用户展示两种直观布局预览，桌面和极简继续原流程。
- 新文字加入 zh-CN/en-US 与 static-label seed；执行 i18n 检查。

### Task 5: 验收和发布

- 手机浏览器实际点击、触摸滑动、边缘拖动，包含 360/390/430 宽度和键盘缩小视口；桌面做防回归。
- 运行对应行为测试、TypeScript、i18n 与二级课表回归，保存匿名截图和报告。
- 当前 `2e04de74` 三端构建暂作阶段性产物，Release 保持草稿；本批修复完成后统一新源码重建三端，再发布 0.11.1、云盘和官网。

## 已确认的前置修复

学校英文页面采用 `week 4`，旧二级解析器只认中文周次。`2e04de74` 已修复；实际页面恢复全部 8 条、本周 2 条，运行中 dev 日志已确认。中/英学校响应 × 三模式 × 两尺寸 85 项通过，真实页面仅本机私存，入库夹具替换课程名和地点。

## 执行记录

- [x] 操作阻塞：组织导航浮层关闭、更新检查生命周期与 OneGUI loading。
- [x] 白板：保留编辑前缩放、入口去双层框、撤销与确认恢复默认。
- [x] 悬浮入口：原生 OH 收起按钮、暂存箱边缘半收起与传输展开。
- [x] 布局导览：完整／实用分别记忆，手机导览与设置共用选择，极简固定、桌面流程保留。
- [ ] 最终回归、三端统一重建、发布和镜像核验。
