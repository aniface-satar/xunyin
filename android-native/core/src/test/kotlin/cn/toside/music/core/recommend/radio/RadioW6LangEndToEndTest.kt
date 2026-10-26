package cn.toside.music.core.recommend.radio

import cn.toside.music.core.recommend.m3.LangBucket
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Wave6 语种供给 + M3 选曲的端到端用例（FakePlatform + 固定种子）。
 *
 * 与 `RadioW5EndToEndTest` 的分工：那边锁「C/E 通道能不能出歌」，
 * 这边锁「语种字段真的流到了选曲器，配额真的改变了队列分布」。
 */
class RadioW6LangEndToEndTest {
    private val now = RadioFixtures.NOW

    private fun candidate(
        id: String,
        langWord: String,
        artist: String = "歌手$id",
    ): PoolCandidate =
        RadioPool.createCandidate(
            CreatePoolCandidateInput(
                musicInfo =
                    RadioFixtures.musicInfo(
                        id = id,
                        name = "曲目$id",
                        singer = artist,
                        source = "kg",
                        lang = langWord,
                    ),
                channel = ChannelId.A,
                sourceId = "test",
                now = now,
                affinity = 0.5,
            ),
        )

    private class FakePlatform(
        private val candidates: List<PoolCandidate>,
        private val pending: List<RecommendQueueItem> = emptyList(),
    ) : RadioPlatform {
        override suspend fun buildProfile(): RadioProfile =
            RadioProfile(
                seedKeys = setOf("ns:种子__歌手"),
                seeds = listOf(RadioSeed("ns:种子__歌手", 1.0, RadioFixtures.musicInfo("seed", "种子", "歌手"), "歌手")),
                topArtists = listOf(RadioArtist("歌手", 1.0)),
            )

        override suspend fun buildExclusion(): ExclusionContext = ExclusionContext()

        override suspend fun fetchCandidates(
            reason: String,
            budget: Int,
            rotation: Int,
            now: Long,
        ): RadioFetchResult = RadioFetchResult(candidates = candidates, requests = 1, reasons = listOf("fake:$reason"))

        override fun pendingItems(): List<RecommendQueueItem> = pending
    }

    private fun engine(platform: RadioPlatform): RadioEngine =
        RadioEngine(
            platform = platform,
            rng = RadioFixtures.seededRandom(20261026),
            now = { now },
            scope = CoroutineScope(Dispatchers.Unconfined),
        )

    @Test
    fun `问卷华语 100 且其它语种 0 时队列华语不少于八成`() =
        runBlocking {
            // 供给以华语为主、夹杂少量其它语种：这是「想要 100% 华语」用户的真实池子形状。
            // 连播硬规则（同语种最多 2 首）会周期性地让其它语种插一首，所以配额保证的是
            // 「上限」而不是「下限」——用例守的是 80% 这条可兑现的下界。
            val pool =
                (0 until 40).map { candidate("zh$it", "国语") } +
                    (0 until 4).map { candidate("en$it", "英语") }
            val engine = engine(FakePlatform(pool))
            engine.applyOnboarding(mapOf("zh" to 100.0, "western" to 0.0), now)
            engine.startSession(RadioMode.RADIO)
            engine.warmUp(RadioConfig.Queue.TARGET_SIZE)
            val queue = engine.peekQueue(RadioConfig.Queue.TARGET_SIZE)
            assertEquals(RadioConfig.Queue.TARGET_SIZE, queue.size)
            val zh =
                queue.count { item ->
                    cn.toside.music.core.recommend.m3.Language.mapKgLanguageWord(
                        CandidateLang.langField(item.musicInfo),
                    ) == LangBucket.ZH
                }
            assertTrue("华语占比不足八成：$zh/${queue.size}", zh * 10 >= queue.size * 8)
        }

    @Test
    fun `历史项也带语种`() =
        runBlocking {
            val pending =
                listOf(
                    RecommendQueueItem(
                        musicInfo = RadioFixtures.musicInfo("h1", "曲目一", "歌手一", source = "kg", lang = "日语"),
                        channel = ChannelId.A,
                    ),
                    RecommendQueueItem(
                        musicInfo = RadioFixtures.musicInfo("h2", "曲目二", "歌手二", source = "kg", lang = "英语"),
                        channel = ChannelId.A,
                    ),
                )
            val engine = engine(FakePlatform(emptyList(), pending))
            engine.startSession(RadioMode.RADIO)
            val recent = engine.buildRecentSelectionItems()
            assertEquals(2, recent.size)
            assertEquals(listOf(LangBucket.JA, LangBucket.EN), recent.map { it.lang })
            assertEquals(listOf(1, 1), recent.map { it.langLevel })
        }

    @Test
    fun `选曲降级原因落到 RadioSummary`() =
        runBlocking {
            // 问卷明确不要华语，但池子里只有华语：只能放弃配额，原因必须能被看到
            val pool = (0 until 10).map { candidate("zh$it", "国语") }
            val engine = engine(FakePlatform(pool))
            engine.applyOnboarding(mapOf("zh" to 0.0), now)
            engine.startSession(RadioMode.RADIO)
            engine.warmUp(RadioConfig.Queue.TARGET_SIZE)
            val reasons = engine.getSummary().reasons
            assertTrue("降级原因没有进 summary：$reasons", reasons.contains("lang_quota_relaxed"))
        }

    @Test
    fun `池内没有目标语种时记录 lang_unmet`() =
        runBlocking {
            val pool = (0 until 10).map { candidate("en$it", "英语") }
            val engine = engine(FakePlatform(pool))
            engine.applyOnboarding(mapOf("zh" to 100.0, "western" to 0.0), now)
            engine.startSession(RadioMode.RADIO)
            engine.warmUp(RadioConfig.Queue.TARGET_SIZE)
            val reasons = engine.getSummary().reasons
            assertTrue("供给不足没有单独记账：$reasons", reasons.contains("lang_unmet:zh"))
        }
}
