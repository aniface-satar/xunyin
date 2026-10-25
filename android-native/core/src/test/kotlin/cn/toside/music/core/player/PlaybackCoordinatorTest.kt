package cn.toside.music.core.player

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** 事件映射与进度轮询：对照 RN src/core/init/player/player.ts + playProgress.ts。 */
class PlaybackCoordinatorTest {
    private class FakePlatform : PlayerPlatform {
        val loaded = mutableListOf<Pair<String, String>>()
        var playing = false
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

        override suspend fun positionMs(): Long = position

        override suspend fun durationMs(): Long = duration
    }

    private class FakeEventSource : PlaybackEventSource {
        override var onPlaybackEvent: ((PlaybackEvent) -> Unit)? = null
    }

    private fun music(id: String): JsonObject =
        buildJsonObject {
            put("id", id)
            put("name", id)
            put("singer", "s")
            put("source", "kw")
        }

    private class Fixture(
        val core: PlayerCore,
        val coordinator: PlaybackCoordinator,
        val scope: CoroutineScope,
        val platform: FakePlatform,
    )

    private fun fixture(
        lists: Map<String, List<JsonObject>> = emptyMap(),
        method: TogglePlayMethod = TogglePlayMethod.LIST_LOOP,
        url: (JsonObject) -> String? = { info -> "http://music/${info.stringFieldOr("id")}" },
        isAppActive: () -> Boolean = { true },
        nextDelayMs: Long = 5000L,
        loadTimeoutMs: Long = 25_000L,
    ): Fixture {
        val platform = FakePlatform()
        val source = FakeEventSource()
        val scope = CoroutineScope(Dispatchers.Unconfined)
        val core =
            PlayerCore(
                platform = platform,
                listProvider = { id -> lists[id] ?: emptyList() },
                urlProvider = { info -> url(info) },
                randomSource = { 0 },
            )
        core.togglePlayMethodProvider = { method }
        val coordinator =
            PlaybackCoordinator(
                core = core,
                eventSource = source,
                scope = scope,
                isAppActive = isAppActive,
                nextDelayMs = nextDelayMs,
                loadTimeoutMs = loadTimeoutMs,
            )
        coordinator.start()
        return Fixture(core, coordinator, scope, platform)
    }

    @Test
    fun endedWhileWaitingForSongEndDoesNotAdvanceAndRequestsExit() =
        runBlocking {
            // RN handleEnded：isPlayedStop 时只写「播放结束」并返回；
            // service.ts:134 在下一次播放器事件里 handleExitApp('Timeout Exit')
            val f = fixture(lists = mapOf("default" to listOf(music("a"), music("b"))))
            f.core.playListById("default", "a")
            f.core.setPlayedStop(true)
            var exits = 0
            f.coordinator.onPlayedStopExit = { exits++ }
            f.coordinator.handle(PlaybackEvent.Ended)
            assertEquals(
                "a",
                f.core.state.value.playMusicInfo.musicInfo
                    ?.stringFieldOr("id"),
            )
            assertEquals(1, exits)
            assertEquals(0f, f.core.state.value.progress.nowPlayTimeSec)
            f.scope.cancel()
        }

    @Test
    fun pausedWhileWaitingForSongEndRequestsExit() =
        runBlocking {
            // RN core/init/player/player.ts:19 setPauseStatus：isPlayedStop 时补一次 pause；
            // service.ts:143 PlaybackState 变化时退出
            val f = fixture(lists = mapOf("default" to listOf(music("a"))))
            f.core.playListById("default", "a")
            f.core.setIsPlay(true)
            f.core.setPlayedStop(true)
            var exits = 0
            f.coordinator.onPlayedStopExit = { exits++ }
            f.coordinator.handle(PlaybackEvent.Paused)
            assertFalse(f.core.state.value.isPlay)
            assertEquals(1, exits)
            f.scope.cancel()
        }

    @Test
    fun playingSetsIsPlayAndSamplesProgressImmediately() =
        runBlocking {
            val f = fixture(lists = mapOf("default" to listOf(music("a"))))
            f.core.playListById("default", "a")
            f.platform.position = 12_000
            f.platform.duration = 60_000
            f.coordinator.handle(PlaybackEvent.Playing)
            assertTrue(f.core.state.value.isPlay)
            // RN playProgress 在 play 事件时立刻取一次位置，不等第一个 1s 间隔
            assertEquals(12f, f.core.state.value.progress.nowPlayTimeSec)
            assertEquals(60f, f.core.state.value.progress.maxPlayTimeSec)
            f.scope.cancel()
        }

    @Test
    fun pausedClearsIsPlay() =
        runBlocking {
            val f = fixture(lists = mapOf("default" to listOf(music("a"))))
            f.core.setIsPlay(true)
            f.coordinator.handle(PlaybackEvent.Paused)
            assertFalse(f.core.state.value.isPlay)
            f.scope.cancel()
        }

    @Test
    fun endedResetsProgressAndAutoAdvances() =
        runBlocking {
            val f = fixture(lists = mapOf("default" to listOf(music("a"), music("b"))))
            f.core.playListById("default", "a")
            f.core.setProgress(59f, 60f)
            f.coordinator.handle(PlaybackEvent.Ended)
            assertEquals(0f, f.core.state.value.progress.nowPlayTimeSec)
            assertEquals(
                "b",
                f.core.state.value.playMusicInfo.musicInfo
                    ?.stringFieldOr("id"),
            )
            assertEquals("a" to "http://music/a", f.platform.loaded[0])
            assertEquals("b" to "http://music/b", f.platform.loaded[1])
            f.scope.cancel()
        }

    @Test
    fun failedRefreshesUrlTwiceThenStopsAndReports() =
        runBlocking {
            // RN handleError：retryNum < 2 时刷新 URL；第三次失败才停播并报错
            val f = fixture(lists = mapOf("default" to listOf(music("a"))), nextDelayMs = 60_000)
            val failed = mutableListOf<JsonObject>()
            f.core.onPlayError = { failed += it }
            f.core.playListById("default", "a")
            f.core.setIsPlay(true)

            f.coordinator.handle(PlaybackEvent.Failed("ERROR_CODE_IO_BAD_HTTP_STATUS"))
            f.coordinator.handle(PlaybackEvent.Failed("ERROR_CODE_IO_BAD_HTTP_STATUS"))
            assertEquals(3, f.platform.loaded.size) // 初始装载 + 两次刷新
            assertTrue(failed.isEmpty())
            assertTrue(f.platform.playing)

            f.coordinator.handle(PlaybackEvent.Failed("ERROR_CODE_IO_BAD_HTTP_STATUS"))
            assertEquals(3, f.platform.loaded.size)
            assertEquals(1, failed.size)
            assertEquals("a", failed[0].stringFieldOr("id"))
            assertFalse(f.core.state.value.isPlay)
            assertFalse(f.platform.playing)
            f.scope.cancel()
        }

    @Test
    fun failedAfterRetriesAdvancesAfterDelay() =
        runBlocking {
            val f =
                fixture(
                    lists = mapOf("default" to listOf(music("a"), music("b"))),
                    nextDelayMs = 1L,
                )
            f.core.playListById("default", "a")
            repeat(3) { f.coordinator.handle(PlaybackEvent.Failed("x")) }
            kotlinx.coroutines.delay(50)
            assertEquals(
                "b",
                f.core.state.value.playMusicInfo.musicInfo
                    ?.stringFieldOr("id"),
            )
            f.scope.cancel()
        }

    @Test
    fun failedInBackgroundAdvancesImmediately() =
        runBlocking {
            // RN isActive() 为假时不等 5 秒
            val f =
                fixture(
                    lists = mapOf("default" to listOf(music("a"), music("b"))),
                    isAppActive = { false },
                    nextDelayMs = 60_000,
                )
            f.core.playListById("default", "a")
            repeat(3) { f.coordinator.handle(PlaybackEvent.Failed("x")) }
            kotlinx.coroutines.delay(20)
            assertEquals(
                "b",
                f.core.state.value.playMusicInfo.musicInfo
                    ?.stringFieldOr("id"),
            )
            f.scope.cancel()
        }

    /**
     * 等当前曲目切到 [id]，最多 [timeoutMs]。
     *
     * 原来的固定 delay(100) 是在赌「切歌一定在 100ms 内完成」，并行负载下会偶发红。
     * 改成条件等待后只在行为真的没发生时超时失败，结论不变。
     */
    private suspend fun awaitCurrentTrack(
        f: Fixture,
        id: String,
        timeoutMs: Long = 3_000,
    ) {
        withTimeout(timeoutMs) {
            var info = f.core.state.value.playMusicInfo.musicInfo
            while (info?.stringFieldOr("id") != id) {
                kotlinx.coroutines.delay(5)
                info = f.core.state.value.playMusicInfo.musicInfo
            }
        }
    }

    @Test
    fun loadFailureSchedulesNextTrack() =
        runBlocking {
            // RN setMusicUrl catch：取链失败 5 秒后自动下一首
            val f =
                fixture(
                    lists = mapOf("default" to listOf(music("a"), music("b"))),
                    // 只让 a 取不到链，b 能正常装载，避免测试在 a/b 之间来回跳
                    url = { info -> if (info.stringFieldOr("id") == "a") null else "http://music/b" },
                    nextDelayMs = 1L,
                )
            f.core.playListById("default", "a")
            awaitCurrentTrack(f, "b")
            assertEquals(
                "b",
                f.core.state.value.playMusicInfo.musicInfo
                    ?.stringFieldOr("id"),
            )
            // a 从未装载（取链失败），只有自动跳过去的 b 进了平台
            assertEquals(listOf("b" to "http://music/b"), f.platform.loaded)
            f.scope.cancel()
        }

    @Test
    fun loadTimeoutRefreshesOnceThenAdvancesOnSecondTimeout() =
        runBlocking {
            // RN startLoadingTimeout：第一次超时刷新 URL，同曲再超时立即下一首
            val f =
                fixture(
                    lists = mapOf("default" to listOf(music("a"), music("b"))),
                    loadTimeoutMs = 10L,
                )
            f.core.playListById("default", "a")
            f.coordinator.handle(PlaybackEvent.LoadStarted)
            kotlinx.coroutines.delay(80)
            val first = f.core.state.value.playMusicInfo
            assertEquals("a", first.musicInfo?.stringFieldOr("id"))
            assertEquals(2, f.platform.loaded.size) // 初始装载 + 刷新一次

            f.coordinator.handle(PlaybackEvent.LoadStarted)
            kotlinx.coroutines.delay(80)
            val second = f.core.state.value.playMusicInfo
            assertEquals("b", second.musicInfo?.stringFieldOr("id"))
            f.scope.cancel()
        }

    @Test
    fun playingClearsLoadTimeout() =
        runBlocking {
            val f =
                fixture(
                    lists = mapOf("default" to listOf(music("a"))),
                    loadTimeoutMs = 10L,
                )
            f.core.playListById("default", "a")
            f.coordinator.handle(PlaybackEvent.LoadStarted)
            f.coordinator.handle(PlaybackEvent.Playing)
            kotlinx.coroutines.delay(60)
            assertEquals(1, f.platform.loaded.size)
            f.scope.cancel()
        }
}
