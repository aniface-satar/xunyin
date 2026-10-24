package cn.toside.music.core.music.leaderboard

import cn.toside.music.core.music.search.KwSearch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import java.util.Locale
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.pow

/**
 * 酷狗排行榜 —— 对照 RN `musicSdk/kg/leaderboard.js`。
 *
 * 列表走 `mobilecdnbj.kugou.com/api/v3/rank/song`（rn=100）；失败重试最多 3 次。
 * 字段映射 RN filterData：filesize/320filesize/sqfilesize/filesize_high →
 * 128k/320k/flac/flac24bit，对应 hash；歌手从 authors[].author_name 拼接。
 */
class KgLeaderboard(
    private val fetch: suspend (url: String) -> String,
) : LeaderboardSource {
    override val source: String = "kg"

    override fun getBoards(): List<BoardItem> = LEADERBOARD_BOARDS.getValue("kg")

    override suspend fun getList(
        bangid: String,
        page: Int,
    ): BoardList {
        var attempt = 0
        while (true) {
            attempt++
            val body = fetch(buildUrl(bangid, page))
            val parsed = parse(body, page)
            if (parsed != null) return parsed
            check(attempt < MAX_ATTEMPTS) { "kg leaderboard failed after $attempt attempts" }
        }
    }

    companion object {
        private const val MAX_ATTEMPTS = 3
        const val LIMIT = 100
        private val json = Json { ignoreUnknownKeys = true }

        fun buildUrl(
            bangid: String,
            page: Int,
        ): String =
            "https://mobilecdnbj.kugou.com/api/v3/rank/song?version=9108&ranktype=1&plat=0" +
                "&pagesize=$LIMIT&area_code=1&page=$page&rankid=$bangid&with_res_tag=0&show_portrait_mv=1"

        fun parse(
            body: String,
            page: Int,
        ): BoardList? {
            val root = runCatching { json.parseToJsonElement(body).jsonObject }.getOrNull() ?: return null
            if ((root["errcode"] as? JsonPrimitive)?.content?.toIntOrNull() != 0) return null
            val data = root["data"] as? JsonObject ?: return null
            val info = data["info"] as? JsonArray ?: return null
            val total = (data["total"] as? JsonPrimitive)?.content?.toIntOrNull() ?: 0
            return BoardList(
                list = info.mapNotNull { (it as? JsonObject)?.let(::toMusicInfo) },
                total = total,
                limit = LIMIT,
                page = page,
                source = "kg",
            )
        }

        private fun toMusicInfo(item: JsonObject): JsonObject? {
            val hash = item.text("hash")
            if (hash.isEmpty()) return null
            val audioId = item.text("audio_id")
            val singers =
                (item["authors"] as? JsonArray)
                    ?.mapNotNull { (it as? JsonObject)?.text("author_name")?.ifEmpty { null } }
                    ?.joinToString("、")
                    .orEmpty()
            val quality =
                listOf(
                    QualityField("128k", "filesize", "hash"),
                    QualityField("320k", "320filesize", "320hash"),
                    QualityField("flac", "sqfilesize", "sqhash"),
                    QualityField("flac24bit", "filesize_high", "hash_high"),
                ).mapNotNull { field ->
                    val size = item.text(field.sizeKey).toLongOrNull() ?: 0L
                    if (size == 0L) {
                        null
                    } else {
                        Triple(field.type, formatSize(size), item.text(field.hashKey))
                    }
                }
            return buildJsonObject {
                put("id", "${audioId}_$hash")
                put("name", KwSearch.decodeEntities(item.text("songname")))
                put("singer", KwSearch.decodeEntities(singers))
                put("source", "kg")
                put("interval", formatInterval(item.text("duration").toLongOrNull() ?: 0L))
                put(
                    "meta",
                    buildJsonObject {
                        put("songId", audioId)
                        put("albumName", KwSearch.decodeEntities(item.text("remark")))
                        put("picUrl", JsonNull)
                        put("albumId", item.text("album_id"))
                        put("hash", hash)
                        put("qualitys", qualityArray(quality))
                        put("_qualitys", qualityMap(quality))
                    },
                )
            }
        }

        private fun qualityArray(qualities: List<Triple<String, String, String>>): JsonArray =
            buildJsonArray {
                qualities.forEach { (type, size, hash) ->
                    add(
                        buildJsonObject {
                            put("type", type)
                            put("size", size)
                            put("hash", hash)
                        },
                    )
                }
            }

        private fun qualityMap(qualities: List<Triple<String, String, String>>): JsonObject =
            buildJsonObject {
                qualities.forEach { (type, size, hash) ->
                    put(
                        type,
                        buildJsonObject {
                            put("size", size)
                            put("hash", hash)
                        },
                    )
                }
            }

        private fun formatSize(size: Long): String {
            if (size == 0L) return "0 B"
            val units = listOf("B", "KiB", "MiB", "GiB", "TiB")
            val unit = floor(ln(size.toDouble()) / ln(1024.0)).toInt()
            return String.format(Locale.US, "%.2f %s", size / 1024.0.pow(unit), units[unit])
        }

        private fun formatInterval(seconds: Long): String {
            val minutes = seconds / 60
            val remainder = seconds % 60
            return if (minutes == 0L && remainder == 0L) {
                "--/--"
            } else {
                String.format(Locale.US, "%02d:%02d", minutes, remainder)
            }
        }

        private fun JsonObject.text(key: String): String =
            when (val v = this[key]) {
                null, is JsonNull -> ""
                is JsonPrimitive -> v.content
                else -> ""
            }

        private data class QualityField(
            val type: String,
            val sizeKey: String,
            val hashKey: String,
        )
    }
}
