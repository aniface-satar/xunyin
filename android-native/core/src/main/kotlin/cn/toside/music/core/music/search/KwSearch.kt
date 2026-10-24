package cn.toside.music.core.music.search

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import java.util.Locale

/**
 * 酷我搜索（对照 RN `utils/musicSdk/kw/musicSearch.js` + `utils/index.ts#toNewMusicInfo`）。
 *
 * 请求是普通 GET（无需签名），响应直接是 JSON；结果按 RN 的 MusicInfo 形状输出
 * （id=`kw_<rid>`，meta 带 albumName/picUrl/qualitys/_qualitys/albumId），
 * 可直接写入列表并由 PlayerCore 交给音源脚本取链。
 *
 * HTTP 由调用方注入（app 层用 HttpURLConnection），保证解析逻辑可在 :core 纯 JVM 测试。
 */
class KwSearch(
    private val fetch: suspend (url: String) -> String,
) {
    /** 搜索；`SHOW=0`（服务端限流）或无结果时按 RN 逻辑重试，最多 3 次。 */
    suspend fun search(
        keyword: String,
        page: Int = 1,
        limit: Int = DEFAULT_LIMIT,
    ): SearchPage {
        var attempt = 0
        while (true) {
            attempt++
            val body = fetch(buildUrl(keyword, page, limit))
            val parsed = parse(body, page, limit)
            if (parsed != null) return parsed
            check(attempt < MAX_ATTEMPTS) { "kw search failed after $attempt attempts" }
        }
    }

    companion object {
        const val DEFAULT_LIMIT = 30
        private const val MAX_ATTEMPTS = 3
        private const val PIC_PREFIX = "http://img1.kwcdn.kuwo.cn/star/albumcover/500/"
        private val json = Json { ignoreUnknownKeys = true }
        private val MINFO = Regex("""level:(\w+),bitrate:(\d+),format:(\w+),size:([\w.]+)""")
        private val ENTITY = Regex("""&(#x?[0-9a-fA-F]+|[a-zA-Z]+);""")
        private val LEADING_INT = Regex("""^\s*(-?\d+)""")

        fun buildRequest(
            keyword: String,
            page: Int,
            limit: Int,
        ): SearchRequest = SearchRequest(url = buildUrl(keyword, page, limit))

        fun buildUrl(
            keyword: String,
            page: Int,
            limit: Int,
        ): String =
            "http://search.kuwo.cn/r.s?client=kt&all=${encodeURIComponent(keyword)}" +
                "&pn=${page - 1}&rn=$limit&uid=794762570&ver=kwplayer_ar_9.2.2.1&vipver=1" +
                "&show_copyright_off=1&newver=1&ft=music&cluster=0&strategy=2012" +
                "&encoding=utf8&rformat=json&vermerge=1&mobi=1&issubtitle=1"

        /** 解析响应；需要重试（限流/无结果）时返回 null。 */
        fun parse(
            body: String,
            page: Int,
            limit: Int,
        ): SearchPage? {
            val root =
                runCatching { json.parseToJsonElement(body).jsonObject }.getOrNull()
                    ?: return null
            val total = root["TOTAL"].text().toIntOrNull() ?: 0
            val show = root["SHOW"].text().toIntOrNull() ?: 0
            if (total != 0 && show == 0) return null
            val raw =
                when (val abslist = root["abslist"]) {
                    null, is JsonNull -> JsonArray(emptyList())
                    is JsonArray -> abslist
                    else -> return null
                }
            val list = mutableListOf<JsonObject>()
            for (element in raw) {
                val item = element as? JsonObject ?: return null
                if (item.text("N_MINFO").isEmpty()) return null
                toMusicInfo(item)?.let(list::add)
            }
            return SearchPage(
                list = list,
                total = total,
                allPage = if (total == 0) 0 else (total + limit - 1) / limit,
                limit = limit,
                source = "kw",
            )
        }

        private fun toMusicInfo(item: JsonObject): JsonObject? {
            val musicId = item.text("MUSICRID").removePrefix("MUSIC_")
            if (musicId.isEmpty()) return null
            val name = decodeEntities(item.text("SONGNAME"))
            if (name.isEmpty()) return null
            val singer = decodeEntities(item.text("ARTIST")).replace('&', '、')
            val albumName = decodeEntities(item.text("ALBUM"))
            val interval =
                LEADING_INT
                    .find(item.text("DURATION"))
                    ?.groupValues
                    ?.get(1)
                    ?.toIntOrNull() ?: 0
            val picPath =
                item
                    .text("web_albumpic_short")
                    .split('/')
                    .drop(1)
                    .joinToString("/")
            val types = mutableListOf<Pair<String, String>>()
            for (segment in item.text("N_MINFO").split(';')) {
                val match = MINFO.find(segment) ?: continue
                val quality =
                    when (match.groupValues[2]) {
                        "4000" -> "flac24bit"
                        "2000" -> "flac"
                        "320" -> "320k"
                        "128" -> "128k"
                        else -> null
                    } ?: continue
                types.add(quality to match.groupValues[4])
            }
            val typesArray =
                buildJsonArray {
                    types.asReversed().forEach { (type, size) ->
                        add(
                            buildJsonObject {
                                put("type", type)
                                put("size", size)
                            },
                        )
                    }
                }
            val typesMap =
                buildJsonObject {
                    types.forEach { (type, size) ->
                        put(
                            type,
                            buildJsonObject { put("size", size.uppercase(Locale.US)) },
                        )
                    }
                }
            return buildJsonObject {
                put("id", "kw_$musicId")
                put("name", name)
                put("singer", singer)
                put("source", "kw")
                put("interval", formatPlayTime(interval))
                put(
                    "meta",
                    buildJsonObject {
                        put("songId", musicId)
                        put("albumName", albumName)
                        put("picUrl", if (picPath.isEmpty()) JsonNull else JsonPrimitive(PIC_PREFIX + picPath))
                        put("albumId", decodeEntities(item.text("ALBUMID")))
                        put("qualitys", typesArray)
                        put("_qualitys", typesMap)
                    },
                )
            }
        }

        private fun formatPlayTime(sec: Int): String {
            val m = sec / 60
            val s = sec % 60
            return if (m == 0 && s == 0) "--/--" else String.format(Locale.US, "%02d:%02d", m, s)
        }

        /** `he.decode` 的常用子集：命名实体 + 十进制/十六进制数字实体。 */
        fun decodeEntities(input: String): String {
            if (!input.contains('&')) return input
            return ENTITY.replace(input) { match ->
                when (val name = match.groupValues[1]) {
                    "amp" -> "&"
                    "lt" -> "<"
                    "gt" -> ">"
                    "quot" -> "\""
                    "apos" -> "'"
                    "nbsp" -> "\u00A0"
                    else ->
                        runCatching {
                            if (name.startsWith("#x") || name.startsWith("#X")) {
                                name.drop(2).toInt(16).toChar()
                            } else if (name.startsWith("#")) {
                                name.drop(1).toInt().toChar()
                            } else {
                                match.value
                            }
                        }.getOrDefault(match.value).toString()
                }
            }
        }

        private fun encodeURIComponent(value: String): String =
            java.net.URLEncoder
                .encode(value, "UTF-8")
                .replace("+", "%20")

        private fun JsonObject.text(key: String): String = this[key].text()

        private fun JsonElement?.text(): String =
            when (this) {
                null, is JsonNull -> ""
                is JsonPrimitive -> content
                else -> ""
            }
    }
}
