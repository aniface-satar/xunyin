package cn.toside.music.core.recommend.radio

import cn.toside.music.core.recommend.TrackKeys
import cn.toside.music.core.recommend.m3.LangBucket
import cn.toside.music.core.recommend.m3.LangLevel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * 候选构建时的语种落位（任务 1 的供给端）。
 *
 * 三条真实构建路径（画像歌手直采 / 歌单 / 探索补货）都要把 `lang` 写进 `PoolCandidate`，
 * 否则 MMR 的语言项与语种硬配额在真机上等于没接。
 */
class RadioCandidatesLangTest {
    private val now = RadioFixtures.NOW
    private val profile = RadioProfile(seedKeys = setOf("ns:种子__歌手"), topArtists = listOf(RadioArtist("歌手", 1.0)))

    private fun params(artistLang: ArtistLangLookup? = null) =
        CandidateBuildParams(profile = profile, now = now, exclusion = ExclusionContext(), artistLang = artistLang)

    private fun info(
        id: String,
        name: String,
        singer: String,
        source: String = "kw",
        lang: String? = null,
    ) = RadioFixtures.musicInfo(id = id, name = name, singer = singer, source = source, lang = lang)

    private fun observed(
        id: String = "kw__pl1",
        category: String? = null,
    ) = ObservedPlaylist(
        id = id,
        source = "kw",
        name = "歌单",
        category = category,
        totalTracks = 1,
        pagesFetched = 1,
        fetchedAt = now,
        confidence = 0.8,
    )

    @Test
    fun `画像直采候选带 kg 逐曲语种`() {
        val created =
            RadioCandidates.createArtistHitCandidates(
                listOf(info("a1", "曲目", "歌手", source = "kg", lang = "国语")),
                "歌手",
                params(),
            )
        assertEquals(LangBucket.ZH, created.single().lang)
        assertEquals(LangLevel.FIELD, created.single().langLevel)
    }

    @Test
    fun `歌单分类是语种词时整批带 L2 提示`() {
        val created =
            RadioCandidates.createPlaylistCandidates(
                observed(category = "华语"),
                // 纯拉丁标题/歌手：没有提示时四级链判不出，能命中就证明走的是 L2
                listOf(info("b1", "Song A", "Singer A")),
                params(),
                ChannelId.B,
            )
        assertEquals(LangBucket.ZH, created.single().lang)
        assertEquals(LangLevel.HINT, created.single().langLevel)
        assertEquals(LangBucket.ZH, created.single().langHint)
    }

    @Test
    fun `分类不是语种词时不硬贴提示`() {
        // 「华语说唱」是分类名不是语种名，不做子串匹配；纯拉丁曲目应保持判不出
        val created =
            RadioCandidates.createPlaylistCandidates(
                observed(category = "华语说唱"),
                listOf(info("b1", "Song A", "Singer A")),
                params(),
                ChannelId.B,
            )
        assertNull(created.single().lang)
        assertEquals(LangLevel.NONE, created.single().langLevel)
        assertNull(created.single().langHint)
    }

    @Test
    fun `歌手语言表命中 L3`() {
        // 键口径与 getArtistKeys 一致（归一化）；app 侧 ArtistLangStore.lookup 负责兼容旧的原样键
        val table = mapOf(TrackKeys.normalizeText("Singer A") to LangBucket.KO)
        val created =
            RadioCandidates.createPlaylistCandidates(
                observed(),
                listOf(info("b1", "Song A", "Singer A")),
                params(artistLang = { table[it] }),
                ChannelId.B,
            )
        assertEquals(LangBucket.KO, created.single().lang)
        assertEquals(LangLevel.ARTIST, created.single().langLevel)
    }

    @Test
    fun `字面统计命中 L4`() {
        val created =
            RadioCandidates.createArtistHitCandidates(
                listOf(info("a1", "晴天", "周杰伦")),
                "周杰伦",
                params(),
            )
        assertEquals(LangBucket.ZH, created.single().lang)
        assertEquals(LangLevel.SCRIPT, created.single().langLevel)
    }

    @Test
    fun `四级都判不出时候选 lang 为空`() {
        val created =
            RadioCandidates.createArtistHitCandidates(
                listOf(info("a1", "Track 01", "")),
                "歌手",
                params(),
            )
        assertNull(created.single().lang)
        assertEquals(LangLevel.NONE, created.single().langLevel)
    }

    @Test
    fun `探索补货的批次提示直接来自问卷语种桶`() {
        val created =
            RadioCandidates.createDiscoveryCandidates(
                listOf(info("c1", "Song A", "Singer A")),
                "欧美",
                params(),
                ChannelId.C,
                langHint = LangBucket.EN,
            )
        assertEquals(LangBucket.EN, created.single().lang)
        assertEquals(LangLevel.HINT, created.single().langLevel)
    }

    @Test
    fun `合并时保留语种事实并优先较新的一份`() {
        val prev =
            RadioPool.createCandidate(
                CreatePoolCandidateInput(
                    musicInfo = info("m1", "Song A", "Singer A"),
                    channel = ChannelId.B,
                    sourceId = "pl",
                    now = now,
                    langHint = LangBucket.JA,
                ),
            )
        val incoming =
            RadioPool.createCandidate(
                CreatePoolCandidateInput(
                    musicInfo = info("m1", "Song A", "Singer A", source = "kg", lang = "国语"),
                    channel = ChannelId.A,
                    sourceId = "artist",
                    now = now + 1,
                ),
            )
        val merged = RadioPool.mergeCandidates(listOf(prev), listOf(incoming)).single()
        assertEquals(LangBucket.ZH, merged.lang)
        assertEquals(LangLevel.FIELD, merged.langLevel)
        // langHint 取先出现的那个（提示来自更可信的批次）
        assertEquals(LangBucket.JA, merged.langHint)
        assertEquals(listOf(ChannelId.B, ChannelId.A).toSet(), merged.channels.toSet())
    }
}
