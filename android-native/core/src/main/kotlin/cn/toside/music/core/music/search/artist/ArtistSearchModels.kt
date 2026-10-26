package cn.toside.music.core.music.search.artist

import kotlinx.serialization.json.JsonObject

/**
 * 歌手搜索结果项。
 *
 * 本仓库 RN 快照没有 artist 模块（`*Normalizers.ts` 不存在，见 lane 报告），
 * 字段形状按任务书建议 + 各源真实响应 fixture 能给到的字段钉住：
 * 别名（wy `alias`）、专辑数/歌曲数（kw `ALBUMNUM`/`SONGNUM`、kg info、wy
 * `albumSize`/`musicSize`、mg `albumCount`/`songCount`）缺省一律空串/0，不抛错。
 */
data class ArtistItem(
    val id: String,
    val name: String,
    val picUrl: String? = null,
    val alias: String = "",
    val albumCount: Int = 0,
    val musicCount: Int = 0,
    val source: String,
)

/** 单源/聚合的歌手搜索一页结果。 */
data class ArtistSearchPage(
    val list: List<ArtistItem>,
    val total: Int,
    val allPage: Int,
    val limit: Int,
    val source: String,
)

/**
 * 歌手详情：信息 + 热歌第一页 + 专辑第一页。
 *
 * 歌曲复用既有 JsonObject 音乐项形状；专辑复用 [cn.toside.music.core.music.search.album.AlbumItem]。
 * kw 的歌手信息接口（www API）需要 token，详情头部用搜索行数据兜底（见 lane 报告）。
 */
data class ArtistDetail(
    val info: ArtistItem,
    val songs: List<JsonObject>,
    val albums: List<cn.toside.music.core.music.search.album.AlbumItem>,
)
