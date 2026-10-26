package cn.toside.music.core.recommend.radio

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 电台主线集成用例（FakePlatform + 锁种子 RNG）。
 *
 * 覆盖任务书验收的「取曲 → 播放 → 喜欢/不感兴趣 → 再取曲」整条链路，
 * 以及会话健康（连续早切进安全模式）与状态编解码往返。
 */
class RadioEngineTest {
    private val now = RadioFixtures.NOW

    private fun pool(size: Int = 30): List<PoolCandidate> =
        List(size) { index ->
            RadioPool.createCandidate(
                CreatePoolCandidateInput(
                    musicInfo =
                        RadioFixtures.musicInfo(
                            id = "id-$index",
                            name = "电台曲$index",
                            singer = "歌手$index",
                        ),
                    channel = if (index % 3 == 0) ChannelId.B else ChannelId.A,
                    sourceId = "fake",
                    now = now,
                    playlistIds = listOf("pl-$index"),
                    affinity = 0.4 + (index % 5) * 0.1,
                ),
            )
        }

    private class FakePlatform(
        private var candidates: List<PoolCandidate>,
    ) : RadioPlatform {
        var fetchCount = 0
        var profileCount = 0
        val removedTracks = mutableListOf<String>()

        override suspend fun buildProfile(): RadioProfile {
            profileCount += 1
            return RadioProfile(
                seedKeys = setOf("ns:种子__歌手"),
                seeds = listOf(RadioSeed("ns:种子__歌手", 1.0, RadioFixtures.musicInfo("seed", "种子", "歌手"), "歌手")),
                topArtists = listOf(RadioArtist("歌手", 1.0)),
            )
        }

        override suspend fun buildExclusion(): ExclusionContext = ExclusionContext()

        override suspend fun fetchCandidates(
            reason: String,
            budget: Int,
            rotation: Int,
            now: Long,
        ): RadioFetchResult {
            fetchCount += 1
            // 每次都回同一份池子：验证的是引擎侧的排除集，不是假平台自己去重
            return RadioFetchResult(candidates = candidates, requests = 1, reasons = listOf("fake:$reason"))
        }

        override fun pendingItems(): List<RecommendQueueItem> = emptyList()

        override fun onTrackRemoved(trackKey: String) {
            removedTracks.add(trackKey)
        }
    }

    private fun engine(platform: RadioPlatform): RadioEngine =
        RadioEngine(
            platform = platform,
            rng = RadioFixtures.seededRandom(2026),
            now = { now },
            scope = CoroutineScope(Dispatchers.Unconfined),
        )

    @Test
    fun warmUpFetchesPoolAndBuildsQueue() =
        runBlocking {
            val platform = FakePlatform(pool())
            val engine = engine(platform)
            engine.startSession(RadioMode.RADIO)
            val size = engine.warmUp(20)
            assertEquals(20, size)
            assertEquals(1, platform.fetchCount)
            assertTrue(engine.getSummary().queueSize > 0)
        }

    @Test
    fun recommendationsAreConsumedFromQueue() =
        runBlocking {
            val platform = FakePlatform(pool())
            val engine = engine(platform)
            engine.startSession(RadioMode.RADIO)
            engine.warmUp(10)
            val first = engine.getRecommendations(3)
            assertEquals(3, first.size)
            assertEquals("队列必须前进", 7, engine.getQueueSize())
            // 同一批不重复
            assertEquals(first.size, first.map { RadioTrackKeys.buildTrackKey(it.musicInfo) }.distinct().size)
        }

    @Test
    fun playingTrackStartsSessionAndDislikeExcludesItFromLaterFetches() =
        runBlocking {
            val platform = FakePlatform(pool())
            val engine = engine(platform)
            engine.startSession(RadioMode.RADIO)
            engine.warmUp(10)
            val first = engine.getRecommendations(5)
            val target = first.first()
            val key = RadioTrackKeys.buildTrackKey(target.musicInfo)

            engine.onMusicToggled(target.musicInfo)
            assertEquals(1, engine.state.session.recentTracks.size)
            assertEquals(
                key,
                engine.state.session.recentTracks
                    .first()
                    .trackKey,
            )

            engine.onDislikedInfo(target.musicInfo.text("name").orEmpty(), target.musicInfo.text("singer").orEmpty())
            assertTrue(engine.state.dislikedTracks.containsKey(key))
            assertTrue("候选池里的同曲应立即剔除", engine.state.candidateCache.none { it.trackKey == key })

            // 抽干队列后重新取曲：刷新回来的候选必须被排除集挡掉
            engine.getRecommendations(RadioConfig.Queue.TARGET_SIZE * 2)
            val later = engine.getRecommendations(RadioConfig.Queue.TARGET_SIZE * 2)
            assertFalse(later.any { RadioTrackKeys.buildTrackKey(it.musicInfo) == key })
            assertTrue(platform.fetchCount >= 1)
        }

    @Test
    fun repeatedToggleOfSameTrackDoesNotDuplicateSession() =
        runBlocking {
            val platform = FakePlatform(pool())
            val engine = engine(platform)
            engine.startSession(RadioMode.RADIO)
            engine.warmUp(5)
            val track = engine.getRecommendations(1).first()
            engine.onMusicToggled(track.musicInfo)
            engine.onMusicToggled(track.musicInfo)
            assertEquals(1, engine.state.session.recentTracks.size)
        }

    @Test
    fun likeBoostsChannelBanditAndTrackPreference() =
        runBlocking {
            val platform = FakePlatform(pool())
            val engine = engine(platform)
            engine.startSession(RadioMode.RADIO)
            engine.warmUp(5)
            val track = engine.getRecommendations(1).first()
            engine.onMusicToggled(track.musicInfo)
            engine.onLiked(track.musicInfo)
            val key = RadioTrackKeys.buildTrackKey(track.musicInfo)
            assertTrue(
                engine.state.tracks
                    .getValue(key)
                    .likeCount >= 1,
            )
            assertTrue(engine.state.channelBandit.isNotEmpty())
        }

    @Test
    fun consecutiveEarlySkipsEnterSafeMode() =
        runBlocking {
            val platform = FakePlatform(pool(60))
            val engine = engine(platform)
            engine.startSession(RadioMode.RADIO)
            engine.warmUp(20)
            val tracks = engine.getRecommendations(4)
            for (track in tracks.take(RadioConfig.SessionHealth.STREAK_THRESHOLD)) {
                engine.onMusicToggled(track.musicInfo)
                engine.observePlayback(positionMs = 2_000, playing = true, durationMs = 200_000)
                engine.finishCurrent(PlayEndReason.USER_NEXT, positionMs = 2_000, durationMs = 200_000)
            }
            val health = engine.getSummary().sessionHealth
            assertEquals(RadioConfig.SessionHealth.STREAK_THRESHOLD, health.negativeStreak)
            assertTrue(health.safeMode)
            assertTrue(health.explorationFactor <= 1.0)
        }

    @Test
    fun switchingModeResetsSession() =
        runBlocking {
            val platform = FakePlatform(pool())
            val engine = engine(platform)
            engine.startSession(RadioMode.RADIO)
            engine.warmUp(5)
            engine.onMusicToggled(engine.getRecommendations(1).first().musicInfo)
            assertEquals(1, engine.state.session.recentTracks.size)
            engine.startSession(RadioMode.EXPLORE)
            assertTrue(
                engine.state.session.recentTracks
                    .isEmpty(),
            )
            assertEquals(RadioMode.EXPLORE, engine.getMode())
        }

    @Test
    fun emptyPoolRaisesNoCandidates() =
        runBlocking {
            val platform = FakePlatform(emptyList())
            val engine = engine(platform)
            engine.startSession(RadioMode.RADIO)
            val error = runCatching { engine.warmUp(5) }.exceptionOrNull()
            assertEquals("no_candidates", error?.message)
        }

    @Test
    fun stateSurvivesCodecRoundTrip() =
        runBlocking {
            val platform = FakePlatform(pool())
            val engine = engine(platform)
            engine.startSession(RadioMode.RADIO)
            engine.warmUp(5)
            val track = engine.getRecommendations(1).first()
            engine.onMusicToggled(track.musicInfo)
            engine.onDislikedInfo(track.musicInfo.text("name").orEmpty(), track.musicInfo.text("singer").orEmpty())

            val restored = RadioStateCodec.decode(RadioStateCodec.encode(engine.state))
            assertEquals(engine.state.dislikedTracks.keys, restored?.dislikedTracks?.keys)
            assertEquals(engine.state.session.recentTracks.size, restored?.session?.recentTracks?.size)
        }

    private fun JsonObject.text(key: String): String? = stringField(key)
}
