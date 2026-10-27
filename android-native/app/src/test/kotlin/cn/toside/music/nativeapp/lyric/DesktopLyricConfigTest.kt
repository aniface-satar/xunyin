package cn.toside.music.nativeapp.lyric

import cn.toside.music.core.data.DataRepository
import cn.toside.music.core.setting.SettingsStore
import cn.toside.music.core.storage.InMemoryKvStore
import cn.toside.music.core.storage.ShardedKvStore
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 桌面歌词位置百分比读侧（W7-1 收口）。
 *
 * 浮窗服务拖动松手后写的是两位小数的浮点（RN 同形状）；读侧必须用 `double()` 读，
 * 旧的 `Int` 字段 + `int()` 会把 33.5 截成 33。
 *
 * 重启全链路（merge 按默认值类型收窄）的等值往返由 Lane A 的
 * `DefaultSetting` 键表改动解锁（`SettingsStoreTest` 已锁 33.5 重启用例），
 * 本车道只锁读侧：store 里的 Double 必须原样读出来。
 */
class DesktopLyricConfigTest {
    private fun newStore(): SettingsStore = SettingsStore(DataRepository(ShardedKvStore(InMemoryKvStore())))

    @Test
    fun fractionalPositionReadsBackWithoutTruncation() =
        runBlocking {
            val store = newStore()
            store.load()
            store.set(DesktopLyricKeys.POSITION_X, 33.5)
            store.set(DesktopLyricKeys.POSITION_Y, 12.25)

            val config = store.desktopLyricConfig()
            assertEquals(33.5, config.positionX, 0.0001)
            assertEquals(12.25, config.positionY, 0.0001)
        }

    @Test
    fun missingPositionKeysReadAsZeroPercent() =
        runBlocking {
            val store = newStore()
            store.load()
            // 默认 0.0：浮窗贴左上角（对照 RN 未设置时的行为）
            val config = store.desktopLyricConfig()
            assertEquals(0.0, config.positionX, 0.0001)
            assertEquals(0.0, config.positionY, 0.0001)
        }
}
