// OneTHU 悬浮层：够用就好的 markdown 渲染（不引第三方依赖）。
//
// 覆盖范围（与本体 react-markdown + remarkGfm 的实际使用面对齐，用户点名这些）：
//   行内：**粗** / *斜* / `code` / [文本](url)
//   块级：```代码块```、- 列表、1. 有序列表、> 引用、--- 分隔线、# 标题、普通段落
//
// 输出是**一组 View**（每个块一个），由 OverlayWindows 塞进消息列表——
// 这样块级样式（代码块底色、引用左边线、分隔线）用 View 表达最稳，
// 行内样式用 Spannable 表达最稳。
//
// 视觉遵守本套语言：无气泡、主色文字、15sp、行高 1.62；代码/引用只做极轻的底与线。

package app.onethu.overlay

import android.content.Context
import android.graphics.Typeface
import android.text.Spannable
import android.text.SpannableStringBuilder
import android.text.TextPaint
import android.text.method.LinkMovementMethod
import android.text.style.BackgroundColorSpan
import android.text.style.ClickableSpan
import android.text.style.ForegroundColorSpan
import android.text.style.StyleSpan
import android.text.style.TypefaceSpan
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView

object OverlayMd {

    /** 分隔线的标记：渲染方据此给 MATCH_PARENT 宽度（WRAP_CONTENT 会变成 0 宽） */
    const val TAG_DIVIDER = "onethu-md-divider"

    /** 把一段 markdown 渲染成若干块 View；onLink 处理链接点击（可为 null = 不可点） */
    fun render(
        ctx: Context,
        src: String,
        dark: Boolean,
        onLink: ((String) -> Unit)?,
    ): List<View> {
        val out = ArrayList<View>()
        val lines = src.replace("\r\n", "\n").split("\n")
        var i = 0
        while (i < lines.size) {
            val raw = lines[i]
            val line = raw.trimEnd()

            // ``` 代码块（直到闭合围栏或结尾）
            if (line.trimStart().startsWith("```")) {
                val buf = StringBuilder()
                i++
                while (i < lines.size && !lines[i].trimStart().startsWith("```")) {
                    buf.append(lines[i]).append('\n')
                    i++
                }
                if (i < lines.size) i++ // 吃掉闭合围栏
                out.add(codeBlock(ctx, buf.toString().trimEnd('\n'), dark))
                continue
            }

            // --- 分隔线（也认 *** / ___）
            val t = line.trim()
            if (t == "---" || t == "***" || t == "___") {
                out.add(divider(ctx, dark))
                i++
                continue
            }

            // > 引用（连续多行合成一块）
            if (t.startsWith(">")) {
                val buf = StringBuilder()
                while (i < lines.size && lines[i].trim().startsWith(">")) {
                    if (buf.isNotEmpty()) buf.append('\n')
                    buf.append(lines[i].trim().removePrefix(">").trim())
                    i++
                }
                out.add(quote(ctx, buf.toString(), dark, onLink))
                continue
            }

            // # 标题
            if (t.startsWith("#")) {
                val level = t.takeWhile { it == '#' }.length.coerceIn(1, 3)
                val text = t.drop(level).trim()
                out.add(heading(ctx, text, level, dark, onLink))
                i++
                continue
            }

            // 列表：- / * / 1. （连续项合成一块，逐项一个 TextView）
            if (isBullet(t) || isOrdered(t)) {
                val listView = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
                var idx = 0
                while (i < lines.size && (isBullet(lines[i].trim()) || isOrdered(lines[i].trim()))) {
                    val item = lines[i].trim()
                    val text = when {
                        isOrdered(item) -> {
                            idx++
                            item.substringAfter('.').trim()
                        }
                        else -> item.substring(1).trim()
                    }
                    val tv = base(ctx, dark).apply {
                        this.text = if (isOrdered(item)) "$idx. " else "• "
                        append(inline(ctx, text, dark, onLink))
                    }
                    val lp = LinearLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.WRAP_CONTENT,
                    )
                    lp.bottomMargin = OverlayViews.dp(ctx, 4)
                    listView.addView(tv, lp)
                    i++
                }
                out.add(listView)
                continue
            }

            // 空行：跳
            if (t.isEmpty()) {
                i++
                continue
            }

            // 普通段落（连续非空行合成一段，段内保留换行）
            val buf = StringBuilder()
            while (i < lines.size) {
                val l = lines[i]
                val lt = l.trim()
                if (lt.isEmpty() || lt.startsWith("```") || lt.startsWith(">") ||
                    isBullet(lt) || isOrdered(lt) || lt == "---" || lt == "***" || lt == "___" ||
                    lt.startsWith("#")
                ) {
                    break
                }
                if (buf.isNotEmpty()) buf.append('\n')
                buf.append(lt)
                i++
            }
            out.add(paragraph(ctx, buf.toString(), dark, onLink))
        }
        // 全空：给一个占位，免得消息区看起来丢了内容
        if (out.isEmpty()) {
            out.add(base(ctx, dark).apply { text = src })
        }
        return out
    }

    /* ───────────────────────── 行内解析 ───────────────────────── */

    /** 行内样式：**粗** / *斜* / `code` / [文本](url)。未闭合就当普通字符，绝不吞内容。 */
    fun inline(ctx: Context, src: String, dark: Boolean, onLink: ((String) -> Unit)?): CharSequence {
        val sb = SpannableStringBuilder()
        var i = 0
        while (i < src.length) {
            val bold = src.indexOf("**", i)
            val ital = indexOfItalic(src, i)
            val code = src.indexOf('`', i)
            val link = src.indexOf('[', i)
            var next = -1
            var kind = ""
            if (bold >= 0 && (next < 0 || bold < next)) { next = bold; kind = "b" }
            if (ital >= 0 && (next < 0 || ital < next)) { next = ital; kind = "i" }
            if (code >= 0 && (next < 0 || code < next)) { next = code; kind = "c" }
            if (link >= 0 && (next < 0 || link < next)) { next = link; kind = "l" }
            if (next < 0) {
                sb.append(src, i, src.length)
                break
            }
            if (next > i) sb.append(src, i, next)
            when (kind) {
                "b" -> {
                    val end = src.indexOf("**", next + 2)
                    if (end < 0) { sb.append(src, next, next + 2); i = next + 2; continue }
                    val start = sb.length
                    sb.append(src, next + 2, end)
                    sb.setSpan(StyleSpan(Typeface.BOLD), start, sb.length, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
                    i = end + 2
                }
                "i" -> {
                    val start = sb.length
                    sb.append(src, next + 1, next + 1 + (italEnd(src, next) - next - 1))
                    sb.setSpan(StyleSpan(Typeface.ITALIC), start, sb.length, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
                    i = italEnd(src, next)
                }
                "c" -> {
                    val end = src.indexOf('`', next + 1)
                    if (end < 0) { sb.append(src, next, next + 1); i = next + 1; continue }
                    val start = sb.length
                    sb.append(src, next + 1, end)
                    sb.setSpan(TypefaceSpan("monospace"), start, sb.length, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
                    sb.setSpan(
                        BackgroundColorSpan(if (dark) 0x33FFFFFF else 0x14000000),
                        start, sb.length, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE,
                    )
                    i = end + 1
                }
                else -> {
                    val close = src.indexOf(']', next + 1)
                    val paren = if (close > 0 && close + 1 < src.length && src[close + 1] == '(') {
                        src.indexOf(')', close + 2)
                    } else {
                        -1
                    }
                    if (close < 0 || paren < 0) {
                        sb.append(src, next, next + 1)
                        i = next + 1
                        continue
                    }
                    val label = src.substring(next + 1, close)
                    val url = src.substring(close + 2, paren)
                    val start = sb.length
                    sb.append(label)
                    val end = sb.length
                    sb.setSpan(StyleSpan(Typeface.BOLD), start, end, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
                    if (onLink != null) {
                        sb.setSpan(
                            object : ClickableSpan() {
                                override fun onClick(w: View) = onLink(url)
                                override fun updateDrawState(ds: TextPaint) {
                                    ds.isUnderlineText = true
                                    ds.color = OverlayViews.ink(dark)
                                }
                            },
                            start, end, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE,
                        )
                    } else {
                        sb.setSpan(ForegroundColorSpan(OverlayViews.ink(dark)), start, end, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
                    }
                    i = paren + 1
                }
            }
        }
        return sb
    }

    private fun italEnd(src: String, at: Int): Int {
        // 单星号斜体：找下一个不被 ** 占用的单星号
        var j = at + 1
        while (j < src.length) {
            if (src[j] == '*' && (j + 1 >= src.length || src[j + 1] != '*')) return j
            j++
        }
        return -1
    }

    private fun indexOfItalic(src: String, from: Int): Int {
        var j = from
        while (j < src.length) {
            if (src[j] == '*') {
                val single = (j + 1 >= src.length || src[j + 1] != '*') &&
                    (j == 0 || src[j - 1] != '*')
                // 单星号且右边能找到收尾
                if (single && italEnd(src, j) > j) return j
            }
            j++
        }
        return -1
    }

    private fun isBullet(t: String) = (t.startsWith("- ") || t.startsWith("* "))

    private fun isOrdered(t: String): Boolean {
        val m = Regex("^\\d{1,3}\\.\\s").find(t) ?: return false
        return m.range.first == 0
    }

    /* ───────────────────────── 块级 View ───────────────────────── */

    private fun base(ctx: Context, dark: Boolean): TextView = TextView(ctx).apply {
        textSize = OverlayViews.MSG_SP
        setLineSpacing(0f, OverlayViews.LINE_MULT)
        setTextColor(OverlayViews.ink(dark))
        includeFontPadding = true
        isClickable = false
        isFocusable = false
        // 注意：LinkMovementMethod **不能**默认挂上——它会吃掉触摸事件，破坏面板滚动；
        // 只有真的含链接的块才在下面按需挂（见 withLinks）。
        // 雾淡处压在壁纸上也要读得清
        OverlayViews.shadow(this)
    }

    private fun paragraph(ctx: Context, text: String, dark: Boolean, onLink: ((String) -> Unit)?): TextView =
        base(ctx, dark).apply {
            this.text = inline(ctx, text, dark, onLink)
            withLinks(text, onLink)
        }

    /** 含链接的块才挂 LinkMovementMethod（否则会抢走滚动用的触摸） */
    private fun TextView.withLinks(raw: String, onLink: ((String) -> Unit)?) {
        if (onLink != null && raw.contains("](")) {
            movementMethod = LinkMovementMethod.getInstance()
        }
    }

    private fun heading(ctx: Context, text: String, level: Int, dark: Boolean, onLink: ((String) -> Unit)?): TextView =
        base(ctx, dark).apply {
            textSize = when (level) {
                1 -> 18f
                2 -> 16.5f
                else -> 15.5f
            }
            typeface = OverlayViews.brandTypeface()
            this.text = inline(ctx, text, dark, onLink)
            withLinks(text, onLink)
        }

    private fun quote(ctx: Context, text: String, dark: Boolean, onLink: ((String) -> Unit)?): View {
        val row = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL }
        val bar = View(ctx).apply {
            setBackgroundColor(OverlayViews.withAlpha(OverlayViews.ink(dark), 70))
        }
        row.addView(bar, LinearLayout.LayoutParams(OverlayViews.dp(ctx, 3), ViewGroup.LayoutParams.MATCH_PARENT))
        val tv = base(ctx, dark).apply {
            alpha = 0.92f
            this.text = inline(ctx, text, dark, onLink)
            withLinks(text, onLink)
        }
        val lp = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        lp.marginStart = OverlayViews.dp(ctx, 10)
        row.addView(tv, lp)
        return row
    }

    private fun codeBlock(ctx: Context, code: String, dark: Boolean): View {
        val tv = base(ctx, dark).apply {
            typeface = Typeface.MONOSPACE
            textSize = 13.5f
            setLineSpacing(0f, 1.35f)
            this.text = code
            setPadding(
                OverlayViews.dp(ctx, 10), OverlayViews.dp(ctx, 8),
                OverlayViews.dp(ctx, 10), OverlayViews.dp(ctx, 8),
            )
            setBackgroundColor(if (dark) 0x2EFFFFFF else 0x12000000)
        }
        return tv
    }

    private fun divider(ctx: Context, dark: Boolean): View =
        View(ctx).apply {
            setBackgroundColor(OverlayViews.withAlpha(OverlayViews.ink(dark), 64))
            tag = TAG_DIVIDER
        }.also {
            it.layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                OverlayViews.dp(ctx, 1),
            ).apply { topMargin = OverlayViews.dp(ctx, 6); bottomMargin = OverlayViews.dp(ctx, 6) }
        }

    /** 三个点的「进行中」指示（复用电平波纹的样子，匀速跳） */
    fun progress(ctx: Context, text: String, dark: Boolean): View {
        val row = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val wave = WaveDots(ctx).apply {
            dotColor = OverlayViews.ink(dark)
            amplitude = 0.25f
            animating = true
        }
        row.addView(wave, LinearLayout.LayoutParams(OverlayViews.dp(ctx, 40), OverlayViews.dp(ctx, 18)))
        val tv = base(ctx, dark).apply {
            alpha = 0.95f
            this.text = text
        }
        val lp = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        lp.marginStart = OverlayViews.dp(ctx, 10)
        row.addView(tv, lp)
        return row
    }
}
