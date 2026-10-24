package cn.toside.music.core.music.leaderboard

import cn.toside.music.core.music.search.KwSearch
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
import java.util.Locale
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.pow

/**
 * 咪咕排行榜 —— 对照 RN `musicSdk/mg/leaderboard.js` + `musicInfo.js#filterMusicInfoList`。
 *
 * 榜单详情走 `app.c.nf.migu.cn/MIGUM2.0/v1.0/content/querycontentbyId.do`
 * （columnId=bangid，GET 一次性返回整榜，page 参数在 RN 中不参与请求）；
 * `body.code == "000000"` 门禁，失败重试最多 3 次（RN getList）。
 * 歌曲映射按 `columnInfo.contents[].objectInfo`（newRateFormats 音质表，
 * length 尾段 `mm:ss` 提取时长），与 mg 搜索的 audioFormats/duration 形状不同。
 */
class MgLeaderboard(
    private val fetch: suspend (url: String) -> String,
) : LeaderboardSource {
    override val source: String = "mg"

    override fun getBoards(): List<BoardItem> = LEADERBOARD_BOARDS.getValue("mg")

    override suspend fun getList(
        bangid: String,
        page: Int,
    ): BoardList {
        var attempt = 0
        while (true) {
            attempt++
            // RN getList：状态码/业务码不合格就重试，最多 3 次（传输异常同样计入次数）
            val parsed = runCatching { parse(fetch(buildUrl(bangid)), page) }.getOrNull()
            if (parsed != null) return parsed
            check(attempt < MAX_ATTEMPTS) { "mg leaderboard failed after $attempt attempts" }
        }
    }

    companion object {
        const val LIMIT = 200
        private const val MAX_ATTEMPTS = 3
        private const val SUCCESS_CODE = "000000"
        private val json = Json { ignoreUnknownKeys = true }

        /** RN getUrl：querycontentbyId.do 不分页，一次返回整榜。 */
        fun buildUrl(bangid: String): String =
            "https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/querycontentbyId.do?columnId=$bangid&needAll=0"

        fun parse(
            body: String,
            page: Int,
        ): BoardList? {
            val root = runCatching { json.parseToJsonElement(body).jsonObject }.getOrNull() ?: return null
            if ((root["code"] as? JsonPrimitive)?.content != SUCCESS_CODE) return null
            val contents =
                ((root["columnInfo"] as? JsonObject)?.get("contents") as? JsonArray)
                    ?.mapNotNull { (it as? JsonObject)?.get("objectInfo") as? JsonObject }
                    ?: return null
            val list = filterMusicInfoList(contents)
            return BoardList(list, list.size, LIMIT, page, "mg")
        }

        /** RN filterMusicInfoList：songId 缺失/重复跳过，newRateFormats → 音质表。 */
        fun filterMusicInfoList(rawList: List<JsonObject>): List<JsonObject> {
            val ids = HashSet<String>()
            val list = mutableListOf<JsonObject>()
            rawList.forEach { item ->
                val songId = item.text("songId")
                if (songId.isEmpty() || !ids.add(songId)) return@forEach
                val qualities =
                    (item["newRateFormats"] as? JsonArray)
                        ?.mapNotNull { formatElement ->
                            val format = formatElement as? JsonObject ?: return@mapNotNull null
                            val type =
                                when (format["formatType"].text()) {
                                    "PQ" -> "128k"
                                    "HQ" -> "320k"
                                    "SQ" -> "flac"
                                    "ZQ" -> "flac24bit"
                                    else -> return@mapNotNull null
                                }
                            // RN: sizeFormate(type.size ?? type.androidSize)
                            val size = format["size"].asLong() ?: format["androidSize"].asLong() ?: 0L
                            type to formatSize(size)
                        }.orEmpty()
                val singers =
                    (item["artists"] as? JsonArray)
                        ?.map { (it as? JsonObject)?.text("name") ?: "" }
                        ?.filter { it.isNotEmpty() }
                        ?.joinToString("、")
                        .orEmpty()
                // RN: /(\d\d:\d\d)$/.test(item.length) → RegExp.$1
                val interval = LENGTH_REGEX.find(item.text("length"))?.groupValues?.get(1)
                val image =
                    ((item["albumImgs"] as? JsonArray)?.firstOrNull() as? JsonObject)
                        ?.text("img")
                        ?.ifEmpty { null }
                list.add(
                    buildJsonObject {
                        put("id", "mg_$songId")
                        put("name", item.text("songName"))
                        put("singer", KwSearch.decodeEntities(singers))
                        put("source", "mg")
                        put("interval", interval?.let { JsonPrimitive(it) } ?: JsonNull)
                        put(
                            "meta",
                            buildJsonObject {
                                put("songId", songId)
                                put("albumName", item.text("album"))
                                put("picUrl", image?.let { JsonPrimitive(it) } ?: JsonNull)
                                put("albumId", item["albumId"] ?: JsonNull)
                                put("copyrightId", item.text("copyrightId"))
                                put("lrcUrl", item["lrcUrl"] ?: JsonNull)
                                put("mrcUrl", item["mrcUrl"] ?: JsonNull)
                                put("trcUrl", item["trcUrl"] ?: JsonNull)
                                put("qualitys", qualityArray(qualities))
                                put("_qualitys", qualityMap(qualities))
                            },
                        )
                    },
                )
            }
            return list
        }

        private val LENGTH_REGEX = Regex("""(\d\d:\d\d)$""")

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

        private fun formatSize(size: Long): String {
            if (size == 0L) return "0 B"
            val units = listOf("B", "KiB", "MiB", "GiB", "TiB")
            val unit = floor(ln(size.toDouble()) / ln(1024.0)).toInt()
            return String.format(Locale.US, "%.2f %s", size / 1024.0.pow(unit), units[unit])
        }

        private fun JsonObject.text(key: String): String =
            when (val v = this[key]) {
                null, is JsonNull -> ""
                is JsonPrimitive -> v.content
                else -> ""
            }

        private fun JsonElement?.text(): String =
            when (this) {
                null, is JsonNull -> ""
                is JsonPrimitive -> content
                else -> ""
            }

        private fun JsonElement?.asLong(): Long? = (this as? JsonPrimitive)?.content?.toLongOrNull()
    }
}
