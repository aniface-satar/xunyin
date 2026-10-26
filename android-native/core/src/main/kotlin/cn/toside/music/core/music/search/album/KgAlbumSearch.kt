package cn.toside.music.core.music.search.album

import cn.toside.music.core.music.search.SearchDetailSupport
import cn.toside.music.core.music.search.SearchRequest
import cn.toside.music.core.music.search.SonglistSearchSupport
import cn.toside.music.core.songlist.asArray
import cn.toside.music.core.songlist.asInt
import cn.toside.music.core.songlist.text
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject

/**
 * 酷狗专辑搜索 + 专辑详情。
 *
 * 对照 RN `kg/album.js`：
 * - 详情 = `api/v3/album/song`（pagesize=limit，RN 默认 **200**，正常专辑一页装完，
 *   `total` 来自响应 `data.total`，超过 200 时 `page` 参数真实分页）+ `getAlbumInfo`
 *   两段；列表接口只给 hash，需再走 `gateway.kugou.com/v3/album_audio/audio`
 *   批量换完整信息（RN `getMusicInfosByList` 两步链，见 [SearchDetailSupport]）；
 * - 搜索接口为无 RN 参照的重构（`api/v3/search/album`，响应形状由 fixture 钉住）。
 */
class KgAlbumSearch(
    private val fetch: suspend (SearchRequest) -> String,
) {
    suspend fun search(
        keyword: String,
        page: Int = 1,
        limit: Int = DEFAULT_LIMIT,
    ): AlbumSearchPage =
        checkNotNull(parseSearch(fetch(buildSearchRequest(keyword, page, limit)), page, limit)) {
            "kg album search failed"
        }

    /** RN `getAlbumDetail`：曲目列表（hash）→ 网关补全 → 专辑信息，三段串行。 */
    suspend fun detail(
        id: String,
        page: Int = 1,
        limit: Int = DETAIL_LIMIT,
    ): AlbumDetail {
        val listBody = fetch(buildDetailSongRequest(id, page, limit))
        val parsedSongs = parseDetailSongs(listBody) ?: error("kg album song list failed")
        val hashes = parsedSongs.hashes
        val songs =
            if (hashes.isEmpty()) {
                emptyList()
            } else {
                val gatewayBodies = SearchDetailSupport.kgGatewayRequests(hashes).map { fetch(it) }
                gatewayBodies
                    .flatMap { SearchDetailSupport.kgGatewayParse(it) }
                    .let(SearchDetailSupport::kgAudioListToMusicInfos)
            }
        val infoBody = fetch(buildInfoRequest(id))
        val info = parseInfo(infoBody) ?: error("kg album info failed")
        return AlbumDetail(
            info = info,
            songs = songs,
            total = parsedSongs.total,
            page = page,
            limit = limit,
        )
    }

    /** 单独取专辑信息（名称/封面/歌手/发行时间/简介），详情链与外部复用。 */
    suspend fun info(id: String): AlbumItem? = parseInfo(fetch(buildInfoRequest(id)))

    data class SongHashPage(
        val hashes: List<String>,
        val total: Int,
    )

    companion object {
        const val DEFAULT_LIMIT = AlbumSearchAggregator.SOURCE_LIMIT

        /** RN `kg/album.js#getAlbumDetail` 默认 limit=200：一页装完。 */
        const val DETAIL_LIMIT = 200
        private val json = SearchDetailSupport.json

        fun buildSearchRequest(
            keyword: String,
            page: Int,
            limit: Int,
        ): SearchRequest =
            SearchRequest(
                url =
                    "http://mobiles.kugou.com/api/v3/search/album?keyword=" +
                        "${SonglistSearchSupport.encode(keyword)}" +
                        "&page=$page&pagesize=$limit&version=9108&showtype=1&sver=2",
            )

        fun buildDetailSongRequest(
            id: String,
            page: Int,
            limit: Int = DETAIL_LIMIT,
        ): SearchRequest =
            SearchRequest(
                url =
                    "http://mobiles.kugou.com/api/v3/album/song?version=9108&albumid=$id&plat=0" +
                        "&pagesize=$limit&area_code=0&page=$page&with_res_tag=0",
            )

        fun buildInfoRequest(id: String): SearchRequest = SearchRequest(url = "http://mobiles.kugou.com/api/v3/album/info?albumid=$id")

        fun parseSearch(
            body: String,
            page: Int,
            limit: Int,
        ): AlbumSearchPage? {
            val root = runCatching { json.parseToJsonElement(body).jsonObject }.getOrNull() ?: return null
            if (root["status"].asInt() != 1 || root["errcode"].asInt() != 0) return null
            val data = root["data"] as? JsonObject ?: return null
            val total = data["total"].asInt() ?: 0
            val list =
                data["info"].asArray().mapNotNull { element ->
                    val item = element as? JsonObject ?: return@mapNotNull null
                    val id = item.text("albumid")
                    if (id.isEmpty()) return@mapNotNull null
                    AlbumItem(
                        id = id,
                        name = item.text("albumname"),
                        singer = item.text("singername"),
                        picUrl = item.text("imgurl").ifEmpty { null }?.replace("{size}", "240"),
                        publishTime = item.text("publishtime").take(10).ifEmpty { null },
                        songCount = item["songcount"].asInt() ?: 0,
                        source = "kg",
                    )
                }
            return AlbumSearchPage(
                list = list,
                total = total,
                allPage = if (total == 0) 0 else (total + limit - 1) / limit,
                limit = limit,
                source = "kg",
            )
        }

        fun parseDetailSongs(body: String): SongHashPage? {
            val root = runCatching { json.parseToJsonElement(body).jsonObject }.getOrNull() ?: return null
            if (root["errcode"].asInt() != 0) return null
            val data = root["data"] as? JsonObject ?: return null
            val total = data["total"].asInt() ?: 0
            val hashes =
                data["info"].asArray().mapNotNull { element ->
                    (element as? JsonObject)?.text("hash")?.ifEmpty { null }
                }
            return SongHashPage(hashes, total)
        }

        fun parseInfo(body: String): AlbumItem? {
            val root = runCatching { json.parseToJsonElement(body).jsonObject }.getOrNull() ?: return null
            val data = root["data"] as? JsonObject ?: return null
            val id = data.text("albumid")
            if (id.isEmpty()) return null
            return AlbumItem(
                id = id,
                name = data.text("albumname"),
                singer = data.text("singername"),
                picUrl = data.text("imgurl").ifEmpty { null }?.replace("{size}", "240"),
                publishTime = data.text("publishtime").take(10).ifEmpty { null },
                songCount = data["songcount"].asInt() ?: 0,
                source = "kg",
            )
        }

        private fun JsonObject.text(key: String): String = this[key].text()
    }
}
