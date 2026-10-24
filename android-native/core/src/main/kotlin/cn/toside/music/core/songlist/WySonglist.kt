package cn.toside.music.core.songlist

import cn.toside.music.core.crypto.Crypto
import cn.toside.music.core.music.MusicInfoTools
import cn.toside.music.core.music.leaderboard.WyWeapi
import cn.toside.music.core.music.search.KwSearch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import java.util.Base64
import java.util.Locale

/**
 * 网易云歌单 —— 对照 RN `musicSdk/wy/songList.js` + `musicDetail.js`。
 *
 * 标签/列表：weapi（`playlist/catalogue`、`playlist/hottags`、`playlist/list`）；
 * 详情：linuxapi 表单转发 `api/v3/playlist/detail`（一次取回 100000 首的 trackIds 与
 * privileges）；若 `trackIds.length != privileges.length`，RN 回退到
 * `weapi/v3/song/detail` 分批取歌曲。
 *
 * 音质映射保留 RN 的 switch **fall-through** 语义：999000 → flac+320k+128k，
 * 320000 → 320k+128k，最后 `types.reverse()`（展示顺序由低到高）。
 */
class WySonglist(
    private val fetch: suspend (SonglistRequest) -> String,
) : SonglistSource {
    override val source: String = "wy"

    override val sorts: List<SonglistSort> =
        listOf(SonglistSort(id = "hot", name = "最热", tid = "hot"))

    override suspend fun getTags(): SonglistTags {
        var attempt = 0
        while (true) {
            attempt++
            val parsed =
                runCatching {
                    val catalogueBody = fetch(webapiRequest(CATALOGUE_URL, "{}"))
                    val hotBody = fetch(webapiRequest(HOT_TAGS_URL, "{}"))
                    parseTags(catalogueBody, hotBody)
                }.getOrNull()
            if (parsed != null) return parsed
            check(attempt < MAX_ATTEMPTS) { "wy songlist tags failed after $attempt attempts" }
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
                    val payload =
                        buildJsonObject {
                            put("cat", tagId ?: "全部")
                            put("order", sortId)
                            put("limit", LIMIT_LIST)
                            put("offset", LIMIT_LIST * (page - 1))
                            put("total", true)
                        }.toString()
                    parseList(fetch(webapiRequest(LIST_URL, payload)), page)
                }.getOrNull()
            if (parsed != null) return parsed
            check(attempt < MAX_ATTEMPTS) { "wy songlist list failed after $attempt attempts" }
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
            check(attempt < MAX_ATTEMPTS) { "wy songlist detail failed after $attempt attempts" }
        }
    }

    private suspend fun loadDetail(
        rawId: String,
        page: Int,
    ): SonglistDetail {
        val (id, cookie) = normalizeId(rawId)
        val forwardPayload =
            buildJsonObject {
                put("method", "POST")
                put("url", "https://music.163.com/api/v3/playlist/detail")
                put(
                    "params",
                    buildJsonObject {
                        put("id", id)
                        put("n", LIMIT_SONG)
                        put("s", 8)
                    },
                )
            }.toString()
        val request =
            SonglistRequest(
                url = LINUX_FORWARD_URL,
                method = "POST",
                headers =
                    mapOf(
                        "User-Agent" to LINUX_UA,
                        "Cookie" to (cookie ?: "MUSIC_U="),
                    ),
                form = mapOf("eparams" to WyLinuxapi.encrypt(forwardPayload)),
            )
        val root = parseObject(fetch(request))
        check(root["code"].asInt() == 200) { "wy detail code != 200" }
        val playlist = root["playlist"] as? JsonObject ?: error("wy playlist missing")
        val trackIds = playlist["trackIds"].asArray()
        val privileges = root["privileges"].asArray()
        val limit = 1000
        val rangeStart = (page - 1) * limit
        val list =
            if (trackIds.size == privileges.size) {
                toMusicInfoList(playlist["tracks"].asArray(), privileges)
            } else {
                val ids =
                    trackIds.drop(rangeStart).take(limit).mapNotNull { (it as? JsonObject)?.get("id").asLong() }
                fetchSongDetail(ids)
            }
        return SonglistDetail(
            list = list,
            total = trackIds.size,
            limit = limit,
            page = page,
            source = "wy",
            info =
                SonglistInfo(
                    name = playlist.text("name"),
                    img = playlist.text("coverImgUrl"),
                    desc = playlist.text("description"),
                    author = (playlist["creator"] as? JsonObject)?.text("nickname"),
                    playCount =
                        SonglistUtils.formatPlayCount(playlist["playCount"].asLong() ?: 0L),
                ),
        )
    }

    /** RN `musicDetail.getList`：分批 weapi song/detail（这里一次 1000 首）。 */
    private suspend fun fetchSongDetail(ids: List<Long>): List<JsonObject> {
        if (ids.isEmpty()) return emptyList()
        val payload =
            buildJsonObject {
                put("c", "[" + ids.joinToString(",") { """{"id":$it}""" } + "]")
                put("ids", "[" + ids.joinToString(",") + "]")
            }.toString()
        val request =
            webapiRequest(SONG_DETAIL_URL, payload)
                .copy(headers = mapOf("origin" to "https://music.163.com"))
        val root = parseObject(fetch(request))
        check(root["code"].asInt() == 200) { "wy song detail code != 200" }
        return toMusicInfoList(root["songs"].asArray(), root["privileges"].asArray())
    }

    companion object {
        private const val MAX_ATTEMPTS = 3
        private const val LIMIT_LIST = 30
        private const val LIMIT_SONG = 100000
        private const val CATALOGUE_URL = "https://music.163.com/weapi/playlist/catalogue"
        private const val HOT_TAGS_URL = "https://music.163.com/weapi/playlist/hottags"
        private const val LIST_URL = "https://music.163.com/weapi/playlist/list"
        private const val SONG_DETAIL_URL = "https://music.163.com/weapi/v3/song/detail"
        private const val LINUX_FORWARD_URL = "https://music.163.com/api/linux/forward"
        private const val LINUX_UA =
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) " +
                "Chrome/60.0.3112.90 Safari/537.36"
        private val LIST_DETAIL_LINK = Regex("""^.+(?:\?|&)id=(\d+)(?:&.*$|#.*$|$)""")
        private val LIST_DETAIL_LINK2 = Regex("""^.+/playlist/(\d+)/\d+/.+$""")

        fun webapiRequest(
            url: String,
            payloadJson: String,
            cookie: String = "MUSIC_U=",
        ): SonglistRequest {
            val form = WyWeapi.encrypt(payloadJson)
            return SonglistRequest(
                url = url,
                method = "POST",
                headers = mapOf("Cookie" to cookie),
                form = mapOf("params" to form.params, "encSecKey" to form.encSecKey),
            )
        }

        /** RN `getListId`：拆 `id###token`，再从链接里提取数字 id。 */
        fun normalizeId(rawId: String): Pair<String, String?> {
            var id = rawId
            var cookie: String? = null
            if (id.contains("###")) {
                val parts = id.split("###", limit = 2)
                id = parts[0]
                cookie = "MUSIC_U=${parts[1]}"
            }
            if (id.contains(Regex("""[?&:/]"""))) {
                LIST_DETAIL_LINK.find(id)?.let { return it.groupValues[1] to cookie }
                LIST_DETAIL_LINK2.find(id)?.let { return it.groupValues[1] to cookie }
                error("wy list link not supported: $id")
            }
            return id to cookie
        }

        fun parseTags(
            catalogueBody: String,
            hotBody: String,
        ): SonglistTags? {
            val root = parseObject(catalogueBody)
            if (root["code"].asInt() != 200) return null
            val sub = root["sub"].asArray()
            val categories = root["categories"] as? JsonObject ?: return null
            val subByCategory = LinkedHashMap<String, MutableList<SonglistTag>>()
            sub.forEach { subElement ->
                val item = subElement as? JsonObject ?: return@forEach
                val category = item.text("category")
                subByCategory.getOrPut(category) { mutableListOf() }.add(
                    SonglistTag(id = item.text("name"), name = item.text("name")),
                )
            }
            val groups =
                categories.keys.map { key ->
                    SonglistTagGroup(
                        name = categories[key].text(),
                        list = subByCategory[key].orEmpty(),
                    )
                }
            val hotRoot = parseObject(hotBody)
            val hotTags =
                hotRoot["tags"].asArray().mapNotNull { hotElement ->
                    val item = hotElement as? JsonObject ?: return@mapNotNull null
                    val playlistTag = item["playlistTag"] as? JsonObject ?: return@mapNotNull null
                    SonglistTag(id = playlistTag.text("name"), name = playlistTag.text("name"))
                }
            return SonglistTags(tags = groups, hotTags = hotTags, source = "wy")
        }

        fun parseList(
            body: String,
            page: Int,
        ): SonglistPage? {
            val root = parseObject(body)
            if (root["code"].asInt() != 200) return null
            val list =
                root["playlists"].asArray().mapNotNull { itemElement ->
                    val item = itemElement as? JsonObject ?: return@mapNotNull null
                    PlaylistItem(
                        id = item.text("id"),
                        name = item.text("name"),
                        author = (item["creator"] as? JsonObject)?.text("nickname").orEmpty(),
                        img = item.text("coverImgUrl").ifEmpty { null },
                        playCount = SonglistUtils.formatPlayCount(item["playCount"].asLong() ?: 0L),
                        total = item["trackCount"].asInt(),
                        desc = item.text("description"),
                        time = SonglistUtils.formatDate(item["createTime"].asLong() ?: 0L),
                        source = "wy",
                    )
                }
            return SonglistPage(
                list = list,
                total = bodyTotal(root),
                limit = LIMIT_LIST,
                page = page,
                source = "wy",
            )
        }

        private fun bodyTotal(root: JsonObject): Int = root["total"].asInt() ?: 0

        /** RN `filterListDetail`（songList.js 版本）→ `toNewMusicInfo`。 */
        private fun toMusicInfoList(
            tracks: JsonArray,
            privileges: JsonArray,
        ): List<JsonObject> {
            val list = mutableListOf<JsonObject>()
            tracks.forEachIndexed { index, trackElement ->
                val item = trackElement as? JsonObject ?: return@forEachIndexed
                val itemId = item["id"].asLong()
                var privilege = privileges.getOrNull(index) as? JsonObject
                if (privilege?.get("id").asLong() != itemId) {
                    privilege =
                        privileges
                            .mapNotNull { it as? JsonObject }
                            .firstOrNull { it["id"].asLong() == itemId }
                }
                val priv = privilege ?: return@forEachIndexed
                toMusicInfo(item, priv)?.let(list::add)
            }
            return list
        }

        private fun toMusicInfo(
            item: JsonObject,
            privilege: JsonObject,
        ): JsonObject? {
            val types = mutableListOf<Pair<String, JsonElement>>()
            val typesMap = mutableMapOf<String, JsonElement>()
            if (privilege.text("maxBrLevel") == "hires") {
                val size = (item["hr"] as? JsonObject)?.get("size").asLong()
                types.add("flac24bit" to size.asSizeElement())
                typesMap["flac24bit"] = buildJsonObject { put("size", size.asSizeElement()) }
            }
            // 保留 RN switch 的 fall-through：999000 会继续落到 320000 与 128000
            when (privilege["maxbr"].asLong()) {
                FLAC_MAXBR -> {
                    val flacSize = (item["sq"] as? JsonObject)?.get("size").asLong().asSizeElement()
                    types.add("flac" to flacSize)
                    typesMap["flac"] = buildJsonObject { put("size", flacSize) }
                    types.add("320k" to (item["h"] as? JsonObject)?.get("size").asLong().asSizeElement())
                    typesMap["320k"] = buildJsonObject { put("size", (item["h"] as? JsonObject)?.get("size").asLong().asSizeElement()) }
                    types.add("128k" to (item["l"] as? JsonObject)?.get("size").asLong().asSizeElement())
                    typesMap["128k"] = buildJsonObject { put("size", (item["l"] as? JsonObject)?.get("size").asLong().asSizeElement()) }
                }
                HQ_MAXBR -> {
                    types.add("320k" to (item["h"] as? JsonObject)?.get("size").asLong().asSizeElement())
                    typesMap["320k"] = buildJsonObject { put("size", (item["h"] as? JsonObject)?.get("size").asLong().asSizeElement()) }
                    types.add("128k" to (item["l"] as? JsonObject)?.get("size").asLong().asSizeElement())
                    typesMap["128k"] = buildJsonObject { put("size", (item["l"] as? JsonObject)?.get("size").asLong().asSizeElement()) }
                }
                SQ_MAXBR, NORMAL_MAXBR -> {
                    types.add("128k" to (item["l"] as? JsonObject)?.get("size").asLong().asSizeElement())
                    typesMap["128k"] = buildJsonObject { put("size", (item["l"] as? JsonObject)?.get("size").asLong().asSizeElement()) }
                }
            }
            val pc = item["pc"] as? JsonObject
            val album = item["al"] as? JsonObject
            val singers =
                if (pc != null) {
                    pc.text("ar")
                } else {
                    item["ar"]
                        .asArray()
                        .mapNotNull { (it as? JsonObject)?.text("name") }
                        .joinToString("、")
                }
            val old =
                buildJsonObject {
                    put("singer", KwSearch.decodeEntities(singers))
                    put("name", pc?.text("sn") ?: item.text("name"))
                    put("albumName", pc?.text("alb") ?: album?.text("name").orEmpty())
                    album?.get("id")?.let { put("albumId", it) }
                    put("source", "wy")
                    put("interval", SonglistUtils.formatPlayTime((item["dt"].asLong() ?: 0L) / 1000))
                    put("songmid", item["id"] ?: JsonNull)
                    put("img", album?.get("picUrl") ?: JsonNull)
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

        private const val FLAC_MAXBR = 999000L
        private const val HQ_MAXBR = 320000L
        private const val SQ_MAXBR = 192000L
        private const val NORMAL_MAXBR = 128000L

        fun parseObject(body: String): JsonObject =
            runCatching { SonglistUtils.json.parseToJsonElement(body).jsonObject }.getOrNull()
                ?: JsonObject(emptyMap())

        /** RN `sizeFormate(size)`：字节数格式化成 `x.xx MiB`；缺省为 null。 */
        private fun Long?.asSizeElement(): JsonElement =
            if (this == null) JsonNull else kotlinx.serialization.json.JsonPrimitive(SonglistUtils.formatSize(this))

        private fun JsonObject.text(key: String): String = this[key].text()
    }
}

/**
 * 网易 linuxapi —— 对照 RN `wy/utils/crypto.js#linuxapi`，但**修正了填充方式**。
 *
 * RN 写的是 `Base64(JSON)` → `AES-128-ECB-NoPadding`，而它的原生 AES 实现会先对入参
 * 做 Base64 解码，等价于对 **JSON 原始字节** 做 NoPadding 加密——只要 JSON 字节数不是
 * 16 的倍数（绝大多数情况），原生层会抛 `wrong final block length` 并吞掉异常返回空串，
 * 最终 eparams 为空、请求被服务端拒绝。上游 Binaryify/NeteaseCloudMusicApi 的实现是
 * 对 JSON 原始字节做带 PKCS7 填充的 AES-128-ECB。
 *
 * 2026-10-25 实测（同一 `api/v3/playlist/detail` 请求）：原始字节 + PKCS7 → `code:200`；
 * `Base64(JSON)` + PKCS7 → `code:400`。故这里采用原始字节 + PKCS7（JVM 中写作
 * `PKCS5Padding`，AES 16 字节块下与 PKCS#7 等价，见 [WyWeapi] 注释）。
 */
object WyLinuxapi {
    private const val KEY = "rFgB&h#%2?^eDg:Q"
    private const val ECB = "AES/ECB/PKCS5Padding"

    fun encrypt(payloadJson: String): String {
        val encrypted =
            Crypto.aesEncrypt(
                payloadJson.toByteArray(Charsets.UTF_8),
                KEY.toByteArray(Charsets.UTF_8),
                null,
                ECB,
            )
        val bytes = Base64.getDecoder().decode(encrypted)
        return bytes.joinToString("") { "%02x".format(it) }.uppercase(Locale.US)
    }
}
