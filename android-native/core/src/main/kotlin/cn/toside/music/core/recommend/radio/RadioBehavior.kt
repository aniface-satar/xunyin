package cn.toside.music.core.recommend.radio

import cn.toside.music.core.recommend.ArtistPrior
import cn.toside.music.core.recommend.NameTokenFeedback
import kotlinx.serialization.json.JsonObject
import kotlin.math.max
import kotlin.math.min

/**
 * 电台状态变更 —— RN `core/recommend/behavior.ts` 移植。
 *
 * 与 RN 一样是「纯规则 + 传入状态」：每次返回新的 [RadioState]，
 * 由 [RadioEngine] 负责持有与落盘。时间由参数传入，测试可锁时钟。
 */
data class BeginPlayInput(
    val playId: String,
    val trackKey: String,
    val musicInfo: JsonObject,
    val startedAt: Long,
    val channel: ChannelId? = null,
    val sourcePlaylistId: String? = null,
    val sourceSeedTrackKey: String? = null,
    val sourceClusterId: String? = null,
    val sourceChartId: String? = null,
    val platform: String? = null,
)

data class ExplicitFeedbackInput(
    val type: ExplicitFeedbackType,
    val trackKey: String,
    val timestamp: Long,
    val musicInfo: JsonObject? = null,
    /** dislike 来自遮罩时只有歌名/歌手，用于词面学习与歌手先验。 */
    val name: String? = null,
    val singer: String? = null,
    val playId: String? = null,
    val sourcePlaylistId: String? = null,
    val channel: ChannelId? = null,
    val listId: String? = null,
)

data class ExplicitFeedbackResult(
    val state: RadioState,
    val settlement: SettlementResult,
    val channel: ChannelId?,
    val banditOutcome: BanditOutcome?,
)

data class FinishPlayResult(
    val state: RadioState,
    val record: RadioPlayRecord,
    val settlement: SettlementResult?,
)

object RadioBehavior {
    private const val TRACK_SCORE_LIMIT = 30.0

    fun pushSessionTrack(
        session: SessionPreference,
        track: SessionTrack,
    ): SessionPreference {
        val tracks = (listOf(track) + session.recentTracks).take(RadioConfig.Session.RECENT_TRACKS_LIMIT)
        val channels =
            if (track.channel != null) {
                (listOf(track.channel) + session.recentChannels).take(RadioConfig.Channels.WINDOW_SIZE)
            } else {
                session.recentChannels
            }
        return session.copy(recentTracks = tracks, recentChannels = channels)
    }

    fun applySettlementResult(
        state: RadioState,
        result: SettlementResult,
        now: Long,
    ): RadioState {
        var next = state
        result.track?.let { effect ->
            var pref = next.ensureTrack(effect.key)
            pref =
                pref.copy(
                    score = max(-TRACK_SCORE_LIMIT, min(TRACK_SCORE_LIMIT, pref.score + effect.scoreDelta)),
                    playCount = pref.playCount + (effect.playCountDelta ?: 0),
                    completeCount = pref.completeCount + (effect.completeCountDelta ?: 0),
                    skipCount = pref.skipCount + (effect.skipCountDelta ?: 0),
                    earlySkipCount = pref.earlySkipCount + (effect.earlySkipCountDelta ?: 0),
                    likeCount = max(0, pref.likeCount + (effect.likeCountDelta ?: 0)),
                    dislikeCount = max(0, pref.dislikeCount + (effect.dislikeCountDelta ?: 0)),
                    repeatCount = pref.repeatCount + (effect.repeatDelta ?: 0),
                    addToPlaylistCount = pref.addToPlaylistCount + (effect.addToPlaylistDelta ?: 0),
                )
            if (effect.averageListenRatio != null) {
                val previousPlayCount = max(1, pref.playCount - 1)
                pref =
                    pref.copy(
                        averageListenRatio =
                            (pref.averageListenRatio * previousPlayCount + effect.averageListenRatio) /
                                (previousPlayCount + 1),
                    )
            }
            if (effect.scoreDelta > 0) pref = pref.copy(lastPositiveTime = now)
            if (effect.scoreDelta < 0) pref = pref.copy(lastNegativeTime = now)
            next = next.copy(tracks = next.tracks + (effect.key to pref))
        }
        result.playlist?.let { effect ->
            val pref = RadioFeedback.updatePlaylistPreference(next.ensurePlaylist(effect.id, now), effect, now)
            var themes = next.themeWeights
            // 主题级学习：喜欢的歌加权其所在歌单的分类，不感兴趣让该分类整体降权
            val category = next.observedPlaylists[effect.id]?.category
            val themeId = if (category != null) RadioTrackKeys.normalizeText(category) else ""
            if (themeId.isNotEmpty() && (effect.positiveDelta > 0 || effect.negativeDelta > 0)) {
                val mutable = themes.toMutableMap()
                RadioFeedback.applyThemeFeedback(
                    mutable,
                    themeId,
                    max(0.0, effect.positiveDelta),
                    max(0.0, effect.negativeDelta),
                    now,
                )
                themes = mutable
            }
            next = next.copy(playlists = next.playlists + (effect.id to pref), themeWeights = themes)
        }
        result.excludeTrackKey?.let { trackKey ->
            next = next.copy(dislikedTracks = next.dislikedTracks + (trackKey to now))
        }
        return next
    }

    /** 真正开始播放才记曝光；排队不算。 */
    fun beginPlay(
        state: RadioState,
        input: BeginPlayInput,
    ): Pair<RadioState, RadioPlayRecord> {
        var next = state
        val now = input.startedAt
        val pref =
            next
                .ensureTrack(input.trackKey)
                .let {
                    it.copy(
                        playCount = it.playCount + 1,
                        lastPlayTime = now,
                        exposureCount = it.exposureCount + 1,
                    )
                }
        next = next.copy(tracks = next.tracks + (input.trackKey to pref))
        next = next.copy(exposureCounts = next.exposureCounts + (input.trackKey to (next.exposureCounts[input.trackKey] ?: 0L) + 1))
        val record =
            RadioPlayRecord(
                playId = input.playId,
                trackKey = input.trackKey,
                channel = input.channel,
                sourcePlaylistId = input.sourcePlaylistId,
                sourceSeedTrackKey = input.sourceSeedTrackKey,
                sourceClusterId = input.sourceClusterId,
                sourceChartId = input.sourceChartId,
                platform = input.platform,
                startedAt = now,
                intervals = emptyList(),
                listenedMs = 0,
                wallClockMs = 0,
                coverage = 0.0,
                settled = false,
                nameTokens = NameTokenFeedback.tokenizeTrackName(input.musicInfo.stringField("name")),
                artistKeys = RadioTrackKeys.getArtistKeys(input.musicInfo),
            )
        val sessionTrack =
            SessionTrack(
                trackKey = input.trackKey,
                timestamp = now,
                channel = input.channel,
                sourcePlaylistId = input.sourcePlaylistId,
                sourceSeedTrackKey = input.sourceSeedTrackKey,
                sourceClusterId = input.sourceClusterId,
                sourceChartId = input.sourceChartId,
                artistKeys = RadioTrackKeys.getArtistKeys(input.musicInfo),
            )
        next =
            next.copy(
                radioHistory = listOf(record) + next.radioHistory,
                session = pushSessionTrack(next.session, sessionTrack),
            )
        return next.trim(now) to record
    }

    private fun setSessionTrackResult(
        session: SessionPreference,
        trackKey: String,
        listenRatio: Double?,
        liked: Boolean?,
    ): SessionPreference {
        val recent = session.recentTracks.firstOrNull() ?: return session
        if (recent.trackKey != trackKey) return session
        val updated = recent.copy(listenRatio = listenRatio ?: recent.listenRatio, liked = liked ?: recent.liked)
        return session.copy(recentTracks = listOf(updated) + session.recentTracks.drop(1))
    }

    private fun updateBandit(
        arms: MutableMap<String, ChannelBanditArm>,
        channel: ChannelId?,
        outcome: BanditOutcome?,
        now: Long,
    ): Boolean {
        if (outcome == null || channel == null) return false
        ChannelBandit.update(arms, channel, outcome, now)
        return true
    }

    private fun applyTokenSettlement(
        state: RadioState,
        tokens: List<String>?,
        ledger: LedgerEntry,
        now: Long,
    ): RadioState {
        if (tokens.isNullOrEmpty()) return state
        if (!ledger.completion && !ledger.earlySkip) return state
        val map = state.tokenWeights.toMutableMap()
        if (ledger.completion) {
            NameTokenFeedback.applyNameTokenFeedback(map, tokens, RadioConfig.NameTokenFeedback.COMPLETE_POSITIVE, 0.0, now)
        }
        if (ledger.earlySkip) {
            NameTokenFeedback.applyNameTokenFeedback(map, tokens, 0.0, RadioConfig.NameTokenFeedback.EARLY_SKIP_NEGATIVE, now)
        }
        return state.copy(tokenWeights = map)
    }

    private fun applyArtistSettlement(
        state: RadioState,
        artistKeys: List<String>?,
        ledger: LedgerEntry,
        now: Long,
    ): RadioState {
        if (artistKeys.isNullOrEmpty()) return state
        if (!ledger.completion && !ledger.earlySkip) return state
        val map = state.artistStats.toMutableMap()
        if (ledger.completion) {
            ArtistPrior.applyArtistStatsFeedback(map, artistKeys, RadioConfig.ArtistPriorFeedback.COMPLETE_POSITIVE, 0.0, now)
        }
        if (ledger.earlySkip) {
            ArtistPrior.applyArtistStatsFeedback(map, artistKeys, 0.0, RadioConfig.ArtistPriorFeedback.EARLY_SKIP_NEGATIVE, now)
        }
        return state.copy(artistStats = map)
    }

    /** 播放结束结算：同一 playId 幂等；已收到显式反馈时不再叠加隐式完整奖励。 */
    fun finishPlay(
        state: RadioState,
        record: RadioPlayRecord,
        endReason: PlayEndReason,
        now: Long,
    ): FinishPlayResult {
        var next = state
        val coverage = RadioFeedback.computeEffectiveCoverage(record.copy(endReason = endReason))
        var merged = record.copy(endReason = endReason, endedAt = now, coverage = coverage)
        val index = next.radioHistory.indexOfFirst { it.playId == record.playId }
        next =
            next.copy(
                radioHistory =
                    if (index >= 0) {
                        next.radioHistory.toMutableList().also { it[index] = merged }
                    } else {
                        listOf(merged) + next.radioHistory
                    },
            )
        val ledger = next.settledPlayIds[record.playId]
        var settlement: SettlementResult? = null
        if (RadioFeedback.shouldApplyImplicitSettlement(ledger)) {
            val result = RadioFeedback.settlePlayRecord(merged, now)
            next = applySettlementResult(next, result, now)
            var entry = result.ledgerEntry.copy(banditCounted = ledger?.banditCounted ?: false)
            next = applyTokenSettlement(next, merged.nameTokens, entry, now)
            next = applyArtistSettlement(next, merged.artistKeys, entry, now)
            val arms = next.channelBandit.toMutableMap()
            val outcome =
                when {
                    entry.completion -> BanditOutcome.POSITIVE
                    entry.earlySkip -> BanditOutcome.NEGATIVE
                    else -> null
                }
            if (updateBandit(arms, merged.channel, outcome, now)) entry = entry.copy(banditCounted = true)
            next = next.copy(channelBandit = arms)
            next = next.copy(settledPlayIds = next.settledPlayIds + (record.playId to entry.copy(timestamp = now)))
            merged = merged.copy(settled = true, settlementReasons = result.reasons)
            settlement = result.copy(ledgerEntry = entry)
        } else {
            // 显式反馈优先：只补充播放记录，不再重复结算隐式奖励
            merged = merged.copy(settled = true, settlementReasons = listOf("explicit_feedback_supersedes_implicit"))
        }
        val ratio = merged.durationMs?.takeIf { it > 0 }?.let { merged.listenedMs.toDouble() / it }
        next = next.copy(session = setSessionTrackResult(next.session, record.trackKey, ratio, null))
        // 播放失败只影响资源可用性，不写入偏好（settlePlayRecord 已返回中性结果）
        return FinishPlayResult(next.trim(now), merged, settlement)
    }

    /** 显式反馈立即生效；重复事件按 playId 幂等，不重复叠加完整奖励。 */
    fun applyExplicitFeedback(
        state: RadioState,
        input: ExplicitFeedbackInput,
    ): ExplicitFeedbackResult {
        var next = state
        val timestamp = input.timestamp
        val playId = input.playId
        val previous = playId?.let { next.settledPlayIds[it] }
        val record = playId?.let { id -> next.radioHistory.firstOrNull { it.playId == id } }
        val event =
            ExplicitFeedbackEvent(
                trackKey = input.trackKey,
                type = input.type,
                timestamp = timestamp,
                playId = playId,
                listId = input.listId,
                sourcePlaylistId = input.sourcePlaylistId ?: record?.sourcePlaylistId,
                channel = input.channel ?: record?.channel,
            )
        val result = RadioFeedback.settleExplicitFeedback(event, previous, record?.sourcePlaylistId)
        next = applySettlementResult(next, result, timestamp)
        if (playId != null) {
            next =
                next.copy(
                    settledPlayIds = next.settledPlayIds + (playId to result.ledgerEntry.copy(timestamp = timestamp)),
                )
            val historyRecord = next.radioHistory.firstOrNull { it.playId == playId }
            if (historyRecord != null) {
                val updated =
                    when (input.type) {
                        ExplicitFeedbackType.LIKE -> historyRecord.copy(explicitLike = true)
                        ExplicitFeedbackType.UNLIKE -> historyRecord.copy(explicitLike = false)
                        ExplicitFeedbackType.DISLIKE -> historyRecord.copy(explicitDislike = true)
                        ExplicitFeedbackType.ADD_TO_PLAYLIST -> historyRecord.copy(addToPlaylistListId = input.listId)
                        ExplicitFeedbackType.REPEAT -> historyRecord
                    }
                next =
                    next.copy(
                        radioHistory =
                            next.radioHistory.map { if (it.playId == playId) updated else it },
                    )
            }
        }

        // 词面学习：显式信号比隐式结算更响
        val tokens =
            when {
                input.musicInfo != null -> NameTokenFeedback.tokenizeTrackName(input.musicInfo.stringField("name"))
                input.name != null -> NameTokenFeedback.tokenizeTrackName(input.name)
                else -> record?.nameTokens
            }
        val artistKeys =
            when {
                input.musicInfo != null -> RadioTrackKeys.getArtistKeys(input.musicInfo)
                input.singer != null -> RadioTrackKeys.getArtistKeys(input.singer)
                else -> record?.artistKeys
            }
        val tokenMap = next.tokenWeights.toMutableMap()
        val artistMap = next.artistStats.toMutableMap()
        when (input.type) {
            ExplicitFeedbackType.LIKE -> {
                NameTokenFeedback.applyNameTokenFeedback(tokenMap, tokens, RadioConfig.NameTokenFeedback.LIKE_POSITIVE, 0.0, timestamp)
                ArtistPrior.applyArtistStatsFeedback(artistMap, artistKeys, RadioConfig.ArtistPriorFeedback.LIKE_POSITIVE, 0.0, timestamp)
            }
            ExplicitFeedbackType.ADD_TO_PLAYLIST -> {
                NameTokenFeedback.applyNameTokenFeedback(
                    tokenMap,
                    tokens,
                    RadioConfig.NameTokenFeedback.ADD_TO_PLAYLIST_POSITIVE,
                    0.0,
                    timestamp,
                )
                ArtistPrior.applyArtistStatsFeedback(
                    artistMap,
                    artistKeys,
                    RadioConfig.ArtistPriorFeedback.ADD_TO_PLAYLIST_POSITIVE,
                    0.0,
                    timestamp,
                )
            }
            ExplicitFeedbackType.DISLIKE -> {
                NameTokenFeedback.applyNameTokenFeedback(tokenMap, tokens, 0.0, RadioConfig.NameTokenFeedback.DISLIKE_NEGATIVE, timestamp)
                ArtistPrior.applyArtistStatsFeedback(
                    artistMap,
                    artistKeys,
                    0.0,
                    RadioConfig.ArtistPriorFeedback.DISLIKE_NEGATIVE,
                    timestamp,
                )
            }
            else -> Unit
        }
        next = next.copy(tokenWeights = tokenMap, artistStats = artistMap)

        // bandit：显式正/负反馈各记一笔（幂等由 ledger 标记保证）
        val channel = input.channel ?: record?.channel
        val outcome =
            when (input.type) {
                ExplicitFeedbackType.LIKE, ExplicitFeedbackType.ADD_TO_PLAYLIST -> BanditOutcome.POSITIVE
                ExplicitFeedbackType.DISLIKE -> BanditOutcome.NEGATIVE
                else -> null
            }
        if (outcome != null && channel != null && previous?.banditCounted != true) {
            val arms = next.channelBandit.toMutableMap()
            ChannelBandit.update(arms, channel, outcome, timestamp)
            next = next.copy(channelBandit = arms)
            if (playId != null) {
                val entry = next.settledPlayIds[playId]
                if (entry != null) next = next.copy(settledPlayIds = next.settledPlayIds + (playId to entry.copy(banditCounted = true)))
            }
        }

        if (input.type == ExplicitFeedbackType.LIKE) {
            next = next.copy(session = setSessionTrackResult(next.session, input.trackKey, null, true))
        }
        if (input.type == ExplicitFeedbackType.DISLIKE) {
            next = next.copy(candidateCache = next.candidateCache.filterNot { it.trackKey == input.trackKey })
        }
        return ExplicitFeedbackResult(next.trim(timestamp), result, channel, outcome)
    }

    /** 推荐歌单「不感兴趣」：歌单偏好记一笔显式负反馈，所属分类整体降权。 */
    fun applyPlaylistNotInterested(
        state: RadioState,
        playlistId: String,
        category: String?,
        now: Long,
    ): RadioState {
        val negative = RadioConfig.PlaylistFeedback.DISLIKE
        val observedCategory = state.observedPlaylists[playlistId]?.category
        var next =
            applySettlementResult(
                state,
                SettlementResult(
                    ledgerEntry = LedgerEntry(timestamp = now, explicitNegative = true),
                    playlist = PlaylistEffect(playlistId, positiveDelta = 0.0, negativeDelta = negative),
                ),
                now,
            )
        val themeId =
            if (!category.isNullOrEmpty() && observedCategory.isNullOrEmpty()) {
                RadioTrackKeys.normalizeText(category)
            } else {
                ""
            }
        if (themeId.isNotEmpty()) {
            val themes = next.themeWeights.toMutableMap()
            RadioFeedback.applyThemeFeedback(themes, themeId, 0.0, negative, now)
            next = next.copy(themeWeights = themes)
        }
        return next.trim(now)
    }

    /**
     * 导入来源归因：本地收藏/自建歌单里的歌来自某个网络歌单时，给来源歌单记一次打折正反馈。
     */
    fun creditImportedOrigins(
        state: RadioState,
        origins: List<String>,
        kind: ExplicitFeedbackType,
        excludedPlaylistId: String?,
        now: Long,
    ): Pair<RadioState, Int> {
        val base =
            when (kind) {
                ExplicitFeedbackType.LIKE -> RadioConfig.PlaylistFeedback.LIKE
                ExplicitFeedbackType.ADD_TO_PLAYLIST -> RadioConfig.PlaylistFeedback.ADD_TO_PLAYLIST
                else -> 0.0
            }
        val delta = base * RadioConfig.PlaylistFeedback.IMPORTED_ORIGIN_DISCOUNT
        if (delta <= 0) return state to 0
        var next = state
        var credited = 0
        for (origin in origins) {
            if (origin.isEmpty() || origin == excludedPlaylistId) continue
            next =
                applySettlementResult(
                    next,
                    SettlementResult(
                        ledgerEntry = LedgerEntry(timestamp = now, playlistPositive = delta),
                        playlist = PlaylistEffect(origin, positiveDelta = delta, negativeDelta = 0.0),
                    ),
                    now,
                )
            credited += 1
        }
        return (if (credited > 0) next.trim(now) else next) to credited
    }

    fun getRecentRadioTrackKeys(
        state: RadioState,
        days: Int,
        now: Long,
    ): Set<String> {
        val threshold = now - days * 86_400_000L
        return state.radioHistory
            .filter { (it.endedAt ?: it.startedAt) >= threshold }
            .mapTo(mutableSetOf()) { it.trackKey }
    }

    fun removeCandidate(
        state: RadioState,
        trackKey: String,
    ): RadioState =
        if (state.candidateCache.none { it.trackKey == trackKey }) {
            state
        } else {
            state.copy(candidateCache = state.candidateCache.filterNot { it.trackKey == trackKey })
        }

    fun setSourceCooldown(
        state: RadioState,
        source: String,
        until: Long,
    ): RadioState = state.copy(sourceCooldowns = state.sourceCooldowns + (source to until))

    fun isSourceCoolingDown(
        state: RadioState,
        source: String,
        now: Long,
    ): Boolean = (state.sourceCooldowns[source] ?: 0L) > now
}
