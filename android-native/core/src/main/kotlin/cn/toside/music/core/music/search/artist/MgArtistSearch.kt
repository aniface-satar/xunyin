package cn.toside.music.core.music.search.artist

import cn.toside.music.core.music.search.SearchDetailSupport
import cn.toside.music.core.music.search.SearchRequest
import cn.toside.music.core.music.search.text
import cn.toside.music.core.songlist.asArray
import cn.toside.music.core.songlist.text
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject

/**
 * 咪咕歌手搜索。
 *
 * **只实现 search**：本仓库 RN 快照没有 mg artist 模块，详情接口（信息/热歌/专辑）
 * 无真实响应证据，按任务书「宁可少做」原则不实现（app 侧对 mg 歌手行禁点并提示，
 * 见 lane 报告能力矩阵）。
 *
 * 搜索复用 `jadeite searchAll`（与歌单/专辑搜索同端点同签名，`searchSwitch`
 * 打开 `singer`），响应走 `singerResultData`，`totalCount` 是**字符串**。
 */
class MgArtistSearch(
    private val fetch: suspend (SearchRequest) -> String,
    private val clock: () -> String = { System.currentTimeMillis().toString() },
) {
    suspend fun search(
        keyword: String,
        page: Int = 1,
        limit: Int = DEFAULT_LIMIT,
    ): ArtistSearchPage =
        checkNotNull(parseSearch(fetch(buildSearchRequest(keyword, page, limit, clock())), page, limit)) {
            "mg artist search failed"
        }

    companion object {
        const val DEFAULT_LIMIT = ArtistSearchAggregator.SOURCE_LIMIT
        private val json = SearchDetailSupport.json

        fun buildSearchRequest(
            keyword: String,
            page: Int,
            limit: Int,
            time: String,
        ): SearchRequest =
            SearchDetailSupport.mgSearchAllRequest(
                keyword = keyword,
                page = page,
                limit = limit,
                time = time,
                switches = mapOf("singer" to 1),
            )

        fun parseSearch(
            body: String,
            page: Int,
            limit: Int,
        ): ArtistSearchPage? {
            val root = runCatching { json.parseToJsonElement(body).jsonObject }.getOrNull() ?: return null
            if (root["code"].text() != "000000") return null
            val data = root["singerResultData"] as? JsonObject ?: return null
            val total = data["totalCount"].text().toIntOrNull() ?: 0
            val list =
                data["result"].asArray().mapNotNull { element ->
                    val item = element as? JsonObject ?: return@mapNotNull null
                    toArtistItem(item)
                }
            return ArtistSearchPage(
                list = list,
                total = total,
                allPage = if (total == 0) 0 else (total + limit - 1) / limit,
                limit = limit,
                source = "mg",
            )
        }

        private fun toArtistItem(item: JsonObject): ArtistItem? {
            val id = item.text("id")
            if (id.isEmpty()) return null
            return ArtistItem(
                id = id,
                name = item.text("name"),
                picUrl = (item["singerPicUrl"].asArray().firstOrNull() as? JsonObject)?.get("img").text().ifEmpty { null },
                albumCount = item.text("albumCount").toIntOrNull() ?: 0,
                musicCount = item.text("songCount").toIntOrNull() ?: 0,
                source = "mg",
            )
        }
    }
}
