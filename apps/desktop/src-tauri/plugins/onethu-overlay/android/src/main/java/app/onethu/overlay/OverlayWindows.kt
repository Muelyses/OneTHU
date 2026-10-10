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
    }

    private val wm = ctx.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    private val themed = ContextThemeWrapper(ctx, android.R.style.Theme_DeviceDefault)
    private val main = Handler(Looper.getMainLooper())
    private val slop = ViewConfiguration.get(ctx).scaledTouchSlop
    private val voice = OverlayVoice(ctx, this)

    private var dark = OverlayViews.isDarkUi(ctx)
    private var modeCur = "ball"
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
        ensureOrb()
        detachPanel(false)
        if (!suspended) {
            detachOrb()
            attachOrb()
            applyOrbShape("ball", animate = false)
        }
        memoryMode()
        enforceSingleWindow()
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
                detachOrb()
                attachPanel(animate)
                modeCur = "panel"
            }
            "bar" -> {
                detachPanel(false)
                ensureOrb()
                attachOrb()
                applyOrbShape("bar", animate)
                modeCur = "bar"
            }
            else -> {
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
        busyNow = o.optBoolean("busy", busyNow)
        jsTranscript = o.optString("transcript", jsTranscript)
        if (changed) renderMessages(rebuild = true)
        renderBar()
    }

    private fun renderMessages(rebuild: Boolean) {
        val p = panel ?: return
        if (rebuild) {
            p.list.removeAllViews()
            val arr = try {
                org.json.JSONArray(messagesJson)
            } catch (_: Throwable) {
                org.json.JSONArray()
            }
            for (i in 0 until arr.length()) {
                val m = arr.optJSONObject(i) ?: continue
                val text = m.optString("text", "")
                if (text.isEmpty()) continue
                appendMessageView(text, m.optString("role", "oh"))
            }
            if (busyNow) appendMessageView("…", "oh")
        }
        p.empty.visibility = if (p.list.childCount == 0) View.VISIBLE else View.GONE
        if (rebuild) p.scroll.post { p.scroll.fullScroll(View.FOCUS_DOWN) }
    }

    private fun appendMessageView(text: String, role: String) {
        val p = panel ?: return
        val maxW = (screenW() * 0.84f).toInt()
        val v = OverlayViews.buildMessage(themed, text, role, dark, maxW)
        val lp = android.widget.LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        )
        lp.bottomMargin = OverlayViews.dp(ctx, OverlayViews.GAP_DP)
        p.list.addView(v, lp)
        p.empty.visibility = View.GONE
        p.scroll.post { p.scroll.fullScroll(View.FOCUS_DOWN) }
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
            it.wave.amplitude = voiceLevel
            it.wave.animating = voiceState == "listening" && voiceSource == "orb"
            it.barText.text = t
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
        val barTriple = OverlayViews.buildBar(themed, dark)
        root.setOnTouchListener { v, e -> onOrbTouch(v, e) }
        orb = OrbHolder(root, ball, barTriple.first, barTriple.second, barTriple.third)
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

    /** 球 ↔ 条：同一个透明根，换子 View + 改窗口尺寸/位置 */
    private fun applyOrbShape(shape: String, animate: Boolean) {
        val lp = orbLp ?: return
        val o = orb ?: return
        val root = o.root
        val ballPx = ballWinPx()
        val barPx = OverlayViews.dp(ctx, OverlayViews.BAR_DP)

        root.removeAllViews()
        if (shape == "bar") {
            root.addView(
                o.bar,
                FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT,
                ),
            )
            lp.width = screenW()
            lp.height = barPx
            lp.x = 0
            lp.y = (screenH() - barPx - OverlayViews.dp(ctx, 14)).coerceAtLeast(0)
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
        if (animate) {
            root.alpha = 0.55f
            root.animate().alpha(1f).setDuration(150).start()
        } else {
            root.alpha = 1f
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
            p.root.translationY = lp.height.toFloat()
            p.root.animate().translationY(0f)
                .setDuration(SLIDE_MS).setInterpolator(DecelerateInterpolator()).start()
        } else {
            p.root.animate().cancel()
            p.root.translationY = 0f
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
            p.root.animate().translationY(p.root.height.toFloat())
                .setDuration(SLIDE_OUT_MS).setInterpolator(DecelerateInterpolator())
                .withEndAction(remove).start()
        } else {
            p.root.animate().cancel()
            p.root.translationY = 0f
            remove.run()
        }
    }

    private fun wirePanel(p: PanelHolder) {
        p.closeBtn.setOnClickListener { host.onCloseRequested() }
        p.collapseBtn.setOnClickListener { switchTo("ball", true) }
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
        appendMessageView(t, "user")
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
        val o = orb ?: return
        o.wave.amplitude = level
    }

    override fun onFinal(text: String) {
        val t = text.trim()
        voicePartial = ""
        voiceLevel = 0f
        renderBar()
        if (t.isNotEmpty()) {
            cancelArmed = false
            showPanelVoice(false)
            setMode("panel")
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
                cancelFollowUp()
                if (modeCur != "bar") armHold()
                true
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
                } else if (moved && !holdFired && modeCur == "ball") {
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
                true
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
                        OverlayPrefs.setBall(ctx, ballX, ballY)
                        snapToNearestEdge(v)
                    }
                    else -> togglePanel()
                }
                true
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
                true
            }
        }
        return true
    }

    /** 点球：球 → 面板；面板 → 球（task-11 ③：再点收起）。
     *
     *  事件口径：**只在「打开面板」时回传 tap**，收起时不发——前端 GlobalOrb 的 tap 处理器
     *  存在 stale closure（永远发 overlaySetMode("panel")），收起时若也发 tap 会被它立刻重新
     *  打开。安卓侧的形态权威在原生（用户看到的就是原生 UI），因此收起保持静默。 */
    private fun togglePanel() {
        if (modeCur == "panel") {
            setMode("ball")
        } else {
            OverlayEvents.emit("tap", ballX, ballY)
            setMode("panel")
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
            OverlayPrefs.setBall(ctx, lp.x, lp.y)
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
                placedOnce = true
                OverlayPrefs.setBall(ctx, lp.x, lp.y)
                OverlayEvents.emit("drag", lp.x, lp.y)
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

    /** 面板窗：**尺寸按内容算**（屏宽 × 屏高 46%），TRANSLUCENT，无任何背景色 */
    private fun panelParams(): WindowManager.LayoutParams {
        val h = (screenH() * PANEL_RATIO).toInt()
        val lp = WindowManager.LayoutParams(
            screenW(),
            h,
            overlayType(),
            // 不设 FLAG_NOT_FOCUSABLE：输入框要焦点与输入法；
            // FLAG_NOT_TOUCH_MODAL：面板以外的触摸照常落给下面的应用
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
            PixelFormat.TRANSLUCENT,
        )
        lp.gravity = Gravity.BOTTOM or Gravity.START
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

    /** 默认位置：**右侧、导航栏上方** —— 按**球**（不是球窗）算 right 12dp / bottom 128dp，
     *  再把窗口留白（BALL_WIN - BALL）/2 = 8dp 补偿回去，保证视觉上就是 12/128。 */
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
        val def = defaultBallPos(ballPx)
        val sx = OverlayPrefs.ballX(ctx)
        val sy = OverlayPrefs.ballY(ctx)
        if (sx == Int.MIN_VALUE || sy == Int.MIN_VALUE) {
            placedOnce = false
            return def
        }
        val (w, h) = screenSize()
        val ok = sx in 0..(w - ballPx) && sy in 0..(h - ballPx)
        if (!ok) {
            Log.w(TAG, "存档球坐标越界（$sx,$sy 屏 ${w}x$h）→ 回落默认并修掉")
            OverlayPrefs.setBall(ctx, def.first, def.second)
            placedOnce = false
            return def
        }
        placedOnce = true
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
        const val SLIDE_MS = 240L
        const val SLIDE_OUT_MS = 160L

        /** 面板高度占比：半屏（雾要铺满整块面板） */
        const val PANEL_RATIO = 0.50f

        /** 语音条最长 30s：万一抬手事件丢了，也不至于永远占着麦 */
        const val VOICE_MAX_MS = 30_000L
    }
}
