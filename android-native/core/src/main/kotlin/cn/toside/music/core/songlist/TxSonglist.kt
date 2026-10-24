package cn.toside.music.core.songlist

import cn.toside.music.core.music.MusicInfoTools
import cn.toside.music.core.music.search.KwSearch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

/**
 * QQ 音乐歌单 —— 对照 RN `musicSdk/tx/songList.js`。
 *
 * 标签：`musicu.fcg` 的 `get_all_categories` + HTML 热门标签；
 * 列表：无标签 `get_playlist_by_tag`，有标签 `get_category_content`；
 * 详情：先 GET `fcg_ucc_getcdinfo_byids_cp`，`subcode != 0` 时回退 POST
 * `musicu.fcg` 的 `uniform_get_Dissinfo`（RN getListDetail2）。
 */
class TxSonglist(
    private val fetch: suspend (SonglistRequest) -> String,
) : SonglistSource {
    override val source: String = "tx"

    override val sorts: List<SonglistSort> =
        listOf(
            SonglistSort(id = "5", name = "最热", tid = "hot"),
            SonglistSort(id = "2", name = "最新", tid = "new"),
        )

    override suspend fun getTags(): SonglistTags {
        var attempt = 0
        while (true) {
            attempt++
            val parsed =
                runCatching {
                    val tagBody = fetch(SonglistRequest(TAGS_URL))
                    val hotBody = fetch(SonglistRequest(HOT_TAG_URL))
                    parseTags(tagBody, hotBody)
                }.getOrNull()
            if (parsed != null) return parsed
            check(attempt < MAX_ATTEMPTS) { "tx songlist tags failed after $attempt attempts" }
        }
    }

    override suspend fun getList(
        sortId: String,
        tagId: String?,
        page: Int,
    ): SonglistPage {
        var attempt = 0
        while (true) {
            attempt++
            val parsed =
                runCatching {
                    val body = fetch(SonglistRequest(listUrl(sortId, tagId, page)))
                    if (tagId.isNullOrEmpty()) parseList(body, page) else parseTaggedList(body, page)
                }.getOrNull()
            if (parsed != null) return parsed
            check(attempt < MAX_ATTEMPTS) { "tx songlist list failed after $attempt attempts" }
        }
    }

    override suspend fun getDetail(
        id: String,
        page: Int,
    ): SonglistDetail = getDetail(id, page, 0)

    private suspend fun getDetail(
        id: String,
        page: Int,
        attempt: Int,
    ): SonglistDetail {
        check(attempt < MAX_ATTEMPTS) { "tx songlist detail failed after $attempt attempts" }
        val listId = normalizeId(id)
        val body =
            fetch(
                SonglistRequest(
                    url = detailUrl(listId),
                    headers = detailHeaders(listId),
                ),
            )
        val parsed = parseDetail(body, page)
        if (parsed != null) return parsed
        val fallback =
            runCatching {
                fetch(detailRequest(listId)).let { parseFallbackDetail(it) }
            }.getOrNull()
        if (fallback != null) return fallback
        return getDetail(listId, page, attempt + 1)
    }

    companion object {
        private const val MAX_ATTEMPTS = 3
        private const val LIMIT_LIST = 36
        private const val LIMIT_SONG = 100000

        private const val TAGS_URL =
            "https://u.y.qq.com/cgi-bin/musicu.fcg?loginUin=0&hostUin=0&format=json" +
                "&inCharset=utf-8&outCharset=utf-8&notice=0&platform=wk_v15.json&needNewCode=0" +
                "&data=%7B%22tags%22%3A%7B%22method%22%3A%22get_all_categories%22%2C" +
                "%22param%22%3A%7B%22qq%22%3A%22%22%7D%2C%22module%22%3A" +
                "%22playlist.PlaylistAllCategoriesServer%22%7D%7D"
        private const val HOT_TAG_URL = "https://c.y.qq.com/node/pc/wk_v15/category_playlist.html"
        private const val DETAIL_UA =
            "Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; WOW64; Trident/5.0)"

        private val HOT_TAG_BLOCK =
            Regex("""class="c_bg_link js_tag_item" data-id="\w+">.+?</a>""")
        private val HOT_TAG = Regex("""data-id="(\w+)">(.+?)</a>""")
        private val LIST_DETAIL_LINK = Regex("""/playlist/(\d+)""")
        private val LIST_DETAIL_LINK2 = Regex("""id=(\d+)""")

        fun listUrl(
            sortId: String,
            tagId: String?,
            page: Int,
        ): String {
            val data =
                if (!tagId.isNullOrEmpty()) {
                    buildJsonObject {
                        put(
                            "comm",
                            buildJsonObject {
                                put("cv", 1602)
                                put("ct", 20)
                            },
                        )
                        put(
                            "playlist",
                            buildJsonObject {
                                put("method", "get_category_content")
                                put(
                                    "param",
                                    buildJsonObject {
                                        put("titleid", tagId.toIntOrNull() ?: 0)
                                        put("caller", "0")
                                        put("category_id", tagId.toIntOrNull() ?: 0)
                                        put("size", LIMIT_LIST)
                                        put("page", page - 1)
                                        put("use_page", 1)
                                    },
                                )
                                put("module", "playlist.PlayListCategoryServer")
                            },
                        )
                    }.toString()
                } else {
                    buildJsonObject {
                        put(
                            "comm",
                            buildJsonObject {
                                put("cv", 1602)
                                put("ct", 20)
                            },
                        )
                        put(
                            "playlist",
                            buildJsonObject {
                                put("method", "get_playlist_by_tag")
                                put(
                                    "param",
                                    buildJsonObject {
                                        put("id", 10000000)
                                        put("sin", LIMIT_LIST * (page - 1))
                                        put("size", LIMIT_LIST)
                                        put("order", sortId)
                                        put("cur_page", page)
                                    },
                                )
                                put("module", "playlist.PlayListPlazaServer")
                            },
                        )
                    }.toString()
                }
            return "https://u.y.qq.com/cgi-bin/musicu.fcg?loginUin=0&hostUin=0&format=json" +
                "&inCharset=utf-8&outCharset=utf-8&notice=0&platform=wk_v15.json&needNewCode=0" +
                "&data=${encodeURIComponent(data)}"
        }

        fun detailUrl(id: String): String =
            "https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg" +
                "?type=1&json=1&utf8=1&onlysong=0&new_format=1&disstid=$id" +
                "&loginUin=0&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8" +
                "&notice=0&platform=yqq.json&needNewCode=0"

        fun detailHeaders(id: String): Map<String, String> =
            mapOf(
                "Origin" to "https://y.qq.com",
                "Referer" to "https://y.qq.com/n/yqq/playsquare/$id.html",
            )

        fun detailRequest(id: String): SonglistRequest {
            val body =
                buildJsonObject {
                    put(
                        "comm",
                        buildJsonObject {
                            put("cv", 4747474)
                            put("ct", 24)
                            put("format", "json")
                            put("inCharset", "utf-8")
                            put("outCharset", "utf-8")
                            put("platform", "yqq.json")
                            put("needNewCode", 1)
                            put("uin", 0)
                        },
                    )
                    put(
                        "req_1",
                        buildJsonObject {
                            put("module", "music.srfDissInfo.aiDissInfo")
                            put("method", "uniform_get_Dissinfo")
                            put(
                                "param",
                                buildJsonObject {
                                    put("disstid", id.toIntOrNull() ?: 0)
                                    put("userinfo", 1)
                                    put("tag", 1)
                                    put("orderlist", 1)
                                    put("song_begin", 0)
                                    put("song_num", LIMIT_SONG)
                                    put("onlysonglist", 0)
                                    put("enc_host_uin", "")
                                },
                            )
                        },
                    )
                }.toString()
            return SonglistRequest(
                url = "https://u.y.qq.com/cgi-bin/musicu.fcg",
                method = "POST",
                headers = detailHeaders(id) + ("Content-Type" to "application/json"),
                body = body,
            )
        }

        fun normalizeId(rawId: String): String {
            if (!rawId.contains(Regex("""[?&:/]"""))) return rawId
            LIST_DETAIL_LINK.find(rawId)?.let { return it.groupValues[1] }
            LIST_DETAIL_LINK2.find(rawId)?.let { return it.groupValues[1] }
            // RN handleParseId 会先跟一次重定向再抽 id；本波不接跳转解析，直接失败
            error("tx list link not supported: $rawId")
        }

        fun parseTags(
            tagBody: String,
            hotBody: String,
        ): SonglistTags? {
            val root =
                runCatching { SonglistUtils.json.parseToJsonElement(tagBody).jsonObject }.getOrNull()
                    ?: return null
            if (root["code"].asInt() != 0) return null
            val groups =
                ((root["tags"] as? JsonObject)?.get("data") as? JsonObject)
                    ?.get("v_group")
                    .asArray()
                    ?: return null
            val tags =
                groups.mapNotNull { groupElement ->
                    val group = groupElement as? JsonObject ?: return@mapNotNull null
                    SonglistTagGroup(
                        name = group.text("group_name"),
                        list =
                            group["v_item"].asArray().mapNotNull { itemElement ->
                                val item = itemElement as? JsonObject ?: return@mapNotNull null
                                SonglistTag(id = item.text("id"), name = item.text("name"))
                            },
                    )
                }
            val hotTags = mutableListOf<SonglistTag>()
            HOT_TAG_BLOCK.findAll(hotBody).forEach { block ->
                val match = HOT_TAG.find(block.value) ?: return@forEach
                hotTags.add(SonglistTag(id = match.groupValues[1], name = match.groupValues[2]))
            }
            return SonglistTags(tags = tags, hotTags = hotTags, source = "tx")
        }

        fun parseList(
            body: String,
            page: Int,
        ): SonglistPage? {
            val root = parseRoot(body) ?: return null
            val data = (root["playlist"] as? JsonObject)?.get("data") as? JsonObject ?: return null
            val raw = data["v_playlist"].asArray()
            return SonglistPage(
                list = raw.mapNotNull { (it as? JsonObject)?.let(::toPlazaItem) },
                total = data["total"].asInt() ?: 0,
                limit = LIMIT_LIST,
                page = page,
                source = "tx",
            )
        }

        fun parseTaggedList(
            body: String,
            page: Int,
        ): SonglistPage? {
            val root = parseRoot(body) ?: return null
            val data = (root["playlist"] as? JsonObject)?.get("data") as? JsonObject ?: return null
            val content = data["content"] as? JsonObject ?: return null
            val raw = content["v_item"].asArray()
            return SonglistPage(
                list =
                    raw.mapNotNull {
                        val basic = (it as? JsonObject)?.get("basic") as? JsonObject ?: return@mapNotNull null
                        toCategoryItem(basic)
                    },
                total = content["total_cnt"].asInt() ?: 0,
                limit = LIMIT_LIST,
                page = page,
                source = "tx",
            )
        }

        fun parseDetail(
            body: String,
            page: Int,
        ): SonglistDetail? {
            val root = parseRoot(body) ?: return null
            if (root["subcode"].asInt() != 0) return null
            val cdlist = root["cdlist"].asArray().firstOrNull() as? JsonObject ?: return null
            val songs = cdlist["songlist"].asArray()
            val list = songs.mapNotNull { (it as? JsonObject)?.let(::toMusicInfo) }
            return SonglistDetail(
                list = list,
                total = songs.size,
                limit = songs.size + 1,
                page = page,
                source = "tx",
                info =
                    SonglistInfo(
                        name = cdlist.text("dissname"),
                        img = cdlist.text("logo"),
                        desc = decode(cdlist.text("desc")).replace("<br>", "\n"),
                        author = cdlist.text("nickname"),
                        playCount = SonglistUtils.formatPlayCount(cdlist["visitnum"].asLong() ?: 0L),
                    ),
            )
        }

        /** RN getListDetail2：`req_1.data` 落在 `dirinfo`/`songlist`/`total_song_num`。 */
        fun parseFallbackDetail(body: String): SonglistDetail? {
            val root = parseRoot(body) ?: return null
            if (root["code"].asInt() != 0) return null
            val req1 = root["req_1"] as? JsonObject ?: return null
            if (req1["code"].asInt() != 0) return null
            val result = req1["data"] as? JsonObject ?: return null
            val dirinfo = result["dirinfo"] as? JsonObject
            val songs = result["songlist"].asArray()
            val list = songs.mapNotNull { (it as? JsonObject)?.let(::toMusicInfo) }
            return SonglistDetail(
                list = list,
                total = result["total_song_num"].asInt() ?: songs.size,
                limit = LIMIT_SONG,
                page = 1,
                source = "tx",
                info =
                    SonglistInfo(
                        name = dirinfo?.text("title"),
                        img = dirinfo?.text("picurl"),
                        desc = decode(dirinfo?.text("desc").orEmpty()).replace("<br>", "\n"),
                        author = dirinfo?.text("host_nick"),
                        playCount =
                            SonglistUtils.formatPlayCount(dirinfo?.get("listennum").asLong() ?: 0L),
                    ),
            )
        }

        private fun parseRoot(body: String): JsonObject? =
            runCatching { SonglistUtils.json.parseToJsonElement(body).jsonObject }
                .getOrNull()
                ?.takeIf { it["code"].asInt() == 0 }

        private fun toPlazaItem(item: JsonObject): PlaylistItem {
            val creator = item["creator_info"] as? JsonObject
            return PlaylistItem(
                id = item.text("tid"),
                name = item.text("title"),
                author = creator?.text("nick").orEmpty(),
                img = item.text("cover_url_medium").ifEmpty { null },
                playCount = SonglistUtils.formatPlayCount(item["access_num"].asLong() ?: 0L),
                total = (item["song_ids"] as? kotlinx.serialization.json.JsonArray)?.size,
                desc = decode(item.text("desc")).replace("<br>", "\n"),
                time = SonglistUtils.formatDate((item["modify_time"].asLong() ?: 0L) * 1000),
                source = "tx",
            )
        }

        private fun toCategoryItem(basic: JsonObject): PlaylistItem {
            val creator = basic["creator"] as? JsonObject
            val cover = basic["cover"] as? JsonObject
            return PlaylistItem(
                id = basic.text("tid"),
                name = basic.text("title"),
                author = creator?.text("nick").orEmpty(),
                img = cover?.text("medium_url").orEmpty().ifEmpty { cover?.text("default_url") },
                playCount = SonglistUtils.formatPlayCount(basic["play_cnt"].asLong() ?: 0L),
                desc = decode(basic.text("desc")).replace("<br>", "\n"),
                source = "tx",
            )
        }

        /** RN `filterListDetail` → `toNewMusicInfo`。 */
        private fun toMusicInfo(item: JsonObject): JsonObject? {
            val file = item["file"] as? JsonObject ?: return null
            val album = item["album"] as? JsonObject ?: return null
            val singers =
                item["singer"]
                    .asArray()
                    .mapNotNull { (it as? JsonObject)?.text("name")?.ifEmpty { null } }
            val qualities =
                listOf(
                    "128k" to "size_128mp3",
                    "320k" to "size_320mp3",
                    "flac" to "size_flac",
                    "flac24bit" to "size_hires",
                ).mapNotNull { (type, key) ->
                    val size = file[key].asLong() ?: 0L
                    if (size == 0L) null else type to size
                }
            val songMid = item.text("mid")
            val albumMid = album.text("mid")
            val albumName = album.text("name")
            val picUrl =
                if (albumName.isEmpty() || albumName == "空") {
                    val singerMid =
                        (item["singer"].asArray().firstOrNull() as? JsonObject)?.text("mid")
                    if (singerMid.isNullOrEmpty()) "" else T001 + singerMid + ".jpg"
                } else {
                    T002 + albumMid + ".jpg"
                }
            val old =
                buildJsonObject {
                    put("singer", decode(singers.joinToString("、")))
                    put("name", item.text("title"))
                    put("albumName", albumName)
                    put("albumId", albumMid)
                    put("source", "tx")
                    item["language"]?.let { if (it !is JsonNull) put("lang", it) }
                    put("interval", SonglistUtils.formatPlayTime(item["interval"].asLong() ?: 0L))
                    put("songId", item["id"] ?: JsonNull)
                    put("albumMid", albumMid)
                    put("strMediaMid", file.text("media_mid"))
                    put("songmid", songMid)
                    put("img", picUrl)
                    put("types", qualityArray(qualities))
                    put("_types", qualityMap(qualities))
                }
            return MusicInfoTools.toNewMusicInfo(old)
        }

        private fun qualityArray(qualities: List<Pair<String, Long>>): kotlinx.serialization.json.JsonArray =
            buildJsonArray {
                qualities.forEach { (type, size) ->
                    add(
                        buildJsonObject {
                            put("type", type)
                            put("size", SonglistUtils.formatSize(size))
                        },
                    )
                }
            }

        private fun qualityMap(qualities: List<Pair<String, Long>>): JsonObject {
            val map = mutableMapOf<String, JsonElement>()
            qualities.forEach { (type, size) ->
                map[type] = buildJsonObject { put("size", SonglistUtils.formatSize(size)) }
            }
            return JsonObject(map)
        }

        private fun decode(value: String): String = KwSearch.decodeEntities(value)

        private fun encodeURIComponent(value: String): String =
            java.net.URLEncoder
                .encode(value, "UTF-8")
                .replace("+", "%20")

        private fun JsonObject.text(key: String): String = this[key].text()

        private const val T001 = "https://y.gtimg.cn/music/photo_new/T001R500x500M000"
        private const val T002 = "https://y.gtimg.cn/music/photo_new/T002R500x500M000"
    }
}
