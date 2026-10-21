// OneTHU 全局悬浮球：Tauri Android 插件（Kotlin 侧门面）。
//
// 命令名与 Rust 侧 run_mobile_plugin 的字符串一一对应（camelCase）：
//   overlaySupported / overlayHasPermission / overlayRequestPermission / overlayShow /
//   overlayHide / overlaySetMode / overlayPollEvent / overlayAckEvents /
//   overlayPushUi / overlayStatus
//
// 红线（需求 5）：这里只开关悬浮窗、只读授权状态、只拉起「悬浮层授权页」；
// 绝不启动 OneTHU 自己的 Activity、绝不把主窗口拉到前台——即使用户在别的应用里
// 点悬浮球，对话也在悬浮层内完成。

package app.onethu.overlay

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import android.util.Log
import android.webkit.WebView
import androidx.core.content.ContextCompat
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONArray

/** 形态：ball | bar | panel | hidden */
@InvokeArg
class OverlayModeArgs {
    var mode: String = "ball"
}

@InvokeArg
class OverlayPollArgs {
    /** 前端已处理到的最大事件 id（Long?：JSON 里缺字段时不触发 FAIL_ON_NULL_FOR_PRIMITIVES） */
    var since: Long? = null
}

@InvokeArg
class OverlayAckArgs {
    var id: Long? = null
}

@InvokeArg
class OverlayPushArgs {
    /** 界面状态 JSON（字段见 lib/overlayAndroid.ts 的 pushUi） */
    var state: String = "{}"
}

@TauriPlugin(
    permissions = [
        // API 33+ 常驻通知需要运行时权限；渠道与通知都在插件库 Manifest 里声明。
        // 是否请求由前端决定（应用内「打开悬浮球」时问一次，与 onethu-mobile 的扫码保活同款）。
        Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "notifications"),
        // 长按说话的麦克风权限：**必须在本体仍在前台时拿到**——切到别的应用后既弹不出授权框，
        // 也拿不到 microphone 前台服务类型（Android 14+/15+ 禁止后台加 while-in-use 类型）。
        Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = "mic"),
    ],
)
class OnethuOverlayPlugin(private val activity: Activity) : Plugin(activity) {

    /** 相机结果靠看文件：最长等 90s（用户拍完即写盘，正常几秒内就稳定） */
    private val CAMERA_WATCH_MS = 90_000L

    /** overlayShow 正在等麦克风授权回调（回调里要继续启动悬浮层） */
    private var pendingShow = false

    /** 附件选择：回调时要知道选的是哪一类、以及拍照时的出图文件 */
    private var pendingPickKind = "file"
    private var pendingPickFile: java.io.File? = null

    /** 起选择器之前本体是否在前台（false = 用户在别的应用里用悬浮层） */
    private var foregroundBeforePick = true

    init {
        // 越早注册越好：服务起来之前就要能判断「OneTHU 自己是不是在前台」
        // （前台时悬浮层必须整体隐藏——用户要求本体内部不出现悬浮球）
        try {
            AppForeground.register(activity.application)
        } catch (_: Throwable) {
            /* 注册失败：退化为「视为不在前台」，行为等同旧版 */
        }
    }

    /** tauri-android 在 WebView 建好后回调这里：拿到宿主 WebView 用于事件直推（见 OverlayBridge） */
    override fun load(webView: WebView) {
        OverlayBridge.attachWebView(webView)
    }

    private fun canDraw(): Boolean = try {
        Settings.canDrawOverlays(activity)
    } catch (_: Throwable) {
        false
    }

    /** 本平台是否支持系统级悬浮层（桌面端 Rust 侧恒 false） */
    @Command
    fun overlaySupported(invoke: Invoke) {
        val ret = JSObject()
        ret.put("value", true)
        ret.put("sdk", Build.VERSION.SDK_INT)
        ret.put("hasPermission", canDraw())
        invoke.resolve(ret)
    }

    /** 是否已授予「显示在其他应用上层」（appop，非运行时权限） */
    @Command
    fun overlayHasPermission(invoke: Invoke) {
        val ret = JSObject()
        ret.put("value", canDraw())
        invoke.resolve(ret)
    }

    /** 拉起系统「显示在其他应用上层」授权页（用户自己开关；应用内不弹自定义弹窗） */
    @Command
    fun overlayRequestPermission(invoke: Invoke) {
        activity.runOnUiThread {
            try {
                val i = Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:${activity.packageName}"),
                )
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                activity.startActivity(i)
                val ret = JSObject()
                ret.put("ok", true)
                invoke.resolve(ret)
            } catch (e: Throwable) {
                invoke.reject("无法打开悬浮层授权页：${e.message}")
            }
        }
    }

    /** 显示悬浮球（用户在本体 OH 对话界面点「打开悬浮球」时调） */
    @Command
    fun overlayShow(invoke: Invoke) {
        if (!canDraw()) {
            val ret = JSObject()
            ret.put("ok", false)
            ret.put("reason", "no-permission")
            invoke.resolve(ret)
            return
        }
        // 顺路把麦克风权限要下来：只有本体在前台时才能弹授权框；也只有这时服务才能把
        // microphone 前台服务类型挂上（用户切走之后长按说话才可能真的取到麦）。被拒也不拦路。
        if (!hasMic() && AppForeground.isForeground) {
            pendingShow = true
            try {
                requestPermissionForAliases(arrayOf("mic"), invoke, "micPermissionCallback")
                return
            } catch (_: Throwable) {
                pendingShow = false
            }
        }
        finishShow(invoke)
    }

    /** 麦克风授权回调：无论给没给都继续显示悬浮层（取不到麦时条内会提示改用键盘） */
    @PermissionCallback
    fun micPermissionCallback(invoke: Invoke) {
        val wasPending = pendingShow
        pendingShow = false
        if (wasPending) {
            finishShow(invoke)
        } else {
            // 非本命令发起的回调：也要 resolve，不能让前端 Promise 悬着
            val ret = JSObject()
            ret.put("ok", true)
            ret.put("mic", hasMic())
            invoke.resolve(ret)
        }
    }

    private fun finishShow(invoke: Invoke) {
        activity.runOnUiThread {
            try {
                OverlayPrefs.setEnabled(activity, true)
                OverlayPrefs.setClosedByUser(activity, false)
                // 一律只出球：不沿用上次形态（上次停在面板时不能一显示就是半屏雾）
                OverlayPrefs.setMode(activity, "ball")
                OverlayService.start(activity, "ball")
                val ret = JSObject()
                ret.put("ok", true)
                ret.put("mode", "ball")
                ret.put("mic", hasMic())
                invoke.resolve(ret)
            } catch (e: Throwable) {
                invoke.reject("启动悬浮层失败：${e.message}")
            }
        }
    }

    private fun hasMic(): Boolean = try {
        ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED
    } catch (_: Throwable) {
        false
    }

    /** 「本次关闭悬浮球」：停服务 + 记「用户本次已关闭」（重启/被杀都不再自动弹回） */
    @Command
    fun overlayHide(invoke: Invoke) {
        activity.runOnUiThread {
            try {
                OverlayPrefs.setEnabled(activity, false)
                OverlayPrefs.setClosedByUser(activity, true)
                OverlayService.stop(activity)
                OverlayEvents.emit("closed", 0, 0)
                val ret = JSObject()
                ret.put("ok", true)
                invoke.resolve(ret)
            } catch (e: Throwable) {
                invoke.reject("关闭悬浮层失败：${e.message}")
            }
        }
    }

    @Command
    fun overlaySetMode(invoke: Invoke) {
        val args = invoke.parseArgs(OverlayModeArgs::class.java)
        val mode = when (args.mode) {
            "ball", "bar", "panel", "hidden" -> args.mode
            else -> "ball"
        }
        activity.runOnUiThread {
            try {
                if (mode == "hidden") {
                    OverlayService.stop(activity)
                } else {
                    OverlayService.command(activity, OverlayService.ACTION_MODE, mode)
                }
                val ret = JSObject()
                ret.put("ok", true)
                ret.put("mode", mode)
                invoke.resolve(ret)
            } catch (e: Throwable) {
                invoke.reject("切换悬浮层形态失败：${e.message}")
            }
        }
    }

    /** 拉取未确认手势（轮询兜底；主通道是 OverlayBridge 直推） */
    @Command
    fun overlayPollEvent(invoke: Invoke) {
        val args = invoke.getArgs()
        val since = args.optLong("since", 0L)
        val events: JSONArray = OverlayEvents.pendingSince(since)
        val ret = JSObject()
        ret.put("events", events)
        invoke.resolve(ret)
    }

    @Command
    fun overlayAckEvents(invoke: Invoke) {
        val args = invoke.getArgs()
        OverlayEvents.ack(args.optLong("id", 0L))
        val ret = JSObject()
        ret.put("ok", true)
        invoke.resolve(ret)
    }

    /** 前端 → 原生界面状态（消息列表 / 实时转写 / 电平 / 主题）。服务没在跑就静默丢弃。 */
    @Command
    fun overlayPushUi(invoke: Invoke) {
        val state = invoke.getArgs().optString("state", "{}")
        OverlayService.pushUi(state)
        val ret = JSObject()
        ret.put("ok", OverlayService.isLive())
        invoke.resolve(ret)
    }

    /** 附件选择（拍照 / 相册 / 上传，需求 6）。
     *
     *  为什么必须由前端发起这个命令：Tauri 的 activity result 只能经「带 Invoke 的
     *  startActivityForResult + @ActivityCallback」回传（raw startActivityForResult 的结果
     *  WryActivity 不会转发给插件）。所以串法是：原生面板点「拍照/相册/上传」→ 事件
     *  `attachRequest{kind}` 推给 JS → JS 调本命令拉起系统选择器 → 本命令把结果物化成
     *  cacheDir 里的真实文件后，再以 **事件 `attach`**（`{type:"attach", path, name, mime, size}`）
     *  推回 JS → 由 lib/overlayAndroid.ts 交给 lib/attach.ts 的 attachFromPath + sendToOh
     *  走**同一条**发送通道（不新增第二条链）。 */
    @Command
    fun overlayPickAttach(invoke: Invoke) {
        val kind = invoke.getArgs().optString("kind", "file")
        pendingPickKind = kind
        // 记录「起选择器之前本体在不在前台」：决定返回时要不要把本体送回后台
        foregroundBeforePick = AppForeground.isForeground
        activity.runOnUiThread {
            try {
                val plan = OverlayPicker.plan(activity, kind)
                if (kind == "camera") {
                    // 相机：**不需要结果**——用 EXTRA_OUTPUT 让它写我们的 FileProvider 文件，
                    // 目录里出现稳定文件就认（task-15 第 7 条）。
                    // 关键：用 Application context + NEW_TASK 起，**不会把本应用 Task 带到前台**。
                    plan.intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    activity.applicationContext.startActivity(plan.intent)
                    val out = plan.outFile
                    if (out == null) {
                        invoke.reject("相机输出文件不可用")
                        return@runOnUiThread
                    }
                    watchCameraOutput(out, invoke)
                } else {
                    // 相册/上传：必须拿结果 → 只能用 Activity 的 startActivityForResult，
                    // 系统会把本应用 Task 带回前台；返回后由 returnFocusIfNeeded() 送回去（见报告取舍）。
                    startActivityForResult(invoke, plan.intent, "onPickAttach")
                }
            } catch (_: android.content.ActivityNotFoundException) {
                // 相册选择器不可用（部分 ROM 精简）→ 退回文档选择器，同样零权限
                try {
                    startActivityForResult(invoke, OverlayPicker.planFallback().intent, "onPickAttach")
                } catch (e2: Throwable) {
                    invoke.reject("打开选择器失败：${e2.message}")
                }
            } catch (e: Throwable) {
                invoke.reject("打开选择器失败：${e.message}")
            }
        }
    }

    /**
     * 相机结果靠**看文件**：每 400ms 看一下 EXTRA_OUTPUT 文件，连续两次长度不变即认为写完。
     * 90s 没出现就当作取消。全程不碰 Activity 结果（所以不会把本体带到前台）。
     */
    private fun watchCameraOutput(file: java.io.File, invoke: Invoke) {
        Thread {
            var last = -1L
            var stable = 0
            val deadline = System.currentTimeMillis() + CAMERA_WATCH_MS
            var ok = false
            while (System.currentTimeMillis() < deadline) {
                try {
                    Thread.sleep(400L)
                } catch (_: InterruptedException) {
                    break
                }
                val len = if (file.exists()) file.length() else 0L
                if (len > 0L && len == last) {
                    stable++
                    if (stable >= 2) {
                        ok = true
                        break
                    }
                } else {
                    stable = 0
                }
                last = len
            }
            if (ok) {
                Log.i(OverlayService.TAG, "[PICKER] 相机文件就绪：${file.name} ${file.length()}B")
                finishAttach("camera", file, null, invoke)
            } else {
                activity.runOnUiThread {
                    val ret = JSObject()
                    ret.put("ok", false)
                    ret.put("cancelled", true)
                    invoke.resolve(ret)
                }
            }
        }.start()
    }

    /**
     * 选择器返回后的复位（task-15 第 7 条 bug）：选完系统把本应用 Task 带回前台 →
     * 用户看到「加附件后莫名其妙回到 OneTHU 本体一次」。
     * 若起选择器之前本体不在前台，这里立刻 moveTaskToBack 送回后台（悬浮层是 OVERLAY 窗口，不受影响）。
     */
    private fun returnFocusIfNeeded() {
        if (foregroundBeforePick) return
        try {
            activity.runOnUiThread {
                val moved = activity.moveTaskToBack(true)
                Log.i(OverlayService.TAG, "[PICKER] 选择器返回 → 把本体送回后台 moved=$moved")
            }
        } catch (e: Throwable) {
            Log.w(OverlayService.TAG, "[PICKER] 送回后台失败：${e.message}")
        }
    }

    @ActivityCallback
    private fun onPickAttach(invoke: Invoke?, result: ActivityResult) {
        if (invoke == null) return
        val kind = pendingPickKind
        val out = pendingPickFile
        pendingPickFile = null
        if (result.resultCode != Activity.RESULT_OK) {
            val ret = JSObject()
            ret.put("ok", false)
            ret.put("cancelled", true)
            invoke.resolve(ret)
            returnFocusIfNeeded()
            return
        }
        finishAttach(kind, out, result.data, invoke)
        returnFocusIfNeeded()
    }

    /** 物化 → 立刻本地回显 → 事件 attach → resolve（相机与选择器共用） */
    private fun finishAttach(kind: String, out: java.io.File?, data: Intent?, invoke: Invoke) {
        Thread {
            try {
                val f = OverlayPicker.materialize(activity, kind, out, data)
                if (f == null) {
                    activity.runOnUiThread { invoke.reject("没有取到可用的文件") }
                    return@Thread
                }
                val info = org.json.JSONObject().apply {
                    put("path", f.absolutePath)
                    put("name", f.name)
                    put("mime", OverlayPicker.mimeOf(f))
                    put("size", f.length())
                }
                // ① 立刻本地回显：带缩略图的附件气泡 + 「正在发送…」（不等 JS 往返，界面不空窗）
                OverlayService.echoAttachment(f.absolutePath, f.name)
                // ② {type:"attach", path, name, mime, size} 推给宿主 JS（发送链唯一入口）
                OverlayEvents.emit("attach", 0, 0, null, info)
                val ret = JSObject()
                ret.put("ok", true)
                ret.put("name", f.name)
                activity.runOnUiThread { invoke.resolve(ret) }
            } catch (e: Throwable) {
                val msg = e.message ?: "读取选择结果失败"
                activity.runOnUiThread { invoke.reject(msg) }
            }
        }.start()
    }

    /**
     * 打开系统设置页（F②：给 OH 设置页的华为/荣耀调优指引用）：
     *   battery = 电池优化列表页（Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS，无需权限）
     *   startup = 华为/荣耀「应用启动管理」页（无公开 API，按常见组件名 try；失败回落应用详情页）
     *   app     = 本应用详情页
     */
    @Command
    fun overlayOpenSettings(invoke: Invoke) {
        val what = invoke.getArgs().optString("what", "battery")
        activity.runOnUiThread {
            try {
                val pkgUri = Uri.parse("package:${activity.packageName}")
                val i = when (what) {
                    "battery" -> Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
                    "startup" -> startupManagerIntent()
                        ?: Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkgUri)
                    else -> Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkgUri)
                }
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                activity.startActivity(i)
                val ret = JSObject()
                ret.put("ok", true)
                ret.put("what", what)
                invoke.resolve(ret)
            } catch (e: Throwable) {
                invoke.reject("打开系统设置失败：${e.message}")
            }
        }
    }

    /**
     * 「应用启动管理」页（华为 EMUI / 荣耀 MagicOS）：没有公开 API，按常见组件名试，
     * 取不到就返回 null（调用方回落到应用详情页）。**不需要任何权限**。
     */
    private fun startupManagerIntent(): Intent? {
        val candidates = listOf(
            // 荣耀 MagicOS
            "com.hihonor.systemmanager" to "com.hihonor.systemmanager.startupmgr.ui.StartupNormalAppListActivity",
            "com.hihonor.systemmanager" to "com.hihonor.systemmanager.appcontrol.activity.StartupAppControlActivity",
            // 华为 EMUI
            "com.huawei.systemmanager" to "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity",
            "com.huawei.systemmanager" to "com.huawei.systemmanager.appcontrol.activity.StartupAppControlActivity",
        )
        for ((pkg, cls) in candidates) {
            try {
                val i = Intent().setClassName(pkg, cls)
                if (activity.packageManager.resolveActivity(i, 0) != null) return i
            } catch (_: Throwable) {
                /* 试下一个 */
            }
        }
        return null
    }

    /** 诊断（设置页/报告用）：权限、是否在显示、形态、关闭标记 */
    @Command
    fun overlayStatus(invoke: Invoke) {
        val ret = JSObject()
        ret.put("supported", true)
        ret.put("hasPermission", canDraw())
        ret.put("showing", OverlayService.running && (OverlayService.currentModeOrNull() ?: "hidden") != "hidden")
        ret.put("mode", OverlayService.currentModeOrNull() ?: OverlayPrefs.mode(activity))
        ret.put("closedByUser", OverlayPrefs.closedByUser(activity))
        // 本体在前台时悬浮层会被主动隐藏，这是预期行为（不是没启动成功）
        ret.put("appForeground", AppForeground.isForeground)
        // 真机取证字段（荣耀 logcat 被滤掉，只能靠命令读回来核对）：
        // workW/workH=算出来的屏幕；ballX/ballY=最终球坐标；windowKind=实际挂着的窗口
        // （ball/bar/panel/none/both(BUG)）；orbAttached+panelAttached=true 即不变量 1 被破坏。
        val dbg = OverlayService.liveDebug()
        if (dbg != null) {
            val keys = arrayOf(
                "workW", "workH", "ballDp", "ballPx", "ballX", "ballY", "placedFromSaved",
                "windowKind", "orbAttached", "panelAttached", "suspended", "mode", "voiceSource",
            )
            for (k in keys) {
                if (dbg.has(k)) ret.put(k, dbg.get(k))
            }
        }
        invoke.resolve(ret)
    }
}
