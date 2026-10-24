package cn.toside.music.nativeapp.data

import cn.toside.music.core.music.leaderboard.BoardItem
import cn.toside.music.core.music.leaderboard.BoardList
import cn.toside.music.core.music.leaderboard.BoardPager
import cn.toside.music.core.music.leaderboard.KgLeaderboard
import cn.toside.music.core.music.leaderboard.KwLeaderboard
import cn.toside.music.core.music.leaderboard.LEADERBOARD_BOARDS
import cn.toside.music.core.music.leaderboard.LeaderboardSource
import cn.toside.music.core.music.leaderboard.MgLeaderboard
import cn.toside.music.core.music.leaderboard.TxLeaderboard
import cn.toside.music.core.music.leaderboard.WyLeaderboard
import cn.toside.music.core.music.search.SearchRequest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URI

/**
 * 排行榜运行时（B5 第九切片 + Wave1 Lane A 收口）—— 发现页「排行榜」的内容接线。
 *
 * - 榜单清单：五源静态表（RN getBoards 已固定为本地清单）；
 * - 榜单详情：kw/kg/tx/wy/mg 全部实现——tx 走 HTML period 抓取 + musicu.fcg
 *   GetDetail、wy 走 weapi playlist detail + song detail 两段、mg 走
 *   querycontentbyId + filterMusicInfoList（对照 RN 各源 leaderboard.js）；
 * - 展示分页：`BoardPager`（RN getListLimit 的 30 条本地分页规则）；
 * - 播放：RN `Leaderboard.listAction.handlePlay` —— 先把榜单页写入临时列表
 *   并从 TEMP 起播（`ListStore.listMusicOverwrite` + `playListById`），
 *   整榜拉全后在后台覆盖（RN 的 getListDetailAll 分支）。
 */
object LeaderboardRuntime {
    /** 有榜单详情能力的源（五源均已接入）。 */
    val DETAIL_SOURCES = setOf("kw", "kg", "tx", "wy", "mg")

    fun boards(source: String): List<BoardItem> = LEADERBOARD_BOARDS[source].orEmpty()

    fun board(
        source: String,
        id: String,
    ): BoardItem? = boards(source).firstOrNull { it.id == id }

    private val http = Http()
    private val searchHttp = SearchHttpTransport()
    private val sources: Map<String, LeaderboardSource> =
        mapOf(
            "kw" to KwLeaderboard(fetch = { url -> http.get(url) }),
            "kg" to KgLeaderboard(fetch = { url -> http.get(url) }),
            "tx" to
                TxLeaderboard(
                    fetch = { request: SearchRequest -> searchHttp.fetch(request) },
                ),
            "wy" to
                WyLeaderboard(
                    fetch = { request: SearchRequest -> searchHttp.fetch(request) },
                ),
            "mg" to
                MgLeaderboard(
                    fetch = { url -> http.get(url) },
                ),
        )

    /** 每源一个 BoardPager（缓存按榜分隔）。 */
    private val pagers = HashMap<String, BoardPager>()

    fun pager(id: String): BoardPager =
        pagers.getOrPut(id) {
            val (source, bangid) = splitId(id)
            val leaderboard =
                checkNotNull(sources[source]) { "source not found: $source" }
            BoardPager { _, sourcePage -> leaderboard.getList(bangid, sourcePage) }
        }

    /** 榜单详情展示页（30 条/页，本地分页缓存）。 */
    suspend fun getListDetail(
        id: String,
        page: Int,
        isRefresh: Boolean = false,
    ): BoardList = pager(id).getListDetail(id, page, isRefresh)

    /** 整榜歌曲（「播放全部」/ 点播后补全列表用）。 */
    suspend fun getListDetailAll(id: String): List<kotlinx.serialization.json.JsonObject> = pager(id).getListDetailAll(id)

    fun reachedEnd(
        id: String,
        page: Int,
    ): Boolean = pager(id).reachedEnd(id, page)

    fun isDetailSupported(source: String): Boolean = source in DETAIL_SOURCES

    private fun splitId(id: String): Pair<String, String> = id.split("__", limit = 2).let { it[0] to it.getOrElse(1) { "" } }

    private class Http {
        suspend fun get(url: String): String =
            withContext(Dispatchers.IO) {
                val connection = URI.create(url).toURL().openConnection() as HttpURLConnection
                connection.connectTimeout = 10_000
                connection.readTimeout = 15_000
                connection.setRequestProperty("User-Agent", DESKTOP_UA)
                try {
                    val code = connection.responseCode
                    check(code in 200..299) { "HTTP $code" }
                    connection.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
                } finally {
                    connection.disconnect()
                }
            }

        private companion object {
            const val DESKTOP_UA =
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
                    "Chrome/126.0.0.0 Safari/537.36"
        }
    }
}
