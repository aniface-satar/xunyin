package cn.toside.music.core.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 对照 RN `src/core/player/timeoutExit.ts` + `src/components/TimeoutExitEditModal.tsx`
 * 的逐条实证移植。期望值按 RN 源码写，不按直觉写。
 */
class SleepTimerTest {
    private var nowMs = 0L

    private var playing = false
    private var waitSongEnd = true
    var exitCalls = 0
        private set

    private fun timer() =
        SleepTimer(
            currentTimeMs = { nowMs },
            isPlaying = { playing },
            waitUntilSongEnd = { waitSongEnd },
            onExitApp = { exitCalls++ },
        )

    // region 倒计时与四舍五入

    @Test
    fun notStartedReadsMinusOne() {
        assertEquals(-1, timer().remainingSeconds())
        assertEquals(-1, timer().totalSeconds)
    }

    @Test
    fun remainingUsesRoundedNotFlooredElapsed() {
        val timer = timer()
        timer.start(60)
        nowMs = 400L
        // RN: time - Math.round((now-startTime)/1000) → round(0.4)=0
        assertEquals(60, timer.remainingSeconds())
        nowMs = 500L
        // round(0.5)=1，所以半秒就扣掉 1 秒（不是向下取整）
        assertEquals(59, timer.remainingSeconds())
        nowMs = 1_499L
        assertEquals(59, timer.remainingSeconds())
        nowMs = 1_500L
        assertEquals(58, timer.remainingSeconds())
    }

    @Test
    fun remainingNeverGoesBelowMinusOne() {
        val timer = timer()
        timer.start(10)
        nowMs = 60_000L
        assertEquals(-1, timer.remainingSeconds())
    }

    @Test
    fun restartOverwritesInsteadOfAdding() {
        val timer = timer()
        timer.start(600)
        timer.start(300)
        assertEquals(300, timer.totalSeconds)
        assertEquals(300, timer.remainingSeconds())
    }

    @Test
    fun startClearsPreviousTimerAndNotifiesOnce() {
        val timer = timer()
        val seen = mutableListOf<Int>()
        timer.addListener { remaining, _ -> seen += remaining }
        timer.start(60)
        seen.clear()
        timer.start(30)
        // RN start() 先 clearTimeout()，监听者会先看到一次「已关闭」
        assertEquals(listOf(-1), seen)
    }

    // endregion

    // region cancel（RN clearTimeout 的提前 return）

    @Test
    fun cancelWhileInactiveDoesNotNotify() {
        val timer = timer()
        var notifications = 0
        timer.addListener { _, _ -> notifications++ }
        // addListener 注册时回调过一次
        notifications = 0
        timer.cancel()
        assertEquals(0, notifications)
    }

    @Test
    fun cancelWhileActiveTurnsRemainingToMinusOne() {
        val timer = timer()
        timer.start(45)
        val seen = mutableListOf<Int>()
        timer.addListener { remaining, _ -> seen += remaining }
        timer.cancel()
        assertEquals(listOf(45, -1), seen)
        assertEquals(-1, timer.totalSeconds)
    }

    // endregion

    // region 到点动作（RN exit() 的两支）

    @Test
    fun deadlineExitsDirectlyWhenNotWaitingForSongEnd() {
        waitSongEnd = false
        playing = true
        val timer = timer()
        timer.start(1)
        timer.onDeadlineReached()
        assertEquals(1, exitCalls)
        assertFalse(timer.isPlayedStop)
    }

    @Test
    fun deadlineExitsDirectlyWhenNothingIsPlaying() {
        waitSongEnd = true
        playing = false
        val timer = timer()
        timer.start(1)
        timer.onDeadlineReached()
        assertEquals(1, exitCalls)
        assertFalse(timer.isPlayedStop)
    }

    @Test
    fun deadlineOnlyMarksPlayedStopWhenPlayingAndWaitSwitchOn() {
        waitSongEnd = true
        playing = true
        val timer = timer()
        val states = mutableListOf<Pair<Int, Boolean>>()
        timer.addListener { remaining, playedStop -> states += remaining to playedStop }
        timer.start(1)
        timer.onDeadlineReached()
        // RN：不退出应用，改成置 global.lx.isPlayedStop
        assertEquals(0, exitCalls)
        assertTrue(timer.isPlayedStop)
        assertEquals(-1 to true, states.last())
    }

    @Test
    fun cancelPlayedStopClearsFlagOnly() {
        waitSongEnd = true
        playing = true
        val timer = timer()
        timer.start(60)
        timer.onDeadlineReached()
        timer.cancelPlayedStop()
        assertFalse(timer.isPlayedStop)
        // 倒计时早已随到点清掉，取消「等待播完」不会把它捞回来
        assertEquals(-1, timer.remainingSeconds())
    }

    @Test
    fun playedStopFlagDelegatesToPlayerCoreWhenWired() {
        // 任务书任务 3：标志位上升为 PlayerCore 的守卫点，SleepTimer 只做转发。
        waitSongEnd = true
        playing = true
        var coreFlag = false
        val timer =
            SleepTimer(
                currentTimeMs = { nowMs },
                isPlaying = { playing },
                waitUntilSongEnd = { waitSongEnd },
                onExitApp = { exitCalls++ },
                isPlayedStopProvider = { coreFlag },
                setPlayedStop = { coreFlag = it },
            )
        timer.start(1)
        timer.onDeadlineReached()
        assertTrue(coreFlag)
        assertTrue(timer.isPlayedStop)
        timer.cancelPlayedStop()
        assertFalse(coreFlag)
        assertFalse(timer.isPlayedStop)
    }

    // endregion

    // region 监听者与按钮三态（RN useTimeInfo）

    @Test
    fun addListenerFiresImmediately() {
        val timer = timer()
        val seen = mutableListOf<Int>()
        timer.addListener { remaining, _ -> seen += remaining }
        assertEquals(listOf(-1), seen)
    }

    @Test
    fun removingListenerStopsCallbacks() {
        val timer = timer()
        var callbacks = 0
        val remove = timer.addListener { _, _ -> callbacks++ }
        callbacks = 0
        timer.tick()
        assertEquals(1, callbacks)
        remove()
        timer.tick()
        assertEquals(1, callbacks)
    }

    @Test
    fun tickPushesCurrentRemaining() {
        val timer = timer()
        timer.start(30)
        nowMs = 10_000L
        val seen = mutableListOf<Int>()
        val remove = timer.addListener { remaining, _ -> seen += remaining }
        seen.clear()
        timer.tick()
        assertEquals(listOf(20), seen)
        remove()
    }

    @Test
    fun buttonModeMatchesRnUseTimeInfo() {
        assertEquals(SleepTimer.ButtonMode.COUNTING, SleepTimer.buttonMode(0, false))
        assertEquals(SleepTimer.ButtonMode.COUNTING, SleepTimer.buttonMode(120, false))
        // 「更新定时」只在计时中出现
        assertEquals(SleepTimer.ButtonMode.WAITING_EXIT, SleepTimer.buttonMode(-1, true))
        assertEquals(SleepTimer.ButtonMode.OFF, SleepTimer.buttonMode(-1, false))
    }

    // endregion

    // region 输入解析（RN rxp = /([1-9]\d*)/ + MAX_MIN）

    @Test
    fun parseMinutesAcceptsPlainNumbers() {
        assertEquals(SleepTimer.MinutesInput.Valid(30), SleepTimer.parseMinutes("30"))
        assertEquals(SleepTimer.MinutesInput.Valid(45), SleepTimer.parseMinutes("  45  "))
        assertEquals(SleepTimer.MinutesInput.Valid(1440), SleepTimer.parseMinutes("1440"))
    }

    @Test
    fun parseMinutesExtractsFirstDigitRunLikeJsRegExp() {
        // RN 用 RegExp.$1，所以掺在文字里的数字照样能取出来
        assertEquals(SleepTimer.MinutesInput.Valid(12), SleepTimer.parseMinutes("abc12"))
        assertEquals(SleepTimer.MinutesInput.Valid(5), SleepTimer.parseMinutes("-5"))
        assertEquals(SleepTimer.MinutesInput.Valid(30), SleepTimer.parseMinutes("30分钟"))
    }

    @Test
    fun parseMinutesRejectsLeadingZero() {
        // [1-9] 打头，"0" 与 "0x" 都取不到数字 → RN 走 input_error 支
        assertEquals(SleepTimer.MinutesInput.Invalid, SleepTimer.parseMinutes("0"))
        assertEquals(SleepTimer.MinutesInput.Invalid, SleepTimer.parseMinutes("分钟"))
    }

    @Test
    fun parseMinutesBlankIsSilentlyEmpty() {
        // RN: if (!timeStr) return —— 空输入不 toast、不开始计时
        assertEquals(SleepTimer.MinutesInput.Empty, SleepTimer.parseMinutes(""))
        assertEquals(SleepTimer.MinutesInput.Empty, SleepTimer.parseMinutes("   "))
    }

    @Test
    fun parseMinutesCapsAtMaxMin() {
        assertEquals(SleepTimer.MinutesInput.TooLong, SleepTimer.parseMinutes("1441"))
        assertEquals(SleepTimer.MinutesInput.TooLong, SleepTimer.parseMinutes("99999"))
        // JS 里 parseInt 得到巨大浮点数仍 >MAX_MIN；Kotlin 溢出到 null 走同一支
        assertEquals(SleepTimer.MinutesInput.TooLong, SleepTimer.parseMinutes("99999999999999999999"))
    }

    // endregion

    // region formatTime（RN TimeoutExitEditModal.tsx:17-27）

    @Test
    fun formatTimeOmitsHoursWhenZero() {
        assertEquals("00:00", SleepTimer.formatTime(0))
        assertEquals("00:59", SleepTimer.formatTime(59))
        assertEquals("01:30", SleepTimer.formatTime(90))
        assertEquals("10:05", SleepTimer.formatTime(605))
    }

    @Test
    fun formatTimeAddsHourWithoutPadding() {
        assertEquals("1:00:00", SleepTimer.formatTime(3_600))
        assertEquals("1:01:01", SleepTimer.formatTime(3_661))
        assertEquals("23:59:59", SleepTimer.formatTime(24 * 3_600 - 1))
    }

    // endregion
}
