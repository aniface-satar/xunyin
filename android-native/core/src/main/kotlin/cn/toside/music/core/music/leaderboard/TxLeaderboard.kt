package cn.toside.music.core.music.leaderboard

import cn.toside.music.core.music.search.KwSearch
import cn.toside.music.core.music.search.SearchRequest
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
 * QQ 音乐排行榜 —— 对照 RN `musicSdk/tx/leaderboard.js`。
 *
 * tx 榜单详情需要 `period`（榜单期号）：先抓 `c.y.qq.com/node/pc/wk_v15/top.html`
 * 用正则解析出各榜期号（RN periods 表缓存），再 POST `u.y.qq.com/cgi-bin/musicu.fcg`
 * 拉 `GetDetail`。一次返回整榜（无分页），total = songInfoList.length。
 *
 * 传输统一走 [SearchRequest]（与 RN request.js 一致：POST body 时
 * Content-Type 为 application/json；HTML 抓取就是 GET 返回文本）。
 */
class TxLeaderboard(
    private val fetch: suspend (SearchRequest) -> String,
) : LeaderboardSource {
    override val source: String = "tx"

    /** RN periods 表：bangid → period（期号）。 */
    private val periods = HashMap<String, String>()

    override fun getBoards(): List<BoardItem> = LEADERBOARD_BOARDS.getValue("tx")

    override suspend fun getList(
        bangid: String,
        page: Int,
    ): BoardList {
        // RN getList: bangid = parseInt(bangid) —— 数字进请求体与期号表
        val topId = bangid.toLongOrNull() ?: error("tx bangid not numeric: $bangid")
        var period = periods[topId.toString()]
        if (period == null) {
            period = fetchPeriod(topId.toString())
            checkNotNull(period) { "tx leaderboard period not found for $topId" }
        }
        var attempt = 0
        while (true) {
            attempt++
            val body = fetch(buildRequest(topId, period, LIMIT))
            val parsed = parse(body)
            if (parsed != null) return parsed
            check(attempt < MAX_ATTEMPTS) { "tx leaderboard failed after $attempt attempts" }
        }
    }

    /** RN getPeriods：抓 HTML 解析期号表后取目标榜的期号。 */
    private suspend fun fetchPeriod(bangid: String): String? {
        val html =
            fetch(
                SearchRequest(
                    url = PERIOD_URL,
                    headers = mapOf("User-Agent" to DETAIL_UA),
                ),
            )
        PERIOD_REGEX.findAll(html).forEach { match ->
            periods[match.groupValues[2]] = match.groupValues[3]
        }
        return periods[bangid]
    }

    companion object {
        const val LIMIT = 300
        private const val MAX_ATTEMPTS = 3
        private const val PERIOD_URL = "https://c.y.qq.com/node/pc/wk_v15/top.html"

        /** RN listDetailRequest / getData 用的 IE9 UA。 */
        private const val DETAIL_UA =
            "Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; WOW64; Trident/5.0)"
        private val json = Json { ignoreUnknownKeys = true }

        /** RN regExps.period：`data-listname="(.+?)" data-tid=".*?\/(.+?)" data-date="(.+?)" .+?<\/i>` */
        private val PERIOD_REGEX =
            Regex("""data-listname="(.+?)" data-tid=".*?/(.+?)" data-date="(.+?)" .+?</i>""")

        fun buildRequest(
            topId: Long,
            period: String,
            limit: Int,
        ): SearchRequest {
            val body =
                buildJsonObject {
                    put(
                        "toplist",
                        buildJsonObject {
                            put("module", "musicToplist.ToplistInfoServer")
                            put("method", "GetDetail")
                            put(
                                "param",
                                buildJsonObject {
                                    put("topid", topId)
                                    put("num", limit)
                                    put("period", period)
                                },
                            )
                        },
                    )
                    put(
                        "comm",
                        buildJsonObject {
                            put("uin", 0)
                            put("format", "json")
                            put("ct", 20)
                            put("cv", 1859)
                        },
                    )
                }.toString()
            return SearchRequest(
                url = "https://u.y.qq.com/cgi-bin/musicu.fcg",
                method = "POST",
                headers =
                    mapOf(
                        "User-Agent" to DETAIL_UA,
                        "Content-Type" to "application/json",
                    ),
                body = body,
            )
        }

        fun parse(body: String): BoardList? {
            val root = runCatching { json.parseToJsonElement(body).jsonObject }.getOrNull() ?: return null
            if ((root["code"] as? JsonPrimitive)?.content?.toIntOrNull() != 0) return null
            val toplist = root["toplist"] as? JsonObject ?: return null
            val data = toplist["data"] as? JsonObject ?: return null
            val songs = data["songInfoList"] as? JsonArray ?: return null
            return BoardList(
                list = songs.mapNotNull { (it as? JsonObject)?.let(::toMusicInfo) },
                total = songs.size,
                limit = LIMIT,
                page = 1,
                source = "tx",
            )
        }

        private fun toMusicInfo(item: JsonObject): JsonObject? {
            val songMid = item.text("mid")
            if (songMid.isEmpty()) return null
            val file = item["file"] as? JsonObject ?: return null
            val album = item["album"] as? JsonObject
            val singerList = item["singer"] as? JsonArray
            val singer =
                singerList
                    ?.mapNotNull { (it as? JsonObject)?.text("name")?.ifEmpty { null } }
                    ?.joinToString("、")
                    .orEmpty()
            val albumMid = album?.text("mid").orEmpty()
            val albumName = album?.text("name").orEmpty()
            // RN filterData 的 img 分支按 album.name 判定（不是 album.mid）
            val picUrl =
                if (albumName.isEmpty() || albumName == "空") {
                    (singerList?.firstOrNull() as? JsonObject)
                        ?.text("mid")
                        ?.ifEmpty { null }
                        ?.let { "https://y.gtimg.cn/music/photo_new/T001R500x500M000$it.jpg" }
                        .orEmpty()
                } else {
                    "https://y.gtimg.cn/music/photo_new/T002R500x500M000$albumMid.jpg"
                }
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
            return buildJsonObject {
                put("id", "tx_$songMid")
                put("name", item.text("title"))
                put("singer", KwSearch.decodeEntities(singer))
                put("source", "tx")
                put("interval", formatInterval(item.text("interval").toLongOrNull() ?: 0L))
                put(
                    "meta",
                    buildJsonObject {
                        put("songId", songMid)
                        put("albumName", albumName)
                        put("picUrl", picUrl)
                        put("albumId", albumMid)
                        put("strMediaMid", file.text("media_mid"))
                        put("albumMid", albumMid)
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
                qualities.forEach { (type, size) ->
                    put(
                        type,
                        buildJsonObject { put("size", size) },
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

        private fun JsonElement?.asLong(): Long? = (this as? JsonPrimitive)?.content?.toLongOrNull()
    }
}
