package cn.toside.music.core.list

import cn.toside.music.core.data.DataRepository
import cn.toside.music.core.storage.InMemoryKvStore
import cn.toside.music.core.storage.ShardedKvStore
import cn.toside.music.core.storage.StorageKeys
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 列表元数据（添加时间 / 播放次数）测试。
 *
 * 对照 RN：`src/utils/data.ts`（存储形状）、`src/core/list.ts#initMusicAddTimeTracker`
 * （加歌/移动写时间戳）、`src/screens/.../ListMusicSort.tsx`（排序用 `${listId}/${musicId}` 读取）。
 */
class MusicStatsStoreTest {
    private fun music(id: String): JsonObject =
        buildJsonObject {
            put("id", id)
            put("name", id)
            put("singer", "s")
            put("source", "kw")
            put("interval", "03:00")
            put(
                "meta",
                buildJsonObject {
                    put("songId", id)
                    put("albumName", "")
                },
            )
        }

    private fun ids(list: List<JsonObject>): List<String> = list.map { (it["id"] as JsonPrimitive).content }

    @Test
    fun stampAddTimesUsesRnKeyShapeAndPersists() =
        runBlocking {
            val backend = InMemoryKvStore()
            val repo = DataRepository(ShardedKvStore(backend))
            val stats = MusicStatsStore(repo)

            stats.stampAddTimes("love", listOf("1", "2"), now = 1_700_000_000_000L)

            val expected = mapOf("love/1" to 1_700_000_000_000L, "love/2" to 1_700_000_000_000L)
            assertEquals(expected, stats.addTimes())
            // 写穿：新实例（模拟重启）读出同一张表
            assertEquals(expected, DataRepository(ShardedKvStore(backend)).getMusicAddTimes())
        }

    @Test
    fun stampAddTimesOverwritesExistingEntry() =
        runBlocking {
            val repo = DataRepository(ShardedKvStore(InMemoryKvStore()))
            val stats = MusicStatsStore(repo)

            stats.stampAddTimes("default", listOf("1"), now = 100L)
            stats.stampAddTimes("default", listOf("1", "2"), now = 200L)

            assertEquals(mapOf("default/1" to 200L, "default/2" to 200L), stats.addTimes())
        }

    @Test
    fun stampAddTimesIgnoresEmptyBatch() =
        runBlocking {
            val backend = InMemoryKvStore()
            val repo = DataRepository(ShardedKvStore(backend))
            val stats = MusicStatsStore(repo)

            stats.stampAddTimes("love", emptyList(), now = 100L)

            assertTrue(stats.addTimes().isEmpty())
            assertFalse(backend.snapshot().containsKey(StorageKeys.MUSIC_ADD_TIME))
        }

    @Test
    fun addPlayCountIncrementsAndPersists() =
        runBlocking {
            val backend = InMemoryKvStore()
            val repo = DataRepository(ShardedKvStore(backend))
            val stats = MusicStatsStore(repo)

            stats.addPlayCount("m1")
            stats.addPlayCount("m1")
            stats.addPlayCount("m2")
            stats.addPlayCount("")

            assertEquals(mapOf("m1" to 2L, "m2" to 1L), stats.playCounts())
            assertEquals(mapOf("m1" to 2L, "m2" to 1L), DataRepository(ShardedKvStore(backend)).getMusicPlayCounts())
        }

    @Test
    fun loadsExistingMapsAndSkipsNonNumericValues() =
        runBlocking {
            val backend = InMemoryKvStore()
            val kv = ShardedKvStore(backend)
            kv.saveData(
                StorageKeys.MUSIC_ADD_TIME,
                buildJsonObject {
                    put("love/1", 5)
                    put("love/2", "abc")
                },
            )
            kv.saveData(StorageKeys.MUSIC_PLAY_COUNT, buildJsonObject { put("m1", 3) })

            val stats = MusicStatsStore(DataRepository(kv))

            assertEquals(mapOf("love/1" to 5L), stats.addTimes())
            assertEquals(mapOf("m1" to 3L), stats.playCounts())
        }

    @Test
    fun listStoreStampsAddAndMoveTargetList() =
        runBlocking {
            val repo = DataRepository(ShardedKvStore(InMemoryKvStore()))
            val stats = MusicStatsStore(repo)
            val store = ListStore(repo, stats)

            store.listMusicAdd("love", listOf(music("1"), music("2")), "bottom")
            assertTrue(stats.addTimes().keys.containsAll(setOf("love/1", "love/2")))

            store.listMusicMove("love", "default", listOf(music("2")), "bottom")
            assertTrue(stats.addTimes().containsKey("default/2"))
        }

    @Test
    fun listStoreWithoutStatsKeepsWorking() =
        runBlocking {
            val store = ListStore(DataRepository(ShardedKvStore(InMemoryKvStore())))
            store.listMusicAdd("love", listOf(music("1")), "bottom")
            assertEquals(listOf("1"), ids(store.getListMusics("love")))
        }

    @Test
    fun unrecordedTracksFallBackToZeroAndKeepRelativeOrder() =
        runBlocking {
            val repo = DataRepository(ShardedKvStore(InMemoryKvStore()))
            val stats = MusicStatsStore(repo)
            stats.stampAddTimes("love", listOf("1"), now = 100L)

            val list = listOf(music("1"), music("2"), music("3"))
            val addTimes = stats.addTimes()
            val playCounts = stats.playCounts()

            fun sorted(sortId: MusicSortId) =
                ids(
                    MusicSort.sort(
                        list,
                        sortId,
                        "zh-cn",
                        getAddTime = { addTimes["love/$it"] ?: 0L },
                        getPlayCount = { playCounts[it] ?: 0L },
                    ),
                )

            // 无元数据的 2、3 兜底 0：升序在前且保持原相对顺序，降序在最后
            assertEquals(listOf("2", "3", "1"), sorted(MusicSortId.ADD_TIME_UP))
            assertEquals(listOf("1", "2", "3"), sorted(MusicSortId.ADD_TIME_DOWN))
            // 播放次数全 0 时稳定保持原顺序
            assertEquals(listOf("1", "2", "3"), sorted(MusicSortId.PLAY_COUNT))
        }
}
