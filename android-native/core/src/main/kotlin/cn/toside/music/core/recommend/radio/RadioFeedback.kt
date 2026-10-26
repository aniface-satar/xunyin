package cn.toside.music.core.recommend.radio

import cn.toside.music.core.recommend.ThemeFeedback
import cn.toside.music.core.recommend.ThemePreference
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

/**
 * 播放结算与显式反馈 —— RN `core/recommend/feedback.ts` 原样移植（M3 语种项除外）。
 *
 * 结算只产出增量（[SettlementResult]），状态写入由 [RadioBehavior] 负责。
 * 所有时间都由参数传入，测试可锁时钟。
 */
enum class ExplicitFeedbackType { LIKE, UNLIKE, DISLIKE, ADD_TO_PLAYLIST, REPEAT }

data class ExplicitFeedbackEvent(
    val trackKey: String,
    val type: ExplicitFeedbackType,
    val timestamp: Long,
    val playId: String? = null,
    val listId: String? = null,
    val sourcePlaylistId: String? = null,
    val channel: ChannelId? = null,
)

object RadioFeedback {
    private const val DAY_MS = 86_400_000.0
    private const val MIN_DECAY_INTERVAL_MS = 60_000L

    /** 合并重叠/相邻区间；区间先按 from 排序，重复收听只算一次。 */
    fun mergeIntervals(intervals: List<Interval>): List<Interval> {
        val sorted =
            intervals
                .map {
                    Interval(
                        from = max(0L, min(it.from, it.to)),
                        to = max(0L, max(it.from, it.to)),
                    )
                }.sortedBy { it.from }
        val result = mutableListOf<Interval>()
        for (interval in sorted) {
            val last = result.lastOrNull()
            if (last == null || interval.from > last.to) {
                result.add(interval)
            } else {
                result[result.lastIndex] = last.copy(to = max(last.to, interval.to))
            }
        }
        return result
    }

    fun intervalsDuration(intervals: List<Interval>): Long = mergeIntervals(intervals).sumOf { max(0L, it.to - it.from) }

    /**
     * 有效覆盖率：拖动/跳过区间不计入，反复播放同一区间只算一次。
     * 熄屏/后台定时器被暂停时，自然播完且未拖到结尾按可靠状态视为完整覆盖。
     */
    fun computeEffectiveCoverage(record: RadioPlayRecord): Double {
        val duration = record.durationMs ?: 0L
        val unionListened = intervalsDuration(record.intervals)
        if (duration > 0) {
            val unionCoverage = max(0.0, min(1.0, unionListened.toDouble() / duration))
            if (record.endReason == PlayEndReason.NATURAL_END && !record.seekedToEnd && unionCoverage < 0.8) {
                return max(unionCoverage, 1.0)
            }
            return unionCoverage
        }
        return if (record.listenedMs > 0) {
            min(1.0, record.listenedMs.toDouble() / max(1L, record.listenedMs + 30_000))
        } else {
            0.0
        }
    }

    fun isLowConfidenceDuration(record: RadioPlayRecord): Boolean {
        val duration = record.durationMs ?: 0L
        return duration <= 0 ||
            duration < RadioConfig.PlaylistFeedback.FULL_SONG_MIN_SECONDS * 1000
    }

    /** 隐式播放结束结算；同一 playId 只结算一次（幂等由调用方查 ledger）。 */
    fun settlePlayRecord(
        record: RadioPlayRecord,
        now: Long,
    ): SettlementResult {
        val cfg = RadioConfig.PlaylistFeedback
        val reasons = mutableListOf<String>()
        var ledger =
            LedgerEntry(
                timestamp = record.endedAt ?: now,
                trackReward = 0.0,
                playlistPositive = 0.0,
                playlistNegative = 0.0,
                implicitSettled = true,
            )
        var track: TrackEffect? = null
        var playlist: PlaylistEffect? = null
        val lowConfidence = isLowConfidenceDuration(record)
        val coverage = computeEffectiveCoverage(record)
        val endReason = record.endReason ?: PlayEndReason.UNKNOWN
        val listenedMs = record.listenedMs
        val playlistId = record.sourcePlaylistId

        fun done(): SettlementResult = SettlementResult(ledger, track, playlist, null, reasons)

        if (endReason == PlayEndReason.DISLIKE ||
            endReason == PlayEndReason.PLAY_ERROR ||
            endReason == PlayEndReason.LOAD_ERROR ||
            endReason == PlayEndReason.APP_DESTROY
        ) {
            reasons.add("neutral_end:${endReason.rnName()}")
            return done()
        }

        val isManualNegative =
            endReason == PlayEndReason.USER_NEXT ||
                endReason == PlayEndReason.USER_SELECT_OTHER ||
                endReason == PlayEndReason.RADIO_SWITCH
        if (isManualNegative) {
            if (lowConfidence) {
                reasons.add("skip_low_confidence_duration")
                return done()
            }
            // 秒切：听不足 10 秒、或进度不到 15% 就切走
            if (listenedMs < cfg.EARLY_SKIP_MAX_SECONDS * 1000 || coverage < cfg.EARLY_SKIP_MAX_COVERAGE) {
                ledger =
                    ledger.copy(
                        trackReward = -abs(RadioConfig.Behavior.EARLY_SKIP),
                        playlistNegative = cfg.EARLY_SKIP,
                        earlySkip = true,
                    )
                track =
                    TrackEffect(
                        key = record.trackKey,
                        scoreDelta = ledger.trackReward,
                        earlySkipCountDelta = 1,
                    )
                if (playlistId != null) {
                    playlist =
                        PlaylistEffect(
                            id = playlistId,
                            positiveDelta = 0.0,
                            negativeDelta = cfg.EARLY_SKIP,
                            negativeTrackKey = record.trackKey,
                            instantSkip = true,
                        )
                }
                reasons.add("early_skip")
                return done()
            }
            if (coverage < cfg.LOW_INTEREST_MAX_COVERAGE) {
                ledger = ledger.copy(playlistNegative = cfg.LOW_INTEREST)
                if (playlistId != null) {
                    playlist =
                        PlaylistEffect(
                            id = playlistId,
                            positiveDelta = 0.0,
                            negativeDelta = cfg.LOW_INTEREST,
                            negativeTrackKey = record.trackKey,
                        )
                }
                reasons.add("low_interest_skip")
                return done()
            }
            if (coverage < cfg.SLIGHT_INTEREST_MIN_COVERAGE) {
                reasons.add("partial_skip_neutral")
                return done()
            }
            if (coverage >= cfg.COVERAGE_COMPLETE_THRESHOLD) {
                ledger =
                    ledger.copy(
                        trackReward = RadioConfig.Behavior.COMPLETE,
                        playlistPositive = cfg.LISTEN_OVER_80,
                        completion = true,
                    )
                track =
                    TrackEffect(
                        key = record.trackKey,
                        scoreDelta = ledger.trackReward,
                        completeCountDelta = 1,
                        averageListenRatio = coverage,
                    )
                if (playlistId != null) {
                    playlist =
                        PlaylistEffect(
                            id = playlistId,
                            positiveDelta = cfg.LISTEN_OVER_80,
                            negativeDelta = 0.0,
                        )
                }
                reasons.add("listen_over_80")
                return done()
            }
            ledger = ledger.copy(playlistPositive = cfg.SLIGHT_INTEREST)
            if (playlistId != null) {
                playlist =
                    PlaylistEffect(
                        id = playlistId,
                        positiveDelta = cfg.SLIGHT_INTEREST,
                        negativeDelta = 0.0,
                    )
            }
            reasons.add("partial_interest")
            return done()
        }

        if (endReason == PlayEndReason.NATURAL_END) {
            if (lowConfidence) {
                reasons.add("complete_low_confidence_neutral")
                return done()
            }
            if (coverage >= cfg.COVERAGE_COMPLETE_THRESHOLD && !record.seekedToEnd) {
                ledger =
                    ledger.copy(
                        trackReward = RadioConfig.Behavior.COMPLETE,
                        playlistPositive = cfg.LISTEN_OVER_80,
                        completion = true,
                    )
                track =
                    TrackEffect(
                        key = record.trackKey,
                        scoreDelta = ledger.trackReward,
                        completeCountDelta = 1,
                        averageListenRatio = coverage,
                    )
                if (playlistId != null) {
                    playlist =
                        PlaylistEffect(
                            id = playlistId,
                            positiveDelta = cfg.LISTEN_OVER_80,
                            negativeDelta = 0.0,
                        )
                }
                reasons.add("complete")
                return done()
            }
            reasons.add(if (record.seekedToEnd) "seek_to_end_not_complete" else "complete_low_coverage_neutral")
            return done()
        }

        reasons.add("neutral_end:${endReason.rnName()}")
        return done()
    }

    fun createPlaylistPreference(
        playlistId: String,
        now: Long,
    ): PlaylistPreference =
        PlaylistPreference(
            playlistId = playlistId,
            lastDecayTime = now,
            lastUsedTime = now,
        )

    private fun decayWeight(
        value: Double,
        elapsedMs: Long,
        halfLifeDays: Double,
    ): Double {
        if (value == 0.0) return 0.0
        return value * 0.5.pow(elapsedMs / (max(1.0, halfLifeDays) * DAY_MS))
    }

    /** 反馈计数按 30 天半衰期衰减；显式歌曲屏蔽不存于歌单计数，不受影响。 */
    fun decayPlaylistPreference(
        pref: PlaylistPreference,
        now: Long,
        halfLifeDays: Double = RadioConfig.PlaylistFeedback.FEEDBACK_HALF_LIFE_DAYS,
    ): PlaylistPreference {
        if (pref.lastDecayTime == 0L) return pref.copy(lastDecayTime = now)
        val elapsed = max(0L, now - pref.lastDecayTime)
        if (elapsed < MIN_DECAY_INTERVAL_MS) return pref
        return pref.copy(
            positiveWeight = decayWeight(pref.positiveWeight, elapsed, halfLifeDays),
            negativeWeight = decayWeight(pref.negativeWeight, elapsed, halfLifeDays),
            lastDecayTime = now,
        )
    }

    /**
     * 把一次结算增量并入歌单偏好（纯函数，冷却/软拉黑状态机都在这里）。
     * 秒切首次进 12h 冷却，再次秒切或负分累计超阈值升级 30 天拉黑；任意正反馈立即解除。
     */
    fun updatePlaylistPreference(
        pref: PlaylistPreference,
        effect: PlaylistEffect,
        now: Long,
    ): PlaylistPreference {
        val cfg = RadioConfig.PlaylistFeedback
        var next = pref.copy(lastUsedTime = now, lastDecayTime = now)
        next =
            next.copy(
                positiveWeight = max(0.0, pref.positiveWeight + effect.positiveDelta),
                negativeWeight = max(0.0, pref.negativeWeight + effect.negativeDelta),
                positiveCount = max(0, pref.positiveCount + effect.positiveDelta.compareTo(0.0)),
                negativeCount = max(0, pref.negativeCount + effect.negativeDelta.compareTo(0.0)),
            )
        if (effect.negativeDelta > 0) {
            if (!effect.negativeTrackKey.isNullOrEmpty() && effect.negativeTrackKey != pref.lastNegativeTrackKey) {
                next = next.copy(distinctNegativeTracks = pref.distinctNegativeTracks + 1, lastNegativeTrackKey = effect.negativeTrackKey)
            }
            next = next.copy(consecutiveNegativeCount = pref.consecutiveNegativeCount + 1)
            if (effect.instantSkip) {
                val skips = pref.instantSkipCount + 1
                val banned =
                    skips >= cfg.INSTANT_SKIP_BAN_AFTER_SKIPS ||
                        next.negativeWeight >= cfg.INSTANT_SKIP_BAN_NEGATIVE_WEIGHT
                next =
                    next.copy(
                        instantSkipCount = skips,
                        cooldownFactor = cfg.INSTANT_SKIP_COOLDOWN_FACTOR,
                        cooldownUntil = now + if (banned) cfg.INSTANT_SKIP_BAN_MS else cfg.INSTANT_SKIP_COOLDOWN_MS,
                    )
            } else if (next.distinctNegativeTracks >= 3 && next.negativeWeight >= cfg.COOLDOWN_NEGATIVE_WEIGHT) {
                // 单次负反馈不永久封禁；至少 3 首不同歌曲持续负反馈才进入临时冷却
                next = next.copy(cooldownUntil = now + cfg.COOLDOWN_MS)
            }
        }
        if (effect.positiveDelta > 0) {
            next =
                next.copy(
                    consecutiveNegativeCount = 0,
                    cooldownUntil = null,
                    cooldownFactor = null,
                    instantSkipCount = 0,
                )
        }
        return next
    }

    /** 把歌单级正/负增量按系数折算进所属分类；直接改动传入的 map（与状态存储共享引用）。 */
    fun applyThemeFeedback(
        themes: MutableMap<String, ThemePreference>,
        themeId: String,
        positiveDelta: Double,
        negativeDelta: Double,
        now: Long,
    ): ThemePreference {
        val cfg = RadioConfig.ThemeFeedback
        val base =
            ThemeFeedback.decayThemePreference(
                themes[themeId] ?: ThemeFeedback.createThemePreference(themeId, now),
                now,
            )
        val pref =
            base.copy(
                positiveWeight = max(0.0, base.positiveWeight + positiveDelta * cfg.POSITIVE_FACTOR),
                negativeWeight = max(0.0, base.negativeWeight + negativeDelta * cfg.NEGATIVE_FACTOR),
                lastUsedTime = now,
            )
        themes[themeId] = pref
        return pref
    }

    /** 主题净权重对亲和力的乘性偏置：正反馈最多 +affinityBias，负反馈按 1.5 倍幅度降权。 */
    fun themeAffinityFactor(net: Double): Double {
        val cfg = RadioConfig.ThemeFeedback
        val normalized = max(-1.0, min(1.0, net / cfg.SATURATION))
        val factor =
            if (normalized >= 0) {
                1.0 + cfg.AFFINITY_BIAS * normalized
            } else {
                1.0 + cfg.AFFINITY_BIAS * 1.5 * normalized
            }
        return max(0.1, factor)
    }

    /**
     * 显式反馈结算。明确反馈优先于隐式反馈：同一 playId 上只补差，不重复叠加完整奖励。
     */
    fun settleExplicitFeedback(
        event: ExplicitFeedbackEvent,
        previous: LedgerEntry?,
        recordSourcePlaylistId: String?,
    ): SettlementResult {
        val reasons = mutableListOf<String>()
        val playlistId = event.sourcePlaylistId ?: recordSourcePlaylistId
        var base =
            (previous ?: LedgerEntry(timestamp = event.timestamp)).copy(timestamp = event.timestamp)
        var track: TrackEffect? = null
        var playlist: PlaylistEffect? = null
        var excludeTrackKey: String? = null
        val wasNegative = previous?.explicitNegative == true
        var playlistPositiveDelta = 0.0
        var playlistNegativeDelta = 0.0

        fun applyTrackReward(target: Double): Double {
            val delta = max(target - base.trackReward, 0.0)
            base = base.copy(trackReward = max(base.trackReward, target))
            return delta
        }

        fun applyPlaylistPositive(target: Double) {
            playlistPositiveDelta += max(target - base.playlistPositive, 0.0)
            base = base.copy(playlistPositive = max(base.playlistPositive, target))
        }

        fun applyPlaylistNegative(target: Double) {
            playlistNegativeDelta += max(target - base.playlistNegative, 0.0)
            base = base.copy(playlistNegative = max(base.playlistNegative, target))
        }

        when (event.type) {
            ExplicitFeedbackType.LIKE -> {
                if (wasNegative) {
                    // 明确喜欢撤回同一次播放的明确不喜欢；这是撤回，不是负反馈
                    val trackDelta = RadioConfig.Behavior.LIKE - base.trackReward
                    playlistPositiveDelta += RadioConfig.PlaylistFeedback.LIKE - base.playlistPositive
                    playlistNegativeDelta -= base.playlistNegative
                    base =
                        base.copy(
                            trackReward = RadioConfig.Behavior.LIKE,
                            playlistPositive = RadioConfig.PlaylistFeedback.LIKE,
                            playlistNegative = 0.0,
                            explicitNegative = false,
                            explicitLike = true,
                        )
                    track = TrackEffect(event.trackKey, trackDelta, likeCountDelta = 1)
                    reasons.add("explicit_like_after_dislike_retract")
                } else {
                    val trackDelta = applyTrackReward(RadioConfig.Behavior.LIKE)
                    applyPlaylistPositive(RadioConfig.PlaylistFeedback.LIKE)
                    track = TrackEffect(event.trackKey, trackDelta, likeCountDelta = 1)
                    base = base.copy(explicitLike = true)
                    reasons.add(if (trackDelta != 0.0) "explicit_like" else "explicit_like_already_counted")
                }
            }
            ExplicitFeedbackType.UNLIKE -> {
                val trackDelta = -base.trackReward
                playlistPositiveDelta -= base.playlistPositive
                base = base.copy(trackReward = 0.0, playlistPositive = 0.0, explicitLike = false)
                track = TrackEffect(event.trackKey, trackDelta, likeCountDelta = -1)
                reasons.add("explicit_unlike_withdraw")
            }
            ExplicitFeedbackType.ADD_TO_PLAYLIST -> {
                val trackDelta = applyTrackReward(RadioConfig.Behavior.ADD_TO_PLAYLIST)
                applyPlaylistPositive(RadioConfig.PlaylistFeedback.ADD_TO_PLAYLIST)
                base = base.copy(explicitAdd = true)
                track = TrackEffect(event.trackKey, trackDelta, addToPlaylistDelta = 1)
                reasons.add(if (trackDelta != 0.0) "explicit_add_to_playlist" else "explicit_add_already_counted")
            }
            ExplicitFeedbackType.REPEAT -> {
                val trackDelta = applyTrackReward(RadioConfig.Behavior.REPEAT)
                base = base.copy(explicitRepeat = true)
                track = TrackEffect(event.trackKey, trackDelta, repeatDelta = 1)
                reasons.add(if (trackDelta != 0.0) "explicit_repeat" else "explicit_repeat_already_counted")
            }
            ExplicitFeedbackType.DISLIKE -> {
                val targetTrack = -abs(RadioConfig.Behavior.DISLIKE)
                val trackDelta = targetTrack - base.trackReward
                playlistPositiveDelta -= base.playlistPositive
                applyPlaylistNegative(RadioConfig.PlaylistFeedback.DISLIKE)
                base = base.copy(trackReward = targetTrack, playlistPositive = 0.0, explicitNegative = true)
                track = TrackEffect(event.trackKey, trackDelta, dislikeCountDelta = 1)
                excludeTrackKey = event.trackKey
                reasons.add("explicit_dislike")
            }
        }

        if (playlistId != null && (playlistPositiveDelta != 0.0 || playlistNegativeDelta != 0.0)) {
            playlist =
                PlaylistEffect(
                    id = playlistId,
                    positiveDelta = playlistPositiveDelta,
                    negativeDelta = playlistNegativeDelta,
                    negativeTrackKey = if (event.type == ExplicitFeedbackType.DISLIKE) event.trackKey else null,
                )
        }
        return SettlementResult(base, track, playlist, excludeTrackKey, reasons)
    }

    fun shouldSuppressImplicitSettlement(entry: LedgerEntry?): Boolean {
        if (entry == null) return false
        return entry.explicitNegative || entry.explicitLike || entry.explicitAdd || entry.explicitRepeat || entry.completion
    }

    /** 隐式结算只执行一次；重复播放结束事件不重复记账（幂等由 playId 账本保证）。 */
    fun shouldApplyImplicitSettlement(entry: LedgerEntry?): Boolean {
        if (entry?.implicitSettled == true) return false
        return !shouldSuppressImplicitSettlement(entry)
    }

    fun isDuplicatePlayId(
        ledger: Map<String, LedgerEntry>,
        playId: String?,
    ): Boolean = playId != null && ledger.containsKey(playId)

    fun trimLedger(
        ledger: Map<String, LedgerEntry>,
        limit: Int = RadioConfig.Storage.FEEDBACK_LEDGER_LIMIT,
    ): Map<String, LedgerEntry> {
        if (ledger.size <= limit) return ledger
        return ledger.entries
            .sortedByDescending { it.value.timestamp }
            .take(limit)
            .associate { it.key to it.value }
    }
}

/** RN 的 endReason 字符串值（用于结算原因，与 RN 日志可比对）。 */
fun PlayEndReason.rnName(): String =
    when (this) {
        PlayEndReason.NATURAL_END -> "natural_end"
        PlayEndReason.USER_NEXT -> "user_next"
        PlayEndReason.USER_SELECT_OTHER -> "user_select_other"
        PlayEndReason.DISLIKE -> "dislike"
        PlayEndReason.PLAY_ERROR -> "play_error"
        PlayEndReason.LOAD_ERROR -> "load_error"
        PlayEndReason.APP_DESTROY -> "app_destroy"
        PlayEndReason.RADIO_SWITCH -> "radio_switch"
        PlayEndReason.UNKNOWN -> "unknown"
    }
