package cn.toside.music.core.player

import kotlin.math.roundToInt

/**
 * 定时停止播放（RN `src/core/player/timeoutExit.ts` 里 `timeoutTools` 的等价物）。
 *
 * RN 那个模块是「后台定时器 + 全局标志位」，到点动作是**退出应用**而不是暂停，
 * 这里保持同一套语义；逐条对照：
 *
 * - `time` 单位秒，-1 表示未开启（timeoutExit.ts:13）。
 * - `getTime()` = `max(time - round((now - startTime) / 1000), -1)`（:24）—— 差值按**四舍五入**
 *   而非向下取整，所以剩余时间会在真实经过 0.5 秒时就少 1。
 * - `start(time)` 先 `clearTimeout()`（:42）：重复设置 = 重新开始，不叠加。
 * - `clearTimeout()` 在没有活动计时器时**直接 return**（:33）：既不重置，也不通知监听者。
 * - 定时器到点是「先 `clearTimeout()` 再 `exit()`」（:45-47），所以监听者先看到已关闭，
 *   之后才发生退出动作。
 * - `exit()` 分两支（:16-21）：`player.timeoutExitPlayed` 且正在播放 → 只置 `isPlayedStop`
 *   标志（真正的退出交给播放器事件链，见 service.ts:134/143）；否则直接 `exitApp('Timeout Exit')`。
 * - `cancelTimeoutExit()` 只清标志并通知（:96-99），**不影响倒计时**。
 * - `addTimeHook` 注册时立即回调一次（:55）。
 *
 * 时钟与到点动作都靠注入，所以纯 JVM 可测；真正挂表（后台定时器/协程）留在 app 层。
 */
class SleepTimer(
    /** 单调时钟（毫秒），RN 用 `performance.now()`。 */
    private val currentTimeMs: () -> Long = { System.currentTimeMillis() },
    /** RN `playerState.isPlay`，到点那一刻才读。 */
    private val isPlaying: () -> Boolean = { false },
    /** RN 设置项 `player.timeoutExitPlayed`（默认 true），到点那一刻才读。 */
    private val waitUntilSongEnd: () -> Boolean = { true },
    /** RN `exitApp('Timeout Exit')`。 */
    private val onExitApp: () -> Unit = {},
    /**
     * 外部标志位（app 层指向 [PlayerCore.isPlayedStop]）。任务 3 起 RN 的
     * `global.lx.isPlayedStop` 由 PlayerCore 提供，SleepTimer 只做转发，
     * 不再自己持有第二份事实；JVM 单测不注入时退回本地字段。
     */
    private val isPlayedStopProvider: (() -> Boolean)? = null,
    private val setPlayedStop: ((Boolean) -> Unit)? = null,
) {
    /** 本地兜底（仅在未注入外部标志位时使用，保持既有单测兼容）。 */
    private var localPlayedStop: Boolean = false

    /** RN `global.lx.isPlayedStop`：已到期、正在等这首歌放完。 */
    val isPlayedStop: Boolean
        get() = isPlayedStopProvider?.invoke() ?: localPlayedStop

    /** RN `timeoutTools.time`：本次设定的总秒数，-1 = 未开启。 */
    var totalSeconds: Int = -1
        private set

    private var startWallMs: Long = 0L
    private val listeners = mutableListOf<(Int, Boolean) -> Unit>()

    /** RN `getTime()`：剩余秒数，未开启或已到期都是 -1。 */
    fun remainingSeconds(): Int {
        if (totalSeconds < 0) return -1
        val elapsedSec = ((currentTimeMs() - startWallMs) / 1000.0).roundToInt()
        return maxOf(totalSeconds - elapsedSec, -1)
    }

    /** RN `start(time)`：先清旧表，再装新表；不立即通知（RN 靠 1 秒 tick 刷新 UI）。 */
    fun start(totalSeconds: Int) {
        cancel()
        this.totalSeconds = totalSeconds
        startWallMs = currentTimeMs()
    }

    /** RN `clearTimeout()`：无活动计时器时直接返回，不通知。 */
    fun cancel() {
        if (totalSeconds < 0) return
        totalSeconds = -1
        notifyListeners()
    }

    /** RN 后台定时器到点：先清表（通知监听者），再按设置决定「标志位」还是「直接退出」。 */
    fun onDeadlineReached() {
        cancel()
        if (waitUntilSongEnd() && isPlaying()) {
            localPlayedStop = true
            setPlayedStop?.invoke(true)
            notifyListeners()
        } else {
            onExitApp()
        }
    }

    /** RN `cancelTimeoutExit()`：只撤「等待播完」标志并通知，倒计时不受影响。 */
    fun cancelPlayedStop() {
        localPlayedStop = false
        setPlayedStop?.invoke(false)
        notifyListeners()
    }

    /** RN `setInterval(..., 1000)` 的心跳：把当前剩余时间推给监听者。 */
    fun tick() {
        notifyListeners()
    }

    /**
     * RN `addTimeHook`：注册即回调一次，返回取消注册的函数。
     *
     * 注意一处 RN 隐患：它的 `removeTimeHook` 用 `splice(indexOf(hook), 1)`（:58），
     * 传入未注册的钩子时 `indexOf` 为 -1，会误删数组**最后一个**钩子。这里按身份移除，
     * 不复现该缺陷；差异已记入 lane 报告。
     */
    fun addListener(listener: (remainingSeconds: Int, isPlayedStop: Boolean) -> Unit): () -> Unit {
        listeners += listener
        listener(remainingSeconds(), isPlayedStop)
        return { listeners.remove(listener) }
    }

    private fun notifyListeners() {
        val remaining = remainingSeconds()
        for (listener in listeners) listener(remaining, isPlayedStop)
    }

    /** RN `useTimeInfo` 的三态：倒计时中 / 已结束正在等退出 / 未开启。 */
    enum class ButtonMode {
        /** 无按钮（未开启定时）。 */
        OFF,

        /** 「取消定时」+「更新定时」。 */
        COUNTING,

        /** 只有「取消退出」（已到期，正在等这首歌放完）。 */
        WAITING_EXIT,
    }

    companion object {
        /** RN `MAX_MIN`（TimeoutExitEditModal.tsx:15）。 */
        const val MAX_MINUTES: Int = 1440

        /**
         * RN `useTimeInfo` 的按钮判定（TimeoutExitEditModal.tsx:110-130）：
         * 剩余时间 <0 时若 `isPlayedStop` 才给「取消退出」，>=0 时两个按钮都在。
         */
        fun buttonMode(
            remainingSeconds: Int,
            isPlayedStop: Boolean,
        ): ButtonMode =
            when {
                remainingSeconds >= 0 -> ButtonMode.COUNTING
                isPlayedStop -> ButtonMode.WAITING_EXIT
                else -> ButtonMode.OFF
            }

        /** RN `handleConfirm` 里的 `rxp = /([1-9]\d*)/` + `MAX_MIN` 闸门（:186-198）。 */
        fun parseMinutes(raw: String): MinutesInput {
            val text = raw.trim()
            if (text.isEmpty()) return MinutesInput.Empty
            val matched =
                MINUTE_PATTERN.find(text)?.value
                    ?: return MinutesInput.Invalid
            // RN 用 parseInt，超长数字在 JS 里是个巨大的浮点数，仍然 >MAX_MIN；
            // Kotlin 侧溢出到 null 时按同一支路处理。
            val minutes = matched.toLongOrNull() ?: return MinutesInput.TooLong
            return if (minutes > MAX_MINUTES) MinutesInput.TooLong else MinutesInput.Valid(minutes.toInt())
        }

        /**
         * RN `formatTime`（:17-27）：`h:mm:ss`，小时为 0 时不写小时段，
         * 分秒都补两位。只接非负秒数（RN 也只在 `time >= 0` 与总时长上调用）。
         */
        fun formatTime(seconds: Int): String {
            val hour = seconds / 3600
            val rest = seconds % 3600
            val minute = rest / 60
            val second = rest % 60
            val hourText = if (hour > 0) "$hour:" else ""
            return "$hourText" + minute.toString().padStart(2, '0') +
                ":" + second.toString().padStart(2, '0')
        }

        private val MINUTE_PATTERN = Regex("([1-9]\\d*)")
    }

    /** RN `handleConfirm` 对输入的四支分岔。 */
    sealed interface MinutesInput {
        /** 数字合法，可以直接开始计时。 */
        data class Valid(
            val minutes: Int,
        ) : MinutesInput

        /** 超过 `MAX_MINUTES`：RN toast「最多只能设置 {num} 分钟哦」并且**不**开始计时。 */
        data object TooLong : MinutesInput

        /** 有内容但抽不出数字：RN toast `input_error` 并且不开始计时。 */
        data object Invalid : MinutesInput

        /** 空输入：RN 直接 return，不 toast、不开始计时。 */
        data object Empty : MinutesInput
    }
}
