package cn.toside.music.core.music.search

import cn.toside.music.core.songlist.SonglistUtils
import cn.toside.music.core.songlist.text
import kotlinx.serialization.json.JsonObject
import java.net.URLEncoder

/**
 * 歌单搜索五源共用的小工具（新文件，不改 [cn.toside.music.core.songlist.SonglistUtils]）。
 *
 * 与 RN 对齐的点：
 * - `formatPlayCount` / `formatDate` 直接复用歌单模块既有实现；
 * - 日期既接受毫秒时间戳（数字串），也接受 `2023-01-10 19:31:00` 这类日期串
 *   （RN `dateFormat` 对字符串先换成 `Y/M/D` 再取年月日）；
 * - 酷我 `r.s` 返回的是单引号 JS 对象串，[singleQuotesToJson] 复刻 RN `objStr2JSON`。
 */
internal object SonglistSearchSupport {
    fun encode(value: String): String = URLEncoder.encode(value, "UTF-8").replace("+", "%20")

    fun decodeName(value: String?): String = KwSearch.decodeEntities(value ?: "")

    fun playCount(value: Long): String = SonglistUtils.formatPlayCount(value)

    fun playCount(value: String): String = playCount(value.trim().toLongOrNull() ?: 0L)

    fun date(value: String): String {
        val text = value.trim()
        if (text.isEmpty()) return ""
        if (text.all { it.isDigit() }) {
            return text.toLongOrNull()?.let { SonglistUtils.formatDate(it) }.orEmpty()
        }
        return text.take(10).replace('/', '-')
    }

    fun int(value: String): Int = value.trim().toIntOrNull() ?: 0

    fun nullableText(value: String): String? = value.trim().ifEmpty { null }

    /**
     * RN `objStr2JSON`：只把处在 JSON 结构位置上的 `'` 换成 `"`，
     * 字符串内容里的撇号（如 `It's`）保持原样。
     */
    fun singleQuotesToJson(body: String): String {
        if (!body.contains('\'')) return body
        val chars = body.toCharArray()
        for (index in chars.indices) {
            if (chars[index] != '\'') continue
            var previous = index - 1
            while (previous >= 0 && chars[previous].isWhitespace()) previous--
            var next = index + 1
            while (next < chars.size && chars[next].isWhitespace()) next++
            val previousStructural = previous < 0 || chars[previous] in "{[:,"
            val nextStructural = next >= chars.size || chars[next] in ",}:"
            if (previousStructural || nextStructural) chars[index] = '"'
        }
        return String(chars)
    }
}

/** `JsonObject["key"]` 的取值糖；与歌单模块的 `SonglistUtils.text(key)` 等价。 */
internal fun JsonObject.text(key: String): String = this[key].text()
