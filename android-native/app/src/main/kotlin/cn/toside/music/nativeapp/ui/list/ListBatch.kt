package cn.toside.music.nativeapp.ui.list

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * 列表页批量操作的纯规则（与 Compose/存储无关，便于 JVM 单测）。
 *
 * 去重口径与 `ListStore.listMusicAdd` 一致（目标列表已有 + 本批次内重复都跳过），
 * 但 `listMusicAdd` 只回受影响列表 id，界面要展示跳过数量，所以先预演一次。
 */
object ListBatch {
    data class CollectPlan(
        val toAdd: List<JsonObject>,
        val skipped: Int,
    )

    /** 「收藏全部」/整单加入：保留原顺序，缺 id 的条目无法落库，按跳过计。 */
    fun planCollect(
        existing: List<JsonObject>,
        items: List<JsonObject>,
    ): CollectPlan {
        val seen = mutableSetOf<String>()
        existing.forEach { item -> item.idOrNull()?.let(seen::add) }
        val toAdd = mutableListOf<JsonObject>()
        var skipped = 0
        items.forEach { item ->
            val id = item.idOrNull()
            if (id == null || !seen.add(id)) skipped++ else toAdd.add(item)
        }
        return CollectPlan(toAdd, skipped)
    }

    private fun JsonObject.idOrNull(): String? =
        (this["id"] as? JsonPrimitive)
            ?.takeIf { it !is JsonNull }
            ?.content
            ?.takeIf { it.isNotEmpty() }
}
