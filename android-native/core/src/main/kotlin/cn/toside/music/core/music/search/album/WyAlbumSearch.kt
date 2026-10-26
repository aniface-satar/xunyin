package cn.toside.music.core.music.search.album

import cn.toside.music.core.music.leaderboard.WyLeaderboard
import cn.toside.music.core.music.search.SearchDetailSupport
import cn.toside.music.core.music.search.SearchRequest
import cn.toside.music.core.music.search.SonglistSearchSupport
import cn.toside.music.core.songlist.asArray
import cn.toside.music.core.songlist.asInt
import cn.toside.music.core.songlist.text
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject

/**
 * 网易云专辑搜索 + 专辑详情。
 *
 * - 搜索走 **eapi** `/api/cloudsearch/pc`（type=10），请求构造与 [cn.toside.music.core.music.search.WySonglistSearch]
 *   同构（通过 [SearchDetailSupport.wyEapiRequest] 复用，不新写加密）；
 * - 详情走 **weapi** `weapi/v1/album/{id}`（RN `wy/album.js#getAlbumInfo` 同款接口，
 *   但同时解析 `songs`），weapi 表单复用 `WyLeaderboard.weapiForm`；
 * - `publishTime` 是毫秒时间戳，格式化为 `Y-M-D`（RN `formatPublishDate` 同义）。
 */
class WyAlbumSearch(
    private val fetch: suspend (SearchRequest) -> String,
) {
    suspend fun search(
        keyword: String,
        page: Int = 1,
        limit: Int = DEFAULT_LIMIT,
    ): AlbumSearchPage =
        checkNotNull(parseSearch(fetch(buildSearchRequest(keyword, page, limit)), page, limit)) {
            "wy album search failed"
        }

    suspend fun detail(
        id: String,
        page: Int = 1,
    ): AlbumDetail = checkNotNull(parseDetail(fetch(buildDetailRequest(id)), page)) { "wy album detail failed" }

    companion object {
        const val DEFAULT_LIMIT = AlbumSearchAggregator.SOURCE_LIMIT
        private const val SEARCH_PATH = "/api/cloudsearch/pc"
        private val json = SearchDetailSupport.json

        fun buildSearchRequest(
            keyword: String,
            page: Int,
            limit: Int,
        ): SearchRequest {
            val body =
                """{"s":"${jsonEscape(keyword)}","type":10,"limit":$limit,"total":${page == 1},"offset":${limit * (page - 1)}}"""
            return SearchDetailSupport.wyEapiRequest(SEARCH_PATH, body)
        }

        fun buildDetailRequest(id: String): SearchRequest =
            SearchRequest(
                url = "https://music.163.com/weapi/v1/album/$id",
                method = "POST",
                headers =
                    mapOf(
                        "User-Agent" to SearchDetailSupport.WY_USER_AGENT,
                        "origin" to "https://music.163.com",
                    ),
                form = WyLeaderboard.weapiForm("""{"id":${id.toLongOrNull() ?: 0},"n":0,"s":0}"""),
            )

        fun parseSearch(
            body: String,
            page: Int,
            limit: Int,
        ): AlbumSearchPage? {
            val root = runCatching { json.parseToJsonElement(body).jsonObject }.getOrNull() ?: return null
            if (root["code"].asInt() != 200) return null
            val result = root["result"] as? JsonObject ?: return null
            val total = result["albumCount"].asInt() ?: 0
            val list =
                result["albums"].asArray().mapNotNull { element ->
                    val item = element as? JsonObject ?: return@mapNotNull null
                    toAlbumItem(item)
                }
            return AlbumSearchPage(
                list = list,
                total = total,
                allPage = if (total == 0) 0 else (total + limit - 1) / limit,
                limit = limit,
                source = "wy",
            )
        }

        private fun toAlbumItem(item: JsonObject): AlbumItem? {
            val id = item.text("id")
            if (id.isEmpty()) return null
            val artist = item["artist"] as? JsonObject
            return AlbumItem(
                id = id,
                name = item.text("name"),
                singer = artist.text("name"),
                picUrl = WyNullable.text(item, "picUrl"),
                publishTime = item.text("publishTime").toLongOrNull()?.let { SonglistSearchSupport.date(it.toString()) },
                songCount = item["size"].asInt() ?: 0,
                source = "wy",
            )
        }

        fun parseDetail(
            body: String,
            page: Int,
        ): AlbumDetail? {
            val root = runCatching { json.parseToJsonElement(body).jsonObject }.getOrNull() ?: return null
            // RN：非 200 / 无 album 视为失败
            if (root["code"].asInt() != 200) return null
            val album = root["album"] as? JsonObject ?: return null
            val songs = root["songs"].asArray().mapNotNull { (it as? JsonObject)?.let(SearchDetailSupport::wySongWithPrivilegeToMusicInfo) }
            val info =
                AlbumItem(
                    id = album.text("id"),
                    name = album.text("name"),
                    singer = (album["artist"] as? JsonObject).text("name"),
                    picUrl = WyNullable.text(album, "picUrl"),
                    publishTime = album.text("publishTime").toLongOrNull()?.let { SonglistSearchSupport.date(it.toString()) },
                    songCount = album["size"].asInt() ?: songs.size,
                    source = "wy",
                )
            // 接口一次返回整张专辑：limit 取 total，allPage=1（一页装完）
            val total = info.songCount.coerceAtLeast(songs.size)
            return AlbumDetail(info = info, songs = songs, total = total, page = page, limit = total.coerceAtLeast(1))
        }

        private fun jsonEscape(value: String): String =
            value
                .replace("\\", "\\\\")
                .replace("\"", "\\\"")

        private fun JsonObject?.text(key: String): String = this?.get(key).text()
    }
}

/** wy 字段兜底小工具：null/缺失一律 null。 */
private object WyNullable {
    fun text(
        item: JsonObject?,
        key: String,
    ): String? = item?.get(key).text().ifEmpty { null }
}
