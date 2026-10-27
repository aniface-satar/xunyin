package cn.toside.music.core.recommend.m3

import cn.toside.music.core.recommend.TrackKeys

/**
 * 歌曲级相似（「相似歌曲」入口）—— 全部信号来自本地曲库与词面，**不含音频特征**。
 *
 * RN 原仓库没有这个功能（`grep similarSong/getSimilar` 无命中），因此这里不是移植，
 * 而是按现有 M3 组件拼一个可解释的排序：
 * - 歌手重合（[TrackKeys.getArtistKeys]，权重 0.5）：同歌手/同组合是最强信号；
 * - 歌名 token 重合（权重 0.3）：跨音源的同一首歌常靠它命中；
 * - 专辑 token 重合（权重 0.1）：同专辑的其它曲；
 * - 同歌单共现（权重 0.1）：同一张自建歌单里的曲，弱信号。
 *
 * 分数用 [Similarity.combine] 归一；低于 [MIN_SCORE] 的候选直接丢弃 —— 只有弱信号
 * （例如仅同歌单）的曲目不该被当成「相似」。列表按歌手限额 [MAX_PER_ARTIST]，
 * 避免整屏都是同一个歌手的歌。
 */
object SimilarSongs {
    /** 候选曲目的最小输入：core 不碰曲目 JSON，trackKey 由调用方用同源口径生成。 */
    data class Track(
        val trackKey: String,
        val name: String,
        val singer: String,
        val album: String = "",
        val listIds: Set<String> = emptySet(),
    )

    data class Scored(
        val track: Track,
        val score: Double,
    )

    const val MAX_PER_ARTIST = 2
    const val MIN_SCORE = 0.2

    private const val WEIGHT_ARTIST = 0.5
    private const val WEIGHT_TITLE = 0.3
    private const val WEIGHT_ALBUM = 0.1
    private const val WEIGHT_SAME_LIST = 0.1

    private val TOKEN_SEPARATORS = Regex("[\\s/\\\\|,，、;；:：·・•\\-–—()（）\\[\\]【】+&]+")

    /** 歌名/专辑的 token 集合；CJK 无空格时整串当一个 token（只做精确重合）。 */
    private fun tokens(text: String?): Set<String> =
        TrackKeys
            .normalizeText(text)
            .split(TOKEN_SEPARATORS)
            .filter { it.isNotEmpty() }
            .toSet()

    private fun artistKeys(singer: String?): Set<String> = TrackKeys.getArtistKeys(singer).toSet()

    fun score(
        seed: Track,
        candidate: Track,
    ): Double {
        val sameList = if (seed.listIds.any { it in candidate.listIds }) 1.0 else 0.0
        return Similarity.combine(
            listOf(
                WEIGHT_ARTIST to Similarity.jaccard(artistKeys(seed.singer), artistKeys(candidate.singer)),
                WEIGHT_TITLE to Similarity.jaccard(tokens(seed.name), tokens(candidate.name)),
                WEIGHT_ALBUM to Similarity.jaccard(tokens(seed.album), tokens(candidate.album)),
                WEIGHT_SAME_LIST to sameList,
            ),
        )
    }

    /**
     * 候选排序：先按 trackKey 去重合并歌单归属，再算分、过滤、排序，最后按歌手限额截断。
     * 排序是全序（分数 → 歌名 → trackKey），同分结果不随输入顺序抖动。
     */
    fun rank(
        seed: Track,
        candidates: List<Track>,
        limit: Int,
    ): List<Scored> {
        if (limit <= 0) return emptyList()
        val merged = linkedMapOf<String, Track>()
        for (candidate in candidates) {
            if (candidate.trackKey.isEmpty() || candidate.trackKey == seed.trackKey) continue
            val existing = merged[candidate.trackKey]
            merged[candidate.trackKey] =
                if (existing == null) {
                    candidate
                } else {
                    existing.copy(
                        album = existing.album.ifEmpty { candidate.album },
                        listIds = existing.listIds + candidate.listIds,
                    )
                }
        }
        val ranked =
            merged.values
                .map { Scored(it, score(seed, it)) }
                .filter { it.score >= MIN_SCORE }
                .sortedWith(
                    compareByDescending<Scored> { it.score }
                        .thenBy { TrackKeys.normalizeText(it.track.name) }
                        .thenBy { it.track.trackKey },
                )
        val perArtist = mutableMapOf<String, Int>()
        val result = mutableListOf<Scored>()
        for (item in ranked) {
            if (result.size >= limit) break
            val artist = TrackKeys.getArtistKeys(item.track.singer).firstOrNull().orEmpty()
            if (artist.isNotEmpty()) {
                val used = perArtist[artist] ?: 0
                if (used >= MAX_PER_ARTIST) continue
                perArtist[artist] = used + 1
            }
            result.add(item)
        }
        return result
    }
}
