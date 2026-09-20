// OneTHU Android 系统桥（Android）
//
// - saveDownload：应用沙盒文件 → 系统「下载」。API 29+ 走 MediaStore
//   （无需任何运行时权限，自建条目）；API < 29 回退公共 Downloads 直写。
// - openIntent：intent:// 深链 → Intent.parseUri 解析（含 browser_fallback_url
//   兜底参数）。地图导航用：装了高德/腾讯/百度直跳 App，未装则落网页版。
// - openWebModal：全屏 Dialog WebView 以桌面模式打开任意 http(s) 页面
//   （R20-A 外部作业详情链接救急，只读浏览、无 Cookie 回读，与登录通道互不影响）。
//
// 线程：文件转存在后台 Thread 做 IO，resolve/reject 一律 runOnUiThread
// 回主线程（WebView 通道非线程安全）。

package app.onethu.mobile

import android.Manifest
import android.app.Activity
import android.app.Dialog
import android.content.ActivityNotFoundException
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.webkit.CookieManager
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.content.ContextCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONObject
import java.io.File
import java.net.URLConnection

@InvokeArg
class SaveDownloadArgs {
    lateinit var path: String
    var name: String = ""
}

@InvokeArg
class OpenIntentArgs {
    lateinit var url: String
}

@InvokeArg
class OpenWebModalArgs {
    lateinit var url: String
}

/** 小组件快照（JSON 字符串，结构见 OnethuWidget.kt 顶部注释） */
@InvokeArg
class WidgetPushArgs {
    lateinit var snapshot: String
}

@TauriPlugin(
    permissions = [
        // R18c：API 33+ 展示前台服务常驻通知需运行时权限（清单在插件库 Manifest 声明）
        Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "notifications"),
    ],
)
class OnethuMobilePlugin(private val activity: Activity) : Plugin(activity) {

    /** 沙盒文件 → 系统「下载」；回传 { name }（转存成功后的显示名） */
    @Command
    fun saveDownload(invoke: Invoke) {
        val args = invoke.parseArgs(SaveDownloadArgs::class.java)
        Thread {
            try {
                val src = File(args.path)
                if (!src.exists()) {
                    activity.runOnUiThread { invoke.reject("源文件不存在：${args.path}") }
                    return@Thread
                }
                val name = args.name.ifBlank { src.name }
                val mime = try {
                    URLConnection.guessContentTypeFromName(name) ?: "application/octet-stream"
                } catch (_: Exception) {
                    "application/octet-stream"
                }
                if (Build.VERSION.SDK_INT >= 29) {
                    val resolver = activity.contentResolver
                    val values = ContentValues().apply {
                        put(MediaStore.MediaColumns.DISPLAY_NAME, name)
                        put(MediaStore.MediaColumns.MIME_TYPE, mime)
                        put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                        put(MediaStore.MediaColumns.IS_PENDING, 1)
                    }
                    val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                    if (uri == null) {
                        activity.runOnUiThread { invoke.reject("MediaStore 建条目失败") }
                        return@Thread
                    }
                    val out = try {
                        resolver.openOutputStream(uri)
                    } catch (e: Exception) {
                        activity.runOnUiThread { invoke.reject("打开输出流失败：${e.message}") }
                        return@Thread
                    }
                    if (out == null) {
                        activity.runOnUiThread { invoke.reject("打开输出流失败") }
                        return@Thread
                    }
                    out.use { o -> src.inputStream().use { it.copyTo(o) } }
                    val done = ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }
                    resolver.update(uri, done, null, null)
                } else {
                    // 旧机型：公共 Downloads 直写（自己的文件名，通常可行）
                    val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                    dir.mkdirs()
                    src.copyTo(File(dir, name), overwrite = true)
                }
                val ret = JSObject()
                ret.put("name", name)
                activity.runOnUiThread { invoke.resolve(ret) }
            } catch (e: Exception) {
                val msg = e.message ?: "转存失败"
                activity.runOnUiThread { invoke.reject(msg) }
            }
        }.start()
    }

    /** intent:// 深链打开（地图导航跳 App）；未装目标 App 时落 browser_fallback_url */
    @Command
    fun openIntent(invoke: Invoke) {
        val args = invoke.parseArgs(OpenIntentArgs::class.java)
        try {
            val intent = Intent.parseUri(args.url, Intent.URI_INTENT_SCHEME)
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            try {
                activity.startActivity(intent)
            } catch (_: ActivityNotFoundException) {
                // 未装目标 App：intent:// 里带的 browser_fallback_url 兜底（网页版）
                val fb = intent.getStringExtra("browser_fallback_url")
                if (fb != null) {
                    activity.startActivity(
                        Intent(Intent.ACTION_VIEW, Uri.parse(fb)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    )
                } else {
                    invoke.reject("未安装目标应用")
                    return
                }
            }
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject(e.message ?: "无法解析 intent 链接")
        }
    }

    /* ── R18 24.2 / R18b 25.3：雨课堂「官方网页登录」应用内 WebView 通道 ──
     * Tauri 的 webview cookies_for_url 在 Android 恒返回空，故用系统
     * android.webkit.CookieManager 读取；WebView 以**全屏 Dialog** 呈现
     * （移动端无多窗口），底部固定按钮触发「读取会话 / 关闭」。
     *
     * R18b 25.3.1：原先 AlertDialog.setView(web) 会塌成一条缝——AlertDialog
     * 的内容区自管高度，预先设 layoutParams 无效。改为 Dialog + Window
     * MATCH_PARENT，WebView 以 weight=1 显式铺满，底部按钮条常显可见。 */

    /** 读取 pro.yuketang.cn 的 Cookie 原文（含 HttpOnly）；未登录时为空串。 */
    private fun readYktCookieHeader(): String {
        val cm = CookieManager.getInstance()
        cm.flush()
        return cm.getCookie("https://pro.yuketang.cn/") ?: ""
    }

    /** 打开应用内全屏 WebView（pro.yuketang.cn/web），用户在其中完成扫码或短信登录。
     *  回传 { cookie }：点「我已登录，读取会话」为 Cookie 原文，直接关闭则为 ""。 */
    @Command
    fun openYktWebLogin(invoke: Invoke) {
        activity.runOnUiThread {
            try {
                val cm = CookieManager.getInstance()
                cm.setAcceptCookie(true)

                val web = WebView(activity)
                // 第三方 Cookie 对官方登录页的跳转链是必需的
                cm.setAcceptThirdPartyCookies(web, true)
                web.settings.javaScriptEnabled = true
                web.settings.domStorageEnabled = true
                // R18b 25.3.1：官方网页版未做移动适配，靠视口缩放让桌面版页面可用
                web.settings.useWideViewPort = true
                web.settings.loadWithOverviewMode = true
                web.settings.setSupportZoom(true)
                web.settings.builtInZoomControls = true
                web.settings.displayZoomControls = false
                web.webViewClient = WebViewClient()

                // 竖向布局：WebView weight=1 铺满剩余空间，底部按钮条固定常显
                val root = LinearLayout(activity).apply {
                    orientation = LinearLayout.VERTICAL
                    setBackgroundColor(Color.WHITE)
                }
                root.addView(
                    web,
                    LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f),
                )
                val bottom = LinearLayout(activity).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER
                    setPadding(24, 16, 24, 16)
                    setBackgroundColor(Color.WHITE)
                }
                val readBtn = Button(activity).apply {
                    text = "我已登录，读取会话"
                    setTextColor(Color.WHITE)
                    setBackgroundColor(Color.parseColor("#1A6FD4"))
                }
                val closeBtn = Button(activity).apply {
                    text = "关闭"
                    setTextColor(Color.parseColor("#1F2329"))
                    setBackgroundColor(Color.parseColor("#E5E5E5"))
                }
                val readLp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                readLp.marginEnd = 16
                bottom.addView(readBtn, readLp)
                bottom.addView(
                    closeBtn,
                    LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f),
                )
                root.addView(
                    bottom,
                    LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.MATCH_PARENT,
                        LinearLayout.LayoutParams.WRAP_CONTENT,
                    ),
                )

                // 全屏 Dialog（部分 ROM 上仍显式设 MATCH_PARENT 兜底）
                val dialog = Dialog(activity, android.R.style.Theme_Black_NoTitleBar_Fullscreen)
                dialog.setContentView(root)

                var settled = false
                var readCookie: String? = null
                readBtn.setOnClickListener {
                    // 先读再关：dismiss 会触发 onDismissListener 并 destroy WebView
                    readCookie = readYktCookieHeader()
                    dialog.dismiss()
                }
                closeBtn.setOnClickListener { dialog.dismiss() }
                dialog.setOnDismissListener {
                    // 关闭时才 destroy()；结果只回传一次（按钮 / 返回键 / 点外部都走这里）
                    if (!settled) {
                        settled = true
                        val ret = JSObject()
                        ret.put("cookie", readCookie ?: "")
                        invoke.resolve(ret)
                    }
                    web.destroy()
                }

                web.loadUrl("https://pro.yuketang.cn/web")
                dialog.show()
                dialog.window?.setLayout(
                    WindowManager.LayoutParams.MATCH_PARENT,
                    WindowManager.LayoutParams.MATCH_PARENT,
                )
            } catch (e: Exception) {
                invoke.reject(e.message ?: "打开雨课堂登录窗口失败")
            }
        }
    }

    /* ── R20-A：外部作业「桌面模式」内嵌浏览（通用，与登录通道互不影响）──
     * 移动端点击外部作业（雨课堂等）详情链接时不再丢给系统浏览器，而是应用内
     * 全屏 WebView 以桌面模式打开（官方网页版未做移动适配，桌面布局可读性最好）。
     * 只读浏览：不注入任何脚本、不回读 Cookie、零数据链路改动；openYktWebLogin
     * 的登录 WebView 各自独立创建/销毁，互不干扰。
     * 布局与销毁语义沿用 R18b 25.3.1 的 openYktWebLogin：Dialog + MATCH_PARENT、
     * WebView weight=1 铺满、底部按钮条常显；关闭（按钮 / 返回键）才 destroy()。 */

    /** 桌面模式 UA：与 tauri.conf.json windows[].userAgent 同一条 Windows Chrome/79
     *  串（主窗口 webvpn 票绑定该 UA 指纹，那条配置不能改，这里也只是复用同串）。
     *  新建的 Dialog WebView 默认 UA 是移动端 Android WebView，须显式指成桌面 UA。 */
    private val desktopUserAgent =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
            "Chrome/79.0.3945.88 Safari/537.36"

    /** 全屏 Dialog WebView 打开任意 http(s) 页面（桌面模式 + 可缩放）。
     *  回传 {}：用户点「关闭」或按返回键即销毁，无任何数据回读。 */
    @Command
    fun openWebModal(invoke: Invoke) {
        val args = invoke.parseArgs(OpenWebModalArgs::class.java)
        // scheme 白名单：非 http(s) 一律拒绝（Rust 侧已校验一次，这里兜底）
        if (!args.url.startsWith("http://") && !args.url.startsWith("https://")) {
            invoke.reject("拒绝在应用内 WebView 打开非 http(s) 链接: ${args.url}")
            return
        }
        activity.runOnUiThread {
            try {
                val cm = CookieManager.getInstance()
                cm.setAcceptCookie(true)

                val web = WebView(activity)
                // 第三方 Cookie（部分站点跳转链需要）；仅作用于本 WebView，不影响登录通道
                cm.setAcceptThirdPartyCookies(web, true)
                web.settings.javaScriptEnabled = true
                web.settings.domStorageEnabled = true
                // 桌面模式：桌面 UA + 视口按 meta 渲染 + 整页概览 + 双指/控件缩放
                web.settings.userAgentString = desktopUserAgent
                web.settings.useWideViewPort = true
                web.settings.loadWithOverviewMode = true
                web.settings.setSupportZoom(true)
                web.settings.builtInZoomControls = true
                web.settings.displayZoomControls = false
                // 只读浏览：不设 JavascriptInterface、不注入初始化脚本
                web.webViewClient = WebViewClient()

                // 竖向布局：WebView weight=1 铺满剩余空间，底部按钮条固定常显（R18b 同款）
                val root = LinearLayout(activity).apply {
                    orientation = LinearLayout.VERTICAL
                    setBackgroundColor(Color.WHITE)
                }
                root.addView(
                    web,
                    LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f),
                )
                val bottom = LinearLayout(activity).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER
                    setPadding(24, 16, 24, 16)
                    setBackgroundColor(Color.WHITE)
                }
                val browserBtn = Button(activity).apply {
                    text = "在系统浏览器打开"
                    setTextColor(Color.WHITE)
                    setBackgroundColor(Color.parseColor("#1A6FD4"))
                }
                val closeBtn = Button(activity).apply {
                    text = "关闭"
                    setTextColor(Color.parseColor("#1F2329"))
                    setBackgroundColor(Color.parseColor("#E5E5E5"))
                }
                val browserLp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                browserLp.marginEnd = 16
                bottom.addView(browserBtn, browserLp)
                bottom.addView(
                    closeBtn,
                    LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f),
                )
                root.addView(
                    bottom,
                    LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.MATCH_PARENT,
                        LinearLayout.LayoutParams.WRAP_CONTENT,
                    ),
                )

                // 全屏 Dialog（部分 ROM 上仍显式设 MATCH_PARENT 兜底）
                val dialog = Dialog(activity, android.R.style.Theme_Black_NoTitleBar_Fullscreen)
                dialog.setContentView(root)

                var settled = false
                browserBtn.setOnClickListener {
                    // 兜底外链：取 WebView 当前 URL（保留页内跳转），交系统默认浏览器；
                    // 打不开（无浏览器等）只提示、不关窗，用户仍可继续读或手动关闭
                    val target = web.url?.takeIf { it.startsWith("http") } ?: args.url
                    try {
                        activity.startActivity(
                            Intent(Intent.ACTION_VIEW, Uri.parse(target)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                        )
                    } catch (e: Exception) {
                        android.widget.Toast.makeText(activity, "无法在系统浏览器打开：${e.message ?: "未知错误"}", android.widget.Toast.LENGTH_SHORT).show()
                    }
                }
                closeBtn.setOnClickListener { dialog.dismiss() }
                dialog.setOnDismissListener {
                    // 关闭时才 destroy()；结果只回传一次（按钮 / 返回键 / 点外部都走这里）
                    if (!settled) {
                        settled = true
                        invoke.resolve(JSObject())
                    }
                    web.destroy()
                }

                web.loadUrl(args.url)
                dialog.show()
                dialog.window?.setLayout(
                    WindowManager.LayoutParams.MATCH_PARENT,
                    WindowManager.LayoutParams.MATCH_PARENT,
                )
            } catch (e: Exception) {
                invoke.reject(e.message ?: "打开内嵌浏览窗口失败")
            }
        }
    }

    /** 读取 pro.yuketang.cn 的 Cookie（含 HttpOnly），回传 { cookie } */
    @Command
    fun readYktCookies(invoke: Invoke) {
        activity.runOnUiThread {
            try {
                val ret = JSObject()
                ret.put("cookie", readYktCookieHeader())
                invoke.resolve(ret)
            } catch (e: Exception) {
                invoke.reject(e.message ?: "读取雨课堂 Cookie 失败")
            }
        }
    }

    /* ── R18c：扫码期间前台服务保活（QrKeepAliveService）──
     * 前端 YktQrPanel 在二维码就绪时 startQrKeepAlive、成功/取消/过期/卸载时
     * stopQrKeepAlive。命令幂等：重复 start 安全、未启动时 stop 直接返回。
     * API 33+ 先请求 POST_NOTIFICATIONS；被拒时回 { ok:false, reason:"notifications-denied" }
     * （resolve 而非 reject，前端静默降级保留「另一台设备扫码」提示）。 */

    private fun hasNotificationPermission(): Boolean =
        Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED

    @Command
    fun startQrKeepAlive(invoke: Invoke) {
        if (!hasNotificationPermission()) {
            requestPermissionForAliases(arrayOf("notifications"), invoke, "notificationPermissionCallback")
            return
        }
        activity.runOnUiThread { doStartQrKeepAlive(invoke) }
    }

    @PermissionCallback
    fun notificationPermissionCallback(invoke: Invoke) {
        if (!hasNotificationPermission()) {
            invoke.resolve(JSObject().put("ok", false).put("reason", "notifications-denied"))
            return
        }
        activity.runOnUiThread { doStartQrKeepAlive(invoke) }
    }

    private fun doStartQrKeepAlive(invoke: Invoke) {
        try {
            if (QrKeepAliveService.running) {
                invoke.resolve(JSObject().put("ok", true).put("reason", "already-on"))
                return
            }
            val ctx = activity.applicationContext
            ContextCompat.startForegroundService(ctx, Intent(ctx, QrKeepAliveService::class.java))
            invoke.resolve(JSObject().put("ok", true))
        } catch (e: Exception) {
            // 启动失败（ROM 限制等）：不抛错，回 ok:false 让前端降级
            invoke.resolve(JSObject().put("ok", false).put("reason", e.message ?: "start-failed"))
        }
    }

    @Command
    fun stopQrKeepAlive(invoke: Invoke) {
        try {
            val ctx = activity.applicationContext
            ctx.stopService(Intent(ctx, QrKeepAliveService::class.java))
            invoke.resolve(JSObject().put("ok", true))
        } catch (e: Exception) {
            invoke.resolve(JSObject().put("ok", false).put("reason", e.message ?: "stop-failed"))
        }
    }

    /* ── 桌面小组件（AppWidgetProvider）──
     * 前端把渲染好的快照推过来（widgetPush），原生存进 SharedPreferences 并立刻重画
     * 所有已放置的小组件；widgetTakeTarget 供 App 启动后取走「用户点的是哪个落点」。
     * 小组件侧不做任何网络/解析——它连 WebView 都没有。 */

    @Command
    fun widgetPush(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(WidgetPushArgs::class.java)
            val ctx = activity.applicationContext
            // 校验一次 JSON：坏快照宁可不写，也不能让小组件渲染时崩
            JSONObject(args.snapshot)
            WidgetStore.save(ctx, args.snapshot)
            activity.runOnUiThread { OnethuWidgetProvider.refreshAll(ctx) }
            invoke.resolve(JSObject().put("ok", true))
        } catch (e: Exception) {
            invoke.resolve(JSObject().put("ok", false).put("reason", e.message ?: "push-failed"))
        }
    }

    @Command
    fun widgetClear(invoke: Invoke) {
        try {
            val ctx = activity.applicationContext
            WidgetStore.clear(ctx)
            activity.runOnUiThread { OnethuWidgetProvider.refreshAll(ctx) }
            invoke.resolve(JSObject().put("ok", true))
        } catch (e: Exception) {
            invoke.resolve(JSObject().put("ok", false).put("reason", e.message ?: "clear-failed"))
        }
    }

    @Command
    fun widgetTakeTarget(invoke: Invoke) {
        try {
            val target = WidgetStore.takeTarget(activity.applicationContext)
            invoke.resolve(JSObject().put("ok", true).put("target", target))
        } catch (e: Exception) {
            invoke.resolve(JSObject().put("ok", false).put("reason", e.message ?: "take-failed"))
        }
    }
}
