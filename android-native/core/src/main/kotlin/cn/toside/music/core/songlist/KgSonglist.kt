package cn.toside.music.core.songlist

import cn.toside.music.core.music.MusicInfoTools
import cn.toside.music.core.music.search.KwSearch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

/**
 * 酷狗歌单 —— 对照 RN `musicSdk/kg/songList.js`。
 *
 * 标签/列表：`www2.kugou.kugou.com/yueku/v9/special/getSpecial`；
 * 列表首屏（无标签、推荐排序）额外并入 `guess_special_recommend` 推荐位；
 * 详情：抓 `special/single/<id>-5-9999.html` 的 `global.data`，再把 hash 批量送
 * `gateway.kugou.com/v2/album_audio/audio` 换取完整歌曲信息（RN getMusicInfos）。
 *
 * 只支持 `id_<specialid>` 形式（列表项自身返回的形状）；数字 id / 分享链 / 用户歌单
 * 需要 infSign 或额外签名，RN 也走另外的复杂分支，本波不接入（见 lane 报告遗留）。
 */
class KgSonglist(
    private val fetch: suspend (SonglistRequest) -> String,
    private val clock: () -> Long = System::currentTimeMillis,
) : SonglistSource {
    override val source: String = "kg"

    override val sorts: List<SonglistSort> =
        listOf(
            SonglistSort(id = "5", name = "推荐", tid = "recommend"),
            SonglistSort(id = "6", name = "最热", tid = "hot"),
            SonglistSort(id = "7", name = "最新", tid = "new"),
            SonglistSort(id = "3", name = "热藏", tid = "hot_collect"),
            SonglistSort(id = "8", name = "飙升", tid = "rise"),
        )

    override suspend fun getTags(): SonglistTags {
        var attempt = 0
        while (true) {
            attempt++
            val parsed = runCatching { parseTags(fetch(SonglistRequest(TAGS_URL))) }.getOrNull()
            if (parsed != null) return parsed
            check(attempt < MAX_ATTEMPTS) { "kg songlist tags failed after $attempt attempts" }
        }
    }

    override suspend fun getList(
        sortId: String,
        tagId: String?,
        page: Int,
    ): SonglistPage {
        val songs = getSongList(sortId, tagId, page)
        val info = getListInfo(tagId)
        val recommend =
            if (tagId.isNullOrEmpty() && page == 1 && sortId == sorts.first().id) {
                getSongListRecommend()
            } else {
                emptyList()
            }
        return SonglistPage(
            list = recommend + songs,
            total = info.total,
            limit = info.limit,
            page = info.page ?: page,
            source = "kg",
        )
    }

    override suspend fun getDetail(
        id: String,
        page: Int,
    ): SonglistDetail {
        val specialId = normalizeId(id)
        var attempt = 0
        while (true) {
            attempt++
            val parsed =
                runCatching {
                    val html = fetch(SonglistRequest(htmlUrl(specialId)))
                    val raw = parseHtml(html) ?: error("kg global.data missing")
                    val list = getMusicInfos(raw.rows)
                    SonglistDetail(
                        list = list,
                        // RN `total: list.length`：网关缺 audio_info 的条目会被丢弃
                        total = list.size,
                        limit = LIMIT_SONG,
                        page = 1,
                        source = "kg",
                        info = raw.info,
                    )
                }.getOrNull()
            if (parsed != null) return parsed
            check(attempt < MAX_ATTEMPTS) { "kg songlist detail failed after $attempt attempts" }
        }
    }

    private suspend fun getSongList(
        sortId: String,
        tagId: String?,
        page: Int,
    ): List<PlaylistItem> {
        var attempt = 0
        while (true) {
            attempt++
            val parsed =
                runCatching {
                    val body =
                        fetch(
                            SonglistRequest(
                                "http://www2.kugou.kugou.com/yueku/v9/special/getSpecial" +
                                    "?is_ajax=1&cdn=cdn&t=$sortId&c=${tagId.orEmpty()}&p=$page",
                            ),
                        )
                    parseList(body) ?: error("kg list status != 1")
                }.getOrNull()
            if (parsed != null) return parsed
            check(attempt < MAX_ATTEMPTS) { "kg songlist list failed after $attempt attempts" }
        }
    }

    private suspend fun getListInfo(tagId: String?): ListInfo {
        val url =
            if (tagId.isNullOrEmpty()) {
                TAGS_URL
            } else {
                "http://www2.kugou.kugou.com/yueku/v9/special/getSpecial?is_smarty=1&cdn=cdn&t=5&c=$tagId"
            }
        var attempt = 0
        while (true) {
            attempt++
            val parsed = runCatching { parseListInfo(fetch(SonglistRequest(url))) }.getOrNull()
            if (parsed != null) return parsed
            check(attempt < MAX_ATTEMPTS) { "kg list info failed after $attempt attempts" }
        }
    }

    private suspend fun getSongListRecommend(): List<PlaylistItem> {
        var attempt = 0
        while (true) {
            attempt++
            val parsed =
                runCatching {
                    val body =
                        buildJsonObject {
                            put("appid", 1001)
                            put("clienttime", clock())
                            put("clientver", 8275)
                            put("key", "f1f93580115bb106680d2375f8032d96")
                            put("mid", "21511157a05844bd085308bc76ef3343")
                            put("platform", "pc")
                            put("userid", "262643156")
                            put("return_min", 6)
                            put("return_max", 15)
                        }.toString()
                    parseRecommend(
                        fetch(
                            SonglistRequest(
                                url = RECOMMEND_URL,
                                method = "POST",
                                headers =
                                    mapOf(
                                        "User-Agent" to "KuGou2012-8275-web_browser_event_handler",
                                        "Content-Type" to "application/json",
                                    ),
                                body = body,
                            ),
                        ),
                    ) ?: error("kg recommend status != 1")
                }.getOrNull()
            if (parsed != null) return parsed
            check(attempt < MAX_ATTEMPTS) { "kg recommend failed after $attempt attempts" }
        }
    }

    /** RN `getMusicInfos`：按 hash 分批（100/批）换详情，再按 langIndex 回填语种。 */
    private suspend fun getMusicInfos(rows: List<JsonObject>): List<JsonObject> {
        val langIndex = HashMap<String, String>()
        rows.forEach { item ->
            val lang = (item["trans_param"] as? JsonObject)?.text("language").orEmpty()
            if (lang.isEmpty()) return@forEach
            val hash = item.text("hash")
            if (hash.isNotEmpty()) langIndex[hash.uppercase()] = lang
            val audioId = item["audio_id"] ?: item["songid"] ?: item["SongID"]
            val id = audioId?.text().orEmpty()
            if (id.isNotEmpty()) langIndex["a$id"] = lang
        }
        val hashes = deduplicateHashes(rows)
        val batches = hashes.chunked(100)
        val results = mutableListOf<JsonObject>()
        batches.forEach { batch -> fetchGateway(batch).forEach { results.add(it) } }
        return filterData2(results, langIndex)
    }

    private suspend fun fetchGateway(hashes: List<String>): List<JsonObject> {
        var attempt = 0
        while (true) {
            attempt++
            val parsed =
                runCatching {
                    val body =
                        buildJsonObject {
                            put(
                                "data",
                                buildJsonArray {
                                    hashes.forEach { hash ->
                                        add(buildJsonObject { put("hash", hash) })
                                    }
                                },
                            )
                            put("area_code", "1")
                            put("show_privilege", 1)
                            put("show_album_info", "1")
                            put("is_publish", "")
                            put("appid", 1005)
                            put("clientver", 11451)
                            put("mid", "1")
                            put("dfid", "-")
                            put("clienttime", clock())
                            put("key", "OIlwieks28dk2k092lksi2UIkp")
                            put("fields", "album_info,author_name,audio_info,ori_audio_name,base,songname")
                        }.toString()
                    parseGateway(
                        fetch(
                            SonglistRequest(
                                url = GATEWAY_URL,
                                method = "POST",
                                headers = GATEWAY_HEADERS,
                                body = body,
                            ),
                        ),
                    ) ?: error("kg gateway failed")
                }.getOrNull()
            if (parsed != null) return parsed
            check(attempt < MAX_ATTEMPTS) { "kg gateway failed after $attempt attempts" }
        }
    }

    data class RawDetail(
        val rows: List<JsonObject>,
        val info: SonglistInfo,
    )

    data class ListInfo(
        val limit: Int,
        val page: Int?,
        val total: Int,
        val source: String = "kg",
    )

    companion object {
        private const val MAX_ATTEMPTS = 3
        private const val LIMIT_SONG = 10000
        private const val TAGS_URL =
            "http://www2.kugou.kugou.com/yueku/v9/special/getSpecial?is_smarty=1&"
        private const val RECOMMEND_URL = "http://everydayrec.service.kugou.com/guess_special_recommend"
        private const val GATEWAY_URL = "http://gateway.kugou.com/v2/album_audio/audio"
        private val GATEWAY_HEADERS: Map<String, String> =
            mapOf(
                "KG-THash" to "13a3164",
                "KG-RC" to "1",
                "KG-Fake" to "0",
                "KG-RF" to "00869891",
                "User-Agent" to "Android712-AndroidPhone-11451-376-0-FeeCacheUpdate-wifi",
                "x-router" to "kmr.service.kugou.com",
                "Content-Type" to "application/json",
            )
        private val LIST_DATA = Regex("""global\.data = (\[.+\]);""")

        // Java 正则里裸 `{` 会被当成量词报 Illegal repetition（JS 无此限制），需转义。
        private val LIST_INFO =
            Regex("""global = \{[\s\S]+?name: "(.+)"[\s\S]+?pic: "(.+)"[\s\S]+?\};""")
        private const val DESC_PREFIX =
            "<div class=\"pc_specail_text pc_singer_tab_content\" id=\"specailIntroduceWrap\">"

        fun htmlUrl(id: String): String = "http://www2.kugou.kugou.com/yueku/v9/special/single/$id-5-9999.html"

        /** 列表项 id 形如 `id_123`；特殊页 `.../single/123.html` 可直接取 id。 */
        fun normalizeId(rawId: String): String {
            if (rawId.startsWith("id_")) {
                val id = rawId.removePrefix("id_")
                check(id.matches(Regex("""\d+"""))) { "kg list id not supported: $rawId" }
                return id
            }
            if (rawId.contains("special/single/")) {
                val id = rawId.replace(Regex(""".*/(\d+)\.html(?:\?.*|&.*$|#.*$|$)"""), "$1")
                check(id.matches(Regex("""\d+"""))) { "kg list id not supported: $rawId" }
                return id
            }
            // 纯数字（酷狗码）与用户歌单链接 RN 走另外的接口，本波不接入
            error("kg list id not supported: $rawId")
        }

        fun parseTags(body: String): SonglistTags? {
            val root = parseObject(body) ?: return null
            if (root["status"].asInt() != 1) return null
            val data = root["data"] as? JsonObject ?: return null
            // RN filterInfoHotTag：读 hotTag.data 下的数字键；hotTag.status != 1 视为空
            val hotRoot = data["hotTag"] as? JsonObject
            val hotTags =
                if (hotRoot?.get("status").asInt() != 1) {
                    emptyList()
                } else {
                    hotRoot
                        ?.get("data")
                        ?.let { it as? JsonObject }
                        ?.values
                        ?.mapNotNull { hotElement ->
                            val hot = hotElement as? JsonObject ?: return@mapNotNull null
                            SonglistTag(id = hot.text("special_id"), name = hot.text("special_name"))
                        }.orEmpty()
                }
            val tagGroups =
                (data["tagids"] as? JsonObject)
                    ?.entries
                    ?.map { (name, groupElement) ->
                        val list =
                            ((groupElement as? JsonObject)?.get("data").asArray()).mapNotNull { itemElement ->
                                val item = itemElement as? JsonObject ?: return@mapNotNull null
                                SonglistTag(id = item.text("id"), name = item.text("name"))
                            }
                        SonglistTagGroup(name = name, list = list)
                    }.orEmpty()
            return SonglistTags(tags = tagGroups, hotTags = hotTags, source = "kg")
        }

        fun parseList(body: String): List<PlaylistItem>? {
            val root = parseObject(body) ?: return null
            if (root["status"].asInt() != 1) return null
            return filterList(root["special_db"].asArray())
        }

        fun parseRecommend(body: String): List<PlaylistItem>? {
            val root = parseObject(body) ?: return null
            if (root["status"].asInt() != 1) return null
            val data = root["data"] as? JsonObject ?: return null
            return filterList(data["special_list"].asArray())
        }

        fun parseListInfo(body: String): ListInfo? {
            val root = parseObject(body) ?: return null
            if (root["status"].asInt() != 1) return null
            val params = ((root["data"] as? JsonObject)?.get("params") as? JsonObject) ?: return null
            return ListInfo(
                limit = params["pagesize"].asInt() ?: 36,
                page = params["p"].asInt(),
                total = params["total"].asInt() ?: 0,
            )
        }

        private fun filterList(raw: JsonArray): List<PlaylistItem> =
            raw.mapNotNull { itemElement ->
                val item = itemElement as? JsonObject ?: return@mapNotNull null
                val totalPlayCount = item.text("total_play_count")
                val publishTime = item["publish_time"].asLong() ?: item["publishtime"].asLong() ?: 0L
                PlaylistItem(
                    id = "id_" + item.text("specialid"),
                    name = item.text("specialname"),
                    author = item.text("nickname"),
                    img = item.text("img").ifEmpty { item.text("imgurl") }.ifEmpty { null },
                    playCount =
                        totalPlayCount.ifEmpty {
                            SonglistUtils.formatPlayCount(item["play_count"].asLong() ?: 0L)
                        },
                    total = item["songcount"].asInt(),
                    desc = item.text("intro"),
                    time = SonglistUtils.formatDate(publishTime),
                    source = "kg",
                )
            }

        /** 解析详情 HTML：`global.data` 歌曲数组 + `global = {...}` 歌单信息。 */
        fun parseHtml(html: String): RawDetail? {
            val dataMatch = LIST_DATA.find(html) ?: return null
            val rows =
                runCatching { Json.parseToJsonElement(dataMatch.groupValues[1]) as? JsonArray }
                    .getOrNull()
                    ?.mapNotNull { it as? JsonObject }
                    ?: return null
            val infoMatch = LIST_INFO.find(html)
            val descStart = html.indexOf(DESC_PREFIX)
            val desc =
                if (descStart < 0) {
                    null
                } else {
                    val after = html.substring(descStart + DESC_PREFIX.length)
                    val end = after.indexOf("</div>")
                    if (end < 0) null else KwSearch.decodeEntities(after.substring(0, end))
                }
            return RawDetail(
                rows = rows,
                info =
                    SonglistInfo(
                        name = infoMatch?.groupValues?.get(1),
                        img = infoMatch?.groupValues?.get(2),
                        desc = desc,
                    ),
            )
        }

        fun parseGateway(body: String): List<JsonObject>? {
            val root = parseObject(body) ?: return null
            val errorCode = gatewayErrorCode(root)
            if (errorCode != null && errorCode != 0) return null
            val data = root["data"] as? JsonArray ?: return null
            return data.mapNotNull { element ->
                when (element) {
                    is JsonArray -> element.firstOrNull() as? JsonObject
                    is JsonObject -> element
                    else -> null
                }
            }
        }

        private fun gatewayErrorCode(root: JsonObject): Int? =
            root["error_code"].asInt() ?: root["errcode"].asInt() ?: root["err_code"].asInt()

        /** RN `deDuplication`：按 hash 去重保序。 */
        fun deduplicateHashes(rows: List<JsonObject>): List<String> {
            val seen = mutableSetOf<String>()
            return rows.mapNotNull { it.text("hash").ifEmpty { null } }.filter { seen.add(it) }
        }

        /** RN `filterData2` → `toNewMusicInfo`。 */
        fun filterData2(
            raw: List<JsonObject>,
            langIndex: Map<String, String> = emptyMap(),
        ): List<JsonObject> {
            val ids = mutableSetOf<String>()
            val list = mutableListOf<JsonObject>()
            raw.forEach { item ->
                val audio = item["audio_info"] as? JsonObject ?: return@forEach
                val audioId = audio.text("audio_id")
                if (!ids.add(audioId)) return@forEach
                val albumInfo = item["album_info"] as? JsonObject
                val types = mutableListOf<Triple<String, String, String>>()
                if (audio.text("filesize") != "0") {
                    types.add(Triple("128k", audio.text("filesize"), audio.text("hash")))
                }
                if (audio.text("filesize_320") != "0") {
                    types.add(Triple("320k", audio.text("filesize_320"), audio.text("hash_320")))
                }
                if (audio.text("filesize_flac") != "0") {
                    types.add(Triple("flac", audio.text("filesize_flac"), audio.text("hash_flac")))
                }
                if (audio.text("filesize_high") != "0") {
                    types.add(Triple("flac24bit", audio.text("filesize_high"), audio.text("hash_high")))
                }
                val cover =
                    albumInfo?.text("sizable_cover").orEmpty().replace("{size}", "400")
                val songId = audio.text("audio_id")
                val old =
                    buildJsonObject {
                        put("singer", KwSearch.decodeEntities(item.text("author_name")))
                        put("name", KwSearch.decodeEntities(item.text("songname")))
                        put("albumName", KwSearch.decodeEntities(albumInfo?.text("album_name").orEmpty()))
                        put("albumId", albumInfo?.get("album_id") ?: JsonNull)
                        put("songmid", songId)
                        put("source", "kg")
                        val lang = langIndex[audio.text("hash").uppercase()] ?: langIndex["a$songId"]
                        if (lang != null) put("lang", lang)
                        put(
                            "interval",
                            SonglistUtils.formatPlayTime((audio["timelength"].asLong() ?: 0L) / 1000),
                        )
                        put("img", if (cover.isEmpty()) JsonNull else JsonPrimitive(cover))
                        put("hash", audio.text("hash"))
                        put(
                            "types",
                            buildJsonArray {
                                types.forEach { (type, size, hash) ->
                                    add(
                                        buildJsonObject {
                                            put("type", type)
                                            put("size", SonglistUtils.formatSize(size.toLongOrNull() ?: 0L))
                                            put("hash", hash)
                                        },
                                    )
                                }
                            },
                        )
                        put(
                            "_types",
                            buildJsonObject {
                                types.forEach { (type, size, hash) ->
                                    put(
                                        type,
                                        buildJsonObject {
                                            put("size", SonglistUtils.formatSize(size.toLongOrNull() ?: 0L))
                                            put("hash", hash)
                                        },
                                    )
                                }
                            },
                        )
                    }
                MusicInfoTools.toNewMusicInfo(old)?.let(list::add)
            }
            return list
        }

        private fun parseObject(body: String): JsonObject? =
            runCatching { SonglistUtils.json.parseToJsonElement(body).jsonObject }.getOrNull()

        private fun JsonObject.text(key: String): String = this[key].text()
    }
}
