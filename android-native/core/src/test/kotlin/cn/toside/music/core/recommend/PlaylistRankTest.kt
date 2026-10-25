package cn.toside.music.core.recommend

import cn.toside.music.core.songlist.Fixtures
import cn.toside.music.core.songlist.KwSonglist
import cn.toside.music.core.songlist.PlaylistItem
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 三个重排函数 + 分类挑选 + 取样 —— 对照 RN tests/recommend-algorithm.mts
 * 「推荐 tab 两个新区块」段（:1798-1986）逐条移植的黄金测试。
 */
class PlaylistRankTest {
    private val tabNow = 1_700_000_000_000L

    private fun freshTheme(
        positive: Number,
        negative: Number = 0,
    ) = ThemePreference(
        themeId = "",
        positiveWeight = positive.toDouble(),
        negativeWeight = negative.toDouble(),
        lastDecayTime = tabNow,
        lastUsedTime = tabNow,
    )

    data class Track(
        val name: String?,
        val singer: String?,
    )

    data class Playlist(
        val id: String,
        val name: String? = null,
        val author: String? = null,
        val source: String? = null,
    )

    private fun rankTracks(
        tracks: List<Track>,
        state: ProfileFactorState,
    ): List<Track> =
        PlaylistRank.rankTracksByProfile(
            tracks,
            nameOf = { it.name },
            singerOf = { it.singer },
            state = state,
            now = tabNow,
        )

    private fun rankPlaylists(
        playlists: List<Playlist>,
        state: PlaylistRankState,
    ): List<Playlist> =
        PlaylistRank.rankPlaylistsByProfile(
            playlists,
            nameOf = { it.name },
            authorOf = { it.author },
            keyOf = { if (it.source != null) it.source to it.id else null },
            state = state,
            now = tabNow,
        )

    private fun rankTags(
        tags: List<Pair<String, String>>,
        themes: Map<String, ThemePreference>,
        keywords: List<String> = emptyList(),
    ): List<Pair<String, String>> =
        PlaylistRank.rankPlaylistTags(
            tags,
            nameOf = { it.second },
            themes = themes,
            keywords = keywords,
            now = tabNow,
        )

    // ---------- rankTracksByProfile（对照 RN :1850-1865） ----------

    @Test
    fun newSongsKeepChartOrderColdAndFollowLearnedArtists() {
        val tracks =
            listOf(
                Track("早春境", "张三"),
                Track("晚风起", "李四"),
                Track("海与你", "王五"),
            )
        assertEquals("no profile must not reorder the board", tracks, rankTracks(tracks, ProfileFactorState()))

        val loved = rankTracks(tracks, ProfileFactorState(artistStats = mapOf("李四" to freshTheme(2))))
        assertEquals("李四", loved[0].singer)
        assertEquals("untouched tracks keep their board order", listOf(tracks[0], tracks[2]), loved.drop(1))

        val burned = rankTracks(tracks, ProfileFactorState(artistStats = mapOf("张三" to freshTheme(0, 2))))
        assertEquals("a burnt artist must sink to the bottom", "张三", burned[2].singer)
    }

    // ---------- rankPlaylistTags（对照 RN :1867-1899） ----------

    @Test
    fun playlistCategoriesRankLearnedPositiveFirstAndDemoteDisliked() {
        val tags = listOf("1" to "流行", "2" to "古风", "3" to "说唱", "4" to "电子")
        assertEquals("cold start keeps the source catalog order", tags, rankTags(tags, emptyMap()))

        val ranked =
            rankTags(
                tags,
                mapOf("古风" to freshTheme(1.2), "流行" to freshTheme(3), "说唱" to freshTheme(0, 2)),
            )
        assertEquals(listOf("流行", "古风", "电子", "说唱"), ranked.map { it.second })
    }

    @Test
    fun playlistCategoriesRideLearnedKeywordsNotJustExplicitFeedback() {
        val tags = listOf("1" to "流行", "2" to "粤语", "3" to "民谣")
        assertEquals("粤语", rankTags(tags, emptyMap(), listOf("粤语"))[0].second)

        val ranked = rankTags(tags, mapOf("民谣" to freshTheme(1)), listOf("粤语"))
        assertEquals("民谣", ranked[0].second)
        assertEquals("粤语", ranked[1].second)
    }

    @Test
    fun everyCategoryGroupOfSourceCatalogIsEligible() {
        val catalog =
            listOf(
                "a1" to "华语",
                "a2" to "治愈",
                "a3" to "推荐歌单",
                "a4" to "精品歌单",
                "a5" to "古风",
            )
        assertEquals(
            "no category may be dropped from the catalog",
            listOf("a1", "a2", "a3", "a4", "a5"),
            rankTags(catalog, emptyMap()).map { it.first },
        )
        val liked = rankTags(catalog, mapOf("治愈" to freshTheme(2)))
        assertEquals("a taste learned on a plain category group must be able to lead", "a2", liked[0].first)
    }

    // ---------- pickPlaylistTag（对照 RN :1901-1919） ----------

    @Test
    fun curatedCategoryRotatesAcrossWholeCatalog() {
        val catalog = listOf("b1" to "推荐", "b2" to "华语", "b3" to "治愈")
        val pick = { rotation: Int, themes: Map<String, ThemePreference> ->
            val tag =
                PlaylistRank.pickPlaylistTag(
                    catalog,
                    nameOf = { it.second },
                    themes = themes,
                    rotation = rotation,
                    now = tabNow,
                )
            requireNotNull(tag).first
        }
        assertEquals("b1", pick(0, emptyMap()))
        assertEquals("b2", pick(1, emptyMap()))
        assertEquals("b3", pick(2, emptyMap()))

        val themes = mapOf("治愈" to freshTheme(2))
        assertEquals("b3", pick(0, themes))
        assertEquals("b3", pick(1, themes))
        assertEquals("b3", pick(3, themes))
        assertEquals("探索轮（rotation%4==3）在全目录轮换", "b2", pick(11, themes))
    }

    @Test
    fun emptyCatalogReturnsNull() {
        assertNull(
            PlaylistRank.pickPlaylistTag(emptyList(), nameOf = { null }, themes = emptyMap(), now = tabNow),
        )
    }

    // ---------- rankPlaylistsByProfile（对照 RN :1921-1952） ----------

    @Test
    fun recommendedPlaylistsFollowLearnedTasteAndNeverShowBlacklisted() {
        val playlists =
            listOf(
                Playlist("p1", "民谣手札：老狼与城市", "街声音乐"),
                Playlist("p2", "陈奕迅·港乐黄金年代", "环球音乐"),
                Playlist("p3", "深夜电音派", "酷狗音乐"),
            )
        assertEquals("cold start keeps the source hotness order", playlists, rankPlaylists(playlists, PlaylistRankState()))

        val ranked =
            rankPlaylists(
                playlists,
                PlaylistRankState(
                    tokenWeights = mapOf("民谣" to freshTheme(1.5)),
                    artistStats = mapOf("陈奕迅" to freshTheme(0, 2)),
                ),
            )
        assertEquals("a learned-positive word in the title must lead", "p1", ranked[0].id)
        assertEquals("an artist the user keeps skipping must sink even in the title", "p2", ranked[2].id)

        val blocked = DislikeRules(names = emptySet(), musicNames = emptySet(), singerNames = setOf("陈奕迅"))
        assertEquals(
            "a blacklisted artist named in the title removes the playlist",
            listOf("p1", "p3"),
            rankPlaylists(playlists, PlaylistRankState(blocked = blocked)).map { it.id },
        )
    }

    @Test
    fun playlistsMarkedNotInterestedNeverComeBack() {
        val playlists =
            listOf(
                Playlist("p1", "民谣手札：老狼与城市", "街声音乐", source = "kw"),
                Playlist("p2", "深夜电音派", "酷狗音乐", source = "kw"),
                Playlist("p3", "粤语金曲", "官方账号", source = "tx"),
            )
        val ranked =
            rankPlaylists(
                playlists,
                PlaylistRankState(hidden = mapOf("kw::p1" to tabNow, "tx::p3" to tabNow)),
            )
        assertEquals(listOf("p2"), ranked.map { it.id })
    }

    @Test
    fun blockedTitleHitsMusicNameBlocklistAndSingleCharArtistDoesNotOverreach() {
        val blocked =
            DislikeRules(
                names = emptySet(),
                musicNames = setOf("深夜电音派"),
                singerNames = setOf("阿"),
            )
        val playlists =
            listOf(
                Playlist("p1", "深夜电音派", "dj 小明"),
                Playlist("p2", "阿黛尔精选", "官方"),
            )
        val ranked = rankPlaylists(playlists, PlaylistRankState(blocked = blocked))
        assertEquals("歌名黑名单整单剔除；单字歌手不误伤标题", listOf("p2"), ranked.map { it.id })
    }

    // ---------- keywordHits / normalizePlaylistKey ----------

    @Test
    fun keywordHitCountAndPlaylistKey() {
        assertEquals(2, PlaylistRank.keywordHits(listOf("国风", "民谣"), "国风民谣精选"))
        assertEquals(0, PlaylistRank.keywordHits(listOf("国风"), null))
        assertEquals(0, PlaylistRank.keywordHits(emptyList(), "国风"))
        assertEquals("kw::p1", PlaylistRank.normalizePlaylistKey("kw", "p1"))
    }

    // ---------- pickCardPlaylists（对照 RN :1954-1964） ----------

    @Test
    fun playlistCardRefreshesInsidePersonalizedTopBand() {
        val ranked = (0 until 30).map { "p$it" }
        assertEquals(
            listOf("p0", "p1", "p2", "p3", "p4", "p5"),
            RecommendSampling.pickCardPlaylists(ranked, 6) { 0.0 },
        )
        val later = RecommendSampling.pickCardPlaylists(ranked, 6) { 0.999 }
        assertEquals(
            "refresh must show a different batch",
            listOf("p6", "p7", "p8", "p9", "p10", "p11"),
            later,
        )
        assertTrue("sampling must stay in the top band, never the tail", later.all { it.drop(1).toInt() < 12 })

        assertEquals(6, RecommendSampling.pickCardPlaylists(ranked, 6) { 0.5 }.size)
        assertEquals(
            "候选不足一屏时全给，不硬凑",
            listOf("p0", "p1", "p2", "p3"),
            RecommendSampling.pickCardPlaylists(ranked.take(4), 6) { 0.5 },
        )
    }

    // ---------- pickNewSongBoard 带画像版（对照 RN :1808-1848） ----------

    private data class Board(
        val id: String,
        override val name: String,
    ) : RecommendSampling.RecommendBoardLike

    @Test
    fun newSongBoardPrefersFreshDegradesToRisingNeverClaimsHot() {
        val hot = Board("kw__16", "热歌榜")
        val fresh = Board("kw__17", "新歌榜")
        val rising = Board("kw__93", "飙升榜")
        assertEquals("kw__17", RecommendSampling.pickNewSongBoard(listOf(hot, fresh, rising))?.id)
        assertEquals("kw__93", RecommendSampling.pickNewSongBoard(listOf(hot, rising))?.id)
        assertNull(RecommendSampling.pickNewSongBoard(listOf(hot)))
        assertNull(RecommendSampling.pickNewSongBoard(emptyList()))
        assertEquals("tx__27", RecommendSampling.pickNewSongBoard(listOf(Board("tx__27", "New Songs")))?.id)
        val kgBoards =
            listOf(
                Board("kg__8888", "TOP500"),
                Board("kg__33162", "ACG新歌榜"),
                Board("kg__46910", "综艺新歌榜"),
                Board("kg__6666", "飙升榜"),
            )
        assertEquals("kg__46910", RecommendSampling.pickNewSongBoard(kgBoards)?.id)
        assertEquals(
            "kg__7777",
            RecommendSampling.pickNewSongBoard(kgBoards + Board("kg__7777", "新歌榜"))?.id,
        )
    }

    @Test
    fun newSongBoardTargetsLearnedTasteAndRotatesTies() {
        val kwNew = Board("kw__17", "新歌榜")
        val kgFilm = Board("kg__3001", "影视新歌榜")
        val kgACG = Board("kg__33162", "ACG新歌榜")
        assertEquals("kg__3001", RecommendSampling.pickNewSongBoard(listOf(kwNew, kgFilm, kgACG), listOf("影视"))?.id)
        val pair =
            listOf(
                Board("kg__4011", "华语新歌榜"),
                Board("tx__28", "华语新歌榜"),
            )
        assertEquals("kg__4011", RecommendSampling.pickNewSongBoard(pair, listOf("华语"), 0)?.id)
        assertEquals("tx__28", RecommendSampling.pickNewSongBoard(pair, listOf("华语"), 1)?.id)
        assertEquals("kw__17", RecommendSampling.pickNewSongBoard(listOf(kgFilm, kgACG, kwNew), listOf("爵士"))?.id)
        val risingHit =
            RecommendSampling.pickNewSongBoard(
                listOf(
                    Board("kw__16", "热歌榜"),
                    Board("kw__94", "摇滚飙升榜"),
                ),
                listOf("摇滚"),
            )
        assertEquals("关键词在降级带（飙升榜）里同样生效", "kw__94", risingHit?.id)
    }

    // ---------- 真实歌单页 fixture（Wave2 落盘的 kw 热门页，36 张） ----------

    @Test
    fun realSonglistPageKeepsColdOrderAndSurfacesLearnedCreator() =
        runBlocking {
            val page = KwSonglist { Fixtures.text("songlist-kw-list.json") }.getList("new", null, 1)
            assertEquals(36, page.list.size)

            fun ranked(profile: LearnedProfile): List<PlaylistItem> =
                PlaylistRank.rankPlaylistsByProfile(
                    page.list,
                    nameOf = { it.name },
                    authorOf = { it.author },
                    keyOf = { it.source to it.id },
                    state = RecommendProfile.rankState(profile),
                    now = tabNow,
                )
            // 冷启动：空画像等于不过问（同输入同输出）
            assertEquals(
                page.list.map { it.id to it.name },
                ranked(LearnedProfile()).map { it.id to it.name },
            )
            // 学过某位创建者：其歌单浮到最前，总数与集合不变
            val target = page.list.first { it.author.isNotBlank() }.author
            val profile = LearnedProfile(artistStats = mapOf(TrackKeys.normalizeText(target) to freshTheme(0.3)))
            val ordered = ranked(profile)
            assertEquals(target, ordered.first().author)
            assertEquals(page.list.size, ordered.size)
            assertEquals(page.list.map { it.id }.toSet(), ordered.map { it.id }.toSet())
        }
}
