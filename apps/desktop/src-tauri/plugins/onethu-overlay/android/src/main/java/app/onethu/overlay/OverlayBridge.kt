// OneTHU 悬浮层：Kotlin → JS 的唯一通道。
//
// 为什么不用 plugin.trigger(Channel)：
//   Channel 需要 JS 先调 plugin:onethu-overlay|register_listener，那是 tauri-android
//   基类命令；它是否被 ACL（capabilities）放行、以及 Channel 序列化在 R8 下的表现，
//   本机无法编译验证。而 evaluateJavascript 直接作用在宿主 WebView 本体
//   （Plugin.load(webView) 拿到的实例，tauri-android 在 onWebViewCreated 时回调），
//   零 ACL、零额外权限、零 JNI。
//
// 契约：前端 lib/overlayAndroid.ts 在 window 上挂 __onethuOverlayEvent(jsonObj)。
// 未挂载（页面未加载完 / 已被重建）时静默丢弃——事件仍在队列里，由
// overlay_poll_event 兜底重投（见 OverlayEvents）。
object OverlayBridge {
    @Volatile
    private var webView: android.webkit.WebView? = null

    fun attachWebView(w: android.webkit.WebView) {
        webView = w
    }

    fun hasWebView(): Boolean = webView != null

    /** 在 UI 线程对宿主 WebView 求值；任何异常都吞掉（UI 层不该因桥失败而中断） */
    fun evalJs(js: String, onResult: ((String) -> Unit)? = null) {
        val w = webView ?: return
        try {
            w.post {
                try {
                    if (onResult == null) {
                        w.evaluateJavascript(js, null)
                    } else {
                        w.evaluateJavascript(js) { r -> onResult(r ?: "") }
                    }
                } catch (_: Throwable) {
                    /* 页面正在销毁等：丢弃 */
                }
            }
        } catch (_: Throwable) {
            /* 已 detached：丢弃 */
        }
    }
}
