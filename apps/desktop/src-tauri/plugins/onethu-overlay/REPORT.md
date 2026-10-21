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
- 附件**只送不预览**：选完直接交给 OH，面板里只出现一条「[回形针emoji] 文件名」占位；图像滤镜/编辑（需求 8）在 wave 2 的
  `ImageFilterSheet` 里，本轮没接进原生面板（跨写域要不要接，请示下）。
- **拍照的 FileProvider 未在真机验证**：`${applicationId}.onethu.overlay.fileprovider` 与 `res/xml` 路径若被
  ROM 拒绝，选择器会打不开——装机后第一件事建议先试「拍照」。
- 语音仍受荣耀「仅前台麦克风」限制：能发/只能打字的五种情况与上一轮报告一致（`MODE_FOREGROUND` + FGS
  `microphone` 类型是放行的关键）。
- 跨应用实时模糊仍然不做（第三方拿不到；上次误判为「全屏雾」元凶的 `FLAG_BLUR_BEHIND` 已删，不再复活）。
- 未做：TTS 自动朗读 OH 回复（ball-tts 能力，接入点仍在 `askNative` 一行，需 Lead 决定是否跨界）。


---

# task-11 第三轮返工（真机验收：3 过 3 修 · 2026-10-11 01:0x）

Lead 已装机验收：**① 雾形状过了**（底部铺满→向上渐变变淡、半屏 1264×1400、BOTTOM 对齐）、
**③ 球文案/材质过了**（实底白圆 +「（OH）」）、附件三入口 + 输入行 + 发送都在面板里、**单窗不变量成立**。
另：Lead 替我修了编译阻塞（`OverlayViews.kt` 补 `import android.graphics.drawable.GradientDrawable`；删掉
插件自带 FileProvider 与 paths xml，`OverlayPicker.authority` 改指宿主 `${packageName}.fileprovider`）——
**这两处 Lead 的改动我原样保留，没有回退。**

## 修的三条

### 1) 球的位置（要求这次必须真机确认）
- **根因**：存档里的旧坐标（`x=0,y=548`，来自早先版本/别的坐标系）被当成有效值沿用了 → 每次启动都钉在左上。
- **修法（两处）**：
  1. **存档带屏幕尺寸 + 格式版本**：`OverlayPrefs.setBall(x,y,screenW,screenH)` 同时写 `ball_fmt=2`、
     `ball_screen_w/h`。`loadBallPos()` 三段判定：无存档 → 默认；**fmt 不符或屏幕尺寸变了 → 作废 + 回落默认 +
     `setBall()` 改写存档**；越界（`x∉[0,w-ballPx]`）→ 同样回落 + 改写。三条路径都打 log。
     ⇒ 从此**旧坐标再也不可能复活**；换机/改分辨率也自动归位。
  2. **默认坐标的代数改正**（我自己验算抓出来的错）：球窗比球大 2×inset（投影留白 8dp×2），球在窗口内居中，
     所以 `x = w - 球窗 - 12dp + inset`（**加** inset，不是减）。@1264×2800/560dpi 实机：
     球窗 245px、球径 189px、inset 28px → **ballX=1005、ballY=2135**，此时「球右边缘距屏右 = 12.0dp、
     球下边缘距屏底 = 128.0dp」，窗口右下角 (1250, 2380) 也在屏内。
- **真机自查口径**：调 `overlay_status` → `workW=1264 / workH=2800 / ballX=1005 / ballY=2135`；
  `dumpsys window windows` 里球窗应是 `(1005,2135)(245x245)`，且**只有 1 个** APPLICATION_OVERLAY 窗。
  第一次启动若旧存档还在，log 会有一条「球位置存档作废…→ 回落默认并改写」。
- 尺寸是物理 px 无疑：245px = 70dp × 3.5（density 560/160），位置也一律物理 px，**没有 dp/px 混算**。

### 2) 对比度（用户原话「看都看不清」）
| 元素 | 改前 | 改后 |
|---|---|---|
| 拍照 / 相册 / 上传 | 12sp / alpha 0.72 | **13sp / alpha 0.95**（主色） |
| 收起 / 本次关闭悬浮球 | 12sp / alpha 0.55 | **13sp / alpha 0.95** |
| 发送 | 13sp / alpha 0.85 | **14sp / alpha 1.0**（主色，不再是灰） |
| 输入行占位「点击输入，长按说话」 | alpha ≈0.38 | **alpha 0.92** |
| 输入行下划线 | alpha 0.15 | alpha 0.28（别让输入行看着"没容器"） |
| 面板雾底部核心 | 浅 0.92 / 深 0.90 | **浅 0.96 / 深 0.94**，且 82% 处权重 0.55→**0.60**（底部字有足够衬底） |
| 语音条雾 | 浅 0.92 / 深 0.88 | 浅 0.96 / 深 0.92 |
消息正文本来就是主色 + 100%/62%（未动）。

### 3) 输入行渲染两遍
- **根因**：面板里同时存在「空态提示 TextView（文案就是『点击输入，长按说话』）」与「EditText 的 hint（同文案）」
  —— 两处各画了一遍。列表一空就把空态显示出来，于是上下各一条。
- **修法**：**删掉空态 TextView**，只留底部 EditText 的 hint（Lead 要求「只留底部那一个」）；
  `PanelHolder.empty` 字段与两处 `p.empty.visibility=…` 一并删除。空对话时消息区自然为空，不影响布局。

## 已拍板执行
- 「（OH）」字号**保留 11sp**（Lead 拍）——不再改。
- 图像滤镜（wave 2 `ImageFilterSheet`）**不接进原生面板**（Lead 拍）——本轮没接。

## 自检
- `tsc --noEmit` → **exit 0**；Kotlin 大括号平衡校验通过；`find <写域> -name '._*' -delete` 已执行（0 个）。
- 位置代数用 1264×2800/560dpi 实参**独立验算**过（脚本输出：右 12.0dp / 下 128.0dp，窗口在屏内）。
- 未跑构建（Lead 跑）、未 git 写操作、未装机、未点屏。

## 需要 Lead 跑的验证（同上，三条）
```bash
cd apps/desktop/src-tauri/gen/android && ./gradlew :tauri-plugin-onethu-overlay:compileDebugKotlin
cd apps/desktop/src-tauri/gen/android && ./gradlew :app:processArm64DebugMainManifest
cd apps/desktop/src-tauri && cargo check --target aarch64-linux-android   # 若 Rust 侧还没过
```
装机后**请重点确认这两条**（本轮的核心）：
1. `overlay_status` → `ballX=1005 / ballY=2135`（球在右下、（OneTHU）图标下方那条区域）；
   `dumpsys window windows` 球窗 `(1005,2135)(245x245)`、只有 1 个 overlay 窗。
2. 面板里 拍照/相册/上传/发送/收起/本次关闭 是否一眼可读；「点击输入，长按说话」**只出现一次**（底部）。

## 仍然只能真机验
① 雾的**观感**与深浅色可读性；③（OH）在 54dp 里挤不挤；④ **能否真取到麦并发出整句**、长按与输入法是否打架、
上划取消手感；② 三个选择器能否真的拉起（拍照回调是否拿到文件）——这些本机无法判定。

---

# task-13 交付（真机第 6 轮：品牌字 / markdown / 固定顶栏+可读性 / 液态动效 / 附件即时气泡与进行中态）

状态：**完成**（tsc exit 0；Kotlin 逐行自查 + 括号平衡；`._*` 已清 0；未跑构建/未 git 写/未装机）。

## 0. 字体与对比度自查（Lead 点名要的那份）

### (OH) 逐字符混排 —— 用 Spannable 复刻本体 HarnessMark + global.css:4090-4093

来源已核对：`components/HarnessMark.tsx` 输出的是 **半角 `(` `O` `H` `)`**，本体悬浮岛用 `<HarnessMark size={15} />`。

| 文本范围 | span 列表 | 对应 CSS |
|---|---|---|
| `[0,1)` `(` | `TypefaceSpan("monospace")` + `RelativeSizeSpan(1.06f)` | `.p{font:mono;400;scaleY(1.06)}`（scaleY 用等比 1.06 近似） |
| `[1,2)` `O` | `TypefaceSpan(Typeface.create("serif", 500, false))` + `RelativeSizeSpan(1.14f)` | `.o{serif;500;1.14em}` |
| `[2,3)` `H` | `TypefaceSpan(Typeface.create("sans-serif", 700, false))` + `RelativeSizeSpan(1.06f)` | `.h{苹方同族;700;1.06em}` |
| `[3,4)` `)` | 同 `(` | 同上 |

TextView 侧：`textSize = 15sp`、`letterSpacing = 0.05f`（= CSS `gap:0.05em`）、`includeFontPadding=false`、`isSingleLine=true`、`gravity=CENTER`；
**球径 54dp 未动**（按更正口径）；`API<28` 时 `Typeface.create(family,weight,italic)` 不可用 → 退 `NORMAL/BOLD` 两档。
小字号下的宽度估算：mono`(` + serif`O`(17.1sp) + sans`H`(15.9sp) + mono`)` ≈ 45dp < 54dp √（半角字符比全角窄得多，这也是这次能放大的原因）。

### 两处 alpha

| 位置 | 值 |
|---|---|
| 面板雾：内容区（距底 0→80%） | 权重 1.0 × coreAlpha → **浅 0.96 / 深 0.94**（绝对 alpha） |
| 面板雾：距底 90% 处（内容区上沿） | 权重 0.55 × coreAlpha → **浅 0.53 / 深 0.52**（≥45% 保底） |
| 面板雾：仅最顶 10% 窄带 | 0.53 → 0（真正羽化到透明） |
| 顶栏「收起 / 本次关闭悬浮球」胶囊 | 浅 `#FFFFFF` **α0.86** / 深 `#000000` **α0.45**，+ 1px 细边（浅 `#1F000000` / 深 `#33FFFFFF`） |
| 所有正文/按钮文字 | 主色 100% alpha + `setShadowLayer(6dp, 0, 1dp, #40000000)`（α0.25） |

动效时长：开 = 滴落 150ms + 晕开 280ms = **430ms**；关 = 收拢 260ms + 弹回球 200ms = **460ms**（都在 380–460ms 内）。

## 1. 逐条落地

**① 品牌字 + OH 太小** → 见上表。`OverlayViews.harnessMark()` 返回 Spannable；球 `setText(harnessMark())`、15sp、球径 54dp。

**② 雾/markdown/按钮/动效**
- **markdown**：新增 `OverlayMd.kt`（356 行，零依赖）：块级 ` ```代码块``` `、`- 列表`、`1. 列表`、`> 引用`（左边线）、`---` 分隔线、`# 标题`、普通段落；行内 `**粗**`/`*斜*`/`` `code` ``/`[文本](url)`（可点，走系统浏览器，仅 http(s)）。代码块 mono 13.5sp + 极轻底色；引用左 3dp 竖线；未闭合标记一律当普通字符，绝不吞内容。
- **字更清晰**：正文主色 100%、15sp、行高 1.62、块级文本统一轻阴影；雾在内容区保底 ≥0.52 绝对 alpha（见上）。
- **顶栏**：`收起 / 本次关闭悬浮球` 在 ScrollView **之外**（任何滚动位置都在），并各加**半透明胶囊 + 1px 细边**衬底 —— 纯黑壁纸与纯白壁纸都一眼可读；顶栏下加一条发丝线。
- **动效**：开＝球在点击处**形变缩成液滴并下落**（150ms，`AccelerateInterpolator`）→ 切到面板窗，**圆角半径从「一团液滴」收敛到 22dp**（`ViewOutlineProvider` + `invalidateOutline` 逐帧）+ `scaleY 0.80→1` + `translationY 24%→0`（`OvershootInterpolator(0.9)`）+ **光晕层 α0.45→0**（径向渐变 View）。关＝反向：圆角回到「一团」+ 缩到 0.72 + 下移淡出（260ms，自定义缓动），随后球窗挂回并 **Overshoot(1.7) 弹一下**（200ms）。全程**单窗**（滴落结束时才切窗，无并存）。

**③ 附件即时气泡 + 进行中 + 不吞话**
- 选完文件**立刻**（在插件拿到结果的同一线程里）调 `OverlayService.echoAttachment()` → 面板消息区立刻出现**带缩略图的附件气泡**（本地文件异步降采样解码，最长边 480px，绝不阻塞面板）+「**正在发送…**」；
- 缩略图**点一下原地放大**（320×面板高 42%，FIT_CENTER），再点收小（不新开窗口，守住单窗不变量）；
- 发送/等待期间有**明确进行中指示**：`attachSending` → 「正在发送…」（波纹点动画），`busy` → 「OH 正在思考…」；
- **不吞消息**：消息列表由适配器持有（模块态），面板关掉也继续走异步发送，回复到达后 `pushUi` 把 `status` 置空并追加回复 —— 下次打开面板照样看到那条消息与回复；失败置 `status:"error"` → 原生显示「发送失败，可再试一次」。
- 图片消息在 markdown 区域直接显示（缩略图 + 点击放大）√。

**图片/状态的数据契约**（`overlayAndroid.ts` 的 `pushUi.messages[]`）：
```ts
{ role: "user"|"oh", text: string, images?: string[] /* 本地路径 */, status?: "sending"|"error"|"" }
```
原生只认**本地路径**（data URL 不渲染，避免大字符串过桥）。

## 2. 哪条只能真机验
| 条目 | 静态可核对 | 只能真机验 |
|---|---|---|
| ① 品牌字/字号 | span 列表与字号可核对（见上表） | 真机上 mono/serif/sans 三族混排的实际观感、15sp 在 54dp 里是否够大 |
| ② markdown | 解析分支与块样式可核对 | 真机上长回复的排版、代码块换行、链接点击是否真的起效 |
| ② 顶栏/对比度 | alpha 与胶囊参数可核对 | **纯黑/纯白壁纸下是否真的可读**（用户原话的验收点） |
| ② 动效 | 时长与曲线参数可核对 | **顺不顺、像不像液态**（Lead 会录屏） |
| ③ 附件 | 链路与状态机可核对 | 三个选择器能否拉起、缩略图是否出图、放大/收小手感、关掉面板后重开是否还在 |
| 共用会话 | 未另起会话（仍走 `askOh`/`sendToOh` 同一 harness 会话） | 「本体与面板同一条对话」还要等 Lead 另派的那条线把历史打通（我这边保持单写者契约不改） |

## 3. 需要 Lead 跑的验证
```bash
cd apps/desktop/src-tauri/gen/android && ./gradlew :tauri-plugin-onethu-overlay:compileDebugKotlin
cd apps/desktop/src-tauri/gen/android && ./gradlew :app:processArm64DebugMainManifest
```
装机后按 Lead 的截图链：字体/字号 → 顶栏 → markdown → 开合动效 → 附件即时气泡 → 进行中 → 回复到达。
`overlay_status` 仍带 `workW/workH/ballX/ballY/windowKind`：球径回到 54dp，但**球窗仍是 70dp**（54+16 投影留白），
所以默认坐标与上一轮一致 —— **期望 workW=1264 / workH=2800 / ballX=1005 / ballY=2135**（视觉上仍是球右边缘距屏右 12dp、下边缘距屏底 128dp）。

## 4. 风险与未做
- 混排是「系统最接近」而非真 Montserrat（仓库无字体文件）：mono/serif/sans 三族可用，字重 500/700 在 API<28 退化成 400/700。
- 代码块超长行会在面板宽度处换行（已给 `maxWidth=屏宽*0.84`），不做横向滚动。
- 放大图片是「原地变大」而非全屏查看器（守单窗不变量）；要全屏查看器就得允许临时第二个窗，需 Lead 拍板。
- 动效曲线是参数化的近似（`ViewOutlineProvider` + Overshoot/自定义缓动），不做真液体模拟；观感以录屏为准。

---

# task-15 交付（悬浮层 5 改 + 附件返回本体 bug）

状态：**完成**（tsc exit 0；Kotlin 括号平衡；`._*` 0；未跑构建/未 git 写；**全程没有用 adb 碰用户的屏幕**）。

| # | 用户反馈 | 做法 |
|---|---|---|
| 1 | 顶栏与内容之间那条线很丑 | **删掉 `headLine`**（发丝线整块移除）。顶栏改成两行四个动作，全部在 ScrollView 之外（任何滚动位置都在）、全部带**可读胶囊衬底**：第一行 `回到 OneTHU` `自动朗读：关/开`；第二行右对齐 `收起` `本次关闭悬浮球` |
| 2 | 加朗读 | 面板两个入口 + 每条消息一个：① 顶栏 `自动朗读：关/开` → 原生发事件 `toggleAutoSpeak{on/off}` → 适配器写 `voicePrefs`（单一权威）并回推状态；② 每条 **OH** 消息下方一个裸文字 `朗读` → 事件 `speak{text}` → `speakReply(text,{force:true})`（**手动点=当场意图，无视静音**）；③ 自动档在回复到达时调 `speakReply()`（内部判 `autoSpeak`，默认静音）；④ 收口走 `onTtsDone`（`onethu-tts://done`）→ 推 `speaking` 回原生；朗读前先 `ttsStop()` 打断上一条 |
| 3 | 加「回到 OneTHU」 | 顶栏 `回到 OneTHU` 胶囊 → 原生 `OverlayService.openApp()`（`packageManager.getLaunchIntentForPackage` + `NEW_TASK|SINGLE_TOP`）。**只在用户点击时跳**，红线（自动跳回）未破 |
| 4 | 语音后没滚到底 | `scrollToBottom()` 改为**连发两次 post**（新内容要等一次布局才有正确高度）；并在语音 `onFinal`、发送、`renderMessages`、`pushUi` 状态变化后都调用 |
| 5 | 边缘吸附成缩略侧边条 | 新增 `side` 形态（`SIDE 22×56dp` 胶囊 + 1px 边 + 轻投影 + 中心点）：**拖到边缘吸附后 1.2s 自动缩成侧边条**（`EDGE_SHRINK_MS`）；**球空闲 10s 也自动缩回**（`IDLE_COLLAPSE_MS`，拖拽/点击/语音/面板任一活动都重置，面板或语音条打开期间不计时）；**点/按侧边条 → 丝滑展开回球**（按下即展开，长按可继续进语音；单纯点击只展开、不开面板） |
| 6 | 液态滴落要「融化→落到屏底→铺开」 | 重写：球**形变收窄拉长成液滴**，同时**窗口真的向下移动到屏幕底部**（`FALL_MS=170`，`AccelerateInterpolator(1.5)`，每帧 `updateViewLayout`）→ 切面板并**从滴点晕开**（圆角半径 40%→22dp + 上浮放大 + 光晕淡出，`BLOOM_MS=280`）；关＝反向：面板收拢成一团（260ms）→ 球窗在**落点**出现并**升回原位**（`RISE_MS=200`，边升边回正形变）→ `Overshoot` 弹一下。开 450ms / 关 460ms |
| 7 | 加附件后莫名回到 OneTHU 一次 | **见下节** |

## 第 7 条：附件返回本体 bug（结论与取舍）

**根因确认**：调用链里只有两处会拉起本应用 Task —— `startActivityForResult`（Activity 上下文）与「结果回传需要调用方 Activity 处于 resumed」。系统选择器被放进本应用 Task，导致本体被带到前台。

**采用方案（可行性优先，两条路各用一半）**：
- **拍照**：改为**不需要结果**——`ACTION_IMAGE_CAPTURE` + `EXTRA_OUTPUT`（我们的 FileProvider URI），用
  **`activity.applicationContext.startActivity()` + `FLAG_ACTIVITY_NEW_TASK`** 起相机（不进本应用 Task），
  然后后台线程**盯输出文件**（每 400ms 看长度，连续两次不变即认为写完；90s 超时当取消）。
  ⇒ **全程不把 OneTHU 带到前台**，用户拍完直接回到原应用，悬浮层照常。
- **相册 / 上传**：**必须拿结果**（SAF/Photo Picker 没有 EXTRA_OUTPUT 等价物，`ClipData` 只在拖拽场景可用），
  而结果回传要求调用方 Activity 处于 resumed 状态 ⇒ **无法在完全不回前台的前提下拿到 URI**。
  因此保留结果式调用，但**返回后立刻 `activity.moveTaskToBack(true)`** 把本体送回后台
  （`returnFocusIfNeeded()`：只有「起选择器之前本体不在前台」时才做），用户的视线回到原应用 + 悬浮层。
  ⇒ 仍有一次**短暂的前台闪现**（系统把本体提上来交付结果的那一瞬），但不再「停在 OneTHU 本体」。
- **做不到的部分（如实写）**：相册/上传要做到**零闪现**，只能放弃结果式 API：
  自己实现媒体选择（`MediaStore` 查询 + 自绘列表，需要 `READ_MEDIA_IMAGES` 权限），
  或让用户走「拍照」路径（已零闪现）。这属于产品取舍，本轮不擅自扩大权限面。

## 哪条只能真机验
| # | 静态可核对 | 只能真机验 |
|---|---|---|
| 1 | 线已删（代码里无 `headLine`）、四个动作都在 ScrollView 之外 | 两行胶囊在真机雾面上的观感与是否换行 |
| 2 | 事件链、`force:true` 语义、`onTtsDone` 收口 | **能不能真的出声**、手动/自动两档的实际表现、朗读时是否与语音输入抢麦 |
| 3 | 命令与 flag | 点击后是否真的回到本体（各家 ROM 对 launch intent 的处理不同） |
| 4 | 双 post 滚动 | 长回复下是否真的停在最新一条 |
| 5 | 阈值与形态参数（10s / 1.2s / 22×56dp） | 吸附缩小的观感、点击展开的丝滑度、侧边条是否挡手 |
| 6 | 时长与曲线（170+280 / 260+200） | **像不像「融化→滴落→铺开」**（Lead 会录屏） |
| 7 | 代码路径：相机走 Application+NEW_TASK+盯文件；相册/上传走结果+moveTaskToBack | **拍照是否真的零闪现**、相册/上传的闪现有多短、FileProvider 授权是否被 ROM 拒 |

## 需要 Lead 跑的验证
```bash
cd apps/desktop/src-tauri/gen/android && ./gradlew :tauri-plugin-onethu-overlay:compileDebugKotlin
cd apps/desktop/src-tauri/gen/android && ./gradlew :app:processArm64DebugMainManifest
```
编译风险点（我没编译过）：`activity.applicationContext.startActivity(plan.intent)`（相机路径）、
`activity.moveTaskToBack(true)` 的返回类型、`OverlayMd`/`OverlayViews` 新增的 import、
`Typeface.create(family, weight, italic)` 的 API 28 守卫。

## 风险与未做
- 相册/上传仍有**一次前台闪现**（见第 7 条取舍）；要零闪现需放弃结果式 API（要权限或自绘选择器）。
- 相机盯文件是「启发式」：极少数相机会在 `EXTRA_OUTPUT` 之外另存缩略图，此时我们只会拿到 EXTRA_OUTPUT 那份
  （真机若发现相册里多一张、或我们拿到的不是原图，回来告诉我）。
- 侧边条形态没有做「半藏进边缘」（目前是整颗贴边），要更极致的「半圆贴边」可以再改一版。
- 朗读依赖 `onethu-tts` 插件（ball-tts 的线）；未装/不支持时 `speakReply` 返回 false，面板不报错（静默）。

---

# task-15 编译修复（2026-10-11 17:0x，Lead 出包被阻塞）

## 编译结果：**BUILD SUCCESSFUL**（我本地实跑，两次）

```bash
cd apps/desktop/src-tauri/gen/android
./gradlew :tauri-plugin-onethu-overlay:compileDebugKotlin --console=plain
# → BUILD SUCCESSFUL in 3~4s
#   22 actionable tasks: 3 executed, 19 up-to-date
#   仅剩 1 条告警：SOFT_INPUT_ADJUST_RESIZE 已弃用（那是我们要用的 flag，故意保留）
```

## 根因与修法

**根因 1（Lead 报的 `OverlayViews.kt:417/424/467/468` 一批 `inputRow / underline / scroll / list / input / action` 未解析）**：
我在「顶栏重排」那一步用**文本切片替换**（从 `// 两个功能性裸文字入口` 到 `// 附件三入口（需求 6）`）重写顶栏，
**误删了位于这两个标记之间的整段视图构造** —— 消息列表（`scroll` + `list`）、底部输入行（`inputRow` + `input` + `action`）与
`underline`。于是后面的 `inputBlock.addView(inputRow/underline)` 和 `PanelHolder(...)` 全成了未解析引用。
→ **已按原设计补回**（消息列表 + 输入行 + 下划线），并把插入点放在新的两行顶栏之后、附件入口之前，
子视图顺序恢复为：`顶栏(两行) → 消息列表(weight=1) → 拍照/相册/上传 → 语音行(GONE) → 输入块(输入行+下划线)`；
`root` 子视图：`content → glow`。

**根因 2（Lead 报的 `OverlayWindows.kt:600 Unresolved reference: TextView`）**：
`OverlayWindows.kt` 此前**从未**直接构造过 `TextView`（都用 `p.xxx` 字段），所以文件里**没有** `import android.widget.TextView`；
我这轮新增「每条消息下方的朗读按钮」时直接写了 `TextView(themed)` → 未解析。
→ **已补 `import android.widget.TextView`**。

**Lead 替我改的那一处（`say` 朗读按钮显式逐行 + `OverlayViews.shadow(say)`）：原样保留。**
Lead 的注释是对的：在 `TextView(ctx).apply { … shadow(this) }` 里，`this` 在某些嵌套位置会被外层类遮蔽，显式逐行最稳。

**顺带清掉的告警**：
- `FogLayout.build(w,h)` 的 `w` 未使用 → 加 `@Suppress("UNUSED_PARAMETER")`（纵向渐变确实只用 `h`）；
- `onOrbTouch` 四个 `when` 分支末尾的冗余 `true`（`when` 是语句、函数末尾已 `return true`）→ 删掉，行为不变（已重新编译确认）。

## 复核过的其它静态风险（这次连同编译一起过了）
`PanelHolder` 字段顺序 ↔ 构造调用顺序、`OrbHolder.side` 新字段、`OverlayVoice.Host` 新增 `onOpenApp` 的服务实现、
`OverlayService.openApp/echoAttachment/liveDebug`、`OverlayPicker.plan/planFallback/materialize/mimeOf`、
`OverlayMd.render/progress/TAG_DIVIDER`、新增 import（TextView/Spannable/RelativeSizeSpan/TypefaceSpan/Typeface/ImageView/LinearGradient）。

## 「哪条只能真机验」（同前，未变）
1 顶栏胶囊观感/换行；2 **能否真出声**（手动/自动两档、朗读与语音输入抢麦）；3 点击回本体（ROM 差异）；
4 长回复是否真停最新一条；5 吸附缩小/展开丝滑度/是否挡手；6 **像不像「融化→滴落→铺开」**（录屏）；
7 **拍照是否真零闪现**、相册/上传闪现多短、FileProvider 是否被 ROM 拒。

---

# task-15 追加批次 A–F（用户 17:21 六条，全部悬浮层）

状态：**完成 · 编译通过**（`./gradlew :tauri-plugin-onethu-overlay:compileDebugKotlin` → **BUILD SUCCESSFUL**；tsc exit 0；`._*` 0）。

## A. 窗形态与风格
- **A①** 面板从「全宽 50% 半屏」改成**悬浮小窗**：左右各留 **14dp**（`PANEL_MARGIN_DP`）、高度 **44%**（`PANEL_RATIO`）、
  底部留 14dp、四周 **24dp 圆角**（`PANEL_RADIUS_DP`，落在 token `--dsw-radius-lg/xl` 之间）；
  窗口仍是 `TRANSLUCENT` + 显式像素尺寸（不用 MATCH_PARENT），圆角由雾层 `clipPath` 裁出来。
- **A②** 与本体 ChatDock **同一套视觉语言**：radius/颜色/字体/行高/间距全部走 `OverlayViews` 里的 token 近似值
  （`#1C1F24`/`#ECECF1`、15sp、行高 1.62、条目间距 14dp），顶栏动作统一成**胶囊 + 1px 细边**。
  注意 **决策点**：消息呈现仍保留前几轮已验收的「雾中の裸文字」（你当时要求，用户也认可过）。
  若这次「内外风格统一」指的是**要气泡**，说一声，我改一版（改动只在 `buildMessageColumn` 一处）。
- **A③** 顶栏**删掉「本次关闭悬浮球」**，只剩三个动作：**回到 OneTHU / 自动朗读 / 收起**。
  「本次关闭」语义仍在：通知栏动作 + 本体 ChatDock 的悬浮球按钮（task-9 那条线）。
- **A④** 液态滴落动效**保留**（见 D③/E 时长口径不变）。

## B. 吸附
- **B①** 拖到边缘：吸附动画（180ms）**一结束立即**缩成侧边条 —— 删掉了原来 1.2s 的等待（`EDGE_SHRINK_MS` 常量已移除）。
- **B①续** 侧边条**完全贴边**：胶囊按边缘方向贴住窗口外缘（右侧 `Gravity.END`、左侧 `Gravity.START`），
  配合窗口贴屏幕边 → 视觉上 x=0 / x=屏宽-条宽，不再留 8dp 投影缝。
- **B②** 空闲缩回阈值 **10s → 6s**（`IDLE_COLLAPSE_MS`，写进报告：用户没否，但结合「等太久」的反馈收紧）。

## C. 显示不可靠（「非得设置里关一下再开一下」）
- `showBallOnly()` 现在**先彻底摘干净（面板+球）再挂球** —— 真机那种「关一下再开一下才出来」的典型成因
  是上一次的挂载状态不一致；
- 挂载失败时**自愈一次**：`forceCleanupWindows()` 把两扇窗从 WindowManager 强制摘掉 + 重建视图 + 重挂；
- `attachOrb()` 内部也加了「失败→清残留→再试一次」；
- 三条恢复路径复核（`overlay_show` / 开机广播 / 被杀自救 / 前后台切换）**都只调 `showBallOnly()`**，都只出球。

## D. 长按球的语音形态（新）
- **D①** 长按 ≥450ms：球在**原位横向展开**成语音长条（`VOICE_BAR_W_DP=300`，不再先落底）——
  窗口 = 宽 300dp（屏宽不足时自适应）× 高 96dp（56dp 条 + 40dp 转写带）；
  条的**上方**浮一层**淡雾转写带**（`coreAlpha` 浅 0.72/深 0.62，只在说话/有转写时出现）显示识别到的话；
- 横向展开方向按球在哪半边决定（右半边向左铺、左半边向右铺），竖直方向以球心为中心；
- **D②** 上划取消（110dp、松手判定）沿用；
- **D③** 松手 → **液体滴落到底部 → 展开成统一小窗**（`dropletThenBloom()`，液体形变作用于当前可见子视图：球/条/侧边条）。

## E. 悬浮窗「一直 loading」
- 加入**原生看门狗**：`busy` 起算 40s（`BUSY_TIMEOUT_MS`，每 5s 检查）后**停止转圈**，改显示可读状态
  「**还没收到回复 · 切回本体可查看进度**」；期间若回复通过 `overlay_push_ui` 到达会立即恢复正常渲染。
- 说明：回复仍必须经本体 webview 的 JS 推回来（15s 超时同源的结构限制，Lead 那条线在处理），
  所以这里的定位是「**不让 UI 无限转圈**」+ 给可读状态，而不是绕过 webview 取回复。

## F. 保活（通知退出 + 调优指引）
- **F① 通知栏加「退出」动作**（`ACTION_EXIT`）：**结束这次保活会话** —— 停服务 + 摘掉球/面板，
  但**不动「本次已关闭」标记语义**：不写 `closedByUser`、不发 `closed` 事件（与「本次关闭」的区别：
  后者 = 用户主动本次关闭、重新开启需回本体点开；前者 = 单纯停掉这次的保活，下次在本体打开即可）。
- **F② 系统设置跳转命令**（给 task-16 的 OH 设置页直接用）：
  `plugin:onethu-overlay|overlay_open_settings { what }`，`what ∈ battery | startup | app`；
  TS 侧已导出 `openSystemSettings(what)`（`lib/overlayAndroid.ts`）。
  - `battery` → `Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS`（电池优化列表页，**无需权限**）；
  - `startup` → 华为/荣耀「应用启动管理」页（无公开 API，按常见组件名 try：`com.hihonor.systemmanager.*`
    / `com.huawei.systemmanager.*` 的 `startupmgr`、`appcontrol` 两个 Activity；取不到**回落应用详情页**）；
  - `app` → `ACTION_APPLICATION_DETAILS_SETTINGS`。
- **F② 文案（给 task-16 落位用，原文可直接用）**：
  > **让 OneTHU 常驻后台（华为 / 荣耀）**
  > OneTHU 的悬浮球靠一个前台服务保持在线。系统若把应用「自动管理」，后台活动会被限制，悬浮球可能被回收。
  > 建议按下面两步手动放行（只需设置一次）：
  > 1. **应用启动管理**：设置 → 应用 → 应用启动管理 → 找到 **OneTHU** → 关闭「自动管理」，
  >    打开「允许自启动」「允许关联启动」「允许后台活动」三开关。
  > 2. **电池优化**：设置 → 电池 → 更多电池设置 → 应用耗电管理（或「电池优化」）→ 找到 **OneTHU** →
  >    选择「不允许电池优化」/「允许后台活动」。
  > 另外：通知栏里那条「OneTHU 悬浮球已开启」是保活通知，**不要划掉**；不需要悬浮球时点通知里的
  > 「本次关闭」或「退出」即可。
  > 按钮：`[打开应用启动管理]` → `openSystemSettings("startup")`；`[打开电池优化]` → `openSystemSettings("battery")`。

## 哪条只能真机验（本批）

| 条目 | 静态可核对 | 只能真机验 |
|---|---|---|
| A① 小窗 | 尺寸/圆角/空隙常量 | 真机上小窗比例是否好看、圆角与雾边是否干净 |
| A② 风格 | token 值一致 | 与本体并排看是否「像一套」 |
| A③ 三动作 | 按钮已删、只剩三个 | 一行三个胶囊是否换行/挤 |
| B 吸附 | 时间常量、贴边写法 | **吸附是否够快、侧边条是否真贴边** |
| C 显示 | 自愈路径与日志 | 「点一次就出来」是否真的成立（含开机/被杀/前后台） |
| D 语音形态 | 窗口几何与转写带参数 | **原地横向展开的观感**、转写带位置、松手后滴落是否顺 |
| E 超时状态 | 40s 阈值与文案 | 别的应用里发消息，40s 后是否真的停转圈且文案可读 |
| F① 通知退出 | ACTION_EXIT 分支与标记语义 | 通知栏两个动作是否都在、点「退出」后球是否消失且**不**标记本次关闭 |
| F② 设置跳转 | intent 候选表 | 荣耀 MagicOS 上 `startup` 是否真的落到「应用启动管理」页（取不到会回落应用详情页） |

## 需要 Lead 跑的验证
```bash
cd apps/desktop/src-tauri/gen/android && ./gradlew :tauri-plugin-onethu-overlay:compileDebugKotlin   # 已由我本地跑过：BUILD SUCCESSFUL
cd apps/desktop/src-tauri/gen/android && ./gradlew :app:processArm64DebugMainManifest
cd apps/desktop/src-tauri && cargo check --target aarch64-linux-android   # 本轮新增 Rust 命令 overlay_open_settings
```

---

# task-15 追加：气泡化 + liquid glass（用户 17:5x 拍板）

状态：**完成 · 编译通过**（`:tauri-plugin-onethu-overlay:compileDebugKotlin` + `:app:processArm64DebugMainManifest` → **BUILD SUCCESSFUL**；
仅剩 1 条已知告警 `SOFT_INPUT_ADJUST_RESIZE` deprecated；tsc exit 0；`._*` 0）。

## 1) 气泡形制
- 新增 `OverlayGlass.kt` 的 **`GlassBubble`**（自定义 `FrameLayout`，自绘玻璃材质 + 自带进场动画）。
- **圆角 20dp，说话方那侧尾角 6dp**：`tailFor(isUser)` → 用户 `[20,20,6,20]`（右下收角）、OH `[20,6,20,20]`（左下收角）；
  路径用 `Path.quadTo` 逐角构造（`outlineProvider` 同步，阴影才跟随气泡形状）。
- 对齐与宽度：用户右对齐 / OH 左对齐；气泡最大宽度 **≤84% 屏宽**（内层文本 `maxWidth = 84%屏宽 − 28dp 内边距`）；
  正文 **15sp / 行高 1.62 / 主色 100% alpha**（`USER_ALPHA` 已从 0.62 改为 1.0 —— 区分只靠位置与尾角）；
  消息间距 **11dp**（`GAP_DP` 14→11，落在用户要求的 10–12dp）。
- 一个气泡包住整条消息：`[图片缩略图…][markdown 块…][朗读入口][状态行]`（附件气泡也因此天然同材质，缩略图圆角 14dp 不变）。

## 2) liquid glass 材质（跨应用窗口拿不到真 backdrop blur → 材质模拟）
| 层 | 实现 |
|---|---|
| 玻璃底 | `LinearGradient` 纵向：浅色 `#FFFFFF` α**0.62→0.48**；深色 `#000000` α**0.42→0.30**（`OverlayViews.glassFill()`） |
| 上沿 1px 内高光 | 先画 1px 极淡描边，再**裁到顶部 2dp 窄带**用亮色描边一遍 → 只亮上沿（等价 `inset 0 1px 0 rgba(255,255,255,.5)`）；静态强度浅 **0.5** / 深 **0.22** |
| 柔和外阴影 | `elevation` 10dp（浅）/ 12dp（深），outline 跟随圆角；并把 `list`/`row` 的 `clipChildren=false` 让阴影画得出来 |
| 防硬边 | 1px 描边：浅 `#FFFFFF` α0.35 / 深 `#FFFFFF` α0.22；**没有纯灰块**（底是半透明渐变 + 高光 + 阴影三层） |
> 注：之前审过「第三方拿不到跨应用模糊」，所以这里全程是**材质模拟**，没有再去碰 `FLAG_BLUR_BEHIND`（那是「全屏雾」元凶，已明确禁用）。

## 3) 「自然弹出」进场
- **只给最新一条**播：`animateNewest` 仅在「面板已打开 且 消息数变多」时置真（`pushUi` 里判断），
  `renderMessages` 只把最后一条传 `animate=true` 并立即复位 → 打开面板/历史重建时**没有乱跳**；
- 动画：`scale 0.94→1.0` + 上移 **6dp** + `OvershootInterpolator(1.05)`，**200ms**；
  同时顶部高光 `α0.35→0` 扫过 **200ms**（"液"感）；
- 本地即时回显（附件气泡、语音整句、键盘发送）也算新消息 → 同样播动画。

## 4) 其余不变（已复核）
小窗规格（左右 14dp / 高 44% / 24dp 圆角）、顶栏三动作（回到 OneTHU / 自动朗读 / 收起）、
液态滴落（150+280ms 开、260+200ms 关）、40s 停转圈的可读状态、附件即时气泡（同材质 + 缩略图 14dp）。

## 顺带修的一个真 bug
`OverlayMd` 原来给**所有**块级文本挂了 `LinkMovementMethod` —— 它会吃掉触摸事件，**破坏面板滚动**
（尤其气泡里点着文字往上滑会滑不动）。改成**只有真含 `](` 链接的块才挂** √。

## 哪条只能真机验（本批）
| 条目 | 静态可核对 | 只能真机验 |
|---|---|---|
| 气泡形制 | 圆角/尾角/间距/宽度上限常量 | 一面屏里气泡比例是否好看、尾角是否一眼可辨 |
| liquid glass | 三层参数（渐变/高光/阴影）| **真机上「玻璃感」够不够**（半透明底压在壁纸/应用上是否自然）、深色模式高光是否过亮 |
| 自然弹出 | 时长/曲线/只给最新一条的逻辑 | **弹出是否「自然」**、连续多条到达时是否跟手不打架 |
| 附件气泡 | 同材质 + 缩略图圆角 | 缩略图在玻璃底上的观感 |
| 滚动 | 已修 LinkMovementMethod 抢触摸 | 含链接的长回复里能否正常上下滑 |

---

# task-15 质量红线轮（emoji / 气泡胖 / 顶栏残缺 / （OH）标）

状态：**完成 · 编译通过**（`:tauri-plugin-onethu-overlay:compileDebugKotlin` → BUILD SUCCESSFUL；tsc exit 0；`._*` 0）。

## 1) emoji：全写域扫描 + 清零
扫描范围：`plugins/onethu-overlay/**/*.kt` + `lib/overlayAndroid.ts`，按
`[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{20E3}]` 逐码点扫。
**命中 2 处，都在源码字符串里（面板可见文案）**，已改：
| 位置 | 改前 | 改后 |
|---|---|---|
| `OverlayWindows.kt`（附件本地回显） | `"[回形针emoji] $name"` | `"附件：$name"` |
| `overlayAndroid.ts`（附件消息推给原生） | `` `[回形针emoji] ${name}` `` | `` `附件：${name}` `` |
复扫结果：**0 处**。（其余命中都是**注释里的箭头/框线/注意**，不进 UI；`─` 之类是注释分隔线。）
复现命令：`python3 -c "…emoji 正则扫…"`（见本轮会话脚本）。

## 2) 气泡不再「胖」——参数表（含实测）
| 项 | 值 | 实测 |
|---|---|---|
| 垂直内边距 | **7dp**（要求 ≤9） | — |
| 水平内边距 | **13dp**（要求 ≤13） | — |
| 字号 / 行高 | **15sp** / `lineSpacingMultiplier = 1.32`（Android 乘的是字体行高 1.17em → **≈1.55em**，落在 1.55–1.62 低端） | 单行 = 15×1.17×1.32 ≈ **23.2dp** |
| 单行气泡总高 | 23.2 + 7×2 = **37.2dp**（Android 算法） | 静态桩（中文字体，更悲观）量到 **39.25dp** —— 两种算法都 **≤40dp** √ |
| min-height | **不设**（任何地方都没有 minHeight） | — |
| 段间距（气泡内） | 缩略图下 6dp；朗读行 0；列表项 3dp；分隔线上下各 3dp → **全部 ≤6dp** | — |
| 空行 | markdown 段落逐行 `trimEnd()`，段落循环遇到空行即断 → 块内**不留空行** | — |
| 气泡最大宽度 | `min(84% 屏宽, 小窗内容宽)` | 361dp 屏上 ≈ 303dp |
| 消息间距 | **11dp** | — |
> 注：垂直内边距从 8dp 收到 7dp 是被实测逼出来的——8dp 时静态桩量到 **41.25dp**，超了 40dp 上限。

## 3) 顶栏：一行三胶囊（实测）
| 项 | 值 |
|---|---|
| 结构 | **一行**：`回到 OneTHU` / `朗读 开·关` / `收起`（第二行已删） |
| 胶囊高 | **32dp**（固定 LayoutParams 高度） |
| 水平内边距 | **12dp**；彼此间距 **8dp**；与小窗边距一致 **14dp**（content 左右 padding） |
| 单行约束 | `isSingleLine=true`、`maxLines=1`、`ellipsize=null` → **不换行、不截断** |
| 文案收敛 | 「自动朗读：开/关」→ **「朗读 开/关」**（360dp 也放得下） |
| 实测 | 胶囊行高 **32dp**，三个胶囊总宽 **233dp**，可用 **333dp**（333 = 屏 361dp − 14×2） → **一行完整放下，余量 100dp** √ |

## 4) （OH）标：与官方 HarnessMark 完全一致
来源 `components/HarnessMark.tsx` + `global.css:4090-4093`（**半角** `(` `O` `H` `)`）：
| 范围 | spans | 与 CSS 对应 |
|---|---|---|
| `[0,1)` `(` | `TypefaceSpan("monospace")` + `RelativeSizeSpan(1.10f)` | `.p` mono 400；括号**补到 1.10×**（等宽括号天生偏小偏细） |
| `[1,2)` `O` | `TypefaceSpan(serif, 500)` + `RelativeSizeSpan(1.14f)` | `.o` 1.14em |
| `[2,3)` `H` | `TypefaceSpan(sans-serif, 700)` + `RelativeSizeSpan(1.06f)` | `.h` 1.06em / 700 |
| `[3,4)` `)` | 同 `(` | — |
TextView：`textSize=15sp`、`letterSpacing=0.05f`（= `gap:0.05em`）、`includeFontPadding=false`、`isSingleLine=true`、`gravity=CENTER`（球内垂直居中）、**球径 54dp 不变**。
宽度核算：`(`9.9 + `O`12.3 + `H`11.4 + `)`9.9 + 字距 3 ≈ **46.5dp < 54dp** √ 不裁、不挤。
静态桩里把 54dp 球框画成虚线叠上去看，括号与字母同高、无裁切（见 `preview/mark-ball.png`）。

## 5) 静态渲染截图（**这是我的交付证据，但要说清性质**）
- 位置：`apps/desktop/src-tauri/plugins/onethu-overlay/preview/`
  - `mark-ball.png`（球 · 浅/深，叠 54dp 虚线框）
  - `topbar.png`（顶栏三胶囊 · 浅/深）
  - `bubbles.png`（气泡：单行 / 多行 markdown / 附件缩略图 · 浅/深）
  - `measure.png`（**把实测数字印在图上**：单行 39.25dp、胶囊行 32dp/总宽 233dp、尾角 2.6× 放大对照）
- **性质说明（必须诚实）**：这是**参数等价的静态渲染**（HTML/CSS 复刻同一套数值 + 同一套 Web 字体栈），
  **不是 App 真机截图**——我这边不允许装机/点屏。它能证明的是**几何与材质参数**（高度、宽度、圆角、尾角、透明度、层次），
  不能证明 Android 端字体度量（Roboto/PingFang 的 ascent/descent）与自绘路径的最终像素。真机观感仍需用户点一遍。
- 生成方式：`preview/*.html` + Chrome headless（`--headless=new --force-device-scale-factor=2 --screenshot`），
  与 `measure.html` 里用 `getBoundingClientRect()` 把实测值写进页面再截图。

## 6) 哪条只能真机验（本轮）
| 条目 | 静态已证 | 只能真机验 |
|---|---|---|
| emoji | 码点扫描 **0 命中** | —（无需真机） |
| 气泡不胖 | 实测 39.25dp / Android 算式 37.2dp | Android 字体度量下的最终高度、连续多条的手感 |
| 顶栏一行 | 实测总宽 233dp < 可用 333dp | 真机字体（PingFang/Roboto）下是否仍一行、胶囊是否被系统主题描边影响 |
| （OH）标 | span 表 + 宽度核算 + 虚线球框对照 | 真机上 mono/serif/sans 三族实际字形是否如预期（Android 无 SF Mono/Georgia，落到 Droid Sans Mono/Noto Serif 的观感差异只能真机看） |
| 玻璃材质 | 参数与层次 | 真机压在真实壁纸/应用上是否「像玻璃」（elevation 阴影在 overlay 窗口里的实际表现） |

---

# emoji 清零验收（Lead 补充要求：贴命中清单 + 参数，不要只说「改好了」）

## 1) 命中清单与替换结果

扫描范围：`plugins/onethu-overlay/**`（含 `android/` 源码、`res/`、`AndroidManifest.xml`、Rust、permissions、REPORT）
+ `apps/desktop/src/lib/overlayAndroid.ts`；正则 `[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{20E3}\u{200D}]`。共 41 个文件。

| # | 位置 | 改前 | 改后 | 是否 UI 可见 |
|---|---|---|---|---|
| 1 | `OverlayWindows.kt` 附件本地回显（约 750 行） | `"[回形针emoji] $name"` | **`"附件：$name"`** | **是（面板气泡）** |
| 2 | `overlayAndroid.ts:364`（附件消息推给原生） | `` `[回形针emoji] ${name}` `` | **`` `附件：${name ?? "（未命名）"}` ``** | **是（面板气泡）** |
| 3 | `OverlayService.kt:17` 类注释 | `[警告emoji] Android 15+ 移除了…` | `注意：Android 15+ 移除了…` | 否（注释） |
| 4 | `OverlayWindows.kt:486` KDoc | `* [警告emoji] **不能把输入块设成 GONE**` | `* 注意：**不能把输入块设成 GONE**` | 否（注释） |
| 5 | `AndroidManifest.xml:9` XML 注释 | `[星号] 需要 Lead 在 app 模块确认…` | `! 需要 Lead 在 app 模块确认…` | 否（注释） |
| 6 | `REPORT.md`（本文档自身） | 历史段落里的 emoji 记号 | 全部替换成纯文字 | 否（文档） |

**关于 Lead 提到的 `overlayAndroid.ts:364`**：该行**在上一轮已改完**；现在实际内容（可 `sed -n '364p'` 复核）：
```ts
const mine: NativeMsg = { role: "user", text: `附件：${name ?? "（未命名）"}`, images: [path], status: "sending" };
```
（你看到的 `［回形针］ ${name ?? "附件"}` 是**修改前的快照**。）

## 2) 复扫结果：**0 命中**

```
扫描 41 个文件（.kt/.xml/.rs/.toml/.json/.md/.html/.kts/.pro + overlayAndroid.ts）
emoji 总命中 = 0
```
复现：`python3` 跑上面那条正则（脚本见本轮会话；一个 HIT 都不打印即为通过）。

**面板可见文案最终清单**（Kotlin 里所有 `text=`/`hint=` 默认值）：
| 文件:行 | 文案 |
|---|---|
| `OverlayViews.kt:299` / `:520` | `在听，请讲…`（语音条与面板语音行） |
| `OverlayViews.kt:427` | `点击输入，长按说话`（输入行占位） |
| `OverlayViews.kt:446` | `发送` |
| `OverlayViews.kt:619` | `•`（侧边条上的**软点**，U+2022 印刷符号，**不在任何 emoji 区间**：10sp / α0.43 当可点提示用；你要「连符号都不要」我就改成自绘圆点） |
| `OverlayWindows.kt:711` | `朗读` |
| 其它运行时文案 | `附件：<name>`、`正在发送…`、`OH 正在思考…`、`还没收到回复 · 切回本体可查看进度`、`发送失败，可再试一次`、`回到 OneTHU`、`朗读 开/关`、`收起`、`在听，请讲…`、`松开取消`、`没听清，再说一次`、`此环境取不到麦克风，点开面板用键盘输入`（全部纯文字） |

## 3) 与 ball-ui 同口径的参数表（我这边的对应值）

| 项 | 我的值（原生侧） | 备注 |
|---|---|---|
| 气泡内边距 | **7dp 垂直 / 13dp 水平** | 要求 ≤9 / ≤13 |
| 单行气泡总高 | **Android 算式 37.2dp**；静态桩实测 **39.25dp** | 要求 ≤40（8dp 时静态桩 41.25dp 会超，故取 7dp） |
| 行高 | `lineSpacingMultiplier=1.32`（≈**1.55em**） | 要求 1.55–1.62 |
| 顶栏 | 胶囊高 **32dp**、水平内边距 12dp、间距 8dp、外边距 14dp；**三胶囊总宽 233dp / 可用 333dp**（余量 100dp） | 要求不溢出、不换行 |
| 球内标 | 半角 `(OH)`：mono 1.10× / serif 1.14× / sans 700 1.06×；15sp；宽度核算 ≈46.5dp < 54dp | 与官方 HarnessMark 一致 |

---

# 三处旧样式统一 + 整块毛玻璃 + 横屏吸附（用户 2026-10-11 19:5x）

状态：**完成 · 编译通过**（`:tauri-plugin-onethu-overlay:compileDebugKotlin` → BUILD SUCCESSFUL；tsc exit 0；`._*` 0）。
新预览图：`preview/glass.png`（整块毛玻璃小窗 + 线描图标 + 语音条/转写带，浅深各一）。

## ① 三处「旧样式」改造点清单
| # | 位置 | 旧 | 新（与面板同一套） |
|---|---|---|---|
| 1 | **面板内长按的语音条**（`OverlayViews.buildVoiceBar` 的 root） | `coreAlpha 0.90/0.94` + 纵向渐变底浓顶淡 | **整块毛玻璃** `0.78/0.62`、上下同浓度、`cornerRadius 18dp`、1px 细边、上沿 1px 高光 |
| 2 | **语音条上方的转写带**（同一 builder 的 `sub`） | `0.72/0.62` + 向上淡出到透明 | **同材质**（略薄：`0.74/0.58`）、无渐隐、14dp 圆角、同细边与高光 |
| 3 | **拍照 / 相册 / 上传三入口** | 裸文字 13sp（`拍照` `相册` `上传`） | **线描图标**（新增 `OverlayIcons.kt` 的 `LineIcon`：相机/相册/上传，Canvas 自绘、1.5dp 描边、圆头圆角）；**只留图标 + title 语义**（`contentDescription` + API26+ `tooltipText`），一行 3 个 40×40dp 可点区、间距 10dp、**不折行**；不收 emoji |
| 4 | **球长按触发的条** | 与面板内长按不同路径观感 | 与面板内长按**同一套**：球原位横向展开（`VOICE_BAR_W_DP=300`）→ 上划 110dp 取消 → 松手发出 → 液体滴落 → 铺开成小窗（`dropletThenBloom()` 对当前可见子视图做液滴形变） |
> 说明：三处现在共用同一组材质常量（`backplateFill/backplateBorder` + `FogLayout` 的 `cornerRadiusPx/borderColor/topHighlight`），所以「新样式」只有一处真源，后续改一次全跟着变。

## ② 毛玻璃参数表（整块可见，无顶部渐隐）
| 元素 | 浅色 | 深色 |
|---|---|---|
| 小窗背板 fill | `#FFFFFF` **α0.78**（`backplateFill(true)`=α199） | `#000000` **α0.62**（α158） |
| 背板细边 | `#000000` α0.14（1px） | `#FFFFFF` α0.19（1px） |
| 上沿 1px 内高光 | **α0.50** | **α0.22** |
| 圆角 | 24dp（`PANEL_RADIUS_DP`） | 同 |
| 轻投影 | elevation 10dp | elevation 12dp |
| 纵向渐变 | **移除**（`stopPositions=[0,1] / weights=[1,1]`，上下同浓度；无任何 mask/淡出） | 同 |
| 语音条 | 同上，圆角 18dp；上方转写带 α0.74 / 圆角 14dp | α0.62 / 转写带 α0.58 |
| 气泡（未变，仍与背板同一语言） | 玻璃底 α0.62→0.48 + 上沿高光 0.5 + 尾角 6dp | α0.42→0.30 + 高光 0.22 |
> 结果：**整块面板从顶到底都是可见的磨砂板**（用户原话「整个块是能看到的」），四角清晰、边界干净；不再出现「上半段淡到没有、文字直接压壁纸」。

## ③ 横屏吸附的重算时机（用户：「横屏没有自然边缘吸附」）
新增 `OverlayWindows.onConfigChanged()`，由 `OverlayService.onConfigurationChanged()` 调用（**一条 Configuration 变化跑一次**）：
1. **先记旧态**：旧 `cachedW` + 「球当时贴哪条边」（`ballX ≤ 8dp` → 贴左；`ballX + 窗宽 ≥ 旧屏宽 − 8dp` → 贴右）；
2. **丢缓存重取 work area**：`refreshScreen()` → `currentWindowMetrics.bounds` 重新取（横屏宽高互换）；
3. **按新尺寸重新落位并保持贴边**：贴左 → `x=0`；贴右 → `x=新屏宽 − 窗宽`；否则重新 `clampX`；`y` 重 `clamp`；
   并把**新坐标 + 新屏幕尺寸**写回存档（存档带屏幕尺寸，不会被版本校验当成越界值作废）；
4. **重挂窗口**：`forceCleanupWindows()` → 清空 holder → 按原模式重建（`panel` 重建面板、`bar` 重建条、球形态重建球，**原本是侧边条就继续在同一条边贴边**）；`suspended`（本体在前台）时只清窗不重建；
5. 之后紧跟 `onUiModeChanged()` 处理深浅色（状态一致会自行短路）。
**重算覆盖的几何**：球窗/侧边条窗的贴边 x、`clampX/clampY` 的上下界、面板宽（`屏宽 − 2×14dp`）与高（`44% × 屏高`）、默认落点 `right 12dp / bottom 128dp`、语音条横向展开宽度上限。

## 只能真机验（本轮）
线描图标在真机上的辨识度与 40dp 触控手感；整块毛玻璃压在真实壁纸/别应用上的观感（α0.78/0.62 是否够实、又不糊字）；
**横屏切换时球/侧边条是否保持贴边、面板是否按新尺寸重排**（我只能保证重算逻辑与时机，真机旋转手感必须实测）；
球长按与面板内长按两处动画是否**看起来完全一致**。

---

# 统一风格专项 ①–⑥（用户 2026-10-11 20:30）

状态：**完成 · 编译通过**（`:tauri-plugin-onethu-overlay:compileDebugKotlin` → BUILD SUCCESSFUL，0 error / 0 warning；tsc 干净；`._*` 0）。
新预览：`preview/unified.png`（浅深各一块：本体同款图标 + 喇叭两态 + 顶部把手 + 加厚背板 + 语音条/转写带）。

## ① 附件三入口图标：直接用**本体 SVG path 原文**
`components/Icons.tsx` 的 `IconCamera / IconImage / IconUpload` 是 24 viewBox + `strokeWidth 1.6` + round cap/join，
本插件现在**逐字节搬同一条 path**（`OverlayIcons.kt` 的 `SPECS`），用 `androidx.core.graphics.PathParser` 解析成 Canvas 路径：
| 图标 | 本体 path（同一串） | 说明 |
|---|---|---|
| 相机 | `M4 8.5A1.5 1.5 0 0 1 5.5 7h1.2…` + 镜头圆 `M12 16a3.2 3.2 0 1 0 0-6.4…z` | 机身+镜头+顶部凸起 |
| 图片 | 圆角框 + 小太阳 + `M4.5 18l5-5 3.2 3.2 2.6-2.6 4.2 4.4` | 边框+山峰+右上太阳 |
| 上传 | `M12 16V5` / `M7 10l5-5 5 5` / `M5 19h14` | 箭头向上+托盘 |
| 喇叭 | `M11.4 5.2 6.9 8.6H4.3a1 1 0 0 0-1 1v4.8…z` + 两道声波 | 见 ③ |
绘制：24 单位空间 → **视觉尺寸 20dp** 居中放进 40dp 可点区（缩放 20/24，等效描边 1.33dp ≈ 本体的 15px 图标）；
语义仍走 `contentDescription` + API26+ `tooltipText`（**只留图标 + title**，不收 emoji，一行不折）。

## ② 底板加厚
| 元素 | 改前 | 改后 |
|---|---|---|
| 小窗背板 | 浅 α0.78 / 深 α0.62 | **浅 α0.90 / 深 α0.80** |
| 语音条本体 | 同上 | **浅 α0.90 / 深 α0.80** |
| 上方转写带 | 浅 α0.74 / 深 α0.58 | **浅 α0.82 / 深 α0.68** |
细边（浅 `#000000` α0.14 / 深 `#FFFFFF` α0.19）与上沿 1px 高光（0.50 / 0.22）**不变**；仍是**整块可见、无顶部渐隐**。

## ③ 朗读入口：喇叭图标 + 彻底消灭蓝框
- 每条 OH 消息的朗读入口从文字「朗读」换成 **`LineIcon("speak"/"speakOff")`**（本体 `IconSpeak` 同一副喇叭）：
  **发声态 = 喇叭本体填充**（`filled=true`），静默态 = 线描；**再点一次 = 停止**（发 `stopSpeak` → 适配器 `ttsStop()`），
  与本体 ChatDock 的 `speakingText` 语义一致（原生也按 `speakingText` 认「哪一条在念」）。
- **蓝框根因**：安卓可点 View 命中 `default focus highlight / state_focused`。新增 `OverlayViews.noFocusRing(v)`：
  `defaultFocusHighlightEnabled=false`（API26+）+ `isFocusable=false` + `isFocusableInTouchMode=false` + `backgroundTintList=null`；
  **全面板扫描已应用**：顶栏三胶囊、附件三图标、发送、每条消息的喇叭；自定义背景全是 `GradientDrawable`（无 state 列表）→
  **任何状态都不会出现蓝色矩形框**；输入框保留聚焦（那是功能指示，与本体一致）。

## ④ 闪几下 / 多个一起出现：动画按消息 id 去重 + 回显与权威列表合并
- `PushMsg` 增 **稳定 `id`**：前端给了就用（TS 侧每条消息 `m1/m2/...`），没给就按 `role|text|images` **内容派生**；
- 原生维护 `seenIds`：`renderMessages()` 里 `isNew = seenIds.add(id)`，**只有 id 是新的、且是最新一条**才播进场动画 →
  **同一条消息只播一次**；本地回显（附件/语音/键盘）用与派生子同规则的 id，JS 权威列表到达时**同 id 不再二次弹跳**；
- 回显与权威列表**合并不是新建**：本地回显先入列（status=sending），权威列表到达后按同一 id 覆盖渲染（像素一致，无闪烁）；
  `seenIds` 超过 400 条清空一次，避免无界增长。

## ⑤ 顶部把手：竖直拖动改小窗高度
- 面板顶部（顶栏之上）加 **把手 36×5dp 圆角条**（浅深同构；按下 α0.75→1.0 + 轻触感）；
- 竖直拖动：`h = clamp(起始高 + dy, 30% 屏高, 80% 屏高)`，**底边固定**（改高同时把 y 往上顶，像底部抽屉被拉长），
  逐帧 `updateWindowLayout`；松手把 `h/屏高` 写进 `OverlayPrefs.panelRatio`，下次开面板沿用（`panelParams()` 读它并 clamp）；
- 与顶栏三胶囊/液态动效不打架：把手是独立 View、手势只走它自己；扩散/收拢动画作用于 `p.root` 的 scaleY/translationY，与窗口高度正交。

## ⑥ 回归复核（未退化）
| 项 | 状态 |
|---|---|
| 横屏吸附 | `onConfigChanged()` 未动（记旧贴边方向 → `refreshScreen()` → 按新 work area 重落位 → 重挂窗口）✓ |
| 长按横向展开 | `applyOrbShape("bar")` 几何未动（原位 300dp，按球所在半边铺向）✓ |
| 40s 停转圈 | `busyWatch` 未动（`BUSY_TIMEOUT_MS=40s`，超时换「还没收到回复 · 切回本体可查看进度」）✓ |
| 附件即时气泡 | `finishAttach()` → `echoAttachment()` 未动；本条只改了它的消息 id 与（②）材质 ✓ |
| 消息 id 兼容 | 前端不传 id 也能工作（内容派生）✓ 老前端不会崩 |

---

# 把手拖拽方向修正（用户 21:15 当场发现）

| | 公式 | 现象 |
|---|---|---|
| 改前 | `h = clamp(startH + dy, 30%, 80%)`，`dy = 当前rawY − 按下rawY` | **往上拖（dy<0）变矮、往下拖（dy>0）变长** ← 反的 |
| 改后 | `h = clamp(startH − dy, 30%, 80%)` | **往上拖 = 变高、往下拖 = 变矮** |

一行验证：`startH = 1400px（50% 屏高）`，手指从 `rawY=2000` 拖到 `rawY=1800`（往上 200px）→ `dy=-200` →
`h = 1400 - (-200) = 1600`（更高）✓；反向往下滑 200px → `dy=+200` → `h = 1200`（更矮）✓。

其余三点已核对：
- **底边固定**：每次改高同时 `lp.y = screenH − 14dp内边距 − h`（上顶 y 同步变化，像抽屉被拉长）；用 **rawY**（屏幕坐标）而非 `e.y`，避免拖动中窗口顶边移动导致坐标漂移；
- **松手写存档**：`panelRatio = lp.height / screenH`（存的是「高度比例」，与方向无关），下次 `panelParams()` 读取并 clamp 30%–80% ✓；
- **把手只属于面板态**：`buildHandle()` 只在 `buildPanel()` 里调用一次（侧边条 / 语音条 / 球都不带把手）；把手是 5dp 独立 View + 8dp 底距，位于顶栏之上、消息区之外，**不吃滚动**（触摸只从它自身起算）。

回归：`onConfigChanged()`（横屏吸附）与 `applyOrbShape("bar")`（长按原位横向展开）本轮**未触碰**（各只有 1 处定义、无改动），`compileDebugKotlin` → **BUILD SUCCESSFUL**。

---

# 把手「好难拖动」修正（用户 21:52）

| 项 | 值 |
|---|---|
| **命中区尺寸** | 视觉条仍是 **36×5dp**；**可拖区域 = 全宽 × 36dp 容器**（条居中，上下各 ≈15.5dp ≥ 12dp）。触摸监听挂在**容器**上，按在条附近任何位置都能拖，不需要精准命中那 5dp 细条 |
| **阈值** | 位移 **> 2dp**（`HANDLE_SLOP_DP`）才进入拖动；**进入瞬间 rebase**（`resizeStartH = 当前高`、`resizeDownY = 当前 rawY`）→ 跨阈值**不产生高度跳变**，同时过滤手指微抖 |
| **是否每帧重挂** | **不重挂**。拖动中只 `lp.height/lp.y` + `wm.updateViewLayout(root, lp)`（同一扇窗、同一份 View）；任何异常只被 catch 忽略，绝不走 `forceCleanupWindows()`/重建路径 |

配套：方向仍是「往上拖 = 变高」（`h = startH − dy`，`dy = 当前rawY − 按下rawY`）；底边固定（`lp.y = 屏高 − 14dp − h`）；
进入拖动时才给一次轻触感（`CLOCK_TICK`）；松手 `panelRatio = h/屏高` 存档；把手容器只在 `buildPanel()` 里创建（侧边条/语音条/球都没有），
且位于顶栏之上、消息 ScrollView 之外（**不吃滚动**）。
`compileDebugKotlin` → **BUILD SUCCESSFUL**（仅 1 条已知 `SOFT_INPUT_ADJUST_RESIZE` deprecated 告警）。
