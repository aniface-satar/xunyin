package cn.toside.music.nativeapp.ui.play

import cn.toside.music.core.player.SleepTimer
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 播放弹层的字号/定时关闭接线测试（纯 JVM）。
 *
 * 字号这条链路只有一处换算是「自定义」的：RN 设置里存的是 ×10 的整数
 * （`defaultSetting.ts:51` = 210），歌词渲染用 `lrcFontSize / 10`（`Vertical/Lyric.tsx:103`）。
 * 重启后能否恢复、越界值能否夹回来，全在 [lrcFontSizeTenths] 这一行，所以给它单独锁住。
 */
class PlaySettingSheetTest {
    @Test
    fun fontSizeReadsTenthsFromSetting() {
        // RN：设置 210 ⇒ 歌词 21sp
        assertEquals(210, lrcFontSizeTenths(mapOf(KEY_LRC_FONT_SIZE to 210)))
        // 数字类型宽进（DataStore 里可能是 210.0 这种 Double）
        assertEquals(220, lrcFontSizeTenths(mapOf(KEY_LRC_FONT_SIZE to 220.0)))
    }

    @Test
    fun fontSizeFallsBackToDefaultWhenKeyMissingOrWrongType() {
        assertEquals(210, lrcFontSizeTenths(emptyMap()))
        assertEquals(210, lrcFontSizeTenths(mapOf(KEY_LRC_FONT_SIZE to null)))
        assertEquals(210, lrcFontSizeTenths(mapOf(KEY_LRC_FONT_SIZE to "210")))
    }

    @Test
    fun fontSizeClampsToRnBounds() {
        // RN 滑杆区间 100..300（SettingLrcFontSize.tsx:45-48），脏数据要夹回区间
        assertEquals(100, lrcFontSizeTenths(mapOf(KEY_LRC_FONT_SIZE to 1)))
        assertEquals(300, lrcFontSizeTenths(mapOf(KEY_LRC_FONT_SIZE to 9999)))
    }

    @Test
    fun statusTextMatchesRnWording() {
        // RN `timeout_exit_tip_off` / `timeout_exit_tip_on`（TimeoutExitEditModal.tsx:34-42）
        assertEquals("设置定时停止播放", TimeoutExitRuntime.Status().statusText)
        assertEquals("05:00 后停止播放", TimeoutExitRuntime.Status(remainingSeconds = 300).statusText)
        assertEquals("1:00:00 后停止播放", TimeoutExitRuntime.Status(remainingSeconds = 3600).statusText)
    }

    @Test
    fun statusButtonModeFollowsRnThreeStates() {
        assertEquals(SleepTimer.ButtonMode.OFF, TimeoutExitRuntime.Status().buttonMode)
        assertEquals(SleepTimer.ButtonMode.COUNTING, TimeoutExitRuntime.Status(remainingSeconds = 10).buttonMode)
        assertEquals(
            SleepTimer.ButtonMode.WAITING_EXIT,
            TimeoutExitRuntime.Status(remainingSeconds = -1, isPlayedStop = true).buttonMode,
        )
    }
}
