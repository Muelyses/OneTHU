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
    private var barHint = ""
    private var busyNow = false

    fun mode(): String = if (suspended) "hidden" else modeCur

    fun isShowing(): Boolean = !suspended && (orbAttached || panelAttached)

    /* ────────────────────────── 对外形态控制 ────────────────────────── */

    /** 显示悬浮层：**默认只出球**（task-11 ③：未点击时不允许有任何面板/雾块） */
    fun showBallOnly() {
        dark = OverlayViews.isDarkUi(ctx)
        modeCur = "ball"
        ensureOrb()
        detachPanel(false)
        if (!suspended) {
            attachOrb()
            applyOrbShape("ball", animate = false)
        }
        memoryMode()
    }

    /** 前端 overlay_set_mode 落到这里；幂等 */
    fun setMode(m: String) {
        when (m) {
            "hidden" -> hide()
            "panel" -> {
                modeCur = "panel"
                memoryMode()
                if (suspended) return
                attachPanel(true)
                raiseOrb() // 球留在面板之上：再点球就能收起（task-11 ③）
            }
            "bar" -> {
                modeCur = "bar"
                memoryMode()
                if (suspended) return
                ensureOrb()
                attachOrb()
                applyOrbShape("bar", animate = true)
            }
            else -> {
                modeCur = "ball"
                memoryMode()
                if (suspended) return
                ensureOrb()
                attachOrb()
                applyOrbShape("ball", animate = true)
                detachPanel(true)
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
        voiceState = "off"
        voicePartial = ""
        voiceLevel = 0f
        barHint = ""
        cancelArmed = false
        renderBar()
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
        val o = orb ?: return
        o.wave.amplitude = voiceLevel
        o.wave.animating = voiceState == "listening"
        val t = when {
            cancelArmed -> "松开取消"
            barHint.isNotEmpty() -> barHint
            voicePartial.isNotEmpty() -> voicePartial
            voiceState == "listening" -> "在听，请讲…"
            jsTranscript.isNotEmpty() -> jsTranscript
            else -> "长按说话"
        }
        o.barText.text = t
    }

    /* ────────────────────────── 窗口建立 / 形态 ────────────────────────── */

    private fun ensureOrb() {
        if (orb != null) return
        val root = OverlayViews.windowRoot(themed)
        val ballPair = OverlayViews.buildBall(themed, dark)
        val barTriple = OverlayViews.buildBar(themed, dark)
        root.setOnTouchListener { v, e -> onOrbTouch(v, e) }
        orb = OrbHolder(root, ballPair.first, ballPair.second, barTriple.first, barTriple.second, barTriple.third)
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

    /** 面板打开时把球提到最上层（再点球 = 收起） */
    private fun raiseOrb() {
        val o = orb ?: return
        val lp = orbLp ?: return
        if (!orbAttached) {
            attachOrb()
            return
        }
        try {
            wm.removeView(o.root)
        } catch (_: Throwable) {
            /* 已被移除 */
        }
        orbAttached = false
        if (addWindow(o.root, lp)) orbAttached = true
    }

    /** 球 ↔ 条：同一个透明根，换子 View + 改窗口尺寸/位置 */
    private fun applyOrbShape(shape: String, animate: Boolean) {
        val lp = orbLp ?: return
        val o = orb ?: return
        val root = o.root
        val ballPx = OverlayViews.dp(ctx, OverlayViews.BALL_DP)
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
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT,
                ),
            )
            lp.width = ballPx
            lp.height = ballPx
            val p = defaultBallPos(ballPx)
            lp.x = clampX(if (placedOnce) ballX else p.first, ballPx)
            lp.y = clampY(if (placedOnce) ballY else p.second, ballPx)
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
        p.input.setOnClickListener { showIme(p) }
        p.input.setOnFocusChangeListener { _, has -> if (has) showIme(p) }
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

    private fun startVoiceFromPanel() {
        ensurePanel()
        setMode("bar") // 条盖在面板之上（球窗在面板之后挂载）
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
            setMode("panel")
            sendUserText(t)
        } else {
            barHint = "没听清，再说一次"
            renderBar()
            main.postDelayed({
                barHint = ""
                renderBar()
                setMode("ball")
            }, 1200L)
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
        // 不静默：条内给文案，1.4s 后自动展开面板，用户可以直接打字
        main.postDelayed({
            if (barHint.isNotEmpty()) {
                barHint = ""
                setMode("panel")
            }
        }, 1400L)
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
                        val ballPx = OverlayViews.dp(ctx, OverlayViews.BALL_DP)
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
        val ballPx = OverlayViews.dp(ctx, OverlayViews.BALL_DP)
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

    private fun overlayType(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }

    private fun orbParams(): WindowManager.LayoutParams {
        val ballPx = OverlayViews.dp(ctx, OverlayViews.BALL_DP)
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
        val def = defaultBallPos(ballPx)
        val sx = OverlayPrefs.ballX(ctx)
        val sy = OverlayPrefs.ballY(ctx)
        placedOnce = sx != Int.MIN_VALUE && sy != Int.MIN_VALUE
        lp.x = clampX(if (placedOnce) sx else def.first, ballPx)
        lp.y = clampY(if (placedOnce) sy else def.second, ballPx)
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
        lp.softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
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

    private fun screenW(): Int = ctx.resources.displayMetrics.widthPixels

    private fun screenH(): Int = ctx.resources.displayMetrics.heightPixels

    private fun defaultBallPos(ballPx: Int): Pair<Int, Int> =
        Pair((screenW() - ballPx - OverlayViews.dp(ctx, 6)).coerceAtLeast(0), screenH() / 3)

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

        /** 面板高度占比（task-11 ③：约下半屏 46%） */
        const val PANEL_RATIO = 0.46f

        /** 语音条最长 30s：万一抬手事件丢了，也不至于永远占着麦 */
        const val VOICE_MAX_MS = 30_000L
    }
}
