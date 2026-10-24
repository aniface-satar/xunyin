package cn.toside.music.core.music.leaderboard

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
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.pow

/**
 * 网易云排行榜 —— 对照 RN `musicSdk/wy/leaderboard.js` + `musicDetail.js`。
 *
 * 两段链路：weapi POST `weapi/v3/playlist/detail`（n=100000 全量）取 trackIds，
 * 再 weapi POST `weapi/v3/song/detail` 按 id 批量取详情（RN musicDetail.getList）。
 * 一次返回整榜，total = 详情列表长度；失败重试最多 6 次（RN 上限）。
 */
class WyLeaderboard(
    private val fetchForm: suspend (url: String, form: Map<String, String>) -> String,
) : LeaderboardSource {
    override val source: String = "wy"

    override fun getBoards(): List<BoardItem> = LEADERBOARD_BOARDS.getValue("wy")

    override suspend fun getList(
        bangid: String,
        page: Int,
    ): BoardList {
        var attempt = 0
        while (true) {
            attempt++
            val parsed = runCatching { fetchList(bangid, page) }.getOrNull()
            if (parsed != null) return parsed
            check(attempt < MAX_ATTEMPTS) { "wy leaderboard failed after $attempt attempts" }
        }
    }

    private suspend fun fetchList(
        bangid: String,
        page: Int,
    ): BoardList {
        // 1) playlist detail → trackIds
        val detailBody = fetchForm(PLAYLIST_DETAIL_URL, weapiForm("""{"id":"$bangid","n":100000,"p":1}"""))
        val detail = parseOk(detailBody) ?: return BoardList(emptyList(), 0, LIMIT, page, "wy")
        val trackIds =
            ((detail["playlist"] as? JsonObject)?.get("trackIds") as? JsonArray)
                ?.mapNotNull { (it as? JsonObject)?.get("id").asLong() }
                .orEmpty()
        if (trackIds.isEmpty()) return BoardList(emptyList(), 0, LIMIT, page, "wy")

        // 2) song detail → 整榜歌曲（RN musicDetail.getList 的 c/ids 形状）
        val c = trackIds.joinToString(",") { """{"id":$it}""" }
        val ids = trackIds.joinToString(",")
        val songBody = fetchForm(SONG_DETAIL_URL, weapiForm("""{"c":"[$c]","ids":"[$ids]"}"""))
        val songs = parseOk(songBody) ?: return BoardList(emptyList(), 0, LIMIT, page, "wy")
        val list = parseSongList(songs)
        return BoardList(list, list.size, LIMIT, page, "wy")
    }

    companion object {
        const val LIMIT = 100_000
        private const val MAX_ATTEMPTS = 6
        private const val PLAYLIST_DETAIL_URL = "https://music.163.com/weapi/v3/playlist/detail"
        private const val SONG_DETAIL_URL = "https://music.163.com/weapi/v3/song/detail"
        private val json = Json { ignoreUnknownKeys = true }

        fun weapiForm(objectJson: String): Map<String, String> {
            val encrypted = WyWeapi.encrypt(objectJson)
            return mapOf(
                "params" to encrypted.params,
                "encSecKey" to encrypted.encSecKey,
            )
        }

        private fun parseOk(body: String): JsonObject? {
            val root = runCatching { json.parseToJsonElement(body).jsonObject }.getOrNull() ?: return null
            if ((root["code"] as? JsonPrimitive)?.content?.toIntOrNull() != 200) return null
            return root
        }

        /** RN musicDetail.filterList：songs + privileges 按位配对（id 不匹配时回找）。 */
        fun parseSongList(root: JsonObject): List<JsonObject> {
            val songs = root["songs"] as? JsonArray ?: return emptyList()
            val privileges = root["privileges"] as? JsonArray ?: return emptyList()
            val list = mutableListOf<JsonObject>()
            songs.forEach { songElement ->
                val item = songElement as? JsonObject ?: return@forEach
                val songId = item.text("id")
                val privilege =
                    privileges
                        .firstOrNull { (it as? JsonObject)?.text("id") == songId }
                        ?.let { it as JsonObject } ?: return@forEach
                val types = mutableListOf<Pair<String, String?>>()
                if (privilege.text("maxBrLevel") == "hires") {
                    types.add("flac24bit" to sizeOf(item["hr"]))
                }
                when (privilege.text("maxbr")) {
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
                // RN types.reverse() → 高音质在前
                val qualities = types.asReversed().filter { it.second != null }
                val pc = item["pc"] as? JsonObject
                val album = item["al"] as? JsonObject
                list.add(
                    buildJsonObject {
                        put("id", "wy_$songId")
                        if (pc != null) {
                            put("name", pc.text("sn"))
                            put("singer", pc.text("ar"))
                        } else {
                            put("name", item.text("name"))
                            put(
                                "singer",
                                (item["ar"] as? JsonArray)
                                    ?.mapNotNull { (it as? JsonObject)?.text("name")?.ifEmpty { null } }
                                    ?.joinToString("、")
                                    .orEmpty(),
                            )
                        }
                        put("source", "wy")
                        put("interval", formatInterval((item.text("dt").toLongOrNull() ?: 0L) / 1000))
                        put(
                            "meta",
                            buildJsonObject {
                                put("songId", songId)
                                put("albumName", pc?.text("alb") ?: album?.text("name") ?: "")
                                put("picUrl", album?.get("picUrl") ?: JsonNull)
                                put("albumId", album?.get("id") ?: JsonNull)
                                put("qualitys", qualityArray(qualities))
                                put("_qualitys", qualityMap(qualities))
                            },
                        )
                    },
                )
            }
            return list
        }

        private fun sizeOf(value: JsonElement?): String? {
            val size = ((value as? JsonObject)?.get("size") as? JsonPrimitive)?.content?.toLongOrNull() ?: return null
            return formatSize(size)
        }

        private fun qualityArray(qualities: List<Pair<String, String?>>): JsonArray =
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

        private fun qualityMap(qualities: List<Pair<String, String?>>): JsonObject =
            buildJsonObject {
                qualities.forEach { (type, size) ->
                    put(
                        type,
                        buildJsonObject { put("size", size?.let { JsonPrimitive(it) } ?: JsonNull) },
                    )
                }
            }

        private fun formatSize(size: Long): String {
            if (size == 0L) return "0 B"
            val units = listOf("B", "KiB", "MiB", "GiB", "TiB")
            val unit = floor(ln(size.toDouble()) / ln(1024.0)).toInt()
            return String.format(Locale.US, "%.2f %s", size / 1024.0.pow(unit), units[unit])
        }

        private fun formatInterval(seconds: Long): String {
            val minutes = seconds / 60
            val remainder = seconds % 60
            return if (minutes == 0L && remainder == 0L) {
                "--/--"
            } else {
                String.format(Locale.US, "%02d:%02d", minutes, remainder)
            }
        }

        private fun JsonObject.text(key: String): String =
            when (val v = this[key]) {
                null, is JsonNull -> ""
                is JsonPrimitive -> v.content
                else -> ""
            }

        private fun JsonElement?.asLong(): Long? = (this as? JsonPrimitive)?.content?.toLongOrNull()
    }
}
