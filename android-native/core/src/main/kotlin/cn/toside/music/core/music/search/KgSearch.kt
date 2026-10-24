package cn.toside.music.core.music.search

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import java.net.URLEncoder
import java.util.Locale
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.pow

/** Kugou single-song search, including the RN Grp parent-key deduplication behavior. */
class KgSearch(
    private val fetch: suspend (SearchRequest) -> String,
) {
    suspend fun search(
        keyword: String,
        page: Int = 1,
        limit: Int = DEFAULT_LIMIT,
    ): SearchPage {
        var attempt = 0
        while (true) {
            attempt++
            val parsed = parse(fetch(buildRequest(keyword, page, limit)), page, limit)
            if (parsed != null) return parsed
            check(attempt < MAX_ATTEMPTS) { "kg search failed after $attempt attempts" }
        }
    }

    companion object {
        const val DEFAULT_LIMIT = 30
        private const val MAX_ATTEMPTS = 3
        private val json = Json { ignoreUnknownKeys = true }

        fun buildRequest(
            keyword: String,
            page: Int,
            limit: Int,
        ): SearchRequest =
            SearchRequest(
                url =
                    "https://songsearch.kugou.com/song_search_v2?keyword=${encode(keyword)}" +
                        "&page=$page&pagesize=$limit&userid=0&clientver=&platform=WebFilter&filter=2" +
                        "&iscorrection=1&privilege_filter=0&area_code=1",
            )

        fun parse(
            body: String,
            page: Int,
            limit: Int,
        ): SearchPage? {
            val root = runCatching { json.parseToJsonElement(body).jsonObject }.getOrNull() ?: return null
            if (root["error_code"].asInt() != 0) return null
            val data = root["data"] as? JsonObject ?: return null
            val rawList = data["lists"] as? JsonArray ?: return null
            val total = data["total"].asInt() ?: 0
            val ids = mutableSetOf<String>()
            val list = mutableListOf<JsonObject>()
            rawList.forEach { element ->
                val item = element as? JsonObject ?: return@forEach
                val parentKey = item["Audioid"].text() + item["FileHash"].text()
                if (!ids.add(parentKey)) return@forEach
                list.add(toMusicInfo(item))

                // RN declares key from item (the parent), not childItem. The parent key is already present.
                val children = item["Grp"] as? JsonArray ?: JsonArray(emptyList())
                children.forEach { childElement ->
                    val child = childElement as? JsonObject ?: return@forEach
                    val childKey = item["Audioid"].text() + item["FileHash"].text()
                    if (!ids.add(childKey)) return@forEach
                    list.add(toMusicInfo(child))
                }
            }
            return SearchPage(
                list = list,
                total = total,
                allPage = if (total == 0) 0 else (total + limit - 1) / limit,
                limit = limit,
                source = "kg",
            )
        }

        private fun toMusicInfo(item: JsonObject): JsonObject {
            val qualities =
                listOf(
                    QualityField("128k", "FileSize", "FileHash"),
                    QualityField("320k", "HQFileSize", "HQFileHash"),
                    QualityField("flac", "SQFileSize", "SQFileHash"),
                    QualityField("flac24bit", "ResFileSize", "ResFileHash"),
                ).mapNotNull { field ->
                    val size = item[field.sizeKey].asLong() ?: 0L
                    if (size == 0L) {
                        null
                    } else {
                        Quality(field.type, formatSize(size), item[field.hashKey].text())
                    }
                }
            val singers =
                (item["Singers"] as? JsonArray)
                    ?.mapNotNull { (it as? JsonObject)?.get("name").text().ifEmpty { null } }
                    ?.joinToString("、")
                    .orEmpty()
            val suffix = item["Suffix"].text()
            val rawName = item["OriSongName"].text() + if (suffix.isEmpty()) "" else " $suffix"
            val songId = item["Audioid"] ?: JsonNull
            val hash = item["FileHash"].text()
            val language = (item["trans_param"] as? JsonObject)?.get("language") ?: JsonNull
            val image = item["Image"].text()
            return buildJsonObject {
                put("id", "${songId.text()}_$hash")
                put("name", KwSearch.decodeEntities(rawName))
                put("singer", KwSearch.decodeEntities(singers))
                put("source", "kg")
                put("interval", formatInterval(item["Duration"].asLong() ?: 0L))
                put(
                    "meta",
                    buildJsonObject {
                        put("songId", songId)
                        put("albumName", KwSearch.decodeEntities(item["AlbumName"].text()))
                        put("picUrl", if (image.isEmpty()) JsonNull else JsonPrimitive(image.replace("{size}", "400")))
                        put("albumId", item["AlbumID"] ?: JsonNull)
                        put("hash", hash)
                        put("lang", language)
                        put("qualitys", qualityArray(qualities))
                        put("_qualitys", qualityMap(qualities))
                    },
                )
            }
        }

        private fun qualityArray(qualities: List<Quality>): JsonArray =
            buildJsonArray {
                qualities.forEach { quality ->
                    add(
                        buildJsonObject {
                            put("type", quality.type)
                            put("size", quality.size)
                            put("hash", quality.hash)
                        },
                    )
                }
            }

        private fun qualityMap(qualities: List<Quality>): JsonObject =
            buildJsonObject {
                qualities.forEach { quality ->
                    put(
                        quality.type,
                        buildJsonObject {
                            put("size", quality.size)
                            put("hash", quality.hash)
                        },
                    )
                }
            }

        private fun encode(value: String): String = URLEncoder.encode(value, "UTF-8").replace("+", "%20")

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

        private fun JsonElement?.text(): String =
            when (this) {
                null, is JsonNull -> ""
                is JsonPrimitive -> content
                else -> ""
            }

        private fun JsonElement?.asLong(): Long? = (this as? JsonPrimitive)?.content?.toLongOrNull()

        private fun JsonElement?.asInt(): Int? = (this as? JsonPrimitive)?.content?.toIntOrNull()

        private data class QualityField(
            val type: String,
            val sizeKey: String,
            val hashKey: String,
        )

        private data class Quality(
            val type: String,
            val size: String,
            val hash: String,
        )
    }
}
