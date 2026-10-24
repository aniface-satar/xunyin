package cn.toside.music.core.songlist

import cn.toside.music.core.music.MusicInfoTools
import cn.toside.music.core.music.search.KwSearch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import java.util.Locale

/**
 * 酷我歌单 —— 对照 RN `musicSdk/kw/songList.js`。
 *
 * 标签：`getTagList`（分类）+ `getRcmTagList`（热门），标签 id 形如 `<id>-<digest>`；
 * 列表：无标签走 `getRcmPlayList`，`<digest>=10000` 走 `getTagPlayList`，
 * `<digest>=43` 走 `mobileinterfaces/er.s`（分组 JSON 数组）；
 * 详情：`digest-5` 先 `qukudata` 查 sourceid 再取 `nplserver`，`digest-8` 直接取
 * `nplserver`；`digest-13` 属专辑模块（本包不接入，见 lane 报告遗留）。
 */
class KwSonglist(
    private val fetch: suspend (SonglistRequest) -> String,
) : SonglistSource {
    override val source: String = "kw"

    override val sorts: List<SonglistSort> =
        listOf(
            SonglistSort(id = "new", name = "最新", tid = "new"),
            SonglistSort(id = "hot", name = "最热", tid = "hot"),
        )

    override suspend fun getTags(): SonglistTags {
        val tagBody = fetch(SonglistRequest(TAGS_URL))
        val hotBody = fetch(SonglistRequest(HOT_TAG_URL))
        return parseTags(tagBody, hotBody)
            ?: error("kw songlist tags failed")
    }

    override suspend fun getList(
        sortId: String,
        tagId: String?,
        page: Int,
    ): SonglistPage {
        val (id, type) = splitTag(tagId)
        var attempt = 0
        while (true) {
            attempt++
            val parsed =
                runCatching {
                    val body = fetch(SonglistRequest(listUrl(sortId, id, type, page)))
                    parseList(body, id, type, page)
                }.getOrNull()
            if (parsed != null) return parsed
            check(attempt < MAX_ATTEMPTS) { "kw songlist list failed after $attempt attempts" }
        }
    }

    override suspend fun getDetail(
        id: String,
        page: Int,
    ): SonglistDetail {
        val normalized = normalizeId(id)
        if (normalized.startsWith("digest-")) {
            val (digest, rawId) = normalized.removePrefix("digest-").split("__", limit = 2)
            return when (digest) {
                "8" -> getDigest8Detail(rawId, page)
                "5", "" -> getDigest5Detail(rawId, page)
                else -> error("kw digest $digest not supported")
            }
        }
        return getDigest8Detail(normalized, page)
    }

    private suspend fun getDigest8Detail(
        id: String,
        page: Int,
    ): SonglistDetail {
        var attempt = 0
        while (true) {
            attempt++
            val body = fetch(SonglistRequest(detailUrl(id, page)))
            val parsed = runCatching { parseDetail(body, page) }.getOrNull()
            if (parsed != null) return parsed
            check(attempt < MAX_ATTEMPTS) { "kw songlist detail failed after $attempt attempts" }
        }
    }

    private suspend fun getDigest5Detail(
        id: String,
        page: Int,
    ): SonglistDetail {
        var attempt = 0
        while (true) {
            attempt++
            val parsed =
                runCatching {
                    val sourceId = resolveDigest5SourceId(id)
                    val body = fetch(SonglistRequest(digest5DetailUrl(sourceId, page)))
                    parseDetail(body, page)
                }.getOrNull()
            if (parsed != null) return parsed
            check(attempt < MAX_ATTEMPTS) { "kw digest5 detail failed after $attempt attempts" }
        }
    }

    /** RN `getListDetailDigest5Info`：qukudata 返回 `child[0].sourceid`。 */
    private suspend fun resolveDigest5SourceId(id: String): String {
        val body = fetch(SonglistRequest(digest5InfoUrl(id)))
        val root = SonglistUtils.json.parseToJsonElement(body).jsonObject
        val sourceId =
            root["child"]
                .asArray()
                .firstOrNull()
                ?.asObject()
                ?.text("sourceid")
        check(!sourceId.isNullOrEmpty()) { "kw digest5 sourceid missing" }
        return sourceId
    }

    companion object {
        private const val MAX_ATTEMPTS = 3
        private const val LIMIT_LIST = 36
        private const val LIMIT_SONG = 1000

        private const val TAGS_URL =
            "http://wapi.kuwo.cn/api/pc/classify/playlist/getTagList" +
                "?cmd=rcm_keyword_playlist&user=0&prod=kwplayer_pc_9.0.5.0&vipver=9.0.5.0" +
                "&source=kwplayer_pc_9.0.5.0&loginUid=0&loginSid=0&appUid=76039576"
        private const val HOT_TAG_URL =
            "http://wapi.kuwo.cn/api/pc/classify/playlist/getRcmTagList" +
                "?loginUid=0&loginSid=0&appUid=76039576"

        private val MINFO = Regex("""level:(\w+),bitrate:(\d+),format:(\w+),size:([\w.]+)""")
        private val LIST_DETAIL_LINK = Regex("""^.+/playlist(?:_detail)?/(\d+)(?:\?.*|&.*$|#.*$|$)""")

        fun splitTag(tagId: String?): Pair<String?, String?> {
            if (tagId.isNullOrEmpty()) return null to null
            val parts = tagId.split('-', limit = 2)
            return parts[0] to parts.getOrNull(1)
        }

        fun listUrl(
            sortId: String,
            id: String?,
            type: String?,
            page: Int,
        ): String {
            if (id.isNullOrEmpty()) {
                return "http://wapi.kuwo.cn/api/pc/classify/playlist/getRcmPlayList" +
                    "?loginUid=0&loginSid=0&appUid=76039576&&pn=$page&rn=$LIMIT_LIST&order=$sortId"
            }
            return when (type) {
                "10000" ->
                    "http://wapi.kuwo.cn/api/pc/classify/playlist/getTagPlayList" +
                        "?loginUid=0&loginSid=0&appUid=76039576&pn=$page&id=$id&rn=$LIMIT_LIST"
                "43" -> "http://mobileinterfaces.kuwo.cn/er.s?type=get_pc_qz_data&f=web&id=$id&prod=pc"
                else -> error("kw tag digest $type not supported")
            }
        }

        fun detailUrl(
            id: String,
            page: Int,
        ): String =
            "http://nplserver.kuwo.cn/pl.svc?op=getlistinfo&pid=$id&pn=${page - 1}&rn=$LIMIT_SONG" +
                "&encode=utf8&keyset=pl2012&identity=kuwo&pcmp4=1&vipver=MUSIC_9.0.5.0_W1&newver=1"

        fun digest5InfoUrl(id: String): String =
            "http://qukudata.kuwo.cn/q.k?op=query&cont=ninfo&node=$id&pn=0&rn=1&fmt=json&src=mbox&level=2"

        fun digest5DetailUrl(
            id: String,
            page: Int,
        ): String =
            "http://nplserver.kuwo.cn/pl.svc?op=getlistinfo&pid=$id&pn=${page - 1}&rn=$LIMIT_SONG" +
                "&encode=utf-8&keyset=pl2012&identity=kuwo&pcmp4=1"

        fun normalizeId(rawId: String): String {
            if (!rawId.contains(Regex("""[?&:/]"""))) return rawId
            return rawId.replace(LIST_DETAIL_LINK, "$1")
        }

        fun parseTags(
            tagBody: String,
            hotBody: String,
        ): SonglistTags? {
            val tagRoot =
                runCatching { SonglistUtils.json.parseToJsonElement(tagBody).jsonObject }.getOrNull()
                    ?: return null
            if (tagRoot["code"].asInt() != 200) return null
            val tags =
                tagRoot["data"].asArray().mapNotNull { groupElement ->
                    val group = groupElement as? JsonObject ?: return@mapNotNull null
                    SonglistTagGroup(
                        name = group.text("name"),
                        list =
                            group["data"].asArray().mapNotNull { tagElement ->
                                val tag = tagElement as? JsonObject ?: return@mapNotNull null
                                SonglistTag(
                                    id = "${tag.text("id")}-${tag.text("digest")}",
                                    name = tag.text("name"),
                                )
                            },
                    )
                }
            val hotRoot =
                runCatching { SonglistUtils.json.parseToJsonElement(hotBody).jsonObject }.getOrNull()
                    ?: return null
            if (hotRoot["code"].asInt() != 200) return null
            val hotTags =
                hotRoot["data"]
                    .asArray()
                    .firstOrNull()
                    ?.asObject()
                    ?.get("data")
                    .asArray()
                    .mapNotNull { tagElement ->
                        val tag = tagElement as? JsonObject ?: return@mapNotNull null
                        SonglistTag(
                            id = "${tag.text("id")}-${tag.text("digest")}",
                            name = tag.text("name"),
                        )
                    }
            return SonglistTags(tags = tags, hotTags = hotTags, source = "kw")
        }

        fun parseList(
            body: String,
            id: String?,
            type: String?,
            page: Int,
        ): SonglistPage? {
            if (id.isNullOrEmpty() || type == "10000") {
                val root =
                    runCatching { SonglistUtils.json.parseToJsonElement(body).jsonObject }.getOrNull()
                        ?: return null
                if (root["code"].asInt() != 200) return null
                val data = root["data"] as? JsonObject ?: return null
                val raw = data["data"].asArray()
                if (id.isNullOrEmpty() && raw.isEmpty()) return null
                return SonglistPage(
                    list = raw.mapNotNull { (it as? JsonObject)?.let(::toPlaylistItem) },
                    total = data["total"].asInt() ?: 0,
                    limit = data["rn"].asInt() ?: LIMIT_LIST,
                    page = data["pn"].asInt() ?: page,
                    source = "kw",
                )
            }
            val root =
                runCatching { SonglistUtils.json.parseToJsonElement(body) }.getOrNull()
                    ?: return null
            if (root !is JsonArray || root.isEmpty()) return null
            return SonglistPage(
                list = filterGroupedList(root),
                total = 1000,
                limit = 1000,
                page = page,
                source = "kw",
            )
        }

        /** RN `filterList2`：分组数组里只保留 songlist/list/album。 */
        private fun filterGroupedList(root: JsonArray): List<PlaylistItem> {
            val allowed = setOf("songlist", "list", "album")
            val list = mutableListOf<PlaylistItem>()
            root.forEach { groupElement ->
                val group = groupElement as? JsonObject ?: return@forEach
                group["list"].asArray().forEach { itemElement ->
                    val item = itemElement as? JsonObject ?: return@forEach
                    if (item.text("type") !in allowed) return@forEach
                    list.add(toPlaylistItem(item))
                }
            }
            return list
        }

        private fun toPlaylistItem(item: JsonObject): PlaylistItem =
            PlaylistItem(
                id = "digest-${item.text("digest")}__${item.text("id")}",
                name = item.text("name"),
                author = item.text("uname"),
                img = item.text("img").ifEmpty { null },
                playCount = SonglistUtils.formatPlayCount(item["listencnt"].asLong() ?: 0L),
                total = item["total"].asInt(),
                desc = item.text("desc"),
                source = "kw",
            )

        fun parseDetail(
            body: String,
            page: Int,
        ): SonglistDetail? {
            val root =
                runCatching { SonglistUtils.json.parseToJsonElement(body).jsonObject }.getOrNull()
                    ?: return null
            if (root.text("result") != "ok") return null
            val list =
                root["musiclist"].asArray().mapNotNull { row ->
                    val item = row as? JsonObject ?: return@mapNotNull null
                    toMusicInfo(item)
                }
            return SonglistDetail(
                list = list,
                total = root["total"].asInt() ?: list.size,
                limit = root["rn"].asInt() ?: LIMIT_SONG,
                page = page,
                source = "kw",
                info =
                    SonglistInfo(
                        name = root.text("title"),
                        img = root.text("pic"),
                        desc = root.text("info"),
                        author = root.text("uname"),
                        playCount = SonglistUtils.formatPlayCount(root["playnum"].asLong() ?: 0L),
                    ),
            )
        }

        /** RN `filterListDetail` → `toNewMusicInfo`。 */
        private fun toMusicInfo(item: JsonObject): JsonObject? {
            val types = mutableListOf<Pair<String, String>>()
            val typesMap = mutableMapOf<String, JsonElement>()
            for (segment in item.text("N_MINFO").split(';')) {
                val match = MINFO.find(segment) ?: continue
                val type =
                    when (match.groupValues[2]) {
                        "4000" -> "flac24bit"
                        "2000" -> "flac"
                        "320" -> "320k"
                        "128" -> "128k"
                        else -> continue
                    }
                val size = match.groupValues[4]
                types.add(type to size)
                typesMap[type] = buildJsonObject { put("size", size.uppercase(Locale.US)) }
            }
            val old =
                buildJsonObject {
                    put("singer", KwSearch.decodeEntities(item.text("artist")).replace('&', '、'))
                    put("name", KwSearch.decodeEntities(item.text("name")))
                    put("albumName", KwSearch.decodeEntities(item.text("album")))
                    put("albumId", item["albumid"] ?: JsonNull)
                    put("songmid", item.text("id"))
                    put("source", "kw")
                    put("interval", SonglistUtils.formatPlayTime(item.text("duration").takeWhile { it.isDigit() }.toLongOrNull() ?: 0L))
                    put("img", JsonNull)
                    put(
                        "types",
                        buildJsonArray {
                            types.asReversed().forEach { (type, size) ->
                                add(
                                    buildJsonObject {
                                        put("type", type)
                                        put("size", size)
                                    },
                                )
                            }
                        },
                    )
                    put("_types", JsonObject(typesMap))
                }
            return MusicInfoTools.toNewMusicInfo(old)
        }

        private fun JsonObject.text(key: String): String = this[key].text()
    }
}
