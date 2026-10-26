package cn.toside.music.core.music.search

import cn.toside.music.core.crypto.Crypto
import cn.toside.music.core.songlist.asArray
import cn.toside.music.core.songlist.asInt
import cn.toside.music.core.songlist.asLong
import cn.toside.music.core.songlist.text
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import java.security.MessageDigest
import java.util.Base64
import java.util.Locale
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.pow

/**
 * 专辑/歌手模块五源共用的小工具（新文件，不改任何既有解析器）。
 *
 * 与既有实现的复用关系（对照 RN 与 Wave3~5 已有代码，见 lane 报告）：
 * - kw `r.s` 单引号响应：复用 [SonglistSearchSupport.singleQuotesToJson]，另实测
 *   `r.s` 偶发空槽（`}},` 双逗号，见 album-kw-detail.txt fixture），解析前归一化；
 * - wy 搜索走 eapi（构造方式与 [WySonglistSearch] 完全一致，密钥/摘要算法不新写）；
 * - wy 详情走 weapi，直接复用排行榜模块已公开的 `WyLeaderboard.weapiForm`；
 * - kg 歌曲详情走 RN `getMusicInfosByList` 同款两步链：列表接口只给 hash，
 *   再 POST `gateway.kugou.com/v3/album_audio/audio` 批量换完整信息；
 * - mg 搜索复用 `jadeite searchAll`（签名算法与 [MgSonglistSearch] 相同，只是
 *   searchSwitch 打开 album/singer），mg 歌曲转换直接复用排行榜模块公开的
 *   `MgLeaderboard.filterMusicInfoList`。
 */
internal object SearchDetailSupport {
    val json = Json { ignoreUnknownKeys = true }

    // ---------- kw ----------

    /**
     * kw `r.s` 响应 → JsonObject。单引号对象串 + 实测空槽容错。
     *
     * 归一化顺序有讲究（fixture 实证，见 lane 报告）：
     * 1. 先转引号——塌缩若在前，会把 `'],'` + `,'company'` 的双逗号先缩成一个，
     *    转引号后造出 `","` 这样的假键；
     * 2. 再塌缩连续逗号（`],,` 空槽）；
     * 3. 最后去掉闭合符前的尾逗号（`],}`）。
     * 解析失败返回 null（调用方决定重试语义）。
     */
    fun kwRsRoot(body: String): JsonObject? {
        val converted = SonglistSearchSupport.singleQuotesToJson(body)
        // 实测 artifact：`],'` + `','` 转引号后变成 `],"` + `","`（一个只含逗号的假键），
        // 见 album-kw-search.txt fixture；摘掉假键但保留后续元素的开引号
        val artifactRemoved = converted.replace(Regex("\\],\",\""), "],\"")
        val collapsed = artifactRemoved.replace(Regex(",{2,}"), ",")
        val trailingRemoved = collapsed.replace(Regex(",\\s*([}\\]])"), "$1")
        runCatching { return json.parseToJsonElement(trailingRemoved).jsonObject }
        // 整包仍解析失败时退化为「逐元素抽取」：kw r.s 实测响应的列表数组中间会混入
        // 伪 `]`、缺开括号的元素（album-kw-search.txt fixture 实证），按深度扫描把
        // 每个元素拆出来单独解析后重建整个对象（见 lane 报告）
        return runCatching { kwRepairList(trailingRemoved) }.getOrNull()
    }

    /** 逐元素抽取重建：对 albumlist/abslist/musiclist 做深度扫描，元素缺 `{` 时补齐。 */
    private fun kwRepairList(text: String): JsonObject? {
        for (key in listOf("albumlist", "abslist", "musiclist")) {
            val marker = "\"$key\":["
            val markerStart = text.indexOf(marker)
            if (markerStart < 0) continue
            val elements = mutableListOf<String>()
            var index = markerStart + marker.length
            var elementStart = -1
            var braceless = false
            var depth = 0
            var inString = false
            var escaped = false
            var arrayEnd = -1
            while (index < text.length && arrayEnd < 0) {
                val c = text[index]
                if (inString) {
                    when {
                        escaped -> escaped = false
                        c == '\\' -> escaped = true
                        c == '"' -> inString = false
                    }
                } else {
                    when {
                        c == '"' -> inString = true
                        c == '{' && elementStart < 0 -> {
                            elementStart = index
                            braceless = false
                            depth = 1
                        }
                        c == '{' && elementStart >= 0 -> depth++
                        c == '}' && braceless -> {
                            // 缺开括号的元素：内容全是标量，遇到 `}` 即结束
                            val raw = "{${text.substring(elementStart, index + 1)}"
                            parseKwElement(raw)?.let(elements::add)
                            elementStart = -1
                            braceless = false
                        }
                        c == '}' && elementStart >= 0 -> {
                            depth--
                            if (depth == 0) {
                                val raw = text.substring(elementStart, index + 1)
                                parseKwElement(raw)?.let(elements::add)
                                elementStart = -1
                            }
                        }
                        c == '"' && elementStart < 0 -> {
                            // 元素缺开括号：直接以键名开始（kw r.s 空槽实证）
                            elementStart = index
                            braceless = true
                            depth = 0
                        }
                        c == ']' && elementStart < 0 -> {
                            // 伪 `]`（后随逗号）跳过；真数组结尾（后随 `}` 等）停
                            val next = text.drop(index + 1).firstOrNull { !it.isWhitespace() }
                            if (next != ',') arrayEnd = index
                        }
                        else -> {}
                    }
                }
                index++
            }
            if (elements.isEmpty()) continue
            val head = text.substring(0, markerStart)
            val tail = if (arrayEnd >= 0 && arrayEnd + 1 < text.length) text.substring(arrayEnd + 1) else "}"
            val repaired = head + marker + elements.joinToString(",") + "]" + tail
            return json.parseToJsonElement(repaired).jsonObject
        }
        return null
    }

    private fun parseKwElement(raw: String): String? =
        runCatching {
            val repaired =
                raw
                    .replace(Regex(",{2,}"), ",")
                    .replace(Regex(",\\s*([}\\]])"), "$1")
            json.parseToJsonElement(repaired)
            repaired
        }.getOrNull()

    /**
     * RN `kw/album.js#filterListDetail` 的 FORMATS → 音质表：
     * MP3128 → 128k、MP3H → 320k、ALFLAC → flac、HIRFLAC → flac24bit（size 一律 null）。
     */
    fun kwFormatsToQualities(formats: String): List<Pair<String, String?>> {
        val parts = formats.split('|')
        return listOf(
            "128k" to "MP3128",
            "320k" to "MP3H",
            "flac" to "ALFLAC",
            "flac24bit" to "HIRFLAC",
        ).filter { (_, flag) -> parts.contains(flag) }.map { (type, _) -> type to (null as String?) }
    }

    // ---------- kg ----------

    private const val KG_GATEWAY_URL = "http://gateway.kugou.com/v3/album_audio/audio"

    /**
     * RN `kg/musicInfo.js#createGetMusicInfosTask`：hash 分批（≤100/批）POST 网关。
     * 静态 key / 固定头，无动态签名。
     */
    fun kgGatewayRequests(hashes: List<String>): List<SearchRequest> {
        val requests = mutableListOf<SearchRequest>()
        var remaining = hashes
        while (remaining.isNotEmpty()) {
            val batch = remaining.take(100)
            val body =
                buildJsonObject {
                    put(
                        "data",
                        buildJsonArray {
                            batch.forEach { hash -> add(buildJsonObject { put("hash", hash) }) }
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
                    put("clienttime", System.currentTimeMillis())
                    put("key", "OIlwieks28dk2k092lksi2UIkp")
                    put("fields", "album_info,author_name,audio_info,ori_audio_name,base,songname,classification")
                }.toString()
            requests.add(
                SearchRequest(
                    url = KG_GATEWAY_URL,
                    method = "POST",
                    headers =
                        mapOf(
                            "KG-THash" to "13a3164",
                            "KG-RC" to "1",
                            "KG-Fake" to "0",
                            "KG-RF" to "00869891",
                            "User-Agent" to "Android712-AndroidPhone-11451-376-0-FeeCacheUpdate-wifi",
                            "x-router" to "kmr.service.kugou.com",
                            "Content-Type" to "application/json",
                        ),
                    body = body,
                ),
            )
            remaining = remaining.drop(100)
        }
        return requests
    }

    /** RN `data.map(s => s[0])`：响应 data 是「批次数组」，每批再取首个元素起的后备列表。 */
    fun kgGatewayParse(body: String): List<JsonObject> {
        val root = runCatching { json.parseToJsonElement(body).jsonObject }.getOrNull() ?: return emptyList()
        if ((root["errcode"].asInt() ?: 0) != 0) return emptyList()
        val groups = root["data"].asArray()
        val result = mutableListOf<JsonObject>()
        for (group in groups) {
            for (element in group.asArray()) {
                (element as? JsonObject)?.let(result::add)
            }
        }
        return result
    }

    /**
     * RN `kg/musicInfo.js#filterMusicInfoList`：网关返回的音频项 → 既有 JsonObject 音乐形状。
     * id 与 [KgSearch] 一致（`audioId_hash`），去重键 = audio_id。
     */
    fun kgAudioListToMusicInfos(items: List<JsonObject>): List<JsonObject> {
        val ids = HashSet<String>()
        val list = mutableListOf<JsonObject>()
        items.forEach { item ->
            val audioInfo = item["audio_info"] as? JsonObject ?: return@forEach
            val audioId = audioInfo.text("audio_id")
            if (audioId.isEmpty() || !ids.add(audioId)) return@forEach
            val qualities =
                listOf(
                    Triple("128k", "filesize", "hash"),
                    Triple("320k", "filesize_320", "hash_320"),
                    Triple("flac", "filesize_flac", "hash_flac"),
                    Triple("flac24bit", "filesize_high", "hash_high"),
                ).mapNotNull { (type, sizeKey, hashKey) ->
                    val size = audioInfo.text(sizeKey).toLongOrNull() ?: 0L
                    if (size == 0L) null else Triple(type, formatSize(size), audioInfo.text(hashKey))
                }
            val albumInfo = item["album_info"] as? JsonObject
            list.add(
                buildJsonObject {
                    put("id", "${audioId}_${audioInfo.text("hash")}")
                    put("name", SonglistSearchSupport.decodeName(item.text("songname")))
                    put("singer", SonglistSearchSupport.decodeName(item.text("author_name")))
                    put("source", "kg")
                    put("interval", formatInterval((audioInfo.text("timelength").toLongOrNull() ?: 0L) / 1000))
                    put(
                        "meta",
                        buildJsonObject {
                            put("songId", audioId)
                            put("albumName", SonglistSearchSupport.decodeName(albumInfo?.get("album_name").text()))
                            put(
                                "picUrl",
                                albumInfo
                                    ?.get("sizable_cover")
                                    .text()
                                    .ifEmpty { null }
                                    ?.replace("{size}", "400")
                                    ?.let { JsonPrimitive(it) }
                                    ?: JsonNull,
                            )
                            put("albumId", albumInfo?.get("album_id").text())
                            put("hash", audioInfo.text("hash"))
                            put("qualitys", qualityArray(qualities))
                            put("_qualitys", qualityMap(qualities))
                        },
                    )
                },
            )
        }
        return list
    }

    // ---------- tx ----------

    /** tx `musicu.fcg` 歌曲详情（songInfo）→ 既有 JsonObject 音乐形状（对照 TxLeaderboard）。 */
    fun txSongInfoToMusicInfo(item: JsonObject): JsonObject? {
        val songMid = item.text("mid")
        if (songMid.isEmpty()) return null
        val file = item["file"] as? JsonObject ?: return null
        val album = item["album"] as? JsonObject
        val singerList = item["singer"] as? JsonArray
        val singer =
            singerList
                ?.mapNotNull { (it as? JsonObject)?.text("name")?.ifEmpty { null } }
                ?.joinToString("、")
                .orEmpty()
        val albumMid = album?.text("mid").orEmpty()
        val albumName = album?.text("name").orEmpty()
        val picUrl =
            if (albumName.isEmpty() || albumName == "空") {
                (singerList?.firstOrNull() as? JsonObject)
                    ?.text("mid")
                    ?.ifEmpty { null }
                    ?.let { "https://y.gtimg.cn/music/photo_new/T001R500x500M000$it.jpg" }
                    .orEmpty()
            } else {
                "https://y.gtimg.cn/music/photo_new/T002R500x500M000$albumMid.jpg"
            }
        val qualities =
            listOf(
                "128k" to "size_128mp3",
                "320k" to "size_320mp3",
                "flac" to "size_flac",
                "flac24bit" to "size_hires",
            ).mapNotNull { (type, key) ->
                val size = file[key].asLong() ?: 0L
                if (size == 0L) null else Triple(type, formatSize(size), "")
            }
        val name = item.text("name").ifEmpty { item.text("title") }
        return buildJsonObject {
            put("id", "tx_$songMid")
            put("name", name)
            put("singer", SonglistSearchSupport.decodeName(singer))
            put("source", "tx")
            put("interval", formatInterval(item.text("interval").toLongOrNull() ?: 0L))
            put(
                "meta",
                buildJsonObject {
                    put("songId", songMid)
                    put("albumName", albumName)
                    put("picUrl", picUrl)
                    put("albumId", albumMid)
                    put("strMediaMid", file.text("media_mid"))
                    put("albumMid", albumMid)
                    put("id", item["id"] ?: JsonNull)
                    put("qualitys", qualityArray(qualities))
                    put("_qualitys", qualityMap(qualities))
                },
            )
        }
    }

    // ---------- wy ----------

    /**
     * wy eapi 请求（与 [WySonglistSearch] 逐字节同构：nobody{path}use{body}md5forencrypt
     * + AES/ECB/PKCS5Padding，密钥同源），只是路径/参数不同。不新写加密。
     */
    fun wyEapiRequest(
        path: String,
        body: String,
    ): SearchRequest {
        val message = "nobody${path}use${body}md5forencrypt"
        val digest = md5(message)
        val plain = "$path-36cd479b6b5-$body-36cd479b6b5-$digest".toByteArray(Charsets.UTF_8)
        val encrypted =
            Crypto.aesEncrypt(
                plain,
                "e82ckenh8dichen8".toByteArray(Charsets.UTF_8),
                null,
                "AES/ECB/PKCS5Padding",
            )
        val params =
            Base64.getDecoder().decode(encrypted).joinToString("") { "%02X".format(it) }
        return SearchRequest(
            url = "http://interface.music.163.com/eapi/batch",
            method = "POST",
            headers =
                mapOf(
                    "User-Agent" to WY_USER_AGENT,
                    "origin" to "https://music.163.com",
                    "Content-Type" to "application/x-www-form-urlencoded",
                ),
            form = mapOf("params" to params),
        )
    }

    const val WY_USER_AGENT =
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) " +
            "Chrome/60.0.3112.90 Safari/537.36"

    /**
     * wy 歌曲详情（`weapi/v1/album/{id}` 与 `weapi/v1/artist/{id}` 的 songs/hotSongs，
     * 每首歌内嵌 privilege 对象）→ 既有 JsonObject 音乐形状。对照 [WyLeaderboard.parseSongList]
     * 的音质表规则，只是 privilege 从歌曲对象内嵌字段读取。
     */
    fun wySongWithPrivilegeToMusicInfo(item: JsonObject): JsonObject? {
        val songId = item.text("id")
        if (songId.isEmpty()) return null
        val privilege = item["privilege"] as? JsonObject
        val types = mutableListOf<Pair<String, String?>>()
        if (privilege?.text("maxBrLevel") == "hires") {
            types.add("flac24bit" to sizeOf(item["hr"]))
        }
        when (privilege?.text("maxbr")) {
            "999000" -> {
                types.add("flac" to sizeOf(item["sq"]))
                types.add("320k" to sizeOf(item["h"]))
                types.add("128k" to sizeOf(item["l"]))
            }
            "320000" -> {
                types.add("320k" to sizeOf(item["h"]))
                types.add("128k" to sizeOf(item["l"]))
            }
            "192000", "128000" -> types.add("128k" to sizeOf(item["l"]))
        }
        val qualities = types.asReversed()
        val album = item["al"] as? JsonObject
        return buildJsonObject {
            put("id", "wy_$songId")
            put("name", item.text("name"))
            put(
                "singer",
                (item["ar"] as? JsonArray)
                    ?.mapNotNull { (it as? JsonObject)?.text("name")?.ifEmpty { null } }
                    ?.joinToString("、")
                    .orEmpty(),
            )
            put("source", "wy")
            put("interval", formatInterval((item.text("dt").toLongOrNull() ?: 0L) / 1000))
            put(
                "meta",
                buildJsonObject {
                    put("songId", songId)
                    put("albumName", album?.text("name") ?: "")
                    put("picUrl", album?.get("picUrl") ?: JsonNull)
                    put("albumId", album?.get("id") ?: JsonNull)
                    put("qualitys", qualityArrayNullable(qualities))
                    put("_qualitys", qualityMapNullable(qualities))
                },
            )
        }
    }

    private fun sizeOf(value: kotlinx.serialization.json.JsonElement?): String? {
        val size = ((value as? JsonObject)?.get("size") as? JsonPrimitive)?.content?.toLongOrNull() ?: return null
        return formatSize(size)
    }

    // ---------- mg ----------

    private const val MG_DEVICE_ID = "963B7AA0D21511ED807EE5846EC87D20"
    private const val MG_SIGNATURE_MD5 = "6cdc72a439cef99a3418d2a78aa28c73"
    private const val MG_APP_KEY = "yyapp2d16148780a1dcc7408e06336b98cfd50"
    private const val MG_USER_AGENT =
        "Mozilla/5.0 (Linux; U; Android 11.0.0; zh-cn; MI 11 Build/OPR1.170623.032) " +
            "AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30"

    /**
     * mg `jadeite searchAll` 请求（签名与 [MgSonglistSearch] 同一套）。
     * @param switches 需要 打开的分区，如 "album" to 1（其余分区全部置 0）。
     */
    fun mgSearchAllRequest(
        keyword: String,
        page: Int,
        limit: Int,
        time: String,
        switches: Map<String, Int>,
    ): SearchRequest {
        val allSwitches =
            listOf("song", "album", "singer", "tagSong", "mvSong", "bestShow", "songlist", "lyricSong")
        val switchJson =
            allSwitches.joinToString(",", prefix = "{", postfix = "}") { key ->
                """"$key":${switches[key] ?: 0}"""
            }
        val sign = md5("$keyword$MG_SIGNATURE_MD5$MG_APP_KEY$MG_DEVICE_ID$time")
        val encodedSwitch = java.net.URLEncoder.encode(switchJson, "UTF-8")
        return SearchRequest(
            url =
                "https://jadeite.migu.cn/music_search/v3/search/searchAll?isCorrect=1&isCopyright=1" +
                    "&searchSwitch=$encodedSwitch&pageSize=$limit" +
                    "&text=${SonglistSearchSupport.encode(keyword)}&pageNo=$page&sort=0&sid=USS",
            headers =
                mapOf(
                    "uiVersion" to "A_music_3.6.1",
                    "deviceId" to MG_DEVICE_ID,
                    "timestamp" to time,
                    "sign" to sign,
                    "channel" to "0146921",
                    "User-Agent" to MG_USER_AGENT,
                ),
        )
    }

    // ---------- 公共小工具 ----------

    fun formatSize(size: Long): String {
        if (size == 0L) return "0 B"
        val units = listOf("B", "KiB", "MiB", "GiB", "TiB")
        val unit = floor(ln(size.toDouble()) / ln(1024.0)).toInt()
        return String.format(Locale.US, "%.2f %s", size / 1024.0.pow(unit), units[unit])
    }

    fun formatInterval(seconds: Long): String {
        val minutes = seconds / 60
        val remainder = seconds % 60
        return if (minutes == 0L && remainder == 0L) {
            "--/--"
        } else {
            String.format(Locale.US, "%02d:%02d", minutes, remainder)
        }
    }

    private fun md5(value: String): String =
        MessageDigest
            .getInstance("MD5")
            .digest(value.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }

    private fun qualityArray(qualities: List<Triple<String, String, String>>): JsonArray =
        buildJsonArray {
            qualities.forEach { (type, size, hash) ->
                add(
                    buildJsonObject {
                        put("type", type)
                        put("size", size)
                        if (hash.isNotEmpty()) put("hash", hash)
                    },
                )
            }
        }

    private fun qualityMap(qualities: List<Triple<String, String, String>>): JsonObject =
        buildJsonObject {
            qualities.forEach { (type, size, hash) ->
                put(
                    type,
                    buildJsonObject {
                        put("size", size)
                        if (hash.isNotEmpty()) put("hash", hash)
                    },
                )
            }
        }

    private fun qualityArrayNullable(qualities: List<Pair<String, String?>>): JsonArray =
        buildJsonArray {
            qualities.forEach { (type, size) ->
                add(
                    buildJsonObject {
                        put("type", type)
                        put("size", size?.let { JsonPrimitive(it) } ?: JsonNull)
                    },
                )
            }
        }

    private fun qualityMapNullable(qualities: List<Pair<String, String?>>): JsonObject =
        buildJsonObject {
            qualities.forEach { (type, size) ->
                put(type, buildJsonObject { put("size", size?.let { JsonPrimitive(it) } ?: JsonNull) })
            }
        }
}
