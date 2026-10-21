# exp 视觉验收（2026-10-17）

> 历史记录 / Historical record：本文保留当时的计划、研究或验收证据，不代表 0.11 当前能力全集。现行说明见 [文档入口](../../README.md)；英文入口见 [English overview](../../en/index.md)。


实现范围与角色说明见 `../20-exp-system.md`。

## 结果

- `pnpm guard:onegui`：通过（九条样式护栏 + scope/主题往返/动作隔离 + 28 组语义色对比度）。
- `pnpm --filter @onethu/desktop typecheck`：通过。
- `pnpm --filter @onethu/desktop build`：通过；没有 CSS syntax warning，保留现有大包/混合动态导入提示。
- token-guard / css-parse-test（57 个 CSS 文件）/ contrast-guard：通过。
- `git diff --check`：通过。
- 总 `pnpm guard` 在 ui-copy-lint 停止：8 处。以 dev3 的源码、lint 工具与 allow 清单重跑为 9 处；本轮修掉了触及文件中的一处。后续总链步骤未因本次串行执行而获得验证。

## 浏览器矩阵

`visual-report.json` 覆盖 11 场景，运行异常 0、页面横向溢出 0。截图使用真实组件与开发预览入口，无校园数据登录态。

| 文件 | 场景 |
|---|---|
| home-light / home-dark | 1440×1000 首页 |
| settings-light | 1440×1000 设置外观 |
| search-dark | 1440×1000 搜索/OH |
| drawer-light / menu-dark | 标签抽屉 / 右键菜单 |
| phone-home | 393×852 手机首页 |
| phone-settings-dark | 393×852 深色玻璃档设置 |
| phone-landscape | 852×393 手机横屏 |
| gallery-light / gallery-dark | 组件矩阵与组件化壳示例；不代表实际导航架构改为该示例 |
| phone-onboarding | 新用户导览底部表，验证 scope 不再生成透明底 |
| wallpaper-glass-light | 墨色壁纸 + deep 材质，验证时钟阅读面 |

`interaction-report.json` 记录真实浏览器动作：主题往返、动作色稳定、明暗/材质切换、Modal/Drawer/Menu 打开与 Escape 关闭、设备 iframe 393×852↔852×393、导览 scope 的不透明底与继承文字。

真实像素对比度审计四场景：首页亮色、搜索暗色、设置亮色、墨色壁纸+deep：首页时钟修复后均严重 0、低于 AA 0。`wallpaper-contrast.json` 为后一场完整报告。其余可复跑：

```sh
node tools/contrast-audit.mjs 'http://127.0.0.1:5180/?explorer-preview=home' exp-home-light --light
node tools/contrast-audit.mjs 'http://127.0.0.1:5180/?explorer-preview=search' exp-search-dark --dark
node tools/contrast-audit.mjs 'http://127.0.0.1:5180/?explorer-preview=settings-tab' exp-settings-light --light
node tools/phone-audit.mjs 'http://127.0.0.1:5180/?explorer-preview=home' exp-phone-home --wait=5000
```

手机首页与深色设置页布局体检：横向溢出 0、文字截断 0、文字互压 0；仍提示一个既有小目标（天气“刚刚”按钮）及滚动区外的离屏件，不当作真机验收。

未重新验证真实校园 API、原生语音/麦克风、Android/iOS 性能、第三方主题附加 CSS 和所有登录后页面。应用旧样式迁移余量见系统说明，不能将棘轮通过理解为存量已归零。
