# 系统日历同步审查与修复（2026-10-20）

基线：`exp / 493378e4`。范围为 `state/systemCal.ts` 与 `onethu-calendar` 原生插件；邮箱、CalDAV 协议和模式设置由本轮其他任务负责。本次没有请求学校接口，没有读取用户系统事件，也没有写入真实系统日历。

## 已确认的问题及修复

| 问题 | 修复与实际行为 |
| --- | --- |
| 配置读取尚未完成就标记 loaded；停止/开启可能被迟到读取覆盖；同步结束未广播 idle | 配置读取共享 Promise，成功后才 ready；严格文件 I/O，不将读错当空文件。开始和结束均广播状态。 |
| 冷启动缺校历/学堂/外部源，或云镜像尚未恢复时生成半量载荷 | 等待 `ensureCloudCalMirrorReady()`，包括在途云写入结束及旧缓存的账号验证。当前学期校历、学堂快照、已配置外部作业源必须完整；历史学期快照、外部源失败和非法时段均阻止覆盖。 |
| 周窗碎屑冒充完整学期；二级课表失败后把一级结果覆盖完整缓存 | 新 `syscal-sem-v3:<semesterId>` 缓存只存一级、二级都成功的结果；起始日与周数必须匹配。失败仅回退该学期完整缓存；空学期成功结果也可缓存，不采用旧碎屑。 |
| 已上云的课程/考试/作业又与实时源重复写入 | 系统镜像过滤云/本列表中 `onethuSource=course/exam/homework`，由实时源统一生成；普通手动云/本日程保留已有提醒。 |
| 作业事件已提前 N 分钟开始，闹钟又相对开始提前 N 分钟 | 作业块保留原起止语义，原生闹钟改为开始时 `0` 分钟。Android 支持零分钟提醒。非法提前量回退/夹紧；长提前量纳入同步窗口。 |
| 忽略、旁听与重复作业仍可能生成提醒 | 排除已提交、已忽略、旁听项，按作业 ID 去重；订阅忽略/恢复及外部 audited 变化。 |
| 移除与在途写入并行，删除后可被重建；停止后的 enable 完成可能重新开启 | 同步单飞；停止使未进入原生的旧轮失效，原生已开始则等待真实结束。移除先停止、等待在途同步，再删除。后续自动任务不能复活。同步中的来源变化只排一次补同步。 |
| macOS 按标题清理所有账户同名日历及删除所有同名日历 | 私有 `system-calendar-binding.json` 保存原生日历 ID，只查询、清理和移除此 ID；不用同名推定所有权。每次同步记录旧、新窗口并集，长于四年的查询分段执行。 |
| Android 先删旧事件再分批插入，一处失败就留下不完整日历 | 先分批插入全部替代事件；插入失败回滚已插入 ID，保留旧镜像；全部写入成功后才按旧 ID 清理。旧清理失败保留完整新集合并报错，重试可去重。删除只作用于绑定 ID 与 OneTHU 本地账户。 |
| Android 全天事件直接写校园零点 epoch，不符合 CalendarProvider UTC 零点规范 | 全天起止转换为同一个校园日期的 UTC 零点，原生时区标为 UTC。普通定时事件继续使用真实 epoch 与校园时区。 |

主要实现位置：

- `apps/desktop/src/state/systemCal.ts`：数据屏障、完整载荷、状态生命周期、`exportSystemCalendarIcs()`。
- `apps/desktop/src/state/hwIgnore.ts`：只新增共用订阅导出，不修改存档格式。
- `apps/desktop/src-tauri/plugins/onethu-calendar/src/ownership.rs`：绑定文件、范围并集、原生入口载荷校验。
- `apps/desktop/src-tauri/plugins/onethu-calendar/src/macos.rs`：绑定 ID 过滤与 EventKit 提交。
- `apps/desktop/src-tauri/plugins/onethu-calendar/android/src/main/java/app/onethu/calendar/CalendarMirror.kt`：独立可测的先写后删与失败恢复策略、全天日期转换。

## 保留行为与迁移边界

- `exportSystemCalendarIcs()` 与系统同步使用同一份完整载荷，包含当前课程/考试、未提交且可提醒的学堂与外部作业、手动云/本日程。导出不请求系统日历权限；数据未完整时明确失败。
- 停止自动同步保留系统中已有事件。切换极简、实用、完整模式不修改系统日历配置或数据；入口展示由模式设置层负责。
- Android 日历使用 OneTHU 专用本地账户。macOS 优先尝试 iCloud、随后本地和其他可写系统源，账户可能自行云同步；不能声称始终只留本机。
- 旧 macOS 版本没有持久化所有权 ID。升级后不认领或删除旧同名日历；新建并绑定专属日历时返回提示，请用户核对旧副本后自行清理。首次迁移可能暂时出现两个同名日历，这是保护用户数据的明确边界。
- 学期缓存/源错误时保留已有系统事件并报错，不将半量结果冒充成功。若当前学期或外部源尚未加载，需要先在日程/网络学堂恢复数据，再重试。
- Android 原生 Provider 插入批次本身的事务性、各厂商闹钟实际触发以及 macOS 账户权限弹窗仍需授权的设备验收。本次单元测试不等于真实设备闹钟实测。
- Android 旧事件清理失败可能暂有重复，但保留新完整集合并明确失败，避免回滚新集合后丢失已删旧项。之后重试可收敛；不声称跨多个 Provider 批次具有一个全局事务。

## 本地验证

1. `node --import ./tools/ts-resolve-register.mjs tools/system-calendar-state-test.mjs`：27 组通过。执行实际 `systemCal.ts` 和实际 ICS 编解码，学校请求、文件和原生调用均注入隔离夹具。覆盖完整来源、历史学期拒绝、冷启动、停止/移除并发、完整缓存回退、失败重试、重复过滤、忽略恢复、提醒和导出无权限副作用。
2. `CARGO_TARGET_DIR=/Volumes/OneTHUBuild/oh-desktop cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -p tauri-plugin-onethu-calendar --lib --locked`：2 个 Rust 测试通过，macOS 生产代码编译通过。测试只校验载荷和临时绑定文件，不调用 EventKit。
3. Android `:onethu-calendar:testDebugUnitTest`：纯 Kotlin 策略 6 个测试，覆盖分批顺序、第二批失败、回滚失败、旧项部分删除、空集合与全天日期。测试文件为插件的 `src/test/java/app/onethu/calendar/CalendarMirrorTest.kt`。
4. `pnpm --filter @onethu/desktop typecheck`：通过。

Android 验证使用 `/tmp/onethu-systemcal-android-check` 的隔离 Gradle 根项目，引用仓库 `onethu-calendar/android` 与 Cargo 锁定的 Tauri Android 库，没有生成 APK、安装应用或连接设备。该根项目使用仓库 `gen/android/build.gradle.kts` 的依赖版本，`settings.gradle.kts` 只包含 `:tauri-android`、`:onethu-calendar`，SDK 为 `/Volumes/OneTHUBuild/oh-android-sdk`。命令：

```sh
JAVA_HOME=/opt/homebrew/opt/openjdk@17 \
GRADLE_USER_HOME=/Volumes/OneTHUBuild/gradle-home \
bash apps/desktop/src-tauri/gen/android/gradlew \
  --project-dir /tmp/onethu-systemcal-android-check \
  :onethu-calendar:testDebugUnitTest --offline --no-daemon
```

首次独立 Rust 构建在 exFAT 插件目录生成的 AppleDouble 文件使 Tauri 构建脚本读取失败；改用 APFS 构建目录后通过，生成的插件内 `target/` 与临时 `Cargo.lock` 已移除。Android 首次离线单测缺 JUnit 缓存，获取测试依赖后再执行离线验证。上述环境问题不掩盖为代码通过，也未修改历史测试断言。
