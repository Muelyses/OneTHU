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
import android.appwidget.AppWidgetManager
import android.app.Dialog
import android.content.ActivityNotFoundException
import android.content.ContentValues
import android.content.ComponentName
import android.content.Intent
import android.provider.Settings
import android.provider.DocumentsContract
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
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
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
import org.json.JSONArray
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

/** 小组件快照（JSON 字符串，结构见 OnethuWidget.kt 顶部注释）：
 *  `{ "instances": { "<appWidgetId>": {…} }, "slots": { "1": {…} } }` */
@InvokeArg
class WidgetPushArgs {
    lateinit var snapshot: String
}

/** 待排程的通知条目数组（JSON 字符串，结构见 OnethuNotify.kt 顶部注释） */
@InvokeArg
class NotifyScheduleArgs {
    lateinit var items: String
}

/** 要打开哪个系统设置页：channels（渠道，可带 channel）/ exact-alarm / app */
@InvokeArg
class NotifyOpenSettingsArgs {
    var what: String = "channels"
    var channel: String = ""
}

/** 是否要发起授权请求（缺省 false：只查状态） */
@InvokeArg
class NotifyPermissionArgs {
    var request: Boolean = false
}

/** 要撤销的通知 id 数组（JSON 字符串） */
@InvokeArg
class NotifyCancelArgs {
    lateinit var ids: String
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
                // 用户选过自定义文件夹（SAF 目录树）就写进去；没选才落系统「下载」
                val tree = DownloadPrefs.treeUri(activity)
                if (tree != null) {
                    val uri = DownloadPrefs.createDocument(activity, tree, mime, name)
                    if (uri != null) {
                        activity.contentResolver.openOutputStream(uri)?.use { o -> src.inputStream().use { it.copyTo(o) } }
                            ?: throw IllegalStateException("打开输出流失败")
                        val ret = JSObject()
                        ret.put("name", name)
                        ret.put("dir", DownloadPrefs.label(activity))
                        activity.runOnUiThread { invoke.resolve(ret) }
                        return@Thread
                    }
                    // 目录树失效（用户删了文件夹/撤销授权）：清掉配置，回落系统下载
                    DownloadPrefs.clear(activity)
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
                ret.put("dir", "系统下载")
                activity.runOnUiThread { invoke.resolve(ret) }
            } catch (e: Exception) {
                val msg = e.message ?: "转存失败"
                activity.runOnUiThread { invoke.reject(msg) }
            }
        }.start()
    }

    /* ── 下载位置（Android 走 SAF：目录树授权一次，之后一直写那里）── */

    /** 当前下载位置：{ path 显示名, isDefault }；path 是给用户看的（SAF 给不出真实路径） */
    @Command
    fun downloadDirGet(invoke: Invoke) {
        try {
            val ret = JSObject()
            ret.put("path", DownloadPrefs.label(activity))
            ret.put("isDefault", DownloadPrefs.treeUri(activity) == null)
            invoke.resolve(ret)
        } catch (e: Exception) {
            invoke.reject(e.message ?: "读取下载位置失败")
        }
    }

    /** 调起系统文件夹选择器（ACTION_OPEN_DOCUMENT_TREE），授权持久化到重启之后 */
    @Command
    fun downloadDirPick(invoke: Invoke) {
        try {
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
                addFlags(
                    Intent.FLAG_GRANT_READ_URI_PERMISSION or
                        Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                        Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION,
                )
            }
            // Tauri v2 的插件 API：结果经 @ActivityCallback 回传（没有 onActivityResult 钩子）
            startActivityForResult(invoke, intent, "onPickDownloadDir")
        } catch (e: Exception) {
            invoke.reject(e.message ?: "无法调起文件夹选择器")
        }
    }

    @ActivityCallback
    private fun onPickDownloadDir(invoke: Invoke?, result: ActivityResult) {
        if (invoke == null) return
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            // 用户取消：不改配置，原样回当前值
            val now = JSObject()
            now.put("path", DownloadPrefs.label(activity))
            now.put("isDefault", DownloadPrefs.treeUri(activity) == null)
            invoke.resolve(now)
            return
        }
        try {
            activity.contentResolver.takePersistableUriPermission(
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
            )
        } catch (_: SecurityException) {
            // 少数 ROM 不给持久授权：本次仍可用；重启后失效会被 createDocument 兜底清掉
        }
        DownloadPrefs.setTree(activity, uri.toString())
        val ret = JSObject()
        ret.put("path", DownloadPrefs.label(activity))
        ret.put("isDefault", false)
        invoke.resolve(ret)
    }

    @Command
    fun downloadDirReset(invoke: Invoke) {
        try {
            DownloadPrefs.clear(activity)
            val ret = JSObject()
            ret.put("path", DownloadPrefs.label(activity))
            ret.put("isDefault", true)
            invoke.resolve(ret)
        } catch (e: Exception) {
            invoke.reject(e.message ?: "重置下载位置失败")
        }
    }

    /**
     * 另存为：调起系统「保存到…」（ACTION_CREATE_DOCUMENT），用户当场挑位置与文件名。
     * 先由 Rust 把文件落到应用缓存，这里只负责把字节写进用户选定的文档 URI。
     */
    @Command
    fun saveAsDocument(invoke: Invoke) {
        val args = invoke.parseArgs(SaveDownloadArgs::class.java)
        val src = File(args.path)
        if (!src.exists()) {
            invoke.reject("源文件不存在：${args.path}")
            return
        }
        try {
            val name = args.name.ifBlank { src.name }
            val mime = try {
                URLConnection.guessContentTypeFromName(name) ?: "application/octet-stream"
            } catch (_: Exception) {
                "application/octet-stream"
            }
            pendingSaveAsPath = args.path
            val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = mime
                putExtra(Intent.EXTRA_TITLE, name)
            }
            startActivityForResult(invoke, intent, "onSaveAsDocument")
        } catch (e: Exception) {
            invoke.reject(e.message ?: "无法调起保存对话框")
        }
    }

    @ActivityCallback
    private fun onSaveAsDocument(invoke: Invoke?, result: ActivityResult) {
        if (invoke == null) return
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            invoke.resolve(JSObject().put("cancelled", true))
            return
        }
        val source = pendingSaveAsPath
        pendingSaveAsPath = null
        if (source == null) {
            invoke.reject("源文件已丢失，请重新下载")
            return
        }
        Thread {
            try {
                File(source).inputStream().use { input ->
                    val out = activity.contentResolver.openOutputStream(uri)
                        ?: throw IllegalStateException("打开输出流失败")
                    out.use { o -> input.copyTo(o) }
                }
                invoke.resolve(JSObject().put("name", DownloadPrefs.displayName(activity, uri)))
            } catch (e: Exception) {
                activity.runOnUiThread { invoke.reject(e.message ?: "写入失败") }
            }
        }.start()
    }

    /** 另存为流程中待写入的源文件（回调时用） */
    private var pendingSaveAsPath: String? = null

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
            val root = JSONObject(args.snapshot)
            // 宿主家族按实例（appWidgetId）各存一份内容；插件槽位仍是全局一份
            val instances = root.optJSONObject("instances")
            val live = mutableSetOf<Int>()
            if (instances != null) {
                for (key in instances.keys()) {
                    val id = key.toIntOrNull() ?: continue
                    live.add(id)
                    WidgetStore.saveInstance(ctx, id, instances.getJSONObject(key).toString())
                }
            }
            root.optJSONObject("slots")?.let { WidgetStore.saveSlots(ctx, it.toString()) }
            // 已被移除的小组件：顺手清掉它的内容（否则 appWidgetId 复用时会串内容）
            WidgetStore.pruneInstances(ctx, live)
            activity.runOnUiThread { OnethuBaseWidget.refreshAll(ctx) }
            invoke.resolve(JSObject().put("ok", true))
        } catch (e: Exception) {
            invoke.resolve(JSObject().put("ok", false).put("reason", e.message ?: "push-failed"))
        }
    }

    /** 桌面上每一块宿主机小组件的清单：id / provider / 占位宽高。
     *  应用据此为「每一块」算内容——内容绑定在实例上，就必须先知道有哪些实例。 */
    @Command
    fun widgetInstances(invoke: Invoke) {
        try {
            val ctx = activity.applicationContext
            val manager = AppWidgetManager.getInstance(ctx)
            val out = JSONArray()
            if (manager != null) {
                for (cls in OnethuBaseWidget.hostProviders()) {
                    for (id in manager.getAppWidgetIds(ComponentName(ctx, cls))) {
                        val (w, h) = OnethuBaseWidget.sizeOf(manager, id)
                        out.put(
                            JSObject()
                                .put("id", id)
                                .put("provider", cls.simpleName)
                                .put("w", w)
                                .put("h", h)
                                .put("bound", WidgetStore.loadInstance(ctx, id) != null)
                        )
                    }
                }
            }
            invoke.resolve(JSObject().put("ok", true).put("instances", out))
        } catch (e: Exception) {
            invoke.resolve(JSObject().put("ok", false).put("reason", e.message ?: "instances-failed"))
        }
    }

    /** 小组件落地状态：桌面上放了几个、每个槽位几个、快照时间与槽位内容。
     *  存在的意义是把「用户说没看到」变成可查的数字——自检链路要用。 */
    @Command
    fun widgetStatus(invoke: Invoke) {
        try {
            val ctx = activity.applicationContext
            val manager = AppWidgetManager.getInstance(ctx)
            var host = 0
            val slots = JSONObject()
            for (entry in OnethuBaseWidget.providerEntries()) {
                val key = entry.first
                val n = manager?.getAppWidgetIds(ComponentName(ctx, entry.second))?.size ?: 0
                // 宿主有四种形态，桌面上的数量要累加（任一形态放置都算「宿主已放置」）
                if (key == null) host += n else slots.put(key, n)
            }
            val snap = WidgetStore.loadSlots(ctx)
            val slotContent = JSONObject()
            snap?.let { s ->
                for (k in s.keys()) slotContent.put(k, s.optJSONObject(k)?.optString("title").orEmpty())
            }
            // 系统侧到底登记了哪几个小组件 provider：这正是「选择器里看不到小组件」的第一现场
            // （provider 由仓库内插件库清单经 manifest merger 合入，换机/构建脚本一变就可能掉）
            val registered = JSONArray()
            val installed = manager?.installedProviders
            for (entry in OnethuBaseWidget.providerEntries()) {
                val name = entry.second.name
                val found = installed?.any { it.provider.className == name } == true
                if (found) registered.put(entry.third)
            }
            invoke.resolve(
                JSObject()
                    .put("ok", true)
                    .put("hostPlaced", host)
                    .put("slotsPlaced", slots)
                    .put("hasSnapshot", snap != null)
                    .put("snapshotAt", snap?.optLong("updatedAt") ?: 0L)
                    .put("slotTitles", slotContent)
                    .put("providersRegistered", registered)
            )
        } catch (e: Exception) {
            invoke.resolve(JSObject().put("ok", false).put("reason", e.message ?: "widget-status-failed"))
        }
    }

    @Command
    fun widgetClear(invoke: Invoke) {
        try {
            val ctx = activity.applicationContext
            WidgetStore.clear(ctx)
            activity.runOnUiThread { OnethuBaseWidget.refreshAll(ctx) }
            invoke.resolve(JSObject().put("ok", true))
        } catch (e: Exception) {
            invoke.resolve(JSObject().put("ok", false).put("reason", e.message ?: "clear-failed"))
        }
    }

    /* ── 系统通知（渠道 + 定时）──
     * JS 侧 notifyPlan.ts 算出计划，这里只负责排进 AlarmManager 与权限状态回报。
     * 精确闹钟在 API 31+ 需要用户在系统设置里允许；不可用时降级为不精确投递
     * （setAndAllowWhileIdle，宁晚不丢），状态经 notifyPermission 回报给设置页。 */

    @Command
    fun notifyPermission(invoke: Invoke) {
        // request=false（设置页只查状态）不弹权限框；用户主动开启提醒 / 点「试一下」才请求
        val want = try {
            invoke.parseArgs(NotifyPermissionArgs::class.java).request
        } catch (e: Exception) {
            false
        }
        if (want && !hasNotificationPermission()) {
            requestPermissionForAliases(arrayOf("notifications"), invoke, "notificationPermissionCallback")
            return
        }
        resolveNotifyPermission(invoke)
    }

    /** 通知权限回调（与扫码保活共用 alias，但走各自回调以免串状态） */
    @PermissionCallback
    fun notifyPermissionCallback(invoke: Invoke) {
        resolveNotifyPermission(invoke)
    }

    private fun resolveNotifyPermission(invoke: Invoke) {
        val ctx = activity.applicationContext
        invoke.resolve(
            JSObject()
                .put("ok", true)
                .put("granted", hasNotificationPermission())
                .put("exact", OnethuNotifyReceiver.canExact(ctx))
                .put("android", true)
        )
    }

    @Command
    fun notifySchedule(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(NotifyScheduleArgs::class.java)
            val ctx = activity.applicationContext
            val arr = JSONArray(args.items)
            var scheduled = 0
            for (i in 0 until arr.length()) {
                val item = arr.optJSONObject(i) ?: continue
                if (OnethuNotifyReceiver.schedule(ctx, item)) scheduled++
            }
            invoke.resolve(
                JSObject().put("ok", true).put("scheduled", scheduled)
                    .put("exact", OnethuNotifyReceiver.canExact(ctx))
            )
        } catch (e: Exception) {
            invoke.resolve(JSObject().put("ok", false).put("reason", e.message ?: "schedule-failed"))
        }
    }

    @Command
    fun notifyCancel(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(NotifyCancelArgs::class.java)
            val ctx = activity.applicationContext
            val arr = JSONArray(args.ids)
            var cancelled = 0
            for (i in 0 until arr.length()) {
                val id = arr.optString(i)
                if (id.isEmpty()) continue
                OnethuNotifyReceiver.cancel(ctx, id)
                cancelled++
            }
            invoke.resolve(JSObject().put("ok", true).put("cancelled", cancelled))
        } catch (e: Exception) {
            invoke.resolve(JSObject().put("ok", false).put("reason", e.message ?: "cancel-failed"))
        }
    }

    @Command
    fun notifyPending(invoke: Invoke) {
        try {
            val ctx = activity.applicationContext
            val ids = JSONArray()
            for ((id, _) in NotifyStore.all(ctx)) ids.put(id)
            invoke.resolve(JSObject().put("ok", true).put("ids", ids))
        } catch (e: Exception) {
            invoke.resolve(JSObject().put("ok", false).put("reason", e.message ?: "pending-failed"))
        }
    }

    /** 立即发一条测试通知（设置页「试一下」按钮）：渠道与权限链路自证。 */
    @Command
    fun notifyTest(invoke: Invoke) {
        if (!hasNotificationPermission()) {
            requestPermissionForAliases(arrayOf("notifications"), invoke, "notifyTestCallback")
            return
        }
        doNotifyTest(invoke)
    }

    @PermissionCallback
    fun notifyTestCallback(invoke: Invoke) {
        doNotifyTest(invoke)
    }

    private fun doNotifyTest(invoke: Invoke) {
        val ctx = activity.applicationContext
        val item = JSONObject()
            .put("title", "OneTHU 提醒测试")
            .put("body", "看到这条说明通知渠道已就绪。")
            .put("channel", "briefing")
            .put("target", "settings")
        val ok = NotifyCenter.post(ctx, "test-" + System.currentTimeMillis(), item)
        invoke.resolve(JSObject().put("ok", ok).put("granted", hasNotificationPermission()))
    }

    /** 打开系统通知相关设置页。Android 的「渠道管理」与「精确闹钟授权」都在系统设置里，
     *  应用只能带用户跳过去——所以这个入口是渠道管理链路的一部分，不是可选项。 */
    @Command
    fun notifyOpenSettings(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(NotifyOpenSettingsArgs::class.java)
            val ctx = activity.applicationContext
            val intent = when (args.what) {
                "exact-alarm" -> Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM)
                "app" -> Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName)
                else -> {
                    // 渠道级：指向我们自己的某个通知渠道（渠道不存在时系统回落应用通知页）
                    val channel = NotifyCenter.channelOf(args.channel)
                    Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                        .putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName)
                        .putExtra(Settings.EXTRA_CHANNEL_ID, channel)
                }
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ctx.startActivity(intent)
            invoke.resolve(JSObject().put("ok", true))
        } catch (e: Exception) {
            invoke.resolve(JSObject().put("ok", false).put("reason", e.message ?: "open-settings-failed"))
        }
    }

    @Command
    fun notifyTakeTarget(invoke: Invoke) {
        try {
            val target = LaunchTarget.take(activity.applicationContext)
            invoke.resolve(JSObject().put("ok", true).put("target", target))
        } catch (e: Exception) {
            invoke.resolve(JSObject().put("ok", false).put("reason", e.message ?: "take-failed"))
        }
    }

    @Command
    fun widgetTakeTarget(invoke: Invoke) {
        try {
            val target = LaunchTarget.take(activity.applicationContext)
            invoke.resolve(JSObject().put("ok", true).put("target", target))
        } catch (e: Exception) {
            invoke.resolve(JSObject().put("ok", false).put("reason", e.message ?: "take-failed"))
        }
    }
}
