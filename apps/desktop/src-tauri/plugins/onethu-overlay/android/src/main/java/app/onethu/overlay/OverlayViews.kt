// OneTHU 悬浮层：雾视图与三种形态的视图构造（纯代码建 View，不落 res/，避免与宿主资源冲突）。
//
// 视觉语言（对齐本体「雾中の裸文字」，真机反馈后定稿）：
//   - 雾：**纵向 linear-gradient 半屏雾**（不是径向团！）——底部 100% 铺满、向上连续变淡，
//     到面板顶端透明。等价 CSS：
//     `linear-gradient(to top, #000 0%, #000 58%, rgba(0,0,0,.55) 82%, transparent 100%)`。
//     **窗口与视图都不设任何背景色**，窗口用 PixelFormat.TRANSLUCENT，
//     尺寸一律按内容算（绝不用 MATCH_PARENT），因此「雾之外 = 完全透明」。
//   - 文字：无气泡、无头像、无卡片框。对方左对齐正常字重；用户右对齐 62% 不透明；
//     15sp、行高 1.62、条目间距 14dp。
//   - 球：**实底 + 1px 细边框 + 轻投影**（与本体内悬浮岛同一语言），**不用模糊/不用径向雾**；
//     文案固定为「（OH）」（四个字符，不许改）。
//   - 配色（--dsw-alias-* 的近似）：浅色雾心 #FFFFFF / 文字 #1C1F24；
//     深色按系统 uiMode 切 #151517 / #ECECF1。

package app.onethu.overlay

import android.content.Context
import android.content.res.Configuration
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.graphics.Paint
import android.graphics.LinearGradient
import android.graphics.Shader
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
    /** 球直径：54dp */
    const val BALL_DP = 54

    /** 球窗尺寸 = 球 + 两侧各 8dp 留白：elevation 的轻投影要画在视图之外，
     *  窗口若正好等于球的大小，投影会被窗口边界裁掉。 */
    const val BALL_WIN_DP = BALL_DP + 16

    /** 球文案：用户点名「就得是（OH）四个字，天王老子来了也不能改」 */
    const val BALL_TEXT = "（OH）"

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

    /** 球：54dp **实底 + 1px 细边框 + 轻投影**，居中「（OH）」（四个字符，用户点名不许改）。
     *  不用模糊、不用径向雾（真机反馈：「OH 按钮本身用雾状不行」）。 */
    fun buildBall(ctx: Context, dark: Boolean): TextView {
        val fill = if (dark) 0xFF151517.toInt() else 0xFFFFFFFF.toInt()
        val border = if (dark) 0x24FFFFFF else 0x1A000000
        val bg = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(fill)
            setStroke(max(1, dp(ctx, 1)), border)
        }
        return TextView(ctx).apply {
            text = BALL_TEXT
            // 四个全角字符要塞进 54dp：字号取 11sp（再大就会挤/裁切）
            textSize = 11f
            gravity = Gravity.CENTER
            setTextColor(ink(dark))
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            includeFontPadding = false
            isSingleLine = true
            background = bg
            // 轻投影：硬件加速窗口里 elevation + 背景 outline 会给柔和阴影
            elevation = dp(ctx, 6).toFloat()
            isClickable = false
            isFocusable = false
        }
    }

    /** 语音条：56dp 全宽雾带 + 点点波纹 + 实时转写（雾里浮字） */
    fun buildBar(ctx: Context, dark: Boolean): Triple<FogLayout, WaveDots, TextView> {
        val bar = FogLayout(ctx).apply {
            coreColor = fogCore(dark)
            coreAlpha = if (dark) 0.88f else 0.92f
            // 条很矮：用近乎实心的纵向渐变（底浓顶淡一点点），不再有径向团
            stopPositions = floatArrayOf(0f, 0.6f, 1f)
            stopWeights = floatArrayOf(1f, 0.96f, 0.66f)
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
            coreAlpha = if (dark) 0.90f else 0.92f
            // 纵向铺满整块面板：底部 100%、58% 处仍 100%、82% 处 55%、顶端透明
            stopPositions = floatArrayOf(0f, 0.58f, 0.82f, 1f)
            stopWeights = floatArrayOf(1f, 1f, 0.55f, 0f)
        }
        val content = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(ctx, 22), dp(ctx, 14), dp(ctx, 22), dp(ctx, 12))
            // 关键：面板加窗后由容器拿焦点，EditText **不自动**抢焦点
            // （否则系统会在没人点输入行的情况下自己弹输入法——真机实录）
            isFocusable = true
            isFocusableInTouchMode = true
        }

        // 两个功能性裸文字入口（单窗不变量下，球在面板打开时必须摘掉，
        // 所以「再点球回球」改由这里的「收起」承担）：
        //   · 收起 —— 回球（面板摘掉、球窗重新挂上）
        //   · 本次关闭悬浮球 —— 需求 5：雾面表面可直接本次关闭
        val head = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL or Gravity.END
        }
        head.addView(
            View(ctx),
            LinearLayout.LayoutParams(0, 1, 1f),
        )
        val collapse = TextView(ctx).apply {
            text = "收起"
            textSize = 12f
            setTextColor(ink(dark))
            alpha = 0.55f
            setPadding(dp(ctx, 8), dp(ctx, 2), dp(ctx, 8), dp(ctx, 6))
        }
        head.addView(
            collapse,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ),
        )
        val close = TextView(ctx).apply {
            text = "本次关闭悬浮球"
            textSize = 12f
            setTextColor(ink(dark))
            alpha = 0.55f
            setPadding(dp(ctx, 8), dp(ctx, 2), 0, dp(ctx, 6))
        }
        head.addView(
            close,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ),
        )
        content.addView(
            head,
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
            // 长按 = 说话（手势在 OverlayWindows 的 touch 拦截里做）：
            // 关掉文本长按与选择手柄，否则长按只是在输入框里放光标/选词
            isLongClickable = false
            setTextIsSelectable(false)
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
        val underline = View(ctx).apply { setBackgroundColor(withAlpha(ink(dark), 38)) }

        // 附件三入口（需求 6）：纯裸文字，走系统选择器，应用不申请存储/相机权限
        val attachRow = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        fun entry(label: String, startPad: Int): TextView = TextView(ctx).apply {
            text = label
            textSize = 12f
            setTextColor(ink(dark))
            alpha = 0.72f
            setPadding(dp(ctx, startPad), dp(ctx, 4), 0, dp(ctx, 4))
        }
        val camBtn = entry("拍照", 0)
        val galBtn = entry("相册", 16)
        val fileBtn = entry("上传", 16)
        attachRow.addView(
            camBtn,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ),
        )
        attachRow.addView(
            galBtn,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ),
        )
        attachRow.addView(
            fileBtn,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ),
        )
        val arlp = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        )
        arlp.topMargin = dp(ctx, 10)
        content.addView(attachRow, arlp)

        // 面板内语音行（单窗不变量：面板里长按说话不切窗）：放在输入行**上方**，默认 GONE
        val voiceRow = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            visibility = View.GONE
        }
        val voiceWave = WaveDots(ctx).apply {
            dotColor = ink(dark)
            isClickable = false
        }
        voiceRow.addView(voiceWave, LinearLayout.LayoutParams(dp(ctx, 52), dp(ctx, 24)))
        val voiceText = TextView(ctx).apply {
            text = "在听，请讲…"
            textSize = MSG_SP
            maxLines = 2
            setTextColor(ink(dark))
            isClickable = false
        }
        val vtlp = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        vtlp.marginStart = dp(ctx, 12)
        voiceRow.addView(voiceText, vtlp)
        val vrlp = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        )
        vrlp.topMargin = dp(ctx, 10)
        content.addView(voiceRow, vrlp)

        // 输入块（输入行 + 下划线）
        val inputBlock = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
        }
        inputBlock.addView(
            inputRow,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ),
        )
        inputBlock.addView(
            underline,
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, max(1, dp(ctx, 1))),
        )
        val iblp = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        )
        iblp.topMargin = dp(ctx, 8)
        content.addView(inputBlock, iblp)

        root.addView(
            content,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ),
        )
        return PanelHolder(
            root, content, collapse, close, scroll, list, empty,
            input, action, underline, camBtn, galBtn, fileBtn,
            inputBlock, voiceRow, voiceWave, voiceText,
        )
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
 * 雾层：**纵向 linear-gradient**（半屏铺满、向上变淡）的自定义 ViewGroup。
 *
 * - 直接在 onDraw 里画（setWillNotDraw(false)），**不设任何背景色**；
 * - 渐变从**底边**起算：底部最浓（coreAlpha），按 stopPositions/stopWeights 连续变淡，
 *   到 stopPositions=1（顶边）alpha = 0 → 雾之外完全透明；
 * - 等价 CSS：`linear-gradient(to top, #000 0%, #000 58%, rgba(0,0,0,.55) 82%, transparent 100%)`。
 *   真机反馈原话：「谁家一片径向雾的，应该是从底下到半屏幕铺满并且渐变变淡」。
 */
class FogLayout(context: Context) : FrameLayout(context) {
    var coreColor: Int = OverlayViews.FOG_LIGHT
    var coreAlpha: Float = 0.9f

    /** 距**底边**的归一化位置（0 = 底边，1 = 顶边） */
    var stopPositions: FloatArray = floatArrayOf(0f, 0.58f, 0.82f, 1f)

    /** 与 stopPositions 一一对应的 alpha 权重（最终 alpha = coreAlpha * 权重） */
    var stopWeights: FloatArray = floatArrayOf(1f, 1f, 0.55f, 0f)

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private var shader: LinearGradient? = null

    init {
        setWillNotDraw(false)
        isClickable = false
    }

    /** 主题切换时重算颜色 */
    fun recolor(dark: Boolean) {
        coreColor = OverlayViews.fogCore(dark)
        shader = null
        invalidate()
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        shader = build(w, h)
    }

    private fun build(w: Int, h: Int): LinearGradient {
        val n = minOf(stopPositions.size, stopWeights.size).coerceAtLeast(2)
        val a = (coreAlpha.coerceIn(0f, 1f) * 255f).toInt()
        val colors = IntArray(n)
        val pos = FloatArray(n)
        for (i in 0 until n) {
            pos[i] = stopPositions[i].coerceIn(0f, 1f)
            colors[i] = OverlayViews.withAlpha(coreColor, (a * stopWeights[i].coerceIn(0f, 1f)).toInt())
        }
        // 从底边 (0,h) 到顶边 (0,0)：t=0 落在底部 → 底部最浓、越往上越淡
        return LinearGradient(
            0f,
            h.coerceAtLeast(1).toFloat(),
            0f,
            0f,
            colors,
            pos,
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
    val collapseBtn: TextView,
    val closeBtn: TextView,
    val scroll: ScrollView,
    val list: LinearLayout,
    val empty: TextView,
    val input: EditText,
    val actionBtn: TextView,
    val underline: View,
    /** 附件三入口：拍照 / 相册 / 上传 */
    val camBtn: TextView,
    val galBtn: TextView,
    val fileBtn: TextView,
    /** 输入块（输入行 + 下划线）：说话时只降透明度（不能 GONE——会取消按住它的手势流） */
    val inputBlock: LinearLayout,
    val voiceRow: LinearLayout,
    val voiceWave: WaveDots,
    val voiceText: TextView,
)

class OrbHolder(
    val root: FrameLayout,
    /** 球本体：实底 + 细边框 + 轻投影的 TextView（文案「（OH）」） */
    val ball: TextView,
    val bar: FogLayout,
    val wave: WaveDots,
    val barText: TextView,
)
