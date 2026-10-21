# 语音 Agent 技术报告 × OneTHU 现状 · Phase 0 审计

> 审计日期：2026-10-09 · 审计对象：OneTHU `dev2`（43b8d27，v0.10.0 线）
> 输入文档：《技术开发报告：Tauri 2 跨平台语音 Agent》（下称"报告"）
> 结论性质：全部基于仓库实读、共享记忆与官方资料核实；外部数据采集日期 2026-10-09

---

## 0. 一页结论

1. **报告按"从零起步"的口径写，但 OneTHU 已完成其 Phase 1 全部与 Phase 2 主体。**
   文本 Agent 闭环（报告 Phase 1）= OneTHU Harness（OH）已于 0.10.0 上线：流式输出、打断、
   工具调用、多会话、token 预算、MCP、插件联动。STT 复用 + 手动语音入口（报告 Phase 2）=
   灵动岛长按语音已在 ChatDock 落地（macOS 全链路验证，Android `onethu-speech` 插件已并入 APK）。
2. **报告最大的口径偏差：Agent Core 不是 TypeScript 缺失项，而是已上线的 Rust 骨干。**
   `plugins/OneTHU-Harness/core`（agent/llm/session/tools/mcp/usage），桌面走 stdio sidecar、
   Android 由 `harness_embed.rs` 编进 App 进程。报告 §7 的 `src/core/*.ts` 目录结构整体不适用。
3. **LLM 接入早已解决且超出报告预期**：清华 MadModel 免费档（校园网免登录 DeepSeek-V4-Flash，
   校外 webvpn 通道）+ 任意 OpenAI 兼容自费 API，插件设置页下拉切换。报告 §6 的"API 密钥"章节
   仅剩"不打包固定 Key"这一条尚待长期遵守。
4. **真正的增量只有三块，全部是零基础**：本地 TTS、唤醒词、常驻监听前台服务
   （`onethu-mobile` 的 `QrKeepAliveService` 有 DATA_SYNC 前台服务先例，可参考）。
5. **唤醒词选型建议与报告不同**：Porcupine 确认支持普通话自定义唤醒词（Console 自助训练
   .ppn），但 AccessKey + 专有许可与 OneTHU 开源、面向全校免费分发的定位冲突。
   建议 **sherpa-onnx KWS 为主路线**（Apache-2.0、开放词表：换唤醒词只改 keywords.txt 零训练、
   与 TTS 同一个库一次集成），Porcupine 作为准确率对照组。
6. **报告勘误**（详见 §7）：aishell3"约 29 MB"实为 icefall 变体（tarball 实测 30.1 MB、8 kHz）；
   完整版 vits-zh-aishell3 为 116 MB（tarball 140.1 MB）；Kokoro int8 实测 140.2 MB。
7. **环境**：2026-10-08 已整体迁移至 `/Volumes/OneTHUBuild` 编译盘（oh-build.sparsebundle）。
   本次审计已重新挂载并验证 cargo/rustc 1.99.0、NDK 27.1.12297006、SDK 全套正常；
   修复了 `~/onethu-android/local.properties` 的 sdk.dir 旧路径。**当前无 adb 设备在线**——
   真机验证需先连接 Honor 手机。

---

## 1. 报告假设 vs OneTHU 实际（逐条对照）

| # | 报告的假设/要求 | OneTHU 实际 | 处置 |
|---|---|---|---|
| 1 | 新建 `my-agent` 项目，从零搭 Tauri 2 | 成熟 monorepo（packages/core、info-lib、ui + apps/desktop），Tauri 2 + Vite + React + pnpm，三端发布中 | 不新建；在现有仓库增量开发 |
| 2 | TypeScript Agent Core（agent.ts/llm-client.ts/…） | Rust 骨干 OH（独立子模块仓库），桌面 sidecar / Android 内嵌双形态；前端 ChatDock 是纯宿主胶水（JSON-RPC run） | 不重写。语音编排放 TS 侧新增 voice 模块或经 OH host 通道扩展 |
| 3 | LLM 通过可配置 API 访问（待实现） | MadModel 免费档 + 自费 OpenAI 兼容双通道已上线，含校外 webvpn、价格预算熔断 | 已完成，仅保留"不得打包固定 Key"纪律 |
| 4 | 复用已有 STT 模块（待定位） | `src/lib/speech.ts` + `onethu-speech` Kotlin 插件（Android 系统 SpeechRecognizer，zh-CN 会话式 start/poll/stop）+ macOS `speech.m`（SFSpeechRecognizer）。链路已接 ChatDock | 满足；Android 真机端到端验证为 Phase 1 首项 |
| 5 | 手动语音入口备用 | 灵动岛长按 450ms 语音（遮罩实时转写、松手填入不自动发送）即此入口 | 已存在 |
| 6 | 自定义唤醒词（Porcupine 优先评估） | 零基础 | Phase 3；建议 sherpa-onnx KWS 优先（§3.2） |
| 7 | 本地 TTS（sherpa-onnx 优先） | 零基础（全仓库无 TTS/朗读代码） | Phase 2；集成路径建议直接内嵌（§3.3） |
| 8 | MCP / Skills 分阶段、不阻塞闭环 | MCP 已实现（`core/src/mcp.rs`，stdio 冷启动）；插件联动、UI 通道、结构化结果均已上线 | 报告 Phase 6 的 MCP 部分可划掉 |
| 9 | §7 建议目录结构 `plugins/voice-android/` | OneTHU 有自己的 Tauri 移动插件规范：`apps/desktop/src-tauri/plugins/<name>/{android,src,guest-js…}`，已有 onethu-speech / onethu-mobile / onethu-calendar 三个样板 | 沿用现有规范，新插件建议命名 `onethu-voice` |
| 10 | Phase 1 文本 Agent 闭环 | 0.10.0 已发布（含 OH） | 已完成；重新定义为"Android 真机文本+语音闭环验证" |
| 11 | 不替换系统助手、优雅降级 | 未涉及默认助理，符合 | 维持 |
| 12 | SQLite 本地持久化 | 现有 localStorage + 插件 settings + Rust 侧会话存储；无 SQLite 依赖 | 首期不引入 SQLite，避免无谓增重 |

---

## 2. 已有资产盘点

### 2.1 STT（报告 §4.3 的"现有模块"）

- **契约**（四命令，跨平台一致）：`speech_supported` / `speech_start` / `speech_poll`（部分转写）/ `speech_stop`（收最终文本）。命令名按平台路由：Android → `plugin:onethu-speech|*`，其余 → app crate。
- **Android 实现** `plugins/onethu-speech/.../OnethuSpeechPlugin.kt`（165 行）：
  系统 `SpeechRecognizer`，zh-CN + EXTRA_PARTIAL_RESULTS，主线程运行；识别器静音超时且仍在按住
  时自动重启一轮（支持停顿换气）；权限拒绝 reject 带原因。`RECORD_AUDIO` 已在插件 manifest 声明。
  **注意**：Activity 作用域、无前台服务——只在 WebView 存活期可用，这正好是唤醒词方案要补的层。
- **macOS 实现** `src-tauri/native/speech.m`：SFSpeechRecognizer + AVAudioEngine，已全链路验证
  （含"识别任务必须先于首帧创建"等实测结论，记忆库存档）。
- **前端链路** ChatDock.tsx：长按 450ms → speechStart → 180ms 轮询 → 松手 320ms 宽限取 final →
  newSession + 填入输入框（不自动发送）→ 用户回车走 `callRust(id, "run", …)` 进 OH。
- **已知风险**：Android 系统 SpeechRecognizer 的可用性与云/本地属性取决于 ROM 识别服务
  （无 GMS 的 Honor/Huawei 机器行为待真机确认）——列为 Phase 1 首要验证项。

### 2.2 Agent Core（OH）

- `plugins/OneTHU-Harness`（git 子模块，独立仓库 smartThise/OneTHU-Harness）：`core/src/` 含
  agent.rs（主控循环）、llm.rs（ureq HTTP）、session.rs、tools.rs（校园工具 + 插件联动 +
  mcp_* 前缀分发）、mcp.rs、madmodel.rs、usage.rs（预算）。宿主无关设计，可编进 App 或 sidecar。
- Android 形态：`src-tauri/src/harness_embed.rs`——`harness_start/call/notify/rpc_reply/stop`
  命令桥 + agent 线程 + 门面桥（`onethu.call` 事件 → webview 执行 → 回写）。
- 前端 `plugins/rust.ts`：桌面 spawn 二进制 / 移动 `startHarnessEmbedded`，统一 `callRust`。
- 权限门禁：manifest 26 项权限（user:read … llm、plugins:call、mail/cloud 读写），所有工具
  调用过 `gate()`；写操作两段式确认。报告 §6"工具执行权限边界"已满足且更严格。

### 2.3 LLM 接入（记忆库存档，2026-09-19 实测）

- 免费档：`https://madmodel.cs.tsinghua.edu.cn/v1`，模型 DeepSeek-V4-Flash-0731（150k ctx），
  校园网免登录签 6h JWT（JS 泵 `src/state/madmodel.ts` 管理，Rust 每次 run 实时读 settings）；
  校外 307 → 自动升级 SSO + webvpn 包装通道。免费档 price=0 不触发预算熔断。
- 自费档：任意 OpenAI 兼容 base+key+model。
- 结论：报告 §6 的 LLM 需求全部已满足；"API 密钥"一节只剩分发纪律（APK 内不得固化 Key——现状即如此）。

### 2.4 UI 与语音交互（ChatDock 灵动岛）

底部中央胶囊（智能文本：临近日程/作业提醒/默认文案）→ 点击展开 50vh 面板 → 长按语音。
会话切换、上下文导出、用量显示、思考链/工具链折叠回看、watchdog 与迟到事件丢弃（R10）等
成熟度远超报告 §10 对 UI 的要求。**TTS 朗读开关将是该面板上新增的第一个语音输出能力。**

### 2.5 Android 工程与构建管线

- `gen/android` → symlink `~/onethu-android`（内盘 APFS，规避 exFAT AppleDouble 坑）；
  minSdk 24 / target/compileSdk 36；正式标识 `app.onethu.desktop`。
- `apps/desktop/scripts/build-release-apk.sh`：发布线不变量校验 → rootDirRel 绝对化 →
  符号链接就位 → NDK 交叉编译（env 已适配新 SDK 路径）→ gradle → zipalign/apksigner。
- 签名：keystore `/Volumes/PortableSSD/Projects/thuapp/OneTHU-signing/`（记忆库存档）。
- 产物：arm64 ≈12MB 主包 / universal ≈39MB。
- 已知坑全部记忆在案：手动 cargo 必须带 `--features tauri/custom-protocol`（0.7.2 事故）、
  exFAT 不放构建产物、CARGO_TARGET_DIR 指编译盘。

### 2.6 前台服务先例

`onethu-mobile/.../QrKeepAliveService.kt`：通知渠道 + `startForeground(FOREGROUND_SERVICE_TYPE_DATA_SYNC)`，
幂等 onStartCommand。**唤醒词监听服务可复制此骨架**，但需换 `microphone` 服务类型并补
`FOREGROUND_SERVICE_MICROPHONE` 权限（当前 app manifest 只有 DATA_SYNC 两项，见 §3.4）。

---

## 3. 外部核实（报告 §12 任务 3/4 的调研部分，2026-10-09 采集）

### 3.1 Porcupine（报告首选）

- **普通话自定义唤醒词：确认支持。** 官方仓库 README"Language Support"明列
  English, Chinese (Mandarin), French, … 九语；自定义词经 Picovoice Console 自助训练生成 .ppn。
- Android SDK：`ai.picovoice:porcupine-android`（Maven Central），v4.0.0（2025-12-11）。
  官方 demo 齐全，含 **Service demo（长驻前台服务唤醒）** 与 **STT demo（唤醒→识别交接）**——
  与报告 §4.1 设想的流程完全对齐，工程参考价值高。
- **授权是实质障碍**：运行必需 AccessKey；免费档限个人/评估，向全校分发 APK 属商业性分发，
  需付费许可。OneTHU 是 MIT（禁商用）开源项目 → **不可作为主路线**。报告 §4.1 的担忧成立。
- 结论：降级为**对照组**（个人 AccessKey 评估准确率差距，供参考），不进入发布链路。

### 3.2 更优主路线：sherpa-onnx KWS（报告未覆盖）

- **开放词表唤醒**：唤醒词 = keywords.txt 一行文本（`sherpa-onnx-cli text2token --tokens-type
  ppinyin` 把"你好小欧"转成拼音 token 序列），**换词零训练**；每词可调 boosting score 与
  trigger threshold（触发率/误报权衡）。
- 模型（均可商用的 Apache-2.0 生态）：
  - `sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01`（纯中文，WenetSpeech 1 万小时）：
    int8 总计 ≈5 MB（encoder 4.6M + decoder 177K + joiner 64K）；
  - `sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20`（中英，2025-12 新）：int8 encoder 4.4 MB，
    streaming chunk-8 延迟 160ms / chunk-16 320ms（低延迟档精度略降）。
- 有官方 Android KWS APK 可直接装真机体验；与 TTS 同一 sherpa-onnx JNI → **一次集成双能力**。
- 权衡：误唤醒率大概率高于 Porcupine（无公开同条件基准），必须真机实测
  （报告 §10"唤醒准确率与误触发"表格照做）。
- 麦克风接口：KWS 吃 AudioRecord PCM 流（16k/mono/16bit）——与 SpeechRecognizer（自管录音）
  的交接 = 停 KWS 的 AudioRecord → 起 SpeechRecognizer → 结束后恢复，报告 §4.1 流程可直接映射。

### 3.3 TTS 候选核实（官方文档 + Release API 实测 tarball 体积）

| 模型 | 语言/说话人 | 采样率 | 实测体积 | 备注 |
|---|---|---|---|---|
| vits-icefall-zh-aishell3 | 中 / 174 spk | 8 kHz | **30.1 MB** | 报告"29MB"的出处；音质上限低，仅作极轻量验证档 |
| vits-zh-aishell3（完整版） | 中 / 174 spk | 8 kHz | 140.1 MB | 报告未区分的两个 aishell3 |
| **vits-melo-tts-zh_en** | 中英 / 1 spk | 44.1 kHz | **159.3 MB** | 生态最成熟；自带 date/number fst 数字日期归一化；RPi4 RTF 2.5@4 线程（手机 SoC 显著更快） |
| kokoro-multi-lang-v1_1 **int8** | 中英等 / 103 spk（含 8 个中文音色 zf_/zm_） | 24 kHz | **140.2 MB** | 音色多、自然度好；fp32 347.9 MB 不考虑；内存峰值需真机测 |
| vits-zh-hf-fanchen-C 等 HF 系 | 中 / 187 spk | 16 kHz | ≈116 MB | 备选 |

- **建议双候选真机对比：melo（首选）vs kokoro-int8（音色档）**；icefall-aishell3 仅用于打通
  管线的烟雾档。数字/日期朗读（作业截止时间场景高频）melo/kokoro 自带 fst 归一化，aishell3 无。
- **集成路径：直接内嵌**（报告二选一中的方案二）。理由：(a) OneTHU 已有三个 Tauri 移动插件
  样板，复制 onethu-speech 骨架即可；(b) TTS Engine APK 无法与 App 内生命周期、模型下载、
  播放事件统一管理，且系统 TTS 引擎切换依赖用户手动设置。仍按报告要求：先用官方
  TTS APK 在真机试听候选音质、录性能表，再决定内嵌默认模型。

### 3.4 Android 系统约束（targetSdk 36 下的硬要求）

- 前台服务类型强制（API 34+）：唤醒监听服务须 `android:foregroundServiceType="microphone"` +
  `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_MICROPHONE` 三件套；当前 manifest 只有
  DATA_SYNC（QrKeepAliveService 在用），需新增。
- 麦克风 FGS 的 while-in-use 限制：不得从后台拉起 mic FGS；用户须前台主动开启（与报告
  "用户主动开启唤醒监听"一致）。锁屏/熄屏下持续监听受厂商策略影响——维持报告"非目标"口径。
- SpeechRecognizer 与 KWS 的 AudioRecord 抢占：交接协议 = 停 KWS → 识别 → 恢复（§3.2）。
- 与系统助手（小艺等）共存：无先验数据，真机实测并记录（报告 §8.2）。

---

## 4. 环境审计（Phase 0 交付）

| 项 | 状态 | 说明 |
|---|---|---|
| Node 22.22.1 / pnpm 10.33.0 | ✅ | |
| JDK 17.0.18 | ✅ | gradle 钉死 openjdk@17 |
| Rust cargo/rustc 1.99.0 | ✅ | 编译盘 `cargo-home`（本次已挂载验证） |
| Android SDK（build-tools 36/平台/模拟器） | ✅ | `/Volumes/OneTHUBuild/oh-android-sdk` |
| NDK 27.1.12297006 | ✅ | 与既有签名管线一致 |
| gradle 工程 `~/onethu-android` | ✅ | local.properties sdk.dir 已由本审计修正指向编译盘 |
| adb 设备 | ⚠️ **无设备在线** | 需连接目标真机（Honor） |
| exFAT 构建坑 | ✅ 已制度化 | 一律走 build-release-apk.sh；target 在编译盘 |

**2026-10-08 迁移背景**（本次审计核实）：移动工具链整体迁入 `oh-build.sparsebundle`
（APFS，/Volumes/OneTHUBuild）：SDK/NDK→oh-android-sdk、Gradle→gradle-home、
Rust→cargo-home+rustup-home；`~/.zshenv` 全部指好；`dev-launch.sh` 带自动挂载。
**唯一新依赖：SSD 未插/未挂载则不能编译。** 本次会话已手动挂载
（`hdiutil attach /Volumes/PortableSSD/oh-build.sparsebundle -mountpoint /Volumes/OneTHUBuild -nobrowse`）。

---

## 5. 风险清单（按影响排序）

1. **Android 系统 STT 在目标 Honor 真机的可用性未知**：无 GMS ROM 的 SpeechRecognizer
   服务来源（HMS/厂商自研/缺失）、云端 or 本地、弱网行为——Phase 1 第一项实测；若不可用，
   备选 = sherpa-onnx ASR 流式模型接管识别（同库扩展，代价是新管线）。
2. **KWS 误唤醒率未实测**：3M zipformer 小模型 + 开放词表，需按报告 §10 做定量记录；
   阈值/boosting 可调是兜底。
3. **TTS 内存峰值**：kokoro int8 140 MB 模型 + onnxruntime 常驻内存，低端机风险；
   melo 159 MB 同理。首版必须记录冷启动/峰值/合成耗时（报告 §10 表格）。
4. **麦克风交接复杂度**：KWS(AudioRecord) ↔ SpeechRecognizer 互斥，外加 TTS 播放期回声
   （TTS 播放时必须暂停 KWS，否则自唤醒）。
5. **锁屏监听厂商限制**：维持报告非目标口径；文档明示降级行为。
6. **Porcupine 授权**：已规避（不作主路线）。
7. **构建环境单点**：SSD 未挂载即不可编译——已由 dev-launch.sh 自动挂载 + 本审计流程覆盖。

---

## 6. 修正后的分阶段计划

### Phase 1（原报告 Phase 1+2 收尾）——Android 真机文本+语音闭环验证 ⏱ 0.5~1 天

1. 连接 Honor 真机（adb），安装最新 0.10.0 APK（`~/Desktop/OneTHU-builds` 或重建）。
2. OH 填入自费 Key 或校园网 MadModel 免费档 → 验证文本对话：流式、打断、工具调用（查课表）。
3. 长按灵动岛 → 验证 onethu-speech：`isRecognitionAvailable` 返回值、长按转写实时性、
   松手 final 文本、权限拒绝文案；记录识别走云 or 本地（飞行模式对照）。
4. 产出：真机实测记录（型号/ROM/Android 版本/行为）进报告 §10 性能表。

**验收：真机完成 说话→转写→发送→流式回答 全链路；Android STT 可用性结论落档。**
（此项无需写代码——纯验证。若 STT 不可用，当场评估 sherpa-onnx ASR 备选并出报告。）

### Phase 2——本地 TTS（对应原报告 Phase 3）⏱ 3~5 天

1. 真机装官方 sherpa-onnx TTS APK 试听 melo 与 kokoro-int8 中文样例 → 定默认模型。
2. 新插件 `apps/desktop/src-tauri/plugins/onethu-voice/`（骨架复制 onethu-speech）：
   - Kotlin：sherpa-onnx JNI（官方预编译 android AAR/JNI 库）+ AudioTrack 播放；
   - 命令：`tts_init/tts_speak/tts_stop/tts_status`（对齐报告 §5.3 接口）+ 语速/speakerId 参数；
   - 模型下载到应用私有目录（`filesDir/models/tts/`），sha256 完整性校验，失败重试/删除恢复。
3. ChatDock：回答落定后朗读（设置开关，默认关）；朗读中可 stop；与语音输入互斥。
4. 断网验证 + 资源泄漏压测（连续 20 次合成/停止）+ 性能表（冷启动/内存峰值/合成耗时/体积）。

### Phase 3——唤醒词（对应原报告 Phase 4，改 KWS 主路线）⏱ 3~5 天

1. `onethu-voice` 插件内加 KWS：sherpa-onnx keyword spotter + keywords.txt（初版词如
   "你好小欧"，text2token 生成，真机可改词验证零训练换词）。
2. `WakeService`（复制 QrKeepAliveService 骨架，换 microphone FGS 类型三件套）+ AudioRecord
   16k 单声道喂 KWS；唤醒事件 → Tauri event → 前端。
3. 交接状态机：IDLE → LISTENING(KWS) → RECOGNIZING(SpeechRecognizer) → SPEAKING(TTS，KWS 暂停)
   → 恢复 LISTENING；权限拒绝/服务被杀/模型缺失均有恢复入口与明确提示。
4. 误唤醒定量记录（阈值扫描）+ 锁屏/切后台/省电模式行为 + 与系统助手共存实测。
5. （可选）Porcupine 个人 AccessKey 对照评测准确率，只记数据不进发布链路。

### Phase 4——设置与稳定性（对应原报告 Phase 5）

语速滑块、说话人选择（kokoro 8 个中文音色/melo 单音色）、模型管理（下载/切换/清理）、
监听开关持久化；全部设置必须驱动真实音频参数（报告 §5.4 红线）。

---

## 7. 报告原文勘误表

| 位置 | 原文 | 事实 |
|---|---|---|
| §5.2 候选 A | AISHELL3 VITS"约 29 MB" | icefall 变体 tarball 30.1 MB（8 kHz）；完整 vits-zh-aishell3 116 MB/140.1 MB tarball。8 kHz 音质不适合最终产品——与报告"不应预设音质达标"一致，现已实测坐实 |
| §5.2 候选 B | Kokoro"需要核实实际大小" | 已核实：v1_1 int8 = 140.2 MB、fp32 = 347.9 MB；24 kHz；103 说话人含 8 中文音色；Apache-2.0 |
| §3 技术栈 | TypeScript Agent Core 待建 | OneTHU 为 Rust 骨干（OH），已上线；TS 侧只做宿主胶水 |
| §7 目录结构 | `plugins/voice-android`、`src/core/*.ts` | 应沿用 OneTHU 插件规范 `apps/desktop/src-tauri/plugins/onethu-voice`；core 不新建 |
| §9 Phase 1/2 | 待实现 | 已完成（0.10.0）+ macOS 全链路验证；Android 真机收尾即可 |
| §9 Phase 6 | MCP 待扩展 | MCP 已实现（stdio 冷启动） |
| §4.1 | Porcupine 可用性未确认 | 已确认支持普通话自定义词；但授权与开源分发冲突 → 主路线改 sherpa-onnx KWS |


---

## 8. KWS 实施规划（定稿，2026-10-09）

> 前提确认：sherpa-onnx 提供 `KeywordSpotter.kt` Kotlin API 与 `SherpaOnnxKws` 官方 Android demo
> （另有 `SherpaOnnxAar` AAR 打包参考、`SherpaOnnxTts`/`SherpaOnnxTtsEngine`）。以下规划接口级可落地。

### 8.0 集成底座（TTS 与 KWS 共享）

- **插件**：新建 `apps/desktop/src-tauri/plugins/onethu-voice/`（骨架复制 onethu-speech：Rust
  commands 转发 `run_mobile_plugin` + Kotlin 插件类 + permissions toml）。
- **JNI 引入**：拷官方 Kotlin API 源文件（KeywordSpotter.kt / FeatureConfig.kt / OnlineStream.kt
  等少数几个）+ 从官方 release 下载预编译 `libsherpa-onnx-jni.so`/`libonnxruntime.so` 放
  `jniLibs/arm64-v8a`（与现有 arm64 主线一致；版本钉死 + sha256 记录入库）。
  不引 NDK 编译链，不装 Maven AAR（官方未发布）。
- **模型**：首版 `kws-zipformer-wenetspeech-3.3M int8`（encoder/decoder/joiner ≈5MB + tokens.txt）
  打进 assets；keywords.txt 预生成（构建机 text2token ppinyin），首版词"你好小欧"。
  备选模型 `kws-zipformer-zh-en-3M-2025-12-20`（chunk-8 延迟 160ms），M0 双模型对比。
- TTS（Phase 2）后续挂同一插件的 `tts_*` 命令面，共用 JNI 与 onnxruntime——底座本节一次建成。

### 8.1 TS 命令契约（对齐报告 §4.2 WakeEngine）

```
wake_supported() -> boolean
wake_start() / wake_stop()
wake_status() -> { state: "idle"|"listening"|"handoff", keyword, threshold }
事件：onethu-voice://wake  { keyword, timestamp }
     onethu-voice://state { from, to }
```

TS 侧新增 `src/lib/wake.ts`（与 speech.ts 同款命令路由 `plugin:onethu-voice|*`），
不实现任何持续监听——监听全在原生层（报告 §4.2 红线）。

### 8.2 前台服务与麦克风仲裁

- `WakeWordService`：复制 QrKeepAliveService 骨干，改 `foregroundServiceType="microphone"`，
  manifest 补 `FOREGROUND_SERVICE_MICROPHONE`；AudioRecord 16k/mono/16bit 喂 KeywordSpotter。
- 通知：常驻"唤醒监听中" + 停止 action；仅用户前台主动开启（while-in-use 约束），不做开机自启。
- **状态机（Kotlin 侧唯一仲裁，TS 订阅 state 事件）**：

```
IDLE → LISTENING → [唤醒] HANDOFF(停KWS→起SpeechRecognizer)
     → RECOGNIZING → [final] PROCESSING(OH run，KWS 保持停)
     → [有TTS] SPEAKING → [播完] LISTENING；[无TTS] → LISTENING
```

- 关键规则：SPEAKING 期间 KWS 必停（TTS 音频进麦会自唤醒）；手动长按语音优先于 KWS
  （LISTENING 时先暂停）；SpeechRecognizer 结束后才恢复监听。

### 8.3 里程碑（合计 ≈1 周）

| # | 内容 | 产出/闸门 |
|---|---|---|
| M0 | 真机 PoC（0.5 天，不动主仓库）：装官方 SherpaOnnxKws APK（界面可改关键词），Honor 实测"你好小欧"两模型 × 阈值扫描 | **决策闸门**：唤醒率 ≥95%、安静误报 ≤1 次/天 量级。不达标 → 换叠词（"小欧小欧"）/换模型/再议 |
| M1 | 插件骨架 + KWS 引擎（1 天）：jniLibs 接入、wake_* 命令、app 前台界面内手动开关验证事件到 TS | 唤醒事件在真机 ChatDock 可见 |
| M2 | WakeWordService（1 天）：microphone FGS、通知、权限流、被杀后重进恢复 | 后台持续监听 ≥1h 不掉 |
| M3 | 交接状态机 + ChatDock 联动（1-2 天）：唤醒→STT→OH 全链路、防自触发、灵动岛状态 | 报告 §10 语音体验验收项 |
| M4 | 稳定性与设置（1-2 天）：锁屏/省电/共存实测表；阈值设置；关键词预设词表（借官方 demo 的 Kotlin 拼音转换） | 报告 §10 后台/性能验收项 |

### 8.4 风险与备选

- M0 不达标：① zh-en-3M-2025-12-20 + 阈值/boosting 调优；② 叠词词形；③ Porcupine 对照
  （个人 AccessKey 只测数据），差距不可接受再重新评估。
- Honor 无可用 SpeechRecognizer（Phase 1 验出）：KWS 之后直接接 sherpa-onnx 流式 ASR
  （OnlineRecognizer，同 JNI 底座），M0 顺带装官方 SherpaOnnx ASR demo 预验。
- exFAT：插件源码在仓库内正常提交；jniLibs .so 二进制入 git（5-10MB 量级可接受），
  模型 assets 同理；构建产物照旧走编译盘。
