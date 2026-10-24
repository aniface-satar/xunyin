package cn.toside.music.core.list

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.text.Collator
import java.util.Locale

/** 列表排序档位（对照 RN MyList/utils.ts#ListSortId）。 */
enum class MusicSortId(
    val key: String,
) {
    NAME("name"),
    ALBUM("album"),
    DURATION_UP("duration_up"),
    DURATION_DOWN("duration_down"),
    ADD_TIME_UP("add_time_up"),
    ADD_TIME_DOWN("add_time_down"),
    SINGER("singer"),
    YEAR("year"),
    PLAY_COUNT("play_count"),
    ;

    companion object {
        fun fromKey(key: String): MusicSortId? = entries.firstOrNull { it.key == key }
    }
}

/**
 * 列表歌曲排序规则（对照 RN MyList/utils.ts#sortListMusicInfo）。
 *
 * 字符串比较用 [Collator]：Android 上委托 ICU，与 RN 的 `localeCompare` 同源；
 * JVM 单测走 CLDR，个别边角与 JS 存在方向差异（见 docs/waves/w2-C.md 车道报告）。
 * 排序保持稳定（Kotlin `sortedWith` 为稳定排序），与 JS `Array.prototype.sort` 一致。
 */
object MusicSort {
    fun sort(
        list: List<JsonObject>,
        sortId: MusicSortId,
        localeId: String,
        getAddTime: (String) -> Long = { 0L },
        getPlayCount: (String) -> Long = { 0L },
    ): List<JsonObject> {
        val collator = Collator.getInstance(Locale.forLanguageTag(localeId.replace('_', '-')))
        val comparator =
            Comparator<JsonObject> { a, b ->
                when (sortId) {
                    MusicSortId.NAME -> compareString(a.stringOrNull("name"), b.stringOrNull("name"), collator)
                    MusicSortId.SINGER -> compareString(a.stringOrNull("singer"), b.stringOrNull("singer"), collator)
                    MusicSortId.ALBUM -> {
                        val byAlbum =
                            compareString(a.metaString("albumName"), b.metaString("albumName"), collator)
                        if (byAlbum != 0) {
                            byAlbum
                        } else {
                            compareString(a.stringOrNull("name"), b.stringOrNull("name"), collator)
                        }
                    }

                    MusicSortId.DURATION_UP -> compareDuration(a, b, ascending = true)
                    MusicSortId.DURATION_DOWN -> compareDuration(a, b, ascending = false)
                    MusicSortId.ADD_TIME_UP -> getAddTime(a.musicId()).compareTo(getAddTime(b.musicId()))
                    MusicSortId.ADD_TIME_DOWN -> getAddTime(b.musicId()).compareTo(getAddTime(a.musicId()))
                    MusicSortId.YEAR -> compareYear(a, b)
                    MusicSortId.PLAY_COUNT -> getPlayCount(b.musicId()).compareTo(getPlayCount(a.musicId()))
                }
            }
        return list.sortedWith(comparator)
    }

    /** RN getIntv：mm:ss / hh:mm:ss → 秒；缺失或非法片段按 0 兜底。 */
    fun intervalSeconds(interval: String?): Int {
        if (interval.isNullOrEmpty()) return 0
        var total = 0
        var unit = 1
        val parts = interval.split(':')
        for (index in parts.indices.reversed()) {
            total += leadingInt(parts[index]) * unit
            unit *= 60
        }
        return total
    }

    // ---------- 内部 ----------

    /** RN compareString：null 永远在前，其余交给 locale 比较器。 */
    private fun compareString(
        a: String?,
        b: String?,
        collator: Collator,
    ): Int =
        when {
            a == null -> if (b == null) 0 else -1
            b == null -> 1
            else -> collator.compare(a, b)
        }

    /** 时长：缺 interval 的歌曲升序在前、降序在后（RN duration_up/down）。 */
    private fun compareDuration(
        a: JsonObject,
        b: JsonObject,
        ascending: Boolean,
    ): Int {
        val aSeconds = a.intervalSecondsOrNull()
        val bSeconds = b.intervalSecondsOrNull()
        return when {
            aSeconds == null && bSeconds == null -> 0
            aSeconds == null -> if (ascending) -1 else 1
            bSeconds == null -> if (ascending) 1 else -1
            ascending -> aSeconds.compareTo(bSeconds)
            else -> bSeconds.compareTo(aSeconds)
        }
    }

    /** 年份：早年在前，无 releaseDate/无法解析的排最后且保持原有相对顺序。 */
    private fun compareYear(
        a: JsonObject,
        b: JsonObject,
    ): Int {
        val aYear = a.yearOrNull()
        val bYear = b.yearOrNull()
        return when {
            aYear == null -> if (bYear == null) 0 else 1
            bYear == null -> -1
            else -> aYear.compareTo(bYear)
        }
    }

    private fun JsonObject.intervalSecondsOrNull(): Int? {
        val interval = stringOrNull("interval") ?: return null
        return intervalSeconds(interval)
    }

    private fun JsonObject.yearOrNull(): Int? {
        val releaseDate = metaString("releaseDate") ?: return null
        // RN：parseInt(releaseDate.slice(0, 4))，NaN 视为缺失。
        val match = LEADING_INT.find(releaseDate.take(4)) ?: return null
        return match.value.toIntOrNull()
    }

    /** JS parseInt 的前缀语义：跳过前导空白，取可选符号 + 连续数字，否则按 0。 */
    private fun leadingInt(text: String): Int {
        val match = LEADING_INT.find(text.trimStart()) ?: return 0
        return match.value.toIntOrNull() ?: 0
    }

    private fun JsonObject.musicId(): String = stringOrNull("id").orEmpty()

    private fun JsonObject.metaString(key: String): String? = (this["meta"] as? JsonObject)?.stringOrNull(key)

    private fun JsonObject.stringOrNull(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content

    private val LEADING_INT = Regex("^[+-]?\\d+")
}
