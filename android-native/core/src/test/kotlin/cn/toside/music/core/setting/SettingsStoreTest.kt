package cn.toside.music.core.setting

import cn.toside.music.core.data.DataRepository
import cn.toside.music.core.storage.InMemoryKvStore
import cn.toside.music.core.storage.ShardedKvStore
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * SettingsStore 测试：对照 RN `config/setting.ts#mergeSetting` 的合并语义。
 */
class SettingsStoreTest {
    private fun newStore(): Pair<SettingsStore, DataRepository> {
        val repo = DataRepository(ShardedKvStore(InMemoryKvStore()))
        return SettingsStore(repo) to repo
    }

    @Test
    fun loadsDefaultsWhenNothingSaved() =
        runBlocking {
            val (store, _) = newStore()
            store.load()
            assertEquals(DefaultSetting.SETTING_VERSION, store.string("version"))
            assertEquals("128k", store.string("player.playQuality"))
            assertTrue(store.bool("player.isShowLyricTranslation"))
            assertEquals(1.0, store.double("player.volume"), 0.0001)
        }

    @Test
    fun mergesSavedPrimitivesAndIgnoresUnknownOrNull() =
        runBlocking {
            val (store, repo) = newStore()
            repo.saveSetting(
                buildJsonObject {
                    put("player.playQuality", "320k")
                    put("player.isShowLyricTranslation", false)
                    put("player.isShowLyricRoma", JsonNull)
                    put("player.isEnableVolumeBalancer", "not-a-bool")
                    put("unknown.key", "ignored")
                },
            )
            store.load()
            assertEquals("320k", store.string("player.playQuality"))
            assertEquals(false, store.bool("player.isShowLyricTranslation"))
            // null / 类型不符 / 未知键都不覆盖默认值
            assertEquals(false, store.bool("player.isShowLyricRoma"))
            assertEquals(false, store.bool("player.isEnableVolumeBalancer"))
            assertEquals(null, store.get("unknown.key"))
        }

    @Test
    fun mergeAcceptsDecimalJsonForIntegerDefaults() =
        runBlocking {
            // RN 的设置整表存 JSON 数字，桌面歌词滑杆写出来的 72 可能是 72.0。
            // 按默认类型 Int 收窄时不能把小数形式整条丢掉（否则滑杆值每次重启都回默认）。
            val (store, repo) = newStore()
            repo.saveSetting(
                buildJsonObject {
                    put("desktopLyric.width", 72.0)
                    put("desktopLyric.style.fontSize", 200.0)
                    put("desktopLyric.position.x", 33.5)
                },
            )
            store.load()
            assertEquals(72, store.int("desktopLyric.width"))
            assertEquals(200, store.int("desktopLyric.style.fontSize"))
            assertEquals(33, store.int("desktopLyric.position.x"))
        }

    @Test
    fun setPersistsAcrossInstancesAndKeepsVersion() =
        runBlocking {
            val (store, repo) = newStore()
            store.load()
            store.set("player.playQuality", "flac")
            store.set("list.addMusicLocationType", "bottom")

            val reloaded = SettingsStore(repo)
            reloaded.load()
            assertEquals("flac", reloaded.string("player.playQuality"))
            assertEquals("bottom", reloaded.string("list.addMusicLocationType"))
            assertEquals(DefaultSetting.SETTING_VERSION, reloaded.string("version"))
        }
}
