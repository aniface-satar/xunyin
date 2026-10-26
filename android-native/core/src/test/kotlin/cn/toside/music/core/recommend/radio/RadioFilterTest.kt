package cn.toside.music.core.recommend.radio

import cn.toside.music.core.recommend.DislikeRules
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 候选排除判定（RN `filter.ts`）单元测试：五类键判重 + 三种显式屏蔽。 */
class RadioFilterTest {
    private fun info(
        name: String,
        singer: String,
    ) = RadioFixtures.musicInfo(id = "id-$name", name = name, singer = singer)

    @Test
    fun cleanTrackHasNoExclusionReason() {
        assertNull(RadioFilter.getExclusionReason(info("晴天", "周杰伦"), ExclusionContext()))
    }

    @Test
    fun libraryKeyBlocksTrack() {
        val track = info("晴天", "周杰伦")
        val key = RadioTrackKeys.buildTrackKey(track)
        val ctx = ExclusionContext(libraryKeys = setOf(key))
        assertEquals(ExclusionReason.LIBRARY, RadioFilter.getExclusionReason(track, ctx))
    }

    @Test
    fun libraryPairKeyCatchesTypographicVariant() {
        val track = info("晴天 (Live)", "周杰伦")
        val ctx = ExclusionContext(libraryPairKeys = setOf(RadioTrackKeys.exactPairKey("晴天 (Live)", "周杰伦")))
        assertEquals(ExclusionReason.LIBRARY, RadioFilter.getExclusionReason(track, ctx))
    }

    @Test
    fun dislikedQueuedSessionAndRecentKeysEachBlock() {
        val track = info("稻香", "周杰伦")
        val key = RadioTrackKeys.buildTrackKey(track)
        assertEquals(
            ExclusionReason.DISLIKED,
            RadioFilter.getExclusionReason(track, ExclusionContext(dislikedTrackKeys = setOf(key))),
        )
        assertEquals(
            ExclusionReason.QUEUED,
            RadioFilter.getExclusionReason(track, ExclusionContext(queuedTrackKeys = setOf(key))),
        )
        assertEquals(
            ExclusionReason.SESSION_PLAYED,
            RadioFilter.getExclusionReason(track, ExclusionContext(sessionTrackKeys = setOf(key))),
        )
        assertEquals(
            ExclusionReason.RECENT_RADIO_7D,
            RadioFilter.getExclusionReason(track, ExclusionContext(recentRadioTrackKeys = setOf(key))),
        )
    }

    @Test
    fun blockedSongArtistAndPairAreDistinguished() {
        val track = info("晴天", "周杰伦")
        val songRule = DislikeRules(names = emptySet(), musicNames = setOf("晴天"), singerNames = emptySet())
        assertEquals(
            ExclusionReason.BLOCKED_SONG,
            RadioFilter.getExclusionReason(track, ExclusionContext(blocked = songRule)),
        )
        val artistRule = DislikeRules(names = emptySet(), musicNames = emptySet(), singerNames = setOf("周杰伦"))
        assertEquals(
            ExclusionReason.BLOCKED_ARTIST,
            RadioFilter.getExclusionReason(track, ExclusionContext(blocked = artistRule)),
        )
        val pairRule = DislikeRules(names = setOf("晴天@周杰伦"), musicNames = emptySet(), singerNames = emptySet())
        assertEquals(
            ExclusionReason.BLOCKED_PAIR,
            RadioFilter.getExclusionReason(track, ExclusionContext(blocked = pairRule)),
        )
    }

    @Test
    fun blockedArtistMatchesAnyOfMultipleSingers() {
        val track = info("合唱曲", "周杰伦、方文山")
        val rule = DislikeRules(names = emptySet(), musicNames = emptySet(), singerNames = setOf("方文山"))
        assertEquals(
            ExclusionReason.BLOCKED_ARTIST,
            RadioFilter.getExclusionReason(track, ExclusionContext(blocked = rule)),
        )
    }

    @Test
    fun emptyNameNeverMatchesBlockedSong() {
        assertNull(
            RadioFilter.isDislikedByName("", "周杰伦", DislikeRules(names = emptySet(), musicNames = setOf(""), singerNames = emptySet())),
        )
    }

    @Test
    fun isExcludedMirrorsReasonLookup() {
        val track = info("晴天", "周杰伦")
        val key = RadioTrackKeys.buildTrackKey(track)
        assertTrue(RadioFilter.isExcluded(track, ExclusionContext(libraryKeys = setOf(key))))
        assertTrue(!RadioFilter.isExcluded(track, ExclusionContext()))
    }

    @Test
    fun localTrackUsesIdKey() {
        val local = RadioFixtures.musicInfo(id = "42", name = "本地曲", singer = "某人", source = "local")
        val ctx = ExclusionContext(libraryKeys = setOf("local:42"))
        assertEquals(ExclusionReason.LIBRARY, RadioFilter.getExclusionReason(local, ctx))
    }
}
