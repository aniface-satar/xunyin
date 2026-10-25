package cn.toside.music.nativeapp.ui.play

import android.content.Context
import cn.toside.music.core.player.SleepTimer
import cn.toside.music.nativeapp.player.PlayerRuntime
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * 定时停止播放的运行态：把纯逻辑 [SleepTimer]（对照 RN `timeoutExit.ts` 的 `timeoutTools`）
 * 接到协程定时器、设置存储与播放器上。位置对应 RN 的「模块级单例」，
 * 所以**离开播放页也不会停表**（RN 用 BackgroundTimer 同理）。
 *
 * 「等这首歌放完」的标志位由 [PlayerRuntime] 的 PlayerCore 持有（RN `global.lx.isPlayedStop`），
 * 这里只负责置位/撤销与 UI 快照；到点后的退出由 PlaybackCoordinator 在 Ended/Paused
 * 事件里触发 [PlayerRuntime.shutdown]（正规停服务 + 结束任务，不再 exitProcess）。
 */
class TimeoutExitRuntime private constructor(
    context: Context,
) {
    private val appContext = context.applicationContext
    private val runtime = PlayerRuntime.get(appContext)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private var deadlineJob: Job? = null
    private var tickerJob: Job? = null

    private val timer =
        SleepTimer(
            currentTimeMs = { System.currentTimeMillis() },
            // RN 到点那一刻才读 playerState.isPlay 与设置项
            isPlaying = { runtime.core.state.value.isPlay },
            waitUntilSongEnd = { runtime.settings.store.bool(KEY_TIMEOUT_EXIT_PLAYED) },
            onExitApp = { runtime.shutdown() },
            isPlayedStopProvider = { runtime.core.isPlayedStop },
            setPlayedStop = { runtime.core.setPlayedStop(it) },
        )

    private val _status = MutableStateFlow(Status())
    val status: StateFlow<Status> = _status.asStateFlow()

    init {
        timer.addListener { remainingSeconds, playedStop ->
            _status.value = Status(remainingSeconds, playedStop)
        }
    }

    /** UI 用的快照：剩余秒数（-1 = 未开启）与「正在等这首歌放完」。 */
    data class Status(
        val remainingSeconds: Int = -1,
        val isPlayedStop: Boolean = false,
    ) {
        /** RN `useTimeInfo` 的按钮三态。 */
        val buttonMode: SleepTimer.ButtonMode
            get() = SleepTimer.buttonMode(remainingSeconds, isPlayedStop)

        /** RN `timeout_exit_tip_on`：计时中的那一行文案。 */
        val statusText: String
            get() = if (remainingSeconds < 0) "设置定时停止播放" else "${SleepTimer.formatTime(remainingSeconds)} 后停止播放"
    }

    /** RN `player.timeoutExit`：上次输入的分钟数，只用于回填输入框（不自动续跑）。 */
    val lastMinutesText: String
        get() = runtime.settings.store.string(KEY_TIMEOUT_EXIT)

    /** RN `player.timeoutExitPlayed`。 */
    val waitUntilSongEnd: Boolean
        get() = runtime.settings.store.bool(KEY_TIMEOUT_EXIT_PLAYED)

    fun setWaitUntilSongEnd(enabled: Boolean) {
        scope.launch {
            runtime.settings.ensureLoaded()
            runtime.settings.store.set(KEY_TIMEOUT_EXIT_PLAYED, enabled)
        }
    }

    /**
     * RN `handleConfirm`：先 `cancelTimeoutExit()`（撤掉可能还在的「等播完」标志），
     * 再按分钟数重新起表，并把数字写回设置。
     */
    fun start(minutes: Int) {
        val seconds = minutes * 60
        timer.cancelPlayedStop()
        timer.start(seconds)
        deadlineJob?.cancel()
        tickerJob?.cancel()
        // RN 的 1 秒 setInterval：把剩余时间推给 UI
        tickerJob =
            scope.launch {
                while (true) {
                    delay(TICK_INTERVAL_MS)
                    timer.tick()
                }
            }
        deadlineJob =
            scope.launch {
                delay(seconds * 1000L)
                timer.onDeadlineReached()
            }
        scope.launch {
            runtime.settings.ensureLoaded()
            runtime.settings.store.set(KEY_TIMEOUT_EXIT, minutes.toString())
        }
    }

    /** RN `stopTimeoutExit()`：取消倒计时（弹层里「取消定时」）。 */
    fun cancel() {
        deadlineJob?.cancel()
        tickerJob?.cancel()
        deadlineJob = null
        tickerJob = null
        timer.cancel()
    }

    /** RN `cancelTimeoutExit()`：只撤「等待播完」标志（弹层里「取消退出」）。 */
    fun cancelPlayedStop() {
        timer.cancelPlayedStop()
    }

    companion object {
        private const val KEY_TIMEOUT_EXIT = "player.timeoutExit"
        private const val KEY_TIMEOUT_EXIT_PLAYED = "player.timeoutExitPlayed"
        private const val TICK_INTERVAL_MS = 1_000L

        @Volatile
        private var instance: TimeoutExitRuntime? = null

        fun get(context: Context): TimeoutExitRuntime =
            instance ?: synchronized(this) {
                instance ?: TimeoutExitRuntime(context.applicationContext).also { instance = it }
            }
    }
}
