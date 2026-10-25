package cn.toside.music.nativeapp.data

import cn.toside.music.core.music.search.SearchRequest
import cn.toside.music.core.recommend.PlaylistRank
import cn.toside.music.core.recommend.RecommendProfile
import cn.toside.music.core.songlist.KgSonglist
import cn.toside.music.core.songlist.KwSonglist
import cn.toside.music.core.songlist.MgSonglist
import cn.toside.music.core.songlist.PlaylistItem
import cn.toside.music.core.songlist.RecommendBoard
import cn.toside.music.core.songlist.RecommendSelection
import cn.toside.music.core.songlist.SonglistDetail
import cn.toside.music.core.songlist.SonglistDetailPager
import cn.toside.music.core.songlist.SonglistPage
import cn.toside.music.core.songlist.SonglistRequest
import cn.toside.music.core.songlist.SonglistSort
import cn.toside.music.core.songlist.SonglistSource
import cn.toside.music.core.songlist.SonglistTags
import cn.toside.music.core.songlist.Songlists
import cn.toside.music.core.songlist.TxSonglist
import cn.toside.music.core.songlist.WySonglist
import kotlinx.serialization.json.JsonObject

/**
 * 在线歌单运行时（Wave2 Lane A）—— 发现页「歌单」面板与歌单详情页的内容接线。
 *
 * 可测的解析与分页规则都在 `:core` `cn.toside.music.core.songlist`，这里只做三件事：
 * - 传输：复用 [SearchHttpTransport]（`HttpURLConnection`，IO 线程，GET/POST 表单与
 *   请求头、`wy` 的 cookie 都来自各源构造的 [SonglistRequest]）；
 * - 缓存：标签按源、列表按 `源/排序/标签/页`、详情分页按 `源/id` 记账
 *   （对照 RN `core/songlist.ts` 的 `cache` Map）；
 * - 对外形状对齐 [LeaderboardRuntime]：`sorts/getListDetail/getDetailAll/reachedEnd`。
 */
object SonglistRuntime {
    /** 源顺序与展示名（与搜索/排行榜一致；RN 的 bd 不在移植范围）。 */
    val SOURCES: List<Pair<String, String>> = Songlists.SOURCES

    private val http = SearchHttpTransport()

    private suspend fun fetch(request: SonglistRequest): String =
        http.fetch(
            SearchRequest(
                url = request.url,
                method = request.method,
                headers = request.headers,
                body = request.body,
                form = request.form,
            ),
        )

    private val sources: Map<String, SonglistSource> =
        mapOf(
            "kw" to KwSonglist(fetch = ::fetch),
            "kg" to KgSonglist(fetch = ::fetch),
            "tx" to TxSonglist(fetch = ::fetch),
            "wy" to WySonglist(fetch = ::fetch),
            "mg" to MgSonglist(fetch = ::fetch),
        )

    private fun source(source: String): SonglistSource = checkNotNull(sources[source]) { "source not found: $source" }

    fun isSupported(source: String): Boolean = source in sources

    /** 排序项（RN `getSortList(source)`；mutableListOf 之外无状态）。 */
    fun sorts(source: String): List<SonglistSort> = sources[source]?.sorts.orEmpty()

    fun sort(
        source: String,
        sortId: String,
    ): SonglistSort? = sorts(source).firstOrNull { it.id == sortId }

    private val tagsCache = HashMap<String, SonglistTags>()

    /** 标签清单（RN `getTags`：按源缓存，失败抛给调用方重试）。 */
    suspend fun getTags(
        source: String,
        isRefresh: Boolean = false,
    ): SonglistTags {
        if (isRefresh) tagsCache.remove(source)
        tagsCache[source]?.let { return it }
        return source(source).getTags().also { tagsCache[source] = it }
    }

    /** 列表分页缓存键（RN `slist__${source}__${sortId}__${tabId}__${page}`）。 */
    private val listCache = HashMap<String, SonglistPage>()

    private fun listKey(
        source: String,
        sortId: String,
        tagId: String?,
        page: Int,
    ): String = "slist__${source}__${sortId}__${tagId.orEmpty()}__$page"

    /**
     * 歌单列表一页（RN `getList`：命中缓存直接返回；`isRefresh` 只丢当前页）。
     *
     * `tagId = null` 对应 RN 的「全部」分类（酷狗推荐、咪咕推荐等不传标签）。
     */
    suspend fun getList(
        source: String,
        sortId: String,
        tagId: String?,
        page: Int = 1,
        isRefresh: Boolean = false,
    ): SonglistPage {
        val key = listKey(source, sortId, tagId, page)
        if (isRefresh) listCache.remove(key) else listCache[key]?.let { return it }
        return source(source).getList(sortId, tagId, page).also { listCache[key] = it }
    }

    /**
     * 列表是否到底（RN `maxPage <= page`）。
     *
     * total 取法对照 RN `songlistActions.setList`：第 1 页或本轮有数据且有 total 时用
     * 返回值；翻页拿到空页/无 total 时按 `limit * page` 兜底。
     */
    fun reachedEnd(
        page: SonglistPage,
        currentPage: Int,
    ): Boolean {
        val total =
            if (currentPage == 1 || (page.total > 0 && page.list.isNotEmpty())) {
                page.total
            } else {
                page.limit * currentPage
            }
        if (total <= 0) return true
        val limit = if (page.limit > 0) page.limit else Songlists.LIST_LOAD_LIMIT
        val maxPage = (total + limit - 1) / limit
        return maxPage <= currentPage
    }

    /** 每份歌单一个详情分页器（缓存按 `源 + id` 分隔）。 */
    private val pagers = HashMap<String, SonglistDetailPager>()

    private fun pager(
        source: String,
        id: String,
    ): SonglistDetailPager {
        val key = "${source}__$id"
        return pagers.getOrPut(key) {
            val songlist = source(source)
            SonglistDetailPager { rawId, sourcePage -> songlist.getDetail(rawId, sourcePage) }
        }
    }

    /** 详情展示页（30 条/页，本地分页缓存；RN `getListDetail`）。 */
    suspend fun getListDetail(
        source: String,
        id: String,
        page: Int,
        isRefresh: Boolean = false,
    ): SonglistDetail = pager(source, id).getDetail(id, page, isRefresh)

    /** 整单歌曲（「播放全部」/ 起播后补全队列；RN `getListDetailAll`）。 */
    suspend fun getListDetailAll(
        source: String,
        id: String,
    ): List<JsonObject> = pager(source, id).getDetailAll(id)

    fun reachedEnd(
        source: String,
        id: String,
        page: Int,
    ): Boolean = pager(source, id).reachedEnd(id, page)

    /** 列表项按 id 查找（详情页标题回退用；找不到返回 null）。 */
    suspend fun findPlaylist(
        source: String,
        sortId: String,
        tagId: String?,
        page: Int,
        id: String,
    ): PlaylistItem? = getList(source, sortId, tagId, page).list.firstOrNull { it.id == id }
}

/** 推荐歌单区块的一次取数结果（分类 + 首屏卡片）。 */
data class CuratedPlaylists(
    val source: String,
    val sortId: String,
    val tagId: String,
    val tagName: String,
    val list: List<PlaylistItem>,
)

/** 新歌速递区块的一次取数结果（榜单 + 前几首）。 */
data class CuratedNewSongs(
    val source: String,
    val boardId: String,
    val boardName: String,
    val tracks: List<JsonObject>,
)

/**
 * 发现页「推荐」的官方内容通道（Wave2 Lane A）—— 只移植 RN 推荐里
 * **不依赖个性化引擎**的部分，冷启动等价行为：
 *
 * - 推荐歌单：五源分类目录里挑「最热」排序 + 轮次游走的分类，取第一页；
 * - 新歌速递：五源静态榜单里挑新歌榜（无则飙升榜），取榜首屏前几首。
 *
 * 画像（artistStats/tokenWeights/主题权重/踩雷/隐藏歌单）与 bandit/audioEmbedding/
 * melSpectrogram 引擎本波不移植；取不到内容时返回 null，由界面展示空态，
 * 不造 RN 没有的假数据。RN 的随机源/随机起点在这里改为轮次轮换（可复现）。
 */
object RecommendRuntime {
    private const val MAX_BOARD_ATTEMPTS = 3
    private const val PLAYLIST_COUNT = 6
    private const val NEW_SONG_COUNT = 3

    private var playlistRotation = 0

    /** 推荐歌单：按源轮换尝试，某源目录/列表拿不到就换下一个源。 */
    suspend fun getCuratedPlaylists(
        count: Int = PLAYLIST_COUNT,
        isRefresh: Boolean = false,
    ): CuratedPlaylists? {
        val sources = SonglistRuntime.SOURCES.map { it.first }
        if (sources.isEmpty()) return null
        // 画像重排（M1）：只调顺序，不换源也不改取数；读不到画像时保持原序。
        val now = System.currentTimeMillis()
        val profile = runCatching { RecommendProfileRuntime.load(now, refresh = isRefresh) }.getOrNull()
        val start = Math.floorMod(playlistRotation, sources.size)
        playlistRotation++
        for (offset in sources.indices) {
            val source = sources[(start + offset) % sources.size]
            val result =
                runCatching {
                    val tags = SonglistRuntime.getTags(source, isRefresh)
                    val catalogue = RecommendSelection.flattenTags(tags)
                    val tag =
                        if (profile != null && profile.keywords.isNotEmpty()) {
                            PlaylistRank.pickPlaylistTag(
                                catalogue,
                                { it.name },
                                emptyMap(),
                                profile.keywords,
                                playlistRotation + offset,
                                now,
                            )
                        } else {
                            RecommendSelection.pickTag(catalogue, playlistRotation + offset)
                        } ?: return@runCatching null
                    val sort = RecommendSelection.pickHotSort(SonglistRuntime.sorts(source)) ?: return@runCatching null
                    val page = SonglistRuntime.getList(source, sort.id, tag.id, 1, isRefresh)
                    if (page.list.isEmpty()) {
                        null
                    } else {
                        val ordered =
                            if (profile == null) {
                                page.list
                            } else {
                                PlaylistRank.rankPlaylistsByProfile(
                                    page.list,
                                    { it.name },
                                    { it.author },
                                    { it.source to it.id },
                                    RecommendProfile.rankState(profile),
                                    now,
                                )
                            }
                        CuratedPlaylists(source, sort.id, tag.id, tag.name, ordered.take(count))
                    }
                }.getOrNull()
            if (result != null) return result
        }
        return null
    }

    /** 新歌速递：候选榜前 3 张里取第一张能拉到歌的（RN 的 skipped 重试分支）。 */
    suspend fun getCuratedNewSongs(count: Int = NEW_SONG_COUNT): CuratedNewSongs? {
        val boards =
            SonglistRuntime.SOURCES
                .map { it.first }
                .flatMap { source -> LeaderboardRuntime.boards(source).map { RecommendBoard(source, it.id, it.name) } }
        // 画像重排（M1）：榜单取数不变，只把前几首按歌手先验/词面学习排一遍。
        val now = System.currentTimeMillis()
        val profile = runCatching { RecommendProfileRuntime.load(now) }.getOrNull()
        for (board in RecommendSelection.newSongBoardCandidates(boards).take(MAX_BOARD_ATTEMPTS)) {
            val tracks = runCatching { LeaderboardRuntime.getListDetail(board.id, 1).list }.getOrNull().orEmpty()
            if (tracks.isNotEmpty()) {
                val ordered =
                    if (profile == null) {
                        tracks
                    } else {
                        PlaylistRank.rankTracksByProfile<JsonObject>(
                            tracks,
                            { it.recommendText("name") },
                            { it.recommendText("singer") },
                            RecommendProfile.factorState(profile),
                            now,
                        )
                    }
                return CuratedNewSongs(board.source, board.id, board.name, ordered.take(count))
            }
        }
        return null
    }

    /** 曲目顶层文本字段（与 PlayerRuntime 的私有读取同语义，避免跨文件可见性调整）。 */
    private fun JsonObject.recommendText(key: String): String? =
        (this[key] as? kotlinx.serialization.json.JsonPrimitive)
            ?.takeIf { it !is kotlinx.serialization.json.JsonNull }
            ?.content
}
