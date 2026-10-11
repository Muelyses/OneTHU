// OneTHU 悬浮层：附件入口的**线描图标**（用户口径：手机档只留线描图标 + title 语义，一行不折，不收 emoji）。
//
// 三个图标全是 Canvas 自绘（1.5dp 描边、圆头圆角），不引资源、不引依赖，深浅色跟随主色；
// 可点区域 40×40dp（≥32dp 触控最小尺寸），语义经 contentDescription + tooltipText（API 26+）给到无障碍与长按提示。

package app.onethu.overlay

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.view.View
import kotlin.math.min

class LineIcon(context: Context, private val kind: String) : View(context) {

    var color: Int = 0xFF1C1F24.toInt()

    private val p = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = OverlayViews.dp(context, 2).toFloat() * 0.75f // 1.5dp
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        p.color = color
        fill.color = color
        val w = width.toFloat()
        val h = height.toFloat()
        val s = min(w, h)
        val inset = s * 0.16f
        val l = inset
        val t = inset
        val r = w - inset
        val b = h - inset
        val radius = s * 0.14f
        when (kind) {
            "camera" -> drawCamera(canvas, l, t, r, b, radius)
            "gallery" -> drawGallery(canvas, l, t, r, b, radius)
            else -> drawUpload(canvas, w, l, t, r, b)
        }
    }

    /** 拍照：机身圆角矩形 + 顶部取景凸起 + 镜头圆 */
    private fun drawCamera(c: Canvas, l: Float, t: Float, r: Float, b: Float, radius: Float) {
        val bodyTop = t + (b - t) * 0.14f
        c.drawRoundRect(RectF(l, bodyTop, r, b), radius, radius, p)
        // 取景凸起
        val bumpL = l + (r - l) * 0.30f
        val bumpR = l + (r - l) * 0.52f
        c.drawLine(bumpL, bodyTop, bumpL, t, p)
        c.drawLine(bumpL, t, bumpR, t, p)
        c.drawLine(bumpR, t, bumpR, bodyTop, p)
        // 镜头
        c.drawCircle((l + r) / 2f, bodyTop + (b - bodyTop) * 0.56f, (b - bodyTop) * 0.22f, p)
    }

    /** 相册：圆角矩形 + 小太阳 + 折线山 */
    private fun drawGallery(c: Canvas, l: Float, t: Float, r: Float, b: Float, radius: Float) {
        c.drawRoundRect(RectF(l, t, r, b), radius, radius, p)
        c.drawCircle(l + (r - l) * 0.28f, t + (b - t) * 0.30f, (b - t) * 0.07f, p)
        val path = Path().apply {
            moveTo(l + (r - l) * 0.10f, b - (b - t) * 0.16f)
            lineTo(l + (r - l) * 0.42f, t + (b - t) * 0.52f)
            lineTo(l + (r - l) * 0.60f, t + (b - t) * 0.72f)
            lineTo(r - (r - l) * 0.08f, t + (b - t) * 0.42f)
        }
        c.drawPath(path, p)
    }

    /** 上传：向上的箭头 + 托盘横线 */
    private fun drawUpload(c: Canvas, w: Float, l: Float, t: Float, r: Float, b: Float) {
        val cx = w / 2f
        val topY = t
        val bottomY = b
        c.drawLine(cx, bottomY - (bottomY - topY) * 0.22f, cx, topY, p)
        // 箭头两撇
        val head = (b - t) * 0.30f
        c.drawLine(cx, topY, cx - head * 0.72f, topY + head * 0.72f, p)
        c.drawLine(cx, topY, cx + head * 0.72f, topY + head * 0.72f, p)
        // 托盘
        c.drawLine(l, bottomY, r, bottomY, p)
    }
}
