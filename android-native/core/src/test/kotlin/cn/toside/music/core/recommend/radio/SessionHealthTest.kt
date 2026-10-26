package cn.toside.music.core.recommend.radio

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** 会话健康度与安全模式（RN `sessionHealth.ts`）单元测试。 */
class SessionHealthTest {
    private val now = RadioFixtures.NOW

    private fun session(vararg tracks: SessionTrack): SessionPreference =
        SessionPreference(recentTracks = tracks.toList(), recentChannels = tracks.mapNotNull { it.channel })

    @Test
    fun emptySessionIsHealthy() {
        val health = SessionHealthLogic.compute(SessionPreference(), emptySet())
        assertEquals(0, health.negativeStreak)
        assertEquals(0, health.sampleSize)
        assertEquals(1.0, health.explorationFactor, 1e-9)
        assertEquals(false, health.safeMode)
    }

    @Test
    fun incompletePlaysCountAsNegativeStreak() {
        // ratio 0.2 < NEGATIVE_LISTEN_RATIO(0.3) → 负反馈
        val health =
            SessionHealthLogic.compute(
                session(
                    RadioFixtures.sessionTrack("a", ratio = 0.2),
                    RadioFixtures.sessionTrack("b", ratio = 0.1),
                ),
                emptySet(),
            )
        assertEquals(2, health.negativeStreak)
        assertTrue("连续 $RadioConfig.SessionHealth.STREAK_THRESHOLD 首即安全模式", health.safeMode)
        assertEquals(2, health.sampleSize)
    }

    @Test
    fun likedTrackBreaksNegativeStreak() {
        val health =
            SessionHealthLogic.compute(
                session(
                    RadioFixtures.sessionTrack("a", liked = true),
                    RadioFixtures.sessionTrack("b", ratio = 0.1),
                ),
                emptySet(),
            )
        assertEquals(0, health.negativeStreak)
        assertEquals(false, health.safeMode)
    }

    @Test
    fun explicitDislikeCountsAsNegative() {
        val health =
            SessionHealthLogic.compute(
                session(RadioFixtures.sessionTrack("a")),
                setOf("a"),
            )
        assertEquals(1, health.negativeStreak)
        assertEquals(1.0, health.negativeRate, 1e-9)
    }

    @Test
    fun negativeRateMapsLinearlyToExplorationFactor() {
        assertEquals(1.0, SessionHealthLogic.mapNegativeRateToFactor(0.2), 1e-9)
        assertEquals(1.0, SessionHealthLogic.mapNegativeRateToFactor(0.34), 1e-9)
        assertEquals(RadioConfig.SessionHealth.EXPLORATION_FACTOR_FLOOR, SessionHealthLogic.mapNegativeRateToFactor(0.8), 1e-9)
        val middle = SessionHealthLogic.mapNegativeRateToFactor(0.5)
        assertTrue(middle in RadioConfig.SessionHealth.EXPLORATION_FACTOR_FLOOR..1.0)
    }

    @Test
    fun penaltiesDecayByRecencyAndCap() {
        val penalties =
            SessionHealthLogic.buildPenalties(
                session(
                    RadioFixtures.sessionTrack("a", ratio = 0.1, artistKeys = listOf("x")),
                    RadioFixtures.sessionTrack("b", ratio = 0.1, artistKeys = listOf("x")),
                    RadioFixtures.sessionTrack("c", ratio = 0.1, artistKeys = listOf("y"), playlistId = "pl"),
                ),
                emptySet(),
            )
        // 越新权重越大：index 0 权重 1，index 1 权重 0.85
        assertEquals(1.85, penalties.artistPenalty.getValue("x"), 1e-9)
        assertEquals(0.7225, penalties.artistPenalty.getValue("y"), 1e-9)
        assertEquals(0.7225, penalties.playlistPenalty.getValue("pl"), 1e-9)
    }

    @Test
    fun penaltyScoreCombinesArtistAndPlaylist() {
        val penalties = SessionPenalties(artistPenalty = mapOf("x" to 2.0), playlistPenalty = mapOf("pl" to 1.0))
        val score = SessionHealthLogic.penaltyScore(listOf("x"), listOf("pl"), penalties)
        assertEquals(
            2.0 * RadioConfig.SessionHealth.ARTIST_PENALTY_WEIGHT + 1.0 * RadioConfig.SessionHealth.PLAYLIST_PENALTY_WEIGHT,
            score,
            1e-9,
        )
        assertEquals(0.0, SessionHealthLogic.penaltyScore(listOf("x"), null, null), 1e-9)
        assertTrue(SessionHealthLogic.penaltyFactor(score) < 1.0)
    }

    @Test
    fun deferThresholdFollowsPenaltyScore() {
        val strong = SessionPenalties(artistPenalty = mapOf("x" to RadioConfig.SessionHealth.PENALTY_CAP), playlistPenalty = emptyMap())
        assertTrue(SessionHealthLogic.shouldDeferQueuedItem(listOf("x"), null, strong))
        assertTrue(!SessionHealthLogic.shouldDeferQueuedItem(listOf("other"), null, strong))
    }

    @Test
    fun explorationIsCappedInRadioAndFreeInExplore() {
        val radio = SessionHealthLogic.resolveExploration(RadioMode.RADIO, 1.5, 0)
        assertEquals(RadioConfig.RadioExploration.FACTOR_CAP, radio.explorationFactor, 1e-9)
        assertEquals(RadioConfig.RadioExploration.GAP, radio.explorationGap)

        val explore = SessionHealthLogic.resolveExploration(RadioMode.EXPLORE, 1.5, 0)
        assertEquals(1.5, explore.explorationFactor, 1e-9)
        assertEquals(0, explore.explorationGap)
    }

    @Test
    fun healthWindowKeepsOnlyLatestTracks() {
        val tracks = List(RadioConfig.SessionHealth.WINDOW + 5) { RadioFixtures.sessionTrack("t$it", ratio = 0.9) }
        val health = SessionHealthLogic.compute(SessionPreference(recentTracks = tracks), emptySet())
        assertEquals(RadioConfig.SessionHealth.WINDOW, health.sampleSize)
    }
}
