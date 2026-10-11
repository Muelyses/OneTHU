// OneTHU 悬浮层：窗口与手势（View + WindowManager）。task-11 返工版。
//
// 窗口（两个，尺寸一律按内容给，绝不用 MATCH_PARENT；PixelFormat.TRANSLUCENT；
// 视图不设任何背景色，雾靠 FogLayout 的径向渐变 + 羽化画出来）：
//   ① 球窗：54dp × 54dp  ↔  语音条：屏宽 × 56dp（同一个透明根 View，形态切换只换子 View，
//      所以「长按 → 变条 → 抬手」这一串手势流不会被窗口重建打断）；
//   ② 面板窗：屏宽 × 屏高 46%，gravity=BOTTOM，可聚焦（要输入法），
//      从底部丝滑滑入（240ms Decelerate）。
//
// 默认只出球：未点击时不存在任何面板/雾块（task-11 ③ 的硬要求）。
//
// 本应用在前台时全部隐藏（task-11 ②）：由 OverlayService 收到 AppForeground 变化后调 setSuspended。
//
// 语音（task-11 ④）：长按 ≥450ms → 条 + 本进程 SpeechRecognizer；松手整句经 submit 发出；
// 上划 >110dp 松手取消；取不到麦（荣耀仅前台麦克风）时条内给文案并自动展开面板。
// **不再回传 hold/release 给前端**：避免前端 GlobalOrb 再起一个识别器抢麦。
//
// 红线：本类不得以任何方式把 OneTHU 主窗口/Activity 拉到前台——只有悬浮窗操作与事件。

package app.onethu.overlay

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.ContextThemeWrapper
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.view.WindowManager
import android.view.animation.DecelerateInterpolator
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.FrameLayout
import android.widget.TextView
import android.widget.LinearLayout
import org.json.JSONObject
import kotlin.math.abs

class OverlayWindows(private val ctx: Context, private val host: Host) : OverlayVoice.Host {

    interface Host {
        /** 面板上「本次关闭悬浮球」→ 服务执行真正关闭（停服务 + 持久化 + emit closed） */
        fun onCloseRequested()

        /** 一句话 → 服务 emit 事件 submit{text}，前端走 askOh */
        fun onSubmitText(text: String)

        /** 开始/结束取麦：服务据此加/摘 microphone 前台服务类型 */
        fun onVoiceStart()

        fun onVoiceEnd()

        /** 「回到 OneTHU」：**用户主动点击**才跳（不含任何自动跳转，符合红线） */
        fun onOpenApp()
    }

    private val wm = ctx.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    private val themed = ContextThemeWrapper(ctx, android.R.style.Theme_DeviceDefault)
    private val main = Handler(Looper.getMainLooper())
    private val slop = ViewConfiguration.get(ctx).scaledTouchSlop
    private val voice = OverlayVoice(ctx, this)

    private var dark = OverlayViews.isDarkUi(ctx)
    private var modeCur = "ball"
    /** 球窗当前形态：ball | side | bar（bar 与 ball 同窗，side 是边缘缩略条） */
    private var orbShape = "ball"
    private var onRightEdge = true
    private var expandedFromSide = false
    private var riseOnBall = false
    private var idleRun: Runnable? = null
    private var suspended = false

    private var orb: OrbHolder? = null
    private var panel: PanelHolder? = null
    private var orbLp: WindowManager.LayoutParams? = null
    private var panelLp: WindowManager.LayoutParams? = null
    private var orbAttached = false
    private var panelAttached = false

    private var ballX = 0
    private var ballY = 0
    private var placedOnce = false
    private var cachedW = 0
    private var cachedH = 0

    // ── 手势状态 ──
    private var downRawX = 0f
    private var downRawY = 0f
    private var startBallX = 0
    private var startBallY = 0
    private var moved = false
    private var holdFired = false
    private var cancelArmed = false
    private var holdRun: Runnable? = null
    private var lastDragEmit = 0L
    private var followUp: Runnable? = null

    /** 只允许有一个延时后续动作（两条提示路径互斥） */
    private fun scheduleFollowUp(delayMs: Long, action: () -> Unit) {
        cancelFollowUp()
        val r = Runnable {
            followUp = null
            try {
                action()
            } catch (_: Throwable) {
                /* 忽略 */
            }
        }
        followUp = r
        main.postDelayed(r, delayMs)
    }

    private fun cancelFollowUp() {
        followUp?.let { main.removeCallbacks(it) }
        followUp = null
    }

    /** E：等待回复太久就换成**可读状态**，不要无限转圈（webview 后台被挂起时回复来不了） */
    private val busyWatch = object : Runnable {
        override fun run() {
            if (busyNow && busySince > 0L && !busyTimedOut &&
                System.currentTimeMillis() - busySince > BUSY_TIMEOUT_MS
            ) {
                busyTimedOut = true
                Log.i(TAG, "等待回复超过 ${BUSY_TIMEOUT_MS}ms → 停转圈，改显示可读状态")
                renderMessages(rebuild = true)
            }
            main.postDelayed(this, BUSY_POLL_MS)
        }
    }

    init {
        // E：等待回复的看门狗（busyWatch 声明在本块上方，见下方 busyWatch）
        main.postDelayed(busyWatch, BUSY_POLL_MS)
    }

    private val voiceGuard = Runnable {
        if (voiceState == "listening") {
            Log.w(TAG, "语音条超过 30s：强制收尾")
            voice.cancel()
            resetVoiceState()
            setMode("ball")
        }
    }

    // ── 界面状态 ──
    private var messagesJson = "[]"
    private var jsTranscript = ""
    private var voicePartial = ""
    private var voiceLevel = 0f
    private var voiceState = "off" // off | listening
    private var voiceSource = "orb" // orb（球→条，同一窗口内变形）| panel（面板内语音行，不切窗）
    private var barHint = ""
    private var busyNow = false
    private var attachSending = false
    private var busySince = 0L
    private var busyTimedOut = false
    /** 下一次重建时是否给最新一条播进场动画（只在面板已打开且消息数变多时置真） */
    private var animateNewest = false
    private var lastMsgCount = -1
    private var autoSpeak = false
    private var speaking = false
    private val pendingEchoes = ArrayList<PushMsg>()

    fun mode(): String = if (suspended) "hidden" else modeCur

    fun isShowing(): Boolean = !suspended && (orbAttached || panelAttached)

    /** 当前挂着的窗口种类（不变量 1 的自检输出） */
    fun windowKind(): String = when {
        orbAttached && panelAttached -> "both(BUG)"
        panelAttached -> "panel"
        orbAttached -> if (modeCur == "bar") "bar" else "ball"
        else -> "none"
    }

    /** 真机取证用（overlay_status 会带出去）：荣耀的 logcat 被滤掉，只能靠命令读回来核对
     *  算出来的屏幕尺寸、最终球坐标、实际挂着的窗口。 */
    fun debugInfo(): JSONObject {
        val (w, h) = screenSize()
        val ballPx = ballWinPx()
        return JSONObject().apply {
            put("workW", w)
            put("workH", h)
            put("ballDp", OverlayViews.BALL_DP)
            put("ballPx", ballPx)
            put("ballX", ballX)
            put("ballY", ballY)
            put("placedFromSaved", placedOnce)
            put("windowKind", windowKind())
            put("orbAttached", orbAttached)
            put("panelAttached", panelAttached)
            put("suspended", suspended)
            put("mode", modeCur)
            put("voiceSource", voiceSource)
        }
    }

    /* ────────────────────────── 对外形态控制 ────────────────────────── */

    /** 显示悬浮层：**默认只出球**（task-11 ③：未点击时不允许有任何面板/雾块）
     *
     *  硬不变量 2：这是 `overlay_show` / 开机广播 / 被杀自救 / 进程重启后**唯一**的入口，
     *  它只会 add 球窗；面板窗懒创建（只有用户点球才建）。 */
    fun showBallOnly() {
        dark = OverlayViews.isDarkUi(ctx)
        modeCur = "ball"
        orbShape = "ball"
        // C：先彻底摘干净再挂（真机反馈「设置里关一下再开一下才出来」＝上次挂载状态不一致），
        // 失败时再把可能残留的视图强制清一次并重建重试。
        detachPanel(false)
        detachOrb()
        ensureOrb()
        if (!suspended) {
            if (!attachOrb()) {
                Log.w(TAG, "球窗挂载失败 → 强制清窗重建后重试")
                forceCleanupWindows()
                orb = null
                ensureOrb()
                if (!attachOrb()) Log.w(TAG, "球窗重试仍失败（权限/ROM 限制？）")
            }
            applyOrbShape("ball", animate = false)
        }
        memoryMode()
        enforceSingleWindow()
    }

    /** C：把两扇窗从 WindowManager 里强制摘掉（挂载状态自愈用） */
    private fun forceCleanupWindows() {
        try {
            orb?.let { wm.removeView(it.root) }
        } catch (_: Throwable) {
            /* 本来就没挂 */
        }
        try {
            panel?.let { wm.removeView(it.root) }
        } catch (_: Throwable) {
            /* 本来就没挂 */
        }
        orbAttached = false
        panelAttached = false
    }

    /**
     * 硬不变量 1：**同一时刻只允许存在一个 overlay 窗口**（ball ⊕ bar ⊕ panel）。
     *
     * 所有形态切换都收敛到这一个方法：一律「先摘旧的、再挂新的」，不存在两个窗口并存的时刻；
     * 结束后再跑一次 enforceSingleWindow() 自愈（真机上出现过球窗与面板窗同时挂着 → 截图上
     * 球 + 半屏雾 + 输入行同时在屏幕上）。
     */
    private fun switchTo(kind: String, animate: Boolean) {
        when (kind) {
            "panel" -> {
                cancelIdleCollapse()
                detachOrb()
                attachPanel(animate)
                modeCur = "panel"
            }
            "bar" -> {
                cancelIdleCollapse()
                detachPanel(false)
                ensureOrb()
                attachOrb()
                applyOrbShape("bar", animate)
                modeCur = "bar"
            }
            else -> {
                riseOnBall = modeCur == "panel"
                detachPanel(animate)
                ensureOrb()
                detachOrb()
                attachOrb()
                applyOrbShape("ball", animate)
                modeCur = "ball"
            }
        }
        memoryMode()
        enforceSingleWindow()
    }

    /**
     * 悬浮球长时间无操作 → 自动缩回**侧边缩略条**（用户要求）。
     * 阈值 10s：拖拽/点击/语音/面板任一活动都会重置；面板或语音条打开期间不计时。
     */
    private fun armIdleCollapse() {
        cancelIdleCollapse()
        if (suspended || modeCur != "ball" || orbShape != "ball") return
        val r = Runnable {
            idleRun = null
            if (!suspended && modeCur == "ball" && orbShape == "ball" && !moved && !holdFired) {
                Log.i(TAG, "悬浮球空闲 ${IDLE_COLLAPSE_MS}ms → 缩回侧边条")
                applyOrbShape("side", animate = true)
            }
        }
        idleRun = r
        main.postDelayed(r, IDLE_COLLAPSE_MS)
    }

    private fun cancelIdleCollapse() {
        idleRun?.let { main.removeCallbacks(it) }
        idleRun = null
    }

    /** 侧边条形态下的 y 夹取（窗口更高一些） */
    private fun clampYSide(y: Int, winH: Int): Int {
        val lo = OverlayViews.dp(ctx, 24)
        return y.coerceIn(lo, (screenH() - winH - OverlayViews.dp(ctx, 8)).coerceAtLeast(lo))
    }

    /** 当前形态的可见子视图（球 / 侧边条 / 语音条），供液滴形变用 */
    private fun visibleOrbChild(): View? {
        val o = orb ?: return null
        return when (orbShape) {
            "side" -> o.side
            "bar" -> o.bar.root
            else -> o.ball
        }
    }

    /** 关动画后半段：从屏幕底部的落点「升」回球的原位置（液滴被吸回去的观感） */
    private fun riseToRest() {
        val o = orb ?: return
        val lp = orbLp ?: return
        val targetX = ballX
        val targetY = ballY
        val startY = (screenH() - lp.height).coerceAtLeast(0)
        val startX = (targetX + (screenW() - lp.width) / 2f * 0.55f).toInt()
        val anim = android.animation.ValueAnimator.ofFloat(0f, 1f).setDuration(RISE_MS)
        anim.interpolator = DecelerateInterpolator()
        anim.addUpdateListener { a ->
            val t = a.animatedValue as Float
            lp.y = (startY + (targetY - startY) * t).toInt()
            lp.x = (startX + (targetX - startX) * t).toInt()
            o.ball.scaleX = 0.62f + 0.38f * t
            o.ball.scaleY = 1.45f - 0.45f * t
            if (orbAttached) {
                try {
                    wm.updateViewLayout(o.root, lp)
                } catch (_: Throwable) {
                    /* 瞬态 */
                }
            }
        }
        anim.addListener(object : android.animation.AnimatorListenerAdapter() {
            override fun onAnimationEnd(animation: android.animation.Animator) {
                lp.x = targetX
                lp.y = targetY
                ballX = targetX
                ballY = targetY
                o.ball.scaleX = 1f
                o.ball.scaleY = 1f
            }
        })
        anim.start()
    }

    /** 不变量自愈：万一还有两条路径让两个窗口并存，这里强制摘掉面板（球优先） */
    private fun enforceSingleWindow() {
        if (orbAttached && panelAttached) {
            Log.w(TAG, "不变量被破坏：球窗与面板窗同时存在 → 强制摘掉面板窗")
            detachPanel(false)
        }
    }

    /** 前端 overlay_set_mode 落到这里；幂等；一律经 switchTo 保证单窗 */
    fun setMode(m: String) {
        when (m) {
            "hidden" -> hide()
            "panel" -> {
                if (suspended) {
                    modeCur = "panel"
                    memoryMode()
                    return
                }
                switchTo("panel", true)
            }
            "bar" -> {
                if (suspended) {
                    modeCur = "bar"
                    memoryMode()
                    return
                }
                switchTo("bar", true)
            }
            else -> {
                if (suspended) {
                    modeCur = "ball"
                    memoryMode()
                    return
                }
                switchTo("ball", true)
            }
        }
    }

    fun hide() {
        cancelHold()
        voice.cancel()
        resetVoiceState()
        detachPanel(false)
        detachOrb()
        modeCur = "ball"
        memoryMode()
    }

    /** 本应用前台态变化：前台时连球带面板全部摘掉，回到别的应用再只出球 */
    fun setSuspended(s: Boolean) {
        if (suspended == s) return
        suspended = s
        if (s) {
            cancelHold()
            voice.cancel()
            resetVoiceState()
            detachPanel(false)
            detachOrb()
        } else {
            showBallOnly()
        }
    }

    /** 系统深浅色变化：重建视图（窗口此时多半是摘掉的，重建成本可忽略） */
    fun onUiModeChanged() {
        refreshScreen()
        val next = OverlayViews.isDarkUi(ctx)
        if (next == dark) return
        dark = next
        rebuild()
    }

    fun destroy() {
        main.removeCallbacks(busyWatch)
        voice.destroy()
        hide()
        orb = null
        panel = null
        orbLp = null
        panelLp = null
    }

    private fun memoryMode() {
        OverlayPrefs.setMode(ctx, modeCur)
    }

    private fun rebuild() {
        if (suspended) {
            orb = null
            panel = null
            orbLp = null
            panelLp = null
            return
        }
        val m = modeCur
        cancelHold()
        voice.cancel()
        resetVoiceState()
        detachPanel(false)
        detachOrb()
        orb = null
        panel = null
        orbLp = null
        panelLp = null
        if (m == "panel") setMode("panel") else if (m == "bar") setMode("bar") else showBallOnly()
    }

    private fun resetVoiceState() {
        cancelFollowUp()
        voiceState = "off"
        voicePartial = ""
        voiceLevel = 0f
        barHint = ""
        cancelArmed = false
        showPanelVoice(false)
        voiceSource = "orb"
        renderBar()
    }

    /**
     * 面板内语音行显隐（单窗不变量：面板里说话不切窗）。
     *
     * ⚠️ **不能把输入块设成 GONE**：用户长按的正是输入块里的「发送」，
     * 把它的祖先隐藏会立刻取消这条手势流（ACTION_CANCEL）→ 抬手事件丢失。
     * 所以这里只把语音行显示出来（用 alpha 给输入块一点「让步」的视觉反馈），
     * 布局与可见性都不动被按住的那个视图。
     */
    private fun showPanelVoice(on: Boolean) {
        val p = panel ?: return
        p.voiceRow.visibility = if (on) View.VISIBLE else View.GONE
        p.inputBlock.alpha = if (on) 0.45f else 1f
        p.input.alpha = if (on) 0.45f else 1f
        if (!on) {
            try {
                p.input.clearFocus()
                p.content.requestFocus()
            } catch (_: Throwable) {
                /* 忽略 */
            }
        }
    }

    /* ────────────────────────── 前端状态 → 原生界面 ────────────────────────── */

    fun pushUi(stateJson: String) {
        val o = try {
            JSONObject(stateJson)
        } catch (_: Throwable) {
            return
        }
        val theme = o.optString("theme", "")
        if (theme == "dark" || theme == "light") {
            val wantDark = theme == "dark"
            if (wantDark != dark) {
                dark = wantDark
                rebuild()
            }
        }
        val msgs = o.optJSONArray("messages")?.toString() ?: messagesJson
        val changed = msgs != messagesJson
        messagesJson = msgs
        val count = parseMessages(msgs).size
        if (changed && panelAttached && lastMsgCount >= 0 && count > lastMsgCount) {
            animateNewest = true
        }
        lastMsgCount = count
        busyNow = o.optBoolean("busy", busyNow)
        if (busyNow && busySince == 0L) busySince = System.currentTimeMillis()
        if (!busyNow) {
            attachSending = false
            busySince = 0L
            busyTimedOut = false
        }
        autoSpeak = o.optBoolean("autoSpeak", autoSpeak)
        speaking = o.optBoolean("speaking", speaking)
        renderAutoSpeak()
        jsTranscript = o.optString("transcript", jsTranscript)
        if (changed) renderMessages(rebuild = true)
        renderBar()
    }

    /** 一条消息（前端 push 的形状）：文本走 markdown 渲染，images 是本地图片路径 */
    private class PushMsg(
        val role: String,
        val text: String,
        val images: List<String>,
        /** "" | sending | error —— 决定气泡上的状态行 */
        val status: String,
    )

    private fun parseMessages(json: String): List<PushMsg> {
        val arr = try {
            org.json.JSONArray(json)
        } catch (_: Throwable) {
            return emptyList()
        }
        val out = ArrayList<PushMsg>(arr.length())
        for (i in 0 until arr.length()) {
            val m = arr.optJSONObject(i) ?: continue
            val text = m.optString("text", "")
            val imgs = ArrayList<String>()
            val iarr = m.optJSONArray("images")
            if (iarr != null) {
                for (j in 0 until iarr.length()) {
                    val e = iarr.opt(j)
                    val path = when (e) {
                        is String -> e
                        is org.json.JSONObject -> e.optString("path", "")
                        else -> ""
                    }
                    if (path.isNotEmpty() && !path.startsWith("data:")) imgs.add(path)
                }
            }
            if (text.isEmpty() && imgs.isEmpty()) continue
            out.add(PushMsg(m.optString("role", "oh"), text, imgs, m.optString("status", "")))
        }
        return out
    }

    private fun renderAutoSpeak() {
        panel?.autoSpeakBtn?.text = if (autoSpeak) "自动朗读：开" else "自动朗读：关"
    }

    /** 滚动到底：连发两次是因为新内容要等一次布局才有正确的高度（用户：停在回复中间） */
    private fun scrollToBottom() {
        val sc = panel?.scroll ?: return
        sc.post {
            sc.fullScroll(View.FOCUS_DOWN)
            sc.post { sc.fullScroll(View.FOCUS_DOWN) }
        }
    }

    private fun renderMessages(rebuild: Boolean) {
        val p = panel ?: return
        if (!rebuild) return
        p.list.removeAllViews()
        val list = parseMessages(messagesJson)
        for ((idx, m) in list.withIndex()) {
            // 只给**最新一条**播进场动画；历史消息静止（避免打开面板时一片乱跳）
            appendMessage(m, animate = animateNewest && idx == list.size - 1)
        }
        animateNewest = false
        if (busyNow) {
            val txt = when {
                busyTimedOut -> "还没收到回复 · 切回本体可查看进度"
                attachSending -> "正在发送…"
                else -> "OH 正在思考…"
            }
            val row = if (busyTimedOut) {
                // 超时：不再转圈，给可读状态（E）
                TextView(themed).apply {
                    text = txt
                    textSize = 13f
                    setTextColor(OverlayViews.ink(dark))
                    alpha = 0.95f
                    OverlayViews.shadow(this)
                }
            } else {
                OverlayMd.progress(themed, txt, dark)
            }
            p.list.addView(
                row,
                android.widget.LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                ),
            )
        }
        scrollToBottom()
    }

    /**
     * 一条消息 = 一个 **liquid glass 气泡**（用户拍板）：圆角 20dp + 说话方那侧尾角 6dp；
     * 内含 [图片缩略图…][markdown 文本块…][朗读入口][状态行]；用户右对齐、OH 左对齐，最大宽度 ≤84% 屏宽。
     */
    private fun appendMessage(msg: PushMsg, animate: Boolean = false) {
        val p = panel ?: return
        val holder = buildMessageBubble(msg, animate)
        val lp = android.widget.LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        )
        lp.bottomMargin = OverlayViews.dp(ctx, OverlayViews.GAP_DP)
        p.list.addView(holder, lp)
        scrollToBottom()
    }

    private fun buildMessageBubble(msg: PushMsg, animate: Boolean): FrameLayout {
        val user = msg.role == "user"
        val light = !dark
        val maxW = (screenW() * 0.84f).toInt()
        val bubble = GlassBubble(themed).apply {
            tailFor(user)
            fillTop = OverlayViews.glassFill(light, top = true)
            fillBottom = OverlayViews.glassFill(light, top = false)
            borderColor = OverlayViews.glassBorder(light)
            // 深色模式：高光更弱、阴影更重
            topHighlight = if (light) 0.5f else 0.22f
            // 柔和外阴影（半径 ~10dp；太大的阴影会被 ScrollView 裁出硬边，反而难看）
            elevation = OverlayViews.dp(ctx, if (light) 10 else 12).toFloat()
        }
        val inner = LinearLayout(themed).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(
                OverlayViews.dp(ctx, 14), OverlayViews.dp(ctx, 11),
                OverlayViews.dp(ctx, 14), OverlayViews.dp(ctx, 11),
            )
        }

        // 图片：本地文件渲染缩略图（圆角 14dp，点一下原地放大）
        for (path in msg.images) {
            val iv = OverlayViews.buildImageThumb(themed, path, dark, (screenH() * 0.42f).toInt()) {
                scrollToBottom()
            }
            val lp = android.widget.LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            )
            lp.bottomMargin = OverlayViews.dp(ctx, 6)
            inner.addView(iv, lp)
        }

        // markdown 文本块（气泡内）
        if (msg.text.isNotBlank()) {
            val textMaxW = (maxW - OverlayViews.dp(ctx, 28)).coerceAtLeast(OverlayViews.dp(ctx, 80))
            val blocks = OverlayMd.render(themed, msg.text, dark) { url -> openLink(url) }
            for (b in blocks) {
                if (b is android.widget.TextView) b.maxWidth = textMaxW
                val isDivider = b.tag == OverlayMd.TAG_DIVIDER
                val holder = FrameLayout(themed)
                val lp = FrameLayout.LayoutParams(
                    if (isDivider) ViewGroup.LayoutParams.MATCH_PARENT else ViewGroup.LayoutParams.WRAP_CONTENT,
                    if (isDivider) OverlayViews.dp(ctx, 1) else ViewGroup.LayoutParams.WRAP_CONTENT,
                )
                lp.gravity = Gravity.START
                holder.addView(b, lp)
                inner.addView(holder)
            }
        }

        // 每条 OH 消息的朗读入口（手动点 = 当场意图，无视静音开关）
        if (!user && msg.text.isNotBlank()) {
            val say = TextView(themed)
            say.text = "朗读"
            say.textSize = 12f
            say.setTextColor(OverlayViews.ink(dark))
            say.alpha = 0.9f
            say.setPadding(0, OverlayViews.dp(ctx, 2), OverlayViews.dp(ctx, 6), 0)
            OverlayViews.shadow(say)
            val readText = msg.text
            say.setOnClickListener { OverlayEvents.emit("speak", 0, 0, readText) }
            inner.addView(say)
        }

        if (msg.status == "sending") {
            inner.addView(OverlayMd.progress(themed, "正在发送…", dark))
        } else if (msg.status == "error") {
            inner.addView(OverlayMd.progress(themed, "发送失败，可再试一次", dark))
        }

        bubble.addView(
            inner,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ),
        )
        if (animate) bubble.playEnter()

        // 外层只负责对齐（气泡自身决定宽度，最多 84% 屏宽）；clipChildren=false 让阴影画得出来
        val row = FrameLayout(themed).apply { clipChildren = false }
        val lp = FrameLayout.LayoutParams(
            if (user) ViewGroup.LayoutParams.WRAP_CONTENT else ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        )
        lp.gravity = if (user) Gravity.END else Gravity.START
        row.addView(bubble, lp)
        return row
    }

    /**
     * 选完文件**立刻**本地回显（不等 JS 往返）：带缩略图的附件气泡 + 「正在发送…」。
     * JS 之后推来的权威状态会整体重建列表（同一条消息带 images/status），所以不会重复。
     */
    fun echoLocalAttachment(path: String, name: String) {
        attachSending = true
        val msg = PushMsg("user", "📎 $name", listOf(path), "sending")
        if (panel == null || !panelAttached) {
            // 面板没开：排队，等面板挂上时先显示（JS 权威状态随后会整体重建）
            pendingEchoes.add(msg)
            return
        }
        appendMessage(msg, animate = true)
    }

    /** 发送结束（收到回复）：清掉进行中标记 */
    fun clearAttachSending() {
        attachSending = false
    }

    private fun openLink(url: String) {
        if (!url.startsWith("http://") && !url.startsWith("https://")) return
        try {
            val i = android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url))
            i.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            ctx.startActivity(i)
        } catch (_: Throwable) {
            /* 没有浏览器可开就算了 */
        }
    }

    private fun renderBar() {
        val t = when {
            cancelArmed -> "松开取消"
            barHint.isNotEmpty() -> barHint
            voicePartial.isNotEmpty() -> voicePartial
            voiceState == "listening" -> "在听，请讲…"
            jsTranscript.isNotEmpty() -> jsTranscript
            else -> "长按说话"
        }
        orb?.let {
            it.bar.wave.amplitude = voiceLevel
            it.bar.wave.animating = voiceState == "listening" && voiceSource == "orb"
            it.bar.hint.text = t
            // 上方淡雾带：只在说话/有转写时显示（用户：上面一点点雾状显示识别到的话）
            val showSub = voiceSource == "orb" && (voicePartial.isNotEmpty() || voiceState == "listening")
            it.bar.sub.visibility = if (showSub) View.VISIBLE else View.GONE
            it.bar.subText.text = voicePartial
        }
        if (voiceSource == "panel") {
            panel?.let {
                it.voiceWave.amplitude = voiceLevel
                it.voiceWave.animating = voiceState == "listening"
                it.voiceText.text = t
            }
        }
    }

    /* ────────────────────────── 窗口建立 / 形态 ────────────────────────── */

    private fun ensureOrb() {
        if (orb != null) return
        val root = OverlayViews.windowRoot(themed)
        val ball = OverlayViews.buildBall(themed, dark)
        val voiceBar = OverlayViews.buildVoiceBar(themed, dark)
        val side = OverlayViews.buildSideBar(themed, dark)
        root.setOnTouchListener { v, e -> onOrbTouch(v, e) }
        orb = OrbHolder(root, ball, side, voiceBar)
        // 球固定 54dp、居中放进球窗（窗口多出的 8dp 是给轻投影留的）
        root.addView(
            ball,
            FrameLayout.LayoutParams(
                OverlayViews.dp(ctx, OverlayViews.BALL_DP),
                OverlayViews.dp(ctx, OverlayViews.BALL_DP),
                Gravity.CENTER,
            ),
        )
        orbLp = orbParams()
    }

    private fun ensurePanel(): PanelHolder {
        panel?.let { return it }
        val p = OverlayViews.buildPanel(themed, dark)
        wirePanel(p)
        panel = p
        panelLp = panelParams()
        return p
    }

    private fun attachOrb(): Boolean {
        val o = orb ?: return false
        val lp = orbLp ?: return false
        if (orbAttached) return true
        return if (addWindow(o.root, lp)) {
            orbAttached = true
            true
        } else {
            false
        }
    }

    private fun detachOrb() {
        val o = orb ?: return
        if (!orbAttached) return
        try {
            wm.removeView(o.root)
        } catch (_: Throwable) {
            /* 已被移除 */
        }
        orbAttached = false
    }

    /** 球 ↔ 侧边条 ↔ 语音条：同一个透明根，换子 View + 改窗口尺寸/位置 */
    private fun applyOrbShape(shape: String, animate: Boolean) {
        val lp = orbLp ?: return
        val o = orb ?: return
        val root = o.root
        val ballPx = ballWinPx()
        val barPx = OverlayViews.dp(ctx, OverlayViews.BAR_DP)

        orbShape = shape
        if (shape == "side") {
            root.removeAllViews()
            // 贴哪条边：按当前球窗中心落在屏幕哪半边决定
            val atRight = ballX + ballPx / 2 >= screenW() / 2
            onRightEdge = atRight
            // B①：胶囊贴住窗口外缘（配合窗口贴屏幕边）→ 视觉上**完全贴边**，不再留 8dp 缝
            root.addView(
                o.side,
                FrameLayout.LayoutParams(
                    OverlayViews.dp(ctx, OverlayViews.SIDE_W_DP),
                    OverlayViews.dp(ctx, OverlayViews.SIDE_H_DP),
                    (if (atRight) Gravity.END else Gravity.START) or Gravity.CENTER_VERTICAL,
                ),
            )
            val sw = OverlayViews.dp(ctx, OverlayViews.SIDE_WIN_W_DP)
            val sh = OverlayViews.dp(ctx, OverlayViews.SIDE_WIN_H_DP)
            lp.width = sw
            lp.height = sh
            lp.x = if (atRight) (screenW() - sw).coerceAtLeast(0) else 0
            lp.y = clampYSide(if (placedOnce) ballY else defaultBallPos(ballPx).second, sh)
            ballX = lp.x
            ballY = lp.y
            if (orbAttached) {
                try {
                    wm.updateViewLayout(root, lp)
                } catch (_: Throwable) {
                    /* 瞬态 */
                }
            }
            if (animate) {
                root.alpha = 0.4f
                root.animate().alpha(1f).setDuration(220).start()
            } else {
                root.alpha = 1f
            }
            cancelIdleCollapse()
            return
        }

        root.removeAllViews()
        if (shape == "bar") {
            root.addView(
                o.bar.root,
                FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT,
                ),
            )
            // D①：**原地**横向展开——以球当前位置为基准向左/右铺开，不落底
            val barW = OverlayViews.dp(ctx, OverlayViews.VOICE_BAR_W_DP)
                .coerceAtMost(screenW() - OverlayViews.dp(ctx, 24))
            val barH = barPx + OverlayViews.dp(ctx, OverlayViews.SUB_BAR_H_DP)
            lp.width = barW
            lp.height = barH
            val ballCenterX = ballX + ballPx / 2
            lp.x = if (ballCenterX >= screenW() / 2) {
                (ballX + ballPx - barW).coerceAtLeast(OverlayViews.dp(ctx, 12))
            } else {
                (ballX).coerceAtMost(screenW() - barW - OverlayViews.dp(ctx, 12))
            }
            // 竖直方向对齐球的中心（条 + 转写带整体以球心为中心）
            lp.y = (ballY + ballPx / 2 - barH / 2)
                .coerceIn(OverlayViews.dp(ctx, 24), (screenH() - barH - OverlayViews.dp(ctx, 24)).coerceAtLeast(OverlayViews.dp(ctx, 24)))
        } else {
            root.addView(
                o.ball,
                FrameLayout.LayoutParams(
                    OverlayViews.dp(ctx, OverlayViews.BALL_DP),
                    OverlayViews.dp(ctx, OverlayViews.BALL_DP),
                    Gravity.CENTER,
                ),
            )
            lp.width = ballPx
            lp.height = ballPx
            val pos = if (placedOnce) {
                Pair(clampX(ballX, ballPx), clampY(ballY, ballPx))
            } else {
                loadBallPos(ballPx)
            }
            lp.x = pos.first
            lp.y = pos.second
            ballX = lp.x
            ballY = lp.y
        }
        if (orbAttached) {
            try {
                wm.updateViewLayout(root, lp)
            } catch (e: Throwable) {
                Log.w(TAG, "updateViewLayout 失败：${e.message}")
            }
        }
        renderBar()
        if (shape == "ball") {
            armIdleCollapse()
            if (animate && riseOnBall) {
                riseOnBall = false
                riseToRest()
            }
        } else {
            cancelIdleCollapse()
        }
        if (animate && shape == "ball") {
            // 收拢回来时球「弹」一下（Overshoot），完成反向动效的收尾
            val b = o.ball
            b.animate().cancel()
            b.scaleX = 0.55f
            b.scaleY = 0.55f
            root.alpha = 0f
            root.animate().alpha(1f).setDuration(BALL_IN_MS).start()
            b.animate().scaleX(1f).scaleY(1f).translationY(0f)
                .setDuration(BALL_IN_MS)
                .setInterpolator(android.view.animation.OvershootInterpolator(1.7f))
                .start()
        } else if (animate) {
            root.alpha = 0.55f
            root.animate().alpha(1f).setDuration(150).start()
        } else {
            root.alpha = 1f
            o.ball.scaleX = 1f
            o.ball.scaleY = 1f
            o.ball.translationY = 0f
        }
    }

    private fun attachPanel(animate: Boolean): Boolean {
        val p = ensurePanel()
        if (panelAttached) return true
        val lp = panelLp ?: return false
        if (!addWindow(p.root, lp)) return false
        panelAttached = true
        renderMessages(rebuild = true)
        // 焦点交给容器（不是 EditText）：否则窗口一挂上系统就可能自动弹输入法
        try {
            p.input.clearFocus()
            p.content.requestFocus()
        } catch (_: Throwable) {
            /* 忽略 */
        }
        if (animate) {
            bloomPanel(p, lp)
        } else {
            p.root.animate().cancel()
            p.root.translationY = 0f
            p.root.alpha = 1f
            p.root.scaleY = 1f
            p.root.clipToOutline = false
            p.glow.alpha = 0f
        }
        // 面板打开时把排队中的本地回显补上（JS 权威状态到了会被整体重建）
        if (pendingEchoes.isNotEmpty()) {
            val queued = ArrayList(pendingEchoes)
            pendingEchoes.clear()
            for (m in queued) appendMessage(m)
        }
        return true
    }

    private fun detachPanel(animate: Boolean) {
        val p = panel ?: return
        if (!panelAttached) return
        val remove = Runnable {
            try {
                wm.removeView(p.root)
            } catch (_: Throwable) {
                /* 已被移除 */
            }
            panelAttached = false
        }
        if (animate) {
            collapsePanel(p, remove)
        } else {
            p.root.animate().cancel()
            p.root.translationY = 0f
            p.root.alpha = 1f
            p.root.scaleY = 1f
            p.root.clipToOutline = false
            p.glow.alpha = 0f
            remove.run()
        }
    }

    private fun wirePanel(p: PanelHolder) {
        p.collapseBtn.setOnClickListener { switchTo("ball", true) }
        // 回到 OneTHU：用户主动点击（红线只禁止「自动跳回」）
        p.backBtn.setOnClickListener { host.onOpenApp() }
        // 自动朗读开关：状态在 voicePrefs（JS/localStorage），原生只发意图 + 乐观改文案
        p.autoSpeakBtn.setOnClickListener {
            autoSpeak = !autoSpeak
            renderAutoSpeak()
            OverlayEvents.emit("toggleAutoSpeak", 0, 0, if (autoSpeak) "on" else "off")
        }
        renderAutoSpeak()
        // 输入行手感（真机反馈：「长按只是在输入框里面光标」）：
        //   单击 = 聚焦键盘（输入法只在用户点它时才弹，不再 onFocusChange 自动弹）
        //   长按 ≥450ms = 进语音（面板内就地出条：雾带 + 波纹 + 转写）
        //   按住上划 >110dp = 松手取消
        var inputHold = false
        var inputRun: Runnable? = null
        var inputDownY = 0f
        p.input.setOnTouchListener { v, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    inputDownY = e.rawY
                    inputHold = false
                    cancelArmed = false
                    cancelFollowUp()
                    val r = Runnable {
                        inputRun = null
                        inputHold = true
                        try {
                            v.performHapticFeedback(android.view.HapticFeedbackConstants.LONG_PRESS)
                        } catch (_: Throwable) {
                            /* 无马达 */
                        }
                        startVoiceFromPanel()
                    }
                    inputRun = r
                    main.postDelayed(r, HOLD_MS)
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    if (inputHold) {
                        val up = inputDownY - e.rawY
                        val armed = up > OverlayViews.dp(ctx, CANCEL_DP)
                        if (armed != cancelArmed) {
                            cancelArmed = armed
                            renderBar()
                        }
                    }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    inputRun?.let { main.removeCallbacks(it) }
                    inputRun = null
                    if (inputHold) {
                        if (cancelArmed) {
                            voice.cancel()
                            resetVoiceState()
                        } else {
                            voice.finish() // 松手整句直接发出
                        }
                        cancelArmed = false
                    } else {
                        showIme(p) // 单击才聚焦键盘
                    }
                    true
                }
                MotionEvent.ACTION_CANCEL -> {
                    inputRun?.let { main.removeCallbacks(it) }
                    inputRun = null
                    if (inputHold) {
                        voice.cancel()
                        resetVoiceState()
                    }
                    true
                }
                else -> false
            }
        }

        // 附件三入口（需求 6）：把「要哪种选择器」推给前端，前端调插件命令拉起系统选择器
        // （Tauri 的 activity result 只能经插件命令回传，见报告；发送链路仍只有 attach.ts 一条）
        p.camBtn.setOnClickListener { OverlayEvents.emit("attachRequest", 0, 0, "camera") }
        p.galBtn.setOnClickListener { OverlayEvents.emit("attachRequest", 0, 0, "gallery") }
        p.fileBtn.setOnClickListener { OverlayEvents.emit("attachRequest", 0, 0, "file") }
        p.input.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_SEND) {
                submitInput(p)
                true
            } else {
                false
            }
        }
        // 发送：点 = 发送；长按 = 说话（同一个裸文字入口，对齐「点击输入，长按说话」）
        var hold = false
        var run: Runnable? = null
        p.actionBtn.setOnTouchListener { v, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    hold = false
                    cancelArmed = false
                    downRawY = e.rawY
                    v.isPressed = true
                    val r = Runnable {
                        run = null
                        hold = true
                        v.performHapticFeedback(android.view.HapticFeedbackConstants.LONG_PRESS)
                        startVoiceFromPanel()
                    }
                    run = r
                    main.postDelayed(r, HOLD_MS)
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    if (hold) {
                        val up = downRawY - e.rawY
                        val armed = up > OverlayViews.dp(ctx, CANCEL_DP)
                        if (armed != cancelArmed) {
                            cancelArmed = armed
                            renderBar()
                        }
                    }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    v.isPressed = false
                    run?.let { main.removeCallbacks(it) }
                    run = null
                    if (hold) {
                        if (cancelArmed) {
                            voice.cancel()
                            resetVoiceState()
                        } else {
                            voice.finish()
                        }
                        cancelArmed = false
                    } else {
                        submitInput(p)
                    }
                    true
                }
                MotionEvent.ACTION_CANCEL -> {
                    v.isPressed = false
                    run?.let { main.removeCallbacks(it) }
                    run = null
                    if (hold) {
                        voice.cancel()
                        resetVoiceState()
                    }
                    true
                }
                else -> false
            }
        }
    }

    private fun submitInput(p: PanelHolder) {
        val t = p.input.text?.toString()?.trim().orEmpty()
        if (t.isEmpty()) return
        p.input.setText("")
        sendUserText(t)
    }

    /** 唯一发送通道：语音整句与键盘输入都走这里（task-11 ④：同一条通道） */
    private fun sendUserText(text: String) {
        val t = text.trim()
        if (t.isEmpty()) return
        val msg = PushMsg("user", t, emptyList(), "")
        if (panel == null || !panelAttached) pendingEchoes.add(msg) else appendMessage(msg, animate = true)
        host.onSubmitText(t)
    }

    /** 面板里长按说话：**不切窗**（切窗会摘掉手指正按着的面板 → ACTION_UP 丢失），
     *  改为面板内就地显示语音行（点点波纹 + 转写）。 */
    private fun startVoiceFromPanel() {
        cancelFollowUp()
        ensurePanel()
        voiceSource = "panel"
        showPanelVoice(true)
        voice.start()
    }

    private fun showIme(p: PanelHolder) {
        try {
            val imm = ctx.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
            p.input.requestFocus()
            p.input.post { imm.showSoftInput(p.input, InputMethodManager.SHOW_IMPLICIT) }
        } catch (_: Throwable) {
            /* 输入法不可用：退回键盘 action 发送 */
        }
    }

    /* ────────────────────────── OverlayVoice.Host ────────────────────────── */

    override fun onVoiceStart() {
        voiceState = "listening"
        barHint = ""
        voicePartial = ""
        host.onVoiceStart()
        main.removeCallbacks(voiceGuard)
        main.postDelayed(voiceGuard, VOICE_MAX_MS)
        renderBar()
    }

    override fun onVoiceEnd() {
        voiceState = "off"
        voiceLevel = 0f
        main.removeCallbacks(voiceGuard)
        showPanelVoice(false)
        host.onVoiceEnd()
        renderBar()
    }

    override fun onPartial(text: String) {
        voicePartial = text
        renderBar()
    }

    override fun onLevel(level: Float) {
        voiceLevel = level
        orb?.bar?.wave?.amplitude = level
    }

    override fun onFinal(text: String) {
        val t = text.trim()
        voicePartial = ""
        voiceLevel = 0f
        renderBar()
        scrollToBottom()
        if (t.isNotEmpty()) {
            cancelArmed = false
            showPanelVoice(false)
            // D③：松手 → 液体滴落到底部 → 展开成统一小窗（不是直接弹面板）
            if (orbAttached) dropletThenBloom() else setMode("panel")
            sendUserText(t)
        } else {
            barHint = "没听清，再说一次"
            renderBar()
            scheduleFollowUp(1200L) {
                barHint = ""
                renderBar()
                switchTo("ball", true)
            }
        }
    }

    override fun onUnavailable(reason: String) {
        barHint = if (reason.startsWith("此环境") || reason.contains("麦克风")) {
            OverlayVoice.UNAVAILABLE_ROM
        } else {
            reason
        }
        voicePartial = ""
        voiceLevel = 0f
        renderBar()
        // 不静默：条内（或面板内语音行）给文案，1.4s 后自动展开面板，用户可以直接打字
        scheduleFollowUp(1400L) {
            if (barHint.isNotEmpty()) {
                barHint = ""
                showPanelVoice(false)
                renderBar()
                setMode("panel")
            }
        }
    }

    /* ────────────────────────── 球/条手势 ────────────────────────── */

    private fun onOrbTouch(v: View, e: MotionEvent): Boolean {
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                downRawX = e.rawX
                downRawY = e.rawY
                startBallX = ballX
                startBallY = ballY
                moved = false
                holdFired = false
                cancelArmed = false
                expandedFromSide = false
                cancelFollowUp()
                cancelIdleCollapse()
                if (orbShape == "side") {
                    // 点/按侧边条：先丝滑展开回悬浮球（长按仍可继续进入语音）
                    expandedFromSide = true
                    applyOrbShape("ball", animate = true)
                }
                if (modeCur != "bar") armHold()
            }
            MotionEvent.ACTION_MOVE -> {
                val dx = e.rawX - downRawX
                val dy = e.rawY - downRawY
                if (!moved && (abs(dx) > slop || abs(dy) > slop)) {
                    moved = true
                    if (modeCur != "bar") cancelHold()
                }
                if (holdFired && modeCur == "bar") {
                    val up = downRawY - e.rawY
                    val armed = up > OverlayViews.dp(ctx, CANCEL_DP)
                    if (armed != cancelArmed) {
                        cancelArmed = armed
                        renderBar()
                    }
                } else if (moved && !holdFired && modeCur == "ball" && orbShape == "ball") {
                    val lp = orbLp
                    if (lp != null) {
                        val ballPx = ballWinPx()
                        lp.x = clampX((startBallX + dx).toInt(), ballPx)
                        lp.y = clampY((startBallY + dy).toInt(), ballPx)
                        ballX = lp.x
                        ballY = lp.y
                        if (orbAttached) {
                            try {
                                wm.updateViewLayout(v, lp)
                            } catch (_: Throwable) {
                                /* 瞬态 */
                            }
                        }
                        val now = System.currentTimeMillis()
                        if (now - lastDragEmit > 80) {
                            lastDragEmit = now
                            OverlayEvents.emit("drag", lp.x, lp.y)
                        }
                    }
                }
            }
            MotionEvent.ACTION_UP -> {
                cancelHold()
                val wasHold = holdFired
                holdFired = false
                when {
                    wasHold && cancelArmed -> { // 上划取消：不发任何内容
                        cancelArmed = false
                        voice.cancel()
                        resetVoiceState()
                        setMode("ball")
                    }
                    wasHold -> voice.finish() // 松手判定：等最终结果 → onFinal → 面板 + 发一句
                    moved -> {
                        OverlayPrefs.setBall(ctx, ballX, ballY, screenW(), screenH())
                        snapToNearestEdge(v)
                    }
                    expandedFromSide -> {
                        // 只是把侧边条展开成球，不开面板
                        expandedFromSide = false
                        armIdleCollapse()
                    }
                    else -> togglePanel()
                }
            }
            MotionEvent.ACTION_CANCEL -> {
                cancelHold()
                if (holdFired) {
                    holdFired = false
                    cancelArmed = false
                    voice.cancel()
                    resetVoiceState()
                    setMode("ball")
                }
            }
        }
        return true
    }

    /**
     * 开：**液态滴落 → 自由晕开**。球先形变缩成液滴并下落（球窗内），
     * 随后切到面板窗：圆角半径从「一团液滴」收敛、整体轻微上浮放大、光晕淡出。
     * 总时长 DROP_MS + BLOOM_MS ≈ 430ms（在用户要求的 380–460ms 内）。
     */
    private fun dropletThenBloom() {
        val o = orb
        val lp = orbLp
        if (o == null || lp == null || suspended || !orbAttached) {
            switchTo("panel", true)
            return
        }
        cancelIdleCollapse()
        val origX = lp.x
        val origY = lp.y
        val endY = (screenH() - lp.height).coerceAtLeast(0)
        // 落点略向屏幕中轴靠（面板的雾从底部铺开，落点在边缘会显得脱节）
        val endX = (origX + (screenW() - lp.width) / 2f * 0.55f).toInt()
        val anim = android.animation.ValueAnimator.ofFloat(0f, 1f).setDuration(FALL_MS)
        anim.interpolator = android.view.animation.AccelerateInterpolator(1.5f)
        anim.addUpdateListener { a ->
            val t = a.animatedValue as Float
            lp.y = (origY + (endY - origY) * t).toInt()
            lp.x = (origX + (endX - origX) * t).toInt()
            // 液滴形变：横向收窄、纵向拉长（中段最长）——作用于**当前可见的那个子视图**
            val vis = visibleOrbChild()
            val squeeze = (t * 1.5f).coerceAtMost(1f)
            vis?.let {
                it.scaleX = 1f - 0.45f * squeeze
                it.scaleY = 1f + 0.55f * kotlin.math.sin(t * Math.PI).toFloat()
            }
            if (orbAttached) {
                try {
                    wm.updateViewLayout(o.root, lp)
                } catch (_: Throwable) {
                    /* 瞬态 */
                }
            }
        }
        anim.addListener(object : android.animation.AnimatorListenerAdapter() {
            override fun onAnimationEnd(animation: android.animation.Animator) {
                // 窗口坐标复位（球的原位置由 ballX/ballY 保留，落点只是动画）
                lp.x = origX
                lp.y = origY
                visibleOrbChild()?.let {
                    it.scaleX = 1f
                    it.scaleY = 1f
                }
                if (!suspended) switchTo("panel", true)
            }
        })
        anim.start()
    }

    /** 面板晕开：圆角半径动画（液滴→面板圆角）+ 上浮放大 + 光晕淡出 */
    private fun bloomPanel(p: PanelHolder, lp: WindowManager.LayoutParams) {
        val endR = OverlayViews.dp(ctx, 22).toFloat()
        val startR = lp.height * 0.40f
        p.root.clipToOutline = true
        val anim = android.animation.ValueAnimator.ofFloat(1f, 0f).setDuration(BLOOM_MS)
        anim.interpolator = DecelerateInterpolator()
        anim.addUpdateListener { a ->
            val t = a.animatedValue as Float
            val r = endR + (startR - endR) * t
            p.root.outlineProvider = object : android.view.ViewOutlineProvider() {
                override fun getOutline(view: View, outline: android.graphics.Outline) {
                    outline.setRoundRect(0, 0, view.width, view.height, r)
                }
            }
            p.root.invalidateOutline()
        }
        anim.addListener(object : android.animation.AnimatorListenerAdapter() {
            override fun onAnimationEnd(animation: android.animation.Animator) {
                // 收尾：撤掉裁剪，恢复常规圆角绘制（避免长期 clip 影响后续布局）
                p.root.clipToOutline = false
            }
        })
        anim.start()
        p.root.alpha = 0f
        p.root.scaleY = 0.80f
        p.root.translationY = lp.height * 0.24f
        p.root.animate().alpha(1f).scaleY(1f).translationY(0f)
            .setDuration(BLOOM_MS)
            .setInterpolator(android.view.animation.OvershootInterpolator(0.9f))
            .start()
        p.glow.alpha = 0.45f
        p.glow.animate().alpha(0f).setDuration(BLOOM_MS + 140).start()
    }

    /** 关：反向收拢（面板缩回一团 → 淡出），随后球弹回来 */
    private fun collapsePanel(p: PanelHolder, remove: Runnable) {
        val endR = OverlayViews.dp(ctx, 22).toFloat()
        val blobR = p.root.height * 0.34f
        p.root.clipToOutline = true
        val anim = android.animation.ValueAnimator.ofFloat(0f, 1f).setDuration(COLLAPSE_MS)
        anim.interpolator = android.view.animation.AccelerateInterpolator()
        anim.addUpdateListener { a ->
            val t = a.animatedValue as Float
            val r = endR + (blobR - endR) * t
            p.root.outlineProvider = object : android.view.ViewOutlineProvider() {
                override fun getOutline(view: View, outline: android.graphics.Outline) {
                    outline.setRoundRect(0, 0, view.width, view.height, r)
                }
            }
            p.root.invalidateOutline()
        }
        anim.start()
        p.glow.alpha = 0.32f
        p.glow.animate().alpha(0f).setDuration(COLLAPSE_MS).start()
        p.root.animate()
            .alpha(0.05f)
            .scaleY(0.72f)
            .translationY(p.root.height * 0.30f)
            .setDuration(COLLAPSE_MS)
            .setInterpolator(DoublingInterpolator())
            .withEndAction {
                p.root.alpha = 1f
                p.root.scaleY = 1f
                p.root.translationY = 0f
                p.root.clipToOutline = false
                remove.run()
            }
            .start()
    }

    /** 关动画用的缓动：先慢后快再收（比线性更像液体收拢） */
    private class DoublingInterpolator : android.view.animation.Interpolator {
        override fun getInterpolation(t: Float): Float = t * t * (3f - 2f * t) * 0.35f + t * 0.65f
    }

    /** 点球：球 → 面板（滴落+晕开）；面板 → 球（收拢+弹回）。
     *
     *  事件口径：**只在「打开面板」时回传 tap**，收起时不发——前端 GlobalOrb 的 tap 处理器
     *  存在 stale closure（永远发 overlaySetMode("panel")），收起时若也发 tap 会被它立刻重新
     *  打开。安卓侧的形态权威在原生（用户看到的就是原生 UI），因此收起保持静默。 */
    private fun togglePanel() {
        if (modeCur == "panel") {
            setMode("ball")
        } else {
            OverlayEvents.emit("tap", ballX, ballY)
            dropletThenBloom()
        }
    }

    private fun armHold() {
        cancelHold()
        val r = Runnable {
            holdRun = null
            holdFired = true
            cancelArmed = false
            val o = orb ?: return@Runnable
            try {
                o.root.performHapticFeedback(android.view.HapticFeedbackConstants.LONG_PRESS)
            } catch (_: Throwable) {
                /* 无马达 */
            }
            modeCur = "bar"
            memoryMode()
            voiceSource = "orb"
            applyOrbShape("bar", animate = true)
            voice.start() // 能力探测在里面；取不到麦会走 onUnavailable（条内文案 + 展开面板）
        }
        holdRun = r
        main.postDelayed(r, HOLD_MS)
    }

    private fun cancelHold() {
        holdRun?.let { main.removeCallbacks(it) }
        holdRun = null
    }

    private fun snapToNearestEdge(v: View) {
        val lp = orbLp ?: return
        val ballPx = ballWinPx()
        val target = clampX(
            if (lp.x + ballPx / 2 < screenW() / 2) 0 else (screenW() - ballPx),
            ballPx,
        )
        if (lp.x == target) {
            placedOnce = true
            OverlayPrefs.setBall(ctx, lp.x, lp.y, screenW(), screenH())
            return
        }
        val anim = ValueAnimator.ofInt(lp.x, target).setDuration(180)
        anim.interpolator = DecelerateInterpolator()
        anim.addUpdateListener { a ->
            val value = a.animatedValue as Int
            lp.x = value
            ballX = value
            if (orbAttached) {
                try {
                    wm.updateViewLayout(v, lp)
                } catch (_: Throwable) {
                    /* 瞬态 */
                }
            }
        }
        anim.addListener(object : android.animation.AnimatorListenerAdapter() {
            override fun onAnimationEnd(animation: android.animation.Animator) {
                ballX = lp.x
                ballY = lp.y
                placedOnce = true
                OverlayPrefs.setBall(ctx, lp.x, lp.y, screenW(), screenH())
                OverlayEvents.emit("drag", lp.x, lp.y)
                // B①：吸附动画一结束**立即**缩成侧边按钮（不再等 1.2s）
                if (!suspended && modeCur == "ball" && orbShape == "ball" && !moved && !holdFired) {
                    applyOrbShape("side", animate = true)
                }
            }
        })
        anim.start()
    }

    /* ────────────────────────── 参数 / 工具 ────────────────────────── */

    /** 球窗边长（球 54dp + 投影留白 16dp） */
    private fun ballWinPx(): Int = OverlayViews.dp(ctx, OverlayViews.BALL_WIN_DP)

    private fun overlayType(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }

    private fun orbParams(): WindowManager.LayoutParams {
        val ballPx = ballWinPx()
        val lp = WindowManager.LayoutParams(
            ballPx,
            ballPx,
            overlayType(),
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
            PixelFormat.TRANSLUCENT,
        )
        lp.gravity = Gravity.TOP or Gravity.START
        refreshScreen()
        val pos = loadBallPos(ballPx)
        lp.x = clampX(pos.first, ballPx)
        lp.y = clampY(pos.second, ballPx)
        ballX = lp.x
        ballY = lp.y
        return lp
    }

    /**
     * 面板窗（task-15 A①）：**悬浮小窗** —— 左右各留 PANEL_MARGIN_DP 空隙、高度 PANEL_RATIO 不到半屏、
     * 四周圆角（雾层里裁），窗口依旧 TRANSLUCENT、按内容算尺寸（不用 MATCH_PARENT）。
     */
    private fun panelParams(): WindowManager.LayoutParams {
        val margin = OverlayViews.dp(ctx, PANEL_MARGIN_DP)
        val w = (screenW() - 2 * margin).coerceAtLeast(OverlayViews.dp(ctx, 240))
        val h = (screenH() * PANEL_RATIO).toInt()
        val lp = WindowManager.LayoutParams(
            w,
            h,
            overlayType(),
            // 不设 FLAG_NOT_FOCUSABLE：输入框要焦点与输入法；
            // FLAG_NOT_TOUCH_MODAL：面板以外的触摸照常落给下面的应用
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
            PixelFormat.TRANSLUCENT,
        )
        lp.gravity = Gravity.TOP or Gravity.START
        lp.x = margin
        lp.y = (screenH() - h - margin).coerceAtLeast(OverlayViews.dp(ctx, 24))
        // ADJUST_RESIZE 让面板能被键盘顶起；STATE_ALWAYS_HIDDEN 明确「不自动弹」
        lp.softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE or
            WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN
        return lp
    }

    private fun addWindow(v: View, lp: WindowManager.LayoutParams): Boolean {
        return try {
            wm.addView(v, lp)
            true
        } catch (e: Throwable) {
            Log.w(TAG, "addView 失败：${e.message}")
            false
        }
    }

    /**
     * 屏幕尺寸（悬浮层可用区域）。
     * 优先 `WindowManager.currentWindowMetrics.bounds`（API 30+，悬浮窗的真实边界），
     * 取不到或数值不合理（<320dp）时回落 displayMetrics —— 真机上出现过窗口被算成 215×215
     * 的小方块，必须挡住这种坏值。结果缓存，窗口创建/主题切换时刷新。
     */
    private fun screenSize(): Pair<Int, Int> {
        if (cachedW > 0 && cachedH > 0) return cachedW to cachedH
        val minPx = OverlayViews.dp(ctx, 320)
        var w = 0
        var h = 0
        if (Build.VERSION.SDK_INT >= 30) {
            try {
                val b = wm.currentWindowMetrics.bounds
                w = b.width()
                h = b.height()
            } catch (_: Throwable) {
                w = 0
                h = 0
            }
        }
        if (w < minPx || h < minPx) {
            val dw = ctx.resources.displayMetrics.widthPixels
            val dh = ctx.resources.displayMetrics.heightPixels
            if (dw >= minPx && dh >= minPx) {
                w = dw
                h = dh
            }
        }
        if (w < minPx || h < minPx) {
            // 两个来源都不合理：兜一个保守的常见尺寸，宁可位置略偏也不要出小方块
            w = minPx
            h = OverlayViews.dp(ctx, 640)
            Log.w(TAG, "屏幕尺寸异常，回落保守值 ${w}x$h")
        }
        cachedW = w
        cachedH = h
        return w to h
    }

    private fun refreshScreen() {
        cachedW = 0
        cachedH = 0
        screenSize()
    }

    private fun screenW(): Int = screenSize().first

    private fun screenH(): Int = screenSize().second

    /**
     * 默认位置：**右侧、导航栏上方** —— 按**球本体**算「球右边缘距屏右 12dp、球下边缘距屏底 128dp」。
     *
     * 代数（ballPx = 球窗边长 = 球径 + 2×inset，球在窗口内居中；inset = 8dp）：
     *   球的右边缘 = x + inset + 球径 = w - 12dp   →   x = w - ballPx - 12dp + inset
     *   球的下边缘 = y + inset + 球径 = h - 128dp  →   y = h - ballPx - 128dp + inset
     * 实机 1264×2800 @560dpi：球窗 245px、球径 189px、inset 28px
     *   → x = 1005（球右边缘距屏右 42px = 12dp）、y = 2135（球下边缘距屏底 448px = 128dp）。
     * 自查方式：`overlay_status` 的 workW/workH/ballX/ballY 应打出 1264/2800/1005/2135。
     */
    private fun defaultBallPos(ballPx: Int): Pair<Int, Int> {
        val (w, h) = screenSize()
        val inset = OverlayViews.dp(ctx, (OverlayViews.BALL_WIN_DP - OverlayViews.BALL_DP) / 2)
        val x = (w - ballPx - OverlayViews.dp(ctx, 12) + inset).coerceAtLeast(0)
        val y = (h - ballPx - OverlayViews.dp(ctx, 128) + inset)
            .coerceAtLeast(OverlayViews.dp(ctx, 24))
        return x to y
    }

    /**
     * 读回上次的球位置；**非法/越界一律回落默认并顺手修掉存档**
     * （真机实录：重启后球落在 x=0 左边缘垂直中部，看着像默认值算错）。
     */
    private fun loadBallPos(ballPx: Int): Pair<Int, Int> {
        val (w, h) = screenSize()
        val def = defaultBallPos(ballPx)
        val sx = OverlayPrefs.ballX(ctx)
        val sy = OverlayPrefs.ballY(ctx)
        val sw = OverlayPrefs.ballScreenW(ctx)
        val sh = OverlayPrefs.ballScreenH(ctx)
        val fmt = OverlayPrefs.ballFormat(ctx)

        // ① 没有存档：直接用默认（右侧、导航栏上方）
        if (sx == Int.MIN_VALUE || sy == Int.MIN_VALUE) {
            placedOnce = false
            OverlayPrefs.setBall(ctx, def.first, def.second, w, h)
            Log.i(TAG, "球无存档 → 默认 right12/bottom128 = (${def.first},${def.second}) 屏 ${w}x$h")
            return def
        }
        // ② 旧格式（无屏幕尺寸）或屏幕尺寸变了：坐标不可比 → 作废、回落默认并**改写存档**
        if (fmt != OverlayPrefs.BALL_FMT || sw != w || sh != h) {
            Log.w(
                TAG,
                "球位置存档作废（fmt=$fmt 存档屏 ${sw}x$sh 当前 ${w}x$h 存档 $sx,$sy）→ 回落默认并改写",
            )
            OverlayPrefs.setBall(ctx, def.first, def.second, w, h)
            placedOnce = false
            return def
        }
        // ③ 越界：同样回落默认并改写
        if (sx < 0 || sy < 0 || sx > w - ballPx || sy > h - ballPx) {
            Log.w(TAG, "存档球坐标越界（$sx,$sy 屏 ${w}x$h 球窗 ${ballPx}px）→ 回落默认并改写")
            OverlayPrefs.setBall(ctx, def.first, def.second, w, h)
            placedOnce = false
            return def
        }
        placedOnce = true
        Log.i(TAG, "球用存档位置 ($sx,$sy) 屏 ${w}x$h")
        return sx to sy
    }

    private fun clampX(x: Int, ballPx: Int): Int = x.coerceIn(0, (screenW() - ballPx).coerceAtLeast(0))

    private fun clampY(y: Int, ballPx: Int): Int {
        val lo = OverlayViews.dp(ctx, 24)
        return y.coerceIn(lo, (screenH() - ballPx - OverlayViews.dp(ctx, 8)).coerceAtLeast(lo))
    }

    companion object {
        const val TAG = "OnethuOverlay"
        const val HOLD_MS = 450L
        const val CANCEL_DP = 110
        /** 液态滴落（球形变+下落）时长 */
        const val DROP_MS = 150L

        /** 晕开（圆角半径动画 + 上浮放大 + 光晕）时长 */
        const val BLOOM_MS = 280L

        /** 反向收拢时长 */
        const val COLLAPSE_MS = 260L

        /** 球弹回时长 */
        const val BALL_IN_MS = 200L

        /** 空闲多久自动缩回侧边条（用户反馈等太久 → 从 10s 收紧到 6s；拖到边缘那条路径是立即的） */
        const val IDLE_COLLAPSE_MS = 6_000L

        /** 液滴下落到屏幕底部的时长 */
        const val FALL_MS = 170L

        /** 从落点升回原位的时长（关动画后半段） */
        const val RISE_MS = 200L

        /** 等待回复超过这个时长就停转圈、改显示可读状态（E） */
        const val BUSY_TIMEOUT_MS = 40_000L

        /** 看门狗轮询间隔 */
        const val BUSY_POLL_MS = 5_000L

        /** 面板高度占比（A①：不到半屏的小窗） */
        const val PANEL_RATIO = 0.44f

        /** 面板左右（与底部）留的空隙 */
        const val PANEL_MARGIN_DP = 14

        /** 语音条最长 30s：万一抬手事件丢了，也不至于永远占着麦 */
        const val VOICE_MAX_MS = 30_000L
    }
}
