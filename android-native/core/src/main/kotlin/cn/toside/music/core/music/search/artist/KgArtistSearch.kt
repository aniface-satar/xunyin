package cn.toside.music.core.music.search.artist

import cn.toside.music.core.music.search.SearchDetailSupport
import cn.toside.music.core.music.search.SearchRequest
import cn.toside.music.core.music.search.SonglistSearchSupport
import cn.toside.music.core.music.search.album.AlbumItem
import cn.toside.music.core.songlist.asArray
import cn.toside.music.core.songlist.asInt
import cn.toside.music.core.songlist.text
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject

/**
 * 酷狗歌手搜索 + 歌手详情（信息 + 热歌 + 专辑）。
 *
 * 本仓库 RN 快照没有 kg artist 模块；请求/响应形状由 2026-10-26 真实响应 fixture 钉住：
 * - 搜索 `api/v3/search/singer`：`data` 是**纯数组**（无 total）→「整页 → 下一页」启发式；
 * - 信息 `api/v5/singer/info`：singername/imgurl/intro/songcount/albumcount；
 * - 热歌 `api/v3/singer/song` 只给 hash → 走 [SearchDetailSupport.kgGatewayRequests]
 *   网关两步链补全（与 kg 专辑详情同一套路）；
 * - 专辑 `api/v3/singer/album`（albumid/albumname/imgurl/publishtime/songcount）。
 */
class KgArtistSearch(
    private val fetch: suspend (SearchRequest) -> String,
) {
    suspend fun search(
        keyword: String,
        page: Int = 1,
        limit: Int = DEFAULT_LIMIT,
    ): ArtistSearchPage =
        checkNotNull(parseSearch(fetch(buildSearchRequest(keyword, page, limit)), page, limit)) {
            "kg artist search failed"
        }

    /** 热歌 + 专辑 + 信息三段；info 覆盖 fallback 的头部字段。 */
    suspend fun detail(
        fallback: ArtistItem,
        page: Int = 1,
    ): ArtistDetail {
        val songBody = fetch(buildSongsRequest(fallback.id, page))
        val parsedSongs = parseSongs(songBody) ?: error("kg artist songs failed")
        val songs =
            if (parsedSongs.hashes.isEmpty()) {
                emptyList()
            } else {
                SearchDetailSupport
                    .kgGatewayRequests(parsedSongs.hashes)
                    .map { fetch(it) }
                    .flatMap { SearchDetailSupport.kgGatewayParse(it) }
                    .let(SearchDetailSupport::kgAudioListToMusicInfos)
            }
        val albumsBody = fetch(buildAlbumsRequest(fallback.id, page))
        val albums = parseAlbums(albumsBody) ?: error("kg artist albums failed")
        val info = parseInfo(fetch(buildInfoRequest(fallback.id))) ?: fallback
        return ArtistDetail(info = info, songs = songs, albums = albums)
    }

    data class SongHashPage(
        val hashes: List<String>,
        val total: Int,
    )

    companion object {
        const val DEFAULT_LIMIT = ArtistSearchAggregator.SOURCE_LIMIT
        private val json = SearchDetailSupport.json

        fun buildSearchRequest(
            keyword: String,
            page: Int,
            limit: Int,
        ): SearchRequest =
            SearchRequest(
                url =
                    "http://mobiles.kugou.com/api/v3/search/singer?keyword=" +
                        "${SonglistSearchSupport.encode(keyword)}&page=$page&pagesize=$limit" +
                        "&version=9108&sver=2",
            )

        fun buildInfoRequest(id: String): SearchRequest = SearchRequest(url = "http://mobiles.kugou.com/api/v5/singer/info?singerid=$id")

        fun buildSongsRequest(
            id: String,
            page: Int,
        ): SearchRequest =
            SearchRequest(
                url =
                    "http://mobiles.kugou.com/api/v3/singer/song?version=9108&singerid=$id&plat=0" +
                        "&pagesize=$SONGS_LIMIT&area_code=0&page=$page&with_res_tag=0",
            )

        fun buildAlbumsRequest(
            id: String,
            page: Int,
        ): SearchRequest =
            SearchRequest(
                url =
                    "http://mobiles.kugou.com/api/v3/singer/album?version=9108&singerid=$id&plat=0" +
                        "&pagesize=$ALBUMS_LIMIT&area_code=0&page=$page&with_res_tag=0",
            )

        const val SONGS_LIMIT = 100
        const val ALBUMS_LIMIT = 100

        fun parseSearch(
            body: String,
            page: Int,
            limit: Int,
        ): ArtistSearchPage? {
            val root = runCatching { json.parseToJsonElement(body).jsonObject }.getOrNull() ?: return null
            if (root["status"].asInt() != 1 || root["errcode"].asInt() != 0) return null
            // data 是纯数组（无 total）
            val list =
                root["data"].asArray().mapNotNull { element ->
                    val item = element as? JsonObject ?: return@mapNotNull null
                    val id = item.text("singerid")
                    if (id.isEmpty()) return@mapNotNull null
                    ArtistItem(
                        id = id,
                        name = item.text("singername"),
                        source = "kg",
                    )
                }
            val allPage = if (list.size >= limit) page + 1 else page
            return ArtistSearchPage(list = list, total = 0, allPage = allPage, limit = limit, source = "kg")
        }

        fun parseInfo(body: String): ArtistItem? {
            val root = runCatching { json.parseToJsonElement(body).jsonObject }.getOrNull() ?: return null
            val data = root["data"] as? JsonObject ?: return null
            val id = data.text("singerid")
            if (id.isEmpty()) return null
            return ArtistItem(
                id = id,
                name = data.text("singername"),
                picUrl = data.text("imgurl").ifEmpty { null }?.replace("{size}", "240"),
                alias =
                    (data["alias"].asArray().joinToString("、") { (it as? kotlinx.serialization.json.JsonPrimitive)?.content ?: "" })
                        .ifEmpty { "" },
                albumCount = data["albumcount"].asInt() ?: 0,
                musicCount = data["songcount"].asInt() ?: 0,
                source = "kg",
            )
        }

        fun parseSongs(body: String): SongHashPage? {
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

        fun parseAlbums(body: String): List<AlbumItem>? {
            val root = runCatching { json.parseToJsonElement(body).jsonObject }.getOrNull() ?: return null
            if (root["errcode"].asInt() != 0) return null
            val data = root["data"] as? JsonObject ?: return null
            return data["info"].asArray().mapNotNull { element ->
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
        }

        private fun JsonObject.text(key: String): String = this[key].text()
    }
}
