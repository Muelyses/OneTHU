# task-11 交付报告（第二轮返工 · 真机四条新反馈）

> 前两轮（task-3 骨架 / task-11 第一轮）的架构判定、保活策略、事件通道、`overlay_push_ui` 仍然有效；
> 视觉与交互口径以**本文件**为准。上一轮修的三个硬不变量（单窗 / 默认只有球 / 球在右侧导航栏上方）保留在代码里。

## 状态：完成（代码齐、tsc 0 error；gradle 编译 + 装机 + 截图验收待 Lead）

## 改动文件（全部在写域内）

| 文件 | 本轮变更 |
|---|---|
| `android/.../overlay/OverlayViews.kt` | **雾改纵向 sheet**（`LinearGradient` 自底向上变淡，`0→1 / 1→0.55→0`，铺满整块面板）；**球改实底**（白/深底 + 1px 细边 + elevation 轻投影 + 「（OH）」）；球窗加 8dp 投影留白；面板加**附件三入口**与**面板内语音行**；EditText 关掉长按/选择 |
| `android/.../overlay/OverlayWindows.kt` | 输入行手势改为「单击键盘 / 长按说话 / 上划取消」；附件入口 → `attachRequest` 事件；面板高度 46%→**50%**；面板内语音不切窗；`defaultBallPos` 按球算并补偿窗口留白 |
| `android/.../overlay/OverlayPicker.kt` | **新增**：三个系统选择器的计划/兜底 + 结果物化（content:// → cacheDir 真实文件）+ mime 猜测 |
| `android/src/main/res/xml/onethu_overlay_paths.xml` | **新增**：FileProvider 路径（只暴露 cacheDir） |
| `android/src/main/AndroidManifest.xml` | 加 `FileProvider`（authority `${applicationId}.onethu.overlay.fileprovider`） |
| `android/build.gradle.kts` | 加 `androidx.activity:activity-ktx:1.9.3`（`@ActivityCallback` 的 `ActivityResult` 参数类型） |
| `android/.../overlay/OnethuOverlayPlugin.kt` | 新增命令 `overlayPickAttach` + `@ActivityCallback onPickAttach`（结果以事件 `attach` 推回 JS） |
| `android/.../overlay/OverlayEvents.kt` | 事件支持 `extra` 字段摊平（`attach` 要带 path/name/mime/size） |
| `src/commands.rs` / `src/lib.rs` / `build.rs` / `permissions/**` | 新增 `overlay_pick_attach` 全链（命令 + 权限 toml + default + reference） |
| `apps/desktop/src/lib/overlayAndroid.ts` | 消费 `attachRequest`（拉起选择器）与 `attach`（`attachFromPath` + `sendToOh`）；状态接口补 `workW/workH/ballX/ballY/windowKind` 等取证字段 |

## 四条逐条落地

### ① 雾改成「从底下到半屏铺满并渐变变淡」
- `FogLayout` 从 `RadialGradient` 换成 **`LinearGradient`（自底向上）**，参数 `stopPositions=[0,0.58,0.82,1] / stopWeights=[1,1,0.55,0]`：
  **底边 100% 铺满 → 58% 处仍 100% → 82% 处 55% → 顶边完全透明**。等价 Lead 的 CSS：
  `linear-gradient(to top, #000 0%, #000 58%, rgba(0,0,0,.55) 82%, transparent 100%)`。
- 面板高度 **46% → 50%**（真正的半屏）；渐变半径按**整块面板**算，所以雾铺满整块、不是中间一坨。
- 深浅色都成立：雾心 `#FFFFFF`/`#151517`，文字 `#1C1F24`/`#ECECF1`，`coreAlpha` 浅 0.92 / 深 0.90。
- 「模糊也随高度化掉」：安卓侧**没有**跨窗口模糊（第三方拿不到，且上次怀疑它是「全屏雾」元凶，已删）；
  这里用**渐变 alpha 本身**承担「越往上越化掉」的观感 —— 视觉等效，且不会整屏泛白。
- 球不再用任何雾（见 ③）。

### ② 附件三入口（拍照 / 相册 / 上传）→ 走现成发送链
- 面板里加一行**裸文字**入口 `拍照 / 相册 / 上传`（12sp、72% alpha，与本套视觉一致）。
- 链路（**不新增第二条发送链**）：
  1. 原生点击 → 事件 `attachRequest{text:"camera|gallery|file"}` 推给宿主 JS；
  2. `lib/overlayAndroid.ts` 收到 → 调插件命令 **`overlay_pick_attach {kind}`** 拉起系统选择器
     （Tauri 的 activity result 只能经「插件命令 + `@ActivityCallback`」回传，这是唯一通路）；
  3. 原生：`camera` → `ACTION_IMAGE_CAPTURE` + **FileProvider**（cacheDir 出图，`FLAG_GRANT_WRITE_URI_PERMISSION`）；
     `gallery` → Android 13+ `ACTION_PICK_IMAGES`（Photo Picker），旧版 `ACTION_PICK`；
     `file` → `ACTION_OPEN_DOCUMENT`；相册选择器不可用时自动退回落文档选择器；
  4. 结果**物化**成 cacheDir 里的真实文件（`attachFromPath` 只认路径，`content://` 它读不了），
     以事件 **`attach{path,name,mime,size}`** 推回 JS；
  5. 适配器 → `attachFromPath()` → **`sendToOh()`**（lib/attach.ts 现成能力）→ 多模态开关在 harness 侧生效。
- **权限**：三个入口全走系统选择器，**不需要**存储权限；**也没有申请相机权限**——`ACTION_IMAGE_CAPTURE`
  只在应用自己声明了 `CAMERA` 时才要求授权，本应用未声明（真机 `dumpsys package` 已确认无 CAMERA）。
  唯一新增声明是 **FileProvider**（在插件自己的 Manifest 里，authority 用 `${applicationId}` 前缀）。
- 选择结果为空/取消：只回 `{ok:false,cancelled:true}`，不打扰用户；失败在对话流里以一条 OH 文字说明。

### ③ 球：文案「（OH）」+ 实底材质
- 文案**固定 `（OH）`**（常量 `BALL_TEXT`，全角括号，四个字符）；字号 11sp（四个全角字符要塞进 54dp，
  再大会挤/裁切）、`includeFontPadding=false`、单行居中、700。
- 材质：**实底 + 1px 细边框 + 轻投影**（`GradientDrawable.OVAL` 白/深底 + `setStroke(1dp)` + `elevation=6dp`），
  **不模糊、不径向雾**（删掉了 `RenderEffect` 与径向球）。
- 球窗尺寸 = 球 54dp + 两侧各 8dp 留白（`BALL_WIN_DP=70dp`）：投影要画在视图外，窗口正好等于球会被裁掉；
  默认坐标按**球**算 right 12dp / bottom 128dp 再把 8dp 补回去，视觉位置不受影响。

### ④ 输入框长按 = 说话
- 长按判定挂在 **EditText 的 touch 拦截**上（`setOnTouchListener`），并关掉 `isLongClickable` +
  `setTextIsSelectable(false)`，EditText 再也吃不到长按（不再只是放光标）。
- 语义：**单击 → `showIme()` 聚焦键盘**；**长按 ≥450ms → 进语音**（面板内就地出语音行：雾带 + 点点波纹 + 实时转写，
  **不切窗**——切窗会摘掉手指正按着的面板导致 ACTION_UP 丢失）；**按住上划 >110dp → 条内显示「松开取消」，
  松手才判定**，取消则整句丢弃。
- 松手 → 等最终结果（700ms 兜底）→ **整句直接发出**（与键盘输入同一条 `submit` 通道）→ 切到面板看回复。
- 同款语义也在「发送」按钮上（点=发送/长按=说话）与球上（长按=语音，抬手后回面板）。
- 语音行显隐时**不把输入块设 GONE**（会立刻取消按住它的手势流），只降透明度。

## ②/③ 的「怎么保证」（上一轮的三个硬不变量，仍然有效）

| 不变量 | 保证方式 |
|---|---|
| **同一时刻只有一个 overlay 窗口** | 所有形态切换收敛到唯一入口 `switchTo(kind)`：`panel` = 先 `detachOrb()` 再 `attachPanel()`；`bar`/`ball` = 先 `detachPanel()` 再 `attachOrb()`；**不存在两个窗口并存的中间态**。切换后再跑 `enforceSingleWindow()` 自愈（若仍并发，强制摘面板并打日志）。`overlay_status` 带出 `windowKind`（`both(BUG)` 一眼可见）与 `orbAttached`/`panelAttached`。**「再点回球」改由面板上的「收起」承担**（单窗下球窗不能留在面板之上）。 |
| **默认/恢复态永远是球** | `overlay_show` → `OverlayService.start(ctx,"ball")`（且先 `OverlayPrefs.setMode("ball")`）；`ACTION_START` 分支**不看 EXTRA_MODE、不读上次形态**，只调 `windows.showBallOnly()`（该路径同样只 add 球窗）；开机广播 / 自救闹钟也强制 `"ball"`；面板窗**懒创建**（`ensurePanel()` 只在用户点球/点收起后的展开时调用）。 |
| **球位置右侧、导航栏上方** | `screenSize()` 优先 `currentWindowMetrics.bounds`（API 30+），数值不合理（<320dp）回落 `displayMetrics`，两者都不合理再兜保守值——**挡住真机出现过的 215×215 坏值**；默认 `right 12dp / bottom 128dp`；读档坐标若越界（`x∉[0,w-ball]`）**回落默认并顺手改写存档**。 |
| **IME 不许自己弹** | 面板容器 `isFocusableInTouchMode=true` 且在 `attachPanel()` 里 `input.clearFocus(); content.requestFocus()`；`panelParams` 加 `SOFT_INPUT_STATE_ALWAYS_HIDDEN`；只在用户**点输入行**（`ACTION_UP` 且未达长按阈值）时 `showIme()`。 |

## 自检

- `./node_modules/.bin/tsc --noEmit -p apps/desktop/tsconfig.json` → **exit 0、零输出**。
- Kotlin 逐行自查（本机禁构建）：`LinearGradient` 构造签名与 stop 单调性、`FileProvider.getUriForFile` /
  `@xml` meta-data、`ACTION_PICK_IMAGES`(API 33 守卫)/`ACTION_OPEN_DOCUMENT`/`ACTION_IMAGE_CAPTURE`、
  `OpenableColumns.DISPLAY_NAME` 游标、`startActivityForResult(invoke, intent, "onPickAttach")` 与
  `@ActivityCallback private fun onPickAttach(invoke: Invoke?, result: ActivityResult)`（照 OnethuMobilePlugin 的
  `onPickDownloadDir` 同款签名）、`GradientDrawable.setStroke`、`elevation`、`setTextIsSelectable`。
- 自查中发现并修掉的坑：**把输入块设 GONE 会取消按住它的手势流**（改为只降 alpha）；
  球窗等于球尺寸会裁掉投影（加 8dp 留白并把默认坐标补偿回来）；`defaultBallPos` 用球径 vs 球窗径的口径统一。
- exFAT：`find <写域> -name '._*' -delete` 已执行（当前 0 个）。未跑构建、未 git 写操作、未装机、未点屏。

## 四条里哪条只能真机验

| 条目 | 能否本机/静态判定 | 只能真机验的部分 |
|---|---|---|
| ① 雾 | 渐变参数、高度比例、像素级观感可在**截图**上判定（静态可核对） | **观感是否满意**、深浅色在真实桌面壁纸上的可读性、滑入动画是否顺滑 —— 只能真机看 |
| ② 附件 | 事件链路与代码路径可静态核对；`tsc` 已过 | **三个选择器能否真的拉起来**、拍照回调是否拿到文件、Photo Picker 在本机的行为、多模态是否真把图喂进模型 —— 只能真机 |
| ③ 球 | 文案/材质/尺寸/坐标公式可静态核对 | 投影与细边在真实屏幕上的观感、（OH）四个字在 54dp 里是否挤 —— 只能真机 |
| ④ 长按说话 | 手势状态机可静态核对 | **能否真的取到麦并发出整句**（荣耀仅前台麦克风）、长按判定与输入法是否互相打架、上划取消手感 —— 只能真机 |

## 需要 Lead 跑的验证

```bash
# 1) Kotlin 编译（只编本插件模块）
cd apps/desktop/src-tauri/gen/android && ./gradlew :tauri-plugin-onethu-overlay:compileDebugKotlin
# 2) 清单合并（应看到 FileProvider + specialUse|microphone 服务 + 各项权限）
cd apps/desktop/src-tauri/gen/android && ./gradlew :app:processArmDebugMainManifest
# 3) Rust 侧交叉检查（桌面 cargo check 不编 mobile 分支）
cd apps/desktop/src-tauri && CC_aarch64_linux_android=… AR_…=… CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER=… cargo check --target aarch64-linux-android
```

装机后只读核对（新 serial `adb -s 'adb-AVAY025528004219-CeQTxu (2)._adb-tls-connect._tcp'`）：

```bash
dumpsys package app.onethu.desktop.dev | grep -A3 "onethu.overlay.fileprovider"   # FileProvider 已合并
dumpsys window windows | grep -A3 "app.onethu.desktop.dev"                        # 只应有 1 个 APPLICATION_OVERLAY 窗
# 球的坐标与窗口种类（原生算出来的值，荣耀 logcat 被滤掉）：
#   在应用内调 overlay_status（设置页/调试入口）看 workW/workH/ballX/ballY/windowKind
```
**验收截图链**（Lead 说会逐张）：只有球 → 点球出半屏渐变雾面板 → 面板里拍照/上传 → 长按输入行说话 → 再点回球 → 进本体球消失。

编译风险点（我没编译过）：`LinearGradient` 的 `IntArray/FloatArray` 重载、
`FileProvider.getUriForFile`（依赖 `androidx.core`，已声明）、`ActivityResult` 的 import 路径、
`currentWindowMetrics`（API 30 守卫已加）。**有报错直接贴回我，我立刻改。**

## 风险与未做

- **「（OH）」在 54dp 里的字号**是 11sp：能用但不一定好看，真机看了觉得小/挤告诉我，我调字号或球径。
- 附件**只送不预览**：选完直接交给 OH，面板里只出现一条「📎 文件名」占位；图像滤镜/编辑（需求 8）在 wave 2 的
  `ImageFilterSheet` 里，本轮没接进原生面板（跨写域要不要接，请示下）。
- **拍照的 FileProvider 未在真机验证**：`${applicationId}.onethu.overlay.fileprovider` 与 `res/xml` 路径若被
  ROM 拒绝，选择器会打不开——装机后第一件事建议先试「拍照」。
- 语音仍受荣耀「仅前台麦克风」限制：能发/只能打字的五种情况与上一轮报告一致（`MODE_FOREGROUND` + FGS
  `microphone` 类型是放行的关键）。
- 跨应用实时模糊仍然不做（第三方拿不到；上次误判为「全屏雾」元凶的 `FLAG_BLUR_BEHIND` 已删，不再复活）。
- 未做：TTS 自动朗读 OH 回复（ball-tts 能力，接入点仍在 `askNative` 一行，需 Lead 决定是否跨界）。
