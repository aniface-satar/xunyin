package cn.toside.music.core.songlist

import cn.toside.music.core.music.MusicInfoTools
import cn.toside.music.core.music.search.KwSearch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

/**
 * 咪咕歌单 —— 对照 RN `musicSdk/mg/songList.js` + `musicInfo.js#filterMusicInfoListV5`。
 *
 * 标签/列表：`pc/v1.0/template/...` 系列（iPhone UA + m.music.migu.cn referer）；
 * 列表解析保留 RN 的两套分支：新版 `data.contents` 递归（resType 2021）与旧版
 * `data.contentItemList[1].itemList`；
 * 详情：歌曲分页（pageSize=30）+ 歌单信息两条请求，歌曲映射按 V5 音质表
 * （PQ/HQ/SQ/ZQ → 128k/320k/flac/flac24bit）。
 */
class MgSonglist(
    private val fetch: suspend (SonglistRequest) -> String,
) : SonglistSource {
    override val source: String = "mg"

    override val sorts: List<SonglistSort> =
        listOf(SonglistSort(id = "15127315", name = "推荐", tid = "recommend"))

    override suspend fun getTags(): SonglistTags {
        var attempt = 0
        while (true) {
            attempt++
            val parsed = runCatching { parseTags(fetch(SonglistRequest(TAGS_URL, headers = HEADERS))) }.getOrNull()
            if (parsed != null) return parsed
            check(attempt < MAX_ATTEMPTS) { "mg songlist tags failed after $attempt attempts" }
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
                    val body = fetch(SonglistRequest(listUrl(tagId, page), headers = HEADERS))
                    parseList(body, page)
                }.getOrNull()
            if (parsed != null) return parsed
            check(attempt < MAX_ATTEMPTS) { "mg songlist list failed after $attempt attempts" }
        }
    }

    override suspend fun getDetail(
        id: String,
        page: Int,
    ): SonglistDetail {
        var attempt = 0
        while (true) {
            attempt++
            val parsed = runCatching { loadDetail(id, page) }.getOrNull()
            if (parsed != null) return parsed
            check(attempt < MAX_ATTEMPTS) { "mg songlist detail failed after $attempt attempts" }
        }
    }

    private suspend fun loadDetail(
        id: String,
        page: Int,
    ): SonglistDetail {
        val listBody = fetch(SonglistRequest(detailListUrl(id, page), headers = HEADERS))
        val root = parseObject(listBody)
        check(root["code"].text() == SUCCESS_CODE) { "mg detail code != 000000" }
        val data = root["data"] as? JsonObject ?: error("mg detail data missing")
        val list = filterMusicInfoListV5(data["songList"].asArray())
        val info = fetchDetailInfo(id)
        return SonglistDetail(
            list = list,
            total = data["totalCount"].asInt() ?: list.size,
            limit = LIMIT_SONG,
            page = page,
            source = "mg",
            info = info,
        )
    }

    private suspend fun fetchDetailInfo(id: String): SonglistInfo? {
        val body = fetch(SonglistRequest(detailInfoUrl(id), headers = HEADERS))
        val root = parseObject(body)
        if (root["code"].text() != SUCCESS_CODE) return null
        val data = root["data"] as? JsonObject ?: return null
        val img = (data["imgItem"] as? JsonObject)?.text("img")
        val opNum = data["opNumItem"] as? JsonObject
        return SonglistInfo(
            name = data.text("title"),
            img = img,
            desc = data.text("summary"),
            author = data.text("ownerName"),
            playCount = SonglistUtils.formatPlayCount(opNum?.get("playNum").asLong() ?: 0L),
        )
    }

    companion object {
        private const val MAX_ATTEMPTS = 3
        private const val LIMIT_LIST = 30
        private const val LIMIT_SONG = 30
        private const val SUCCESS_CODE = "000000"
        private const val TAGS_URL =
            "https://app.c.nf.migu.cn/pc/v1.0/template/musiclistplaza-taglist/release"
        private val HEADERS: Map<String, String> =
            mapOf(
                "User-Agent" to
                    "Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) " +
                    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1",
                "Referer" to "https://m.music.migu.cn/",
            )

        fun listUrl(
            tagId: String?,
            page: Int,
        ): String {
            if (tagId.isNullOrEmpty()) {
                return "https://app.c.nf.migu.cn/pc/bmw/page-data/playlist-square-recommend/v1.0" +
                    "?templateVersion=2&pageNo=$page"
            }
            return "https://app.c.nf.migu.cn/pc/v1.0/template/musiclistplaza-listbytag/release" +
                "?pageNumber=$page&templateVersion=2&tagId=$tagId"
        }

        fun detailListUrl(
            id: String,
            page: Int,
        ): String =
            "https://app.c.nf.migu.cn/MIGUM3.0/resource/playlist/song/v2.0" +
                "?pageNo=$page&pageSize=$LIMIT_SONG&playlistId=$id"

        fun detailInfoUrl(id: String): String = "https://c.musicapp.migu.cn/MIGUM3.0/resource/playlist/v2.0?playlistId=$id"

        fun parseTags(body: String): SonglistTags? {
            val root = parseObject(body)
            if (root["code"].text() != SUCCESS_CODE) return null
            val raw = root["data"].asArray()
            if (raw.isEmpty()) return null
            val hotTags =
                (raw.firstOrNull() as? JsonObject)?.get("content").asArray().mapNotNull { item ->
                    val texts = (item as? JsonObject)?.get("texts").asArray()
                    if (texts.size < 2) return@mapNotNull null
                    SonglistTag(id = texts[1].text(), name = texts[0].text())
                }
            val groups =
                raw.drop(1).mapNotNull { groupElement ->
                    val group = groupElement as? JsonObject ?: return@mapNotNull null
                    val title = (group["header"] as? JsonObject)?.text("title").orEmpty()
                    val list =
                        group["content"].asArray().mapNotNull { item ->
                            val texts = (item as? JsonObject)?.get("texts").asArray()
                            if (texts.size < 2) return@mapNotNull null
                            SonglistTag(id = texts[1].text(), name = texts[0].text())
                        }
                    SonglistTagGroup(name = title, list = list)
                }
            return SonglistTags(tags = groups, hotTags = hotTags, source = "mg")
        }

        fun parseList(
            body: String,
            page: Int,
        ): SonglistPage? {
            val root = parseObject(body)
            if (root["code"].text() != SUCCESS_CODE) return null
            val data = root["data"] as? JsonObject ?: return null
            val contents = data["contents"] as? JsonArray
            val list =
                if (contents != null) {
                    filterList2(contents)
                } else {
                    val itemList =
                        (
                            (data["contentItemList"].asArray().getOrNull(1) as? JsonObject)
                                ?.get("itemList")
                        ).asArray()
                    itemList.mapNotNull { (it as? JsonObject)?.let(::filterLegacyItem) }
                }
            return SonglistPage(
                list = list,
                total = 99999,
                limit = LIMIT_LIST,
                page = page,
                source = "mg",
            )
        }

        /** RN `filterList2`：递归 `contents`，只收 `resType == 2021` 的歌单节点并按 resId 去重。 */
        private fun filterList2(
            listData: JsonArray,
            list: MutableList<PlaylistItem> = mutableListOf(),
            ids: MutableSet<String> = mutableSetOf(),
        ): List<PlaylistItem> {
            listData.forEach { element ->
                val item = element as? JsonObject ?: return@forEach
                val contents = item["contents"] as? JsonArray
                if (contents != null) {
                    filterList2(contents, list, ids)
                } else if (item.text("resType") == "2021" && ids.add(item.text("resId"))) {
                    list.add(
                        PlaylistItem(
                            id = item.text("resId"),
                            name = item.text("txt"),
                            img = item.text("img").ifEmpty { null },
                            desc = item.text("txt2"),
                            source = "mg",
                        ),
                    )
                }
            }
            return list
        }

        /** RN `filterList`（旧版 contentItemList 分支）。 */
        private fun filterLegacyItem(item: JsonObject): PlaylistItem {
            val bar = item["barList"].asArray().firstOrNull() as? JsonObject
            val logEvent = item["logEvent"] as? JsonObject
            return PlaylistItem(
                id = logEvent?.text("contentId").orEmpty(),
                name = item.text("title"),
                img = item.text("imageUrl").ifEmpty { null },
                playCount = bar?.text("title").orEmpty(),
                source = "mg",
            )
        }

        /** RN `filterMusicInfoListV5` → `toNewMusicInfo`。 */
        fun filterMusicInfoListV5(raw: JsonArray): List<JsonObject> {
            val ids = mutableSetOf<String>()
            val list = mutableListOf<JsonObject>()
            raw.forEach { element ->
                val item = element as? JsonObject ?: return@forEach
                val songId = item.text("songId")
                if (songId.isEmpty() || !ids.add(songId)) return@forEach
                val qualities =
                    item["audioFormats"].asArray().mapNotNull { formatElement ->
                        val format = formatElement as? JsonObject ?: return@mapNotNull null
                        val type =
                            when (format.text("formatType")) {
                                "PQ" -> "128k"
                                "HQ" -> "320k"
                                "SQ" -> "flac"
                                "ZQ" -> "flac24bit"
                                else -> return@mapNotNull null
                            }
                        val size =
                            format["size"].asLong() ?: format["androidSize"].asLong() ?: 0L
                        type to size
                    }
                val singers =
                    item["singerList"]
                        .asArray()
                        .mapNotNull { (it as? JsonObject)?.text("name")?.ifEmpty { null } }
                        .joinToString("、")
                val img =
                    listOf("img3", "img2", "img1")
                        .firstOrNull { item.text(it).isNotEmpty() }
                        ?.let { item.text(it) }
                val old =
                    buildJsonObject {
                        put("singer", KwSearch.decodeEntities(singers))
                        put("name", item.text("songName"))
                        put("albumName", item.text("album"))
                        put("albumId", item["albumId"] ?: JsonNull)
                        put("songmid", songId)
                        put("copyrightId", item.text("copyrightId"))
                        put("source", "mg")
                        put("interval", SonglistUtils.formatPlayTime(item["duration"].asLong() ?: 0L))
                        put("img", img?.let { kotlinx.serialization.json.JsonPrimitive(it) } ?: JsonNull)
                        item["lrcUrl"]?.let { put("lrcUrl", it) }
                        item["mrcUrl"]?.let { put("mrcUrl", it) }
                        item["trcUrl"]?.let { put("trcUrl", it) }
                        put(
                            "types",
                            buildJsonArray {
                                qualities.forEach { (type, size) ->
                                    add(
                                        buildJsonObject {
                                            put("type", type)
                                            put("size", SonglistUtils.formatSize(size))
                                        },
                                    )
                                }
                            },
                        )
                        put(
                            "_types",
                            buildJsonObject {
                                qualities.forEach { (type, size) ->
                                    put(type, buildJsonObject { put("size", SonglistUtils.formatSize(size)) })
                                }
                            },
                        )
                    }
                MusicInfoTools.toNewMusicInfo(old)?.let(list::add)
            }
            return list
        }

        fun parseObject(body: String): JsonObject =
            runCatching { SonglistUtils.json.parseToJsonElement(body).jsonObject }.getOrNull()
                ?: JsonObject(emptyMap())

        private fun JsonObject.text(key: String): String = this[key].text()
    }
}
