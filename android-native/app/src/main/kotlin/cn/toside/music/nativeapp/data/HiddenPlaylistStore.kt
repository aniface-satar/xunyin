package cn.toside.music.nativeapp.data

import android.content.Context
import cn.toside.music.core.storage.ShardedKvStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.longOrNull

/**
 * 被「不感兴趣」隐藏的歌单 —— M1 的 `PlaylistRankState.hidden` 一直在等这个写入方。
 *
 * 键位与 RN 分开（RN 把隐藏歌单混在 `xunyin_recommend_state_v2` 里，形状不同不互解析）。
 * 值是隐藏时间戳，供后续做「隐藏 90 天后自动恢复」之类的策略；当前只用于过滤。
 *
 * 歌单 key 走 `PlaylistRank.normalizePlaylistKey`（`source::id`），与排序侧的判定同源，
 * 否则「隐藏了但排完还在」这种 bug 会非常难查。
 */
class HiddenPlaylistStore(
    context: Context,
) {
    private val kv = ShardedKvStore(DataStoreKvStore(context.applicationContext))
    private val mutex = Mutex()

    @Volatile
    private var cache: Map<String, Long>? = null

    suspend fun all(force: Boolean = false): Map<String, Long> {
        cache?.takeIf { !force }?.let { return it }
        return mutex.withLock {
            cache?.takeIf { !force }?.let { return@withLock it }
            val loaded =
                withContext(Dispatchers.IO) {
                    runCatching { kv.getData<JsonObject>(KEY) }.getOrNull()
                }
            val parsed =
                buildMap {
                    loaded?.forEach { (key, value) ->
                        (value as? JsonPrimitive)?.longOrNull?.let { put(key, it) }
                    }
                }
            cache = parsed
            parsed
        }
    }

    /** 隐藏一张歌单（重复隐藏刷新时间戳，幂等）。 */
    suspend fun hide(
        playlistKey: String,
        now: Long,
    ): Map<String, Long> {
        if (playlistKey.isEmpty()) return all()
        val next = all() + (playlistKey to now)
        persist(next)
        cache = next
        return next
    }

    suspend fun unhide(playlistKey: String): Map<String, Long> {
        val current = all()
        if (!current.containsKey(playlistKey)) return current
        val next = current - playlistKey
        persist(next)
        cache = next
        return next
    }

    suspend fun clear() {
        withContext(Dispatchers.IO) { runCatching { kv.removeData(KEY) } }
        cache = emptyMap()
    }

    private suspend fun persist(map: Map<String, Long>) {
        withContext(Dispatchers.IO) {
            runCatching {
                kv.saveData(KEY, JsonObject(map.mapValues { JsonPrimitive(it.value) }))
            }
        }
    }

    companion object {
        const val KEY = "xunyin_recommend_hidden_playlist_v1"
    }
}
