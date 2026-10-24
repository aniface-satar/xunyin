package cn.toside.music.core.userapi

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDateTime
import java.time.ZoneOffset

/** 对照 RN `tests/user-api-update-resolve.mts` 逐条移植。 */
class ScriptResolverTest {
    private val script = "/**\n * @name 测试音源\n * @version v1.0.1\n * @description demo\n */\nuserApi.register.action(() => {})\n"

    private class FakeFetcher(
        private val routes: Map<String, Any>,
    ) : ScriptFetcher {
        val called = mutableListOf<String>()

        override suspend fun fetch(url: String): ScriptFetchResponse {
            called.add(url)
            return when (val body = routes[url]) {
                is Int -> ScriptFetchResponse(ok = false, status = body, body = "")
                is String -> ScriptFetchResponse(ok = true, status = 200, body = body)
                else -> ScriptFetchResponse(ok = false, status = 404, body = "not found")
            }
        }
    }

    private fun fakeRoutes(vararg entries: Pair<String, Any>): Map<String, Any> = entries.toMap()

    private fun resolve(
        url: String,
        routes: Map<String, Any>,
        hint: String? = null,
        currentVersion: String? = null,
    ): Pair<ScriptResolveResult, FakeFetcher> =
        runBlocking {
            val fetcher = FakeFetcher(routes)
            val result =
                ScriptResolver.resolveScriptFromUrl(
                    url,
                    ScriptResolveOptions(fetcher = fetcher, hint = hint, currentVersion = currentVersion),
                )
            result to fetcher
        }

    private fun expectFailure(result: ScriptResolveResult): ScriptResolveResult.Failure {
        assertTrue(result is ScriptResolveResult.Failure)
        return result as ScriptResolveResult.Failure
    }

    @Test
    fun directScriptIsFetchedOnce() {
        val (result, fetcher) =
            resolve(
                "https://a.example/src.js",
                fakeRoutes("https://a.example/src.js" to script),
            )
        assertTrue(result is ScriptResolveResult.Success)
        result as ScriptResolveResult.Success
        assertEquals(script, result.script)
        assertEquals("https://a.example/src.js", result.fromUrl)
        assertEquals(listOf("https://a.example/src.js"), fetcher.called)
    }

    @Test
    fun versionJsonLeadsToRelativeScriptUrl() {
        val (result, fetcher) =
            resolve(
                "https://api.example/releases?ver=v1.0.0",
                fakeRoutes(
                    "https://api.example/releases?ver=v1.0.0" to
                        "{\"code\":200,\"data\":{\"version\":\"v1.0.1\",\"url\":\"/dl/latest?format=lx\"}}",
                    "https://api.example/dl/latest?format=lx" to script,
                ),
            )
        assertTrue(result is ScriptResolveResult.Success)
        assertEquals(
            listOf("https://api.example/releases?ver=v1.0.0", "https://api.example/dl/latest?format=lx"),
            fetcher.called,
        )
    }

    @Test
    fun githubBlobPageIsRewrittenToRaw() {
        val page = "<html><body><a href=\"https://github.com/some/author/blob/main/source.js\">source.js</a></body></html>"
        val (result, _) =
            resolve(
                "https://github.com/some/author/blob/main/source.js",
                fakeRoutes(
                    "https://github.com/some/author/blob/main/source.js" to page,
                    "https://raw.githubusercontent.com/some/author/main/source.js" to script,
                ),
            )
        assertTrue(result is ScriptResolveResult.Success)
    }

    @Test
    fun triesNextCandidateWhenFirstIsNotAScript() {
        val page = "<a href=\"https://cdn.example/readme.js\">a</a><a href=\"https://cdn.example/real.js\">b</a>"
        val (result, fetcher) =
            resolve(
                "https://page.example/",
                fakeRoutes(
                    "https://page.example/" to page,
                    "https://cdn.example/readme.js" to "<html><body>not a script</body></html>",
                    "https://cdn.example/real.js" to script,
                ),
            )
        assertTrue(result is ScriptResolveResult.Success)
        assertEquals("https://cdn.example/real.js", fetcher.called.last())
    }

    @Test
    fun candidateMatchingSourceNameGoesFirst() {
        val page = "<a href=\"https://cdn.example/other.js\">a</a><a href=\"https://cdn.example/测试音源.js\">b</a>"
        val (result, fetcher) =
            resolve(
                "https://page.example/",
                fakeRoutes(
                    "https://page.example/" to page,
                    "https://cdn.example/测试音源.js" to script,
                    "https://cdn.example/other.js" to script,
                ),
                hint = "测试音源",
            )
        assertTrue(result is ScriptResolveResult.Success)
        assertEquals("https://cdn.example/测试音源.js", fetcher.called[1])
    }

    @Test
    fun pageWithoutAnyScriptLeadFailsClearly() {
        val (result, _) =
            resolve(
                "https://pan.example/share/abc",
                fakeRoutes(
                    "https://pan.example/share/abc" to
                        "<html><body><a href=\"/login\">登录后可见</a></body></html>",
                ),
            )
        assertEquals(ResolveFailureReason.NO_SCRIPT_LINK, expectFailure(result).reason)
    }

    @Test
    fun htmlPageWithBlockCommentIsNeverTreatedAsScript() {
        val page = "<html>\n<style>/* @name 页面样式 */</style>\n<body><p>最新版本请打开网盘</p></body>\n</html>"
        val (result, _) = resolve("https://page.example/", fakeRoutes("https://page.example/" to page))
        assertEquals(ResolveFailureReason.NO_SCRIPT_LINK, expectFailure(result).reason)
    }

    @Test
    fun thirdPartyLibraryWithBlockCommentIsNotAScript() {
        val zepto = "/* Zepto v1.1.6 - zepto event ajax form ie - zeptojs.com/license */\nvar Zepto = (function() {})\n"
        val page = "<html><body><a href=\"https://cdn.example/zepto.js\">zepto.js</a></body></html>"
        val (result, _) =
            resolve(
                "https://doc.example/update",
                fakeRoutes(
                    "https://doc.example/update" to page,
                    "https://cdn.example/zepto.js" to zepto,
                ),
            )
        assertEquals(ResolveFailureReason.NO_SCRIPT_LINK, expectFailure(result).reason)
    }

    @Test
    fun descriptorSurvivesWhenNoScriptFound() {
        val descriptor = "{\"version\":\"1.0.1\",\"updateUrl\":\"https://doc.example/update\",\"description\":\"x\"}"
        val page = "<html><body><a href=\"https://cdn.example/zepto.js\">zepto.js</a></body></html>"
        val zepto = "/* Zepto v1.1.6 - zeptojs.com/license */\nvar Zepto = (function() {})\n"
        val (result, _) =
            resolve(
                "https://api.example/check",
                fakeRoutes(
                    "https://api.example/check" to descriptor,
                    "https://doc.example/update" to page,
                    "https://cdn.example/zepto.js" to zepto,
                ),
            )
        val failure = expectFailure(result)
        assertEquals(ResolveFailureReason.NO_SCRIPT_LINK, failure.reason)
        assertEquals(VersionDescriptor("1.0.1", "https://doc.example/update"), failure.descriptor)
    }

    @Test
    fun latestDescriptorWithoutUrlStillRecognizesVersion() {
        val (result, _) =
            resolve(
                "https://api.example/check",
                fakeRoutes("https://api.example/check" to "{\"latest\":\"1.3.0\",\"log\":\"修复搜索\"}"),
            )
        val failure = expectFailure(result)
        assertEquals(VersionDescriptor("1.3.0", ""), failure.descriptor)
    }

    @Test
    fun olderDescriptorWithNoScriptStopsWithoutCrawling() {
        val descriptor = "{\"version\":\"1.0.1\",\"updateUrl\":\"https://doc.example/update\"}"
        val (result, fetcher) =
            resolve(
                "https://api.example/check",
                fakeRoutes(
                    "https://api.example/check" to descriptor,
                    "https://doc.example/update" to
                        "<html><body><a href=\"https://cdn.example/other.js\">other.js</a></body></html>",
                    "https://cdn.example/other.js" to script,
                ),
                currentVersion = "1.0.2",
            )
        val failure = expectFailure(result)
        assertEquals(ResolveFailureReason.NO_UPDATE, failure.reason)
        assertEquals(listOf("https://api.example/check"), fetcher.called)
        assertEquals(VersionDescriptor("1.0.1", "https://doc.example/update"), failure.descriptor)
    }

    @Test
    fun sameVersionButDirectScriptLinkIsStillFetched() {
        val (result, _) =
            resolve(
                "https://api.example/check",
                fakeRoutes(
                    "https://api.example/check" to "{\"version\":\"1.0.0\",\"updateUrl\":\"https://cdn.example/new.js\"}",
                    "https://cdn.example/new.js" to script,
                ),
                currentVersion = "1.0.0",
            )
        assertTrue(result is ScriptResolveResult.Success)
    }

    @Test
    fun jsLinksRankBeforeDocPages() {
        val page = "<a href=\"https://doc.example/readme\">a</a><a href=\"https://cdn.example/real.js\">b</a>"
        val (result, fetcher) =
            resolve(
                "https://page.example/",
                fakeRoutes(
                    "https://page.example/" to page,
                    "https://cdn.example/real.js" to script,
                    "https://doc.example/readme" to "<html><body>not a script</body></html>",
                ),
            )
        assertTrue(result is ScriptResolveResult.Success)
        assertEquals(listOf("https://page.example/", "https://cdn.example/real.js"), fetcher.called)
    }

    @Test
    fun stopsAtRequestBudget() {
        val routes = mutableMapOf<String, Any>()
        for (index in 0 until 40) {
            routes["https://loop.example/$index"] =
                "<html><a href=\"https://loop.example/${index + 1}\">next.js</a></html>"
        }
        val (result, fetcher) = resolve("https://loop.example/0", routes)
        assertEquals(ResolveFailureReason.BUDGET_EXCEEDED, expectFailure(result).reason)
        assertTrue(fetcher.called.size <= 8)
    }

    @Test
    fun alreadyLatestMessageMeansNoUpdate() {
        val routes =
            fakeRoutes(
                "https://api.example/check?ver=v1.2.0" to "{\"code\":0,\"msg\":\"已是最新版本\"}",
                "https://api.example/en?ver=1.2.0" to "{\"code\":0,\"msg\":\"Already up to date\"}",
            )
        for (url in routes.keys) {
            val (result, _) = resolve(url, routes)
            assertEquals(url, ResolveFailureReason.NO_UPDATE, expectFailure(result).reason)
        }
    }

    @Test
    fun code200WithNullDataMeansNoUpdate() {
        val (result, _) =
            resolve(
                "https://api.example/script/lxmusic?checkUpdate=abc",
                fakeRoutes(
                    "https://api.example/script/lxmusic?checkUpdate=abc" to "{\"code\":200,\"data\":null}",
                ),
            )
        assertEquals(ResolveFailureReason.NO_UPDATE, expectFailure(result).reason)
    }

    @Test
    fun nullUpdateUrlWithoutVersionMeansNoUpdate() {
        val (result, fetcher) =
            resolve(
                "https://api.example/lx/versionh2.php?ver=v3.2.15",
                fakeRoutes(
                    "https://api.example/lx/versionh2.php?ver=v3.2.15" to
                        "{\"message\":\"乱码\",\"update_url\":null,\"ip_query_url\":\"https://api.example/ip.php\"}",
                    "https://api.example/ip.php" to "{\"ip\":\"1.2.3.4\",\"country\":\"CN\"}",
                ),
                currentVersion = "v3.2.15",
            )
        assertEquals(ResolveFailureReason.NO_UPDATE, expectFailure(result).reason)
        assertEquals(listOf("https://api.example/lx/versionh2.php?ver=v3.2.15"), fetcher.called)
    }

    @Test
    fun alreadyLatestWithExtraQueryLinkStillMeansNoUpdate() {
        val (result, _) =
            resolve(
                "https://api.example/check",
                fakeRoutes(
                    "https://api.example/check" to
                        "{\"code\":0,\"msg\":\"已是最新版本\",\"status_url\":\"https://api.example/status\"}",
                    "https://api.example/status" to "<html><body>ok</body></html>",
                ),
            )
        assertEquals(ResolveFailureReason.NO_UPDATE, expectFailure(result).reason)
    }

    @Test
    fun versionWithEmptyUpdateUrlIsNotSwallowedByNoUpdateRule() {
        val (result, _) =
            resolve(
                "https://api.example/check",
                fakeRoutes("https://api.example/check" to "{\"version\":\"9.9.9\",\"update_url\":null}"),
                currentVersion = "1.0.0",
            )
        val failure = expectFailure(result)
        assertEquals(ResolveFailureReason.NO_SCRIPT_LINK, failure.reason)
        assertEquals(VersionDescriptor("9.9.9", ""), failure.descriptor)
    }

    @Test
    fun jsonWithoutAnyLeadStillReportsNoScriptLink() {
        val (result, _) =
            resolve(
                "https://api.example/check",
                fakeRoutes("https://api.example/check" to "{\"code\":500,\"msg\":\"server error\"}"),
            )
        assertEquals(ResolveFailureReason.NO_SCRIPT_LINK, expectFailure(result).reason)
    }

    @Test
    fun nonHttpUrlsAreNeverFetched() {
        val fetcher = FakeFetcher(emptyMap())
        for (url in listOf("javascript:alert(1)", "file:///data/x.js", "not-a-url", "")) {
            val result =
                runBlocking {
                    ScriptResolver.resolveScriptFromUrl(url, ScriptResolveOptions(fetcher = fetcher))
                }
            assertEquals(ResolveFailureReason.INVALID_URL, expectFailure(result).reason)
        }
        assertEquals(emptyList<String>(), fetcher.called)
    }

    @Test
    fun non2xxIsNetworkFailure() {
        val (result, _) = resolve("https://a.example/src.js", fakeRoutes("https://a.example/src.js" to 503))
        assertEquals(ResolveFailureReason.FETCH_FAILED, expectFailure(result).reason)
    }

    @Test
    fun matchHeaderCommentOnlyAtStart() {
        val expected = "/**\n * @name 测试音源\n * @version v1.0.1\n * @description demo\n */"
        assertEquals(expected, ScriptResolver.matchHeaderComment("\n\n$script"))
        assertEquals(expected, ScriptResolver.matchHeaderComment("\uFEFF$script"))
        assertNull(ScriptResolver.matchHeaderComment("<html>/* @name 页面样式 */</html>"))
    }

    @Test
    fun headerWithBomOrLeadingBlankIsParsed() {
        val body = ScriptResolver.parseScriptHeader("\uFEFF\n\n$script")
        assertEquals("测试音源", body?.name)
        assertEquals("v1.0.1", body?.version)
        val body2 =
            ScriptResolver.parseScriptHeader(
                "   /**\n * @name 空白起始\n * @updateUrl https://a.example/src.js\n */\n",
            )
        assertEquals("空白起始", body2?.name)
        assertEquals("https://a.example/src.js", body2?.updateUrl)
    }

    @Test
    fun buildTimeNeedsFullTimestamp() {
        val built =
            ScriptResolver.parseScriptHeader(
                "/**\n * @name a\n * @version 2026.10.20\n * 由生成器于 2026-10-20 19:00:02 自动生成\n */\n",
            )
        val expected = LocalDateTime.of(2026, 10, 20, 19, 0, 2).toInstant(ZoneOffset.UTC).toEpochMilli()
        assertEquals(expected, built?.buildTime)
        assertEquals(0L, ScriptResolver.parseScriptHeader(script)?.buildTime)
        val dateOnly =
            ScriptResolver.parseScriptHeader("/**\n * @name a\n * @version 1\n * @lastUpdate 2026-10-20\n */\n")
        assertEquals(0L, dateOnly?.buildTime)
    }

    @Test
    fun contentWithoutHeaderIsNotAScript() {
        assertNull(ScriptResolver.parseScriptHeader("<html><head><title>x</title></head></html>"))
        assertNull(ScriptResolver.parseScriptHeader(""))
    }

    @Test
    fun blockCommentMustBeAtTheStart() {
        assertNull(
            ScriptResolver.parseScriptHeader(
                "<html>\n<style>/* @name 页面样式 */</style>\n<body>x</body>\n</html>",
            ),
        )
        assertNull(ScriptResolver.parseScriptHeader("var a = 1\n/* @name 中途的注释 */\n"))
    }

    @Test
    fun updateUrlIsReadFromHeader() {
        val withUrl =
            ScriptResolver.parseScriptHeader(
                "/**\n * @name a\n * @updateUrl http://103.79.184.97/api/releases?script=a\n */\n",
            )
        assertEquals("http://103.79.184.97/api/releases?script=a", withUrl?.updateUrl)
        assertEquals("", ScriptResolver.parseScriptHeader("/**\n * @name a\n * @version v1\n */\n")?.updateUrl)
    }

    @Test
    fun snakeAndUpperUpdateUrlVariants() {
        val snake = ScriptResolver.parseScriptHeader("/**\n * @name a\n * @update_url https://a.example/src.js\n */\n")
        assertEquals("https://a.example/src.js", snake?.updateUrl)
        val upper = ScriptResolver.parseScriptHeader("/**\n * @name a\n * @UpdateUrl https://b.example/src.js\n */\n")
        assertEquals("https://b.example/src.js", upper?.updateUrl)
    }

    @Test
    fun updateNotesAreNotMistakenForUrl() {
        val body = ScriptResolver.parseScriptHeader("/**\n * @name a\n * @update 修复了搜索无结果的问题\n */\n")
        assertEquals("", body?.updateUrl)
    }
}
