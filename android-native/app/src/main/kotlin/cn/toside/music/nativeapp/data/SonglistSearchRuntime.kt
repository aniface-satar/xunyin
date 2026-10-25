package cn.toside.music.nativeapp.data

import cn.toside.music.core.music.search.KgSonglistSearch
import cn.toside.music.core.music.search.KwSonglistSearch
import cn.toside.music.core.music.search.MgSonglistSearch
import cn.toside.music.core.music.search.SearchRequest
import cn.toside.music.core.music.search.SonglistSearchCoordinator
import cn.toside.music.core.music.search.SonglistSearchPage
import cn.toside.music.core.music.search.TxSonglistSearch
import cn.toside.music.core.music.search.WySonglistSearch

/**
 * 歌单搜索运行时（S12）—— 五源 + 「全部」聚合的 app 侧组装。
 *
 * 与单曲搜索分成两个 object，避免两套缓存/代次互相干扰（任务书建议）。
 * 编排规则在 `:core` [SonglistSearchCoordinator]，这里只注入传输与五个解析器。
 */
object SonglistSearchRuntime {
    /** 源顺序与展示名与单曲搜索一致（含「全部」聚合）。 */
    val SOURCES: List<Pair<String, String>> = SearchRuntime.SOURCES

    private val http = SearchHttpTransport()

    private val kw = KwSonglistSearch(fetch = { request: SearchRequest -> http.fetch(request) })
    private val kg = KgSonglistSearch(fetch = { request: SearchRequest -> http.fetch(request) })
    private val tx = TxSonglistSearch(fetch = { request: SearchRequest -> http.fetch(request) })
    private val wy = WySonglistSearch(fetch = { request: SearchRequest -> http.fetch(request) })
    private val mg = MgSonglistSearch(fetch = { request: SearchRequest -> http.fetch(request) })

    private val coordinator =
        SonglistSearchCoordinator(
            sources =
                mapOf(
                    "kw" to { keyword: String, page: Int, limit: Int -> kw.search(keyword, page, limit) },
                    "kg" to { keyword: String, page: Int, limit: Int -> kg.search(keyword, page, limit) },
                    "tx" to { keyword: String, page: Int, limit: Int -> tx.search(keyword, page, limit) },
                    "wy" to { keyword: String, page: Int, limit: Int -> wy.search(keyword, page, limit) },
                    "mg" to { keyword: String, page: Int, limit: Int -> mg.search(keyword, page, limit) },
                ),
        )

    /**
     * 搜索（对照 RN `core/search/songlist.ts#search`）。
     *
     * @return 累计后的整份列表；旧关键词的迟到响应返回 null
     */
    suspend fun search(
        keyword: String,
        page: Int = 1,
        source: String = "kw",
    ): SonglistSearchPage? = coordinator.search(keyword, page, source)

    /** 当前源是否已到底（RN `maxPages[source] <= page`）。 */
    fun reachedEnd(
        source: String,
        page: Int,
    ): Boolean = coordinator.reachedEnd(source, page)

    /** 清空某源缓存（RN `clearListInfo`）。 */
    fun clear(source: String) = coordinator.clear(source)
}
