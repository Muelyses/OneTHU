// OneTHU Android 系统桥（Android）
//
// - saveDownload：应用沙盒文件 → 系统「下载」。API 29+ 走 MediaStore
//   （无需任何运行时权限，自建条目）；API < 29 回退公共 Downloads 直写。
// - openIntent：intent:// 深链 → Intent.parseUri 解析（含 browser_fallback_url
//   兜底参数）。地图导航用：装了高德/腾讯/百度直跳 App，未装则落网页版。
//
// 线程：文件转存在后台 Thread 做 IO，resolve/reject 一律 runOnUiThread
// 回主线程（WebView 通道非线程安全）。

package app.onethu.mobile

import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebView
import android.webkit.WebViewClient
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
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

@TauriPlugin
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

    /* ── R18 24.2：雨课堂「官方网页登录」应用内 WebView 通道 ──
     * Tauri 的 webview cookies_for_url 在 Android 恒返回空，故用系统
     * android.webkit.CookieManager 读取；WebView 以 Dialog 呈现（移动端无多窗口）。 */

    /** 打开应用内 WebView（pro.yuketang.cn/web），用户在其中完成扫码或短信登录 */
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
                web.webViewClient = WebViewClient()
                // AlertDialog 里裸 WebView 会塌成 0 高，给一个显式高度
                val height = (activity.resources.displayMetrics.heightPixels * 0.7).toInt()
                web.layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, height)
                web.loadUrl("https://pro.yuketang.cn/web")
                val dialog = AlertDialog.Builder(activity)
                    .setTitle("雨课堂 · 官方网页登录")
                    .setView(web)
                    .setPositiveButton("关闭") { d, _ -> d.dismiss() }
                    .setNegativeButton("我已登录") { d, _ -> d.dismiss() }
                    .create()
                dialog.setOnDismissListener { web.destroy() }
                dialog.show()
                invoke.resolve()
            } catch (e: Exception) {
                invoke.reject(e.message ?: "打开雨课堂登录窗口失败")
            }
        }
    }

    /** 读取 pro.yuketang.cn 的 Cookie（含 HttpOnly），回传 { cookie } */
    @Command
    fun readYktCookies(invoke: Invoke) {
        activity.runOnUiThread {
            try {
                val cm = CookieManager.getInstance()
                cm.flush()
                val cookie = cm.getCookie("https://pro.yuketang.cn/") ?: ""
                val ret = JSObject()
                ret.put("cookie", cookie)
                invoke.resolve(ret)
            } catch (e: Exception) {
                invoke.reject(e.message ?: "读取雨课堂 Cookie 失败")
            }
        }
    }
}
