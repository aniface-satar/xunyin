package cn.toside.music.core.data

import cn.toside.music.core.storage.ShardedKvStore
import cn.toside.music.core.storage.StorageKeys
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.put

/**
 * 持久化数据仓库 —— RN 侧 src/utils/data.ts 的核心存取函数移植。
 *
 * 覆盖 B1 验收所需的链路：设置、用户列表、列表内歌曲、
 * 歌词、音乐 URL、其他源信息。剩余长尾键随 B2+/B6 需要再补。
 *
 * 节流写入（RN throttle 1000ms）由调用方（ViewModel/Store）控制，
 * 这里保持与 RN data.ts 相同的直写语义。
 */
class DataRepository(
    private val kv: ShardedKvStore,
) {
    private val json = Json

    // ---------- 设置 ----------

    suspend fun getSetting(): JsonObject? = kv.getData(StorageKeys.SETTING)

    suspend fun saveSetting(setting: JsonObject) = kv.saveData(StorageKeys.SETTING, setting)

    // ---------- 用户列表 ----------

    /** getUserLists：兼容 PC 端 v2.3.0 数字 id 尾缀 ".0" 修复。 */
    suspend fun getUserLists(): List<JsonObject> {
        val list = kv.getData<JsonArray>(StorageKeys.USER_LIST) ?: return emptyList()
        return list.mapNotNull { el ->
            (el as? JsonObject)?.let { info ->
                val sourceListId = (info["sourceListId"] as? JsonPrimitive)?.content
                if (sourceListId != null && sourceListId.endsWith(".0")) {
                    JsonObject(info.toMutableMap() + ("sourceListId" to JsonPrimitive(sourceListId.replace(Regex("\\.0$"), ""))))
                } else {
                    info
                }
            }
        }
    }

    suspend fun saveUserList(listInfo: List<JsonObject>) = kv.saveData(StorageKeys.USER_LIST, JsonArray(listInfo))

    // ---------- 列表内歌曲 ----------

    suspend fun getListMusics(listId: String): List<JsonElement> =
        kv.getData<JsonArray>(StorageKeys.LIST_PREFIX + listId)?.jsonArray ?: emptyList()

    suspend fun saveListMusics(listData: List<Pair<String, List<JsonElement>>>) {
        for ((id, musics) in listData) {
            kv.saveData(StorageKeys.LIST_PREFIX + id, JsonArray(musics))
        }
    }

    suspend fun removeListMusics(ids: List<String>) = kv.removeDataMultiple(ids.map { StorageKeys.LIST_PREFIX + it })

    // ---------- 歌词 ----------

    suspend fun getLyric(musicId: String): JsonObject =
        kv.getData(StorageKeys.LYRIC_PREFIX + musicId) ?: JsonObject(mapOf("lyric" to JsonPrimitive("")))

    suspend fun saveLyric(
        musicId: String,
        lyricInfo: JsonObject,
    ) = kv.saveData(StorageKeys.LYRIC_PREFIX + musicId, lyricInfo)

    // ---------- 音乐 URL ----------

    suspend fun getMusicUrl(
        musicId: String,
        type: String,
    ): String {
        val v = kv.getData<JsonPrimitive>(StorageKeys.MUSIC_URL_PREFIX + "${musicId}_$type")
        return v?.content ?: ""
    }

    suspend fun saveMusicUrl(
        musicId: String,
        type: String,
        url: String,
    ) = kv.saveString(StorageKeys.MUSIC_URL_PREFIX + "${musicId}_$type", url)

    // ---------- 音乐 URL 缓存（W6-1：带写入时间的取链缓存） ----------

    /** 读缓存记录（无记录 / 记录损坏都返回 null，等价于未命中）。 */
    suspend fun getMusicUrlEntry(
        musicId: String,
        type: String,
    ): MusicUrlEntry? {
        // 键上存过非对象值（手工改过 / 历史数据）时 getData 的泛型擦除会炸，这里按元素取再判类型
        val obj = kv.getData<JsonElement>(MusicUrlCache.key(musicId, type)) as? JsonObject ?: return null
        val url = (obj["url"] as? JsonPrimitive)?.contentOrNull ?: return null
        val savedAt = (obj["t"] as? JsonPrimitive)?.contentOrNull?.toLongOrNull() ?: return null
        return MusicUrlEntry(url = url, savedAt = savedAt)
    }

    /** 写缓存记录（键与 [getMusicUrl] 分开，不覆盖 RN 口径的纯 url 值）。 */
    suspend fun saveMusicUrlEntry(
        musicId: String,
        type: String,
        url: String,
        savedAt: Long,
    ) = kv.saveData(
        MusicUrlCache.key(musicId, type),
        buildJsonObject {
            put("url", url)
            put("t", savedAt)
        },
    )

    suspend fun clearMusicUrlEntry(
        musicId: String,
        type: String,
    ) = kv.removeData(MusicUrlCache.key(musicId, type))

    // ---------- 列表元数据（W8-C：add_time / play_count，对照 RN data.ts） ----------

    /** 读「添加时间」表：key 为 `${listId}/${musicId}`，值为 epoch 毫秒。 */
    suspend fun getMusicAddTimes(): Map<String, Long> = kv.getData<JsonObject>(StorageKeys.MUSIC_ADD_TIME).toLongMap()

    suspend fun saveMusicAddTimes(map: Map<String, Long>) = kv.saveData(StorageKeys.MUSIC_ADD_TIME, map.toJsonObject())

    /** 读「播放次数」表：key 为 musicId。 */
    suspend fun getMusicPlayCounts(): Map<String, Long> = kv.getData<JsonObject>(StorageKeys.MUSIC_PLAY_COUNT).toLongMap()

    suspend fun saveMusicPlayCounts(map: Map<String, Long>) = kv.saveData(StorageKeys.MUSIC_PLAY_COUNT, map.toJsonObject())

    // ---------- 其他源信息 ----------

    suspend fun getOtherSource(musicId: String): List<JsonElement> =
        kv.getData<JsonArray>(StorageKeys.MUSIC_OTHER_SOURCE_PREFIX + musicId)?.jsonArray ?: emptyList()

    suspend fun saveOtherSource(
        musicId: String,
        list: List<JsonElement>,
    ) = kv.saveData(StorageKeys.MUSIC_OTHER_SOURCE_PREFIX + musicId, JsonArray(list))

    // ---------- 列表位置/更新信息 ----------

    suspend fun getListPosition(id: String): Int {
        val obj = kv.getData<JsonObject>(StorageKeys.LIST_SCROLL_POSITION) ?: return 0
        return (obj[id] as? JsonPrimitive)?.content?.toIntOrNull() ?: 0
    }

    suspend fun saveListPosition(
        id: String,
        position: Int,
    ) {
        val obj = (kv.getData<JsonObject>(StorageKeys.LIST_SCROLL_POSITION)?.toMutableMap() ?: mutableMapOf())
        obj[id] = JsonPrimitive(position)
        kv.saveData(StorageKeys.LIST_SCROLL_POSITION, JsonObject(obj))
    }

    suspend fun getListPrevSelectId(): String {
        val v = kv.getData<JsonPrimitive>(StorageKeys.LIST_PREV_SELECT_ID)?.content
        return v ?: StorageKeys.ListIds.DEFAULT
    }

    suspend fun saveListPrevSelectId(id: String) = kv.saveString(StorageKeys.LIST_PREV_SELECT_ID, id)

    // ---------- 临时列表元信息 ----------

    suspend fun getTempListMeta(): JsonObject = kv.getData(StorageKeys.TEMP_LIST_META) ?: JsonObject(emptyMap())

    suspend fun saveTempListMeta(meta: JsonObject) = kv.saveData(StorageKeys.TEMP_LIST_META, meta)

    /** RN data.ts#setListUpdateTime：`@list_update_info` 记 id → `{ updateTime, isAutoUpdate }`。 */
    suspend fun setListUpdateTime(
        listId: String,
        time: Long,
    ) {
        val all = (kv.getData<JsonObject>(StorageKeys.LIST_UPDATE_INFO) ?: JsonObject(emptyMap())).toMutableMap()
        val entry = ((all[listId] as? JsonObject) ?: JsonObject(emptyMap())).toMutableMap()
        entry["updateTime"] = JsonPrimitive(time)
        if (!entry.containsKey("isAutoUpdate")) entry["isAutoUpdate"] = JsonPrimitive(false)
        all[listId] = JsonObject(entry)
        kv.saveData(StorageKeys.LIST_UPDATE_INFO, JsonObject(all))
    }

    // ---------- 内部 ----------

    /** RN `Record<string, number>` 的读取口径：忽略非数字值，损坏即空表。 */
    private fun JsonObject?.toLongMap(): Map<String, Long> {
        val map = mutableMapOf<String, Long>()
        this?.forEach { (key, value) ->
            val number = (value as? JsonPrimitive)?.contentOrNull?.toLongOrNull() ?: return@forEach
            map[key] = number
        }
        return map
    }

    private fun Map<String, Long>.toJsonObject(): JsonObject = JsonObject(mapValues { (_, value) -> JsonPrimitive(value) })
}

/** 一条取链缓存记录：[url] 是直链，[savedAt] 是写入时刻（毫秒）。 */
data class MusicUrlEntry(
    val url: String,
    val savedAt: Long,
)

/**
 * 取链缓存规则（W6-1）—— RN `src/utils/data.ts#getMusicUrl/saveMusicUrl` 的原生接线口径。
 *
 * ## RN 实证（2026-10-26）
 *
 * | 路径 | 键 | 读侧 | 写侧 |
 * |:--|:--|:--|:--|
 * | 在线取链 | `<id>_<quality>`，**音质入键** | 取链前（`cachedUrl && !isRefresh`，online.ts:56） | 成功后无条件覆盖；换源另存目标曲目键（online.ts:60-61） |
 * | 本地兜底直链 | **本地曲目 id + 固定 `128k`** | 取链前（utils.ts:161） | 成功后（local.ts:83） |
 * | 六级阶梯命中 | **在线目标曲目 id + 实际音质** | 取链前（utils.ts:263） | 成功后（local.ts:94，RN 自己留了 `// TODO: save url ?`） |
 *
 * ## 原生唯一增强：TTL
 *
 * RN 没有过期时间（只有 `isRefresh` 才跳过缓存），过期直链会一路播失败且没人兜。
 * 原生给每条记录带写入时间，[DEFAULT_TTL_MS] 之外按未命中处理（代价是一次重新取链，
 * 远小于播一个 403 直链的代价）。
 */
object MusicUrlCache {
    /** 缓存记录键后缀：与 RN 口径的纯 url 键（[DataRepository.saveMusicUrl]）分开存，互不覆盖。 */
    const val CACHE_KEY_SUFFIX: String = "_c"

    /** 本地兜底直链的音质键 —— RN `getOnlineOtherSourceMusicUrlByLocal` 固定 `128k`（utils.ts:159）。 */
    const val LOCAL_FALLBACK_QUALITY: String = "128k"

    /** 默认有效期 6 小时。 */
    const val DEFAULT_TTL_MS: Long = 6L * 60 * 60 * 1000

    fun key(
        musicId: String,
        type: String,
    ): String = StorageKeys.MUSIC_URL_PREFIX + "${musicId}_$type$CACHE_KEY_SUFFIX"

    /** 记录在有效期内才算命中（写入时间为 0 / 未来时间都算坏记录）。 */
    fun isFresh(
        savedAt: Long,
        now: Long,
        ttlMs: Long = DEFAULT_TTL_MS,
    ): Boolean = savedAt > 0 && now >= savedAt && now - savedAt < ttlMs

    /** 命中返回直链，未命中/过期返回 null。 */
    fun pick(
        entry: MusicUrlEntry?,
        now: Long,
        ttlMs: Long = DEFAULT_TTL_MS,
    ): String? = entry?.url?.takeIf { it.isNotEmpty() && isFresh(entry.savedAt, now, ttlMs) }
}
