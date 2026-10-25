package cn.toside.music.core.music.search

import cn.toside.music.core.songlist.asArray
import cn.toside.music.core.songlist.asInt
import cn.toside.music.core.songlist.asLong
import cn.toside.music.core.songlist.text
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject

/**
 * 酷狗歌单搜索（对照 RN `utils/musicSdk/kg/songlist.js#search`）。
 *
 * `errcode != 0` 时抛错（RN `throw new Error('filed')`），没有内部重试。
 */
class KgSonglistSearch(
    private val fetch: suspend (SearchRequest) -> String,
) {
    suspend fun search(
        keyword: String,
        page: Int = 1,
        limit: Int = DEFAULT_LIMIT,
    ): SonglistSearchPage =
        checkNotNull(parse(fetch(buildRequest(keyword, page, limit)), page, limit)) {
            "kg songlist search failed"
        }

    companion object {
        const val DEFAULT_LIMIT = SonglistSearchAggregator.SOURCE_LIMIT
        private val json = Json { ignoreUnknownKeys = true }

        fun buildRequest(
            keyword: String,
            page: Int,
            limit: Int,
        ): SearchRequest =
            SearchRequest(
                url =
                    "http://msearchretry.kugou.com/api/v3/search/special?keyword=" +
                        "${SonglistSearchSupport.encode(keyword)}&page=$page&pagesize=$limit" +
                        "&showtype=10&filter=0&version=7910&sver=2",
            )

        fun parse(
            body: String,
            page: Int,
            limit: Int,
        ): SonglistSearchPage? {
            val root = runCatching { json.parseToJsonElement(body).jsonObject }.getOrNull() ?: return null
            if (root["errcode"].asInt() != 0) return null
            val data = root["data"] as? JsonObject ?: return null
            val total = data["total"].asInt() ?: 0
            val raw = data["info"].asArray()
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
                source = "kg",
            )
        }

        private fun toItem(item: JsonObject): SonglistSearchItem? {
            val specialId = item.text("specialid")
            if (specialId.isEmpty()) return null
            return SonglistSearchItem(
                id = "id_$specialId",
                name = item.text("specialname"),
                author = item.text("nickname"),
                playCount = SonglistSearchSupport.playCount(item["playcount"].asLong() ?: 0L),
                total = item["songcount"].asInt() ?: 0,
                img = SonglistSearchSupport.nullableText(item.text("imgurl")),
                desc = item.text("intro"),
                time = SonglistSearchSupport.date(item.text("publishtime")),
                source = "kg",
                grade = SonglistSearchSupport.nullableText(item.text("grade")),
            )
        }
    }
}
