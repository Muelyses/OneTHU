package app.onethu.calendar

import org.junit.Assert.*
import org.junit.Test

class CalendarMirrorTest {
  @Test fun stagesAllBatchesBeforeDeletingOldEvents() {
    val operations = ArrayList<String>()
    val count = replaceCalendarMirror((1..301).toList(), listOf(99L), { batch ->
      operations.add("insert:${batch.size}"); batch.map { it.toLong() + 1000 }
    }, { ids -> operations.add("delete:${ids.size}"); ids.size })
    assertEquals(listOf("insert:150", "insert:150", "insert:1", "delete:1"), operations)
    assertEquals(1, count)
  }
  @Test fun failedSecondBatchRemovesOnlyStagedNewEvents() {
    val deleted = ArrayList<List<Long>>()
    var calls = 0
    try {
      replaceCalendarMirror((1..151).toList(), listOf(9L), { batch ->
        calls++; if (calls == 2) error("provider failed")
        batch.map { it.toLong() + 1000 }
      }, { ids -> deleted.add(ids.toList()); ids.size })
      fail("must reject")
    } catch (e: IllegalStateException) { assertEquals("provider failed", e.message) }
    assertEquals(1, deleted.size)
    assertEquals(150, deleted[0].size)
    assertFalse(deleted[0].contains(9L))
  }
  @Test fun cleanupFailureIsReportedAndNeverDeletesOldMirror() {
    val deleted = ArrayList<List<Long>>()
    var calls = 0
    try {
      replaceCalendarMirror((1..151).toList(), listOf(9L), { batch ->
        calls++; if (calls == 2) error("provider failed")
        batch.map { it.toLong() + 1000 }
      }, { ids -> deleted.add(ids.toList()); 0 })
      fail("must reject")
    } catch (e: IllegalStateException) { assertTrue(e.message!!.contains("原有事件尚未删除")) }
    assertFalse(deleted.flatten().contains(9L))
  }
  @Test fun partialOldRemovalKeepsCompleteReplacementForRetry() {
    val deleted = ArrayList<List<Long>>()
    try {
      replaceCalendarMirror(listOf("a", "b"), listOf(1L, 2L), { listOf(101L, 102L) }, { ids -> deleted.add(ids.toList()); 1 })
      fail("must reject")
    } catch (e: IllegalStateException) { assertTrue(e.message!!.contains("旧事件清理未完成")) }
    assertEquals(listOf(listOf(1L, 2L)), deleted)
  }
  @Test fun emptyMirrorDeletesPreviousEventsWithoutInserting() {
    assertEquals(2, replaceCalendarMirror(emptyList<Unit>(), listOf(1L, 2L), { error("must not insert") }, { it.size }))
  }
  @Test fun allDayPreservesCampusDateAtUtcMidnight() {
    val formatter = java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss").apply { timeZone = java.util.TimeZone.getTimeZone("Asia/Shanghai") }
    val utc = java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss").apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }
    assertEquals("2026-10-20 00:00:00", utc.format(java.util.Date(campusAllDayUtc(formatter.parse("2026-10-20 00:00:00")!!.time))))
    assertEquals("2026-10-21 00:00:00", utc.format(java.util.Date(campusAllDayUtc(formatter.parse("2026-10-21 00:00:00")!!.time))))
  }
}
