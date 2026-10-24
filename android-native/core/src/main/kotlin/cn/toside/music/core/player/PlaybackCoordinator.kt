package cn.toside.music.core.player

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject

/**
 * 播放事件 → PlayerCore 状态 / 进度轮询 —— RN `src/core/init/player/player.ts` +
 * `playProgress.ts` + `playerEvent.ts` 的事件映射移植。
 *
 * 轮询时机：RN 在 `play` 事件时立刻取一次位置，之后每 `1000 / playbackRate` 毫秒一次，
 * `pause`/`stop`/`error` 停表；息屏时停更（屏幕亮了且仍在播才恢复）。
 * 这里不自己判息屏以外的条件，`isInteractive` 由调用方注入，JVM 单测里恒真。
 *
 * 失败处理对照 RN handleError：音频 URL 失效先刷新两次（每曲重置计数）；
 * 仍失败则停播，前台 5 秒后、后台立即自动下一首。取链失败（RN setMusicUrl
 * catch）直接按 5 秒后自动下一首处理。
 */
class PlaybackCoordinator(
    private val core: PlayerCore,
    private val eventSource: PlaybackEventSource,
    private val scope: CoroutineScope,
    private val isInteractive: () -> Boolean = { true },
    private val isAppActive: () -> Boolean = { true },
    private val nextDelayMs: Long = 5000L,
    private val loadTimeoutMs: Long = 25_000L,
) {
    private var ticker: Job? = null
    private var nextJob: Job? = null
    private var loadJob: Job? = null
    private var loadStartedId: String? = null
    private var loadTimedOutId: String? = null
    private var retryNum = 0
    private var retryMusicId: String? = null

    fun start() {
        eventSource.onPlaybackEvent = { event ->
            scope.launch { handle(event) }
        }
        core.onLoadFailed = { musicInfo -> handleLoadFailed(musicInfo) }
    }

    fun stop() {
        stopTicker()
        clearNextJob()
        clearLoadTimer()
    }

    /** 事件映射；测试直接调用它，避免依赖事件线程。 */
    internal suspend fun handle(event: PlaybackEvent) {
        when (event) {
            PlaybackEvent.LoadStarted -> handleLoadStarted()
            PlaybackEvent.Playing -> {
                core.setIsPlay(true)
                clearNextJob()
                clearLoadTimer()
                startTicker()
            }
            PlaybackEvent.Paused -> {
                core.setIsPlay(false)
                stopTicker()
            }
            PlaybackEvent.Ended -> {
                // RN handleEnded：进度归零后自动下一首（播放模式交给 PlayerCore.playNext(true)）
                stopTicker()
                clearNextJob()
                clearLoadTimer()
                core.setProgress(0f, 0f)
                core.playNext(isAutoToggle = true)
            }
            is PlaybackEvent.Failed -> handleFailed()
        }
    }

    /**
     * RN handleLoadstart：装载起 25 秒计时。第一次超时只是刷新一次 URL，
     * 同一首再超时就直接跳下一首（prevTimeoutId 语义）。
     */
    private fun handleLoadStarted() {
        val musicInfo = core.state.value.playMusicInfo.musicInfo ?: return
        val id = musicInfo.idKey()
        // 换曲即清掉「上次超时曲目」（RN musicToggled 里重置 prevTimeoutId）
        if (id != loadStartedId) {
            loadStartedId = id
            loadTimedOutId = null
        }
        clearLoadTimer()
        loadJob =
            scope.launch {
                delay(loadTimeoutMs)
                handleLoadTimeout()
                loadJob = null
            }
    }

    private suspend fun handleLoadTimeout() {
        val musicInfo = core.state.value.playMusicInfo.musicInfo ?: return
        val id = musicInfo.idKey()
        if (loadTimedOutId == id) {
            loadTimedOutId = null
            core.onPlayError?.invoke(musicInfo)
            // RN 这里是立即 playNext(true)，不走 5 秒延迟
            core.playNext(isAutoToggle = true)
            return
        }
        loadTimedOutId = id
        core.onStatusText?.invoke("正在刷新播放链接")
        core.reloadCurrent()
    }

    private suspend fun handleFailed() {
        val musicInfo = core.state.value.playMusicInfo.musicInfo ?: return
        stopTicker()
        core.setIsPlay(false)
        clearNextJob()
        clearLoadTimer()
        resetRetryIfTrackChanged(musicInfo)

        if (retryNum < MAX_URL_RETRIES) {
            retryNum++
            // RN 刷新前先把播放器当前位置写回 nowPlayTime，刷新后从该位置续播
            runCatching { core.syncProgress() }
            core.onStatusText?.invoke("正在刷新播放链接")
            core.reloadCurrent()
            return
        }

        core.stopPlayback()
        core.onPlayError?.invoke(musicInfo)
        core.onStatusText?.invoke("播放失败")
        scheduleNext()
    }

    private suspend fun handleLoadFailed(musicInfo: JsonObject) {
        // 取链期间用户已切走则不处理（RN diffCurrentMusicInfo）
        val current = core.state.value.playMusicInfo
        if (current.musicInfo?.idKey() != musicInfo.idKey()) return
        clearNextJob()
        scheduleNext()
    }

    private fun resetRetryIfTrackChanged(musicInfo: JsonObject) {
        val id = musicInfo.idKey()
        if (id != retryMusicId) {
            retryMusicId = id
            retryNum = 0
        }
    }

    private fun scheduleNext() {
        clearNextJob()
        val playInfo = core.state.value.playMusicInfo
        val scheduledId = playInfo.musicInfo?.idKey()
        nextJob =
            scope.launch {
                if (isAppActive()) delay(nextDelayMs)
                val current = core.state.value.playMusicInfo.musicInfo
                // RN 到点再确认：已停播或已换曲就不再自动跳
                if (current != null && current.idKey() == scheduledId) core.playNext(isAutoToggle = true)
                nextJob = null
            }
    }

    private fun clearNextJob() {
        nextJob?.cancel()
        nextJob = null
    }

    private fun clearLoadTimer() {
        loadJob?.cancel()
        loadJob = null
    }

    private fun startTicker() {
        stopTicker()
        ticker =
            scope.launch {
                runCatching { core.syncProgress() }
                while (isActive) {
                    delay(intervalMs())
                    if (!isInteractive()) continue
                    runCatching { core.syncProgress() }
                }
            }
    }

    private fun intervalMs(): Long {
        var rate = core.state.value.playRate
        if (rate < 0.1f) rate = 0.1f
        val millis = (1000f / rate).toLong()
        return if (millis < 100L) 100L else millis
    }

    private fun stopTicker() {
        ticker?.cancel()
        ticker = null
    }

    private companion object {
        /** RN handleError 的 retryNum < 2：URL 失效刷新两次。 */
        const val MAX_URL_RETRIES = 2
    }
}
