// OneTHU 悬浮层：三种形态的视图构造（纯代码建 View，不引 XML 资源——
// 插件库不落 res/，避免与宿主 app 模块的资源名冲突）。
//
// 「雾」的做法：半透明底色 + 1dp 描边 + 大圆角；Android 12+ 另尝试窗口级
// blur-behind（见 OverlayWindows.fogParams）。**没有任何第三方应用能真正拿到
// 跨应用实时模糊**（FLAG_BLUR_BEHIND 需要系统许可），失败即退化为半透明。
//
// 本文件只造视图 + 提供画法；点击/手势/滚动的语义全在 OverlayWindows。

package app.onethu.overlay

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.drawable.GradientDrawable
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import kotlin.math.sin

object OverlayViews {
    const val BALL_DP = 52
    const val BAR_DP = 56
    const val RADIUS_DP = 18

    fun dp(ctx: Context, v: Int): Int = (v * ctx.resources.displayMetrics.density + 0.5f).toInt()

    /** 深色主题下的正文/次要色（与 DSH alias 实测色一致：#1C1F24 / #6B7076 / #E9EAEC） */
    fun ink(dark: Boolean): Int = if (dark) 0xFFE9EAEC.toInt() else 0xFF1C1F24.toInt()

    fun inkSub(dark: Boolean): Int = if (dark) 0xFFA8ABB0.toInt() else 0xFF6B7076.toInt()

    /** 雾状底（面板/条）：半透明填充 + 描边 + 圆角；topOnly = 只圆上边（贴底面板） */
    fun fogBg(ctx: Context, dark: Boolean, radiusDp: Int, topOnly: Boolean = false): GradientDrawable {
        val d = GradientDrawable()
        d.shape = GradientDrawable.RECTANGLE
        d.setColor(if (dark) 0xE0222529.toInt() else 0xE6F6F7F9.toInt())
        d.setStroke(dp(ctx, 1), if (dark) 0x2EFFFFFF else 0x14000000)
        val r = dp(ctx, radiusDp).toFloat()
        if (topOnly) {
            d.cornerRadii = floatArrayOf(r, r, r, r, 0f, 0f, 0f, 0f)
        } else {
            d.cornerRadius = r
        }
        return d
    }

    /** 球底：不透明感更强的雾面圆 */
    fun ballBg(ctx: Context, dark: Boolean): GradientDrawable {
        val d = GradientDrawable()
        d.shape = GradientDrawable.OVAL
        d.setColor(if (dark) 0xE62C3036.toInt() else 0xF2FFFFFF.toInt())
        d.setStroke(dp(ctx, 1), if (dark) 0x33FFFFFF else 0x1A000000)
        return d
    }

    /** 按钮/输入框底：primary=true 用近黑（浅色主题）/近白（深色主题）作对比 */
    fun chipBg(ctx: Context, dark: Boolean, primary: Boolean): GradientDrawable {
        val d = GradientDrawable()
        d.shape = GradientDrawable.RECTANGLE
        d.cornerRadius = dp(ctx, 14).toFloat()
        d.setColor(
            when {
                primary && dark -> 0xFFF2F3F5.toInt()
                primary -> 0xFF16181C.toInt()
                dark -> 0x33FFFFFF
                else -> 0x14000000
            },
        )
        d.setStroke(dp(ctx, 1), if (dark) 0x24FFFFFF else 0x12000000)
        return d
    }

    fun chipText(dark: Boolean, primary: Boolean): Int =
        if (!primary) ink(dark) else if (dark) 0xFF16181C.toInt() else 0xFFF7F8FA.toInt()

    /** 球 / 条共用窗口根（形态切换只换子 View，不换根：进行中的手势流不会被打断） */
    fun windowRoot(ctx: Context): FrameLayout = FrameLayout(ctx).apply {
        isClickable = true
        isFocusable = false
    }

    fun buildBall(ctx: Context, dark: Boolean): TextView = TextView(ctx).apply {
        text = "OH"
        textSize = 15f
        gravity = Gravity.CENTER
        setTextColor(ink(dark))
        typeface = android.graphics.Typeface.DEFAULT_BOLD
        background = ballBg(ctx, dark)
        isClickable = false
        isFocusable = false
    }

    /** 语音输入条：点点波纹（随电平跳动）+ 实时转写 */
    fun buildBar(ctx: Context, dark: Boolean): BarHolder {
        val bar = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            background = fogBg(ctx, dark, RADIUS_DP)
            setPadding(dp(ctx, 14), dp(ctx, 8), dp(ctx, 14), dp(ctx, 8))
            isClickable = false
            isFocusable = false
        }
        val wave = WaveDots(ctx).apply {
            dotColor = ink(dark)
            isClickable = false
        }
        bar.addView(wave, LinearLayout.LayoutParams(dp(ctx, 56), dp(ctx, 26)))
        val text = TextView(ctx).apply {
            text = "长按说话"
            textSize = 14f
            maxLines = 2
            setTextColor(ink(dark))
            isClickable = false
            isFocusable = false
        }
        val tlp = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        tlp.marginStart = dp(ctx, 10)
        bar.addView(text, tlp)
        val root = windowRoot(ctx)
        root.addView(bar, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        return BarHolder(root, bar, wave, text)
    }

    /** 半屏对话面板：雾面卡片 = 头部（OH + 收起 + 本次关闭）+ 消息区 + 底部输入行 */
    fun buildPanel(ctx: Context, dark: Boolean): PanelHolder {
        val pad = dp(ctx, 14)
        val card = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            background = fogBg(ctx, dark, 22, topOnly = true)
            setPadding(pad, dp(ctx, 12), pad, dp(ctx, 12))
        }

        val head = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val title = TextView(ctx).apply {
            text = "OH"
            textSize = 13f
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            setTextColor(ink(dark))
        }
        head.addView(title, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        val collapse = TextView(ctx).apply {
            text = "收起"
            textSize = 12f
            setTextColor(inkSub(dark))
            setPadding(dp(ctx, 10), dp(ctx, 6), dp(ctx, 10), dp(ctx, 6))
            background = chipBg(ctx, dark, false)
        }
        head.addView(collapse)
        val close = TextView(ctx).apply {
            text = "本次关闭悬浮球"
            textSize = 12f
            setTextColor(inkSub(dark))
            setPadding(dp(ctx, 10), dp(ctx, 6), dp(ctx, 10), dp(ctx, 6))
            background = chipBg(ctx, dark, false)
        }
        val clp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        clp.marginStart = dp(ctx, 8)
        head.addView(close, clp)
        card.addView(head, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))

        val list = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
        }
        val scroll = ScrollView(ctx).apply {
            isFillViewport = true
            isVerticalScrollBarEnabled = false
            addView(list, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        }
        val slp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        slp.topMargin = dp(ctx, 8)
        slp.bottomMargin = dp(ctx, 8)
        card.addView(scroll, slp)

        val empty = TextView(ctx).apply {
            text = "长按下面的按钮说话，或直接打字。"
            textSize = 13f
            setTextColor(inkSub(dark))
        }
        card.addView(empty, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))

        val row = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val input = EditText(ctx).apply {
            hint = "点击输入，长按说话"
            textSize = 14f
            setTextColor(ink(dark))
            setHintTextColor(inkSub(dark))
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            imeOptions = EditorInfo.IME_ACTION_SEND
            maxLines = 1
            isSingleLine = true
            background = chipBg(ctx, dark, false)
            setPadding(dp(ctx, 12), dp(ctx, 8), dp(ctx, 12), dp(ctx, 8))
        }
        row.addView(input, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        val action = Button(ctx).apply {
            text = "发送"
            textSize = 13f
            isAllCaps = false
            setTextColor(chipText(dark, true))
            background = chipBg(ctx, dark, true)
            setPadding(dp(ctx, 14), dp(ctx, 6), dp(ctx, 14), dp(ctx, 6))
        }
        val alp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        alp.marginStart = dp(ctx, 8)
        row.addView(action, alp)
        val rlp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        rlp.topMargin = dp(ctx, 10)
        card.addView(row, rlp)

        val root = FrameLayout(ctx)
        root.addView(card, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        return PanelHolder(root, card, title, collapse, close, scroll, list, empty, input, action)
    }

    /** 消息气泡：role = "user" 靠右（近黑底白字），其余靠左（浅雾底正文色） */
    fun buildBubble(ctx: Context, text: String, role: String, dark: Boolean, maxWidthPx: Int): View {
        val mine = role == "user"
        val tv = TextView(ctx).apply {
            this.text = text
            textSize = 14f
            setLineSpacing(dp(ctx, 4).toFloat(), 1f)
            setTextColor(if (mine) chipText(dark, true) else ink(dark))
            setPadding(dp(ctx, 12), dp(ctx, 8), dp(ctx, 12), dp(ctx, 8))
            maxWidth = maxWidthPx
            background = GradientDrawable().apply {
                cornerRadius = dp(ctx, 14).toFloat()
                setColor(
                    when {
                        mine && dark -> 0xFFF2F3F5.toInt()
                        mine -> 0xFF16181C.toInt()
                        dark -> 0x24FFFFFF
                        else -> 0x0F000000
                    },
                )
            }
        }
        val row = FrameLayout(ctx)
        val lp = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        )
        lp.gravity = if (mine) Gravity.END else Gravity.START
        row.addView(tv, lp)
        return row
    }
}

/** 随音量跳动的点点波纹（需求 1 的原生版）：amplitude 由前端 pushUi 的 level 驱动，
 *  没拿到电平时退化为固定相位的正弦，保证「在听」这件事在视觉上一直有反馈。 */
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
        val maxR = height / 2f
        for (i in 0 until n) {
            val s = sin((phase + i * 0.7f).toDouble()).toFloat() * 0.5f + 0.5f
            val k = if (animating) (0.22f + 0.55f * amplitude + 0.25f * s) else (0.30f + 0.45f * amplitude)
            canvas.drawCircle(gap * (i + 0.5f), cy, (maxR * k).coerceIn(2f, maxR.coerceAtLeast(2f)), paint)
        }
        if (animating) {
            phase += 0.22f
            postInvalidateOnAnimation()
        }
    }
}

class BallHolder(val root: FrameLayout, val ball: TextView)

class BarHolder(val root: FrameLayout, val bar: LinearLayout, val wave: WaveDots, val text: TextView)

class PanelHolder(
    val root: FrameLayout,
    val card: LinearLayout,
    val title: TextView,
    val collapseBtn: TextView,
    val closeBtn: TextView,
    val scroll: ScrollView,
    val list: LinearLayout,
    val empty: TextView,
    val input: EditText,
    val actionBtn: Button,
)
