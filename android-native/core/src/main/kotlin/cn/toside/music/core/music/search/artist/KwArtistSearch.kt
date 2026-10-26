package cn.toside.music.core.music.search.artist

import cn.toside.music.core.music.search.SearchDetailSupport
import cn.toside.music.core.music.search.SearchRequest
import cn.toside.music.core.music.search.SonglistSearchSupport
import cn.toside.music.core.music.search.album.AlbumItem
import cn.toside.music.core.songlist.asArray
import cn.toside.music.core.songlist.text
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * 酷我歌手搜索 + 歌手详情（热歌 + 专辑）。
 *
 * 本仓库 RN 快照没有 kw artist 模块；搜索/热歌/专辑响应形状由 2026-10-26
 * 真实响应 fixture 钉住（`r.s` 家族，与单曲/专辑搜索同款单引号对象串）：
 * - 搜索 `ft=artist`：`abslist`（ARTIST/ARTISTID/ALBUMNUM/SONGNUM/PICPATH）+ `TOTAL`；
 * - 热歌：`abslist` 带 `MUSICRID`/`FORMATS`，音质表走 FORMATS（同 RN
 *   `kw/album.js#filterListDetail` 的映射）；
 * - 专辑：`albumlist`（与专辑搜索同形状）；
 * - 歌手简介接口（www API）需要 kw_token，**不实现**；详情头部信息用搜索行数据兜底
 *   （[detail] 的 `fallback` 参数），见 lane 报告。
 */
class KwArtistSearch(
    private val fetch: suspend (SearchRequest) -> String,
) {
    suspend fun search(
        keyword: String,
        page: Int = 1,
        limit: Int = DEFAULT_LIMIT,
    ): ArtistSearchPage {
        var attempt = 0
        while (true) {
            attempt++
            val parsed = parseSearch(fetch(buildSearchRequest(keyword, page, limit)), page, limit)
            if (parsed != null) return parsed
            check(attempt < MAX_ATTEMPTS) { "kw artist search failed after $attempt attempts" }
        }
    }

    /** 热歌第一页 + 专辑第一页；info 用搜索行数据（或调用方传入的 item）兜底。 */
    suspend fun detail(
        fallback: ArtistItem,
        page: Int = 1,
    ): ArtistDetail {
        val songsBody = fetch(buildSongsRequest(fallback.id, page))
        val songs = parseSongs(songsBody) ?: error("kw artist songs failed")
        val albumsBody = fetch(buildAlbumsRequest(fallback.id, page))
        val albums = parseAlbums(albumsBody) ?: error("kw artist albums failed")
        return ArtistDetail(info = fallback, songs = songs, albums = albums)
    }

    companion object {
        const val DEFAULT_LIMIT = ArtistSearchAggregator.SOURCE_LIMIT
        private const val MAX_ATTEMPTS = 3
        private const val PIC_PREFIX = "http://img1.kwcdn.kuwo.cn/star/albumcover/500/"
        private const val ARTIST_PIC_PREFIX = "http://img1.kuwo.cn/star/starheads/"

        fun buildSearchRequest(
            keyword: String,
            page: Int,
            limit: Int,
        ): SearchRequest =
            SearchRequest(
                url =
                    "http://search.kuwo.cn/r.s?client=kt&all=${SonglistSearchSupport.encode(keyword)}" +
                        "&pn=${page - 1}&rn=$limit&uid=794762570&ver=kwplayer_ar_9.2.2.1&vipver=1" +
                        "&show_copyright_off=1&newver=1&ft=artist&cluster=0&strategy=2012" +
                        "&encoding=utf8&rformat=json&vermerge=1&mobi=1&issubtitle=1",
            )

        fun buildSongsRequest(
            id: String,
            page: Int,
        ): SearchRequest =
            SearchRequest(
                url =
                    "http://search.kuwo.cn/r.s?pn=${page - 1}&rn=${SONGS_LIMIT}&stype=artist" +
                        "&artistid=$id&show_copyright_off=0&encoding=utf&vipver=MUSIC_9.1.0",
            )

        fun buildAlbumsRequest(
            id: String,
            page: Int,
        ): SearchRequest =
            SearchRequest(
                url =
                    "http://search.kuwo.cn/r.s?pn=${page - 1}&rn=${ALBUMS_LIMIT}&stype=albumlist" +
                        "&artistid=$id&show_copyright_off=0&encoding=utf&vipver=MUSIC_9.1.0",
            )

        /** 热歌一页拉 100（RN 无参照；与专辑详情的「一次装完」策略一致）。 */
        const val SONGS_LIMIT = 100

        /** 专辑一页拉 100。 */
        const val ALBUMS_LIMIT = 100

        fun parseSearch(
            body: String,
            page: Int,
            limit: Int,
        ): ArtistSearchPage? {
            val root = SearchDetailSupport.kwRsRoot(body) ?: return null
            if (root["SHOW"].text() == "0") return null
            val total = root["TOTAL"].text().toIntOrNull() ?: 0
            val list =
                root["abslist"].asArray().mapNotNull { element ->
                    val item = element as? JsonObject ?: return@mapNotNull null
                    toArtistItem(item)
                }
            return ArtistSearchPage(
                list = list,
                total = total,
                allPage = if (total == 0) 0 else (total + limit - 1) / limit,
                limit = limit,
                source = "kw",
            )
        }

        private fun toArtistItem(item: JsonObject): ArtistItem? {
            val id = item.text("ARTISTID")
            if (id.isEmpty()) return null
            val picPath = item.text("hts_PICPATH").ifEmpty { item.text("PICPATH") }
            return ArtistItem(
                id = id,
                name = SonglistSearchSupport.decodeName(item.text("ARTIST")),
                picUrl =
                    when {
                        picPath.startsWith("http") -> picPath
                        picPath.isEmpty() -> null
                        else -> ARTIST_PIC_PREFIX + picPath
                    },
                alias = SonglistSearchSupport.decodeName(item.text("AARTIST")),
                albumCount = item.text("ALBUMNUM").toIntOrNull() ?: 0,
                musicCount = item.text("SONGNUM").toIntOrNull() ?: 0,
                source = "kw",
            )
        }

        fun parseSongs(body: String): List<JsonObject>? {
            val root = SearchDetailSupport.kwRsRoot(body) ?: return null
            val raw = root["abslist"] as? kotlinx.serialization.json.JsonArray ?: return null
            return raw.mapNotNull { (it as? JsonObject)?.let(::toMusicInfo) }
        }

        /** 与 [cn.toside.music.core.music.search.album.KwAlbumSearch] 详情曲目同构（FORMATS 音质表）。 */
        private fun toMusicInfo(item: JsonObject): JsonObject? {
            val musicId = item.text("MUSICRID").removePrefix("MUSIC_")
            if (musicId.isEmpty()) return null
            val name = SonglistSearchSupport.decodeName(item.text("SONGNAME").ifEmpty { item.text("NAME") })
            if (name.isEmpty()) return null
            val singer = SonglistSearchSupport.decodeName(item.text("ARTIST")).replace('&', '、')
            val picPath = item.text("web_albumpic_short")
            val types = SearchDetailSupport.kwFormatsToQualities(item.text("FORMATS"))
            return buildJsonObject {
                put("id", "kw_$musicId")
                put("name", name)
                put("singer", singer)
                put("source", "kw")
                put(
                    "interval",
                    item.text("DURATION").toIntOrNull()?.let { seconds ->
                        if (seconds == 0) {
                            "--/--"
                        } else {
                            String.format(java.util.Locale.US, "%02d:%02d", seconds / 60, seconds % 60)
                        }
                    } ?: "--/--",
                )
                put(
                    "meta",
                    buildJsonObject {
                        put("songId", musicId)
                        put("albumName", SonglistSearchSupport.decodeName(item.text("ALBUM")))
                        put("albumId", SonglistSearchSupport.decodeName(item.text("ALBUMID")))
                        put(
                            "picUrl",
                            if (picPath.isEmpty()) {
                                JsonNull
                            } else {
                                JsonPrimitive(PIC_PREFIX + picPath.split('/').drop(1).joinToString("/"))
                            },
                        )
                        put(
                            "qualitys",
                            buildJsonArray {
                                types.forEach { (type, size) ->
                                    add(
                                        buildJsonObject {
                                            put("type", type)
                                            put("size", size?.let { JsonPrimitive(it) } ?: JsonNull)
                                        },
                                    )
                                }
                            },
                        )
                    },
                )
            }
        }

        fun parseAlbums(body: String): List<AlbumItem>? {
            val root = SearchDetailSupport.kwRsRoot(body) ?: return null
            val raw = root["albumlist"] as? kotlinx.serialization.json.JsonArray ?: return null
            return raw.mapNotNull { element ->
                val item = element as? JsonObject ?: return@mapNotNull null
                val id = item.text("albumid")
                if (id.isEmpty()) return@mapNotNull null
                AlbumItem(
                    id = id,
                    name = SonglistSearchSupport.decodeName(item.text("name")),
                    singer = SonglistSearchSupport.decodeName(item.text("artist")),
                    picUrl = SonglistSearchSupport.nullableText(item.text("img").ifEmpty { item.text("hts_img") }),
                    publishTime = SonglistSearchSupport.nullableText(item.text("pub")),
                    songCount = item.text("musiccnt").toIntOrNull() ?: 0,
                    source = "kw",
                )
            }
        }

        private fun JsonObject.text(key: String): String = this[key].text()
    }
}
