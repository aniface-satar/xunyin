package cn.toside.music.core.player

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 启动恢复与换曲归零：对照 RN `playInfo.ts`（`setProgress(0, 0)` + 索引校验）
 * 与 `player.ts#handleRestorePlay`（装载暂停、按 isSavePlayTime 决定进度）。
 */
class PlayerRestoreTest {
    private class FakePlatform : PlayerPlatform {
        val loaded = mutableListOf<Triple<String, String, Long>>()
        var playing = false
        var stopped = false

        override suspend fun setResource(
            musicId: String,
            url: String,
            startPositionMs: Long,
        ) {
            loaded += Triple(musicId, url, startPositionMs)
        }

        override suspend fun play() {
            playing = true
        }

        override suspend fun pause() {
            playing = false
        }

        override suspend fun stop() {
            playing = false
            stopped = true
        }

        override suspend fun setVolume(volume: Float) {}

        override suspend fun setRate(rate: Float) {}

        override suspend fun seekTo(positionSec: Float) {}

        override suspend fun isInitialized(): Boolean = true

        override suspend fun initialize(
            volume: Float,
            playRate: Float,
            cacheSizeMiB: Int,
            isHandleAudioFocus: Boolean,
            isEnableAudioOffload: Boolean,
        ) {}

        override suspend fun isEmpty(): Boolean = loaded.isEmpty()

        override suspend fun positionMs(): Long = 0L

        override suspend fun durationMs(): Long = 0L
    }

    private class Fixture(
        val core: PlayerCore,
        val platform: FakePlatform,
    )

    private fun music(id: String): JsonObject =
        buildJsonObject {
            put("id", id)
            put("name", id)
            put("singer", "s")
            put("source", "kw")
        }

    private fun fixture(
        lists: Map<String, List<JsonObject>> = mapOf("default" to listOf(music("a"), music("b"))),
        url: (JsonObject) -> String? = { info -> "http://music/${info.stringFieldOr("id")}" },
    ): Fixture {
        val platform = FakePlatform()
        val core =
            PlayerCore(
                platform = platform,
                listProvider = { id -> lists[id] ?: emptyList() },
                urlProvider = { info -> url(info) },
                randomSource = { 0 },
            )
        return Fixture(core, platform)
    }

    @Test
    fun restoreLoadsSavedTrackPausedAtSavedPosition() =
        runBlocking {
            val f = fixture()
            assertTrue(f.core.restorePlayList("default", 1, 42f, 200f))
            assertEquals(listOf(Triple("b", "http://music/b", 42_000L)), f.platform.loaded)
            assertFalse(f.platform.playing)
            val state = f.core.state.value
            assertEquals("b", state.playMusicInfo.musicInfo?.stringFieldOr("id"))
            assertEquals("default", state.playMusicInfo.listId)
            assertEquals(1, state.playerPlayIndex)
            assertEquals(42f, state.progress.nowPlayTimeSec)
            assertEquals(200f, state.progress.maxPlayTimeSec)
        }

    @Test
    fun restoreRejectsMissingIndex() =
        runBlocking {
            val f = fixture()
            assertFalse(f.core.restorePlayList("default", 5, 10f, 100f))
            assertTrue(f.platform.loaded.isEmpty())
            assertNull(f.core.state.value.playMusicInfo.musicInfo)
        }

    @Test
    fun selectingTrackResetsProgress() =
        runBlocking {
            // RN setPlayMusicInfo 内部 setProgress(0, 0)：换曲那刻旧进度不跟到新曲
            val f = fixture()
            f.core.playListById("default", "a")
            f.core.setProgress(30f, 100f)
            f.core.playListById("default", "b")
            assertEquals(0f, f.core.state.value.progress.nowPlayTimeSec)
            assertEquals(0f, f.core.state.value.progress.maxPlayTimeSec)
        }
}
