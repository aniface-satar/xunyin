package cn.toside.music.core.recommend.radio

import cn.toside.music.core.recommend.m3.LangBucket
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 池子按语种配额裁剪（任务 3，W5-2 的后半）。
 *
 * 规则与 RN `capPoolSize` 一致：综合分降序 → 逐首收集、超配额桶进 overflow →
 * 最后用 overflow 按分数补满。**淘汰顺序是分数最低的先出**，不是 FIFO：
 * 池子要留的是「下次生成队列最可能用得上」的候选，不是最后抓回来的那批。
 */
class RadioPoolLangCapTest {
    private val now = RadioFixtures.NOW

    /** 池内候选没有独立 id 字段：用例里用 `musicInfo.id` 指认，直接比 `trackKey` 会撞上 `ns:曲目__歌手` 形状。 */
    private fun PoolCandidate.id(): String = musicInfo.stringField("id").orEmpty()

    private fun candidate(
        id: String,
        lang: LangBucket,
        affinity: Double,
        addedAt: Long = now,
    ): PoolCandidate =
        RadioPool.createCandidate(
            CreatePoolCandidateInput(
                musicInfo = RadioFixtures.musicInfo(id = id, name = "曲目$id", singer = "歌手$id"),
                channel = ChannelId.A,
                sourceId = "test",
                now = addedAt,
                affinity = affinity,
                langHint = lang,
            ),
        )

    @Test
    fun `超配额语种的候选先被淘汰`() {
        val candidates =
            listOf(
                candidate("zh1", LangBucket.ZH, 0.9),
                candidate("zh2", LangBucket.ZH, 0.8),
                candidate("zh3", LangBucket.ZH, 0.7),
                candidate("zh4", LangBucket.ZH, 0.6),
                candidate("en1", LangBucket.EN, 0.5),
                candidate("en2", LangBucket.EN, 0.4),
            )
        val kept =
            RadioPool.capPoolSize(
                candidates,
                maxSize = 4,
                capOptions = PoolCapOptions(limits = mapOf(LangBucket.ZH to 2, LangBucket.EN to 2)),
            )
        assertEquals(4, kept.size)
        assertEquals(2, kept.count { it.lang == LangBucket.ZH })
        assertEquals(2, kept.count { it.lang == LangBucket.EN })
        // 分数最高的两首 ZH 留下，低分的两首出池
        assertEquals(setOf("zh1", "zh2"), kept.filter { it.lang == LangBucket.ZH }.map { it.id() }.toSet())
    }

    @Test
    fun `淘汰看分数不看入库时间`() {
        // 旧的高分候选必须留下来：简单 FIFO 会把它先淘汰掉
        val candidates =
            listOf(
                candidate("old-high", LangBucket.ZH, 0.9, addedAt = now - 10_000),
                candidate("new-low", LangBucket.ZH, 0.1, addedAt = now),
                candidate("en1", LangBucket.EN, 0.5),
            )
        val kept =
            RadioPool.capPoolSize(
                candidates,
                maxSize = 2,
                capOptions = PoolCapOptions(limits = mapOf(LangBucket.ZH to 1, LangBucket.EN to 1)),
            )
        assertEquals(setOf("old-high", "en1"), kept.map { it.id() }.toSet())
    }

    @Test
    fun `限额卡不住时用超配额候选补满`() {
        // 宁多几首华语也不让池子空着（RN 同）
        val candidates = (1..5).map { candidate("zh$it", LangBucket.ZH, 0.9 - it * 0.1) }
        val kept =
            RadioPool.capPoolSize(
                candidates,
                maxSize = 4,
                capOptions = PoolCapOptions(limits = mapOf(LangBucket.ZH to 2)),
            )
        assertEquals(4, kept.size)
    }

    @Test
    fun `没有语种上限时退回纯分数裁剪`() {
        val candidates =
            listOf(
                candidate("zh1", LangBucket.ZH, 0.9),
                candidate("zh2", LangBucket.ZH, 0.8),
                candidate("zh3", LangBucket.ZH, 0.7),
            )
        val kept = RadioPool.capPoolSize(candidates, maxSize = 2, capOptions = PoolCapOptions())
        assertEquals(listOf("zh1", "zh2"), kept.map { it.id() })
    }

    @Test
    fun `池子没满时不淘汰`() {
        val candidates = (1..3).map { candidate("zh$it", LangBucket.ZH, 0.5) }
        val kept =
            RadioPool.capPoolSize(
                candidates,
                maxSize = 10,
                capOptions = PoolCapOptions(limits = mapOf(LangBucket.ZH to 1)),
            )
        assertEquals(3, kept.size)
    }

    @Test
    fun `默认桶判定优先用 lang 再退 langHint`() {
        val withLang =
            PoolCandidate(
                trackKey = "k1",
                musicInfo = RadioFixtures.musicInfo("k1", "Song", "Singer"),
                lang = LangBucket.JA,
                langHint = LangBucket.ZH,
            )
        val hintOnly =
            PoolCandidate(
                trackKey = "k2",
                musicInfo = RadioFixtures.musicInfo("k2", "Song 2", "Singer 2"),
                langHint = LangBucket.KO,
            )
        val kept =
            RadioPool.capPoolSize(
                listOf(withLang, hintOnly),
                maxSize = 1,
                capOptions = PoolCapOptions(limits = mapOf(LangBucket.JA to 1, LangBucket.KO to 1)),
            )
        assertEquals(listOf("k1"), kept.map { it.id() })
    }
}
