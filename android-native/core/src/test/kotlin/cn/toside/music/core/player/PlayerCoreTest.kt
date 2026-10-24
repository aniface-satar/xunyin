package cn.toside.music.core.player

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * PlayerCore 切歌决策测试：对照 RN src/core/player 的行为。
 */
class PlayerCoreTest {
    /** 记录调用的假平台。 */
    private class FakePlatform : PlayerPlatform {
        val loaded = mutableListOf<Pair<String, String>>()
        var playing = false
        var initialized = false
        var position = 0L
        var duration = 0L

        override suspend fun setResource(
            musicId: String,
            url: String,
            startPositionMs: Long,
        ) {
            loaded.add(musicId to url)
        }

        override suspend fun play() {
            playing = true
        }

        override suspend fun pause() {
            playing = false
        }

        override suspend fun stop() {
            playing = false
        }

        var volume = 1f
        var rate = 1f

        override suspend fun setVolume(volume: Float) {
            this.volume = volume
        }

        override suspend fun setRate(rate: Float) {
            this.rate = rate
        }

        val seeks = mutableListOf<Float>()

        override suspend fun seekTo(positionSec: Float) {
            seeks += positionSec
        }

        override suspend fun isInitialized(): Boolean = initialized

        override suspend fun initialize(
            volume: Float,
            playRate: Float,
            cacheSizeMiB: Int,
            isHandleAudioFocus: Boolean,
            isEnableAudioOffload: Boolean,
        ) {
            initialized = true
        }

        override suspend fun isEmpty(): Boolean = loaded.isEmpty()

        override suspend fun positionMs(): Long = position

        override suspend fun durationMs(): Long = duration
    }

    private fun music(
        id: String,
        name: String = id,
        singer: String = "s",
    ): JsonObject =
        buildJsonObject {
            put("id", id)
            put("name", name)
            put("singer", singer)
            put("source", "kw")
        }

    private class Fixture(
        val core: PlayerCore,
        val platform: FakePlatform,
    )

    private fun fixture(
        lists: Map<String, List<JsonObject>> = emptyMap(),
        method: TogglePlayMethod = TogglePlayMethod.LIST_LOOP,
        dislike: DislikeInfo = DislikeInfo(),
        randomSeq: List<Int> = emptyList(),
    ): Fixture {
        val platform = FakePlatform()
        val randomQueue = randomSeq.toMutableList()
        val core =
            PlayerCore(
                platform = platform,
                listProvider = { id -> lists[id] ?: emptyList() },
                urlProvider = { info -> "http://music/${info.stringFieldOr("id")}" },
                randomSource = {
                    if (randomQueue.isEmpty()) 0 else randomQueue.removeAt(0)
                },
            )
        core.togglePlayMethodProvider = { method }
        core.dislikeInfoProvider = { dislike }
        return Fixture(core, platform)
    }

    @Test
    fun playListByIdLoadsResourceAndPlays() =
        runBlocking {
            val f = fixture(lists = mapOf("default" to listOf(music("a"), music("b"))))
            f.core.playListById("default", "a")
            assertEquals(
                "a",
                f.core.state.value.playMusicInfo.musicInfo
                    ?.stringFieldOr("id"),
            )
            assertEquals(1, f.platform.loaded.size)
            assertEquals("a" to "http://music/a", f.platform.loaded[0])
            assertTrue(f.platform.playing)
        }

    @Test
    fun playNextListLoopWraps() =
        runBlocking {
            val f =
                fixture(
                    lists = mapOf("default" to listOf(music("a"), music("b"), music("c"))),
                    method = TogglePlayMethod.LIST_LOOP,
                )
            f.core.playListById("default", "a")
            f.core.playNext(true) // a → b
            assertEquals(
                "b",
                f.core.state.value.playMusicInfo.musicInfo
                    ?.stringFieldOr("id"),
            )
            f.core.playNext(true) // b → c
            f.core.playNext(true) // c → wrap a
            assertEquals(
                "a",
                f.core.state.value.playMusicInfo.musicInfo
                    ?.stringFieldOr("id"),
            )
        }

    @Test
    fun playNextListStaysAtEnd() =
        runBlocking {
            // RN list 模式播完最后一首：不切歌也不停播（playNext 直接 return，当前曲保持）
            val f =
                fixture(
                    lists = mapOf("default" to listOf(music("a"), music("b"))),
                    method = TogglePlayMethod.LIST,
                )
            f.core.playListById("default", "b")
            f.core.playNext(true)
            assertEquals(
                "b",
                f.core.state.value.playMusicInfo.musicInfo
                    ?.stringFieldOr("id"),
            )
        }

    @Test
    fun manualNextOverridesStopMode() =
        runBlocking {
            // 用户手动切歌时 list/singleLoop/none 都按 listLoop 处理
            val f =
                fixture(
                    lists = mapOf("default" to listOf(music("a"), music("b"))),
                    method = TogglePlayMethod.NONE,
                )
            f.core.playListById("default", "b")
            f.core.playNext(false) // 手动 → listLoop 语义 → wrap 到 a
            assertEquals(
                "a",
                f.core.state.value.playMusicInfo.musicInfo
                    ?.stringFieldOr("id"),
            )
        }

    @Test
    fun playedListExcludedFromNext() =
        runBlocking {
            val f =
                fixture(
                    lists = mapOf("default" to listOf(music("a"), music("b"), music("c"))),
                    method = TogglePlayMethod.LIST_LOOP,
                )
            f.core.playListById("default", "a")
            f.core.playNext(true) // → b（a 进 playedList）
            f.core.playNext(true) // → c（b 进 playedList）
            // a、b 已播 → 下一曲应跳过它们 → a（listLoop wrap）
            f.core.playNext(true)
            assertEquals(
                "a",
                f.core.state.value.playMusicInfo.musicInfo
                    ?.stringFieldOr("id"),
            )
        }

    @Test
    fun playPrevUsesPlayHistory() =
        runBlocking {
            val f =
                fixture(
                    lists = mapOf("default" to listOf(music("a"), music("b"), music("c"))),
                    method = TogglePlayMethod.LIST_LOOP,
                )
            f.core.playListById("default", "a")
            f.core.playNext(true) // → b
            f.core.playNext(true) // → c
            f.core.playPrev(true) // → b（历史回退）
            assertEquals(
                "b",
                f.core.state.value.playMusicInfo.musicInfo
                    ?.stringFieldOr("id"),
            )
        }

    @Test
    fun tempPlayListHasPriority() =
        runBlocking {
            val f = fixture(lists = mapOf("default" to listOf(music("a"), music("b"))))
            f.core.playListById("default", "a")
            f.core.addTempPlayList(listOf(Triple("default", music("t1"), false)))
            f.core.playNext(true) // 稍后播放优先
            assertEquals(
                "t1",
                f.core.state.value.playMusicInfo.musicInfo
                    ?.stringFieldOr("id"),
            )
            assertTrue(f.core.state.value.playMusicInfo.isTempPlay)
            assertTrue(
                f.core.state.value.tempPlayList
                    .isEmpty(),
            )
        }

    @Test
    fun dislikeFilteredFromNext() =
        runBlocking {
            val dislike = DislikeInfo(musicNames = setOf("bad song"))
            val bad =
                buildJsonObject {
                    put("id", "x")
                    put("name", "bad song")
                    put("singer", "s")
                }
            val f =
                fixture(
                    lists = mapOf("default" to listOf(music("a"), bad, music("c"))),
                    dislike = dislike,
                )
            f.core.playListById("default", "a")
            f.core.playNext(true) // bad 被不喜欢过滤 → c
            assertEquals(
                "c",
                f.core.state.value.playMusicInfo.musicInfo
                    ?.stringFieldOr("id"),
            )
        }

    @Test
    fun randomModeGeneratesQueueWithCurrentFirst() =
        runBlocking {
            val f =
                fixture(
                    lists = mapOf("default" to listOf(music("a"), music("b"), music("c"), music("d"))),
                    method = TogglePlayMethod.RANDOM,
                )
            f.core.playListById("default", "a")
            assertNotNull(f.core.state.value.randomList)
            assertEquals(
                "a",
                f.core.state.value.randomList!!
                    .musicIds
                    .first(),
            )
            assertEquals(
                4,
                f.core.state.value.randomList!!
                    .musicIds.size,
            )
        }

    @Test
    fun filterListPureLogic() {
        val core = PlayerCore(FakePlatform(), { emptyList() }, { null })
        val played = listOf(PlayMusicInfo("default", music("a")), PlayMusicInfo("default", music("b")))
        val list = listOf(music("a"), music("b"), music("c"), music("d"))
        val (filtered, playerIndex) = core.filterList(played, "default", list, music("c"), isNext = true)
        assertEquals(listOf("c", "d"), filtered.map { it.stringFieldOr("id") })
        assertEquals(0, playerIndex)
    }

    @Test
    fun resolvePrevAnchorTempInHistory() {
        val core = PlayerCore(FakePlatform(), { emptyList() }, { null })
        val playedList =
            listOf(
                PlayMusicInfo("default", music("a")),
                PlayMusicInfo("default", music("t1"), isTempPlay = true),
            )
        // 当前临时曲在历史中 → 锚定自身
        val (id, tempInHistory) = core.resolvePrevAnchor(PlayMusicInfo("default", music("t1"), true), playedList, "a")
        assertEquals("t1", id)
        assertTrue(tempInHistory)
        // 普通"稍后播放"曲不在历史 → 锚定底层列表当前位
        val (id2, temp2) = core.resolvePrevAnchor(PlayMusicInfo("default", music("t2"), true), playedList, "a")
        assertEquals("a", id2)
        assertEquals(false, temp2)
        // 非临时曲 → 锚定自身
        val (id3, _) = core.resolvePrevAnchor(PlayMusicInfo("default", music("a"), false), playedList, null)
        assertEquals("a", id3)
    }

    @Test
    fun listMusicUpdatedSyncsRandomQueue() =
        runBlocking {
            val f =
                fixture(
                    lists = mapOf("default" to listOf(music("a"), music("b"))),
                    method = TogglePlayMethod.RANDOM,
                )
            f.core.playListById("default", "a")
            val before =
                f.core.state.value.randomList!!
                    .musicIds
                    .toSet()
            // 新增歌曲后队列应包含新 id
            val withNew =
                fixture(
                    lists = mapOf("default" to listOf(music("a"), music("b"), music("new1"))),
                    method = TogglePlayMethod.RANDOM,
                )
            withNew.core.playListById("default", "a")
            assertTrue(
                withNew.core.state.value.randomList!!
                    .musicIds
                    .contains("new1"),
            )
            assertTrue(before.size == 2)
        }

    @Test
    fun notificationCommandsSeekAndSwitchTracks() =
        runBlocking {
            val f = fixture(lists = mapOf("default" to listOf(music("a"), music("b"))))
            f.core.playListById("default", "a")
            f.core.setProgress(1f, 100f)
            val scope = CoroutineScope(Dispatchers.Unconfined)
            val commands = CorePlaybackCommands(f.core, scope)
            commands.onSeekCommand(30_000)
            assertEquals(listOf(30f), f.platform.seeks)
            assertEquals(30f, f.core.state.value.progress.nowPlayTimeSec)
            assertEquals(100f, f.core.state.value.progress.maxPlayTimeSec)
            commands.onNextCommand()
            assertEquals(
                "b",
                f.core.state.value.playMusicInfo.musicInfo
                    ?.stringFieldOr("id"),
            )
            scope.cancel()
        }

    @Test
    fun setVolumeAndRateReachPlatformAndState() =
        runBlocking {
            val f = fixture()
            f.core.setVolume(0.35f)
            f.core.setRate(1.5f)
            assertEquals(0.35f, f.platform.volume)
            assertEquals(1.5f, f.platform.rate)
            assertEquals(0.35f, f.core.state.value.volume)
            assertEquals(1.5f, f.core.state.value.playRate)
        }

    @Test
    fun syncProgressReadsPlayerPositionAndDuration() =
        runBlocking {
            val f = fixture()
            f.platform.position = 65_000
            f.platform.duration = 180_000
            f.core.syncProgress()
            assertEquals(65f, f.core.state.value.progress.nowPlayTimeSec)
            assertEquals(180f, f.core.state.value.progress.maxPlayTimeSec)
        }

    @Test
    fun syncProgressClampsUnknownDurationToZero() =
        runBlocking {
            // Media3 对未知长度返回 C.TIME_UNSET，平台层已归一化为 0；这里锁死不为负值
            val f = fixture()
            f.platform.position = -1
            f.platform.duration = -1
            f.core.syncProgress()
            assertEquals(0f, f.core.state.value.progress.nowPlayTimeSec)
            assertEquals(0f, f.core.state.value.progress.maxPlayTimeSec)
        }
}
