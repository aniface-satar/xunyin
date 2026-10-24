package cn.toside.music.core.data

import cn.toside.music.core.storage.ShardedKvStore
import cn.toside.music.core.storage.StorageKeys
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray

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
}
