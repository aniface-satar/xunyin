package cn.toside.music.core.setting

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * SettingMerger / DefaultSetting 测试：对照 RN 侧 src/config/setting.ts。
 */
class SettingMergerTest {
    @Test
    fun defaultSettingTableComplete() {
        val d = DefaultSetting.base
        // RN defaultSetting.ts 的键数（version + 全部配置键）
        assertEquals(80, d.size)
        assertEquals("2.2", d["version"])
        assertEquals(DefaultSetting.DEFAULT_BUILTIN_API_SOURCE_ID, d["common.apiSource"])
        assertEquals("cyan", d["theme.id"])
        assertEquals("listLoop", d["player.togglePlayMethod"])
        assertEquals("blur", d["theme.dynamicBgAlgorithm"])
    }

    @Test
    fun newYearSkinAppliedInJanuary() {
        val d = DefaultSetting.defaultSetting(month = 1)
        assertEquals("happy_new_year", d["theme.id"])
        assertEquals("rgba(255, 18, 34, 1)", d["desktopLyric.style.lyricPlayedColor"])
    }

    @Test
    fun newYearSkinNotAppliedInMarch() {
        val d = DefaultSetting.defaultSetting(month = 3)
        assertEquals("cyan", d["theme.id"])
        assertEquals("rgba(7, 197, 86, 1)", d["desktopLyric.style.lyricPlayedColor"])
    }

    @Test
    fun mergeUpdatesOnlyChangedPrimitives() {
        val origin =
            mapOf(
                "a" to "1",
                "b" to true,
                "c" to 3,
            )
        val target =
            mapOf(
                "a" to "1", // 未变
                "b" to false, // 变化
                "d" to "new", // origin 没有的键
            )
        val result = SettingMerger.merge(origin, target)
        // origin 键多 → 按 target 键遍历；origin 没有的键跳过
        assertEquals(listOf("b"), result.updatedKeys)
        assertEquals(mapOf("b" to false), result.updatedSetting)
        assertEquals(false, result.setting["b"])
        assertEquals("1", result.setting["a"])
        assertFalse(result.setting.containsKey("d"))
    }

    @Test
    fun mergeSkipsNonPrimitiveValues() {
        val origin = mapOf("a" to "1", "b" to "2")
        val target = mapOf("a" to listOf("x"), "b" to "changed") // a 是非 primitive
        val result = SettingMerger.merge(origin, target)
        assertEquals(listOf("b"), result.updatedKeys)
        assertEquals("1", result.setting["a"])
    }

    @Test
    fun initMergeMigratesOldVersions() {
        // 模拟 v2.0 存量配置：强制切默认音源 + 预载开关（对应 RN initSetting 的迁移逻辑）
        val stored =
            mutableMapOf<String, Any?>(
                "version" to "2.0",
                "common.apiSource" to "kw_open",
                "player.preloadNextMusic" to false,
                "theme.id" to "green",
            )
        if (SettingMerger.compareVer(stored["version"] as String, "2.1") < 0) {
            stored["common.apiSource"] = DefaultSetting.DEFAULT_BUILTIN_API_SOURCE_ID
        }
        if (SettingMerger.compareVer(stored["version"] as String, "2.2") < 0) {
            stored["player.preloadNextMusic"] = true
            if (stored["player.preloadNextMusicAudio"] != "full") stored["player.preloadNextMusicAudio"] = "head"
        }
        val result = SettingMerger.initMerge(stored)
        assertEquals(DefaultSetting.SETTING_VERSION, result.setting["version"])
        assertEquals("green", result.setting["theme.id"]) // 用户偏好保留
        assertTrue(result.updatedKeys.contains("theme.id"))
    }

    @Test
    fun initMergeWithNullKeepsDefaults() {
        val result = SettingMerger.initMerge(null)
        assertEquals(DefaultSetting.base["theme.id"], result.setting["theme.id"])
        assertTrue(result.updatedKeys.isEmpty())
    }

    @Test
    fun compareVerSemantics() {
        assertEquals(-1, SettingMerger.compareVer("2.0", "2.1"))
        assertEquals(0, SettingMerger.compareVer("2.2", "2.2"))
        assertEquals(1, SettingMerger.compareVer("2.10", "2.2"))
        assertEquals(-1, SettingMerger.compareVer("", "2.2"))
    }
}
