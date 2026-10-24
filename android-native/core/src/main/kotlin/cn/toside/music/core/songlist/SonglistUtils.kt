package cn.toside.music.core.songlist

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.util.Locale
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.pow

/** 歌单五源共用的格式化工具，逐项对照 RN `src/utils/index.ts` 与 `utils/common.ts`。 */
internal object SonglistUtils {
    val json = Json { ignoreUnknownKeys = true }

    /** RN `formatPlayCount`：>1 亿 → 亿；>1 万 → 万；否则原样字符串。 */
    fun formatPlayCount(num: Long): String =
        when {
            num > 100_000_000L -> "${num / 10_000_000L / 10.0}亿".replace(".0亿", "亿")
            num > 10_000L -> "${num / 1_000L / 10.0}万".replace(".0万", "万")
            else -> num.toString()
        }

    /** RN `sizeFormate`：保留两位小数并带单位。 */
    fun formatSize(size: Long): String {
        if (size == 0L) return "0 B"
        val units = listOf("B", "KiB", "MiB", "GiB", "TiB")
        val unit = floor(ln(size.toDouble()) / ln(1024.0)).toInt()
        return String.format(Locale.US, "%.2f %s", size / 1024.0.pow(unit), units[unit])
    }

    /** RN `formatPlayTime`：秒 → `mm:ss`，0 → `--/--`。 */
    fun formatPlayTime(seconds: Long): String {
        val minutes = seconds / 60
        val remainder = seconds % 60
        return if (minutes == 0L && remainder == 0L) {
            "--/--"
        } else {
            String.format(Locale.US, "%02d:%02d", minutes, remainder)
        }
    }

    /** RN `dateFormat(time, 'Y-M-D')`（本地时区）。 */
    fun formatDate(epochMillis: Long): String {
        if (epochMillis <= 0L) return ""
        val date = java.util.Date(epochMillis)
        val calendar =
            java.util.Calendar
                .getInstance()
                .apply { time = date }
        return String.format(
            Locale.US,
            "%04d-%02d-%02d",
            calendar.get(java.util.Calendar.YEAR),
            calendar.get(java.util.Calendar.MONTH) + 1,
            calendar.get(java.util.Calendar.DAY_OF_MONTH),
        )
    }

    fun JsonObject.text(key: String): String = this[key].text()
}

internal fun JsonElement?.text(): String =
    when (this) {
        null, is JsonNull -> ""
        is JsonPrimitive -> content
        else -> ""
    }

internal fun JsonElement?.asLong(): Long? = (this as? JsonPrimitive)?.content?.toLongOrNull()

internal fun JsonElement?.asInt(): Int? = (this as? JsonPrimitive)?.content?.toIntOrNull()

internal fun JsonElement?.asObject(): JsonObject? = this as? JsonObject

/** `Array.isArray` 小工具：只把 JsonArray 当数组，其余（含 null）为 null。 */
internal fun JsonElement?.asArrayOrNull(): kotlinx.serialization.json.JsonArray? = this as? kotlinx.serialization.json.JsonArray

internal fun JsonElement?.asArray(): kotlinx.serialization.json.JsonArray =
    asArrayOrNull() ?: kotlinx.serialization.json.JsonArray(emptyList())
