package cn.toside.music.core.list

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.text.Collator
import java.util.Locale

/** 去重列表项：index 指向原列表下标，group 是归一化后的歌名，music 供 UI 直接展示。 */
data class DuplicateMusicItem(
    val id: String,
    val index: Int,
    val group: String,
    val music: JsonObject,
)

/**
 * 重复歌曲分组（对照 RN MyList/utils.ts#filterDuplicateMusic）。
 *
 * 只按歌名判定：默认剥离 `(Live)`/`（伴奏）` 等括号片段并去掉空白与标点，
 * 归一化后为空时退回「原文小写去空白」；不做歌手/时长比对（与 RN 一致）。
 * 仅返回成员数 ≥ 2 的组，组按组名 locale 排序，组内保持原列表顺序。
 */
object DuplicateMusic {
    // JS 侧是 /(\(|（).+(\)|）)/g：贪婪匹配，与 Kotlin 默认行为一致
    private val VARIANT_SEGMENT = Regex("""(\(|（).+(\)|）)""")
    private val VARIANT_CHARS = Regex("""[\s'.,，&"、()（）`~<>|/\[\]-]""")
    private val WHITESPACE = Regex("""\s+""")

    fun filter(
        list: List<JsonObject>,
        isFilterVariant: Boolean = true,
        localeId: String = Locale.getDefault().toLanguageTag(),
    ): List<DuplicateMusicItem> {
        val groups = LinkedHashMap<String, MutableList<DuplicateMusicItem>>()
        list.forEachIndexed { index, item ->
            val group = groupName(item.stringOrNull("name").orEmpty(), isFilterVariant)
            groups.getOrPut(group) { mutableListOf() }.add(
                DuplicateMusicItem(
                    id = item.stringOrNull("id").orEmpty(),
                    index = index,
                    group = group,
                    music = item,
                ),
            )
        }
        val collator = Collator.getInstance(Locale.forLanguageTag(localeId.replace('_', '-')))
        return groups
            .filterValues { it.size > 1 }
            .keys
            .sortedWith(collator)
            .flatMap { groups.getValue(it) }
    }

    /** 归一化歌名；拆出独立函数方便 UI 侧展示分组标题时复用同一判据。 */
    fun groupName(
        name: String,
        isFilterVariant: Boolean = true,
    ): String {
        val lower = name.lowercase()
        if (!isFilterVariant) return lower.trim()
        val stripped = lower.replace(VARIANT_SEGMENT, "").replace(VARIANT_CHARS, "")
        return stripped.ifEmpty { lower.replace(WHITESPACE, "") }
    }

    private fun JsonObject.stringOrNull(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content
}
