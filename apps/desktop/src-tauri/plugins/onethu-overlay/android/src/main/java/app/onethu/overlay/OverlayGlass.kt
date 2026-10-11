// OneTHU 悬浮层：liquid glass 气泡（用户拍板：气泡 + 自然弹出 + 带点 liquid glass）。
//
// 跨应用窗口拿不到真 backdrop blur，所以这里用**材质模拟**逼近（不放弃）：
//   ① 半透明 + 轻微纵向渐变底（浅 #FFFFFF α0.62→0.48 / 深 #000000 α0.42→0.30）
//   ② 上沿 1px 内高光（等价 CSS `inset 0 1px 0 rgba(255,255,255,.5)`）+ 可动的高光扫过
//   ③ 柔和外阴影（elevation，半径 ~14dp；outline 跟随气泡圆角）
//   ④ 1px 极淡描边防止「纯灰块/硬边」观感；深色模式高光更弱、阴影更重
//   ⑤ 说话方那一侧的尾角收成 6dp（用户右下 / OH 左下），一眼看出谁在说话
//
// 动画（只给**最新一条**播）：scale 0.94→1.0 + 上移 6dp + Overshoot(1.05)，200ms；
// 同时顶部高光 α0.35→0 扫过 200ms。

package app.onethu.overlay

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Outline
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Shader
import android.view.View
import android.view.ViewOutlineProvider
import android.view.animation.OvershootInterpolator
import android.widget.FrameLayout

class GlassBubble(context: Context) : FrameLayout(context) {

    /** 四角半径（px，顺序 tl,tr,br,bl） */
    var cornerRadiiPx = FloatArray(4) { OverlayViews.dp(context, 20).toFloat() }

    /** 纵向渐变底（ARGB，含 alpha） */
    var fillTop = 0
    var fillBottom = 0

    /** 1px 描边（极淡，防止硬边） */
    var borderColor = 0

    /** 静态上沿高光强度（深色更弱） */
    var topHighlight = 0.5f

    /** 动画用的额外高光（0.35→0） */
    var sweepAlpha = 0f
        private set

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = OverlayViews.dp(context, 1).toFloat().coerceAtLeast(1f)
    }
    private val path = Path()
    private var shader: LinearGradient? = null

    init {
        setWillNotDraw(false)
        // 外阴影：elevation + 跟随圆角的 outline（深色模式在调用处调高一点）
        outlineProvider = object : ViewOutlineProvider() {
            override fun getOutline(view: View, outline: Outline) {
                val r = cornerRadiiPx.maxOrNull() ?: 0f
                outline.setRoundRect(0, 0, view.width, view.height, r)
            }
        }
        elevation = OverlayViews.dp(context, 14).toFloat()
    }

    /** 让「说话方那一侧」的尾角收成 6dp：user 右下、oh 左下 */
    fun tailFor(isUser: Boolean) {
        val big = OverlayViews.dp(context, 20).toFloat()
        val tail = OverlayViews.dp(context, 6).toFloat()
        cornerRadiiPx = if (isUser) {
            floatArrayOf(big, big, tail, big)
        } else {
            floatArrayOf(big, tail, big, big)
        }
        invalidateOutline()
        invalidate()
    }

    /** 自然弹出：只给最新一条消息播（历史消息保持静止） */
    fun playEnter() {
        scaleX = 0.94f
        scaleY = 0.94f
        translationY = OverlayViews.dp(context, 6).toFloat()
        animate().cancel()
        animate()
            .scaleX(1f).scaleY(1f).translationY(0f)
            .setDuration(200L)
            .setInterpolator(OvershootInterpolator(1.05f))
            .start()
        // 顶部高光扫过（"液"感）
        sweepAlpha = 0.35f
        val a = ValueAnimator.ofFloat(0.35f, 0f).setDuration(200L)
        a.addUpdateListener {
            sweepAlpha = it.animatedValue as Float
            invalidate()
        }
        a.start()
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        buildPath(w, h)
        shader = LinearGradient(
            0f, 0f, 0f, h.coerceAtLeast(1).toFloat(),
            fillTop, fillBottom, Shader.TileMode.CLAMP,
        )
    }

    private fun buildPath(w: Int, h: Int) {
        path.reset()
        val fw = w.toFloat()
        val fh = h.toFloat()
        val r0 = cornerRadiiPx[0]
        val r1 = cornerRadiiPx[1]
        val r2 = cornerRadiiPx[2]
        val r3 = cornerRadiiPx[3]
        // 顺时针：从左上开始，按 tl → tr → br → bl
        path.moveTo(r0, 0f)
        path.lineTo(fw - r1, 0f)
        path.quadTo(fw, 0f, fw, r1)
        path.lineTo(fw, fh - r2)
        path.quadTo(fw, fh, fw - r2, fh)
        path.lineTo(r3, fh)
        path.quadTo(0f, fh, 0f, fh - r3)
        path.lineTo(0f, r0)
        path.quadTo(0f, 0f, r0, 0f)
        path.close()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (width <= 0 || height <= 0) return
        if (path.isEmpty) buildPath(width, height)
        // ① 玻璃底（纵向渐变）
        paint.shader = shader
        canvas.drawPath(path, paint)
        // ② 极淡描边（防硬边）
        strokePaint.color = borderColor
        canvas.drawPath(path, strokePaint)
        // ③ 上沿 1px 内高光（静态 + 动画扫过），做法：裁到顶部窄带再描边 → 只亮上沿
        val band = OverlayViews.dp(context, 2).toFloat().coerceAtLeast(strokePaint.strokeWidth)
        val alpha = (topHighlight + sweepAlpha).coerceIn(0f, 1f)
        if (alpha > 0.01f) {
            val hi = Paint(strokePaint).apply {
                if (android.os.Build.VERSION.SDK_INT >= 29) {
                    color = OverlayViews.withAlpha(0xFFFFFFFF.toInt(), (alpha * 255).toInt())
                } else {
                    color = OverlayViews.withAlpha(0xFFFFFFFF.toInt(), (alpha * 255).toInt())
                }
            }
            val save = canvas.save()
            canvas.clipRect(0f, 0f, width.toFloat(), band)
            canvas.drawPath(path, hi)
            canvas.restoreToCount(save)
        }
    }
}
