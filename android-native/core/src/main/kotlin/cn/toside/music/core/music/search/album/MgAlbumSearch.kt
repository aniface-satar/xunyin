package cn.toside.music.core.music.search.album

import cn.toside.music.core.music.leaderboard.MgLeaderboard
import cn.toside.music.core.music.search.SearchDetailSupport
import cn.toside.music.core.music.search.SearchRequest
import cn.toside.music.core.music.search.text
import cn.toside.music.core.songlist.asArray
import cn.toside.music.core.songlist.asInt
import cn.toside.music.core.songlist.text
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject

/**
 * 咪咕专辑搜索 + 专辑详情。
 *
 * - 搜索复用 `jadeite searchAll`（与歌单搜索同端点同签名，只是 `searchSwitch`
 *   打开 `album`），响应走 `albumResultData`，`totalCount` 是**字符串**；
 * - 详情对照 RN `mg/album.js`：`queryAlbumSong?albumId&pageNo` 拿曲目 +
 *   `MIGUM3.0/resource/album/v2.0` 拿信息两段；曲目转换直接复用排行榜模块公开的
 *   [MgLeaderboard.filterMusicInfoList]；RN 把 `limit` 置为 total（一页装完语义），
 *   这里沿用。
 */
class MgAlbumSearch(
    private val fetch: suspend (SearchRequest) -> String,
    private val clock: () -> String = { System.currentTimeMillis().toString() },
) {
    suspend fun search(
        keyword: String,
        page: Int = 1,
        limit: Int = DEFAULT_LIMIT,
    ): AlbumSearchPage =
        checkNotNull(parseSearch(fetch(buildSearchRequest(keyword, page, limit, clock())), page, limit)) {
            "mg album search failed"
        }

    /** RN `getAlbumDetail`：曲目 + 专辑信息两段串行。 */
    suspend fun detail(
        id: String,
        page: Int = 1,
    ): AlbumDetail {
        val songBody = fetch(buildSongsRequest(id, page))
        val parsed = parseSongs(songBody) ?: error("mg album songs failed")
        val info = info(id) ?: error("mg album info failed")
        // RN：limit = total（一页装完语义）
        return AlbumDetail(
            info = info,
            songs = parsed.list,
            total = parsed.total,
            page = page,
            limit = parsed.total.coerceAtLeast(1),
        )
    }

    suspend fun info(id: String): AlbumItem? = parseInfo(fetch(buildInfoRequest(id)))

    companion object {
        const val DEFAULT_LIMIT = AlbumSearchAggregator.SOURCE_LIMIT
        private val json = SearchDetailSupport.json

        fun buildSearchRequest(
            keyword: String,
            page: Int,
            limit: Int,
            time: String,
        ): SearchRequest =
            SearchDetailSupport.mgSearchAllRequest(
                keyword = keyword,
                page = page,
                limit = limit,
                time = time,
                switches = mapOf("album" to 1),
            )

        fun buildSongsRequest(
            id: String,
            page: Int,
        ): SearchRequest = SearchRequest(url = "http://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/queryAlbumSong?albumId=$id&pageNo=$page")

        fun buildInfoRequest(id: String): SearchRequest =
            SearchRequest(url = "https://app.c.nf.migu.cn/MIGUM3.0/resource/album/v2.0?albumId=$id")

        fun parseSearch(
            body: String,
            page: Int,
            limit: Int,
        ): AlbumSearchPage? {
            val root = runCatching { json.parseToJsonElement(body).jsonObject }.getOrNull() ?: return null
            if (root["code"].text() != "000000") return null
            val data = root["albumResultData"] as? JsonObject ?: return null
            val total = data["totalCount"].text().toIntOrNull() ?: 0
            val list =
                data["result"].asArray().mapNotNull { element ->
                    val item = element as? JsonObject ?: return@mapNotNull null
                    toAlbumItem(item)
                }
            return AlbumSearchPage(
                list = list,
                total = total,
                allPage = if (total == 0) 0 else (total + limit - 1) / limit,
                limit = limit,
                source = "mg",
            )
        }

        private fun toAlbumItem(item: JsonObject): AlbumItem? {
            val id = item.text("id")
            if (id.isEmpty()) return null
            return AlbumItem(
                id = id,
                name = item.text("name"),
                singer = item.text("singer"),
                picUrl = (item["imgItems"].asArray().firstOrNull() as? JsonObject)?.get("img").text().ifEmpty { null },
                publishTime = songlistNullableText(item.text("publishDate")),
                songCount = 0,
                source = "mg",
            )
        }

        data class SongPage(
            val list: List<JsonObject>,
            val total: Int,
        )

        fun parseSongs(body: String): SongPage? {
            val root = runCatching { json.parseToJsonElement(body).jsonObject }.getOrNull() ?: return null
            if (root["code"].text() != "000000") return null
            val data = root["data"] as? JsonObject ?: return null
            val rawList =
                data["songList"].asArray().mapNotNull { element -> element as? JsonObject }
            val total = data["totalCount"].asInt() ?: data["totalCount"].text().toIntOrNull() ?: 0
            return SongPage(MgLeaderboard.filterMusicInfoList(rawList), total)
        }

        fun parseInfo(body: String): AlbumItem? {
            val root = runCatching { json.parseToJsonElement(body).jsonObject }.getOrNull() ?: return null
            val data = root["data"] as? JsonObject ?: return null
            val id = data.text("albumId")
            if (id.isEmpty()) return null
            return AlbumItem(
                id = id,
                name = data.text("title"),
                singer = data.text("singer"),
                picUrl = (data["imgItems"].asArray().firstOrNull() as? JsonObject)?.get("img").text().ifEmpty { null },
                publishTime = songlistNullableText(data.text("publishDate").ifEmpty { data.text("publishTime") }),
                songCount = data["totalCount"].asInt() ?: data["totalCount"].text().toIntOrNull() ?: 0,
                source = "mg",
            )
        }

        private fun songlistNullableText(value: String): String? = value.trim().ifEmpty { null }

        private fun JsonObject.text(key: String): String = this[key].text()
    }
}
