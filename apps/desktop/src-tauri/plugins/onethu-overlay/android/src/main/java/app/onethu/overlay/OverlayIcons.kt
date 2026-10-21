// OneTHU 悬浮层：**与本体同一套线描图标**（用户：「外部悬浮窗上传按钮这几个图标明显没有电脑好看」）。
//
// 做法：直接把 `apps/desktop/src/components/Icons.tsx` 里的 SVG path 原文搬过来，用 androidx 的
// `PathParser` 解析成 Canvas 路径 —— 24 单位 viewBox、`strokeWidth=1.6`、round cap/join，
// 与本体逐字节同一套几何，两端一眼是同一套图标。
//
// 视觉尺寸 20dp（可点区域 40dp）；发声态用「喇叭本体填充」表达（不靠任何 focus/selected 背景）。

package app.onethu.overlay

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import androidx.core.graphics.PathParser
import android.view.View
import kotlin.math.min

class LineIcon(context: Context, private val kind: String) : View(context) {

    /** 主色（深浅跟随） */
    var color: Int = 0xFF1C1F24.toInt()

    /** 发声态：喇叭本体填充（图标状态只靠这个 + 声波有无表达） */
    var filled: Boolean = false
        set(value) {
            if (field == value) return
            field = value
            invalidate()
        }

    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        // 24 单位 viewBox 下的 1.6（与本体 SVG 完全一致），随画布缩放
        strokeWidth = 1.6f
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }
    private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }

    private val paths: List<Path> by lazy { SPECS[kind].orEmpty().mapNotNull { PathParser.createPathFromPathData(it) } }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (paths.isEmpty()) return
        stroke.color = color
        fillPaint.color = color
        // 20dp 视觉尺寸居中放进可点区域；24 单位 → 20dp 的缩放
        val box = OverlayViews.dp(context, VISUAL_DP).toFloat()
        val s = box / 24f
        val dx = (width - box) / 2f
        val dy = (height - box) / 2f
        val save = canvas.save()
        canvas.translate(dx, dy)
        canvas.scale(s, s)
        paths.forEachIndexed { idx, p ->
            val isSpeakerBody = kind == "speak" || kind == "speakOff"
            if (filled && isSpeakerBody && idx == 0) {
                canvas.drawPath(p, fillPaint)
            } else {
                canvas.drawPath(p, stroke)
            }
        }
        canvas.restoreToCount(save)
    }

    companion object {
        const val VISUAL_DP = 20

        /** 与 components/Icons.tsx 逐字节一致的 path 原文（24 viewBox / stroke 1.6 / round） */
        private val SPECS: Map<String, List<String>> = mapOf(
            // IconCamera
            "camera" to listOf(
                "M4 8.5A1.5 1.5 0 0 1 5.5 7h1.2a1.5 1.5 0 0 0 1.28-.72l.54-.9A1.5 1.5 0 0 1 9.8 4.6h4.4a1.5 1.5 0 0 1 1.28.72l.54.9A1.5 1.5 0 0 0 17.3 7h1.2A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5z",
                "M12 16a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z",
            ),
            // IconImage
            "gallery" to listOf(
                "M3.5 6.3A1.8 1.8 0 0 1 5.3 4.5h13.4a1.8 1.8 0 0 1 1.8 1.8v11.4a1.8 1.8 0 0 1-1.8 1.8H5.3a1.8 1.8 0 0 1-1.8-1.8z",
                "M9 11.6a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2z",
                "M4.5 18l5-5 3.2 3.2 2.6-2.6 4.2 4.4",
            ),
            // IconUpload
            "upload" to listOf(
                "M12 16V5",
                "M7 10l5-5 5 5",
                "M5 19h14",
            ),
            // IconSpeak（喇叭 + 两道声波）
            "speak" to listOf(
                "M11.4 5.2 6.9 8.6H4.3a1 1 0 0 0-1 1v4.8a1 1 0 0 0 1 1h2.6l4.5 3.4z",
                "M15.2 9.4a4.2 4.2 0 0 1 0 5.2",
                "M18.1 6.8a8.2 8.2 0 0 1 0 10.4",
            ),
            // IconSpeakOff（同一副喇叭，无横杠；静音态只表达「不发声」）
            "speakOff" to listOf(
                "M11.4 5.2 6.9 8.6H4.3a1 1 0 0 0-1 1v4.8a1 1 0 0 0 1 1h2.6l4.5 3.4z",
            ),
        )

        fun minSide(a: Int, b: Int): Int = min(a, b)
    }
}
