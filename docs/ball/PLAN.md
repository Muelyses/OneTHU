# Ball 分支作战计划（OH 全面改造）

> 单一口径文档：所有参与本轮的 agent 都读这一份。分支 `Ball`（内容 = `dev3`，`7ce6cbe`）。
> KWS 已出局：归档 tag `archive/dev-kws-20261010`（2884240），远端 `dev-kws` 已删，勿复活。

## 0. 铁律（违反即回滚）

1. **只改自己写域内的文件**（见 §4）。别人的文件只读。
2. **不许跑 git 写操作**（不 commit / 不 checkout / 不 reset / 不 stash / 不 push）。提交由 Lead 统一做。
   只读的 `git log/diff/show/status/grep` 随便用。
3. **不许跑全仓构建**（`pnpm build`、`tauri android build`、`gradle assemble*`、`cargo build`）：共享工作区里
   会互相踩。类型检查 `tsc --noEmit` 可以随便跑（只读）。需要真构建时找 Lead。
4. **不装依赖**（不 `pnpm add`、不 `cargo add`、不下载 SDK）。
5. 新文件也要能被 tsc 通过；交付前自己跑一遍 §5 的检查命令。
6. 发现别人写域里的 bug：写进自己的报告，别动手改。
7. **并发上限：全团队最多 Lead + 2 个 teammate 同时跑**（2026-10-10 实测：并发一高就把模型配额打成 429，
   一批 agent 直接失败、连收尾消息都没有）。排队顺序：ball-ui(task-1) → ball-tts(task-2) →
   ball-overlay-android(task-3) → ball-overlay-desktop(task-4) → ball-attach(task-5) → ball-action(task-6)。
   由 Lead 在有人交付/空出后用 send_message 唤醒下一个；被唤醒前保持 inactive 不要自己抢跑。
8. 不要派子 agent（subagent）——本会话的子 agent 并发同样吃配额，已连续失败多次；活由 teammate 与 Lead 干。

## 1. 目标（用户 2026-10-10 原话要点，8 条）

1. **应用内 OH 悬浮岛长按优化**（现在丑）：长按时岛**自然变长**，内容变成**随音量跳动的点点波纹**，
   上覆**一层雾状**，雾里显示**当前识别出的字**。
2. 长按结束，识别文本**不进输入框**，**作为完整一条消息直接喂给 OH**。
3. **单击悬浮岛**不再是「问点什么」输入框，改成一个按钮，文案「**点击输入，长按说话**」。
4. **语音合成（TTS）**：补齐链路 + UI，可选**静音 / 自动播放**她合成的话；**设置页**新增音效/音色调节。
5. **全局悬浮球**（Android + 桌面）：可浮在**其他应用上层**。桌面可拖任意位置，手机自动吸附边框；
   单击 → 当前页面**流畅滑到底部**展开**雾状**对话面板（输入框在最底部，也是「点击输入，长按说话」，
   上方约**半屏可滑动**的主对话消息、渐入渐出）；长按 → 伸展成条滑到底变**语音输入条**。
   **红线：OneTHU 在后台时一律不跳回 app 本体**（只有充值/付钱这种必须用户亲自操作的除外；
   预约确认不跳回；体育预约不可抗力、在线服务这类必须跳回的除外）。单击后雾状表面可**本次关闭悬浮球**，
   重新开启需回本体 OH 对话界面点开。
6. **OH 直接提交附件**：拍照 / 相册 / 上传三个入口，出现在**悬浮球打开后的位置**（IM Bot 附件已实现，可供参考）。
7. 附件可直接选动作：**转存云盘 / 交作业（雨课堂 + 网络学堂）/ 发讨论区** 等。
8. 内置**几种简单图像修复滤镜**（手写照片上传后简单编辑，别做复杂）。

## 2. 现状（已核实，省你重新摸）

- 应用内「OH 悬浮岛」= `apps/desktop/src/plugins/ChatDock.tsx`（1028 行，`ChatDock` 组件，**ball-ui 独占**）。
  相关：`state/island.ts`（岛文案 `ISLAND_DEFAULT_TEXT`/`computeIslandText`）、`lib/speech.ts`（STT：
  `speechAvailable/Start/Poll/Stop`，仅安卓有效）、`plugins/ChatDock.tsx:46` 的 `ohAsk(text)`（开面板并直接发送
  ——需求 2 的现成通道）、`styles/global.css` 里「OH 悬浮岛带」的留白（5514/5607 行附近）。
- ChatDock 现有语音态：`voice: "off" | "arming" | "listening" | "sending"`、`voiceText`、`voiceFail`、
  `VOICE_HOLD_MS = 450`、`VOICE_FINAL_GRACE_MS = 320`；启动路径在 769 行附近（`speechAvailable()` → `speechStart()`）。
- **dev3 完全没有 TTS**（全库 grep 零命中）→ 需求 4 是**新建**。参考实现（可读、勿直接拷 KWS 资产）：
  `git show archive/dev-kws-20261010:apps/desktop/src-tauri/plugins/onethu-voice/...`——
  `SystemTts.kt`（系统 TextToSpeech，音高/音色/语速真实生效）、`TtsEngine.kt`（sherpa 神经档）、
  `VoiceTts.kt`（双后端门面）。
- 插件先例：`apps/desktop/src-tauri/plugins/onethu-speech`（Rust 命令壳 + Kotlin 真实现 + permissions/*.toml）。
  **插件注册（Cargo.toml、src-tauri/src/lib.rs、capabilities、gen 权限）一律由 Lead 做**，你只管自己插件的目录内容。
- Android 侧已有：`plugins/onethu-mobile`（`QrKeepAliveService`、`OnethuNotify`、`OnethuWidget`、`RomInfo`），
  **没有任何 overlay / WindowManager / 悬浮窗代码** → 需求 5 安卓侧是全新能力。
- 设置页 = `apps/desktop/src/pages/Settings.tsx`（1851 行，分区组件模式：`NotifySettingsSection` /
  `WidgetSettingsSection` / `ImSettingsSection` + `SectionHead`）。**Settings.tsx 与 App.tsx 由 Lead 挂载**，
  你只新建 `components/VoiceSettingsSection.tsx` 这类独立文件。

## 3. 架构契约（跨 agent 的接口，先按这个写，改契约先找 Lead）

### 3.1 全局悬浮球（需求 5）—— 统一前端面 + 两套原生后端

- `apps/desktop/src/lib/overlay.ts`（**Lead 独占**）定义统一面：
  ```ts
  export type OverlayMode = "hidden" | "ball" | "bar" | "panel";
  export function overlaySupported(): Promise<boolean>;
  export function overlayShow(): Promise<void>;      // 显示球
  export function overlayHide(): Promise<void>;      // 本次关闭（需求 5 的「本次关闭悬浮球」）
  export function overlaySetMode(m: OverlayMode): Promise<void>;
  export function onOverlayEvent(cb: (e: { type: "tap" | "hold" | "release" | "drag" | "closed" }) => void): Promise<() => void>;
  ```
- 平台适配器：`lib/overlayAndroid.ts`（ball-overlay-android 独占）、`lib/overlayDesktop.ts`（ball-overlay-desktop 独占）。
  两者都实现上面同名函数，`overlay.ts` 只做平台分发。
- 前端浮层 UI（雾状面板/条/球）由 **Lead** 在 `components/GlobalOrb.tsx` 里做，两平台共用；
  原生侧只负责：创建/销毁窗口或系统悬浮窗、把尺寸位置模式告诉前端、把触摸手势（tap/hold/drag/release）回传。
- **红线落地方式**：悬浮窗内的对话走 `askOh()`（`im/oh.ts`）等纯前端通道，任何路径都**不得**调用
  打开主窗口的 API（`WebviewWindow.show()`/`set_focus()`/`app.show()`/跳 Android Activity）。

### 3.2 TTS（需求 4）

- Rust 命令面（Tauri 命令，前端 `lib/tts.ts` 包装）：`tts_supported`、`tts_prepare`、`tts_speak`
  （`{text, speed, pitch, voice}`）、`tts_stop`、`tts_status`（`{ready, backend, state}`）、`tts_voices`、
  `tts_set_backend`；事件 `onethu-tts://done {reason}`。
- 偏好存储：`state/voicePrefs.ts`（localStorage，与仓库既有偏好存储风格一致）：
  `{ autoSpeak: boolean; voiceName: string; pitch: number; rate: number; backend: "system" | "neural" }`。
  **默认 `autoSpeak=false`（静音）**——用户要求「可以选择静音或者自动播放」。
- ChatDock 侧接入由 ball-ui 负责：`import { speakReply } from "../lib/tts.js"`（ball-tts 导出）。

### 3.3 附件（需求 6-8，wave 2）

- `lib/attach.ts`：`pickCamera()/pickGallery()/pickFile(): Promise<AttachFile | null>`，
  `AttachFile = { path: string; name: string; mime: string; size: number; previewUrl?: string }`；
  `sendToOh(files: AttachFile[], text?: string): Promise<void>`。
- `lib/attachActions.ts`：`saveToCloud(f)`、`submitHomework(f, ctx)`（`ctx.platform: "learn" | "ykt"`）、
  `postDiscussion(f, ctx)`。wave 2 由 ball-attach 实现，Lead 出骨架。

## 4. 写域表（唯一权威；重叠即停下找 Lead）

| 路径 | 归属 |
|---|---|
| `apps/desktop/src/plugins/ChatDock.tsx`、`state/island.ts`、`lib/speech.ts`、`styles/global.css` | **ball-ui** |
| `src-tauri/plugins/onethu-tts/**`、`src/lib/tts.ts`、`src/state/voicePrefs.ts`、`src/components/VoiceSettingsSection.tsx` | **ball-tts** |
| `src-tauri/plugins/onethu-overlay/**`（Android Kotlin + Rust 壳）、`src/lib/overlayAndroid.ts` | **ball-overlay-android** |
| `src-tauri/src/overlay_win.rs`（新文件）、`src/lib/overlayDesktop.ts` | **ball-overlay-desktop** |
| `src/pages/Settings.tsx`、`src/App.tsx`、`src-tauri/Cargo.toml`、`src-tauri/src/lib.rs`、`capabilities/*`、`gen/*`、`docs/ball/**` | **Lead** |
| `lib/overlay.ts`、`components/GlobalOrb.tsx` | **Lead** |
| `lib/attach.ts`、`lib/imageFilters.ts`、`components/AttachTray.tsx`、`components/ImageFilterSheet.tsx` | **ball-attach**（已交付） |
| `lib/attachActions.ts`、`components/AttachActionsSheet.tsx` | **ball-action**（已交付） |
| `docs/im-cloud/**`、`docs/memory-cloud/**`、`plugins/OneTHU-Harness/**` | 别人（别碰） |

## 5. 自检命令（交付前必跑，只读）

```bash
cd /Volumes/PortableSSD/Projects/thuapp/OneTHU
./node_modules/.bin/tsc --noEmit -p apps/desktop/tsconfig.json
```
Kotlin / Rust 无法在本机单独快跑：写完后**逐行自查**语法与 API 拼写，并在报告里列出「需要 Lead 跑 gradle/cargo 验证的点」。

## 6. 已知坑（都踩过）

- **exFAT AppleDouble**：本仓库挂在 exFAT 上，新建/修改文件会生成 `._同名` 伴生文件，tauri 的 build.rs
  扫 capabilities/permissions 时读到会炸（`stream did not contain valid UTF-8`）。新建目录/文件后
  `find <你的目录> -name '._*' -delete`。
- **write 工具在本仓 exFAT 上会 ENOTSUP**（原子重命名/硬链接不支持）→ 新文件用 bash heredoc 写。
- **`invoke.getArgs().optString(key, default)`**（Kotlin 侧没有 `getString`）；Tauri Android 插件参数类要
  `@InvokeArg`，否则 release 下 R8 报 `no Creators`。
- **AudioRecord**：`acceptWaveform` 吃 `FloatArray`（-1..1）；阻塞 `read()` 在静默态会卡死线程；
  荣耀/华为是「仅前台麦克风」，后台/锁屏会被静默且回前台不自愈。
- **前台服务类型**：Android 14+ 每种 FGS 类型有额度限制（本仓库曾因 `dataSync` 超限崩溃）。
- 荣耀真机：`adb -s 192.168.31.31:34751`（有两个 transport，必须 `-s`）；`adb logcat` 被华为滤掉，
  取证靠 `dumpsys usagestats` / `cmd appops get <pkg> RECORD_AUDIO` / `dumpsys notification --noredact`。

## 7. 报告格式（每个 agent 交付时用）

```
## 状态：完成 / 部分完成 / 阻塞
## 改动文件：<path>（+/- 行数）
## 实现了什么（需求条目编号对应）
## 自检：tsc 结果（贴关键输出）/ 其他
## 需要 Lead 做的：注册/构建/决策点
## 风险与未做：明确列出
```
