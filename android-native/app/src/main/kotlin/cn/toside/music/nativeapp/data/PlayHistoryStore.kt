package cn.toside.music.nativeapp.data

import android.content.Context
import cn.toside.music.core.player.PlayHistory
import cn.toside.music.core.player.PlayMusicInfo
import cn.toside.music.core.storage.ShardedKvStore
import cn.toside.music.core.storage.StorageKeys
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray

/**
 * `@play_history` 写入方（Wave4 Lane A 任务 1）—— 原生播控此前只读不写，
 * 画像的「最近听过」信号一直是空的。
 *
 * 纯规则（去重键、100 条上限、最新在前）在 `:core` [PlayHistory]；
 * 这里只做串行读改写，写入时机由 [cn.toside.music.core.player.PlayerCore.onAddPlayHistory]
 * 对齐 RN `player.ts` 的 `handlePlay` / restore 两条路径。
 */
class PlayHistoryStore(
    context: Context,
) {
    private val kv = ShardedKvStore(DataStoreKvStore(context.applicationContext))
    private val mutex = Mutex()

    suspend fun add(info: PlayMusicInfo) {
        val musicInfo = info.musicInfo ?: return
        mutex.withLock {
            val existing =
                runCatching {
                    kv.getData<JsonArray>(StorageKeys.PLAY_HISTORY)?.jsonArray.orEmpty()
                }.getOrNull().orEmpty()
            val next =
                PlayHistory.add(
                    existing = existing.filterIsInstance<JsonObject>(),
                    musicInfo = musicInfo,
                    listId = info.listId,
                    isTempPlay = info.isTempPlay,
                    playTime = System.currentTimeMillis(),
                )
            kv.saveData(StorageKeys.PLAY_HISTORY, JsonArray(next))
        }
    }
}
