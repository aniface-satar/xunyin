package cn.toside.music.core.recommend.radio

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * W5 收口的 JVM 端到端用例：**问卷播种 → 取曲（A/B/C/E 四路）→ 播放 → 喜欢 → 再取曲**。
 *
 * 与 `RadioEngineTest` 的分工：那边钉的是 M2 既有语义（排除集/安全模式/编解码），
 * 这边钉的是本波新开口子的**接线是否正确**——
 * 通道 C/E 的候选能不能真的出现在最终队列里、播种会不会把主题净权写花、
 * 通道 E 拿不到货（MB 超时 / 断网）时链路还能不能走完。
 *
 * MB 的降级本身在 `SimilarArtistTest`（Fake `Io` 抛错）与
 * `SimilarArtistRuntime`（非 2xx/超时返回 null）两处覆盖；这里用「平台只回 A/B」模拟
 * 「E 这一轮什么都没捞到」，验证取曲不因某个通道空手而失败。
 */
class RadioW5EndToEndTest {
    private val now = RadioFixtures.NOW

    private fun info(
        id: String,
        singer: String,
    ): JsonObject = RadioFixtures.musicInfo(id = id, name = "曲目$id", singer = singer)

    /**
     * 四路候选：A 画像歌手、B 歌单、C 探索、E 相似歌手。
     *
     * **每首曲子的歌手都刻意不同**：选择器有「近 8 首同歌手不重复」的间隔约束，
     * 若整个池子共用一个歌手，首轮抽一首之后其余全部被间隔挡掉（这是 M2 既有语义，
     * 本用例不打算复测它）。真实候选池本来就来自多歌手。
     */
    private fun mixedPool(): List<PoolCandidate> {
        val params =
            CandidateBuildParams(
                profile = RadioProfile(seedKeys = setOf("ns:种子__歌手甲"), topArtists = listOf(RadioArtist("歌手甲", 1.0))),
                now = now,
                exclusion = ExclusionContext(),
            )
        val result = mutableListOf<PoolCandidate>()
        result +=
            RadioCandidates.createArtistHitCandidates(
                List(8) { info("a$it", "画像歌手$it") },
                "歌手甲",
                params,
            )
        result +=
            RadioCandidates.createDiscoveryCandidates(
                List(6) { info("c$it", "陌生歌手$it") },
                "日语",
                params,
            )
        result +=
            RadioCandidates.createSimilarArtistCandidates(
                listOf(
                    SimilarArtistContribution(
                        seedArtist = "歌手甲",
                        artistName = "相似一",
                        tracks = List(4) { info("e$it", "相似歌手$it") },
                    ),
                ),
                params,
            )
        val observed =
            ObservedPlaylist(
                id = "kw__pl1",
                source = "kw",
                name = "推荐歌单",
                category = "流行",
                totalTracks = 6,
                trackKeys = List(6) { RadioTrackKeys.buildTrackKey(info("b$it", "歌单歌手$it")) },
                pagesFetched = 1,
                fetchedAt = now,
                confidence = 0.8,
            )
        result +=
            RadioCandidates.createPlaylistCandidates(
                observed,
                List(6) { info("b$it", "歌单歌手$it") },
                params,
                ChannelId.B,
            )
        return result
    }

    private class FakePlatform(
        private val candidates: List<PoolCandidate>,
    ) : RadioPlatform {
        var fetchCount = 0

        override suspend fun buildProfile(): RadioProfile =
            RadioProfile(
                seedKeys = setOf("ns:种子__歌手甲"),
                seeds = listOf(RadioSeed("ns:种子__歌手甲", 1.0, RadioFixtures.musicInfo("seed", "种子", "歌手甲"), "歌手甲")),
                topArtists = listOf(RadioArtist("歌手甲", 1.0)),
            )

        override suspend fun buildExclusion(): ExclusionContext = ExclusionContext()

        override suspend fun fetchCandidates(
            reason: String,
            budget: Int,
            rotation: Int,
            now: Long,
        ): RadioFetchResult {
            fetchCount += 1
            return RadioFetchResult(candidates = candidates, requests = 1, reasons = listOf("fake:$reason"))
        }

        override fun pendingItems(): List<RecommendQueueItem> = emptyList()
    }

    private fun engine(platform: RadioPlatform): RadioEngine =
        RadioEngine(
            platform = platform,
            rng = RadioFixtures.seededRandom(20261026),
            now = { now },
            scope = CoroutineScope(Dispatchers.Unconfined),
        )

    @Test
    fun queueCarriesDiscoveryAndSimilarArtistChannels() =
        runBlocking {
            val engine = engine(FakePlatform(mixedPool()))
            engine.startSession(RadioMode.RADIO)
            engine.warmUp(RadioConfig.Queue.TARGET_SIZE)
            val summary = engine.getSummary()
            val share = summary.channelShare

            // 通道 C 是任务 8 新开的，「有货」就等于配额真的分到了它
            assertTrue(
                "C 没有进入最终队列：$share queue=${summary.queueSize} pool=${summary.poolSize} ch=${summary.channels}",
                (share[ChannelId.C] ?: 0.0) > 0.0,
            )
            assertTrue("E 没有进入最终队列：$share", (share[ChannelId.E] ?: 0.0) > 0.0)
            assertTrue("A 没有进入最终队列：$share", (share[ChannelId.A] ?: 0.0) > 0.0)
        }

    @Test
    fun onboardingSeedsSurvivePlayAndLikeRoundTrip() =
        runBlocking {
            val engine = engine(FakePlatform(mixedPool()))
            engine.applyOnboarding(mapOf("zh" to 100.0, "western" to 0.0), now)
            engine.startSession(RadioMode.RADIO)
            engine.warmUp(RadioConfig.Queue.TARGET_SIZE)

            val first = engine.getRecommendations(5).first()
            val beforeLike = engine.state.themeWeights
            engine.onMusicToggled(first.musicInfo)
            engine.onLiked(first.musicInfo)

            // 喜欢会改主题净权/词面权重，但问卷播种的那份分量不能被冲掉
            val zhKey =
                cn.toside.music.core.recommend.TrackKeys
                    .normalizeText("华语")
            assertTrue("华语播种丢了", (engine.state.themeWeights[zhKey]?.positiveWeight ?: 0.0) >= 4.0)
            assertTrue(
                engine.state.themeWeights.keys
                    .containsAll(beforeLike.keys),
            )

            // 再取曲：链路还能继续出歌（喜欢的那首已被排除，靠补充刷新续上）
            val more = engine.getRecommendations(3)
            assertTrue("再取曲没有拿到候选", more.isNotEmpty())
        }

    @Test
    fun emptySimilarArtistChannelDoesNotBreakFetch() =
        runBlocking {
            // 只有 A/B：模拟 MB 超时后 E 空手，其余通道照常供货
            val params =
                CandidateBuildParams(
                    profile = RadioProfile(seedKeys = setOf("ns:种子__歌手甲"), topArtists = listOf(RadioArtist("歌手甲", 1.0))),
                    now = now,
                    exclusion = ExclusionContext(),
                )
            val onlyAB =
                RadioCandidates.createArtistHitCandidates(List(20) { info("a$it", "歌手甲") }, "歌手甲", params)
            val engine = engine(FakePlatform(onlyAB))
            engine.startSession(RadioMode.RADIO)
            val size = engine.warmUp(RadioConfig.Queue.TARGET_SIZE)

            assertTrue(size > 0)
            assertEquals(0.0, engine.getSummary().channelShare[ChannelId.E] ?: 0.0, 1e-9)
            assertEquals(0.0, engine.getSummary().channelShare[ChannelId.C] ?: 0.0, 1e-9)
        }
}
