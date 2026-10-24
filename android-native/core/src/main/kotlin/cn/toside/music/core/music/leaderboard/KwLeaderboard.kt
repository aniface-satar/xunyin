package cn.toside.music.core.music.leaderboard

import cn.toside.music.core.crypto.Crypto
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
import java.util.Locale

/**
 * 酷我排行榜 —— 对照 RN `musicSdk/kw/leaderboard.js` + `kw/util.js#wbdCrypto`。
 *
 * 请求走 `https://wbd.kuwo.cn/api/bd/bang/bang_info`：
 * - `buildParam`：JSON.stringify → Base64 字符串的 UTF-8 字节 → AES-128-ECB
 *   （RN 的 `AES_MODE.ECB_128_NoPadding` 实际是 `Cipher.getInstance("AES")`，
 *   Android 上即 ECB/PKCS5Padding）→ Base64，再拼 `data&time&appId&sign`；
 * - `sign` = MD5(`appId + encodeData + time`).toUpperCase()；
 * - 响应体是 `decodeURIComponent` 后的 Base64 密文，AES 解密得 JSON。
 *
 * 歌曲字段与 RN filterData 一致：n_minfo 音质解析（4000/2000/320/128 →
 * flac24bit/flac/320k/128k，Set 去重后按音质档位升序）。
 */
class KwLeaderboard(
    private val fetch: suspend (url: String) -> String,
    private val clock: () -> Long = System::currentTimeMillis,
) : LeaderboardSource {
    override val source: String = "kw"

    override fun getBoards(): List<BoardItem> = LEADERBOARD_BOARDS.getValue("kw")

    /** 榜单详情；RN getList 用 this.limit=100，失败重试最多 3 次。 */
    override suspend fun getList(
        bangid: String,
        page: Int,
    ): BoardList {
        var attempt = 0
        while (true) {
            attempt++
            val body = fetch(buildUrl(bangid, page, LIMIT, clock()))
            val parsed = parse(body, bangid, page)
            if (parsed != null) return parsed
            check(attempt < MAX_ATTEMPTS) { "kw leaderboard failed after $attempt attempts" }
        }
    }

    companion object {
        const val LIMIT = 100
        private const val MAX_ATTEMPTS = 3
        private const val APP_ID = "y67sprxhhpws"
        private const val AES_KEY = "cFcnPcf6Kb85RC1y3V6M5A=="
        private val json = Json { ignoreUnknownKeys = true }
        private val MINFO = Regex("""level:(\w+),bitrate:(\d+),format:(\w+),size:([\w.]+)""")

        fun buildRequest(
            bangid: String,
            page: Int,
            limit: Int,
            time: Long,
        ): String {
            val requestBody =
                buildJsonObject {
                    put("uid", "")
                    put("devId", "")
                    put("sFrom", "kuwo_sdk")
                    put("user_type", "AP")
                    put("carSource", "kwplayercar_ar_6.0.1.0_apk_keluze.apk")
                    put("id", bangid)
                    put("pn", page - 1)
                    put("rn", limit)
                }.toString()
            val data =
                java.util.Base64
                    .getEncoder()
                    .encodeToString(requestBody.toByteArray(Charsets.UTF_8))
            // RN AES_MODE.ECB_128_NoPadding = 'AES' → Android 默认 ECB/PKCS5Padding；
            // aesEncryptSync(data, ...) 内部先 decodeBase64(data) → 加密 JSON 原始字节
            val encoded =
                Crypto.aesEncrypt(
                    data,
                    AES_KEY,
                    "",
                    "AES/ECB/PKCS5Padding",
                )
            val sign = md5Hex("$APP_ID$encoded$time").uppercase(Locale.US)
            return "https://wbd.kuwo.cn/api/bd/bang/bang_info" +
                "?data=${urlEncode(encoded)}&time=$time&appId=$APP_ID&sign=$sign"
        }

        fun buildUrl(
            bangid: String,
            page: Int,
            limit: Int,
            time: Long,
        ): String = buildRequest(bangid, page, limit, time)

        /** 解析响应：percent 解码 → AES 解密 → JSON；musiclist 缺失返回 null 重试。 */
        fun parse(
            body: String,
            bangid: String,
            page: Int,
        ): BoardList? {
            val decoded = java.net.URLDecoder.decode(body, "UTF-8")
            val plain =
                Crypto.aesDecrypt(decoded, AES_KEY, "", "AES/ECB/PKCS5Padding")
            if (plain.isEmpty()) return null
            val root = runCatching { json.parseToJsonElement(plain).jsonObject }.getOrNull() ?: return null
            if ((root["code"] as? JsonPrimitive)?.content?.toIntOrNull() != 200) return null
            val data = root["data"] as? JsonObject ?: return null
            val musiclist = data["musiclist"] as? JsonArray ?: return null
            val total = (data["total"] as? JsonPrimitive)?.content?.toIntOrNull() ?: 0
            return BoardList(
                list = musiclist.mapNotNull { (it as? JsonObject)?.let(::toMusicInfo) },
                total = total,
                limit = LIMIT,
                page = page,
                source = "kw",
            )
        }

        private fun toMusicInfo(item: JsonObject): JsonObject? {
            val songId = item.text("id")
            if (songId.isEmpty()) return null
            val name = KwSearch.decodeEntities(item.text("name"))
            if (name.isEmpty()) return null
            val singer = KwSearch.decodeEntities(item.text("artist")).replace('&', '、')
            val interval = item.text("duration").toIntOrNull() ?: 0
            val types = mutableListOf<Pair<Int, Pair<String, String>>>()
            val seen = mutableSetOf<String>()
            for (segment in item.text("n_minfo").split(';')) {
                val match = MINFO.find(segment) ?: continue
                val quality =
                    when (match.groupValues[2]) {
                        "4000" -> "flac24bit"
                        "2000" -> "flac"
                        "320" -> "320k"
                        "128" -> "128k"
                        else -> continue
                    }
                if (!seen.add(match.groupValues[2])) continue
                val rank =
                    when (quality) {
                        "flac24bit" -> 4
                        "flac" -> 3
                        "320k" -> 2
                        else -> 1
                    }
                types.add(rank to (quality to match.groupValues[4].uppercase(Locale.US)))
            }
            val sorted = types.sortedBy { it.first }.map { it.second }
            return buildJsonObject {
                put("id", "kw_$songId")
                put("name", name)
                put("singer", singer)
                put("source", "kw")
                put("interval", formatPlayTime(interval))
                put(
                    "meta",
                    buildJsonObject {
                        put("songId", songId)
                        put("albumName", KwSearch.decodeEntities(item.text("album")))
                        put("picUrl", if (item.text("pic").isEmpty()) JsonNull else JsonPrimitive(item.text("pic")))
                        put("albumId", item.text("albumId"))
                        put("qualitys", qualityArray(sorted))
                        put("_qualitys", qualityMap(sorted))
                    },
                )
            }
        }

        private fun qualityArray(qualities: List<Pair<String, String>>): JsonArray =
            buildJsonArray {
                qualities.forEach { (type, size) ->
                    add(
                        buildJsonObject {
                            put("type", type)
                            put("size", size)
                        },
                    )
                }
            }

        private fun qualityMap(qualities: List<Pair<String, String>>): JsonObject =
            buildJsonObject {
                qualities.forEach { (type, size) ->
                    put(
                        type,
                        buildJsonObject { put("size", size) },
                    )
                }
            }

        private fun formatPlayTime(sec: Int): String {
            val m = sec / 60
            val s = sec % 60
            return if (m == 0 && s == 0) "--/--" else String.format(Locale.US, "%02d:%02d", m, s)
        }

        private fun md5Hex(value: String): String =
            java.security.MessageDigest
                .getInstance("MD5")
                .digest(value.toByteArray(Charsets.UTF_8))
                .joinToString("") { "%02x".format(it) }

        private fun urlEncode(value: String): String =
            java.net.URLEncoder
                .encode(value, "UTF-8")
                .replace("+", "%20")

        private fun JsonObject.text(key: String): String =
            when (val v = this[key]) {
                null, is JsonNull -> ""
                is JsonPrimitive -> v.content
                else -> ""
            }
    }
}
