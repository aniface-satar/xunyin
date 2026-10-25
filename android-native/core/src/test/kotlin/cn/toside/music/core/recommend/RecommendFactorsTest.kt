package cn.toside.music.core.recommend

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 词面级学习 / 歌手先验 / 主题净权 —— 对照 RN tests/recommend-algorithm.mts 的
 * `long-term artist prior decays slowly and bites on repeat offenders`、
 * `learned style tokens feed discovery keywords, negative markers never do` 两段
 * 与 tokenFeedback/artistPrior/feedback 单函数语义。
 */
class RecommendFactorsTest {
    private val now = 1_700_000_000_000L

    private fun freshTheme(
        positive: Double,
        negative: Double = 0.0,
    ) = ThemePreference(
        themeId = "",
        positiveWeight = positive,
        negativeWeight = negative,
        lastDecayTime = now,
        lastUsedTime = now,
    )

    // ---------- artistPriorFactor（对照 RN :1387-1409） ----------

    @Test
    fun repeatOffenderArtistIsDownweightedAboveFloor() {
        val stats = mutableMapOf<String, ThemePreference>()
        repeat(2) { i ->
            ArtistPrior.applyArtistStatsFeedback(stats, listOf("bad-artist"), 0.0, 0.5, now + i * 1000L)
        }
        ArtistPrior.applyArtistStatsFeedback(stats, listOf("bad-artist"), 0.0, 2.0, now + 5000L)
        val badFactor = ArtistPrior.artistPriorFactor(stats, listOf("bad-artist"), now)
        assertTrue("repeat-offender artist must be downweighted, got $badFactor", badFactor < 0.75)
        assertTrue("factor must respect the floor", badFactor >= 0.55)
    }

    @Test
    fun reliableArtistGainsSmallBoostWithinCeiling() {
        val stats = mutableMapOf<String, ThemePreference>()
        repeat(4) { i ->
            ArtistPrior.applyArtistStatsFeedback(stats, listOf("good-artist"), 0.5, 0.0, now + i * 1000L)
        }
        val goodFactor = ArtistPrior.artistPriorFactor(stats, listOf("good-artist"), now)
        assertTrue("reliable artist must gain a small boost, got $goodFactor", goodFactor > 1 && goodFactor <= 1.15)
    }

    @Test
    fun unknownArtistAndNullMapAreNeutralAndWeightCaps() {
        val stats = mutableMapOf<String, ThemePreference>()
        ArtistPrior.applyArtistStatsFeedback(stats, listOf("known"), 1.0, 0.0, now)
        assertEquals(1.0, ArtistPrior.artistPriorFactor(stats, listOf("unknown"), now), 0.0)
        assertEquals(1.0, ArtistPrior.artistPriorFactor(null, listOf("bad"), now), 0.0)
        repeat(30) { i ->
            ArtistPrior.applyArtistStatsFeedback(stats, listOf("capped"), 0.0, 2.0, now + i * 1000L)
        }
        assertEquals(RecommendConfig.artistPrior.maxWeight, stats["capped"]!!.negativeWeight, 0.0)
    }

    @Test
    fun halfLifeSoftensArtistPriorOverTime() {
        val stats = mutableMapOf<String, ThemePreference>()
        ArtistPrior.applyArtistStatsFeedback(stats, listOf("bad-artist"), 0.0, 3.0, now)
        val before = ArtistPrior.artistPriorFactor(stats, listOf("bad-artist"), now)
        val halfLifeMs = (RecommendConfig.artistPrior.halfLifeDays * 86_400_000).toLong()
        val after = ArtistPrior.artistPriorFactor(stats, listOf("bad-artist"), now + halfLifeMs)
        assertTrue("decay must soften the prior over time", after > before)
    }

    // ---------- nameTokenFactor / getLearnedStyleTokens（对照 RN :1442-1463） ----------

    @Test
    fun learnedStyleTokensArePositiveOnlyAndWeightOrdered() {
        val tokens = mutableMapOf<String, ThemePreference>()
        NameTokenFeedback.applyNameTokenFeedback(tokens, listOf("爵士"), 0.25, 0.0, now)
        NameTokenFeedback.applyNameTokenFeedback(tokens, listOf("国风"), 0.5, 0.0, now)
        NameTokenFeedback.applyNameTokenFeedback(tokens, listOf("dj"), 0.0, 0.5, now)
        NameTokenFeedback.applyNameTokenFeedback(tokens, listOf("老歌"), 0.25, 0.0, now)
        val learned = NameTokenFeedback.getLearnedStyleTokens(tokens, 4, now)
        assertEquals(listOf("国风", "爵士", "老歌"), learned)
        assertTrue("skipped markers must never become search keywords", "dj" !in learned)
    }

    @Test
    fun tokenFactorPunishesNegativesHarderThanPositives() {
        val tokens = mutableMapOf<String, ThemePreference>()
        NameTokenFeedback.applyNameTokenFeedback(tokens, listOf("dj"), 0.0, 1.0, now)
        NameTokenFeedback.applyNameTokenFeedback(tokens, listOf("国风"), 1.0, 0.0, now)
        val positive = NameTokenFeedback.nameTokenFactor(tokens, "国风 小夜曲", now)
        val negative = NameTokenFeedback.nameTokenFactor(tokens, "dj 舞曲", now)
        assertTrue(positive > 1.0)
        assertTrue(negative < 1.0)
        // 钳位：floor 0.5 / ceiling 1.25
        assertTrue(positive <= RecommendConfig.nameToken.ceiling)
        assertTrue(negative >= RecommendConfig.nameToken.floor)
    }

    @Test
    fun emptyMapOrUntokenizableNameIsNeutral() {
        assertEquals(1.0, NameTokenFeedback.nameTokenFactor(null, "任意", now), 0.0)
        assertEquals(1.0, NameTokenFeedback.nameTokenFactor(emptyMap(), "任意", now), 0.0)
        val tokens = mutableMapOf<String, ThemePreference>()
        NameTokenFeedback.applyNameTokenFeedback(tokens, listOf("国风"), 1.0, 0.0, now)
        // 中文连续书写无空格：退化切分下保持整段，命不中已学 token → 1
        assertEquals(1.0, NameTokenFeedback.nameTokenFactor(tokens, "国风小夜曲", now), 0.0)
    }

    // ---------- themeNetWeight（feedback.ts M1 子集） ----------

    @Test
    fun themeNetWeightIsPositiveMinusNegativeAndDecays() {
        val themes = mutableMapOf<String, ThemePreference>()
        themes["民谣"] = freshTheme(3.0, 1.0)
        assertEquals(2.0, ThemeFeedback.themeNetWeight(themes, "民谣", now), 1e-9)
        assertEquals(0.0, ThemeFeedback.themeNetWeight(themes, null, now), 1e-9)
        assertEquals(0.0, ThemeFeedback.themeNetWeight(themes, "未知", now), 1e-9)
        val halfLifeMs = (RecommendConfig.themeFeedback.halfLifeDays * 86_400_000).toLong()
        val decayed = ThemeFeedback.themeNetWeight(themes, "民谣", now + halfLifeMs)
        assertTrue("half-life must halve the net weight, got $decayed", decayed < 2.0 && decayed > 0.9)
    }

    @Test
    fun decaySkipsWithinOneMinute() {
        val pref = freshTheme(2.0, 0.0)
        val untouched = ThemeFeedback.decayThemePreference(pref, now + 30_000)
        assertEquals(pref, untouched)
        val decayed = ThemeFeedback.decayThemePreference(pref, now + 120_000)
        assertNotEquals(pref.lastDecayTime, decayed.lastDecayTime)
    }

    // ---------- decayWeight 基点 ----------

    @Test
    fun decayWeightHalvesAtHalfLife() {
        val halfLifeMs = 30.0 * 86_400_000
        assertEquals(0.5, decayWeight(1.0, halfLifeMs.toLong(), 30.0), 1e-9)
        assertEquals(0.0, decayWeight(0.0, 1000L, 30.0), 0.0)
        assertEquals("负流逝按 0 处理", 1.0, decayWeight(1.0, -5000L, 30.0), 1e-9)
    }
}
