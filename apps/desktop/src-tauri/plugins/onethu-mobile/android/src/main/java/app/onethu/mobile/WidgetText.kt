package app.onethu.mobile

import java.text.NumberFormat
import java.util.Locale

/** Templates come from the saved snapshot; legacy fallback is generated from desktop zh-CN. */
internal class WidgetText(
    localeTag: String,
    private val templates: Map<String, String>,
    private val legacy: Map<String, String>,
    private val category: (String, Long) -> String,
) {
    private val locale = localeTag.ifBlank { "zh-CN" }
    private val numbers = NumberFormat.getNumberInstance(Locale.forLanguageTag(locale)).apply { isGroupingUsed = false }
    private val slot = Regex("\\{([A-Za-z_][A-Za-z0-9_]*)\\}")

    fun text(key: String, values: Map<String, Any> = emptyMap()): String {
        val template = templates[key]?.takeIf { it.isNotEmpty() } ?: legacy[key] ?: key
        return slot.replace(template) { match ->
            val value = values[match.groupValues[1]]
            when (value) { null -> match.value; is Number -> numbers.format(value); else -> value.toString() }
        }
    }

    fun count(key: String, count: Long): String {
        val selected = "$key.${category(locale, count)}"
        val branch = if (templates[selected].isNullOrEmpty() && !templates["$key.other"].isNullOrEmpty()) "$key.other" else selected
        return text(branch, mapOf("count" to count))
    }

    fun left(ms: Long): String {
        val minutes = Math.max(1L, Math.round(ms / 60000.0))
        return when { minutes < 60 -> count("minutes", minutes); minutes < 2880 -> count("hours", Math.round(minutes / 60.0)); else -> count("days", Math.round(minutes / 1440.0)) }
    }

    fun join(parts: List<String>): String = parts.filter { it.isNotEmpty() }.joinToString(text("joiner"))
}
