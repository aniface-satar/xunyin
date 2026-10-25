package cn.toside.music.core.music.search

import cn.toside.music.core.songlist.asArray
import cn.toside.music.core.songlist.text
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import java.security.MessageDigest

/**
 * 咪咕歌单搜索（对照 RN `utils/musicSdk/mg/songlist.js#search`）。
 *
 * 与单曲搜索共用同一套 `createSignature`（keyword+固定串+appKey+deviceId+time 的 md5）；
 * 区别只在 `searchSwitch` 打开 `songlist`，响应走 `songListResultData`。
 */
class MgSonglistSearch(
    private val fetch: suspend (SearchRequest) -> String,
    private val clock: () -> String = { System.currentTimeMillis().toString() },
) {
    suspend fun search(
        keyword: String,
        page: Int = 1,
        limit: Int = DEFAULT_LIMIT,
    ): SonglistSearchPage {
        val body = fetch(buildRequest(keyword, page, limit, clock()))
        return checkNotNull(parse(body, page, limit)) { "mg songlist search failed" }
    }

    companion object {
        const val DEFAULT_LIMIT = SonglistSearchAggregator.SOURCE_LIMIT
        private const val DEVICE_ID = "963B7AA0D21511ED807EE5846EC87D20"
        private const val SIGNATURE_MD5 = "6cdc72a439cef99a3418d2a78aa28c73"
        private const val APP_KEY = "yyapp2d16148780a1dcc7408e06336b98cfd50"
        private const val USER_AGENT =
            "Mozilla/5.0 (Linux; U; Android 11.0.0; zh-cn; MI 11 Build/OPR1.170623.032) " +
                "AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30"
        private val json = Json { ignoreUnknownKeys = true }

        fun buildRequest(
            keyword: String,
            page: Int,
            limit: Int,
            time: String,
        ): SearchRequest {
            val sign = signature(keyword, time)
            return SearchRequest(
                url =
                    "https://jadeite.migu.cn/music_search/v3/search/searchAll?isCorrect=1&isCopyright=1" +
                        "&searchSwitch=%7B%22song%22%3A0%2C%22album%22%3A0%2C%22singer%22%3A0" +
                        "%2C%22tagSong%22%3A0%2C%22mvSong%22%3A0%2C%22bestShow%22%3A0%2C%22songlist%22%3A1" +
                        "%2C%22lyricSong%22%3A0%7D&pageSize=$limit" +
                        "&text=${SonglistSearchSupport.encode(keyword)}&pageNo=$page&sort=0&sid=USS",
                headers =
                    mapOf(
                        "uiVersion" to "A_music_3.6.1",
                        "deviceId" to DEVICE_ID,
                        "timestamp" to time,
                        "sign" to sign,
                        "channel" to "0146921",
                        "User-Agent" to USER_AGENT,
                    ),
            )
        }

        fun signature(
            keyword: String,
            time: String,
        ): String = md5("$keyword$SIGNATURE_MD5$APP_KEY$DEVICE_ID$time")

        fun parse(
            body: String,
            page: Int,
            limit: Int,
        ): SonglistSearchPage? {
            val root = runCatching { json.parseToJsonElement(body).jsonObject }.getOrNull() ?: return null
            if (root["code"].text() != "000000") return null
            val data = root["songListResultData"] as? JsonObject ?: return null
            val total = data["totalCount"].text().toIntOrNull() ?: 0
            val raw = data["result"].asArray()
            val list =
                raw.mapNotNull { element ->
                    val item = element as? JsonObject ?: return@mapNotNull null
                    toItem(item)
                }
            return SonglistSearchPage(
                list = list,
                total = total,
                allPage = if (total == 0) 0 else (total + limit - 1) / limit,
                limit = limit,
                source = "mg",
            )
        }

        private fun toItem(item: JsonObject): SonglistSearchItem? {
            val id = item.text("id")
            if (id.isEmpty()) return null
            return SonglistSearchItem(
                id = id,
                name = item.text("name"),
                author = item.text("userName"),
                playCount = SonglistSearchSupport.playCount(item.text("playNum")),
                total = item.text("musicNum").toIntOrNull() ?: 0,
                img = SonglistSearchSupport.nullableText(item.text("musicListPicUrl")),
                source = "mg",
            )
        }

        private fun md5(value: String): String =
            MessageDigest
                .getInstance("MD5")
                .digest(value.toByteArray(Charsets.UTF_8))
                .joinToString("") { "%02x".format(it) }
    }
}
