# task-11 交付报告：安卓原生悬浮层返工（对齐 OH 雾中裸文字 / 默认只有球 / 本体前台隐藏 / 长按语音）

> 前一轮 task-3 交付的骨架与平台判定仍然有效（架构、保活、事件通道、`overlay_push_ui` 等），
> 本文件是 **task-11 返工版**的完整口径；两份都读的话，以本文件为准。

## 状态：完成（代码齐、tsc 0 error；gradle 编译 + 装机 + 截图验证待 Lead）

## 改动文件（全部在写域内）

| 文件 | 变更 |
|---|---|
| `android/.../overlay/OverlayViews.kt` | **重写**：`FogLayout`（径向渐变 + 羽化的自定义 ViewGroup）、`FogBall`（54dp 雾球）、`WaveDots`、面板/条/消息构造；无气泡裸文字 |
| `android/.../overlay/OverlayWindows.kt` | **重写**：窗口尺寸按内容算、去跨应用模糊、默认只出球、面板 46% + 240ms 滑入、上划取消、原生语音接线、本体前台挂起 |
| `android/.../overlay/OverlayVoice.kt` | **新增**：本进程 `SpeechRecognizer` + 三段能力探测 + 松手整句/上划取消 + 不静默降级 |
| `android/.../overlay/AppForeground.kt` | **新增**：ActivityLifecycleCallbacks 自算前台态（本体在前台 → 悬浮层整体隐藏） |
| `android/.../overlay/OverlayService.kt` | 重写要点：Host 扩到 4 个回调（语音取麦/收麦）、`setSuspended`、`onConfigurationChanged` 跟随 uiMode、通知文案随前台态、恢复一律只出球 |
| `android/.../overlay/OnethuOverlayPlugin.kt` | 注册前台态；`overlayShow` 一律从球开始 + **顺路请求麦克风权限**（本体前台时）；`overlay_status` 加 `appForeground` |
| `android/.../overlay/OverlayBootReceiver.kt` | 开机/自救恢复一律「只出球」 |
| `android/src/main/AndroidManifest.xml` | 显式声明 `RECORD_AUDIO`（与 `FOREGROUND_SERVICE_MICROPHONE` 配对） |
| `apps/desktop/src/lib/overlayAndroid.ts` | **重写**：适配器自己持有原生对话（消费 `submit` → `askOh` → `overlay_push_ui` 回推），消息列表/主题（uiMode 兜底）自带；接收通道模块加载即挂 |

## 逐条对照四条真机反馈

### ① 「没使用我们的（OH）样式」→ 原生化一套 OH 视觉语言
- **球**：54dp，`FogLayout` 径向雾（`stopStops=[0,0.62,0.88,1]`、`stopWeights=[1,0.86,0.34,0]`，到边缘 alpha=0 → 球外完全透明）+ API 31+ `RenderEffect.createBlurEffect(6f,6f)` 柔化（失败静默退化）+ 居中「OH」15sp/700、无边框无硬阴影。
- **面板 = 雾中の裸文字**：`buildMessage()` 生成 `TextView`，**无气泡/无头像/无卡片框**；对方左对齐正常字重（`#1C1F24`），用户右对齐 `alpha=0.62`；15sp、`setLineSpacing(0f, 1.62f)`、条目间距 14dp、`maxWidth=屏宽*0.84`、可上下滑动、不截断。
- **输入区**：无框下划线 —— `EditText` 背景置空（`background=null`）+ 其下一条 1dp、`alpha≈0.15` 的细线；占位「点击输入，长按说话」；右侧只有一个**裸文字**「发送」。
- **配色**：浅色雾心 `#FFFFFF`/文字 `#1C1F24`；深色 `#151517`/`#ECECF1`，默认按系统 `uiMode` 判定（`OverlayViews.isDarkUi`），`pushUi.theme` 可覆盖（有变化才重建视图）。
- 面板表面保留一个必要的裸文字入口「本次关闭悬浮球」（需求 5 要求），12sp/55% alpha，右上角，无框。

### ② 「还是在 onethu 里面自己出现了」→ 本体前台时整体隐藏
- `AppForeground`（`ActivityLifecycleCallbacks` 的 `onActivityStarted/Stopped` 计数）判定本体是否前台；插件装载即注册（比服务更早）。
- 服务 `AppForeground.onChange` → `windows.setSuspended(true)`：**球 + 面板 + 条全部摘掉**（保留模式记忆）；离开本应用 → `showBallOnly()` 只出球。
- `overlay_status` 新增 `appForeground`，便于区分「按设计隐藏」与「启动失败」。
- ⚠️ 另一处可能的「本体里冒球」来源是**前端 DOM 的 GlobalOrb**（Lead 的 App.tsx 挂载）。安卓侧的原生层已按上面处理；如果 App.tsx 在安卓上也挂了 `GlobalOrb`，请把它的渲染条件限定为「桌面端」或「`!isOverlayClosedByUser()` 且非安卓」，否则应用内会再出现一颗 DOM 球。

### ③ 「退出到桌面全屏是雾，我都没点击都全是雾」→ 结构性修掉
根因判断（三条一起改，不留「可能是它」）：
1. **跨应用模糊嫌疑最大**：旧版对球窗与面板窗都试了 `FLAG_BLUR_BEHIND` + `LayoutParams.setBlurBehindRadius`（反射）。ROM 若把它当成显示级模糊，整块屏幕就是一层雾——这条**已彻底删除**，全部改为本地绘制。
2. **窗口尺寸**：旧版面板宽用 `MATCH_PARENT`；现在所有 `WindowManager.LayoutParams` **一律显式像素**（球 54dp、条=屏宽×56dp、面板=屏宽×46%），`PixelFormat.TRANSLUCENT`，**视图不设任何背景色**。
3. **雾的画法**：新增 `FogLayout`（`setWillNotDraw(false)` + `onDraw` 画 `RadialGradient`），中心浓、四周 alpha 归零（羽化），半径按长边算且 stop 曲线 `[0,0.55,0.82,1]→[1,0.80,0.30,0]`：**雾之外与窗口之外都是完全透明**。
4. **默认只出球**：`OverlayService.start(..., "ball")`、开机/自救恢复也强制 `"ball"`；`overlay_show` 不再沿用上次形态；未点击时不创建也不挂载面板窗（面板窗是懒创建）。
5. **面板从底部丝滑滑入**：`translationY = 面板高 → 0`，240ms `DecelerateInterpolator`；收起 160ms 反向。面板 = 下半屏 46%，`gravity=BOTTOM`，`FLAG_NOT_TOUCH_MODAL`（不挡下面的应用）。
6. **点球 → 面板；再点 → 回球**：面板打开时把球窗重新挂到最上层（`raiseOrb()`），所以「再点球」始终可点。

### ④ 「长按还不能发」→ 原生自带语音 + 不静默降级 + 上划取消
- 长按 ≥450ms（`HOLD_MS=450`，与前端同值）→ 抖一下 + 变全宽 56dp 雾条（点点波纹随本机 rms 跳动 + 实时转写浮在雾里）。
- **能力探测三段**：`RECORD_AUDIO` 是否授予 → `SpeechRecognizer.isRecognitionAvailable()` → 运行时探针（开听后 2.5s 内 rms 始终无动静或直接报音频类错误 → 判定取不到麦）。识别器是**本进程自建**（不经过 onethu-speech 插件）。
- **可用**：松手 `stopListening()` → 700ms 内拿最终结果（等不到用已有部分转写兜底）→ **整句作为一条消息发出**（与键盘输入同一条 `submit` 通道）→ 自动切到面板看回复。
- **取不到麦**：条内显示「此环境取不到麦克风，点开面板用键盘输入」，1.4s 后**自动展开面板**（绝不静默失败）。
- **上划取消**：按住期间 `downRawY - rawY > 110dp` → 条文案变「松开取消」，松手才判定；取消则不发任何内容、回球。
- 30s 看门狗：条挂了超过 30s 自动收尾（抬手事件丢失/识别器卡死也不至于一直占麦）。
- **事件口径变化**：安卓原生**不再回传 `hold`/`release`**（否则前端 GlobalOrb 的 hold 分支会再起一个识别器抢麦）；`tap` 只在「打开面板」时回传（收起不发——GlobalOrb 的 tap 处理器有 stale closure，永远发 `overlay_set_mode("panel")`，收起时发 tap 会被它立刻重新打开）。

## 什么条件下能语音、什么条件下只能打字（含真机证据）

真机取证（只读 adb，未装机）：**HONOR PPG-AN00 / Android 16 (SDK 36) / MagicOS 10.0.0.175**，包 `app.onethu.desktop.dev`：

```
Uid mode: RECORD_AUDIO: foreground      ← MagicOS 把本应用麦克风设成「仅前台」模式（appops MODE_FOREGROUND）
SYSTEM_ALERT_WINDOW: allow; time=+19m48s ago   ← 悬浮层授权已给（用户实测时点的）
```

- **能发（预期路径）**：应用仍在前台时点「打开悬浮球」→ `overlayShow` 顺路请求 `RECORD_AUDIO`（本体前台才弹得出框）→ 服务启动时 `ensureMicTypeIfGranted()` 把 `microphone` 前台服务类型挂上 → 用户切到别的应用后，uid 处于 `PROCESS_STATE_FOREGROUND_SERVICE`，AOSP 对 `MODE_FOREGROUND` 的判定是「uidState ≤ FOREGROUND_SERVICE 即放行」，识别器可取麦。
- **只能打字**（每条都会走「条内文案 + 自动展开面板」，不静默）：
  1. `RECORD_AUDIO` 未授予（主包 `app.onethu.desktop` 实测 `ignore`）；
  2. 服务**不是**在前台时启动/没拿到 `microphone` 类型（开机自救、被 ROM 杀掉后恢复的路径；Android 14+/15+ 禁止后台加 while-in-use 类型，代码里已回滚兜底）；
  3. 系统没有语音识别服务（`isRecognitionAvailable()=false`）或识别器被占用（`ERROR_RECOGNIZER_BUSY`）；
  4. 运行时探针 2.5s 无电平 / 音频类错误（`ERROR_AUDIO`、`ERROR_INSUFFICIENT_PERMISSIONS`）= ROM 真拒了；
  5. 识别服务网络不可用（`ERROR_NETWORK`）。
- 也就是说：**「打开悬浮球」这一步在本体前台把麦克风权限拿到手，是长按能不能说话的关键前提**——这也是我把权限请求挂到 `overlayShow` 上的原因。

## 自检

- `./node_modules/.bin/tsc --noEmit -p apps/desktop/tsconfig.json` → **exit 0、零输出**（返工后重跑）。
- Kotlin 逐行自查（本机禁构建）：`SpeechRecognizer`/`RecognitionListener` 九个回调、`RadialGradient`/`RenderEffect`（API 31 守卫）/`setWillNotDraw`/`setLineSpacing`/`setRenderEffect`、`ActivityLifecycleCallbacks` 七个方法、`Service.onConfigurationChanged(Configuration)`、`requestPermissionForAliases` + `@PermissionCallback`（照 onethu-mobile 用法）逐个核对；大括号/圆括号平衡校验通过。
- 自查发现并修掉的问题：球/条窗口曾用 `raiseOrb()` 在面板打开时 remove+re-add（正确，因为已抬手）；面板长按计时误清全部回调；拖动位移按上一帧累加会飞球；`coerceIn` 下限；开机恢复沿用上次形态（会在开机后直接弹半屏雾）→ 已强制 ball。
- exFAT：`find <写域> -name '._*' -delete` 已执行，当前 0 个。未跑任何构建、未 git 写操作、未装机、未点屏。

## 需要 Lead 跑的验证

1. **Kotlin 编译**（只编本模块）：
   `cd apps/desktop/src-tauri/gen/android && ./gradlew :tauri-plugin-onethu-overlay:compileDebugKotlin`
   风险点：`ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE|MICROPHONE` 常量、`RenderEffect`/`setRenderEffect`（API 31，compileSdk 36 应无问题）、`@PermissionCallback` + `requestPermissionForAliases` 的名字与签名、`ContextThemeWrapper` 建 View。报错直接回给我。
2. 清单合并：`./gradlew :app:processArmDebugMainManifest` → 应看到 `SYSTEM_ALERT_WINDOW`、`RECORD_AUDIO`、`OverlayService(foregroundServiceType="specialUse|microphone")`、`OverlayBootReceiver`。
3. Rust 侧（若还没注册）：`src-tauri/Cargo.toml` + `src/lib.rs` 注册 + `capabilities` 加 `onethu-overlay:default`（task-3 报告 A 段有原文）。
4. 装机后只读取证（新 serial：`adb -s 'adb-AVAY025528004219-CeQTxu (2)._adb-tls-connect._tcp'`）：
   ```
   cmd appops get app.onethu.desktop.dev SYSTEM_ALERT_WINDOW
   cmd appops get app.onethu.desktop.dev RECORD_AUDIO
   dumpsys activity services app.onethu.desktop.dev | grep -A4 onethu.overlay
   dumpsys notification --noredact | grep -A6 onethu_overlay
   ```
5. **截图证明**（用户/Lead 要的）：先「桌面只有一颗 54dp 雾球」（不能有任何其他雾块）→ 点球「下半屏 46% 雾面板 + 裸文字 + 下划线输入行」→ 长按「语音条 + 波纹」→ 进 OneTHU 本体「球消失」。

## 需要 Lead 决策/知晓

1. **前端不再需要接线**：`submit`（原生面板/语音条的发送通道）由 `lib/overlayAndroid.ts` **自己消费**（`askOh` → `overlay_push_ui` 回推消息列表）。请**不要**再给 `GlobalOrb` 挂 `submit` 处理器（会双发），也不要在安卓上给它挂 `pushUi`（会与适配器抢消息列表）。
2. **`overlayShow()` 现在会弹麦克风授权框**（仅当未授权且本体在前台；拒绝也照样显示悬浮层）。如果设置页不想在这里弹，请告知，我改成「先只显示球、由用户在面板里触发放权」——但那会让「切到别的应用后长按说话」这条路径更难走通。
3. `overlay.ts` 的 `OverlayEvent` 联合类型**不必**再加 `submit`（适配器内部消费，TS 侧已清零 error）。
4. 安卓侧原生事件只余：`tap`（仅打开面板时）、`drag`、`submit`、`closed`。桌面适配器不受影响。
5. 若 App.tsx 在安卓上挂了 `GlobalOrb`，请按 ② 的建议收窄渲染条件。

## 真机才能验证的清单

1. 桌面上一开始**只有一颗球**（本条是 ③ 的验收核心，必须截图）。
2. 球是否 54dp、径向雾边缘是否羽化到透明（球外不该有任何方块感）。
3. 面板只占下半屏 46%、滑入 240ms 顺滑、上缘与四角羽化、面板外区域完全透明（能看清背后的壁纸/应用）。
4. 面板里消息是否裸文字（无气泡框）、用户消息 62% 不透明且右对齐、行高观感、输入行只有一条下划线。
5. 点球展开 / 再点球收起 / 「本次关闭悬浮球」三种关闭路径都成立，且关闭后不再自动出现。
6. 进 OneTHU 本体 → 球消失；退到桌面/别的应用 → 球回来（本体前台判定）。
7. 长按 ≥450ms 是否有触感 + 变条 + 波纹跳动；**松手是否整句发出**（看面板里出现右侧用户消息 + OH 回复）。
8. 上划 >110dp 是否显示「松开取消」且松手不发。
9. 若在其他应用前台时取不到麦：条内文案是否出现、1.4s 后是否自动展开面板（不要静默）。
10. 深色/浅色系统主题切换后雾与文字是否跟着变（`uiMode`）。
11. 通知：`悬浮球` 渠道、点击**不跳回 app**、「本次关闭」动作、通知文案随前台态变化。
12. FGS 是否稳定常驻；被一键清理/重启后是否只恢复成球。

## 风险与未做

- **Kotlin 未编译验证**：第一次 `compileDebugKotlin` 大概率会有零星 API/签名问题（风险点已在「需要 Lead 跑的验证」列出）。有任何报错贴给我，我立刻改。
- **语音只能真机定论**：`MODE_FOREGROUND` + FGS `microphone` 类型这条链路的最终结果必须在真机上试（代码已做到「能用则发、不能用则明确提示 + 转键盘」）。
- 跨应用实时模糊：第三方拿不到，**已彻底放弃**（这也是「全屏雾」最可能的元凶），雾面靠径向渐变 + 羽化 + RenderEffect 局部柔化。
- 面板「收起」不改变前端状态（原生形态权威）；前端 GlobalOrb 的 tap stale closure 建议 Lead 顺手修（`setMode(m => ...)` 函数式更新）。
- 附件入口（需求 6-8）仍未做（wave 2）。
- 未做：TTS 自动播报 OH 回复（ball-tts 的能力，接入点在 `askNative` 里一行 `speakReply`，需要跨写域，留给 Lead 决定）。
