package cn.toside.music.nativeapp.ui.songlist

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * 「批量加入我的歌单」的纯规则（与 Compose/存储无关，便于 JVM 单测）。
 *
 * `ListStore.listMusicAdd` 本身也会去重，但界面需要先知道跳过了几首，
 * 才能在全部重复时提示「该列表已经有这首歌啦」、部分重复时提示跳过数量。
 */
object AddToMylist {
    /** 一次批量加入的计划：真正写入的歌曲 + 因重复/缺 id 被跳过的数量。 */
    data class Plan(
        val toAdd: List<JsonObject>,
        val skipped: Int,
    )

    /**
     * 对照 RN `addListMusics` 的去重语义（目标列表已有 + 本批次内重复都跳过），
     * 保留选中顺序；缺 `id` 的条目无法落库，按跳过计。
     */
    fun plan(
        existing: List<JsonObject>,
        selected: List<JsonObject>,
    ): Plan {
        val seen = existing.mapNotNull { it.id() }.toMutableSet()
        val toAdd = mutableListOf<JsonObject>()
        var skipped = 0
        selected.forEach { item ->
            val id = item.id()
            if (id == null || !seen.add(id)) {
                skipped++
            } else {
                toAdd.add(item)
            }
        }
        return Plan(toAdd, skipped)
    }

    private fun JsonObject.id(): String? =
        (this["id"] as? JsonPrimitive)
            ?.takeIf { it !is JsonNull }
            ?.content
            ?.takeIf { it.isNotEmpty() }
}
