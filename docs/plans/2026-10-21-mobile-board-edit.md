# 手机白板显式编辑与 Android 0.11 补包

用户授权：手机端首页和所有白板默认锁定，点编辑才能改变组件；画笔、缩放、添加等原有工具仅编辑时出现，沿用原工具栏位置。完成后本地正式签名构建安卓包，替换同一 GitHub Release 与云盘 Android 目录，更新校验与双源清单。

- 共用 FreeBoard 增加临时、按板/朝向隔离的编辑能力；不持久化。切板、离开标签页、重新加载后锁定；手机返回键先退出编辑。
- 锁定时不选中、不移动/缩放、不做几何自动拟合、不允许键盘/菜单/双击/画布缩放绕过；正常组件链接和页面滑动保留。退出时清理进行中的指针监听、选中、画笔与编辑浮层。
- 开关放在原工具栏顶部；编辑时原工具顺序、右侧底部锚点不变。编辑器层级使用 OneGUI 新令牌，避免回顶部/刷新浮钮挡住工具。
- 中文/英文按钮、提示和既有导览文案同步；保留全部已有布局数据。
- Android 对外版本仍 0.11.0，内部 versionCode 11001（原正式包 11000），沿用正式证书。

## 验证

- `tools/board-mobile-edit-browser-test.mjs`：真实组件、隔离虚构数据；390 竖屏/844 横屏 Home 与 OnePage，包含真实 CDP 触摸滚页、锁定后无布局修改、编辑后真实拖动与角点缩放、完成锁定、跨板隔离、英文与返回、桌面直接编辑。报告在 `/Volumes/OneTHUBuild/artifacts/release-0.11/mobile-board-edit/`。未连接物理 Android 设备。
- TypeScript、i18n、CSS、令牌、对比度护栏通过。旧 `board-drag-test.mjs` 的“必须 repairOverlaps”断言与当前允许组件重叠的设计冲突，所检查的 `state/freeBoard.ts` 本次未修改；不为过时断言恢复无重叠布局。`board-edit-test.mjs` 纯模型检查通过。

## 发布检查表

- [x] 本地正式签名构建与 APK 版本/证书/内嵌资源核验。
- [x] 更新 Release APK、SHA256SUMS.txt、latest.json；桌面安装包保持原样。
- [x] 更新 `/Android/` APK、根目录校验与 latest.json。
- [x] 匿名三目录最新包/完整哈希/双源清单门禁、应用真实更新器三平台探测。
- [x] 官网刷新下载快照并部署复核。

## 补包结果

- Android 源码：`f1e06f9496bd3ddcecbb1eef6ccb884741f013d9`。
- 0.11.0 / versionCode **11001**，包名 `app.onethu.desktop`，ARM64，正式证书 SHA256 `cc14d735667bb8b5d3134e7dfdccf6a4d9353e1a2fce54503f4a29705423aa97` 与原正式版相同。
- APK SHA256 **`0ae0f44d8396b3109c909330620c477cb9159818486744a2bc151dfef0ac6409`**，31,912,765 字节。签名 v1/v2/v3、zipalign、ZIP 完整性通过；内嵌新前端 `index-BT4eo_R6.js`（旧 APK 无此资源），无 DevPanel。
- [Release v0.11.0](https://github.com/smartThise/OneTHU/releases/tag/v0.11.0) 原 Android 文件名替换；清华云盘仍位于 `/Android/OneTHU_0.11.0_arm64.apk`。两边同时更新 SHA256SUMS.txt 与 latest.json。
- 匿名完整下载三目录安装包并比对 GitHub SHA256 全部通过；双源清单和真实 updater 三平台读取、GitHub 失败转云盘全部通过。macOS/Windows 安装包 asset ID 与摘要均未改变。
- 本轮浏览器 29 项通过（含实际触摸滚动）；未连接物理 Android 设备，未作实机安装声明。
- 本地新版：`/Volumes/OneTHUBuild/artifacts/release-0.11/mobile-board-edit/installers/OneTHU_0.11.0_arm64.apk`；桌面 `OneTHU-builds/OneTHU_0.11.0_arm64.apk` 同步一份。
- 官网下载快照已刷新，部署结果需以 Pages run 为准。
