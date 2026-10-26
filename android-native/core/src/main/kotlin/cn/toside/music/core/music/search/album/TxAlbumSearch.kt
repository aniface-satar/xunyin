package cn.toside.music.core.music.search.album

import cn.toside.music.core.music.search.SearchDetailSupport
import cn.toside.music.core.music.search.SearchRequest
import cn.toside.music.core.music.search.SonglistSearchSupport
import cn.toside.music.core.music.search.TxSearch
import cn.toside.music.core.songlist.asArray
import cn.toside.music.core.songlist.asInt
import cn.toside.music.core.songlist.text
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

/**
 * QQ 音乐专辑搜索 + 专辑详情。
 *
 * 对照 RN `tx/album.js`（本仓库 RN 快照只有 `getAlbumInfo`）与 [TxSearch] 的请求构造：
 * - 搜索/详情都走 `musicu.fcg` 的 `DoSearchForQQMusicDesktop` / `GetAlbumDetail`，
 *   zzc 签名直接复用 [TxSearch.zzcSign]，不新写签名；
 * - 搜索响应是综合搜索（body 含 song/album/singer…），这里只取 `body.album.list`；
 *   专辑区无 total，用「整页 → 可能还有下一页」启发式（见 lane 报告）；
 * - **专辑 id 用 `albumMID`**：详情 `GetAlbumDetail` 的参数键是 `albumMid`，
 *   数字 `albumID` 只在歌曲详情的 album 对象里出现（实测 fixture，见 lane 报告坑 3）；
 * - 详情响应（fixture 实测）无 `basicInfo`，解析器容忍缺失，头部信息由调用方
 *   用搜索行数据兜底。
 */
class TxAlbumSearch(
    private val fetch: suspend (SearchRequest) -> String,
    private val searchId: () -> String = { defaultSearchId() },
) {
    suspend fun search(
        keyword: String,
        page: Int = 1,
        limit: Int = DEFAULT_LIMIT,
    ): AlbumSearchPage {
        var attempt = 0
        while (true) {
            attempt++
            val parsed = parseSearch(fetch(buildSearchRequest(keyword, page, limit, searchId())), page, limit)
            if (parsed != null) return parsed
            check(attempt < MAX_ATTEMPTS) { "tx album search failed after $attempt attempts" }
        }
    }

    suspend fun detail(
        id: String,
        page: Int = 1,
    ): AlbumDetail {
        var attempt = 0
        while (true) {
            attempt++
            val parsed = parseDetail(fetch(buildDetailRequest(id, page, searchId())), page)
            if (parsed != null) return parsed
            check(attempt < MAX_ATTEMPTS) { "tx album detail failed after $attempt attempts" }
        }
    }

    companion object {
        const val DEFAULT_LIMIT = AlbumSearchAggregator.SOURCE_LIMIT
        private const val MAX_ATTEMPTS = 6
        private const val SEARCH_RPC = "music.search.SearchCgiService"
        private const val ALBUM_RPC = "music.musichallAlbum.AlbumInfoServer"
        private val json = Json { ignoreUnknownKeys = true }

        private fun musicuRequest(body: String): SearchRequest =
            SearchRequest(
                url = "https://u.y.qq.com/cgi-bin/musics.fcg?sign=${TxSearch.zzcSign(body)}",
                method = "POST",
                headers =
                    mapOf(
                        "User-Agent" to "QQMusic 14090508(android 12)",
                        "Content-Type" to "application/json",
                    ),
                body = body,
            )

        private fun comm() =
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
            }

        fun buildSearchRequest(
            keyword: String,
            page: Int,
            limit: Int,
            searchId: String,
        ): SearchRequest {
            val body =
                buildJsonObject {
                    put("comm", comm())
                    put(
                        SEARCH_RPC,
                        buildJsonObject {
                            put("module", SEARCH_RPC)
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
            return musicuRequest(body)
        }

        fun buildDetailRequest(
            id: String,
            page: Int,
            searchId: String,
        ): SearchRequest {
            val body =
                buildJsonObject {
                    put("comm", comm())
                    put(
                        ALBUM_RPC,
                        buildJsonObject {
                            put("module", ALBUM_RPC)
                            put("method", "GetAlbumDetail")
                            put(
                                "param",
                                buildJsonObject {
                                    put("albumMid", id)
                                    put("albumId", 0)
                                },
                            )
                        },
                    )
                }.toString()
            return musicuRequest(body)
        }

        fun parseSearch(
            body: String,
            page: Int,
            limit: Int,
        ): AlbumSearchPage? {
            val root = runCatching { json.parseToJsonElement(body).jsonObject }.getOrNull() ?: return null
            if (root["code"].asInt() != 0) return null
            val data = root["req"] as? JsonObject ?: return null
            if (data["code"].asInt() != 0) return null
            val albumZone =
                ((((data["data"] as? JsonObject)?.get("body") as? JsonObject)?.get("album") as? JsonObject))
                    ?: return null
            val list =
                albumZone["list"].asArray().mapNotNull { element ->
                    val item = element as? JsonObject ?: return@mapNotNull null
                    toAlbumItem(item)
                }
            // 综合搜索的专辑区没有 total：整页结果视为可能还有下一页
            val allPage = if (list.size >= limit) page + 1 else page
            return AlbumSearchPage(list = list, total = 0, allPage = allPage, limit = limit, source = "tx")
        }

        private fun toAlbumItem(item: JsonObject): AlbumItem? {
            // 详情接口按 albumMid 寻址，id 一律取 MID
            val id = item.text("albumMID")
            if (id.isEmpty()) return null
            return AlbumItem(
                id = id,
                name = SonglistSearchSupport.decodeName(item.text("albumName")),
                singer = SonglistSearchSupport.decodeName(item.text("singerName")),
                picUrl = SonglistSearchSupport.nullableText(item.text("albumPic")),
                publishTime = SonglistSearchSupport.nullableText(item.text("publicTime")),
                songCount = item["song_count"].asInt() ?: 0,
                source = "tx",
            )
        }

        fun parseDetail(
            body: String,
            page: Int,
        ): AlbumDetail? {
            val root = runCatching { json.parseToJsonElement(body).jsonObject }.getOrNull() ?: return null
            if (root["code"].asInt() != 0) return null
            val req = root["req"] as? JsonObject ?: return null
            if (req["code"].asInt() != 0) return null
            val data = req["data"] as? JsonObject ?: return null
            val songList = data["songList"].asArray()
            val songs =
                songList.mapNotNull { element ->
                    val songInfo = (element as? JsonObject)?.get("songInfo") as? JsonObject ?: return@mapNotNull null
                    SearchDetailSupport.txSongInfoToMusicInfo(songInfo)
                }
            val totalNum = data["totalNum"].asInt() ?: songs.size
            val basicInfo = data["basicInfo"] as? JsonObject
            val info =
                AlbumItem(
                    id = data.text("albumMid"),
                    name = SonglistSearchSupport.decodeName(basicInfo.text("albumName")),
                    singer = SonglistSearchSupport.decodeName(basicInfo.text("singerName")),
                    picUrl = basicInfo.text("albumPic").ifEmpty { null },
                    publishTime = SonglistSearchSupport.nullableText(basicInfo.text("publishDate")),
                    songCount = totalNum,
                    source = "tx",
                )
            // 详情接口一次返回整张专辑；limit 取 total 保证 allPage=1（一页装完语义）
            return AlbumDetail(info = info, songs = songs, total = totalNum, page = page, limit = totalNum.coerceAtLeast(1))
        }

        private fun JsonObject?.text(key: String): String = this?.get(key).text()

        /** 与 [TxSearch] 同构的搜索会话 id（原实现私有，这里按同形状生成）。 */
        private fun defaultSearchId(): String {
            val guid =
                buildString(32) {
                    repeat(32) {
                        append(
                            kotlin.random.Random
                                .nextInt(16)
                                .toString(16),
                        )
                    }
                }.uppercase(java.util.Locale.US)
            return guid +
                kotlin.random.Random
                    .nextInt(100_000)
                    .toString()
                    .padStart(5, '0')
        }
    }
}
