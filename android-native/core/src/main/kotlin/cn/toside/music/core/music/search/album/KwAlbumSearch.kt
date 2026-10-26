package cn.toside.music.core.music.search.album

import cn.toside.music.core.music.search.SearchDetailSupport
import cn.toside.music.core.music.search.SearchRequest
import cn.toside.music.core.music.search.SonglistSearchSupport
import cn.toside.music.core.songlist.asArray
import cn.toside.music.core.songlist.text
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * 酷我专辑搜索 + 专辑详情。
 *
 * RN `kw/album.js` 只有 `getAlbumInfo` / `getAlbumListDetail`（**没有专辑搜索**，
 * 对照本仓库 RN 快照），详情语义逐字段对照 `filterListDetail`：
 * - 详情一次 `rn=1000`（RN `limit_song`），正常专辑一页装完，`total = songnum`；
 * - 音质表来自 `formats` 字段（MP3128/MP3H/ALFLAC/HIRFLAC → 128k/320k/flac/flac24bit）；
 * - 搜索接口为无 RN 参照的重构（响应形状由 2026-10-26 真实响应 fixture 钉住），
 *   响应无 `TOTAL`，用「整页 → 大概率还有下一页」启发式给 allPage（见 lane 报告）。
 */
class KwAlbumSearch(
    private val fetch: suspend (SearchRequest) -> String,
) {
    suspend fun search(
        keyword: String,
        page: Int = 1,
        limit: Int = DEFAULT_LIMIT,
    ): AlbumSearchPage {
        var attempt = 0
        while (true) {
            attempt++
            val parsed = parseSearch(fetch(buildSearchRequest(keyword, page, limit)), page, limit)
            if (parsed != null) return parsed
            check(attempt < MAX_ATTEMPTS) { "kw album search failed after $attempt attempts" }
        }
    }

    suspend fun detail(
        id: String,
        page: Int = 1,
    ): AlbumDetail {
        var attempt = 0
        while (true) {
            attempt++
            val parsed = parseDetail(fetch(buildDetailRequest(id, page)), page)
            if (parsed != null) return parsed
            check(attempt < MAX_ATTEMPTS) { "kw album detail failed after $attempt attempts" }
        }
    }

    companion object {
        const val DEFAULT_LIMIT = AlbumSearchAggregator.SOURCE_LIMIT

        /** RN `kw/album.js#limit_song`：详情一页拉 1000 首。 */
        const val DETAIL_LIMIT = 1000
        private const val MAX_ATTEMPTS = 3
        private const val PIC_PREFIX = "http://img1.kwcdn.kuwo.cn/star/albumcover/500/"

        fun buildSearchRequest(
            keyword: String,
            page: Int,
            limit: Int,
        ): SearchRequest =
            SearchRequest(
                url =
                    "http://search.kuwo.cn/r.s?client=kt&all=${SonglistSearchSupport.encode(keyword)}" +
                        "&pn=${page - 1}&rn=$limit&uid=794762570&ver=kwplayer_ar_9.2.2.1&vipver=1" +
                        "&show_copyright_off=1&newver=1&ft=album&cluster=0&strategy=2012" +
                        "&encoding=utf8&rformat=json&vermerge=1&mobi=1&issubtitle=1",
            )

        fun buildDetailRequest(
            id: String,
            page: Int,
        ): SearchRequest =
            SearchRequest(
                url =
                    "http://search.kuwo.cn/r.s?pn=${page - 1}&rn=$DETAIL_LIMIT&stype=albuminfo" +
                        "&albumid=$id&show_copyright_off=0&encoding=utf&vipver=MUSIC_9.1.0",
            )

        fun parseSearch(
            body: String,
            page: Int,
            limit: Int,
        ): AlbumSearchPage? {
            val root = SearchDetailSupport.kwRsRoot(body) ?: return null
            // SHOW=0 是服务端限流（对照 KwSearch 的重试语义）
            if (root["SHOW"].text() == "0") return null
            val list =
                root["albumlist"].asArray().mapNotNull { element ->
                    val item = element as? JsonObject ?: return@mapNotNull null
                    toAlbumItem(item)
                }
            // 无 TOTAL：整页结果视为可能还有下一页
            val allPage = if (list.size >= limit) page + 1 else page
            return AlbumSearchPage(list = list, total = 0, allPage = allPage, limit = limit, source = "kw")
        }

        private fun toAlbumItem(item: JsonObject): AlbumItem? {
            val id = item.text("albumid")
            if (id.isEmpty()) return null
            val pic = item.text("img").ifEmpty { item.text("hts_img") }
            return AlbumItem(
                id = id,
                name = SonglistSearchSupport.decodeName(item.text("name")),
                singer = SonglistSearchSupport.decodeName(item.text("artist")),
                picUrl = SonglistSearchSupport.nullableText(pic),
                publishTime = SonglistSearchSupport.nullableText(item.text("pub")),
                songCount = item.text("musiccnt").toIntOrNull() ?: 0,
                source = "kw",
            )
        }

        fun parseDetail(
            body: String,
            page: Int,
        ): AlbumDetail? {
            val root = SearchDetailSupport.kwRsRoot(body) ?: return null
            // RN：musiclist 缺失时重试
            val musiclist = root["musiclist"] as? kotlinx.serialization.json.JsonArray ?: return null
            val total = root.text("songnum").toIntOrNull() ?: 0
            val songs = musiclist.mapNotNull { (it as? JsonObject)?.let(::toMusicInfo) }
            val info =
                AlbumItem(
                    id = root.text("albumid").ifEmpty { "" },
                    name = SonglistSearchSupport.decodeName(root.text("name")),
                    singer = SonglistSearchSupport.decodeName(root.text("artist")),
                    picUrl = SonglistSearchSupport.nullableText(root.text("img").ifEmpty { root.text("hts_img") }),
                    publishTime = SonglistSearchSupport.nullableText(root.text("pub")),
                    songCount = total,
                    source = "kw",
                )
            return AlbumDetail(info = info, songs = songs, total = total, page = page, limit = DETAIL_LIMIT)
        }

        /** RN `filterListDetail` 的逐字段映射（曲目 id = kw_ + musicrid/id）。 */
        private fun toMusicInfo(item: JsonObject): JsonObject? {
            val musicId = item.text("musicrid").ifEmpty { item.text("id") }
            if (musicId.isEmpty()) return null
            val name = SonglistSearchSupport.decodeName(item.text("name").ifEmpty { item.text("songname") })
            if (name.isEmpty()) return null
            val singer = SonglistSearchSupport.decodeName(item.text("artist")).replace('&', '、')
            val picPath = item.text("web_albumpic_short")
            val types = SearchDetailSupport.kwFormatsToQualities(item.text("formats"))
            return buildJsonObject {
                put("id", "kw_$musicId")
                put("name", name)
                put("singer", singer)
                put("source", "kw")
                put("interval", formatInterval(item.text("duration").toIntOrNull() ?: 0))
                put(
                    "meta",
                    buildJsonObject {
                        put("songId", musicId)
                        put("albumName", SonglistSearchSupport.decodeName(item.text("album")))
                        put("albumId", SonglistSearchSupport.decodeName(item.text("albumId").ifEmpty { item.text("albumid") }))
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

        private fun formatInterval(sec: Int): String {
            val m = sec / 60
            val s = sec % 60
            return if (m == 0 && s == 0) "--/--" else String.format(java.util.Locale.US, "%02d:%02d", m, s)
        }

        private fun JsonObject.text(key: String): String = this[key].text()
    }
}
