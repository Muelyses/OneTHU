// OneTHU 悬浮层：雾视图与三种形态的视图构造（纯代码建 View，不落 res/，避免与宿主资源冲突）。
//
// 视觉语言（task-11 ①，对齐本体「雾中の裸文字」）：
//   - 雾：由自定义 View（FogLayout）画**径向渐变 + 羽化**，中心浓 → 四周完全透明；
//     **窗口与视图都不设任何背景色**，窗口用 PixelFormat.TRANSLUCENT，
//     尺寸一律按内容算（绝不用 MATCH_PARENT），因此「雾之外 = 完全透明」。
//   - 文字：无气泡、无头像、无卡片框。对方左对齐正常字重；用户右对齐 62% 不透明；
//     15sp、行高 1.62、条目间距 14dp。
//   - 球：54dp 径向雾 + 可选 RenderEffect 模糊（API 31+；失败退化为纯径向雾）+ 居中「OH」。
//   - 配色（--dsw-alias-* 的近似）：浅色雾心 #FFFFFF / 文字 #1C1F24；
//     深色按系统 uiMode 切 #151517 / #ECECF1。

package app.onethu.overlay

import android.content.Context
import android.content.res.Configuration
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.RenderEffect
import android.graphics.Shader
import android.os.Build
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import kotlin.math.max
import kotlin.math.sin

object OverlayViews {
    /** 球直径：54dp（task-11 ①） */
    const val BALL_DP = 54

    /** 语音条高：56dp（PLAN §3.1） */
    const val BAR_DP = 56

    const val MSG_SP = 15f
    const val LINE_MULT = 1.62f
    const val GAP_DP = 14
    const val USER_ALPHA = 0.62f

    /** 浅色雾心 / 深色雾心（--dsw-alias 近似） */
    const val FOG_LIGHT = 0xFFFFFFFF.toInt()
    const val FOG_DARK = 0xFF151517.toInt()
    const val INK_LIGHT = 0xFF1C1F24.toInt()
    const val INK_DARK = 0xFFECECF1.toInt()

    fun dp(ctx: Context, v: Int): Int = (v * ctx.resources.displayMetrics.density + 0.5f).toInt()

    /** 深色判定：只认系统 uiMode（前端 pushUi 可覆盖） */
    fun isDarkUi(ctx: Context): Boolean =
        (ctx.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
            Configuration.UI_MODE_NIGHT_YES

    fun ink(dark: Boolean): Int = if (dark) INK_DARK else INK_LIGHT

    fun fogCore(dark: Boolean): Int = if (dark) FOG_DARK else FOG_LIGHT

    /** 带 alpha 的颜色（供 FogLayout 的渐变 stop 用） */
    fun withAlpha(color: Int, alpha255: Int): Int =
        (color and 0x00FFFFFF) or (alpha255.coerceIn(0, 255) shl 24)

    /** 浮层窗口根：**永远不设背景**，只作为形态切换与手势的稳定宿主 */
    fun windowRoot(ctx: Context): FrameLayout = FrameLayout(ctx).apply {
        isClickable = true
        isFocusable = false
    }

    /** 球：54dp 径向雾 + 居中「OH」（15sp / 700） */
    fun buildBall(ctx: Context, dark: Boolean): Pair<FogLayout, TextView> {
        val ball = FogLayout(ctx).apply {
            coreColor = fogCore(dark)
            coreAlpha = if (dark) 0.88f else 0.92f
            centerXRatio = 0.5f
            centerYRatio = 0.5f
            // 半径 = 半宽：到边缘正好羽化到全透明（球外完全透明）
            radiusScale = 0.5f
            stopStops = floatArrayOf(0f, 0.62f, 0.88f, 1f)
            stopWeights = floatArrayOf(1f, 0.86f, 0.34f, 0f)
        }
        val text = TextView(ctx).apply {
            text = "OH"
            textSize = 15f
            gravity = Gravity.CENTER
            setTextColor(ink(dark))
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            isClickable = false
            isFocusable = false
        }
        ball.addView(
            text,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
                Gravity.CENTER,
            ),
        )
        // 模糊（API 31+）：只模糊本视图自身内容 → 雾边更柔；失败就保留纯径向雾
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            try {
                ball.setRenderEffect(
                    RenderEffect.createBlurEffect(6f, 6f, Shader.TileMode.CLAMP),
                )
            } catch (_: Throwable) {
                /* 不支持：纯径向雾 */
            }
        }
        return Pair(ball, text)
    }

    /** 语音条：56dp 全宽雾带 + 点点波纹 + 实时转写（雾里浮字） */
    fun buildBar(ctx: Context, dark: Boolean): Triple<FogLayout, WaveDots, TextView> {
        val bar = FogLayout(ctx).apply {
            coreColor = fogCore(dark)
            coreAlpha = if (dark) 0.86f else 0.90f
            centerXRatio = 0.5f
            centerYRatio = 0.5f
            // 相对长边取半径：左右两端羽化，上下缘自然柔边
            radiusScale = 0.62f
        }
        val row = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(ctx, 18), dp(ctx, 8), dp(ctx, 18), dp(ctx, 8))
            isClickable = false
        }
        val wave = WaveDots(ctx).apply {
            dotColor = ink(dark)
            isClickable = false
        }
        row.addView(wave, LinearLayout.LayoutParams(dp(ctx, 52), dp(ctx, 24)))
        val text = TextView(ctx).apply {
            text = "长按说话"
            textSize = MSG_SP
            maxLines = 2
            ellipsize = null
            setTextColor(ink(dark))
            isClickable = false
        }
        val tlp = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        tlp.marginStart = dp(ctx, 12)
        row.addView(text, tlp)
        bar.addView(
            row,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ),
        )
        return Triple(bar, wave, text)
    }

    /** 半屏对话面板：雾中の裸文字 + 底部无框下划线输入行 */
    fun buildPanel(ctx: Context, dark: Boolean): PanelHolder {
        val root = FogLayout(ctx).apply {
            coreColor = fogCore(dark)
            coreAlpha = if (dark) 0.88f else 0.92f
            // 雾心略偏下：顶端与四角羽化到全透明，底缘柔和
            centerXRatio = 0.5f
            centerYRatio = 0.60f
            radiusScale = 0.62f
        }
        val content = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(ctx, 22), dp(ctx, 14), dp(ctx, 22), dp(ctx, 12))
        }

        // 唯一的功能性裸文字入口：本次关闭悬浮球（需求 5 要求在雾面表面可关闭）
        val close = TextView(ctx).apply {
            text = "本次关闭悬浮球"
            textSize = 12f
            setTextColor(ink(dark))
            alpha = 0.55f
            gravity = Gravity.END
            setPadding(dp(ctx, 8), dp(ctx, 2), 0, dp(ctx, 6))
        }
        content.addView(
            close,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ),
        )

        val list = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
        val scroll = ScrollView(ctx).apply {
            isFillViewport = true
            isVerticalScrollBarEnabled = false
            overScrollMode = View.OVER_SCROLL_NEVER
            addView(list, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        }
        val slp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        content.addView(scroll, slp)

        val empty = TextView(ctx).apply {
            text = "点击输入，长按说话"
            textSize = MSG_SP
            setTextColor(ink(dark))
            alpha = 0.45f
        }
        content.addView(
            empty,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ),
        )

        // 底部输入行：无框下划线（EditText 无背景 + 其下一条 1dp 细线）
        val inputRow = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val input = EditText(ctx).apply {
            hint = "点击输入，长按说话"
            textSize = MSG_SP
            setTextColor(ink(dark))
            setHintTextColor(withAlpha(ink(dark), 96))
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            imeOptions = EditorInfo.IME_ACTION_SEND
            maxLines = 1
            isSingleLine = true
            setBackgroundColor(Color.TRANSPARENT)
            background = null
            setPadding(0, dp(ctx, 6), 0, dp(ctx, 6))
        }
        inputRow.addView(input, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        val action = TextView(ctx).apply {
            text = "发送"
            textSize = 13f
            setTextColor(ink(dark))
            alpha = 0.85f
            setPadding(dp(ctx, 12), dp(ctx, 4), 0, dp(ctx, 4))
        }
        inputRow.addView(
            action,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ),
        )
        val irlp = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        )
        irlp.topMargin = dp(ctx, 10)
        content.addView(inputRow, irlp)
        val underline = View(ctx).apply { setBackgroundColor(withAlpha(ink(dark), 38)) }
        val ulp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, max(1, dp(ctx, 1)))
        content.addView(underline, ulp)

        root.addView(
            content,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ),
        )
        return PanelHolder(root, content, close, scroll, list, empty, input, action, underline)
    }

    /** 一条消息（裸文字，无气泡）：对方左对齐正常字重；用户右对齐 62% 不透明 */
    fun buildMessage(ctx: Context, text: String, role: String, dark: Boolean, maxWidthPx: Int): View {
        val mine = role == "user"
        val row = FrameLayout(ctx)
        val tv = TextView(ctx).apply {
            this.text = text
            textSize = MSG_SP
            setLineSpacing(0f, LINE_MULT)
            setTextColor(ink(dark))
            maxWidth = maxWidthPx
            if (mine) {
                alpha = USER_ALPHA
                gravity = Gravity.END
            }
            isClickable = false
            isFocusable = false
        }
        val lp = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        )
        lp.gravity = if (mine) Gravity.END else Gravity.START
        row.addView(tv, lp)
        return row
    }
}

/**
 * 雾层：径向渐变 + 羽化的自定义 ViewGroup。
 *
 * - 直接在 onDraw 里画（setWillNotDraw(false)），**不设任何背景色**；
 * - 渐变半径按视图长边算：半径之外的像素 alpha = 0 → 雾外完全透明；
 * - stopWeights 控制「中心浓 → 羽化」的曲线；每个形态各自一套参数。
 */
class FogLayout(context: Context) : FrameLayout(context) {
    var coreColor: Int = OverlayViews.FOG_LIGHT
    var coreAlpha: Float = 0.9f
    var centerXRatio: Float = 0.5f
    var centerYRatio: Float = 0.5f
    var radiusScale: Float = 0.62f
    var stopStops: FloatArray = floatArrayOf(0f, 0.55f, 0.82f, 1f)
    var stopWeights: FloatArray = floatArrayOf(1f, 0.80f, 0.30f, 0f)

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private var shader: RadialGradient? = null

    init {
        setWillNotDraw(false)
        isClickable = false
    }

    /** 主题切换时重算颜色（Views 由 OverlayWindows 重建，这里只保证不崩） */
    fun recolor(dark: Boolean) {
        coreColor = OverlayViews.fogCore(dark)
        shader = null
        invalidate()
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        shader = build(w, h)
    }

    private fun build(w: Int, h: Int): RadialGradient {
        val r = max(w, h).toFloat() * radiusScale
        val radius = if (r < 1f) 1f else r
        val n = minOf(stopStops.size, stopWeights.size)
        val a = (coreAlpha.coerceIn(0f, 1f) * 255f).toInt()
        val colors = IntArray(n)
        val stops = FloatArray(n)
        for (i in 0 until n) {
            stops[i] = stopStops[i]
            colors[i] = OverlayViews.withAlpha(coreColor, (a * stopWeights[i]).toInt())
        }
        return RadialGradient(
            w * centerXRatio,
            h * centerYRatio,
            radius,
            colors,
            stops,
            Shader.TileMode.CLAMP,
        )
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val s = shader ?: build(width, height).also { shader = it }
        paint.shader = s
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), paint)
    }
}

/** 随音量跳动的点点波纹（需求 1 的原生版）：amplitude 来自本机 SpeechRecognizer 的 rms；
 *  没有电平时退化为固定相位正弦，保证「在听」这件事在视觉上一直有反馈。 */
class WaveDots(context: Context) : View(context) {
    var dotColor: Int = Color.BLACK
    var amplitude: Float = 0f

    var animating: Boolean = false
        set(value) {
            if (field == value) return
            field = value
            if (value) postInvalidateOnAnimation() else invalidate()
        }

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private var phase = 0f

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        paint.color = dotColor
        val n = 5
        val gap = width.toFloat() / n
        val cy = height / 2f
        val maxR = (height / 2f).coerceAtLeast(2f)
        for (i in 0 until n) {
            val s = sin((phase + i * 0.7f).toDouble()).toFloat() * 0.5f + 0.5f
            val k = if (animating) (0.22f + 0.55f * amplitude + 0.25f * s) else (0.30f + 0.45f * amplitude)
            canvas.drawCircle(gap * (i + 0.5f), cy, (maxR * k).coerceIn(2f, maxR), paint)
        }
        if (animating) {
            phase += 0.22f
            postInvalidateOnAnimation()
        }
    }
}

class PanelHolder(
    val root: FogLayout,
    val content: LinearLayout,
    val closeBtn: TextView,
    val scroll: ScrollView,
    val list: LinearLayout,
    val empty: TextView,
    val input: EditText,
    val actionBtn: TextView,
    val underline: View,
)

class OrbHolder(
    val root: FrameLayout,
    val ball: FogLayout,
    val ballText: TextView,
    val bar: FogLayout,
    val wave: WaveDots,
    val barText: TextView,
)
