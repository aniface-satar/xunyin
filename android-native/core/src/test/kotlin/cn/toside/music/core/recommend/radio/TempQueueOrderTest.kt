package cn.toside.music.core.recommend.radio

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** 稍后播放排序（RN `tempQueueOrder.ts`）与安全模式撤队（`queueDeferral.ts`）单元测试。 */
class TempQueueOrderTest {
    @Test
    fun noRadioTrackMeansNoReorder() {
        assertFalse(TempQueueOrder.hasUserTrackAfterRadio(listOf(false, false, false)))
        assertFalse(TempQueueOrder.hasUserTrackAfterRadio(emptyList()))
    }

    @Test
    fun radioTrackBeforeUserTrackNeedsReorder() {
        assertTrue(TempQueueOrder.hasUserTrackAfterRadio(listOf(true, false)))
        assertTrue(TempQueueOrder.hasUserTrackAfterRadio(listOf(true, false, true)))
    }

    @Test
    fun userTracksBeforeRadioTracksNeedNoReorder() {
        assertFalse(TempQueueOrder.hasUserTrackAfterRadio(listOf(false, false, true, true)))
    }

    @Test
    fun deferralPicksPenalizedArtistsOnly() {
        val penalty = SessionPenalties(artistPenalty = mapOf("周杰伦" to RadioConfig.SessionHealth.PENALTY_CAP), playlistPenalty = emptyMap())
        val penalized =
            RecommendQueueItem(
                musicInfo = RadioFixtures.musicInfo(id = "1", name = "晴天", singer = "周杰伦"),
                channel = ChannelId.A,
            )
        val clean =
            RecommendQueueItem(
                musicInfo = RadioFixtures.musicInfo(id = "2", name = "十年", singer = "陈奕迅"),
                channel = ChannelId.A,
            )
        val deferred = RadioDeferral.selectDeferredTrackKeys(listOf(penalized, clean), penalty)
        assertEquals(listOf(RadioTrackKeys.buildTrackKey(penalized.musicInfo)), deferred)
    }

    @Test
    fun deferralSkipsExcludedTrackAndRespectsMax() {
        val penalty = SessionPenalties(artistPenalty = mapOf("周杰伦" to RadioConfig.SessionHealth.PENALTY_CAP), playlistPenalty = emptyMap())
        val items =
            List(5) {
                RecommendQueueItem(
                    musicInfo = RadioFixtures.musicInfo(id = "$it", name = "歌$it", singer = "周杰伦"),
                    channel = ChannelId.A,
                )
            }
        val excludedKey = RadioTrackKeys.buildTrackKey(items.first().musicInfo)
        val deferred = RadioDeferral.selectDeferredTrackKeys(items, penalty, maxDeferrals = 2, excludeTrackKey = excludedKey)
        assertEquals(2, deferred.size)
        assertFalse(deferred.contains(excludedKey))
    }

    @Test
    fun nullPenaltiesDeferNothing() {
        val items =
            listOf(
                RecommendQueueItem(
                    musicInfo = RadioFixtures.musicInfo(id = "1", name = "晴天", singer = "周杰伦"),
                    channel = ChannelId.A,
                ),
            )
        assertTrue(RadioDeferral.selectDeferredTrackKeys(items, null).isEmpty())
    }
}
