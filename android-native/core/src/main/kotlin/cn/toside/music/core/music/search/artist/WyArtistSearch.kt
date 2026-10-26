package cn.toside.music.core.music.search.artist

import cn.toside.music.core.music.leaderboard.WyLeaderboard
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
 * 网易云歌手搜索 + 歌手详情（信息 + 热歌 + 专辑）。
 *
 * 本仓库 RN 快照没有 wy artist 模块；响应形状由 2026-10-26 真实响应 fixture 钉住：
 * - 搜索走 **eapi** `/api/cloudsearch/pc`（type=100），构造与歌单搜索同构（复用，
 *   不新写加密）；`result.artists` + `result.artistCount`；
 * - 详情走 **weapi** `weapi/v1/artist/{id}`：`artist` + `hotSongs`（热歌第一页）；
 * - 专辑走 weapi `weapi/artist/albums/{id}`（limit/offset）：`hotAlbums`；
 * - 歌曲内嵌 privilege，转换复用 [SearchDetailSupport.wySongWithPrivilegeToMusicInfo]。
 */
class WyArtistSearch(
    private val fetch: suspend (SearchRequest) -> String,
) {
    suspend fun search(
        keyword: String,
        page: Int = 1,
        limit: Int = DEFAULT_LIMIT,
    ): ArtistSearchPage =
        checkNotNull(parseSearch(fetch(buildSearchRequest(keyword, page, limit)), page, limit)) {
            "wy artist search failed"
        }

    /** 热歌（详情接口第一页）+ 专辑第一页；info 用详情响应覆盖 fallback。 */
    suspend fun detail(
        fallback: ArtistItem,
        page: Int = 1,
    ): ArtistDetail {
        val detailBody = fetch(buildDetailRequest(fallback.id))
        val parsed = parseDetail(detailBody, fallback) ?: error("wy artist detail failed")
        val albumsBody = fetch(buildAlbumsRequest(fallback.id, page))
        val albums = parseAlbums(albumsBody) ?: error("wy artist albums failed")
        return ArtistDetail(info = parsed.first, songs = parsed.second, albums = albums)
    }

    suspend fun albums(
        id: String,
        page: Int = 1,
    ): List<AlbumItem> = parseAlbums(fetch(buildAlbumsRequest(id, page))) ?: error("wy artist albums failed")

    companion object {
        const val DEFAULT_LIMIT = ArtistSearchAggregator.SOURCE_LIMIT
        private const val SEARCH_PATH = "/api/cloudsearch/pc"
        private val json = SearchDetailSupport.json

        fun buildSearchRequest(
            keyword: String,
            page: Int,
            limit: Int,
        ): SearchRequest {
            val body =
                """{"s":"${jsonEscape(keyword)}","type":100,"limit":$limit,"total":${page == 1},"offset":${limit * (page - 1)}}"""
            return SearchDetailSupport.wyEapiRequest(SEARCH_PATH, body)
        }

        fun buildDetailRequest(id: String): SearchRequest =
            SearchRequest(
                url = "https://music.163.com/weapi/v1/artist/$id",
                method = "POST",
                headers =
                    mapOf(
                        "User-Agent" to SearchDetailSupport.WY_USER_AGENT,
                        "origin" to "https://music.163.com",
                    ),
                form = WyLeaderboard.weapiForm("""{"id":${id.toLongOrNull() ?: 0}}"""),
            )

        fun buildAlbumsRequest(
            id: String,
            page: Int,
            limit: Int = ALBUMS_LIMIT,
        ): SearchRequest =
            SearchRequest(
                url = "https://music.163.com/weapi/artist/albums/$id",
                method = "POST",
                headers =
                    mapOf(
                        "User-Agent" to SearchDetailSupport.WY_USER_AGENT,
                        "origin" to "https://music.163.com",
                    ),
                form =
                    WyLeaderboard.weapiForm(
                        """{"id":${id.toLongOrNull() ?: 0},"limit":$limit,"offset":${limit * (page - 1)}}""",
                    ),
            )

        const val ALBUMS_LIMIT = 50

        fun parseSearch(
            body: String,
            page: Int,
            limit: Int,
        ): ArtistSearchPage? {
            val root = runCatching { json.parseToJsonElement(body).jsonObject }.getOrNull() ?: return null
            if (root["code"].asInt() != 200) return null
            val result = root["result"] as? JsonObject ?: return null
            val total = result["artistCount"].asInt() ?: 0
            val list =
                result["artists"].asArray().mapNotNull { element ->
                    val item = element as? JsonObject ?: return@mapNotNull null
                    toArtistItem(item)
                }
            return ArtistSearchPage(
                list = list,
                total = total,
                allPage = if (total == 0) 0 else (total + limit - 1) / limit,
                limit = limit,
                source = "wy",
            )
        }

        private fun toArtistItem(item: JsonObject): ArtistItem? {
            val id = item.text("id")
            if (id.isEmpty()) return null
            return ArtistItem(
                id = id,
                name = item.text("name"),
                picUrl = item.text("picUrl").ifEmpty { null },
                alias = item["alias"].asArray().joinToString("、") { (it as? kotlinx.serialization.json.JsonPrimitive)?.content ?: "" },
                albumCount = item["albumSize"].asInt() ?: 0,
                musicCount = item["musicSize"].asInt() ?: 0,
                source = "wy",
            )
        }

        /** @return (info, 热歌第一页)。 */
        fun parseDetail(
            body: String,
            fallback: ArtistItem,
        ): Pair<ArtistItem, List<JsonObject>>? {
            val root = runCatching { json.parseToJsonElement(body).jsonObject }.getOrNull() ?: return null
            if (root["code"].asInt() != 200) return null
            val artist = root["artist"] as? JsonObject ?: return null
            val id = artist.text("id").ifEmpty { fallback.id }
            val info =
                ArtistItem(
                    id = id,
                    name = artist.text("name").ifEmpty { fallback.name },
                    picUrl = artist.text("picUrl").ifEmpty { fallback.picUrl },
                    alias =
                        artist["alias"].asArray().joinToString(
                            "、",
                        ) { (it as? kotlinx.serialization.json.JsonPrimitive)?.content ?: "" },
                    albumCount = artist["albumSize"].asInt() ?: fallback.albumCount,
                    musicCount = artist["musicSize"].asInt() ?: fallback.musicCount,
                    source = "wy",
                )
            val songs =
                root["hotSongs"].asArray().mapNotNull { (it as? JsonObject)?.let(SearchDetailSupport::wySongWithPrivilegeToMusicInfo) }
            return info to songs
        }

        fun parseAlbums(body: String): List<AlbumItem>? {
            val root = runCatching { json.parseToJsonElement(body).jsonObject }.getOrNull() ?: return null
            if (root["code"].asInt() != 200) return null
            return root["hotAlbums"].asArray().mapNotNull { element ->
                val item = element as? JsonObject ?: return@mapNotNull null
                val id = item.text("id")
                if (id.isEmpty()) return@mapNotNull null
                AlbumItem(
                    id = id,
                    name = item.text("name"),
                    singer = (item["artist"] as? JsonObject).text("name"),
                    picUrl = item.text("picUrl").ifEmpty { null },
                    publishTime = item.text("publishTime").toLongOrNull()?.let { SonglistSearchSupport.date(it.toString()) },
                    songCount = item["size"].asInt() ?: 0,
                    source = "wy",
                )
            }
        }

        private fun jsonEscape(value: String): String =
            value
                .replace("\\", "\\\\")
                .replace("\"", "\\\"")

        private fun JsonObject?.text(key: String): String = this?.get(key).text()
    }
}
