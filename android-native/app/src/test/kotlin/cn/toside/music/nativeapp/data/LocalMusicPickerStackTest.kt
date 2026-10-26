package cn.toside.music.nativeapp.data

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 目录选择器宿主栈（集成会话补的装配点）。
 *
 * 背景：单槽实现在列表详情页退场时会 `pickerHandler = null`，把首页常驻的那一份
 * 一起清掉 —— 表现为「进过一次列表详情页，首页长按菜单的『添加本地歌曲』永久置灰」。
 * 这几条用例锁住「后注册优先、退场只弹自己那一层」。
 */
class LocalMusicPickerStackTest {
    private val home = Any()
    private val detail = Any()

    @After
    fun cleanup() {
        // 单例是进程级的，用例之间必须把注册表清干净
        LocalMusicRuntime.unregisterPicker(home)
        LocalMusicRuntime.unregisterPicker(detail)
    }

    @Test
    fun noPickerRegisteredMeansImportUnavailable() {
        assertFalse(LocalMusicRuntime.canStartImport())
        assertFalse(LocalMusicRuntime.importTo("list", "列表"))
    }

    @Test
    fun lastRegisteredPickerWins() {
        val calls = mutableListOf<String>()
        LocalMusicRuntime.registerPicker(home) { _, _ -> calls += "home" }
        LocalMusicRuntime.registerPicker(detail) { _, _ -> calls += "detail" }

        assertTrue(LocalMusicRuntime.importTo("list", "列表"))
        assertEquals(listOf("detail"), calls)
    }

    @Test
    fun unregisteringTopRestoresHomePicker() {
        val calls = mutableListOf<String>()
        LocalMusicRuntime.registerPicker(home) { _, _ -> calls += "home" }
        LocalMusicRuntime.registerPicker(detail) { _, _ -> calls += "detail" }
        LocalMusicRuntime.unregisterPicker(detail)

        // 详情页退场后首页入口必须还在（这就是单槽实现丢掉的语义）
        assertTrue(LocalMusicRuntime.canStartImport())
        assertTrue(LocalMusicRuntime.importTo("list", "列表"))
        assertEquals(listOf("home"), calls)
    }

    @Test
    fun unregisteringNonTopKeepsTop() {
        val calls = mutableListOf<String>()
        LocalMusicRuntime.registerPicker(home) { _, _ -> calls += "home" }
        LocalMusicRuntime.registerPicker(detail) { _, _ -> calls += "detail" }
        LocalMusicRuntime.unregisterPicker(home)

        assertTrue(LocalMusicRuntime.importTo("list", "列表"))
        assertEquals(listOf("detail"), calls)
    }

    @Test
    fun reRegisteringSameOwnerReplacesWithoutGrowing() {
        val calls = mutableListOf<String>()
        LocalMusicRuntime.registerPicker(home) { _, _ -> calls += "old" }
        LocalMusicRuntime.registerPicker(home) { _, _ -> calls += "new" }
        LocalMusicRuntime.registerPicker(detail) { _, _ -> calls += "detail" }
        // 首页那份被 detail 压住；弹掉 detail 后应回到「new」而不是「old」
        LocalMusicRuntime.unregisterPicker(detail)

        assertTrue(LocalMusicRuntime.importTo("list", "列表"))
        assertEquals(listOf("new"), calls)
    }
}
