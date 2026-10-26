package cn.toside.music.core.recommend.m3

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 相似歌手通道 E 的纯逻辑 —— 对照 RN `core/recommend/similarArtist.ts`。 */
class SimilarArtistTest {
    private fun json(text: String) = Json.parseToJsonElement(text)

    private val searchBody =
        json(
            """
            {"artists":[
              {"id":"mbid-1","name":"周杰倫","aliases":[{"name":"Jay Chou"}],"tags":[{"name":"mandopop"}]},
              {"id":"mbid-2","name":"Other","aliases":[],"tags":[]}
            ]}
            """.trimIndent(),
        )

    private val lbBody =
        json(
            """
            [
              {"artist_mbid":"a","name":"A1","score":10},
              {"artist_mbid":"a","name":"A1 dup","score":0.5},
              {"artist_mbid":"b","name":"B","score":30},
              {"artist_mbid":"","name":"bad","score":99},
              {"artist_mbid":"c","name":"C","score":"oops"}
            ]
            """.trimIndent(),
        )

    @Test
    fun `MB 搜索取第一条 缺 id 或 name 视为无结果`() {
        val artist = SimilarArtist.parseMusicBrainzArtistSearch(searchBody)
        assertEquals("mbid-1", artist?.mbid)
        assertEquals("周杰倫", artist?.name)
        assertEquals(listOf("Jay Chou"), artist?.aliases)
        assertEquals(listOf("mandopop"), artist?.tags)

        assertNull(SimilarArtist.parseMusicBrainzArtistSearch(json("""{"artists":[]}""")))
        assertNull(SimilarArtist.parseMusicBrainzArtistSearch(json("""{"artists":[{"name":"x"}]}""")))
        assertNull(SimilarArtist.parseMusicBrainzArtistSearch(null))
    }

    @Test
    fun `MB 反查响应就是艺人本体`() {
        val artist = SimilarArtist.parseMusicBrainzArtistLookup(json("""{"id":"m1","name":"Jay","aliases":["周杰伦"]}"""))
        assertEquals("m1", artist?.mbid)
        assertEquals(listOf("周杰伦"), artist?.aliases)
    }

    @Test
    fun `LB 相似歌手按 mbid 去重取最高分再降序`() {
        val entries = SimilarArtist.parseListenBrainzSimilar(lbBody)
        assertEquals(listOf("b", "a", "c"), entries.map { it.mbid })
        assertEquals(10.0, entries.first { it.mbid == "a" }.score, 1e-9)
        // 非数字分数按 0 处理，不丢条目
        assertEquals(0.0, entries.first { it.mbid == "c" }.score, 1e-9)
        assertTrue(SimilarArtist.parseListenBrainzSimilar(json("""{"x":1}""")).isEmpty())
    }

    @Test
    fun `MB 语种标签只在唯一时采信`() {
        assertEquals(LangBucket.ZH, SimilarArtist.inferArtistLangFromTags(listOf("Mandopop")))
        assertEquals(LangBucket.YUE, SimilarArtist.inferArtistLangFromTags(listOf("cantopop", "cantonese")))
        // 多语种并列不硬判
        assertNull(SimilarArtist.inferArtistLangFromTags(listOf("mandopop", "j-pop")))
        assertNull(SimilarArtist.inferArtistLangFromTags(listOf("trip hop")))
    }

    @Test
    fun `缓存整理 TTL byArtist 容量与 pending 免 TTL`() {
        val now = 10_000_000_000L
        val raw =
            json(
                """
                {
                  "byArtist": {
                    "fresh": {"similar":[{"mbid":"a","name":"A","score":1}],"source":"musicbrainz+listenbrainz","fetchedAt":${now - 1000},"nextIndex":1},
                    "stale": {"similar":[{"mbid":"b","name":"B","score":1}],"fetchedAt":${now - 100_000_000_000},"nextIndex":0}
                  },
                  "pending": {
                    "midway": {"seedArtist":"midway","stage":"songs","pending":["X"],"createdAt":1,"updatedAt":2},
                    "done": {"seedArtist":"done","stage":"done","createdAt":1,"updatedAt":2},
                    "noStage": {"seedArtist":"noStage"}
                  }
                }
                """.trimIndent(),
            )
        val cache = SimilarArtist.normalizeCache(raw, now, SimilarArtist.Policy(cacheTtlMs = 30L * 24 * 3600 * 1000))
        assertTrue(cache.byArtist.containsKey("fresh"))
        // TTL 过期直接丢
        assertTrue(!cache.byArtist.containsKey("stale"))
        assertTrue(cache.pending.containsKey("midway"))
        // done 与形状不认识的任务都不留
        assertTrue(!cache.pending.containsKey("done"))
        assertTrue(!cache.pending.containsKey("noStage"))

        assertTrue(SimilarArtist.normalizeCache(null, now).byArtist.isEmpty())
        assertTrue(SimilarArtist.normalizeCache(json("""[1,2,3]"""), now).pending.isEmpty())
    }

    @Test
    fun `byArtist 超容量按 fetchedAt 留最新`() {
        val now = 10_000_000_000L
        val cache =
            SimilarArtist.normalizeCache(
                json(
                    """
                    {"byArtist":{
                      "old":{"similar":[{"mbid":"a","name":"A","score":1}],"fetchedAt":${now - 5000}},
                      "new":{"similar":[{"mbid":"b","name":"B","score":1}],"fetchedAt":${now - 1000}}
                    }}
                    """.trimIndent(),
                ),
                now,
                SimilarArtist.Policy(cacheLimit = 1),
            )
        assertEquals(setOf("new"), cache.byArtist.keys)
    }

    @Test
    fun `四阶段状态机 遇错也是完成`() {
        var task = SimilarArtist.createTask("周杰伦", now = 100L)
        assertEquals(SimilarArtist.Stage.SEARCH, task.stage)
        val search = SimilarArtist.nextAction(task) as SimilarArtist.Action.MbSearch
        assertEquals("周杰伦", search.query)

        task = SimilarArtist.applyOutcome(task, search, SimilarArtist.Outcome.MbSearched(null), 200L)
        assertEquals(SimilarArtist.Stage.DONE, task.stage)

        task = SimilarArtist.createTask("周杰伦", now = 100L)
        task =
            SimilarArtist.applyOutcome(
                task,
                search,
                SimilarArtist.Outcome.MbSearched(SimilarArtist.MbArtistSummary("m1", "周杰倫", emptyList(), emptyList())),
                200L,
            )
        assertEquals(SimilarArtist.Stage.SIMILAR, task.stage)
        assertEquals("m1", task.seedMbid)

        val similar = SimilarArtist.nextAction(task) as SimilarArtist.Action.LbSimilar
        task =
            SimilarArtist.applyOutcome(
                task,
                similar,
                SimilarArtist.Outcome.LbSimilared(
                    listOf(
                        SimilarArtist.SimilarEntry("a", "A", 5.0),
                        SimilarArtist.SimilarEntry("b", "B", 9.0),
                    ),
                ),
                300L,
            )
        assertEquals(SimilarArtist.Stage.ALIASES, task.stage)
        assertEquals(listOf("b", "a"), task.similar.map { it.mbid })

        val alias = SimilarArtist.nextAction(task, aliasLookups = 1) as SimilarArtist.Action.MbAlias
        assertEquals("b", alias.mbid)
        task =
            SimilarArtist.applyOutcome(
                task,
                alias,
                SimilarArtist.Outcome.MbAliased(SimilarArtist.MbArtistSummary("b2", "B canonical", emptyList(), emptyList())),
                400L,
                aliasLookups = 1,
            )
        assertEquals(SimilarArtist.Stage.SONGS, task.stage)
        assertEquals(listOf("B canonical"), task.pending)

        val songs = SimilarArtist.nextAction(task) as SimilarArtist.Action.KgSongs
        assertEquals("B canonical", songs.artist)
        task = SimilarArtist.applyOutcome(task, songs, SimilarArtist.Outcome.KgSongsDone, 500L)
        assertEquals(SimilarArtist.Stage.DONE, task.stage)
    }

    @Test
    fun `LB 无结果直接完成且记录为空`() {
        var task = SimilarArtist.createTask("x", 0L)
        val artist = SimilarArtist.MbArtistSummary("m", "X", emptyList(), emptyList())
        val searched = SimilarArtist.Action.MbSearch("x", "x")
        task = SimilarArtist.applyOutcome(task, searched, SimilarArtist.Outcome.MbSearched(artist), 1L)
        val similar = SimilarArtist.Action.LbSimilar("x", "m")
        task = SimilarArtist.applyOutcome(task, similar, SimilarArtist.Outcome.LbSimilared(emptyList()), 2L)
        assertEquals(SimilarArtist.Stage.DONE, task.stage)
        val record = SimilarArtist.completeTask(task, 3L)
        assertEquals(SimilarArtist.SOURCE_EMPTY, record.source)
        assertEquals(0L, record.songsFetchedAt)
    }

    @Test
    fun `种子轮换跳过已缓存与在途`() {
        val cache =
            SimilarArtist.Cache(
                byArtist = mapOf("a" to SimilarArtist.Record(fetchedAt = 1L)),
                pending = mapOf("b" to SimilarArtist.createTask("b", 1L)),
            )
        val picked = SimilarArtist.pickSeed(listOf("a", "b", "c"), cache, cursor = 0)
        assertEquals("c", picked?.seedArtist)
        assertEquals(0, picked?.nextCursor)
        assertNull(SimilarArtist.pickSeed(emptyList(), cache, 0))
        assertNull(SimilarArtist.pickSeed(listOf("a", "b"), cache, 0))
    }

    @Test
    fun `缓存搜歌按轮换位推进`() {
        val record =
            SimilarArtist.Record(
                similar =
                    listOf(
                        SimilarArtist.SimilarEntry("1", "A", 0.0),
                        SimilarArtist.SimilarEntry("2", "B", 0.0),
                        SimilarArtist.SimilarEntry("3", "C", 0.0),
                    ),
                fetchedAt = 1L,
                nextIndex = 2,
            )
        val plan = SimilarArtist.planCachedSongFetches(record, 2)
        assertEquals(listOf("C", "A"), plan.names)
        assertEquals(1, plan.nextIndex)
        assertEquals(emptyList<String>(), SimilarArtist.planCachedSongFetches(record, 0).names)
    }

    @Test
    fun `冷却期内的缓存歌手不再花请求`() {
        val now = 1_000_000L
        val cache =
            SimilarArtist.Cache(
                byArtist =
                    mapOf(
                        "hot" to
                            SimilarArtist.Record(
                                similar = listOf(SimilarArtist.SimilarEntry("1", "A", 0.0)),
                                fetchedAt = now,
                                songsFetchedAt = now - 1000,
                            ),
                        "cold" to
                            SimilarArtist.Record(
                                similar = listOf(SimilarArtist.SimilarEntry("2", "B", 0.0)),
                                fetchedAt = now,
                                songsFetchedAt = now - 100_000,
                            ),
                    ),
            )
        assertEquals("cold", SimilarArtist.pickCachedRecord(cache, now, cooldownMs = 60_000))
        assertEquals("cold", SimilarArtist.pickCachedRecord(cache, now, cooldownMs = 1))
    }

    @Test
    fun `预算内跑完整条链路并产出搜歌结果`() {
        val calls = mutableListOf<String>()
        val io =
            object : SimilarArtist.Io<String> {
                override suspend fun mbSearch(name: String): SimilarArtist.MbArtistSummary {
                    calls.add("mb_search")
                    return SimilarArtist.MbArtistSummary("m1", "周杰倫", emptyList(), listOf("mandopop"))
                }

                override suspend fun lbSimilar(mbid: String): List<SimilarArtist.SimilarEntry> {
                    calls.add("lb_similar")
                    return listOf(SimilarArtist.SimilarEntry("a", "A", 1.0))
                }

                override suspend fun mbLookup(mbid: String): SimilarArtist.MbArtistSummary {
                    calls.add("mb_alias")
                    return SimilarArtist.MbArtistSummary("a2", "A canonical", emptyList(), emptyList())
                }

                override suspend fun kgSongs(name: String): List<String> {
                    calls.add("kg_songs")
                    return listOf("track-of-$name")
                }
            }
        val facts = mutableListOf<String>()
        val result =
            runBlocking {
                SimilarArtist.runRefresh(
                    SimilarArtist.RefreshInput(
                        cache = SimilarArtist.Cache(),
                        seedArtists = listOf("周杰伦"),
                        seedCursor = 0,
                        startNewSeed = true,
                        budget = 10,
                        now = 1000L,
                        policy = SimilarArtist.Policy(aliasLookups = 1, songFetchesPerRun = 0),
                        onArtistFacts = { facts.add(it.name) },
                    ),
                    io,
                )
            }
        assertEquals(listOf("mb_search", "lb_similar", "mb_alias", "kg_songs"), calls)
        assertEquals(4, result.requests)
        assertEquals(1, result.songs.size)
        assertEquals(listOf("track-of-A canonical"), result.songs.first().tracks)
        assertEquals("周杰伦", result.songs.first().seedArtist)
        // MB 艺人事实回灌给 L3 歌手语言表：种子与反查到的规范名各一条
        assertEquals(listOf("周杰倫", "A canonical"), facts)
        val record = result.cache.byArtist.getValue("周杰伦")
        assertEquals(SimilarArtist.SOURCE_MB_LB, record.source)
        assertTrue(result.cache.pending.isEmpty())
        assertTrue(result.reasons.contains("similar_artist_seed:周杰伦"))
    }

    @Test
    fun `MB 失败静默降级 不抛错也不产歌`() {
        val io =
            object : SimilarArtist.Io<String> {
                override suspend fun mbSearch(name: String): SimilarArtist.MbArtistSummary = throw IllegalStateException("timeout")

                override suspend fun lbSimilar(mbid: String): List<SimilarArtist.SimilarEntry> = emptyList()

                override suspend fun mbLookup(mbid: String): SimilarArtist.MbArtistSummary = throw IllegalStateException("timeout")

                override suspend fun kgSongs(name: String): List<String> = emptyList()
            }
        val result =
            runBlocking {
                SimilarArtist.runRefresh(
                    SimilarArtist.RefreshInput(
                        cache = SimilarArtist.Cache(),
                        seedArtists = listOf("周杰伦"),
                        seedCursor = 0,
                        startNewSeed = true,
                        budget = 4,
                        now = 1000L,
                    ),
                    io,
                )
            }
        assertTrue(result.songs.isEmpty())
        assertTrue(result.reasons.contains("similar_artist_mb_search_failed"))
        // 在途任务保住了：下次刷新还从 search 阶段续跑，不会白丢一位种子
        val stuck = result.cache.pending.getValue("周杰伦")
        assertEquals(SimilarArtist.Stage.SEARCH, stuck.stage)
    }

    @Test
    fun `搜歌失败也推进 不让一个名字卡死链路`() {
        val cache =
            SimilarArtist.Cache(
                pending =
                    mapOf(
                        "seed" to
                            SimilarArtist.Task(
                                seedArtist = "seed",
                                stage = SimilarArtist.Stage.SONGS,
                                pending = listOf("X", "Y"),
                                createdAt = 1L,
                                updatedAt = 1L,
                            ),
                    ),
            )
        val io =
            object : SimilarArtist.Io<String> {
                override suspend fun mbSearch(name: String): SimilarArtist.MbArtistSummary? = null

                override suspend fun lbSimilar(mbid: String): List<SimilarArtist.SimilarEntry> = emptyList()

                override suspend fun mbLookup(mbid: String): SimilarArtist.MbArtistSummary? = null

                override suspend fun kgSongs(name: String): List<String> = throw IllegalStateException("boom")
            }
        val result =
            runBlocking {
                SimilarArtist.runRefresh(
                    SimilarArtist.RefreshInput(
                        cache = cache,
                        seedArtists = emptyList(),
                        seedCursor = 0,
                        startNewSeed = false,
                        budget = 4,
                        now = 10L,
                    ),
                    io,
                )
            }
        assertTrue(result.reasons.contains("similar_artist_kg_songs_failed"))
        val task = result.cache.pending.getValue("seed")
        // Y 被推到队首，下次继续
        assertEquals(listOf("Y"), task.pending)
    }

    @Test
    fun `没有在途任务时按冷却轮换用缓存搜歌`() {
        val now = 100_000L
        val cache =
            SimilarArtist.Cache(
                byArtist =
                    mapOf(
                        "seed" to
                            SimilarArtist.Record(
                                similar =
                                    listOf(
                                        SimilarArtist.SimilarEntry("1", "A", 0.0),
                                        SimilarArtist.SimilarEntry("2", "B", 0.0),
                                    ),
                                fetchedAt = 1L,
                                nextIndex = 0,
                                songsFetchedAt = 0L,
                            ),
                    ),
            )
        val fetched = mutableListOf<String>()
        val io =
            object : SimilarArtist.Io<String> {
                override suspend fun mbSearch(name: String): SimilarArtist.MbArtistSummary? = null

                override suspend fun lbSimilar(mbid: String): List<SimilarArtist.SimilarEntry> = emptyList()

                override suspend fun mbLookup(mbid: String): SimilarArtist.MbArtistSummary? = null

                override suspend fun kgSongs(name: String): List<String> {
                    fetched.add(name)
                    return listOf("t-$name")
                }
            }
        val result =
            runBlocking {
                SimilarArtist.runRefresh(
                    SimilarArtist.RefreshInput(
                        cache = cache,
                        seedArtists = emptyList(),
                        seedCursor = 0,
                        startNewSeed = false,
                        budget = 4,
                        now = now,
                        policy = SimilarArtist.Policy(songFetchesPerRun = 2, cacheReuseCooldownMs = 1000L),
                    ),
                    io,
                )
            }
        assertEquals(listOf("A", "B"), fetched)
        assertEquals(2, result.songs.size)
        val seeded = result.cache.byArtist.getValue("seed")
        assertEquals(now, seeded.songsFetchedAt)
        assertEquals(0, seeded.nextIndex)
    }
}
