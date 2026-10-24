package cn.toside.music.nativeapp.userapi

import cn.toside.music.core.userapi.ScriptFetchResponse
import cn.toside.music.core.userapi.ScriptFetcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL

/**
 * 更新检查用的 HTTP 取文本器 —— RN `userApiUpdate/index.ts` 里 `fetchText` 的移植。
 *
 * 作者把更新地址当成「给人用浏览器打开的页面」，有些站点对不像浏览器的请求直接回 403，
 * 所以 UA 固定成桌面 Chrome；也不能拿缓存里的旧版本，否则「已更新」会变成假话。
 */
class NativeScriptFetcher : ScriptFetcher {
    private companion object {
        const val TIMEOUT_MS = 15_000
        const val USER_AGENT =
            "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36"
    }

    override suspend fun fetch(url: String): ScriptFetchResponse =
        withContext(Dispatchers.IO) {
            val connection =
                (URL(url).openConnection() as HttpURLConnection).apply {
                    requestMethod = "GET"
                    connectTimeout = TIMEOUT_MS
                    readTimeout = TIMEOUT_MS
                    useCaches = false
                    setRequestProperty("User-Agent", USER_AGENT)
                    setRequestProperty("Cache-Control", "no-cache")
                }
            try {
                val status = connection.responseCode
                val ok = status in 200..299
                val stream = if (ok) connection.inputStream else connection.errorStream
                val body = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
                ScriptFetchResponse(ok = ok, status = status, body = body)
            } finally {
                connection.disconnect()
            }
        }
}
