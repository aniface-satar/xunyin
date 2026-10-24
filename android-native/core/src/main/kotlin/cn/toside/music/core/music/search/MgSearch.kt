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
import java.security.MessageDigest
import java.util.Locale
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.pow

/** Migu v3 single-song search. */
class MgSearch(
    private val fetch: suspend (SearchRequest) -> String,
    private val clock: () -> String = { System.currentTimeMillis().toString() },
) {
    suspend fun search(
        keyword: String,
        page: Int = 1,
        limit: Int = DEFAULT_LIMIT,
    ): SearchPage {
        val body = fetch(buildRequest(keyword, page, limit, clock()))
        return checkNotNull(parse(body, page, limit)) { "mg search failed" }
    }

    companion object {
        const val DEFAULT_LIMIT = 20
        private const val DEVICE_ID = "963B7AA0D21511ED807EE5846EC87D20"
        private const val SIGNATURE_MD5 = "6cdc72a439cef99a3418d2a78aa28c73"
        private const val APP_KEY = "yyapp2d16148780a1dcc7408e06336b98cfd50"
        private const val USER_AGENT =
            "Mozilla/5.0 (Linux; U; Android 11.0.0; zh-cn; MI 11 Build/OPR1.170623.032) " +
                "AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30"
        private val json = Json { ignoreUnknownKeys = true }
        private val absoluteUrl = Regex("https?:")

        fun buildRequest(
            keyword: String,
            page: Int,
            limit: Int,
            time: String,
        ): SearchRequest {
            val sign = md5("$keyword$SIGNATURE_MD5$APP_KEY$DEVICE_ID$time")
            return SearchRequest(
                url =
                    "https://jadeite.migu.cn/music_search/v3/search/searchAll?isCorrect=0&isCopyright=1" +
                        "&searchSwitch=%7B%22song%22%3A1%2C%22album%22%3A0%2C%22singer%22%3A0" +
                        "%2C%22tagSong%22%3A1%2C%22mvSong%22%3A0%2C%22bestShow%22%3A1%2C%22songlist%22%3A0" +
                        "%2C%22lyricSong%22%3A0%7D&pageSize=$limit&text=${encode(keyword)}&pageNo=$page&sort=0&sid=USS",
                headers =
                    mapOf(
                        "uiVersion" to "A_music_3.6.1",
                        "deviceId" to DEVICE_ID,
                        "timestamp" to time,
                        "sign" to sign,
                        "channel" to "0146921",
                        "User-Agent" to USER_AGENT,
                    ),
            )
        }

        fun parse(
            body: String,
            page: Int,
            limit: Int,
        ): SearchPage? {
            val root = runCatching { json.parseToJsonElement(body).jsonObject }.getOrNull() ?: return null
            if (root["code"].text() != "000000") return null
            val songData = root["songResultData"] as? JsonObject
            val resultList = songData?.get("resultList") as? JsonArray ?: JsonArray(emptyList())
            val total = songData?.get("totalCount").asInt() ?: 0
            val ids = mutableSetOf<String>()
            val list = mutableListOf<JsonObject>()
            resultList.forEach { groupElement ->
                val group = groupElement as? JsonArray ?: return@forEach
                group.forEach { itemElement ->
                    val item = itemElement as? JsonObject ?: return@forEach
                    val songId = item["songId"].text()
                    val copyrightId = item["copyrightId"].text()
                    if (songId.isEmpty() || copyrightId.isEmpty() || !ids.add(copyrightId)) return@forEach
                    list.add(toMusicInfo(item, songId, copyrightId))
                }
            }
            return SearchPage(
                list = list,
                total = total,
                allPage = if (total == 0) 0 else (total + limit - 1) / limit,
                limit = limit,
                source = "mg",
            )
        }

        private fun toMusicInfo(
            item: JsonObject,
            songId: String,
            copyrightId: String,
        ): JsonObject {
            val qualities =
                (item["audioFormats"] as? JsonArray)
                    ?.mapNotNull { formatElement ->
                        val format = formatElement as? JsonObject ?: return@mapNotNull null
                        val type =
                            when (format["formatType"].text()) {
                                "PQ" -> "128k"
                                "HQ" -> "320k"
                                "SQ" -> "flac"
                                "ZQ24" -> "flac24bit"
                                else -> return@mapNotNull null
                            }
                        val size = format["asize"].asLong() ?: format["isize"].asLong() ?: 0L
                        type to formatSize(size)
                    }.orEmpty()
            val singers =
                (item["singerList"] as? JsonArray)
                    ?.mapNotNull { (it as? JsonObject)?.get("name").text().ifEmpty { null } }
                    ?.joinToString("、")
                    .orEmpty()
            val relativeImage =
                listOf("img3", "img2", "img1").firstOrNull { item[it].text().isNotEmpty() }?.let { item[it].text() }
            val image =
                relativeImage?.let {
                    if (absoluteUrl.containsMatchIn(it)) it else "http://d.musicapp.migu.cn$it"
                }
            return buildJsonObject {
                put("id", "mg_$songId")
                put("name", item["name"].text())
                put("singer", KwSearch.decodeEntities(singers))
                put("source", "mg")
                put("interval", formatInterval(item["duration"].asLong() ?: 0L))
                put(
                    "meta",
                    buildJsonObject {
                        put("songId", songId)
                        put("albumName", item["album"].text())
                        put("picUrl", if (image == null) JsonNull else JsonPrimitive(image))
                        put("albumId", item["albumId"].text())
                        put("copyrightId", copyrightId)
                        put("lrcUrl", item["lrcUrl"] ?: JsonNull)
                        put("mrcUrl", item["mrcurl"] ?: JsonNull)
                        put("trcUrl", item["trcUrl"] ?: JsonNull)
                        put("qualitys", qualityArray(qualities))
                        put("_qualitys", qualityMap(qualities))
                    },
                )
            }
        }

        private fun qualityArray(qualities: List<Pair<String, String>>): JsonArray =
            buildJsonArray {
                qualities.forEach { (type, size) ->
                    add(
                        buildJsonObject {
                            put("type", type)
                            put("size", size)
                        },
                    )
                }
            }

        private fun qualityMap(qualities: List<Pair<String, String>>): JsonObject =
            buildJsonObject {
                qualities.forEach { (type, size) ->
                    put(type, buildJsonObject { put("size", size) })
                }
            }

        private fun encode(value: String): String = URLEncoder.encode(value, "UTF-8").replace("+", "%20")

        private fun md5(value: String): String =
            MessageDigest
                .getInstance("MD5")
                .digest(value.toByteArray(Charsets.UTF_8))
                .joinToString("") { "%02x".format(it) }

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
    }
}
