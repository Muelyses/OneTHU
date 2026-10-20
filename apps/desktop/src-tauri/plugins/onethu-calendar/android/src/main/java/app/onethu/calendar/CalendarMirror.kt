package app.onethu.calendar

/** Stage every replacement before removing the previous mirror. No Android I/O in this policy. */
internal fun <T> replaceCalendarMirror(
  events: List<T>,
  oldIds: List<Long>,
  insertBatch: (List<T>) -> List<Long>,
  deleteIds: (List<Long>) -> Int,
): Int {
  val inserted = ArrayList<Long>()
  try {
    // Each event has at most one reminder operation; 150 events <= 300 operations.
    for (batch in events.chunked(150)) {
      val ids = insertBatch(batch)
      inserted.addAll(ids)
      check(ids.size == batch.size) { "系统日历未完整返回新增事件标识" }
    }
  } catch (ex: Exception) {
    try {
      check(deleteIds(inserted) == inserted.size) { "部分新事件未清理" }
    } catch (cleanup: Exception) {
      throw IllegalStateException("写入失败且新事件清理未完成，请重试同步；原有事件尚未删除", cleanup)
    }
    throw ex
  }
  // If old cleanup fails, keep the complete new set. A retry can safely replace
  // both sets; deleting new events here would lose already removed old entries.
  val removed = deleteIds(oldIds)
  check(removed == oldIds.size) { "旧事件清理未完成，请重试同步" }
  return removed
}

/** CalendarProvider all-day dates must be UTC midnight for the campus calendar date. */
internal fun campusAllDayUtc(ms: Long): Long {
  val campus = java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("Asia/Shanghai")).apply { timeInMillis = ms }
  return java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("UTC")).apply {
    clear()
    set(campus.get(java.util.Calendar.YEAR), campus.get(java.util.Calendar.MONTH), campus.get(java.util.Calendar.DAY_OF_MONTH))
  }.timeInMillis
}
