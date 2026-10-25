package cn.toside.music.core.music.search

import cn.toside.music.core.songlist.asArray
import cn.toside.music.core.songlist.asLong
import cn.toside.music.core.songlist.text
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject

/**
 * 酷我歌单搜索（对照 RN `utils/musicSdk/kw/songlist.js#search`）。
 *
 * 响应是单引号 JS 对象串，需先按 RN `objStr2JSON` 的规则转成 JSON。
 * 无重试；解析失败由调用方决定重试或报错。
 */
class KwSonglistSearch(
    private val fetch: suspend (SearchRequest) -> String,
) {
    suspend fun search(
        keyword: String,
        page: Int = 1,
        limit: Int = DEFAULT_LIMIT,
    ): SonglistSearchPage =
        checkNotNull(parse(fetch(buildRequest(keyword, page, limit)), page, limit)) {
            "kw songlist search failed"
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
                    "http://search.kuwo.cn/r.s?all=${SonglistSearchSupport.encode(keyword)}" +
                        "&pn=${page - 1}&rn=$limit&rformat=json&encoding=utf8&ver=mbox" +
                        "&vipver=MUSIC_8.7.7.0_BCS37&plat=pc&devid=28156413&ft=playlist&pay=0&needliveshow=0",
            )

        fun parse(
            body: String,
            page: Int,
            limit: Int,
        ): SonglistSearchPage? {
            val root = parseRoot(body) ?: return null
            val total = root["TOTAL"].text().toIntOrNull() ?: 0
            val raw = root["abslist"].asArray()
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
                source = "kw",
            )
        }

        private fun parseRoot(body: String): JsonObject? {
            runCatching { json.parseToJsonElement(body).jsonObject }.getOrNull()?.let { return it }
            return runCatching {
                json.parseToJsonElement(SonglistSearchSupport.singleQuotesToJson(body)).jsonObject
            }.getOrNull()
        }

        private fun toItem(item: JsonObject): SonglistSearchItem? {
            val id = item.text("playlistid")
            if (id.isEmpty()) return null
            return SonglistSearchItem(
                id = id,
                name = SonglistSearchSupport.decodeName(item.text("name")),
                author = SonglistSearchSupport.decodeName(item.text("nickname")),
                playCount = SonglistSearchSupport.playCount(item["playcnt"].asLong() ?: 0L),
                total = item.text("songnum").toIntOrNull() ?: 0,
                img = SonglistSearchSupport.nullableText(item.text("pic")),
                desc = SonglistSearchSupport.decodeName(item.text("intro")),
                source = "kw",
            )
        }
    }
}
