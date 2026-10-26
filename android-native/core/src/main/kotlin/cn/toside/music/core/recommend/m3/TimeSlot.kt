package cn.toside.music.core.recommend.m3

import cn.toside.music.core.recommend.radio.PlayEndReason
import cn.toside.music.core.recommend.radio.RadioPlayRecord
import java.time.Instant
import java.time.ZoneId
import kotlin.math.max
import kotlin.math.min

/** 一天四段。边界由 [TimeSlotConfig] 给，写死会在换配置时静默错位。 */
enum class TimeSlot { MORNING, AFTERNOON, EVENING, NIGHT }

data class TimeSlotConfig(
    val morningStart: Int = 5,
    val afternoonStart: Int = 11,
    val eveningStart: Int = 17,
    val positiveMinCoverage: Double = 0.8,
    val negativeMaxCoverage: Double = 0.3,
    val minSamples: Int = 4,
    val factorCeiling: Double = 1.12,
    val factorFloor: Double = 0.9,
)

/**
 * 时段画像（轻量版）—— RN `core/recommend/timeSlot.ts` 的移植。
 *
 * 从播放历史（`radioHistory` 自带 `artistKeys` 与结算信息）实时聚合「当前时段」的
 * 歌手正负信号，给候选歌手一个温和的时段加成因子。不新增持久化状态——播放历史本身就是存储；
 * 旧记录无 artistKeys 自动跳过，随新播放逐步积累。样本不足时全部返回 1（不干预）。
 *
 * 【注入】时钟一律 `now: () -> Long`，本文件不出现 `System.currentTimeMillis()`；
 * 时区显式 `ZoneId` 注入，默认取系统时区。两者都可测——RN 用 `new Date(now).getHours()`
 * 隐式读本地时区，在单测里不可控。
 */
object TimeSlotProfile {
    private val NEUTRAL_REASONS = setOf(PlayEndReason.NATURAL_END, PlayEndReason.USER_NEXT, PlayEndReason.USER_SELECT_OTHER)

    fun slotOf(
        atMillis: Long,
        zone: ZoneId = ZoneId.systemDefault(),
        config: TimeSlotConfig = TimeSlotConfig(),
    ): TimeSlot {
        val hour = Instant.ofEpochMilli(atMillis).atZone(zone).hour
        return when {
            hour >= config.morningStart && hour < config.afternoonStart -> TimeSlot.MORNING
            hour >= config.afternoonStart && hour < config.eveningStart -> TimeSlot.AFTERNOON
            hour >= config.eveningStart && hour < 24 -> TimeSlot.EVENING
            else -> TimeSlot.NIGHT
        }
    }

    data class Affinity(
        val currentSlot: TimeSlot,
        /** 候选歌手在当前时段的历史听感因子，钳位 [factorFloor, factorCeiling]；无数据为 1。 */
        val factorFor: (List<String>) -> Double,
        val sampleSize: Int,
    )

    fun computeAffinity(
        radioHistory: List<RadioPlayRecord>,
        now: () -> Long,
        zone: ZoneId = ZoneId.systemDefault(),
        config: TimeSlotConfig = TimeSlotConfig(),
    ): Affinity {
        val currentSlot = slotOf(now(), zone, config)
        val positive = mutableMapOf<String, Int>()
        val negative = mutableMapOf<String, Int>()
        var sampleSize = 0
        for (record in radioHistory) {
            if (record.artistKeys.isEmpty()) continue
            val reason = record.endReason ?: continue
            if (reason !in NEUTRAL_REASONS) continue
            if (slotOf(record.startedAt, zone, config) != currentSlot) continue
            val isPositive = reason == PlayEndReason.NATURAL_END && record.coverage >= config.positiveMinCoverage
            val isNegative = reason == PlayEndReason.USER_NEXT && record.coverage < config.negativeMaxCoverage
            if (!isPositive && !isNegative) continue
            sampleSize += 1
            val map = if (isPositive) positive else negative
            for (artist in record.artistKeys) {
                if (artist.isEmpty()) continue
                map[artist] = (map[artist] ?: 0) + 1
            }
        }
        return Affinity(
            currentSlot = currentSlot,
            sampleSize = sampleSize,
            factorFor = { artistKeys ->
                if (sampleSize < config.minSamples || artistKeys.isEmpty()) {
                    1.0
                } else {
                    var pos = 0
                    var neg = 0
                    for (artist in artistKeys) {
                        pos = max(pos, positive[artist] ?: 0)
                        neg = max(neg, negative[artist] ?: 0)
                    }
                    if (pos + neg <= 0) {
                        1.0
                    } else {
                        // 温和：净倾向按总量归一后映射到 [floor, ceiling]
                        val net = (pos - neg).toDouble() / (pos + neg).toDouble()
                        val factor = 1.0 + net * (if (net >= 0) config.factorCeiling - 1.0 else 1.0 - config.factorFloor)
                        max(config.factorFloor, min(config.factorCeiling, factor))
                    }
                }
            },
        )
    }
}
