package cn.toside.music.core.music.search

import cn.toside.music.core.songlist.asArray
import cn.toside.music.core.songlist.asInt
import cn.toside.music.core.songlist.asLong
import cn.toside.music.core.songlist.text
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject

/**
 * QQ 音乐歌单搜索（对照 RN `utils/musicSdk/tx/songlist.js#search`）。
 *
 * 响应 `code != 0` 时 RN 递归重试，最多 6 次（`retryNum > 5` 抛错）；
 * `introduction` 需要连续 `decodeName` 两次，再把 `<br>` 换成换行。
 */
class TxSonglistSearch(
    private val fetch: suspend (SearchRequest) -> String,
) {
    suspend fun search(
        keyword: String,
        page: Int = 1,
        limit: Int = DEFAULT_LIMIT,
    ): SonglistSearchPage {
        var attempt = 0
        while (true) {
            attempt++
            val parsed = parse(fetch(buildRequest(keyword, page, limit)), page, limit)
            if (parsed != null) return parsed
            check(attempt < MAX_ATTEMPTS) { "tx songlist search failed after $attempt attempts" }
        }
    }

    companion object {
        const val DEFAULT_LIMIT = SonglistSearchAggregator.SOURCE_LIMIT
        private const val MAX_ATTEMPTS = 6
        private const val USER_AGENT = "Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; WOW64; Trident/5.0)"
        private val json = Json { ignoreUnknownKeys = true }

        fun buildRequest(
            keyword: String,
            page: Int,
            limit: Int,
        ): SearchRequest =
            SearchRequest(
                url =
                    "http://c.y.qq.com/soso/fcgi-bin/client_music_search_songlist" +
                        "?page_no=${page - 1}&num_per_page=$limit&format=json" +
                        "&query=${SonglistSearchSupport.encode(keyword)}" +
                        "&remoteplace=txt.yqq.playlist&inCharset=utf8&outCharset=utf-8",
                headers =
                    mapOf(
                        "User-Agent" to USER_AGENT,
                        "Referer" to "http://y.qq.com/portal/search.html",
                    ),
            )

        fun parse(
            body: String,
            page: Int,
            limit: Int,
        ): SonglistSearchPage? {
            val root = runCatching { json.parseToJsonElement(body).jsonObject }.getOrNull() ?: return null
            if (root["code"].asInt() != 0) return null
            val data = root["data"] as? JsonObject ?: return null
            val total = data["sum"].asInt() ?: 0
            val raw = data["list"].asArray()
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
                source = "tx",
            )
        }

        private fun toItem(item: JsonObject): SonglistSearchItem? {
            val id = item.text("dissid")
            if (id.isEmpty()) return null
            val creator = item["creator"] as? JsonObject
            return SonglistSearchItem(
                id = id,
                name = SonglistSearchSupport.decodeName(item.text("dissname")),
                author = SonglistSearchSupport.decodeName(creator?.get("name").text()),
                playCount = SonglistSearchSupport.playCount(item["listennum"].asLong() ?: 0L),
                total = item["song_count"].asInt() ?: 0,
                img = SonglistSearchSupport.nullableText(item.text("imgurl")),
                desc =
                    SonglistSearchSupport
                        .decodeName(SonglistSearchSupport.decodeName(item.text("introduction")))
                        .replace("<br>", "\n"),
                time = SonglistSearchSupport.date(item.text("createtime")),
                source = "tx",
            )
        }
    }
}
