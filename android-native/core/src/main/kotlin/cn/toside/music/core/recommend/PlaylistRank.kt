package cn.toside.music.core.recommend

/**
 * 推荐 tab 两个区块（新歌速递 / 推荐歌单）的画像重排 —— RN
 * `core/recommend/tabSections.ts` 的 M1 子集原样移植。
 *
 * 只做「按已学画像排序」，不发请求、不碰电台队列；排序均为稳定排序
 * （同分保持输入次序），冷启动（空画像）等于不过问。
 *
 * M1 不移植（电台/语种配额侧，进度文档明确不影响内容通道）：
 * LANG_BUCKET_TAGS / planLangBucketFetch / prioritizeL1LangSources / pickWeightedTag。
 */
object PlaylistRank {
    /** 歌单归因到歌手时的最短匹配：单字艺人名容易误伤标题。 */
    private const val MIN_ARTIST_MATCH_LEN = 2

    /** 同组命中里取名字最短的一张：限定词越少越通用（新歌榜 > ACG新歌榜）。 */
    private fun pickGeneral(candidates: List<Pair<String, String>>): Pair<String, String>? = candidates.minByOrNull { it.second.length }

    /** 榜单/分类定向化共用的关键词命中计数：名字里命中的画像词越多分越高。 */
    fun keywordHits(
        keywords: List<String>,
        name: String?,
    ): Int {
        val normalized = TrackKeys.normalizeText(name)
        if (normalized.isEmpty()) return 0
        var hits = 0
        for (keyword in keywords) {
            if (keyword.isNotEmpty() && normalized.contains(keyword)) hits++
        }
        return hits
    }

    /** 曲目级画像因子：歌手先验 × 歌名词面学习；都没有学过时恒为 1。 */
    fun profileTrackFactor(
        name: String?,
        singer: String?,
        state: ProfileFactorState,
        now: Long,
    ): Double =
        ArtistPrior.artistPriorFactor(state.artistStats, TrackKeys.getArtistKeys(singer), now) *
            NameTokenFeedback.nameTokenFactor(state.tokenWeights, name, now)

    /**
     * 按画像因子给一批候选歌降序；因子相同的保持输入次序（榜单原名次），
     * 所以冷启动等于不过问，学出画像后才逐渐压过榜单惯性。
     */
    fun <T> rankTracksByProfile(
        tracks: List<T>,
        nameOf: (T) -> String?,
        singerOf: (T) -> String?,
        state: ProfileFactorState,
        now: Long,
    ): List<T> {
        val scored =
            tracks.mapIndexed { index, item ->
                Triple(item, index, profileTrackFactor(nameOf(item), singerOf(item), state, now))
            }
        return scored
            .sortedWith(compareByDescending<Triple<T, Int, Double>> { it.third }.thenBy { it.second })
            .map { it.first }
    }

    /** 歌单归因键：创建者拆出的歌手 + 标题里出现过的「已学过歌手名」（最短匹配防误伤）。 */
    private fun playlistArtistKeys(
        name: String?,
        author: String?,
        artistStats: Map<String, ThemePreference>?,
    ): List<String> {
        val keys = TrackKeys.getArtistKeys(author).toMutableList()
        val title = TrackKeys.normalizeText(name)
        if (title.isNotEmpty() && artistStats != null) {
            for (artist in artistStats.keys) {
                if (artist.length < MIN_ARTIST_MATCH_LEN) continue
                if (title.contains(artist)) keys.add(artist)
            }
        }
        return keys
    }

    /** 标题就是被踩雷的曲目、或标题/创建者里出现被拉黑的歌手：这张歌单不再推。 */
    fun isPlaylistBlocked(
        name: String?,
        author: String?,
        blocked: DislikeRules,
    ): Boolean {
        val title = TrackKeys.normalizeText(name)
        if (title.isEmpty()) return false
        if (title in blocked.musicNames) return true
        val authorNormalized = TrackKeys.normalizeText(author)
        for (artist in blocked.singerNames) {
            if (artist.length < MIN_ARTIST_MATCH_LEN) continue
            if (title.contains(artist) || authorNormalized.contains(artist)) return true
        }
        return false
    }

    /** RN playlistIndex.normalizePlaylistKey：`source::id`。 */
    fun normalizePlaylistKey(
        source: String,
        id: String,
    ): String = "$source::$id"

    /**
     * 推荐歌单列表的个性化排序：先剔除踩雷过和被「不感兴趣」隐藏的歌单，
     * 再按「歌名词面 × 歌手先验」降序；因子相同保持音源热度原序，
     * 所以没学过任何口味时等于不过问。
     */
    fun <T> rankPlaylistsByProfile(
        playlists: List<T>,
        nameOf: (T) -> String?,
        authorOf: (T) -> String?,
        keyOf: (T) -> Pair<String, String>?,
        state: PlaylistRankState,
        now: Long,
    ): List<T> {
        val blocked = state.blocked
        val hidden = state.hidden
        var candidates =
            if (blocked != null) {
                playlists.filter { !isPlaylistBlocked(nameOf(it), authorOf(it), blocked) }
            } else {
                playlists.toList()
            }
        if (hidden != null) {
            candidates =
                candidates.filter { playlist ->
                    val key = keyOf(playlist) ?: return@filter true
                    !hidden.containsKey(normalizePlaylistKey(key.first, key.second))
                }
        }
        val scored =
            candidates
                .mapIndexed { index, item ->
                    Triple(item, index, nameOf(item) to authorOf(item))
                }.map { (item, index, meta) ->
                    val factor =
                        NameTokenFeedback.nameTokenFactor(state.tokenWeights, meta.first, now) *
                            ArtistPrior.artistPriorFactor(
                                state.artistStats,
                                playlistArtistKeys(meta.first, meta.second, state.artistStats),
                                now,
                            )
                    Triple(item, index, factor)
                }
        return scored
            .sortedWith(compareByDescending<Triple<T, Int, Double>> { it.third }.thenBy { it.second })
            .map { it.first }
    }

    /**
     * 歌单分类目录按学习到的口味排序：正反馈分类在前（权重高者优先，
     * 关键词命中做并列裁决），没学过的分类按画像关键词亲和度排中间，
     * 被「不感兴趣」拖累过的分类沉底。语种/场景/心情等普通分组一并参与。
     */
    fun <T> rankPlaylistTags(
        tags: List<T>,
        nameOf: (T) -> String?,
        themes: Map<String, ThemePreference>,
        keywords: List<String> = emptyList(),
        now: Long,
    ): List<T> {
        data class Scored(
            val tag: T,
            val index: Int,
            val net: Double,
            val affinity: Int,
        )

        val scored =
            tags.mapIndexed { index, tag ->
                Scored(
                    tag = tag,
                    index = index,
                    net = ThemeFeedback.themeNetWeight(themes, TrackKeys.normalizeText(nameOf(tag)), now),
                    affinity = keywordHits(keywords, nameOf(tag)),
                )
            }
        val liked =
            scored
                .filter {
                    it.net > 0
                }.sortedWith(compareByDescending<Scored> { it.net }.thenByDescending { it.affinity }.thenBy { it.index })
        val unknown = scored.filter { it.net == 0.0 }.sortedWith(compareByDescending<Scored> { it.affinity }.thenBy { it.index })
        val burned = scored.filter { it.net < 0 }.sortedWith(compareByDescending<Scored> { it.net }.thenBy { it.index })
        return (liked + unknown + burned).map { it.tag }
    }

    /**
     * 推荐 tab 歌单区块的分类挑选：4 轮里 3 轮在学习到正偏好的分类里轮换，
     * 1 轮放开到全目录轮换探索；冷启动没有正偏好分类时全程在全目录里按轮次游走。
     */
    fun <T> pickPlaylistTag(
        tags: List<T>,
        nameOf: (T) -> String?,
        themes: Map<String, ThemePreference>,
        keywords: List<String> = emptyList(),
        rotation: Int = 0,
        now: Long,
    ): T? {
        if (tags.isEmpty()) return null
        val ranked = rankPlaylistTags(tags, nameOf, themes, keywords, now)
        val preferred =
            ranked.filter {
                ThemeFeedback.themeNetWeight(themes, TrackKeys.normalizeText(nameOf(it)), now) > 0
            }
        val spin = Math.abs(rotation)
        return if (preferred.isNotEmpty() && Math.floorMod(rotation, 4) != 3) {
            preferred[Math.floorMod(spin, preferred.size)]
        } else {
            ranked[Math.floorMod(spin, ranked.size)]
        }
    }
}
