package cn.toside.music.nativeapp.data

import cn.toside.music.core.music.search.KgSearch
import cn.toside.music.core.music.search.KwSearch
import cn.toside.music.core.music.search.MgSearch
import cn.toside.music.core.music.search.SearchCoordinator
import cn.toside.music.core.music.search.SearchPage
import cn.toside.music.core.music.search.SearchRequest
import cn.toside.music.core.music.search.TxSearch
import cn.toside.music.core.music.search.WySearch
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
