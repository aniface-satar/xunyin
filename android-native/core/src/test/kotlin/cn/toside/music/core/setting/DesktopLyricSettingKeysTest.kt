package cn.toside.music.core.setting

import cn.toside.music.core.data.DataRepository
import cn.toside.music.core.storage.InMemoryKvStore
import cn.toside.music.core.storage.ShardedKvStore
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 桌面歌词（S10）设置键契约。
 *
 * 任务书原本要求「追加 desktopLyric.* 键」，实测 RN `src/config/defaultSetting.ts:55-69`
 * 的 15 个键在 Wave1 就全量移植过来了，所以本车道不改 `DefaultSetting.kt`。
 * 这个测试把结论钉住：键集合不多不少、默认值逐键对照 RN，并锁住
 * `defaultSetting.ts:103-106` 的 1、2 月新年皮肤覆盖。
 */
class DesktopLyricSettingKeysTest {
    /** RN defaultSetting.ts:55-69 的原文。 */
    private val rnDefaults =
        mapOf(
            "desktopLyric.enable" to false,
            "desktopLyric.isLock" to false,
            "desktopLyric.width" to 100,
            "desktopLyric.maxLineNum" to 5,
            "desktopLyric.isSingleLine" to false,
            "desktopLyric.showToggleAnima" to true,
            "desktopLyric.position.x" to 0,
            "desktopLyric.position.y" to 0,
            "desktopLyric.textPosition.x" to "left",
            "desktopLyric.textPosition.y" to "top",
            "desktopLyric.style.fontSize" to 180,
            "desktopLyric.style.opacity" to 100,
            "desktopLyric.style.lyricUnplayColor" to "rgba(255, 255, 255, 1)",
            "desktopLyric.style.lyricPlayedColor" to "rgba(7, 197, 86, 1)",
            "desktopLyric.style.lyricShadowColor" to "rgba(0, 0, 0, 0.6)",
        )

    @Test
    fun keySetMatchesRnExactly() {
        val actual = DefaultSetting.base.filterKeys { it.startsWith("desktopLyric.") }
        assertEquals(15, actual.size)
        assertEquals(rnDefaults, actual)
    }

    @Test
    fun newYearSkinOverridesPlayedColorOnlyInJanAndFeb() {
        for (month in listOf(1, 2)) {
            val settings = DefaultSetting.defaultSetting(month)
            assertEquals("happy_new_year", settings["theme.id"])
            assertEquals("rgba(255, 18, 34, 1)", settings["desktopLyric.style.lyricPlayedColor"])
            // 其余桌面歌词键不受皮肤影响
            val actual = settings.filterKeys { it.startsWith("desktopLyric.") } - "desktopLyric.style.lyricPlayedColor"
            assertEquals(rnDefaults - "desktopLyric.style.lyricPlayedColor", actual)
        }
        for (month in listOf(3, 12)) {
            assertEquals("cyan", DefaultSetting.defaultSetting(month)["theme.id"])
            assertEquals("rgba(7, 197, 86, 1)", DefaultSetting.defaultSetting(month)["desktopLyric.style.lyricPlayedColor"])
        }
    }

    @Test
    fun newYearOverrideDoesNotMutateBase() {
        DefaultSetting.defaultSetting(month = 1)
        assertEquals("rgba(7, 197, 86, 1)", DefaultSetting.base["desktopLyric.style.lyricPlayedColor"])
    }

    @Test
    fun storeSeesDefaultsBeforeLoading() {
        val store = SettingsStore(DataRepository(ShardedKvStore(InMemoryKvStore())))
        assertEquals(false, store.bool("desktopLyric.enable"))
        assertEquals(100, store.int("desktopLyric.width"))
        assertEquals(5, store.int("desktopLyric.maxLineNum"))
        assertEquals(180, store.int("desktopLyric.style.fontSize"))
        assertEquals("rgba(7, 197, 86, 1)", store.string("desktopLyric.style.lyricPlayedColor"))
        assertEquals("left", store.string("desktopLyric.textPosition.x"))
    }

    @Test
    fun toggleAndDragRoundTrip() =
        runBlocking {
            val repo = DataRepository(ShardedKvStore(InMemoryKvStore()))
            val store = SettingsStore(repo)
            store.load()
            store.set("desktopLyric.enable", true)
            // position.* 默认值是 Int，SettingsStore.merge 会按默认类型收窄：
            // 写 Double 会在重载时被丢弃（RN 原版不做收窄）。本车道只能存整数百分比。
            store.set("desktopLyric.position.x", 33)
            store.set("desktopLyric.position.y", 13)

            val reloaded = SettingsStore(repo)
            reloaded.load()
            assertEquals(true, reloaded.bool("desktopLyric.enable"))
            assertEquals(33, reloaded.int("desktopLyric.position.x"))
            assertEquals(13.0, reloaded.double("desktopLyric.position.y"), 1e-9)
        }
}
