package cn.toside.music.core.player

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * 播放进度记忆：对照 RN `playProgress.ts` 的 `delaySavePlayInfo`（2 秒节流 + 三条件）
 * 与 `playInfo.ts` 的 `musicToggled`（非临时曲无条件保存）。
 */
class PlayProgressMemoryTest {
    private class FakeStorage(
        var stored: SavedPlayInfo? = null,
    ) : SavedPlayInfoStorage {
        var saveCount = 0

        override suspend fun save(info: SavedPlayInfo) {
            stored = info
            saveCount++
        }

        override suspend fun load(): SavedPlayInfo? = stored
    }

    private var clock = 10_000L

    private fun music(id: String = "a"): JsonObject =
        buildJsonObject {
            put("id", id)
            put("name", id)
            put("singer", "s")
            put("source", "kw")
        }

    private fun state(
        musicInfo: JsonObject? = music(),
        listId: String? = "default",
        isTempPlay: Boolean = false,
        isPlay: Boolean = true,
        nowSec: Float = 12f,
        maxSec: Float = 60f,
        index: Int = 3,
    ): PlayerState =
        PlayerState(
            playMusicInfo = PlayMusicInfo(listId, musicInfo, isTempPlay),
            playerPlayIndex = index,
            isPlay = isPlay,
            progress = PlayProgress(nowSec, maxSec),
        )

    private fun memory(
        storage: FakeStorage,
        savePlayTime: Boolean = true,
        screenOn: Boolean = true,
    ): PlayProgressMemory =
        PlayProgressMemory(
            storage = storage,
            isSavePlayTime = { savePlayTime },
            isScreenOn = { screenOn },
            currentTimeMs = { clock },
        )

    @Test
    fun savesWhenPlayingAndSavePlayTimeEnabled() =
        runBlocking {
            val storage = FakeStorage()
            val saved = memory(storage).saveProgress(state())
            assertEquals(SavedPlayInfo(12f, 60f, "default", 3), saved)
            assertEquals(SavedPlayInfo(12f, 60f, "default", 3), storage.stored)
        }

    @Test
    fun skipsWhenSavePlayTimeDisabled() =
        runBlocking {
            val storage = FakeStorage()
            assertNull(memory(storage, savePlayTime = false).saveProgress(state()))
            assertEquals(0, storage.saveCount)
        }

    @Test
    fun skipsWhenPausedOrScreenOff() =
        runBlocking {
            val storage = FakeStorage()
            val memory = memory(storage)
            assertNull(memory.saveProgress(state(isPlay = false)))
            assertNull(memory(storage, screenOn = false).saveProgress(state()))
            assertEquals(0, storage.saveCount)
        }

    @Test
    fun skipsTempPlayEvenWhenForced() =
        runBlocking {
            val storage = FakeStorage()
            assertNull(memory(storage).saveProgress(state(isTempPlay = true), force = true))
            assertEquals(0, storage.saveCount)
        }

    @Test
    fun throttlesPeriodicSaveToTwoSeconds() =
        runBlocking {
            val storage = FakeStorage()
            val memory = memory(storage)
            memory.saveProgress(state(nowSec = 1f))
            clock += 1_999L
            assertNull(memory.saveProgress(state(nowSec = 2f)))
            clock += 1L
            memory.saveProgress(state(nowSec = 3f))
            assertEquals(2, storage.saveCount)
            assertEquals(3f, storage.stored?.timeSec)
        }

    @Test
    fun forcedSaveIgnoresThrottleAndPlayState() =
        runBlocking {
            // RN musicToggled：非临时曲无条件保存（此时进度已被 setPlayMusicInfo 归零）
            val storage = FakeStorage()
            val memory = memory(storage, savePlayTime = false)
            val saved = memory.saveProgress(state(isPlay = false, nowSec = 0f, maxSec = 0f), force = true)
            assertEquals(SavedPlayInfo(0f, 0f, "default", 3), saved)
            assertEquals(1, storage.saveCount)
        }

    @Test
    fun loadRejectsInvalidIdentity() =
        runBlocking {
            val storage = FakeStorage(SavedPlayInfo(1f, 2f, "", 0))
            assertNull(memory(storage).load())
            storage.stored = SavedPlayInfo(1f, 2f, "default", -1)
            assertNull(memory(storage).load())
            storage.stored = SavedPlayInfo(1f, 2f, "default", 0)
            assertEquals(SavedPlayInfo(1f, 2f, "default", 0), memory(storage).load())
        }

    @Test
    fun codecRoundTripsAndRejectsGarbage() {
        val info = SavedPlayInfo(12.5f, 240f, "default", 7)
        assertEquals(info, SavedPlayInfoCodec.decode(SavedPlayInfoCodec.encode(info)))
        assertNull(SavedPlayInfoCodec.decode(null))
        assertNull(SavedPlayInfoCodec.decode(""))
        assertNull(SavedPlayInfoCodec.decode("not json"))
        assertNull(SavedPlayInfoCodec.decode("""{"time":1}"""))
        assertNull(SavedPlayInfoCodec.decode("""{"time":1,"maxTime":2,"listId":"","index":0}"""))
    }
}
