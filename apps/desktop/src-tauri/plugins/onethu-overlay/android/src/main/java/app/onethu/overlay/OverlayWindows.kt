// OneTHU 悬浮层：窗口与手势（View + WindowManager）。
//
// 两个窗口：
//   ① 球/条窗口：52dp 圆 ↔ 全宽 56dp 语音条，同一个根 View（形态切换只换子 View，
//      所以「长按 → 变条 → 抬手」这一串手势流不会被窗口重建打断）；
//   ② 面板窗口：半屏、可聚焦（要输入法），面板打开时把球窗口摘掉。
//
// 手势语义（回传前端的 onethu-overlay 事件）：
//   tap     单击球（含原生就地展开面板）      hold    长按 ≥450ms（进入语音条）
//   release 语音条抬手（说完）               drag    拖动中（节流 80ms，带屏幕坐标）
//   submit  面板输入框发一句话（带 text）     closed  本次关闭悬浮球
//   球松手吸附最近的左右边框；位置记进 OverlayPrefs。
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

class OverlayWindows(private val ctx: Context, private val host: Host) {

    interface Host {
        /** 面板上的「本次关闭悬浮球」→ 服务执行真正关闭（停服务 + 持久化 + emit closed） */
        fun onCloseRequested()

        /** 面板输入框的一句话 → 服务 emit 事件 submit{text} 交给前端 askOh */
        fun onSubmitText(text: String)
    }

    private val wm = ctx.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    private val themed = ContextThemeWrapper(ctx, android.R.style.Theme_DeviceDefault)
    private val main = Handler(Looper.getMainLooper())
    private val slop = ViewConfiguration.get(ctx).scaledTouchSlop

    private var dark = false
    private var modeCur = "hidden"

    private var orb: BallHolder? = null
    private var bar: BarHolder? = null
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
    private var holdRun: Runnable? = null
    private var voiceGuard: Runnable? = null
    private var lastDragEmit = 0L

    // ── 前端推来的界面状态缓存 ──
    private var messagesJson = "[]"
    private var transcript = ""
    private var level = 0f
    private var listeningNow = false
    private var busyNow = false

    fun mode(): String = modeCur

    fun isShowing(): Boolean = orbAttached || panelAttached

    /* ────────────────────────── 对外形态控制 ────────────────────────── */

    fun show(mode: String, darkTheme: Boolean) {
        dark = darkTheme
        when (mode) {
            "panel" -> {
                ensureOrb() // 面板收起时要能回到球：球窗口先建好（但不挂）
                attachPanel(true)
                detachOrb()
            }
            "bar" -> {
                ensureOrb()
                attachOrb()
                applyOrbShape("bar", animate = false)
                detachPanel(false)
                armVoiceGuard()
            }
            else -> {
                ensureOrb()
                attachOrb()
                applyOrbShape("ball", animate = false)
                detachPanel(false)
            }
        }
        modeCur = if (mode == "hidden") "hidden" else mode
        OverlayPrefs.setMode(ctx, modeCur)
    }

    /** 前端 overlaySetMode 落到这里；幂等（重复同形态不重建、不闪） */
    fun setMode(m: String) {
        when (m) {
            "hidden" -> hide()
            "panel" -> {
                ensureOrb()
                if (!panelAttached) attachPanel(true)
                detachOrb()
                modeCur = "panel"
                OverlayPrefs.setMode(ctx, modeCur)
            }
            "bar" -> {
                ensureOrb()
                attachOrb() // 面板开着时长按说话：球窗口本就没挂，挂上去天然盖在面板之上
                applyOrbShape("bar", animate = true)
                armVoiceGuard()
                modeCur = "bar"
                OverlayPrefs.setMode(ctx, modeCur)
            }
            else -> {
                ensureOrb()
                attachOrb()
                applyOrbShape("ball", animate = true)
                detachPanel(true)
                cancelVoiceGuard()
                modeCur = "ball"
                OverlayPrefs.setMode(ctx, modeCur)
            }
        }
    }

    fun hide() {
        cancelHold()
        cancelVoiceGuard()
        detachPanel(false)
        detachOrb()
        modeCur = "hidden"
        OverlayPrefs.setMode(ctx, modeCur)
    }

    fun destroy() {
        hide()
        orb = null
        bar = null
        panel = null
        orbLp = null
        panelLp = null
    }

    /* ────────────────────────── 前端状态 → 原生界面 ────────────────────────── */

    fun pushUi(stateJson: String) {
        val o = try {
            JSONObject(stateJson)
        } catch (_: Throwable) {
            return
        }
        val wantDark = o.optString("theme", if (dark) "dark" else "light") == "dark"
        if (wantDark != dark) {
            dark = wantDark
            // 主题变了：整体重建（拖动/语音进行中不重建，免得打断手势流）
            if (!moved && !holdFired && modeCur != "bar") {
                detachPanel(false)
                detachOrb()
                orb = null
                bar = null
                panel = null
                orbLp = null
                panelLp = null
                setMode(modeCur)
            }
        }
        val msgs = o.optJSONArray("messages")?.toString() ?: "[]"
        transcript = o.optString("transcript", transcript)
        level = o.optDouble("level", level.toDouble()).toFloat().coerceIn(0f, 1f)
        listeningNow = o.optBoolean("listening", listeningNow)
        busyNow = o.optBoolean("busy", busyNow)

        val key = "$msgs|$busyNow"
        val first = key != messagesJson
        messagesJson = msgs
        renderMessages(rebuild = first)
        renderVoice()
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
            val maxW = (screenW() * 0.78f).toInt()
            for (i in 0 until arr.length()) {
                val m = arr.optJSONObject(i) ?: continue
                val text = m.optString("text", "")
                if (text.isEmpty()) continue
                val bubble = OverlayViews.buildBubble(themed, text, m.optString("role", "oh"), dark, maxW)
                val lp = android.widget.LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                )
                lp.bottomMargin = OverlayViews.dp(ctx, 8)
                p.list.addView(bubble, lp)
            }
            if (busyNow) {
                val thinking = OverlayViews.buildBubble(themed, "…", "oh", dark, maxW)
                p.list.addView(thinking)
            }
        }
        p.empty.visibility = if (p.list.childCount == 0) View.VISIBLE else View.GONE
        if (rebuild) {
            p.scroll.post { p.scroll.fullScroll(View.FOCUS_DOWN) }
        }
    }

    private fun renderVoice() {
        val b = bar ?: return
        b.wave.amplitude = level
        b.wave.animating = listeningNow
        b.text.text = when {
            transcript.isNotEmpty() -> transcript
            listeningNow -> "在听，请讲…"
            else -> "长按说话"
        }
    }

    /* ────────────────────────── 窗口建立 / 形态 ────────────────────────── */

    private fun ensureOrb() {
        if (orbLp == null) {
            orbLp = orbParams()
            val root = OverlayViews.windowRoot(themed)
            val ball = OverlayViews.buildBall(themed, dark)
            root.addView(
                ball,
                FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT,
                ),
            )
            root.setOnTouchListener { v, e -> onOrbTouch(v, e) }
            orb = BallHolder(root, ball)
        }
        if (bar == null) {
            val built = OverlayViews.buildBar(themed, dark)
            built.root.setOnTouchListener { v, e -> onOrbTouch(v, e) }
            bar = built
        }
    }

    private fun attachOrb(): Boolean {
        val holder = orb ?: return false
        // 已在挂就什么都不做：绝不 remove+re-add——那会打断进行中的手势流
        // （长按 → 变条 → 抬手全在同一个根 View 上）。
        // 面板里长按说话时球窗口本就没挂，此时挂上去天然盖在面板之上。
        if (orbAttached) return true
        val lp = orbLp ?: return false
        return if (addWindow(holder.root, lp)) {
            orbAttached = true
            true
        } else {
            false
        }
    }

    private fun detachOrb() {
        val holder = orb ?: return
        if (!orbAttached) return
        try {
            wm.removeView(holder.root)
        } catch (_: Throwable) {
            /* 已经被移除 */
        }
        orbAttached = false
    }

    /** 球 ↔ 条：同一个根，换子 View + 改窗口尺寸/位置 */
    private fun applyOrbShape(shape: String, animate: Boolean) {
        val lp = orbLp ?: return
        val b = bar ?: return
        val holder = orb ?: return
        val root = holder.root
        val ballPx = OverlayViews.dp(ctx, OverlayViews.BALL_DP)
        val barPx = OverlayViews.dp(ctx, OverlayViews.BAR_DP)

        root.removeAllViews()
        if (shape == "bar") {
            root.addView(
                b.bar,
                FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
            )
            lp.width = ViewGroup.LayoutParams.MATCH_PARENT
            lp.height = barPx
            lp.x = 0
            lp.y = (screenH() - barPx - OverlayViews.dp(ctx, 12)).coerceAtLeast(0)
        } else {
            root.addView(
                holder.ball,
                FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
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
        renderVoice()
        if (animate) {
            root.alpha = 0.45f
            root.animate().alpha(1f).setDuration(140).start()
        } else {
            root.alpha = 1f
        }
        if (shape == "bar") armVoiceGuard() else cancelVoiceGuard()
    }

    private fun attachPanel(animate: Boolean): Boolean {
        if (panelAttached) return true
        if (panelLp == null) {
            panelLp = panelParams()
            panel = OverlayViews.buildPanel(themed, dark)
            wirePanel(panel!!)
        }
        val holder = panel ?: return false
        val ok = addWindow(holder.root, panelLp!!)
        if (!ok) return false
        panelAttached = true
        renderMessages(rebuild = true)
        if (animate) {
            holder.card.alpha = 0f
            holder.card.translationY = holder.card.height.coerceAtLeast(OverlayViews.dp(ctx, 120)).toFloat() * 0.35f
            holder.card.animate().alpha(1f).translationY(0f)
                .setDuration(220).setInterpolator(DecelerateInterpolator()).start()
        } else {
            holder.card.alpha = 1f
            holder.card.translationY = 0f
        }
        return true
    }

    private fun detachPanel(animate: Boolean) {
        val holder = panel ?: return
        if (!panelAttached) return
        val remove = Runnable {
            try {
                wm.removeView(holder.root)
            } catch (_: Throwable) {
                /* 已经被移除 */
            }
            panelAttached = false
        }
        if (animate) {
            holder.card.animate().alpha(0f).translationY(holder.card.height.toFloat() * 0.3f)
                .setDuration(150).withEndAction(remove).start()
        } else {
            holder.card.animate().cancel()
            remove.run()
        }
    }

    private fun wirePanel(p: PanelHolder) {
        p.collapseBtn.setOnClickListener { setMode("ball") }
        p.closeBtn.setOnClickListener { host.onCloseRequested() }
        p.input.setOnClickListener { showIme(p) }
        p.input.setOnFocusChangeListener { _, has -> if (has) showIme(p) }
        p.input.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_SEND) {
                submitPanel(p)
                true
            } else {
                false
            }
        }
        // 发送键：点 = 发送，长按 = 说话（需求 5：「点击输入，长按说话」）
        var hold = false
        var panelHoldRun: Runnable? = null
        p.actionBtn.setOnTouchListener { v, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    hold = false
                    v.isPressed = true
                    val r = Runnable {
                        panelHoldRun = null
                        hold = true
                        try {
                            v.performHapticFeedback(android.view.HapticFeedbackConstants.LONG_PRESS)
                        } catch (_: Throwable) {
                            /* 无马达 */
                        }
                        setMode("bar")
                        OverlayEvents.emit("hold", 0, 0)
                    }
                    panelHoldRun = r
                    main.postDelayed(r, HOLD_MS)
                    true
                }
                MotionEvent.ACTION_UP -> {
                    v.isPressed = false
                    panelHoldRun?.let { main.removeCallbacks(it) }
                    panelHoldRun = null
                    if (hold) {
                        OverlayEvents.emit("release", 0, 0)
                        armVoiceGuard()
                    } else {
                        submitPanel(p)
                    }
                    true
                }
                MotionEvent.ACTION_CANCEL -> {
                    v.isPressed = false
                    panelHoldRun?.let { main.removeCallbacks(it) }
                    panelHoldRun = null
                    if (hold) OverlayEvents.emit("release", 0, 0)
                    true
                }
                else -> false
            }
        }
    }

    private fun submitPanel(p: PanelHolder) {
        val t = p.input.text?.toString()?.trim().orEmpty()
        if (t.isEmpty()) return
        p.input.setText("")
        // 本地先回显一条用户气泡（前端状态回推是权威源，会整体重建列表）
        val maxW = (screenW() * 0.78f).toInt()
        val bubble = OverlayViews.buildBubble(themed, t, "user", dark, maxW)
        val lp = android.widget.LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        )
        lp.bottomMargin = OverlayViews.dp(ctx, 8)
        p.list.addView(bubble, lp)
        p.empty.visibility = View.GONE
        p.scroll.post { p.scroll.fullScroll(View.FOCUS_DOWN) }
        host.onSubmitText(t)
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
                if (modeCur != "bar") armHold()
                true
            }
            MotionEvent.ACTION_MOVE -> {
                val dx = e.rawX - downRawX
                val dy = e.rawY - downRawY
                if (!moved && (abs(dx) > slop || abs(dy) > slop)) {
                    moved = true
                    cancelHold()
                }
                if (moved && !holdFired && modeCur != "bar") {
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
                                /* 掉帧/瞬态 */
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
                when {
                    holdFired -> {
                        cancelVoiceGuard()
                        OverlayEvents.emit("release", ballX, ballY)
                        setMode("ball") // 原生先回到球；前端随后会按需 overlaySetMode("panel")
                    }
                    moved -> {
                        OverlayPrefs.setBall(ctx, ballX, ballY)
                        snapToNearestEdge(v)
                    }
                    else -> {
                        OverlayEvents.emit("tap", ballX, ballY)
                        setMode("panel")
                    }
                }
                true
            }
            MotionEvent.ACTION_CANCEL -> {
                cancelHold()
                if (holdFired) {
                    cancelVoiceGuard()
                    OverlayEvents.emit("release", ballX, ballY)
                }
                true
            }
        }
        return true
    }

    private fun armHold() {
        cancelHold()
        val r = Runnable {
            holdRun = null
            holdFired = true
            val holder = orb ?: return@Runnable
            try {
                holder.root.performHapticFeedback(android.view.HapticFeedbackConstants.LONG_PRESS)
            } catch (_: Throwable) {
                /* 无振动马达 */
            }
            applyOrbShape("bar", animate = true)
            modeCur = "bar"
            OverlayPrefs.setMode(ctx, modeCur)
            OverlayEvents.emit("hold", ballX, ballY)
        }
        holdRun = r
        main.postDelayed(r, HOLD_MS)
    }

    private fun cancelHold() {
        holdRun?.let { main.removeCallbacks(it) }
        holdRun = null
    }

    /** 语音条最长 30s：万一抬手事件丢了（窗口被系统重挂等），也不至于永远占着麦克风 */
    private fun armVoiceGuard() {
        cancelVoiceGuard()
        val r = Runnable {
            voiceGuard = null
            if (modeCur == "bar") {
                OverlayEvents.emit("release", ballX, ballY)
                setMode("ball")
            }
        }
        voiceGuard = r
        main.postDelayed(r, VOICE_MAX_MS)
    }

    private fun cancelVoiceGuard() {
        voiceGuard?.let { main.removeCallbacks(it) }
        voiceGuard = null
    }

    private fun snapToNearestEdge(v: View) {
        val lp = orbLp ?: return
        val ballPx = OverlayViews.dp(ctx, OverlayViews.BALL_DP)
        val target = if (lp.x + ballPx / 2 < screenW() / 2) 0 else (screenW() - ballPx)
        if (lp.x == target) return
        val anim = ValueAnimator.ofInt(lp.x, target).setDuration(180)
        anim.interpolator = DecelerateInterpolator()
        val start = lp.x
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
                if (start != lp.x) OverlayEvents.emit("drag", lp.x, lp.y)
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
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
                WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
            PixelFormat.TRANSLUCENT,
        )
        lp.gravity = Gravity.TOP or Gravity.START
        val p = defaultBallPos(ballPx)
        val saved = if (OverlayPrefs.ballX(ctx) != Int.MIN_VALUE) OverlayPrefs.ballX(ctx) else p.first
        val savedY = if (OverlayPrefs.ballY(ctx) != Int.MIN_VALUE) OverlayPrefs.ballY(ctx) else p.second
        lp.x = clampX(saved, ballPx)
        lp.y = clampY(savedY, ballPx)
        placedOnce = OverlayPrefs.ballX(ctx) != Int.MIN_VALUE || OverlayPrefs.ballY(ctx) != Int.MIN_VALUE
        ballX = lp.x
        ballY = lp.y
        applyBlur(lp)
        return lp
    }

    private fun panelParams(): WindowManager.LayoutParams {
        val h = (screenH() * 0.5f).toInt()
        val lp = WindowManager.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            h,
            overlayType(),
            // 不设 FLAG_NOT_FOCUSABLE：输入框要拿焦点与输入法；
            // FLAG_NOT_TOUCH_MODAL：面板以外的触摸照常落给下面的应用（不挡事）
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
            PixelFormat.TRANSLUCENT,
        )
        lp.gravity = Gravity.BOTTOM or Gravity.START
        lp.softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
        applyBlur(lp)
        return lp
    }

    /** 跨应用模糊：Android 12+ 有 cross-window blur 能力时按窗口申请（反射调用，
     *  避免不同 compileSdk 下的编译差异）；拿不到就保持半透明雾面，不影响功能。 */
    private fun applyBlur(lp: WindowManager.LayoutParams) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
        try {
            val iface = Class.forName("android.view.WindowManager")
            val enabled = iface.getMethod("isCrossWindowBlurEnabled").invoke(wm) as? Boolean ?: false
            if (!enabled) return
            val m = WindowManager.LayoutParams::class.java
                .getMethod("setBlurBehindRadius", Int::class.javaPrimitiveType)
            m.invoke(lp, OverlayViews.dp(ctx, 28))
            lp.flags = lp.flags or FLAG_BLUR_BEHIND
        } catch (_: Throwable) {
            /* 设备不支持：半透明雾面兜底 */
        }
    }

    private fun addWindow(v: View, lp: WindowManager.LayoutParams): Boolean {
        return try {
            wm.addView(v, lp)
            true
        } catch (e1: Throwable) {
            // 带 blur 标志被拒（个别 ROM）：去掉重试，绝不让悬浮层因此完全不出现
            Log.w(TAG, "addView 失败，去模糊重试：${e1.message}")
            try {
                lp.flags = lp.flags and FLAG_BLUR_BEHIND.inv()
                wm.addView(v, lp)
                true
            } catch (e2: Throwable) {
                Log.w(TAG, "addView 仍失败：${e2.message}")
                false
            }
        }
    }

    private fun screenW(): Int = ctx.resources.displayMetrics.widthPixels

    private fun screenH(): Int = ctx.resources.displayMetrics.heightPixels

    private fun defaultBallPos(ballPx: Int): Pair<Int, Int> =
        Pair((screenW() - ballPx - OverlayViews.dp(ctx, 8)).coerceAtLeast(0), (screenH() / 3))

    private fun clampX(x: Int, ballPx: Int): Int = x.coerceIn(0, (screenW() - ballPx).coerceAtLeast(0))

    private fun clampY(y: Int, ballPx: Int): Int =
        y.coerceIn(OverlayViews.dp(ctx, 24), (screenH() - ballPx - OverlayViews.dp(ctx, 8)).coerceAtLeast(OverlayViews.dp(ctx, 24)))

    companion object {
        const val TAG = "OnethuOverlay"
        const val HOLD_MS = 450L
        const val VOICE_MAX_MS = 30_000L

        /** WindowManager.LayoutParams.FLAG_BLUR_BEHIND 的字面量（deprecated 常量，避免编译告警） */
        const val FLAG_BLUR_BEHIND = 0x00000004
    }
}
