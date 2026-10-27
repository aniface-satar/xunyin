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
 * 的 15 个键在 Wave1 就全量移植过来了。
 *
 * **Wave7 Lane C 追加了 2 个 RN 没有的键**（[w7Extras]）：桌面歌词独立的译文/罗马音开关。
 * RN 的桌面歌词跟播放页共用 `player.isShowLyric*` 两个开关，没有桌面专属键；本波按任务书
 * 在 `DefaultSetting` **表尾**追加，因此这里的断言从「键集合恰好等于 RN 15 键」改成
 * 「RN 15 键逐键不变 + 额外键只有这 2 个」，RN 那份契约一点没松。
 */
class DesktopLyricSettingKeysTest {
    /**
     * W7 追加：桌面歌词独立的译文/罗马音开关。
     * 默认两个都开 = 改造前观感（RN 桌面扩展行无条件显示，没有开关可继承）。
     */
    private val w7Extras =
        mapOf(
            "desktopLyric.isShowTranslation" to true,
            "desktopLyric.isShowRoma" to true,
        )

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
    fun rnKeySetIsIntactAndOnlyW7ExtrasAreAdded() {
        val actual = DefaultSetting.base.filterKeys { it.startsWith("desktopLyric.") }
        assertEquals(15 + 2, actual.size)
        // RN 那 15 键一个不差、一个不多
        assertEquals(rnDefaults, actual - w7Extras.keys)
        // 多出来的只有 W7 追加的桌面独立开关
        assertEquals(w7Extras, actual.filterKeys { it in w7Extras.keys })
    }

    @Test
    fun newYearSkinOverridesPlayedColorOnlyInJanAndFeb() {
        for (month in listOf(1, 2)) {
            val settings = DefaultSetting.defaultSetting(month)
            assertEquals("happy_new_year", settings["theme.id"])
            assertEquals("rgba(255, 18, 34, 1)", settings["desktopLyric.style.lyricPlayedColor"])
            // 其余桌面歌词键不受皮肤影响（含 W7 追加的 2 个开关）
            val actual = settings.filterKeys { it.startsWith("desktopLyric.") } - "desktopLyric.style.lyricPlayedColor"
            assertEquals((rnDefaults - "desktopLyric.style.lyricPlayedColor") + w7Extras, actual)
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
