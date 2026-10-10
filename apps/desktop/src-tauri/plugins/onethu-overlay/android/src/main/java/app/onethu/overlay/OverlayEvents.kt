// OneTHU 悬浮层：手势事件队列（at-least-once 投递）。
//
// 投递路径两条并行，谁先到算谁的：
//   1) 立即推：OverlayBridge.evalJs → window.__onethuOverlayEvent（低延迟；
//      不受后台 WebView 定时器限流影响，因为它是直接求值而不是定时器）；
//   2) 兜底拉：前端每 1.5s 调 overlay_poll_event(since) 取 id > since 的事件。
// 前端处理完一批后调 overlay_ack_events(id) 清队列。
//
// TTL：超过 6s 的未确认事件一律丢弃——回到前台时不重放「几分钟前的手势」，
// 否则会出现「切回应用就自动弹出面板 / 语音条」的怪异行为。
object OverlayEvents {
    private const val TTL_MS = 6_000L
    private const val MAX_KEEP = 64

    private class Ev(
        val id: Long,
        val type: String,
        val x: Int,
        val y: Int,
        val at: Long,
        val text: String?,
        val extra: org.json.JSONObject?,
    ) {
        fun toJson(): org.json.JSONObject = org.json.JSONObject().apply {
            put("id", id)
            put("type", type)
            put("x", x)
            put("y", y)
            if (text != null) put("text", text)
            // extra 的字段直接摊平进事件体（如 attach 事件的 path/name/mime/size）
            if (extra != null) {
                val it = extra.keys()
                while (it.hasNext()) {
                    val k = it.next()
                    put(k, extra.get(k))
                }
            }
        }
    }

    private val lock = Any()
    private val queue = mutableListOf<Ev>()
    private var nextId = 1L

    /** 入队并立即推一次（type: tap | drag | closed | submit | attachRequest | attach） */
    fun emit(type: String, x: Int = 0, y: Int = 0, text: String? = null, extra: org.json.JSONObject? = null) {
        val ev: Ev
        synchronized(lock) {
            ev = Ev(nextId++, type, x, y, System.currentTimeMillis(), text, extra)
            queue.add(ev)
            while (queue.size > MAX_KEEP) queue.removeAt(0)
        }
        // 同步给个 id 让前端能 ack：把事件对象整体交给 JS 回调
        OverlayBridge.evalJs("window.__onethuOverlayEvent && window.__onethuOverlayEvent(${ev.toJson()});")
    }

    /** id > since 且未过期的待投递事件（轮询兜底） */
    fun pendingSince(since: Long): org.json.JSONArray {
        val now = System.currentTimeMillis()
        val arr = org.json.JSONArray()
        synchronized(lock) {
            queue.removeAll { now - it.at > TTL_MS }
            for (e in queue) {
                if (e.id > since) arr.put(e.toJson())
            }
        }
        return arr
    }

    /** 确认「id 及更早」都已处理（前端 ack 语义：单调不回退） */
    fun ack(id: Long) {
        synchronized(lock) {
            queue.removeAll { it.id <= id }
        }
    }

    fun clear() {
        synchronized(lock) {
            queue.clear()
        }
    }
}
