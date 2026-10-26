package cn.toside.music.core.player

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/**
 * 播放历史写入规则 —— RN `src/utils/data.ts:343-363` 的 `addPlayHistory` 纯规则部分。
 *
 * RN 存的每一条是 `{ musicInfo, listId, isTempPlay, playTime }`，
 * 以 `${listId ?? ''}__${musicInfo.id ?? ''}` 去重、最新在前、只保留 100 条。
 * 历史只服务持久化画像/大厅展示，与内存里的 `playedList` 无关：
 * 电台临时曲、普通列表曲都会各记一条（listId/isTempPlay 原样保留）。
 */
object PlayHistory {
    const val MAX_ITEMS = 100

    private const val KEY_SEPARATOR = "__"

    fun add(
        existing: List<JsonObject>,
        musicInfo: JsonObject,
        listId: String?,
        isTempPlay: Boolean,
        playTime: Long,
    ): List<JsonObject> {
        val key = itemKey(listId, musicInfo)
        val entry =
            buildJsonObject {
                put("musicInfo", musicInfo)
                put("listId", listId?.let(::JsonPrimitive) ?: kotlinx.serialization.json.JsonNull)
                put("isTempPlay", JsonPrimitive(isTempPlay))
                put("playTime", JsonPrimitive(playTime))
            }
        val deduped = existing.filter { itemKeyOf(it) != key }
        return (listOf(entry) + deduped).take(MAX_ITEMS)
    }

    /** 历史的去重键：列表 + 音源内 id；缺字段时退化为空串（与 RN 的 `?? ''` 一致）。 */
    fun itemKey(
        listId: String?,
        musicInfo: JsonObject,
    ): String = (listId ?: "") + KEY_SEPARATOR + (musicInfo.idKey() ?: "")

    /** 从已存条目反推去重键（旧数据缺字段按空串处理）。 */
    fun itemKeyOf(item: JsonObject): String {
        val listId = (item["listId"] as? JsonPrimitive)?.content
        val musicInfo = item["musicInfo"] as? JsonObject
        return itemKey(listId, musicInfo ?: JsonObject(emptyMap()))
    }
}
