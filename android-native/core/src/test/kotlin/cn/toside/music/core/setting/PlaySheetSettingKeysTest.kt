package cn.toside.music.core.setting

import cn.toside.music.core.data.DataRepository
import cn.toside.music.core.storage.InMemoryKvStore
import cn.toside.music.core.storage.ShardedKvStore
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 播放页弹层（S11）依赖的设置键契约。
 *
 * 任务书原本要求「往 DefaultSetting 追加定时关闭/歌词字号等键」，实测这些键
 * 早已从 RN `src/config/defaultSetting.ts` 全量移植过来了，所以本车道没有改 DefaultSetting.kt
 * （顺带也不与 Lane B 撞同一个文件）。这个测试就是把这个结论钉住：
 * 键存在、默认值与 RN 一致、并且弹层实际用的那个 getter 读写往返不丢类型。
 */
class PlaySheetSettingKeysTest {
    private fun newStore(): Pair<SettingsStore, DataRepository> {
        val repo = DataRepository(ShardedKvStore(InMemoryKvStore()))
        return SettingsStore(repo) to repo
    }

    @Test
    fun defaultsMatchRnConfig() {
        val defaults = DefaultSetting.base
        assertEquals("128k", defaults["player.playQuality"]) // defaultSetting.ts:27
        assertEquals(1.0, defaults["player.volume"]) // :29
        assertEquals(1.0, defaults["player.playbackRate"]) // :30
        assertEquals("", defaults["player.timeoutExit"]) // :34
        assertEquals(true, defaults["player.timeoutExitPlayed"]) // :35
        assertEquals(true, defaults["player.isShowLyricTranslation"]) // :41
        assertEquals(false, defaults["player.isShowLyricRoma"]) // :42
        assertEquals(210, defaults["playDetail.vertical.style.lrcFontSize"]) // :51
    }

    @Test
    fun storeGettersSeeDefaultsWithoutLoading() {
        // 弹层是「先读后写」的：未 load 时也必须拿得到默认值，不能读成 0/false
        val (store, _) = newStore()
        assertEquals(1.0, store.double("player.volume"), 0.0001)
        assertEquals(1.0, store.double("player.playbackRate"), 0.0001)
        assertEquals(210, store.int("playDetail.vertical.style.lrcFontSize"))
        assertEquals("", store.string("player.timeoutExit"))
        assertEquals(true, store.bool("player.timeoutExitPlayed"))
    }

    @Test
    fun writeReadRoundTripKeepsTypes() =
        runBlocking {
            val (store, repo) = newStore()
            store.load()
            // 这些正是播放弹层各自写入的形状：音量/倍速写 Double，字号写 Int，分钟数写 String
            store.set("player.volume", 0.87)
            store.set("player.playbackRate", 1.25)
            store.set("playDetail.vertical.style.lrcFontSize", 180)
            store.set("player.timeoutExit", "30")
            store.set("player.timeoutExitPlayed", false)

            val reloaded = SettingsStore(repo)
            reloaded.load()
            assertEquals(0.87, reloaded.double("player.volume"), 0.0001)
            assertEquals(1.25, reloaded.double("player.playbackRate"), 0.0001)
            assertEquals(180, reloaded.int("playDetail.vertical.style.lrcFontSize"))
            assertEquals("30", reloaded.string("player.timeoutExit"))
            assertEquals(false, reloaded.bool("player.timeoutExitPlayed"))
        }

    @Test
    fun integerStoredVolumeStillReadsAsDouble() =
        runBlocking {
            val (store, repo) = newStore()
            // RN 侧默认值写的是 `1`（整数样子），JSON 里也可能落盘成 1；
            // 若按 Int 收下，弹层的 `store.double(...) * 100` 会读成 0，音量条直接归零。
            repo.saveSetting(
                buildJsonObject {
                    put("player.volume", 1)
                    put("player.playbackRate", 1)
                },
            )
            store.load()
            assertEquals(1.0, store.double("player.volume"), 0.0001)
            assertEquals(1.0, store.double("player.playbackRate"), 0.0001)
        }
}
