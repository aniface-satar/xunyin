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
import java.util.Base64
import java.util.Locale
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.pow
import kotlin.random.Random

/** QQ Music single-song search, mirroring tx/musicSearch.js and zzcSign. */
class TxSearch(
    private val fetch: suspend (SearchRequest) -> String,
    private val searchId: () -> String = { generateSearchId() },
) {
    suspend fun search(
        keyword: String,
        page: Int = 1,
        limit: Int = DEFAULT_LIMIT,
    ): SearchPage {
        var attempt = 0
        while (true) {
            attempt++
            val body = fetch(buildRequest(keyword, page, limit, searchId()))
            val parsed = parse(body, page, limit)
            if (parsed != null) return parsed
            check(attempt < MAX_ATTEMPTS) { "tx search failed after $attempt attempts" }
        }
    }

    companion object {
        const val DEFAULT_LIMIT = 50
        private const val MAX_ATTEMPTS = 6
        private const val RPC_NAME = "music.search.SearchCgiService"
        private val json = Json { ignoreUnknownKeys = true }
        private val part1Indexes = intArrayOf(23, 14, 6, 36, 16, 40, 7, 19)
        private val part2Indexes = intArrayOf(16, 1, 32, 12, 19, 27, 8, 5)
        private val scrambleValues =
            intArrayOf(89, 39, 179, 150, 218, 82, 58, 252, 177, 52, 186, 123, 120, 64, 242, 133, 143, 161, 121, 179)

        fun buildRequest(
            keyword: String,
            page: Int,
            limit: Int,
            searchId: String,
        ): SearchRequest {
            val body =
                buildJsonObject {
                    put(
                        "comm",
                        buildJsonObject {
                            put("_channelid", "0")
                            put("_os_version", "6.2.9200-2")
                            put("ct", "19")
                            put("cv", "2151")
                            put("guid", "1F70E520B2EAA7D25E11760783C53CA9")
                            put("patch", "118")
                            put("psrf_access_token_expiresAt", 0)
                            put("psrf_qqaccess_token", "")
                            put("psrf_qqopenid", "")
                            put("psrf_qqunionid", "")
                            put("tmeAppID", "qqmusic")
                            put("tmeLoginType", 0)
                            put("uin", "0")
                            put("wid", "7223299733393904640")
                        },
                    )
                    put(
                        RPC_NAME,
                        buildJsonObject {
                            put("module", RPC_NAME)
                            put("method", "DoSearchForQQMusicDesktop")
                            put(
                                "param",
                                buildJsonObject {
                                    put("grp", 1)
                                    put("num_per_page", limit)
                                    put("page_num", page)
                                    put("query", keyword)
                                    put("remoteplace", "txt.newclient.top")
                                    put("search_type", 0)
                                    put("searchid", searchId)
                                },
                            )
                        },
                    )
                }.toString()
            return SearchRequest(
                url = "https://u.y.qq.com/cgi-bin/musics.fcg?sign=${zzcSign(body)}",
                method = "POST",
                headers =
                    mapOf(
                        "User-Agent" to "QQMusic 14090508(android 12)",
                        "Content-Type" to "application/json",
                    ),
                body = body,
            )
        }

        fun zzcSign(text: String): String {
            val hash = Crypto.sha1(text)
            val part1 = part1Indexes.toList().mapNotNull { hash.getOrNull(it) }.joinToString("")
            val part2 = part2Indexes.toList().mapNotNull { hash.getOrNull(it) }.joinToString("")
            val scrambled =
                ByteArray(scrambleValues.size) { index ->
                    (scrambleValues[index] xor hash.substring(index * 2, index * 2 + 2).toInt(16)).toByte()
                }
            val base64 = Base64.getEncoder().encodeToString(scrambled).replace(Regex("[\\\\/+=]"), "")
            return "zzc$part1$base64$part2".lowercase(Locale.US)
        }

        fun parse(
            body: String,
            page: Int,
            limit: Int,
        ): SearchPage? {
            val root = runCatching { json.parseToJsonElement(body).jsonObject }.getOrNull() ?: return null
            val request = (root[RPC_NAME] as? JsonObject) ?: (root["req"] as? JsonObject) ?: return null
            if (root["code"].asInt() != 0 || request["code"].asInt() != 0) return null
            val data = request["data"] as? JsonObject ?: return null
            val responseBody = data["body"] as? JsonObject ?: return null
            val songs = (responseBody["song"] as? JsonObject)?.get("list") as? JsonArray ?: JsonArray(emptyList())
            val total = (data["meta"] as? JsonObject)?.get("sum").asInt() ?: 0
            return SearchPage(
                list = songs.mapNotNull { (it as? JsonObject)?.let(::toMusicInfo) },
                total = total,
                allPage = if (total == 0) 0 else (total + limit - 1) / limit,
                limit = limit,
                source = "tx",
            )
        }

        private fun toMusicInfo(item: JsonObject): JsonObject? {
            val file = item["file"] as? JsonObject ?: return null
            val mediaMid = file["media_mid"].text()
            if (mediaMid.isEmpty()) return null
            val qualities =
                listOf(
                    "128k" to "size_128mp3",
                    "320k" to "size_320mp3",
                    "flac" to "size_flac",
                    "flac24bit" to "size_hires",
                ).mapNotNull { (type, key) ->
                    val size = file[key].asLong() ?: 0L
                    if (size == 0L) null else type to formatSize(size)
                }
            val album = item["album"] as? JsonObject
            val albumId = album?.get("mid").text()
            val singerList = item["singer"] as? JsonArray
            val singer =
                singerList
                    ?.mapNotNull { (it as? JsonObject)?.get("name").text().ifEmpty { null } }
                    ?.joinToString("、")
                    .orEmpty()
            val songMid = item["mid"].text()
            val picUrl =
                if (albumId.isEmpty() || albumId == "空") {
                    val singerMid = (singerList?.firstOrNull() as? JsonObject)?.get("mid").text()
                    if (singerMid.isEmpty()) "" else "https://y.gtimg.cn/music/photo_new/T001R500x500M000$singerMid.jpg"
                } else {
                    "https://y.gtimg.cn/music/photo_new/T002R500x500M000$albumId.jpg"
                }
            return buildJsonObject {
                put("id", "tx_$songMid")
                put("name", item["title"].text())
                put("singer", KwSearch.decodeEntities(singer))
                put("source", "tx")
                put("interval", item["interval"].asLong()?.let { JsonPrimitive(formatInterval(it)) } ?: JsonNull)
                put(
                    "meta",
                    buildJsonObject {
                        put("songId", songMid)
                        put("albumName", album?.get("name").text())
                        put("picUrl", picUrl)
                        put("albumId", albumId)
                        put("strMediaMid", mediaMid)
                        put("albumMid", albumId)
                        put("id", item["id"] ?: JsonNull)
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
                qualities.forEach { (type, size) -> put(type, buildJsonObject { put("size", size) }) }
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

        private fun generateSearchId(): String {
            val guid =
                buildString(32) {
                    repeat(32) { append(Random.nextInt(16).toString(16)) }
                }.uppercase(Locale.US)
            return guid + Random.nextInt(100_000).toString().padStart(5, '0')
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
