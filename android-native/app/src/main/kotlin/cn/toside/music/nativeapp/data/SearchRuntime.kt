package cn.toside.music.nativeapp.data

import cn.toside.music.core.music.search.KgSearch
import cn.toside.music.core.music.search.KwSearch
import cn.toside.music.core.music.search.MgSearch
import cn.toside.music.core.music.search.SearchCoordinator
import cn.toside.music.core.music.search.SearchPage
import cn.toside.music.core.music.search.SearchRequest
import cn.toside.music.core.music.search.TxSearch
import cn.toside.music.core.music.search.WySearch
import cn.toside.music.core.music.search.album.AlbumDetail
import cn.toside.music.core.music.search.album.AlbumSearchCoordinator
import cn.toside.music.core.music.search.album.AlbumSearchPage
import cn.toside.music.core.music.search.album.KgAlbumSearch
import cn.toside.music.core.music.search.album.KwAlbumSearch
import cn.toside.music.core.music.search.album.MgAlbumSearch
import cn.toside.music.core.music.search.album.TxAlbumSearch
import cn.toside.music.core.music.search.album.WyAlbumSearch
import cn.toside.music.core.music.search.artist.ArtistDetail
import cn.toside.music.core.music.search.artist.ArtistItem
import cn.toside.music.core.music.search.artist.ArtistSearchCoordinator
import cn.toside.music.core.music.search.artist.ArtistSearchPage
import cn.toside.music.core.music.search.artist.KgArtistSearch
import cn.toside.music.core.music.search.artist.KwArtistSearch
import cn.toside.music.core.music.search.artist.MgArtistSearch
import cn.toside.music.core.music.search.artist.WyArtistSearch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * 搜索运行时（B5 第八切片）—— 五源 + 「全部」聚合的 app 侧组装。
 *
 * 可测的编排规则（缓存槽/代次/累计/并发聚合）在 `:core` [SearchCoordinator]，
 * 这里只注入两样东西：
 * - 传输：[SearchHttpTransport]（HttpURLConnection，IO 线程）；
 * - 解析器：kw/kg/tx/wy/mg 五个 `:core` 搜索器（自带签名与重试）。
 */
object SearchRuntime {
    /** 源 id 顺序与展示名（对照 RN `musicSdk/index.js` sources + i18n `source_real_*`）。 */
    val SOURCES: List<Pair<String, String>> =
        listOf(
            "kw" to "酷我音乐",
            "kg" to "酷狗音乐",
            "tx" to "企鹅音乐",
            "wy" to "网易音乐",
            "mg" to "咪咕音乐",
            "all" to "聚合搜索",
        )

    private val http = SearchHttpTransport()
    private val kw =
        KwSearch(
            fetch = { url: String -> http.fetch(SearchRequest(url = url)) },
        )
    private val kg =
        KgSearch(
            fetch = { request: SearchRequest -> http.fetch(request) },
        )
    private val tx =
        TxSearch(
            fetch = { request: SearchRequest -> http.fetch(request) },
        )
    private val wy =
        WySearch(
            fetch = { request: SearchRequest -> http.fetch(request) },
        )
    private val mg =
        MgSearch(
            fetch = { request: SearchRequest -> http.fetch(request) },
        )

    private val coordinator =
        SearchCoordinator(
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
     * 搜索（对照 RN `search(text, page, sourceId)`）。
     *
     * @return 累计后的整份列表；旧关键词的迟到响应返回 null
     */
    suspend fun search(
        keyword: String,
        page: Int = 1,
        source: String = "kw",
    ): SearchPage? = coordinator.search(keyword, page, source)

    /** 当前源是否已到底（RN `listInfos[source].maxPage <= page`）。 */
    fun reachedEnd(
        source: String,
        page: Int,
    ): Boolean = coordinator.reachedEnd(source, page)

    /** 清空某源缓存（RN `clearListInfo`）。 */
    fun clear(source: String) = coordinator.clear(source)
}

/**
 * 搜索类型维度 + 源能力（纯逻辑，供「类型 tab 状态与置灰规则」用例钉住）。
 *
 * 对照 RN `SearchTypeSelector` 的四档（music/songlist/album/artist）与
 * `store/search/artist/state.ts` 的 sources 收集规则：**只收真有该能力的源**。
 * 本车道 RN 快照五个源都没有 artist.js，tx 歌手搜索实测不可用（lane 报告留证），
 * 所以歌手类型禁用 tx；咪咕歌手只有搜索（无详情），详情可用性单独判断。
 */
object SearchTypes {
    const val MUSIC = "music"
    const val SONGLIST = "songlist"
    const val ALBUM = "album"
    const val ARTIST = "artist"

    val ALL: List<String> = listOf(MUSIC, SONGLIST, ALBUM, ARTIST)

    fun label(type: String): String =
        when (type) {
            MUSIC -> "歌曲"
            SONGLIST -> "歌单"
            ALBUM -> "专辑"
            ARTIST -> "歌手"
            else -> "歌曲"
        }

    /** 歌手类型真正可用的源（实测证据见 lane 报告；tx 缺席）。 */
    private val ARTIST_SOURCES = setOf("kw", "kg", "wy", "mg", "all")

    /** 该类型可用的源 id 集合。未知类型按全源处理（保守缺省）。 */
    fun enabledSources(type: String): Set<String> = if (type == ARTIST) ARTIST_SOURCES else SearchRuntime.SOURCES.map { it.first }.toSet()

    fun isSourceEnabled(
        type: String,
        source: String,
    ): Boolean = source in enabledSources(type)

    /** 切换类型后的有效源：当前源在该类型不可用则回落到 kw（tab 置灰时必须换源）。 */
    fun effectiveSource(
        type: String,
        current: String,
    ): String = if (isSourceEnabled(type, current)) current else "kw"
}

/**
 * 专辑搜索运行时 —— 五源 + 「全部」聚合（照 [SonglistSearchRuntime] 的形状：
 * 独立 object，缓存/代次与单曲/歌单互不干扰；编排规则在 `:core` [AlbumSearchCoordinator]）。
 */
object AlbumSearchRuntime {
    val SOURCES: List<Pair<String, String>> = SearchRuntime.SOURCES

    private val http = SearchHttpTransport()

    private val kw = KwAlbumSearch(fetch = { request: SearchRequest -> http.fetch(request) })
    private val kg = KgAlbumSearch(fetch = { request: SearchRequest -> http.fetch(request) })
    private val tx = TxAlbumSearch(fetch = { request: SearchRequest -> http.fetch(request) })
    private val wy = WyAlbumSearch(fetch = { request: SearchRequest -> http.fetch(request) })
    private val mg = MgAlbumSearch(fetch = { request: SearchRequest -> http.fetch(request) })

    private val coordinator =
        AlbumSearchCoordinator(
            sources =
                mapOf(
                    "kw" to { keyword: String, page: Int, limit: Int -> kw.search(keyword, page, limit) },
                    "kg" to { keyword: String, page: Int, limit: Int -> kg.search(keyword, page, limit) },
                    "tx" to { keyword: String, page: Int, limit: Int -> tx.search(keyword, page, limit) },
                    "wy" to { keyword: String, page: Int, limit: Int -> wy.search(keyword, page, limit) },
                    "mg" to { keyword: String, page: Int, limit: Int -> mg.search(keyword, page, limit) },
                ),
        )

    /** @return 累计后的整份列表；旧关键词的迟到响应返回 null。 */
    suspend fun search(
        keyword: String,
        page: Int = 1,
        source: String = "kw",
    ): AlbumSearchPage? = coordinator.search(keyword, page, source)

    fun reachedEnd(
        source: String,
        page: Int,
    ): Boolean = coordinator.reachedEnd(source, page)

    fun clear(source: String) = coordinator.clear(source)

    /** 专辑详情（曲目 + 头部信息）。 */
    suspend fun detail(
        source: String,
        id: String,
        page: Int = 1,
    ): AlbumDetail =
        when (source) {
            "kw" -> kw.detail(id, page)
            "kg" -> kg.detail(id, page)
            "tx" -> tx.detail(id, page)
            "wy" -> wy.detail(id, page)
            "mg" -> mg.detail(id, page)
            else -> error("album detail unsupported for source: $source")
        }
}

/**
 * 歌手搜索运行时 —— 四源（tx 实测缺席，lane 报告留证）+ 「全部」聚合。
 * 编排规则在 `:core` [ArtistSearchCoordinator]。
 */
object ArtistSearchRuntime {
    val SOURCES: List<Pair<String, String>> =
        SearchRuntime.SOURCES.filter { (id, _) -> SearchTypes.isSourceEnabled(SearchTypes.ARTIST, id) }

    private val http = SearchHttpTransport()

    private val kw = KwArtistSearch(fetch = { request: SearchRequest -> http.fetch(request) })
    private val kg = KgArtistSearch(fetch = { request: SearchRequest -> http.fetch(request) })
    private val wy = WyArtistSearch(fetch = { request: SearchRequest -> http.fetch(request) })
    private val mg = MgArtistSearch(fetch = { request: SearchRequest -> http.fetch(request) })

    private val coordinator =
        ArtistSearchCoordinator(
            sources =
                mapOf(
                    "kw" to { keyword: String, page: Int, limit: Int -> kw.search(keyword, page, limit) },
                    "kg" to { keyword: String, page: Int, limit: Int -> kg.search(keyword, page, limit) },
                    "wy" to { keyword: String, page: Int, limit: Int -> wy.search(keyword, page, limit) },
                    "mg" to { keyword: String, page: Int, limit: Int -> mg.search(keyword, page, limit) },
                ),
        )

    /** @return 累计后的整份列表；旧关键词的迟到响应返回 null。 */
    suspend fun search(
        keyword: String,
        page: Int = 1,
        source: String = "kw",
    ): ArtistSearchPage? = coordinator.search(keyword, page, source)

    fun reachedEnd(
        source: String,
        page: Int,
    ): Boolean = coordinator.reachedEnd(source, page)

    fun clear(source: String) = coordinator.clear(source)

    /** 咪咕歌手只有搜索（详情接口无真实响应证据，lane 报告留证），不可打开详情。 */
    fun canOpenDetail(source: String): Boolean = source in setOf("kw", "kg", "wy")

    /** 歌手详情：信息 + 热歌第一页 + 专辑第一页。 */
    suspend fun detail(
        source: String,
        artist: ArtistItem,
    ): ArtistDetail =
        when (source) {
            "kw" -> kw.detail(artist)
            "kg" -> kg.detail(artist)
            "wy" -> wy.detail(artist)
            else -> error("artist detail unsupported for source: $source")
        }
}

/** 搜索传输层：`HttpURLConnection` 执行 [SearchRequest]，IO 线程跑。 */
class SearchHttpTransport {
    suspend fun fetch(request: SearchRequest): String = withContext(Dispatchers.IO) { execute(request) }

    private fun execute(request: SearchRequest): String {
        val connection =
            java.net.URI
                .create(request.url)
                .toURL()
                .openConnection() as java.net.HttpURLConnection
        connection.connectTimeout = CONNECT_TIMEOUT_MS
        connection.readTimeout = READ_TIMEOUT_MS
        try {
            val method = request.method.uppercase()
            connection.requestMethod = method
            val hasBody =
                (request.body != null || request.form != null) && method !in setOf("GET", "HEAD")
            // 请求头优先（wy 的 origin、tx 的 QQMusic UA 都来自请求描述），缺省补桌面 UA
            var hasUserAgent = false
            request.headers.forEach { (name, value) ->
                connection.setRequestProperty(name, value)
                if (name.equals("User-Agent", ignoreCase = true)) hasUserAgent = true
            }
            if (!hasUserAgent) connection.setRequestProperty("User-Agent", DESKTOP_UA)
            if (hasBody) {
                val body = request.body
                val form = request.form
                val bytes: ByteArray =
                    if (body != null) {
                        if (request.headers.keys.none { it.equals("Content-Type", ignoreCase = true) }) {
                            connection.setRequestProperty("Content-Type", "application/json")
                        }
                        body.toByteArray(Charsets.UTF_8)
                    } else {
                        checkNotNull(form)
                        connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
                        form.entries
                            .joinToString("&") { (name, value) -> "${encode(name)}=${encode(value)}" }
                            .toByteArray(Charsets.UTF_8)
                    }
                connection.doOutput = true
                connection.outputStream.use { it.write(bytes) }
            }
            val code = connection.responseCode
            check(code in 200..299) { "HTTP $code" }
            return connection.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
        } finally {
            connection.disconnect()
        }
    }

    private fun encode(value: String): String =
        java.net.URLEncoder
            .encode(value, "UTF-8")
            .replace("+", "%20")

    private companion object {
        const val CONNECT_TIMEOUT_MS = 10_000
        const val READ_TIMEOUT_MS = 15_000
        const val DESKTOP_UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
                "Chrome/126.0.0.0 Safari/537.36"
    }
}
