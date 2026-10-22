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
import android.graphics.Typeface
import android.text.InputType
import android.text.Spannable
import android.text.SpannableStringBuilder
import android.text.style.RelativeSizeSpan
import android.text.style.TypefaceSpan
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import kotlin.math.max
import kotlin.math.sin

object OverlayViews {
    /** 球直径：54dp（Lead 更正口径：容器尺寸不动，只放大里面的字号） */
    const val BALL_DP = 54

    /** 球窗尺寸 = 球 + 两侧各 8dp 留白：elevation 的轻投影要画在视图之外，
     *  窗口若正好等于球的大小，投影会被边界裁掉。 */
    const val BALL_WIN_DP = BALL_DP + 16

    /** 面板正文字体（sans-serif 400）；品牌标识见 harnessMark() */
    fun brandTypeface(): Typeface = try {
        Typeface.create("sans-serif-medium", Typeface.BOLD)
    } catch (_: Throwable) {
        Typeface.DEFAULT_BOLD
    }

    /**
     * 本体品牌标识 (OH) 的**逐字符混排**（对齐 components/HarnessMark.tsx + global.css:4090-4093）：
     *   `(` `)` = 代码字体 mono / weight 400 / 竖向量略高（CSS transform: scaleY(1.06)）
     *   `O`     = 衬线 serif / weight 500 / 字号 1.14em
     *   `H`     = 无衬线（苹方同族）/ weight 700 / 字号 1.06em
     * `gap: 0.05em` → Android 用 letterSpacing=0.05；`align-items:baseline` → 同一 TextView 天然共基线。
     *
     * 返回 Spannable：调用方 setText 后即得混排效果（TextView 必须 isSingleLine + includeFontPadding=false）。
     */
    fun harnessMark(): CharSequence {
        val plain = "(OH)"
        val sb = android.text.SpannableStringBuilder(plain)
        val flags = android.text.Spannable.SPAN_EXCLUSIVE_EXCLUSIVE
        // ( ) —— mono 400。等宽字体的括号本身偏小偏细，补到 **1.10×** 才不会「比字母小一圈」；
        // CSS 里的 scaleY(1.06) 也用这个等比放大近似。
        for (i in intArrayOf(0, 3)) {
            sb.setSpan(TypefaceSpan("monospace"), i, i + 1, flags)
            sb.setSpan(RelativeSizeSpan(1.10f), i, i + 1, flags)
        }
        // O —— serif 500 / 1.14em
        sb.setSpan(TypefaceSpan(weighted("serif", 500, Typeface.NORMAL)), 1, 2, flags)
        sb.setSpan(RelativeSizeSpan(1.14f), 1, 2, flags)
        // H —— sans 700 / 1.06em
        sb.setSpan(TypefaceSpan(weighted("sans-serif", 700, Typeface.BOLD)), 2, 3, flags)
        sb.setSpan(RelativeSizeSpan(1.06f), 2, 3, flags)
        return sb
    }

    /** 取指定字重的系统字族：API 28+ 支持数值字重；旧版本退到 NORMAL/BOLD 两档 */
    private fun weighted(family: String, weight: Int, fallbackStyle: Int): Typeface {
        // 先用两参重载拿到字族（全 API 可用），API 28+ 再用 (Typeface, weight, italic) 叠数值字重。
        // 注意：别用 (String, Int, Boolean) 那个重载——在本模块的 compileSdk 下解析不到（曾编译失败）。
        val base = Typeface.create(family, fallbackStyle)
        if (android.os.Build.VERSION.SDK_INT < 28) return base
        return try {
            Typeface.create(base, weight, false)
        } catch (_: Throwable) {
            base
        }
    }

    /**
     * **任何状态都不许出现蓝色矩形框**（用户实录：朗读按钮点击前后都有蓝框）。
     * 安卓点按可点 View 会命中 default focus highlight / state_focused —— 这里统一关掉：
     * 可点仍可点（clickable 不需要 focusable），状态表达改用 alpha 或图标填充。
     */
    fun noFocusRing(v: View) {
        try {
            if (android.os.Build.VERSION.SDK_INT >= 26) v.defaultFocusHighlightEnabled = false
            v.isFocusable = false
            v.isFocusableInTouchMode = false
            v.backgroundTintList = null
        } catch (_: Throwable) {
            /* 个别 ROM：忽略 */
        }
    }

    /**
     * 顶部把手（用户 ⑤，21:5x 反馈「好难拖动」后加宽命中区）：
     * **视觉条 36×5dp** 居中，但**可拖区域 = 全宽 × 36dp**（上下各 ≈15dp，≥12dp），
     * 手指按在条附近任何位置都能拖 —— 不需要精准命中那 5dp 细条。
     * 返回的是**容器**（触摸监听挂在它上面），视觉条是它的子 View。
     */
    fun buildHandle(ctx: Context, dark: Boolean): View {
        val container = FrameLayout(ctx).apply {
            isClickable = false
            isFocusable = false
            alpha = 0.75f
            noFocusRing(this)
        }
        val bar = View(ctx).apply {
            background = GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                cornerRadius = dp(ctx, 3).toFloat()
                setColor(withAlpha(ink(dark), 100))
            }
            isClickable = false
            isFocusable = false
        }
        container.addView(
            bar,
            FrameLayout.LayoutParams(
                dp(ctx, HANDLE_W_DP),
                dp(ctx, HANDLE_H_DP),
                Gravity.CENTER,
            ),
        )
        return container
    }

    /** 视觉条尺寸 */
    const val HANDLE_W_DP = 36
    const val HANDLE_H_DP = 5

    /** **可拖区域高度**（全宽 × 这个高度；上下各 ≈15dp，满足「≥12dp 内边距」） */
    const val HANDLE_TOUCH_H_DP = 36

    /** 拖动判定阈值：位移 >2dp 才进入拖动（避免微抖；进入时会 rebase，所以不会跳变） */
    const val HANDLE_SLOP_DP = 2

    /** 正文/按钮统一加一点阴影：雾淡处压在壁纸上也能读（半径 6dp、α0.25） */
    fun shadow(tv: TextView) {
        try {
            tv.setShadowLayer(
                dp(tv.context, 6).toFloat(),
                0f,
                dp(tv.context, 1).toFloat(),
                0x40000000,
            )
        } catch (_: Throwable) {
            /* 个别 ROM 不支持：忽略 */
        }
    }

    /** 面板顶栏动作的**可读衬底**：半透明小胶囊 + 1px 细边（浅 #FFFFFF α0.86 / 深 #000000 α0.45） */
    fun capsule(ctx: Context, dark: Boolean): GradientDrawable = GradientDrawable().apply {
        shape = GradientDrawable.RECTANGLE
        cornerRadius = dp(ctx, 999).toFloat()
        setColor(if (dark) 0x73000000 else 0xDBFFFFFF.toInt())
        setStroke(max(1, dp(ctx, 1)), if (dark) 0x33FFFFFF else 0x1F000000)
    }

    /** 球文案：与本体 HarnessMark 完全一致的四个字符（半角括号 + O + H） */
    const val BALL_TEXT = "(OH)"

    /** 语音条高：56dp（PLAN §3.1） */
    const val BAR_DP = 56

    /** 悬浮小窗圆角（token：--dsw-radius-xl 20 / panel 28 之间取 24） */
    const val PANEL_RADIUS_DP = 24

    const val MSG_SP = 15f

    /**
     * 行高倍率。Android 的 `lineSpacingMultiplier` 乘的是**字体自身行高**（Roboto ≈1.17em），
     * 所以 1.32 × 1.17 ≈ **1.55em** ≈ CSS `line-height: 1.55`（用户要求 1.55–1.62 之间取低端，
     * 这样单行气泡才压得进 40dp：15sp×1.17×1.32 ≈ 23.2dp + 8dp×2 = 39.2dp）。
     */
    const val LINE_MULT = 1.32f

    /**
     * 气泡内边距（用户要求：垂直 ≤9dp、水平 ≤13dp）。
     * 取 7dp 是因为要守住「单行气泡总高 ≤40dp」：Android 单行 = 15sp×1.17×1.32 ≈ 23.2dp + 7×2 = **37.2dp**；
     * 静态桩用中文字体量出来 ≈ 39.25dp，两种算法都在 40dp 以内（8dp 时静态桩量到 41.25dp，会超）。
     */
    const val BUBBLE_PAD_V_DP = 7
    const val BUBBLE_PAD_H_DP = 13

    /** 顶栏胶囊：高 32dp、水平内边距 12dp、彼此间距 8dp、与小窗边距一致 14dp */
    const val CHIP_H_DP = 32
    const val CHIP_PAD_H_DP = 12
    const val CHIP_GAP_DP = 8
    const val PANEL_EDGE_DP = 14
    /** 消息间距（用户要求 10–12dp） */
    const val GAP_DP = 11

    /** 气泡里两侧都用主色 100% alpha（区分靠气泡自身位置与尾角，不靠透明度） */
    const val USER_ALPHA = 1f

    /* ── liquid glass 材质（跨应用窗口拿不到真 backdrop blur，用材质模拟）── */

    /** 整块毛玻璃背板（用户 20:30：「底板再厚重一点，这个有点透」）：浅 α0.90 / 深 α0.80 */
    fun backplateFill(light: Boolean): Int =
        if (light) withAlpha(0xFFFFFFFF.toInt(), 230) else withAlpha(0xFF000000.toInt(), 204)

    /** 背板细边 */
    fun backplateBorder(light: Boolean): Int =
        if (light) withAlpha(0x00000000, 36) else withAlpha(0xFFFFFFFF.toInt(), 48)

    /** 玻璃底（气泡用）：浅 #FFFFFF α0.62→0.48；深 #000000 α0.42→0.30 */
    fun glassFill(light: Boolean, top: Boolean): Int =
        if (light) {
            withAlpha(0xFFFFFFFF.toInt(), if (top) 158 else 122)
        } else {
            withAlpha(0xFF000000.toInt(), if (top) 107 else 77)
        }

    /** 极淡 1px 描边（防硬边/纯灰块） */
    fun glassBorder(light: Boolean): Int =
        if (light) withAlpha(0xFFFFFFFF.toInt(), 90) else withAlpha(0xFFFFFFFF.toInt(), 56)

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
            // 逐字符混排（mono 括号 / serif O / sans H），字号 15sp（本体悬浮岛就是 <HarnessMark size={15}/>）
            text = harnessMark()
            textSize = 15f
            gravity = Gravity.CENTER
            setTextColor(ink(dark))
            // gap: 0.05em
            letterSpacing = 0.05f
            includeFontPadding = false
            isSingleLine = true
            background = bg
            // 轻投影：硬件加速窗口里 elevation + 背景 outline 会给柔和阴影
            elevation = dp(ctx, 6).toFloat()
            isClickable = false
            isFocusable = false
        }
    }

    /**
     * 语音长条（task-15 D）：**球原地横向展开**——56dp 高的雾带 + 点点波纹 + 一行转写；
     * 上方再浮一层淡雾专门显示「识别到的话」（用户原话：上面一点点雾状显示识别到的话）。
     * 返回 (根, 波纹, 条内文字, 上方转写带, 转写文字)。
     */
    class VoiceBar(
        val root: FogLayout,
        val wave: WaveDots,
        val hint: TextView,
        val sub: FogLayout,
        val subText: TextView,
    )

    fun buildVoiceBar(ctx: Context, dark: Boolean): VoiceBar {
        val root = FogLayout(ctx).apply {
            // 与面板/气泡同一套：整块毛玻璃，无渐隐（同面板加厚口径）
            coreColor = fogCore(dark)
            coreAlpha = if (dark) 0.80f else 0.90f
            stopPositions = floatArrayOf(0f, 1f)
            stopWeights = floatArrayOf(1f, 1f)
            cornerRadiusPx = dp(ctx, 18).toFloat()
            borderColor = backplateBorder(!dark)
            topHighlight = if (dark) 0.22f else 0.5f
        }
        val column = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(ctx, 16), dp(ctx, 6), dp(ctx, 16), dp(ctx, 8))
        }
        // 上方：淡雾转写带（默认 GONE，说话时显示）
        val sub = FogLayout(ctx).apply {
            // 转写带同材质（整块毛玻璃），比面板略薄 0.06~0.10
            coreColor = fogCore(dark)
            coreAlpha = if (dark) 0.68f else 0.82f
            stopPositions = floatArrayOf(0f, 1f)
            stopWeights = floatArrayOf(1f, 1f)
            cornerRadiusPx = dp(ctx, 14).toFloat()
            borderColor = backplateBorder(!dark)
            topHighlight = if (dark) 0.22f else 0.5f
            visibility = View.GONE
        }
        val subText = TextView(ctx).apply {
            text = ""
            textSize = MSG_SP
            maxLines = 2
            setTextColor(ink(dark))
            setPadding(dp(ctx, 12), dp(ctx, 6), dp(ctx, 12), dp(ctx, 6))
            includeFontPadding = false
            shadow(this)
            isClickable = false
        }
        sub.addView(
            subText,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.CENTER_VERTICAL,
            ),
        )
        column.addView(
            sub,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(ctx, SUB_BAR_H_DP),
            ),
        )
        // 下方：条本体（波纹 + 一行提示/转写）
        val row = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val wave = WaveDots(ctx).apply {
            dotColor = ink(dark)
            isClickable = false
        }
        row.addView(wave, LinearLayout.LayoutParams(dp(ctx, 52), dp(ctx, 24)))
        val hint = TextView(ctx).apply {
            text = "在听，请讲…"
            textSize = MSG_SP
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
            setTextColor(ink(dark))
            isClickable = false
            shadow(this)
        }
        val hlp2 = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        hlp2.marginStart = dp(ctx, 12)
        row.addView(hint, hlp2)
        column.addView(
            row,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(ctx, BAR_DP),
            ),
        )
        root.addView(
            column,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ),
        )
        return VoiceBar(root, wave, hint, sub, subText)
    }

    /** 语音条窗口尺寸（条 + 上方转写带） */
    const val VOICE_BAR_W_DP = 300
    const val SUB_BAR_H_DP = 40

    /** 悬浮对话小窗：整块毛玻璃背板 + liquid glass 气泡 + 底部无框下划线输入行 */
    fun buildPanel(ctx: Context, dark: Boolean): PanelHolder {
        val root = FogLayout(ctx).apply {
            coreColor = fogCore(dark)
            // 整块毛玻璃背板：上下同浓度、无渐隐；α 按用户 20:30 反馈加厚（浅 0.90 / 深 0.80）
            coreAlpha = if (dark) 0.80f else 0.90f
            stopPositions = floatArrayOf(0f, 1f)
            stopWeights = floatArrayOf(1f, 1f)
            // 悬浮小窗（左右留空隙）→ 四周圆角 + 1px 细边 + 上沿高光（同一套液态玻璃语言）
            cornerRadiusPx = dp(ctx, PANEL_RADIUS_DP).toFloat()
            borderColor = backplateBorder(!dark)
            topHighlight = if (dark) 0.22f else 0.5f
        }
        val content = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            // 左右 14dp：与小窗到屏幕的边距一致（顶栏胶囊也吃这个缩进）
            setPadding(dp(ctx, PANEL_EDGE_DP), dp(ctx, 6), dp(ctx, PANEL_EDGE_DP), dp(ctx, 12))
            // 关键：面板加窗后由容器拿焦点，EditText **不自动**抢焦点
            // （否则系统会在没人点输入行的情况下自己弹输入法——真机实录）
            isFocusable = true
            isFocusableInTouchMode = true
        }

        // 顶部把手（⑤）：36×5dp 圆角条，居中；**竖直拖动改小窗高度**（clamp 30%–80% 屏高）
        val handle = buildHandle(ctx, dark)
        content.addView(
            handle,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(ctx, HANDLE_TOUCH_H_DP),
            ),
        )

        // 顶栏：**一行三个胶囊**（回到 OneTHU / 朗读 开·关 / 收起）——在 ScrollView 之外，任何滚动位置都在。
        // 规格（用户拍板）：高 32dp、水平内边距 12dp、彼此间距 8dp、左右与小窗边距一致（content 的 14dp）；
        // 单行显示、不换行、不截断；文案按 360dp 宽收敛过（「朗读 开/关」而不是「自动朗读：开」）。
        val headRow = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }

        fun chip(label: String): TextView = TextView(ctx).apply {
            text = label
            textSize = 12f
            setTextColor(ink(dark))
            alpha = 1f
            background = capsule(ctx, dark)
            setPadding(dp(ctx, CHIP_PAD_H_DP), 0, dp(ctx, CHIP_PAD_H_DP), 0)
            gravity = Gravity.CENTER
            isSingleLine = true
            maxLines = 1
            ellipsize = null
            includeFontPadding = false
            shadow(this)
            noFocusRing(this)
        }

        val backBtn = chip("回到 OneTHU")
        val speakBtn = chip("朗读 关")
        val collapse = chip("⌄ 收起").apply {
            setTextColor(fogCore(dark))
            typeface = Typeface.create("sans-serif-medium", Typeface.BOLD)
            textSize = 13f
            minWidth = dp(ctx, 76)
            contentDescription = "收起"
            background = GradientDrawable().apply {
                cornerRadius = dp(ctx, 22).toFloat()
                setColor(ink(dark))
            }
        }
        headRow.addView(
            backBtn,
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(ctx, CHIP_H_DP)),
        )
        val sbLp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(ctx, CHIP_H_DP))
        sbLp.marginStart = dp(ctx, CHIP_GAP_DP)
        headRow.addView(speakBtn, sbLp)
        val clp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(ctx, 44))
        clp.marginStart = dp(ctx, CHIP_GAP_DP)
        headRow.addView(collapse, clp)
        content.addView(
            headRow,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ),
        )

        // 消息区（可滑动）。顶栏在它之外 → 任何滚动位置都常驻；只在这里放消息
        val list = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            // 气泡的柔和阴影需要画到自身边界之外
            clipChildren = false
        }
        val scroll = ScrollView(ctx).apply {
            isFillViewport = true
            isVerticalScrollBarEnabled = false
            overScrollMode = View.OVER_SCROLL_NEVER
            addView(
                list,
                ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                ),
            )
        }
        val slp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        slp.topMargin = dp(ctx, 10)
        content.addView(scroll, slp)

        // 底部输入行：无框下划线（EditText 无背景 + 其下一条 1dp 细线）
        val inputRow = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val input = EditText(ctx).apply {
            hint = "点击输入，长按说话"
            textSize = MSG_SP
            setTextColor(ink(dark))
            // 占位也算读得清的界面文字：0.92 而不是原来的 0.38（Lead 要求 ≥0.92）
            setHintTextColor(withAlpha(ink(dark), 235))
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
            // 「发送」用主色、不用灰（真机反馈）
            textSize = 14f
            setTextColor(ink(dark))
            alpha = 1f
            setPadding(dp(ctx, 12), dp(ctx, 6), 0, dp(ctx, 6))
            shadow(this)
            noFocusRing(this)
        }
        inputRow.addView(
            action,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ),
        )
        val underline = View(ctx).apply { setBackgroundColor(withAlpha(ink(dark), 72)) }

        // 附件三入口（需求 6）：**线描图标**（用户口径：手机档只留线描图标 + title 语义，一行不折，不收 emoji）。
        // 走系统选择器，应用不申请存储/相机权限；可点区域 40×40dp，语义经 contentDescription + tooltipText 给到。
        val attachRow = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val iconPx = dp(ctx, 40)
        fun entry(kind: String, title: String): LineIcon = LineIcon(ctx, kind).apply {
            color = ink(dark)
            alpha = 0.95f
            contentDescription = title
            if (android.os.Build.VERSION.SDK_INT >= 26) tooltipText = title
            isClickable = true
            setPadding(dp(ctx, 6), dp(ctx, 6), dp(ctx, 6), dp(ctx, 6))
            noFocusRing(this)
        }
        val camBtn = entry("camera", "拍照")
        val galBtn = entry("gallery", "相册")
        val fileBtn = entry("upload", "上传")
        attachRow.addView(camBtn, LinearLayout.LayoutParams(iconPx, iconPx))
        val galLp = LinearLayout.LayoutParams(iconPx, iconPx)
        galLp.marginStart = dp(ctx, 10)
        attachRow.addView(galBtn, galLp)
        val fileLp = LinearLayout.LayoutParams(iconPx, iconPx)
        fileLp.marginStart = dp(ctx, 10)
        attachRow.addView(fileBtn, fileLp)

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

        // 光晕：扩散动效里从滴点淡出（默认全透明，不可点）
        val glow = View(ctx).apply {
            alpha = 0f
            isClickable = false
            isFocusable = false
            background = GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                gradientType = GradientDrawable.RADIAL_GRADIENT
                gradientRadius = dp(ctx, 320).toFloat()
                colors = intArrayOf(
                    withAlpha(ink(dark), 46),
                    withAlpha(ink(dark), 16),
                    0x00000000,
                )
                setGradientCenter(0.5f, 0.72f)
            }
        }
        root.addView(
            glow,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ),
        )
        return PanelHolder(
            root, content, handle, backBtn, speakBtn, collapse, scroll, list, glow,
            input, action, underline, camBtn, galBtn, fileBtn,
            inputBlock, voiceRow, voiceWave, voiceText,
        )
    }

    /** 侧边缩略条尺寸（像腾讯会议那种小胶囊） */
    const val SIDE_W_DP = 22
    const val SIDE_H_DP = 56

    /** 侧边窗尺寸（同样留 8dp 投影边） */
    const val SIDE_WIN_W_DP = SIDE_W_DP + 16
    const val SIDE_WIN_H_DP = SIDE_H_DP + 16

    /**
     * 侧边缩略条：实底 + 1px 细边 + 轻投影的小胶囊（贴在屏幕左/右边缘），
     * 中间一个低透明度圆点做可点提示。点击 = 丝滑展开回悬浮球。
     */
    fun buildSideBar(ctx: Context, dark: Boolean): TextView {
        val fill = if (dark) 0xFF151517.toInt() else 0xFFFFFFFF.toInt()
        val border = if (dark) 0x24FFFFFF else 0x1A000000
        val bg = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = dp(ctx, SIDE_W_DP / 2 + 4).toFloat()
            setColor(fill)
            setStroke(max(1, dp(ctx, 1)), border)
        }
        return TextView(ctx).apply {
            text = "•"
            textSize = 10f
            gravity = Gravity.CENTER
            setTextColor(withAlpha(ink(dark), 110))
            background = bg
            elevation = dp(ctx, 5).toFloat()
            isClickable = false
            isFocusable = false
        }
    }

    /**
     * 附件图片缩略图：本地文件直接渲染（异步降采样解码），点一下放大/再点收小。
     * 不新开窗口（单窗不变量），放大是**在消息列表里原地变大**。
     */
    fun buildImageThumb(
        ctx: Context,
        path: String,
        dark: Boolean,
        bigHeightPx: Int,
        onToggle: () -> Unit,
    ): ImageView {
        val w = dp(ctx, 220)
        val h = dp(ctx, 150)
        val iv = ImageView(ctx).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            setBackgroundColor(withAlpha(ink(dark), 26))
            clipToOutline = true
            outlineProvider = object : android.view.ViewOutlineProvider() {
                override fun getOutline(view: View, outline: android.graphics.Outline) {
                    outline.setRoundRect(0, 0, view.width, view.height, dp(ctx, 14).toFloat())
                }
            }
        }
        iv.layoutParams = LinearLayout.LayoutParams(w, h)
        var big = false
        iv.setOnClickListener {
            big = !big
            val lp = iv.layoutParams as LinearLayout.LayoutParams
            lp.width = if (big) dp(ctx, 320) else w
            lp.height = if (big) bigHeightPx else h
            iv.scaleType = if (big) ImageView.ScaleType.FIT_CENTER else ImageView.ScaleType.CENTER_CROP
            iv.layoutParams = lp
            onToggle()
        }
        loadThumb(iv, path, if (big) 1024 else 480)
        return iv
    }

    /** 降采样解码到最长边 <= maxPx，解完 post 回 UI 线程（绝不阻塞面板打开） */
    private fun loadThumb(iv: ImageView, path: String, maxPx: Int) {
        Thread {
            val bmp = try {
                val opts = android.graphics.BitmapFactory.Options().apply {
                    inJustDecodeBounds = true
                }
                android.graphics.BitmapFactory.decodeFile(path, opts)
                var sample = 1
                while (opts.outWidth / sample > maxPx || opts.outHeight / sample > maxPx) sample *= 2
                android.graphics.BitmapFactory.decodeFile(
                    path,
                    android.graphics.BitmapFactory.Options().apply { inSampleSize = sample },
                )
            } catch (_: Throwable) {
                null
            }
            if (bmp != null) {
                iv.post { runCatching { iv.setImageBitmap(bmp) } }
            }
        }.start()
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

    /** 圆角（px）：>0 时把玻璃裁成圆角小窗；0 = 满幅（语音条用） */
    var cornerRadiusPx: Float = 0f

    /** 1px 细边颜色（0 = 不画） */
    var borderColor: Int = 0

    /** 上沿 1px 内高光强度（0..1，0 = 不画） */
    var topHighlight: Float = 0f

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 1f
    }
    private var shader: LinearGradient? = null
    private val clipPath = android.graphics.Path()
    private var roundPath = android.graphics.Path()

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

    @Suppress("UNUSED_PARAMETER")
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
        if (width <= 0 || height <= 0) return
        val s = shader ?: build(width, height).also { shader = it }
        paint.shader = s
        val r = cornerRadiusPx
        roundPath.reset()
        if (r > 0f) {
            roundPath.addRoundRect(
                0f, 0f, width.toFloat(), height.toFloat(), r, r, android.graphics.Path.Direction.CW,
            )
            canvas.drawPath(roundPath, paint)
        } else {
            canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), paint)
        }
        // 1px 细边（防硬边）
        if (borderColor != 0) {
            strokePaint.color = borderColor
            if (r > 0f) {
                canvas.drawPath(roundPath, strokePaint)
            } else {
                canvas.drawRect(
                    strokePaint.strokeWidth / 2f, strokePaint.strokeWidth / 2f,
                    width - strokePaint.strokeWidth / 2f, height - strokePaint.strokeWidth / 2f, strokePaint,
                )
            }
        }
        // 上沿 1px 内高光（与气泡同一套语言）
        if (topHighlight > 0.01f) {
            val band = 2f
            val hi = Paint(strokePaint).apply {
                color = OverlayViews.withAlpha(0xFFFFFFFF.toInt(), (topHighlight.coerceIn(0f, 1f) * 255).toInt())
            }
            val save = canvas.save()
            canvas.clipRect(0f, 0f, width.toFloat(), band)
            if (r > 0f) canvas.drawPath(roundPath, hi) else canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), hi)
            canvas.restoreToCount(save)
        }
    }
}

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
    /** 顶部把手（竖直拖动改小窗高度） */
    val handle: View,
    /** 回到 OneTHU（用户主动点击） */
    val backBtn: TextView,
    /** 自动朗读开关（文案随状态变） */
    val autoSpeakBtn: TextView,
    /** 顶栏第三个动作（收起）——「本次关闭悬浮球」已按用户要求删除，该语义仍在通知栏动作里 */
    val collapseBtn: TextView,
    val scroll: ScrollView,
    val list: LinearLayout,
    /** 扩散光晕层（动效用，默认 alpha=0） */
    val glow: View,
    val input: EditText,
    val actionBtn: TextView,
    val underline: View,
    /** 附件三入口（线描图标）：拍照 / 相册 / 上传 */
    val camBtn: View,
    val galBtn: View,
    val fileBtn: View,
    /** 输入块（输入行 + 下划线）：说话时只降透明度（不能 GONE——会取消按住它的手势流） */
    val inputBlock: LinearLayout,
    val voiceRow: LinearLayout,
    val voiceWave: WaveDots,
    val voiceText: TextView,
)

class OrbHolder(
    val root: FrameLayout,
    /** 球本体：实底 + 细边框 + 轻投影的 TextView（文案「(OH)」三字体混排） */
    val ball: TextView,
    /** 侧边缩略条（边缘吸附形态） */
    val side: TextView,
    /** 语音长条（球原位横向展开；含上方一层淡雾转写带） */
    val bar: OverlayViews.VoiceBar,
)
