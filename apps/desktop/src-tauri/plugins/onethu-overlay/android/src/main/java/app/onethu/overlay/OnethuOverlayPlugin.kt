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
import android.os.Build
import android.provider.Settings
import android.webkit.WebView
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
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
    ],
)
class OnethuOverlayPlugin(private val activity: Activity) : Plugin(activity) {

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
        activity.runOnUiThread {
            try {
                OverlayPrefs.setEnabled(activity, true)
                OverlayPrefs.setClosedByUser(activity, false)
                val stored = OverlayPrefs.mode(activity)
                val mode = if (stored == "panel" || stored == "bar") stored else "ball"
                OverlayService.start(activity, mode)
                val ret = JSObject()
                ret.put("ok", true)
                ret.put("mode", mode)
                invoke.resolve(ret)
            } catch (e: Throwable) {
                invoke.reject("启动悬浮层失败：${e.message}")
            }
        }
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

    /** 诊断（设置页/报告用）：权限、是否在显示、形态、关闭标记 */
    @Command
    fun overlayStatus(invoke: Invoke) {
        val ret = JSObject()
        ret.put("supported", true)
        ret.put("hasPermission", canDraw())
        ret.put("showing", OverlayService.running && (OverlayService.currentModeOrNull() ?: "hidden") != "hidden")
        ret.put("mode", OverlayService.currentModeOrNull() ?: OverlayPrefs.mode(activity))
        ret.put("closedByUser", OverlayPrefs.closedByUser(activity))
        invoke.resolve(ret)
    }
}
