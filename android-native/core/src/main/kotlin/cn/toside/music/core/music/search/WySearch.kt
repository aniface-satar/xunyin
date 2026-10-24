package cn.toside.music.core.music.search

import cn.toside.music.core.crypto.Crypto
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
import java.security.MessageDigest
import java.util.Base64
import java.util.Locale
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.pow

/** Netease single-song eapi search. */
class WySearch(
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
            check(attempt < MAX_ATTEMPTS) { "wy search failed after $attempt attempts" }
        }
    }

    companion object {
        const val DEFAULT_LIMIT = 30
        private const val MAX_ATTEMPTS = 3
        private const val SEARCH_PATH = "/api/search/song/list/page"
        private const val USER_AGENT =
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) " +
                "Chrome/60.0.3112.90 Safari/537.36"
        private val json = Json { ignoreUnknownKeys = true }

        fun buildRequest(
            keyword: String,
            page: Int,
            limit: Int,
        ): SearchRequest {
            val body =
                buildJsonObject {
                    put("keyword", keyword)
                    put("needCorrect", "1")
                    put("channel", "typing")
                    put("offset", limit * (page - 1))
                    put("scene", "normal")
                    put("total", page == 1)
                    put("limit", limit)
                }.toString()
            val message = "nobody${SEARCH_PATH}use${body}md5forencrypt"
            val digest = md5(message)
            val plain = "$SEARCH_PATH-36cd479b6b5-$body-36cd479b6b5-$digest".toByteArray(Charsets.UTF_8)

            // RN's NoPadding throws for this non-aligned input. PKCS5Padding is JCE's AES PKCS#7 spelling.
            val encrypted =
                Crypto.aesEncrypt(
                    plain,
                    "e82ckenh8dichen8".toByteArray(Charsets.UTF_8),
                    null,
                    "AES/ECB/PKCS5Padding",
                )
            val params =
                Base64
                    .getDecoder()
                    .decode(encrypted)
                    .joinToString("") { "%02X".format(it) }
            return SearchRequest(
                url = "http://interface.music.163.com/eapi/batch",
                method = "POST",
                headers =
                    mapOf(
                        "User-Agent" to USER_AGENT,
                        "origin" to "https://music.163.com",
                        "Content-Type" to "application/x-www-form-urlencoded",
                    ),
                form = mapOf("params" to params),
            )
        }

        fun parse(
            body: String,
            page: Int,
            limit: Int,
        ): SearchPage? {
            val root = runCatching { json.parseToJsonElement(body).jsonObject }.getOrNull() ?: return null
            if (root["code"].asInt() != 200) return null
            val data = root["data"] as? JsonObject ?: return null
            val resources = data["resources"] as? JsonArray ?: JsonArray(emptyList())
            val total = data["totalCount"].asInt() ?: 0
            return SearchPage(
                list = resources.mapNotNull { resource -> (resource as? JsonObject)?.let(::toMusicInfo) },
                total = total,
                allPage = if (total == 0) 0 else (total + DEFAULT_LIMIT - 1) / DEFAULT_LIMIT,
                limit = DEFAULT_LIMIT,
                source = "wy",
            )
        }

        private fun toMusicInfo(resource: JsonObject): JsonObject? {
            val baseInfo = resource["baseInfo"] as? JsonObject ?: return null
            val item = baseInfo["simpleSongData"] as? JsonObject ?: return null
            val privilege = item["privilege"] as? JsonObject ?: return null
            val qualities = mutableListOf<Pair<String, JsonElement>>()
            if (privilege["maxBrLevel"].text() == "hires") {
                qualities.add("flac24bit" to qualitySize(item["hr"]))
            }
            when (privilege["maxbr"].asInt()) {
                999000 -> {
                    qualities.add("flac" to qualitySize(item["sq"]))
                    qualities.add("320k" to qualitySize(item["h"]))
                    qualities.add("128k" to qualitySize(item["l"]))
                }

                320000 -> {
                    qualities.add("320k" to qualitySize(item["h"]))
                    qualities.add("128k" to qualitySize(item["l"]))
                }

                192000, 128000 -> qualities.add("128k" to qualitySize(item["l"]))
            }
            qualities.reverse()
            val album = item["al"] as? JsonObject
            val singers =
                (item["ar"] as? JsonArray)
                    ?.mapNotNull { (it as? JsonObject)?.get("name").text().ifEmpty { null } }
                    ?.joinToString("、")
                    .orEmpty()
            val songId = item["id"] ?: JsonNull
            return buildJsonObject {
                put("id", "wy_${songId.text()}")
                put("name", item["name"].text())
                put("singer", singers)
                put("source", "wy")
                put("interval", formatInterval((item["dt"].asLong() ?: 0L) / 1000))
                put(
                    "meta",
                    buildJsonObject {
                        put("songId", songId)
                        put("albumName", album?.get("name").text())
                        put("picUrl", album?.get("picUrl") ?: JsonNull)
                        put("albumId", album?.get("id") ?: JsonNull)
                        put("qualitys", qualityArray(qualities))
                        put("_qualitys", qualityMap(qualities))
                    },
                )
            }
        }

        private fun qualitySize(value: JsonElement?): JsonElement {
            val size = (value as? JsonObject)?.get("size").asLong() ?: return JsonNull
            return JsonPrimitive(formatSize(size))
        }

        private fun qualityArray(qualities: List<Pair<String, JsonElement>>): JsonArray =
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

        private fun qualityMap(qualities: List<Pair<String, JsonElement>>): JsonObject =
            buildJsonObject {
                qualities.forEach { (type, size) ->
                    put(
                        type,
                        buildJsonObject { put("size", size) },
                    )
                }
            }

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
