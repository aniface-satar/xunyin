package cn.toside.music.nativeapp.userapi

import cn.toside.music.core.data.DataRepository
import cn.toside.music.core.setting.SettingsStore
import cn.toside.music.core.storage.InMemoryKvStore
import cn.toside.music.core.storage.ShardedKvStore
import cn.toside.music.core.userapi.UserApiUpdateCheckMode
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 「音源更新设置读的是设置层，不是硬编码默认值」—— B3 已知差异第 4 条。
 *
 * 对照 RN `defaultSetting.ts`：`common.userApiUpdateCheck` 默认 daily、
 * `common.userApiAutoUpdate` 默认开、`common.userApiAllowShowUpdateAlert` 默认关。
 */
class UpdaterSettingsTest {
    private fun store(kv: InMemoryKvStore = InMemoryKvStore()): SettingsStore = SettingsStore(DataRepository(ShardedKvStore(kv)))

    @Test
    fun defaultsMatchRnDefaultSetting() {
        val settings = UpdaterSettingsFrom.of(store())

        assertEquals(UserApiUpdateCheckMode.DAILY, settings.checkMode)
        assertTrue(settings.autoUpdate)
        assertFalse(settings.allowShowUpdateAlert)
    }

    @Test
    fun userChoicesAreReadBack() =
        runBlocking {
            val kv = InMemoryKvStore()
            val store = SettingsStore(DataRepository(ShardedKvStore(kv)))

            store.set(UpdaterSettingsFrom.KEY_CHECK_MODE, "weekly")
            store.set(UpdaterSettingsFrom.KEY_AUTO_UPDATE, false)
            store.set(UpdaterSettingsFrom.KEY_ALLOW_ALERT, true)

            val settings = UpdaterSettingsFrom.of(store)
            assertEquals(UserApiUpdateCheckMode.WEEKLY, settings.checkMode)
            assertFalse(settings.autoUpdate)
            assertTrue(settings.allowShowUpdateAlert)

            // 另一份设置实例从同一个存储读：设置页写一次，运行时到处能看到
            val reopened = SettingsStore(DataRepository(ShardedKvStore(kv)))
            reopened.load()
            val reloaded = UpdaterSettingsFrom.of(reopened)
            assertEquals(UserApiUpdateCheckMode.WEEKLY, reloaded.checkMode)
            assertFalse(reloaded.autoUpdate)
            assertTrue(reloaded.allowShowUpdateAlert)
        }

    @Test
    fun frequencyStringsMapToModes() {
        assertEquals(UserApiUpdateCheckMode.OFF, UpdaterSettingsFrom.checkMode("off"))
        assertEquals(UserApiUpdateCheckMode.STARTUP, UpdaterSettingsFrom.checkMode("startup"))
        assertEquals(UserApiUpdateCheckMode.DAILY, UpdaterSettingsFrom.checkMode("daily"))
        assertEquals(UserApiUpdateCheckMode.WEEKLY, UpdaterSettingsFrom.checkMode("weekly"))
        // 认不出的串按每天：写坏的值不该让后台检查整个停掉
        assertEquals(UserApiUpdateCheckMode.DAILY, UpdaterSettingsFrom.checkMode("every-minute"))
        assertEquals(UserApiUpdateCheckMode.DAILY, UpdaterSettingsFrom.checkMode(null))
    }

    @Test
    fun alertSettingsFollowTheSameTwoSwitches() {
        val settings =
            UpdaterSettings(
                checkMode = UserApiUpdateCheckMode.OFF,
                autoUpdate = false,
                allowShowUpdateAlert = true,
            )

        val alerts = settings.toAlertSettings()

        assertFalse(alerts.autoUpdate)
        assertTrue(alerts.allowShowUpdateAlert)
    }
}
