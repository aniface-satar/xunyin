package cn.toside.music.nativeapp.data

import android.content.Context
import cn.toside.music.core.storage.ShardedKvStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull

/** 被隐藏的一张歌单：名字只为 UI 展示（用户认不出 `source::id`），判定只看键。 */
data class HiddenPlaylistEntry(
    val name: String = "",
    val hiddenAt: Long = 0,
)

/**
 * 被「不感兴趣」隐藏的歌单 —— M1 的 `PlaylistRankState.hidden` 一直在等这个写入方。
 *
 * 键位与 RN 分开（RN 把隐藏歌单混在 `xunyin_recommend_state_v2` 里，形状不同不互解析）。
 * 歌单 key 走 `PlaylistRank.normalizePlaylistKey`（`source::id`），与排序侧的判定同源，
 * 否则「隐藏了但排完还在」这种 bug 会非常难查。
 *
 * 除 key 外还存了名字与隐藏时间：排序侧只要时间戳（[timestamps]），
 * UI 侧要名字（[entries]）——两件事分两个出口，别让 UI 去解析 `source::id`。
 *
 * 形状是手写的 `{key: {name, hiddenAt}}` 而不是 `@Serializable`：`:app` 模块没挂
 * kotlinx-serialization 编译器插件（`:core` 才有），这里只是一层薄存储，不值得为它加插件。
 *
 * 读盘失败时 [persistAllowed] 置 false：内存里是空表，磁盘上那份却可能不是空的，
 * 照常落盘会把用户的隐藏记录整张抹掉。
 */
class HiddenPlaylistStore(
    context: Context,
) {
    private val kv = ShardedKvStore(DataStoreKvStore(context.applicationContext))
    private val mutex = Mutex()

    @Volatile
    private var cache: Map<String, HiddenPlaylistEntry>? = null

    @Volatile
    private var persistAllowed = true

    suspend fun entries(force: Boolean = false): Map<String, HiddenPlaylistEntry> {
        cache?.takeIf { !force }?.let { return it }
        return mutex.withLock {
            cache?.takeIf { !force }?.let { return@withLock it }
            val loaded =
                withContext(Dispatchers.IO) {
                    runCatching { kv.getData<JsonObject>(KEY) }.getOrNull()
                }
            val parsed =
                runCatching { decode(loaded) }.getOrElse {
                    persistAllowed = false
                    emptyMap()
                }
            cache = parsed
            parsed
        }
    }

    /** 排序侧要的形状：key → 隐藏时间戳（`RecommendProfile.rankState(hidden = ...)`）。 */
    suspend fun timestamps(force: Boolean = false): Map<String, Long> = entries(force).mapValues { it.value.hiddenAt }

    /** 隐藏一张歌单（重复隐藏刷新时间戳与名字，幂等）。 */
    suspend fun hide(
        playlistKey: String,
        name: String,
        now: Long,
    ): Map<String, HiddenPlaylistEntry> {
        if (playlistKey.isEmpty()) return entries()
        val next = entries() + (playlistKey to HiddenPlaylistEntry(name = name, hiddenAt = now))
        persist(next)
        return next
    }

    suspend fun unhide(playlistKey: String): Map<String, HiddenPlaylistEntry> {
        val current = entries()
        if (!current.containsKey(playlistKey)) return current
        val next = current - playlistKey
        persist(next)
        return next
    }

    suspend fun clear() {
        withContext(Dispatchers.IO) { runCatching { kv.removeData(KEY) } }
        cache = emptyMap()
    }

    private suspend fun persist(map: Map<String, HiddenPlaylistEntry>) {
        cache = map
        if (!persistAllowed) return
        val payload = JsonObject(map.mapValues { (_, entry) -> encode(entry) })
        withContext(Dispatchers.IO) { runCatching { kv.saveData(KEY, payload) } }
    }

    private fun encode(entry: HiddenPlaylistEntry): JsonObject =
        JsonObject(
            mapOf(
                "name" to JsonPrimitive(entry.name),
                "hiddenAt" to JsonPrimitive(entry.hiddenAt),
            ),
        )

    /** 丢掉认不出的条目而不是整表失败：一条脏数据不该让用户的隐藏记录全灭。 */
    private fun decode(root: JsonObject?): Map<String, HiddenPlaylistEntry> {
        if (root == null) return emptyMap()
        val result = mutableMapOf<String, HiddenPlaylistEntry>()
        for ((key, value) in root) {
            val obj = value as? JsonObject ?: continue
            val name = (obj["name"] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.contentOrNull.orEmpty()
            val hiddenAt = (obj["hiddenAt"] as? JsonPrimitive)?.longOrNull ?: 0L
            result[key] = HiddenPlaylistEntry(name = name, hiddenAt = hiddenAt)
        }
        return result
    }

    companion object {
        const val KEY = "xunyin_recommend_hidden_playlist_v1"
    }
}
