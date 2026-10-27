package cn.toside.music.core.recommend.m3

import cn.toside.music.core.recommend.PlaylistRank
import cn.toside.music.core.recommend.radio.ObservedPlaylist
import cn.toside.music.core.recommend.radio.PlayEndReason
import cn.toside.music.core.recommend.radio.RadioConfig
import cn.toside.music.core.recommend.radio.RadioPlayRecord
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

/**
 * 共现索引 —— RN `core/recommend/similarity.ts` 里 Wave5 判定「照搬会恒 0」而没移植的
 * 四个函数的落地版（W5-4 前半）。
 *
 * **语义修正（实证后改做法）**：起草任务书写的是「本地歌单库 → 歌手/标题倒排索引」，
 * 对照 RN 源码后确认这条路走不通：
 * - `library.ts` / `libraryIndex.ts` 的索引（`LibraryIndexData`）只服务两件事：
 *   「已在库」判重（`isLibraryTrack`）与网络歌单导入归因（`getLibraryTrackOrigins`）；
 *   它**没有**任何共现计数，也不产出歌手/标题倒排。
 * - RN 真正的共现输入是两条：
 *   1. **已观察歌单倒排索引**：`buildTrackPlaylistIndex(observedPlaylists)` +
 *      `computeCandidateCoOccurrence`（candidate.ts:618，合并候选后逐首重算）；
 *   2. **会话共现**：`buildSessionCoOccurrence(radioHistory, profile.seedKeys)`
 *      （index.ts:605，SAR 式：同场收听 + 半衰期衰减 + 饱和归一化）。
 * 所以本文件移植的是 1 与 2，外加配套的 `groupSimilarPlaylists`（并查集分组）。
 * 音频 embedding 那一路（`audioEmbedding.ts`）仍不做（W5-5 遗留）。
 *
 * 不给「跨歌单共现」凭空造输入：观察记录里 `confirmed=false` 的歌单在 RN 里同样
 * 不贡献共现（`if (!playlist.confirmed || playlist.seedOverlap <= 0) continue`），
 * 原生此前把所有 observed 都写成 `confirmed=false`，共现因此恒 0 ——
 * 那是接线问题，由 `RadioPool.applyCoOccurrence` 的调用方修正，不是本文件的算术问题。
 */
object LibraryIndex {
    /** 歌曲 → 包含它的已观察歌单 id 列表（RN `TrackPlaylistIndexEntry`）。 */
    data class TrackPlaylistIndexEntry(
        val playlistIds: List<String> = emptyList(),
        val updatedAt: Long = 0,
    )

    /**
     * 倒排索引：歌单 → 曲目。带容量上限，超限时**不再收录新曲目**（RN 同：
     * 已有条目继续补歌单 id，新条目直接丢弃，避免索引无限膨胀）。
     */
    fun buildTrackPlaylistIndex(
        playlists: List<ObservedPlaylist>,
        maxEntries: Int = RadioConfig.CoOccurrence.INDEX_MAX_ENTRIES,
        now: Long = 0,
    ): Map<String, TrackPlaylistIndexEntry> {
        val index = linkedMapOf<String, TrackPlaylistIndexEntry>()
        for (playlist in playlists) {
            for (trackKey in playlist.trackKeys) {
                val existing = index[trackKey]
                if (existing != null) {
                    if (!existing.playlistIds.contains(playlist.id)) {
                        index[trackKey] = existing.copy(playlistIds = existing.playlistIds + playlist.id)
                    }
                    continue
                }
                if (index.size >= max(0, maxEntries)) continue
                index[trackKey] = TrackPlaylistIndexEntry(listOf(playlist.id), now)
            }
        }
        return index
    }

    /**
     * 歌单级导入来源输入 —— RN `LibraryPlaylistInput` 里参与归因的字段子集。
     *
     * 曲目先由调用方转成 trackKey（`RadioTrackKeys.buildTrackKey`），core 不解析曲目结构。
     */
    data class PlaylistOriginInput(
        val id: String,
        val source: String? = null,
        val sourceListId: String? = null,
        val trackKeys: List<String> = emptyList(),
    )

    /**
     * 网络导入来源键（RN `getPlaylistOriginKey`）：`source` 与 `sourceListId`
     * 缺一即视为非导入歌单，返回 null —— 用户自建但没从网络歌单导入的列表不贡献归因。
     */
    fun playlistOriginKey(playlist: PlaylistOriginInput): String? {
        val source = playlist.source?.takeIf { it.isNotEmpty() } ?: return null
        val sourceListId = playlist.sourceListId?.takeIf { it.isNotEmpty() } ?: return null
        return PlaylistRank.normalizePlaylistKey(source, sourceListId)
    }

    /**
     * 曲目 → 导入来源歌单键（RN `buildLibraryIndexData` 的 `origins` 字段）。
     *
     * 一首歌可能同时被多张网络歌单导入（用户各导一份），来源去重且保留首次出现顺序；
     * 无来源歌单直接跳过，空 trackKey 不入表。判断只看歌单级 `source/sourceListId`，
     * RN 没有逐曲来源元数据，这里也不造。
     */
    fun buildOriginIndex(playlists: List<PlaylistOriginInput>): Map<String, List<String>> {
        val index = linkedMapOf<String, MutableList<String>>()
        for (playlist in playlists) {
            val origin = playlistOriginKey(playlist) ?: continue
            for (trackKey in playlist.trackKeys) {
                if (trackKey.isEmpty()) continue
                val origins = index.getOrPut(trackKey) { mutableListOf() }
                if (!origins.contains(origin)) origins.add(origin)
            }
        }
        return index
    }

    data class CoOccurrenceInput(
        val seedTrackKeys: Set<String> = emptySet(),
        val observedPlaylists: List<ObservedPlaylist> = emptyList(),
        val index: Map<String, TrackPlaylistIndexEntry> = emptyMap(),
        /** 歌单级权重覆盖（缺省用歌单自己的种子重合数）。 */
        val playlistWeights: Map<String, Double> = emptyMap(),
    )

    /**
     * 候选歌曲与画像种子的共现分（RN `computeCandidateCoOccurrence`）：
     * - 只统计**确认含种子**的观察歌单；
     * - 按歌单有效规模（√n）归一，小歌单里的同场关系比大杂烩歌单更可信；
     * - 热门歌曲（出现在很多观察歌单里）按观察频次降权；
     * - 多歌单贡献先饱和（`t/(1+t)`）、再用「单个歌单贡献 × 2.5 × 阻尼」封顶，
     *   避免一首歌被重复收录无限叠加。
     */
    fun computeCandidateCoOccurrence(
        candidateTrackKey: String,
        input: CoOccurrenceInput,
    ): Double {
        val entry = input.index[candidateTrackKey] ?: return 0.0
        if (entry.playlistIds.isEmpty()) return 0.0
        val observedById = input.observedPlaylists.associateBy { it.id }
        var total = 0.0
        var maxSingle = 0.0
        var contributing = 0
        for (playlistId in entry.playlistIds) {
            val playlist = observedById[playlistId] ?: continue
            if (!playlist.confirmed || playlist.seedOverlap <= 0) continue
            val effectiveSize = max(1, playlist.trackKeys.size)
            val coverageConfidence = max(0.15, playlist.confidence)
            val seedWeight = input.playlistWeights[playlistId] ?: playlist.seedOverlap.toDouble()
            val contribution = seedWeight * coverageConfidence / kotlin.math.sqrt(effectiveSize.toDouble())
            total += contribution
            maxSingle = max(maxSingle, contribution)
            contributing += 1
        }
        if (total <= 0.0 || contributing == 0) return 0.0
        val damping = Similarity.computePopularityDamping(entry.playlistIds.size, RadioConfig.CoOccurrence.POPULARITY_DAMPING)
        val saturated = total / (1.0 + total)
        val withCap =
            if (maxSingle > 0.0) {
                min(saturated, maxSingle * RadioConfig.CoOccurrence.MAX_MULTI_PLAYLIST_BOOST * damping)
            } else {
                saturated
            }
        return max(0.0, min(1.0, withCap))
    }

    /**
     * 以曲目重合度对观察歌单做并查集分组（RN `groupSimilarPlaylists`）：
     * 低覆盖采样时相似度要乘置信度（下限 0.2），避免把「只看到 3 首」的两张歌单
     * 因为恰好重合就并成一组。组 id 形状 `group:<rootId>`（与 RN 同）。
     */
    fun groupSimilarPlaylists(
        playlists: List<ObservedPlaylist>,
        threshold: Double = RadioConfig.CoOccurrence.SIMILAR_PLAYLIST_THRESHOLD,
    ): Map<String, String> {
        val parent = HashMap<String, String>()
        for (playlist in playlists) parent[playlist.id] = playlist.id

        fun find(id: String): String {
            var root = id
            while (parent[root] != root) root = parent[root] ?: return id
            // 路径压缩
            var current = id
            while (parent[current] != root) {
                val next = parent[current] ?: break
                parent[current] = root
                current = next
            }
            return root
        }

        fun union(
            a: String,
            b: String,
        ) {
            val rootA = find(a)
            val rootB = find(b)
            if (rootA != rootB) parent[rootB] = rootA
        }

        for (i in playlists.indices) {
            for (j in i + 1 until playlists.size) {
                val a = playlists[i]
                val b = playlists[j]
                val similarity =
                    Similarity.jaccard(a.trackKeys.toSet(), b.trackKeys.toSet()) *
                        min(1.0, max(0.2, a.confidence)) *
                        min(1.0, max(0.2, b.confidence))
                if (similarity >= threshold) union(a.id, b.id)
            }
        }
        val groups = HashMap<String, String>()
        for (playlist in playlists) groups[playlist.id] = "group:${find(playlist.id)}"
        return groups
    }

    data class SessionCoOccurrenceOptions(
        val now: Long = 0,
        val sessionGapMs: Long = RadioConfig.CoOccurrence.SESSION_GAP_MS,
        val halfLifeDays: Double = RadioConfig.CoOccurrence.HALF_LIFE_DAYS,
        val maxRecords: Int = RadioConfig.CoOccurrence.MAX_RECORDS,
        val anchorMinCoverage: Double = RadioConfig.CoOccurrence.ANCHOR_MIN_COVERAGE,
        val memberMinCoverage: Double = RadioConfig.CoOccurrence.MEMBER_MIN_COVERAGE,
    )

    /**
     * SAR 式会话共现（RN `buildSessionCoOccurrence`）：同一场收听（相邻记录间隔
     * ≤ [SessionCoOccurrenceOptions.sessionGapMs]）内的歌构成一次 transaction，
     * 与「用户积极听完的画像种子歌」同场的候选获得加权共现分 ——
     * 这是歌单共现之外、完全来自用户自己播放序列的品味信号。
     *
     * - anchor：种子歌且覆盖率 ≥ anchorMinCoverage（真听完才算正样本）；
     * - member：非种子歌，且通过中性收听过滤（早切的不吸收信号）；
     * - 权重 = anchor 覆盖率 × 半衰期衰减，按 (session, anchor) 累加后饱和归一化到 0~1。
     *
     * 不造信号的另一面：没有种子歌、或整段历史没有中性收听记录时返回空表，
     * 调用方按「本轮无共现信号」处理（权重项自然为 0）。
     */
    fun buildSessionCoOccurrence(
        radioHistory: List<RadioPlayRecord>,
        seedKeys: Set<String>,
        options: SessionCoOccurrenceOptions = SessionCoOccurrenceOptions(),
    ): Map<String, Double> {
        if (seedKeys.isEmpty() || radioHistory.isEmpty()) return emptyMap()
        val members =
            radioHistory
                .filter { record ->
                    val reason = record.endReason ?: return@filter false
                    if (!NEUTRAL_REASONS.contains(reason)) return@filter false
                    if (reason == PlayEndReason.USER_NEXT && record.coverage < options.memberMinCoverage) return@filter false
                    record.coverage > 0 || reason == PlayEndReason.NATURAL_END
                }.sortedBy { it.startedAt }
                .takeLast(max(0, options.maxRecords))
        if (members.isEmpty()) return emptyMap()

        val sessions = mutableListOf<MutableList<RadioPlayRecord>>()
        for (record in members) {
            val last = sessions.lastOrNull()
            val previous = last?.lastOrNull()
            if (last != null && previous != null && record.startedAt - previous.startedAt <= options.sessionGapMs) {
                last.add(record)
            } else {
                sessions.add(mutableListOf(record))
            }
        }

        val halfLifeMs = max(1.0, options.halfLifeDays) * 86_400_000.0
        val coOccurrence = linkedMapOf<String, Double>()
        for (session in sessions) {
            val anchors = session.filter { seedKeys.contains(it.trackKey) && it.coverage >= options.anchorMinCoverage }
            if (anchors.isEmpty()) continue
            for (record in session) {
                if (seedKeys.contains(record.trackKey)) continue
                var total = 0.0
                for (anchor in anchors) {
                    val decay = 0.5.pow(max(0L, options.now - anchor.startedAt) / halfLifeMs)
                    total += min(1.0, anchor.coverage) * decay
                }
                coOccurrence[record.trackKey] = (coOccurrence[record.trackKey] ?: 0.0) + total / anchors.size
            }
        }
        val scores = linkedMapOf<String, Double>()
        for ((trackKey, total) in coOccurrence) scores[trackKey] = min(1.0, total / (1.0 + total))
        return scores
    }

    /** RN `buildSessionCoOccurrence` 的中性收听原因集合（早切/踩雷/出错不吸收信号）。 */
    val NEUTRAL_REASONS: Set<PlayEndReason> =
        setOf(PlayEndReason.NATURAL_END, PlayEndReason.USER_NEXT, PlayEndReason.USER_SELECT_OTHER)
}
