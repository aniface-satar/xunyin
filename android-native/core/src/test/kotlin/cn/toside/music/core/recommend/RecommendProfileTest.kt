package cn.toside.music.core.recommend

import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 画像装配 / 持久层 / 信号解析 / 踩雷规则解析的单元测试。
 */
class RecommendProfileTest {
    private val now = 1_700_000_000_000L

    private fun track(
        name: String?,
        singer: String?,
    ) = ProfileTrack(name, singer)

    // ---------- RecommendProfile.build ----------

    @Test
    fun emptyInputProducesEmptyProfile() {
        val profile = RecommendProfile.build(ProfileInput(emptyList(), emptyList(), emptyList()), now)
        assertTrue(profile.artistStats.isEmpty())
        assertTrue(profile.tokenWeights.isEmpty())
        assertTrue(profile.keywords.isEmpty())
        assertNull(RecommendProfile.factorState(profile).artistStats)
    }

    @Test
    fun loveOutweighsUserListAndHistoryAdditively() {
        val profile =
            RecommendProfile.build(
                ProfileInput(
                    loveTracks = listOf(track("晴天", "周杰伦")),
                    userListTracks = listOf(track("七里香", "周杰伦")),
                    playHistory = listOf(ProfileHistoryEntry(track("稻香", "周杰伦"), now)),
                ),
                now = now,
            )
        val jay = profile.artistStats["周杰伦"]!!
        // 3 + 2 + 0.2 = 5.2（同一歌手三路信号累加）
        assertEquals(5.2, jay.positiveWeight, 1e-9)
        assertTrue("周杰伦" in profile.keywords)
    }

    @Test
    fun historyRecencyDecaysWith14DayHalfLife() {
        val twoWeeks = (14.0 * 86_400_000).toLong()
        val profile =
            RecommendProfile.build(
                ProfileInput(
                    loveTracks = emptyList(),
                    userListTracks = emptyList(),
                    playHistory =
                        listOf(
                            ProfileHistoryEntry(track("新歌", "新歌手"), now - 1000),
                            ProfileHistoryEntry(track("旧歌", "旧歌手"), now - twoWeeks * 2),
                        ),
                ),
                now = now,
            )
        val fresh = profile.artistStats["新歌手"]!!.positiveWeight
        val old = profile.artistStats["旧歌手"]!!.positiveWeight
        assertTrue("新近播放权重更高；两个半衰期后仍保留小权重, fresh=$fresh old=$old", fresh > old && old > 0)
        assertTrue(fresh <= 0.2 + 1e-9)
    }

    @Test
    fun strongArtistsFeedKeywordPoolByQuarterRatio() {
        val profile =
            RecommendProfile.build(
                ProfileInput(
                    loveTracks = (1..3).map { track("歌$it", "主力歌手") },
                    userListTracks = listOf(track("歌4", "长尾歌手")),
                    playHistory = emptyList(),
                ),
                now = now,
            )
        assertEquals("主力歌手", profile.keywords.first())
        assertTrue(profile.keywords.indexOf("长尾歌手") != 0)
    }

    @Test
    fun artistSplitFollowsFeatAndComma() {
        val profile =
            RecommendProfile.build(
                ProfileInput(
                    loveTracks = listOf(track("对唱", "A feat. B"), track("合唱", "C、D")),
                    userListTracks = emptyList(),
                    playHistory = emptyList(),
                ),
                now = now,
            )
        assertTrue("a" in profile.artistStats)
        assertTrue("b" in profile.artistStats)
        assertTrue("c" in profile.artistStats)
        assertTrue("d" in profile.artistStats)
    }

    // ---------- LearnedProfile 存取与裁剪 ----------

    @Test
    fun profileRoundTripAndCorruptFallback() {
        val profile =
            RecommendProfile.build(
                ProfileInput(listOf(track("晴天", "周杰伦")), emptyList(), emptyList()),
                now,
            )
        val saved = RecommendProfileStore.save(profile)
        assertEquals(profile, RecommendProfileStore.load(saved))
        assertNull(RecommendProfileStore.load(null))
        assertNull(RecommendProfileStore.load(""))
        assertNull("脏数据按空画像重新装配", RecommendProfileStore.load("not-json{{{"))
    }

    @Test
    fun trimKeepsHighestWeightsWithinLimit() {
        val stats =
            (1..250).associate {
                "tag$it" to ThemePreference("tag$it", it.toDouble(), 0.0, now, now)
            }
        // RN trimState：themeWeightLimit(200) 管 themeWeights/tokenWeights，
        // artistStats 走自己的 artistStatsLimit(800)。这里验 artistStats 的裁剪。
        val trimmed = RecommendProfileStore.trim(LearnedProfile(artistStats = stats), artistStatsLimit = 200)
        assertEquals(200, trimmed.artistStats.size)
        assertTrue("tag250" in trimmed.artistStats)
        assertTrue("tag1" !in trimmed.artistStats)
    }

    @Test
    fun hiddenPlaylistRoundTrip() {
        val hidden = mapOf("kw::p1" to now, "tx::p3" to 5L)
        assertEquals(hidden, RecommendProfileStore.loadHidden(RecommendProfileStore.saveHidden(hidden)))
        assertEquals(emptyMap<String, Long>(), RecommendProfileStore.loadHidden(null))
    }

    // ---------- TrackKeys ----------

    @Test
    fun singerSplitKeepsAcDcAndLatinDuos() {
        assertEquals(listOf("ac/dc"), TrackKeys.getArtistKeys("AC/DC"))
        assertEquals(listOf("simon & garfunkel"), TrackKeys.getArtistKeys("Simon & Garfunkel"))
        assertEquals(listOf("周杰伦", "费玉清"), TrackKeys.getArtistKeys("周杰伦、费玉清"))
        assertEquals(listOf("a", "b"), TrackKeys.getArtistKeys("A feat. B"))
        assertEquals(listOf("周杰伦", "费玉清"), TrackKeys.getArtistKeys("周杰伦/费玉清"))
        assertEquals(emptyList<String>(), TrackKeys.getArtistKeys(null))
        assertEquals(emptyList<String>(), TrackKeys.getArtistKeys("  "))
    }

    @Test
    fun textNormalizationMatchesRn() {
        assertEquals("(live) - remix", TrackKeys.normalizeText("（Live）–Remix"))
        assertEquals("a b c", TrackKeys.normalizeText(" A · B　C "))
        assertEquals("", TrackKeys.normalizeText(null))
    }

    // ---------- DislikeRulesParser ----------

    @Test
    fun dislikeRulesParseThreeForms() {
        val rules = "晴天@周杰伦\n稻香\n@周杰\n"
        val parsed = DislikeRulesParser.parse(rules)
        assertEquals(setOf("晴天@周杰伦"), parsed.names)
        assertEquals(setOf("稻香"), parsed.musicNames)
        assertEquals(setOf("周杰"), parsed.singerNames)
        assertEquals(DislikeRules.EMPTY, DislikeRulesParser.parse(""))
    }

    @Test
    fun dislikeRulesNormalizeLowercase() {
        val parsed = DislikeRulesParser.parse("SUNNY@JAY")
        assertEquals(setOf("sunny@jay"), parsed.names)
    }

    // ---------- ProfileSignals / PlayHistoryParser ----------

    @Test
    fun extractTrackAndPlayHistoryFromJson() {
        val music =
            kotlinx.serialization.json.Json.parseToJsonElement(
                """{"name":"晴天","singer":"周杰伦"}""",
            ) as kotlinx.serialization.json.JsonObject
        val track = ProfileSignals.trackOf(music)
        assertEquals("晴天", track.name)
        assertEquals("周杰伦", track.singer)

        val history =
            """
            [
              {"musicInfo":{"name":"晴天","singer":"周杰伦"},"playTime":${now - 1000}},
              {"musicInfo":{"name":"无时间","singer":"x"}},
              "garbage"
            ]
            """.trimIndent()
        val parsed = PlayHistoryParser.parse(history)
        assertEquals(1, parsed.size)
        assertEquals("晴天", parsed[0].track.name)
        assertEquals(now - 1000, parsed[0].playTime)
        assertEquals(emptyList<ProfileHistoryEntry>(), PlayHistoryParser.parse(null))
    }

    // ---------- ProfileInputAssembler ----------

    private fun music(
        name: String,
        singer: String,
    ) = buildJsonObject {
        put("name", name)
        put("singer", singer)
    }

    @Test
    fun assemblerDedupesLivePlayedAgainstStoredHistory() {
        val stored = listOf(ProfileHistoryEntry(track("晴天", "周杰伦"), now - 5_000))
        val input =
            ProfileInputAssembler.assemble(
                loveTracks = listOf(music("晴天", "周杰伦")),
                userListTracks = listOf(music("稻香", "周杰伦"), music("晴天", "周杰伦")),
                storedHistory = stored,
                livePlayed = listOf(music("晴天", "周杰伦"), music("七里香", "周杰伦")),
                livePlayedAt = now,
            )
        assertEquals(1, input.loveTracks.size)
        assertEquals(2, input.userListTracks.size)
        // 历史里的晴天保留真实时间；实时曲目只补进没见过的七里香
        assertEquals(2, input.playHistory.size)
        assertEquals(now - 5_000, input.playHistory[0].playTime)
        assertEquals("七里香", input.playHistory[1].track.name)
        assertEquals(now, input.playHistory[1].playTime)
    }

    @Test
    fun assemblerCapsHistoryAndIgnoresEmptyLiveEntries() {
        val stored = (1..150).map { ProfileHistoryEntry(track("歌$it", "歌手"), now - it * 1000L) }
        val input =
            ProfileInputAssembler.assemble(
                loveTracks = emptyList(),
                userListTracks = emptyList(),
                storedHistory = stored,
                livePlayed = listOf(music("", ""), music("新歌", "新歌手")),
                livePlayedAt = now,
                historyLimit = 100,
            )
        assertEquals(100, input.playHistory.size)
        val oldest = input.playHistory.first()
        assertEquals("歌1", oldest.track.name)
        // 空曲目被丢弃；上限已满时实时曲目也不再补
        assertEquals(0, input.playHistory.count { it.track.name.isNullOrEmpty() })
        assertEquals(0, input.playHistory.count { it.track.name == "新歌" })
    }

    @Test
    fun assemblerLiveEntriesFillRemainingHistorySlots() {
        val stored = (1..99).map { ProfileHistoryEntry(track("歌$it", "歌手"), now - it * 1000L) }
        val input =
            ProfileInputAssembler.assemble(
                loveTracks = emptyList(),
                userListTracks = emptyList(),
                storedHistory = stored,
                livePlayed = (1..10).map { music("实时$it", "歌手") },
                livePlayedAt = now,
                historyLimit = 100,
            )
        assertEquals(100, input.playHistory.size)
        val newest = input.playHistory.last()
        assertEquals("实时1", newest.track.name)
    }
}
