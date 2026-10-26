package cn.toside.music.core.player

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** RN utils/data.ts `addPlayHistory` 的纯规则 + PlayerCore 两条写入时机。 */
class PlayHistoryTest {
    private fun song(id: String): JsonObject =
        buildJsonObject {
            put("id", id)
            put("name", "歌$id")
            put("singer", "歌手$id")
            put("source", "kw")
        }

    @Test
    fun `追加一条时保留 RN 条目形状`() {
        val next = PlayHistory.add(emptyList(), song("1"), "love", false, 1000L)
        assertEquals(1, next.size)
        val item = next.first()
        assertEquals("1", (item["musicInfo"] as JsonObject)["id"]?.let { (it as JsonPrimitive).content })
        assertEquals("love", (item["listId"] as JsonPrimitive).content)
        assertEquals("false", (item["isTempPlay"] as JsonPrimitive).content)
        assertEquals("1000", (item["playTime"] as JsonPrimitive).content)
    }

    @Test
    fun `同列表同 id 去重并把新记录放到最前`() {
        val first = PlayHistory.add(emptyList(), song("1"), "love", false, 1000L)
        val second = PlayHistory.add(first, song("2"), "love", false, 2000L)
        val third = PlayHistory.add(second, song("1"), "love", true, 3000L)
        assertEquals(2, third.size)
        assertEquals("1", idOf(third[0]))
        assertEquals("true", (third[0]["isTempPlay"] as JsonPrimitive).content)
        assertEquals("3000", (third[0]["playTime"] as JsonPrimitive).content)
        assertEquals("2", idOf(third[1]))
    }

    @Test
    fun `不同列表的同一首歌各自保留`() {
        val first = PlayHistory.add(emptyList(), song("1"), "love", false, 1000L)
        val second = PlayHistory.add(first, song("1"), "userlist_1", false, 2000L)
        assertEquals(2, second.size)
        assertEquals("userlist_1", (second[0]["listId"] as JsonPrimitive).content)
    }

    @Test
    fun `上限 100 条并丢弃最旧`() {
        var list: List<JsonObject> = emptyList()
        repeat(120) { index ->
            list = PlayHistory.add(list, song(index.toString()), "love", false, index.toLong())
        }
        assertEquals(PlayHistory.MAX_ITEMS, list.size)
        assertEquals("119", idOf(list.first()))
        assertEquals("20", idOf(list.last()))
    }

    @Test
    fun `handlePlay 写入播放历史`() =
        runBlocking {
            val platform = RecordingPlatform()
            val core = PlayerCore(platform, { listOf(song("1")) }, { "http://x" })
            val recorded = mutableListOf<PlayMusicInfo>()
            core.onAddPlayHistory = { recorded.add(it) }
            core.playListById("love", "1")
            assertEquals(1, recorded.size)
            assertEquals("love", recorded.first().listId)
            assertEquals(false, recorded.first().isTempPlay)
        }

    @Test
    fun `restore 路径同样写入播放历史`() =
        runBlocking {
            val platform = RecordingPlatform()
            val core = PlayerCore(platform, { listOf(song("1")) }, { "http://x" })
            val recorded = mutableListOf<PlayMusicInfo>()
            core.onAddPlayHistory = { recorded.add(it) }
            assertTrue(core.restorePlayList("love", 0, 0f, 0f))
            assertEquals(1, recorded.size)
            assertEquals("love", recorded.first().listId)
        }

    @Test
    fun `历史与内存 playedList 无关`() =
        runBlocking {
            val platform = RecordingPlatform()
            val core = PlayerCore(platform, { listOf(song("1")) }, { "http://x" })
            var calls = 0
            core.onAddPlayHistory = { calls += 1 }
            core.playListById("love", "1")
            val played = core.state.value.playedList
            assertTrue(played.isEmpty())
            assertEquals(1, calls)
        }

    private fun idOf(item: JsonObject): String = ((item["musicInfo"] as JsonObject)["id"] as JsonPrimitive).content

    private class RecordingPlatform : PlayerPlatform {
        override suspend fun setResource(
            musicId: String,
            url: String,
            startPositionMs: Long,
        ) = Unit

        override suspend fun play() = Unit

        override suspend fun pause() = Unit

        override suspend fun stop() = Unit

        override suspend fun setVolume(volume: Float) = Unit

        override suspend fun setRate(rate: Float) = Unit

        override suspend fun seekTo(positionSec: Float) = Unit

        override suspend fun isInitialized(): Boolean = true

        override suspend fun initialize(
            volume: Float,
            playRate: Float,
            cacheSizeMiB: Int,
            isHandleAudioFocus: Boolean,
            isEnableAudioOffload: Boolean,
        ) = Unit

        override suspend fun isEmpty(): Boolean = true

        override suspend fun positionMs(): Long = 0L

        override suspend fun durationMs(): Long = 0L
    }
}
