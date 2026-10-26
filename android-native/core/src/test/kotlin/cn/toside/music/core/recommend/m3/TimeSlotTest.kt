package cn.toside.music.core.recommend.m3

import cn.toside.music.core.recommend.radio.PlayEndReason
import cn.toside.music.core.recommend.radio.RadioPlayRecord
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.LocalDateTime
import java.time.ZoneId

/**
 * 时段画像 —— 对照 RN `core/recommend/timeSlot.ts`。
 *
 * 时钟与时区都是注入的：RN 用 `new Date(now).getHours()` 隐式读本地时区，单测不可控；
 * 这里显式传 `ZoneId.of("Asia/Shanghai")`，CI 跑在任何时区都得到同一结果。
 */
class TimeSlotTest {
    private val zone = ZoneId.of("Asia/Shanghai")

    private fun at(
        hour: Int,
        minute: Int = 0,
    ): Long {
        val local = LocalDateTime.of(2026, 3, 18, hour, minute)
        val instant = local.atZone(zone).toInstant()
        return instant.toEpochMilli()
    }

    private fun record(
        id: String,
        hour: Int,
        artists: List<String>,
        coverage: Double,
        reason: PlayEndReason,
    ) = RadioPlayRecord(
        playId = id,
        trackKey = "track:$id",
        startedAt = at(hour),
        artistKeys = artists,
        coverage = coverage,
        endReason = reason,
    )

    @Test
    fun `四段边界`() {
        assertEquals(TimeSlot.NIGHT, TimeSlotProfile.slotOf(at(4), zone))
        assertEquals(TimeSlot.MORNING, TimeSlotProfile.slotOf(at(5), zone))
        assertEquals(TimeSlot.MORNING, TimeSlotProfile.slotOf(at(10, 59), zone))
        assertEquals(TimeSlot.AFTERNOON, TimeSlotProfile.slotOf(at(11), zone))
        assertEquals(TimeSlot.AFTERNOON, TimeSlotProfile.slotOf(at(16, 59), zone))
        assertEquals(TimeSlot.EVENING, TimeSlotProfile.slotOf(at(17), zone))
        assertEquals(TimeSlot.EVENING, TimeSlotProfile.slotOf(at(23, 59), zone))
        assertEquals(TimeSlot.NIGHT, TimeSlotProfile.slotOf(at(0), zone))
    }

    @Test
    fun `样本不足时因子恒为 1`() {
        val history =
            listOf(
                record("a", 8, listOf("周杰伦"), 0.95, PlayEndReason.NATURAL_END),
                record("b", 9, listOf("周杰伦"), 0.95, PlayEndReason.NATURAL_END),
                record("c", 10, listOf("周杰伦"), 0.95, PlayEndReason.NATURAL_END),
            )
        val affinity = TimeSlotProfile.computeAffinity(history, now = { at(9) }, zone = zone)
        assertEquals(TimeSlot.MORNING, affinity.currentSlot)
        assertEquals(3, affinity.sampleSize)
        assertEquals(1.0, affinity.factorFor(listOf("周杰伦")), 1e-9)
    }

    @Test
    fun `完播多则时段加成 早切多则时段降权`() {
        val positive =
            listOf(
                record("a", 8, listOf("甲"), 0.95, PlayEndReason.NATURAL_END),
                record("b", 8, listOf("甲"), 0.95, PlayEndReason.NATURAL_END),
                record("c", 9, listOf("甲"), 0.95, PlayEndReason.NATURAL_END),
                record("d", 9, listOf("甲"), 0.95, PlayEndReason.NATURAL_END),
            )
        val up = TimeSlotProfile.computeAffinity(positive, now = { at(9) }, zone = zone)
        assertEquals(4, up.sampleSize)
        // 净倾向 +1 → 1 + 1 × (1.12 - 1) = 1.12
        assertEquals(1.12, up.factorFor(listOf("甲")), 1e-9)

        val negative =
            listOf(
                record("a", 8, listOf("乙"), 0.05, PlayEndReason.USER_NEXT),
                record("b", 8, listOf("乙"), 0.05, PlayEndReason.USER_NEXT),
                record("c", 9, listOf("乙"), 0.05, PlayEndReason.USER_NEXT),
                record("d", 9, listOf("乙"), 0.05, PlayEndReason.USER_NEXT),
            )
        val down = TimeSlotProfile.computeAffinity(negative, now = { at(9) }, zone = zone)
        // 净倾向 -1 → 1 - 1 × (1 - 0.9) = 0.9
        assertEquals(0.9, down.factorFor(listOf("乙")), 1e-9)
    }

    @Test
    fun `只统计当前时段 且只认完播与早切`() {
        val history =
            listOf(
                record("a", 8, listOf("甲"), 0.95, PlayEndReason.NATURAL_END),
                record("b", 8, listOf("甲"), 0.95, PlayEndReason.NATURAL_END),
                // 别的时段：不计入当前时段的样本
                record("c", 14, listOf("甲"), 0.95, PlayEndReason.NATURAL_END),
                record("d", 15, listOf("甲"), 0.95, PlayEndReason.NATURAL_END),
                // 中性结束原因：不计入
                record("e", 8, listOf("甲"), 0.95, PlayEndReason.USER_SELECT_OTHER),
                record("f", 8, listOf("甲"), 0.95, PlayEndReason.RADIO_SWITCH),
                // 覆盖不够的完播：不计入正样本
                record("g", 8, listOf("甲"), 0.5, PlayEndReason.NATURAL_END),
            )
        val affinity = TimeSlotProfile.computeAffinity(history, now = { at(9) }, zone = zone)
        assertEquals(2, affinity.sampleSize)
        // 样本不足 4，因子恒 1
        assertEquals(1.0, affinity.factorFor(listOf("甲")), 1e-9)
    }

    @Test
    fun `无歌手键的记录直接跳过`() {
        val history =
            listOf(
                record("a", 8, emptyList(), 0.95, PlayEndReason.NATURAL_END),
                record("b", 8, emptyList(), 0.95, PlayEndReason.NATURAL_END),
                record("c", 8, emptyList(), 0.95, PlayEndReason.NATURAL_END),
                record("d", 8, emptyList(), 0.95, PlayEndReason.NATURAL_END),
            )
        val affinity = TimeSlotProfile.computeAffinity(history, now = { at(9) }, zone = zone)
        assertEquals(0, affinity.sampleSize)
        assertEquals(1.0, affinity.factorFor(listOf("甲")), 1e-9)
    }
}
