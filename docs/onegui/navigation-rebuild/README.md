# 导航、传输、通讯录、日程 · 收尾记录（2026-10-18）

接手 codex 的半成品（先整笔留档 `5ef7618b`），按用户 8 条验收清单收尾。本目录是本轮的证据与截图。

## 这一轮改了什么

### 1. 暂存箱雷达重做（用户：这个雷达丑完了）
旧版是空的大白碗（[before-radar-ugly.png](before-radar-ugly.png)）：无刻度、无光束，条目在圈里旋转导致文字歪斜，空箱只剩两个按钮飘着。现在是**半圆刻度环**：环带 + 刻度 + 两道扫描光束；箱内条目沿弧环绕缓慢摆动、文字始终正向；中心显示件数与箱子名；空箱给一句「长按任意内容，拖进来」。点击=浏览，长按拖动=投递 HUD（雷达自动展开、箱子放大、OH 胶囊呼吸 + 跟随胶囊的「发给小OH」提示）。

### 2. 完全展开改成下弹抽屉（用户：不要跳新页面）
新增 `VaultSheet`：清单 / 逐项移除 / 打开 / 「在标签页打开」。雷达页脚的「打开展示柜」与条目都指向抽屉；深链与搜索仍可到整页。

### 3. 手机顶栏（用户：把 OneTHU 拿掉、箱子居中）
删掉 `::after` 的品牌字（"OneTHU" 是伪元素，DOM 里根本没有），暂存箱绝对居中，首页在左、我的在右。

### 4. 拖动/投递修好
此前长按后拖动会被浏览器原生 HTML5 拖拽打断（pointercancel），松手放不进箱子；现在拾取后立即拦截 `dragstart`。实测：长按 0.4s → 雷达展开 → 拖到箱子入库 / 拖到 OH 胶囊发给小OH；取消不写入；触屏同样通过（合成 touch pointer 实测）。

### 5. OneGO 收藏栏 + OneShot
收藏栏在 OH 下一栏：黑色 OneGO! 入口、OnePage/工作区书签、放不下时的**填充小三角**溢出菜单、右键编辑、拖拽排序、长按传输。OneShot 四枚独立胶囊（网络学堂/日程/待办/生活）补注册了「待办」「生活」两个一级入口（不再「入口已删除」），配置挪到「外观」，手机 FAB/白板工具让位，内容页为底部胶囊让出滚动留白。

### 6. 通讯录成为一级功能 + 拟物名片
`page=contacts` 完整页（页头/搜索/收藏星标/全部·好友·组织/星标筛选/名片夹/我的组织）；拟物纸卡：真实 1.586 比例、纸纹、金属芯片、压印名字、THU 钢印、首字防伪水印、多层纸叠阴影；桌面多列微倾斜、手机一列叠压，点击用库 Modal 弹大卡。原有放进暂存箱、共享云盘、留言/传文件、组织邀请口令全部保留。**「我的」四栏**（我的名片/个人设置/插件/Harness）未改结构，profile 栏直接用同一套大卡。

### 7. 清华云盘邮箱不再手填
`resolveCloudEmail()`：名片已存 → 云盘账号（seafile_account.email）→ 校园 info 邮箱 → 已配置 CalDAV。拿到就显示真实值并自动写入名片一次；全页面无「登录后获取」字样（浏览器测试有断言）。

### 8. 日程改成铺满的周时间表（用户纠正：以周为单位、不要大标题、铺满）
7 列周视图是唯一时间轴语义（桌面/手机/横屏一致）；时间去掉了大标题与顶部按钮条，唯一常驻控件是右下悬浮圆钮，点开浮层里放周切换/视图/显示时段/同步导出/新建/收藏；时间表铺满内容区、表头吸顶、自己滚动。作业「前往」开新作业标签，课程给「前往/寻迹」都 forceNew。顺带修了 OneGUI `useFloating` 的入场相位 bug（浮层首次展开不落位，影响 Schedule 与 GitLab）。

### 9. 扫码/碰一碰反馈
`ExchangeFeedback` 用真实 pending/success/error 驱动：雷达扩散 + 名片悬浮 + 大对勾（改用库内 `IconCheck`），减少动态效果有降级。

## 验证

- `pnpm --filter @onethu/desktop typecheck` ✓、`pnpm --filter @onethu/desktop build` ✓、`node tools/onegui-guard.mjs` ✓（R2 258≤265 / R3 315≤317 / R4 235≤243，棘轮只降不升）。
- 浏览器验收（真实鼠标/触屏事件）：
  - `tools/navigation-rebuild-browser-test.mjs` — **22** 项（长按拾取、雷达展开、真实落库、溢出菜单、我的四栏、通讯录路由、390/320 顶栏与快捷胶囊不遮挡、无运行时错误）。
  - `tools/contacts-browser-test.mjs` — **52** 项（比例/弹层/搜索/筛选/星标/邮箱自动识别/深浅主题/动效降级/三档宽度无溢出）。
  - `tools/schedule-timeline-browser-test.mjs` — **18** 项（周列、无大标题、铺满、课块、详情前往/寻迹开新标签、三档视口无横向溢出）。
- 全量 `pnpm guard`：本轮清零了文案护栏（14→0）并修掉 1 处回归（board-drag 长按正则），`icon-test` / `pc-layout-test` 按新口径对齐后通过，`visit-client-test` 由红转绿；其余失败项在接手基线（`70995a68`）上本来就红（详见下表），非本轮引入。

| 护栏项 | 基线 70995a68 | 现在 |
|---|---|---|
| ui-copy-lint | 14 处违规 | **0** |
| board-drag-test | 通过 | 通过（曾因白板长按改动回归，已修） |
| icon-test | 通过 | 通过（ExchangeFeedback 手写 SVG 已换成 IconCheck） |
| pc-layout-test | 通过 | 通过（课表护栏改钉周视图口径） |
| nav-shell-test | 3 处 | 3 处（既有） |
| dynamic-flow / theme-system / explorer-canvas / tabstrip-layout / modal-shell / theme-picker / settings-ia / help-coach / onboarding-v3 / widget-coverage / button-variants / card-layers / input-system / empty-state / theme-ia / density / controls / list-row | 红 | 红（既有，未触碰） |

## 截图

[旧雷达（丑）](before-radar-ugly.png) · [雷达·浏览](radar-browse.png) · [雷达·投递](radar-transfer.png) · [暂存箱抽屉（桌面）](vault-sheet-desktop.png) · [暂存箱抽屉（手机）](vault-sheet-phone.png) · [手机顶栏](phone-topbar.png) · [OneGO 收藏栏](onego-bar.png) · [暂存箱页](vault-page.png) · [通讯录（桌面）](contacts-desktop.png) · [通讯录（手机）](contacts-phone.png) · [名片大卡](contacts-detail.png) · [我的名片·桌面](my-card-desktop.png) · [我的名片·手机](my-card-phone.png) · [我的组织](contacts-orgs.png) · [日程（桌面）](schedule-desktop.png) · [日程（手机）](schedule-phone.png) · [日程（横屏）](schedule-landscape.png)
