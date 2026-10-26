package cn.toside.music.core.music.search.album

import kotlinx.serialization.json.JsonObject

/**
 * 专辑搜索结果项。
 *
 * 字段来源见 lane 报告的五源映射表；各源能给的字段不同（例如 kw 的专辑搜索
 * 没有 `total`、mg 的专辑搜索没有歌手 id），缺省一律用空串/null/0，不抛错。
 */
data class AlbumItem(
    val id: String,
    val name: String,
    val singer: String = "",
    val picUrl: String? = null,
    val publishTime: String? = null,
    val songCount: Int = 0,
    val source: String,
)

/** 单源/聚合的专辑搜索一页结果。 */
data class AlbumSearchPage(
    val list: List<AlbumItem>,
    val total: Int,
    val allPage: Int,
    val limit: Int,
    val source: String,
)

/**
 * 专辑详情：信息 + 曲目。
 *
 * 曲目是既有 `JsonObject` 音乐项形状（与 `SearchModels.SearchPage.list` 同构），
 * 可直接写入试听列表交给 PlayerCore。
 */
data class AlbumDetail(
    val info: AlbumItem,
    val songs: List<JsonObject>,
    val total: Int,
    val page: Int,
    val limit: Int,
) {
    val allPage: Int
        get() = if (total == 0 || limit <= 0) 1 else (total + limit - 1) / limit
}
