package cn.toside.music.core.userapi

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** 对照 RN `previewUserApiUpdateOnce` 的多地址编排语义。 */
class UpdateCheckTest {
    private val name = "落雪云更新音源(实测)"

    private fun header(
        headerName: String,
        version: String,
    ): String = "/**\n * @name $headerName\n * @version $version\n */\nuserApi.register.action(() => {})\n"

    private val old = header(name, "2026.10.18")
    private val new = header(name, "2026.10.20")

    private val primaryUrl = "https://a.example/src.js"
    private val fallbackUrl = "https://fallback.example/src.js"

    private val onlineCatalog =
        BuiltinUpdateCatalog { id ->
            if (id == "builtin_x") {
                BuiltinUpdateCatalogEntry(
                    kind = "online",
                    updateUrl = primaryUrl,
                    fallbackUpdateUrls = listOf(fallbackUrl),
                )
            } else {
                null
            }
        }

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

    private fun request(
        storedScript: String = old,
        updateUrl: String = primaryUrl,
        scriptUpdateUrl: String = "",
        builtinKind: String? = null,
        eventUrl: String? = null,
        overrideUrl: String? = null,
        scheduled: Boolean = false,
    ): UpdateCheckRequest =
        UpdateCheckRequest(
            name = name,
            storedScript = storedScript,
            source =
                UpdateUrlSource(
                    id = if (builtinKind != null) "builtin_x" else "user_api_x",
                    builtinKind = builtinKind,
                    updateUrl = updateUrl,
                    scriptUpdateUrl = scriptUpdateUrl,
                ),
            eventUrl = eventUrl,
            overrideUrl = overrideUrl,
            scheduled = scheduled,
        )

    private fun check(
        request: UpdateCheckRequest,
        routes: Map<String, Any>,
        catalog: BuiltinUpdateCatalog = onlineCatalog,
        syntaxChecker: ScriptSyntaxChecker = ScriptSyntaxChecker { null },
    ): Pair<UpdatePreview, FakeFetcher> =
        runBlocking {
            val fetcher = FakeFetcher(routes)
            val preview = UpdateCheck.preview(request, fetcher, catalog, syntaxChecker)
            preview to fetcher
        }

    @Test
    fun newerPrimaryResultStopsBeforeFallback() {
        val (preview, fetcher) =
            check(
                request(builtinKind = "online"),
                mapOf(primaryUrl to new, fallbackUrl to new),
            )
        assertTrue(preview is UpdatePreview.Available)
        assertEquals(listOf(primaryUrl), fetcher.called)
    }

    @Test
    fun primaryFailureFallsBackToCatalogMirror() {
        val (preview, fetcher) =
            check(
                request(builtinKind = "online"),
                mapOf(primaryUrl to 503, fallbackUrl to new),
            )
        assertTrue(preview is UpdatePreview.Available)
        assertEquals(listOf(primaryUrl, fallbackUrl), fetcher.called)
    }

    @Test
    fun descriptorOnlyPageAsksUserToOpenIt() {
        val page = "https://page.example/update"
        val (preview, fetcher) =
            check(
                request(updateUrl = primaryUrl),
                mapOf(primaryUrl to """{"version":"2026.10.20","url":"$page"}"""),
                catalog = BuiltinUpdateCatalog.EMPTY,
            )
        assertTrue(preview is UpdatePreview.Failed)
        preview as UpdatePreview.Failed
        assertEquals(PreviewFailureReason.RESOLVE_FAILED, preview.reason)
        assertTrue(preview.versionPage)
        assertEquals(page, preview.openUrl)
        // 更新页里给出的地址仍会被当成候选跟一次；结论保持「版本页」不变
        assertEquals(primaryUrl, fetcher.called.first())
    }

    @Test
    fun versionInterfaceSayingLatestDoesNotCrawlFurther() {
        val (preview, fetcher) =
            check(
                request(updateUrl = primaryUrl),
                mapOf(primaryUrl to """{"code":200,"data":null}"""),
                catalog = BuiltinUpdateCatalog.EMPTY,
            )
        assertTrue(preview is UpdatePreview.UpToDate)
        assertEquals(listOf(primaryUrl), fetcher.called)
    }

    @Test
    fun olderPrimaryResultStopsBeforeFallback() {
        val (preview, fetcher) =
            check(
                request(storedScript = new, builtinKind = "online"),
                mapOf(primaryUrl to old, fallbackUrl to new),
            )
        assertTrue(preview is UpdatePreview.Older)
        assertEquals(listOf(primaryUrl), fetcher.called)
    }

    @Test
    fun rejectedPrimaryStillTriesFallback() {
        val other = header("别家音源", "2026.10.21")
        val (preview, fetcher) =
            check(
                request(builtinKind = "online"),
                mapOf(primaryUrl to other, fallbackUrl to new),
            )
        assertTrue(preview is UpdatePreview.Available)
        assertEquals(listOf(primaryUrl, fallbackUrl), fetcher.called)
    }

    @Test
    fun noAddressesReportsNoUrlWithoutNetwork() {
        val (preview, fetcher) =
            check(
                request(updateUrl = ""),
                emptyMap(),
                catalog = BuiltinUpdateCatalog.EMPTY,
            )
        assertTrue(preview is UpdatePreview.Failed)
        assertEquals(PreviewFailureReason.NO_URL, (preview as UpdatePreview.Failed).reason)
        assertTrue(fetcher.called.isEmpty())
    }

    @Test
    fun allAddressesFailingKeepsTheUrlForTheUser() {
        val (preview, _) =
            check(
                request(updateUrl = primaryUrl),
                mapOf(primaryUrl to 404),
                catalog = BuiltinUpdateCatalog.EMPTY,
            )
        assertTrue(preview is UpdatePreview.Failed)
        preview as UpdatePreview.Failed
        assertEquals(PreviewFailureReason.RESOLVE_FAILED, preview.reason)
        assertEquals(primaryUrl, preview.openUrl)
    }

    @Test
    fun manualOverrideOnlyTriesTheTypedAddress() {
        val overrideUrl = "https://mine.example/new.js"
        val (preview, fetcher) =
            check(
                request(updateUrl = primaryUrl, overrideUrl = overrideUrl),
                mapOf(primaryUrl to 503, overrideUrl to new),
            )
        assertTrue(preview is UpdatePreview.Available)
        assertEquals(listOf(overrideUrl), fetcher.called)
    }

    @Test
    fun scheduledLocalOnlyUsesHeaderAddress() {
        val headUrl = "https://head.example/src.js"
        val (preview, fetcher) =
            check(
                request(
                    updateUrl = "https://mine.example/wrong.js",
                    scriptUpdateUrl = headUrl,
                    builtinKind = "local",
                    scheduled = true,
                ),
                mapOf(headUrl to new),
                catalog = BuiltinUpdateCatalog.EMPTY,
            )
        assertTrue(preview is UpdatePreview.Available)
        assertEquals(listOf(headUrl), fetcher.called)
    }

    @Test
    fun eventUrlIsUsedWhenNoStoredAddress() {
        val eventUrl = "https://event.example/x.js"
        val (preview, fetcher) =
            check(
                request(updateUrl = "", eventUrl = eventUrl),
                mapOf(eventUrl to new),
                catalog = BuiltinUpdateCatalog.EMPTY,
            )
        assertTrue(preview is UpdatePreview.Available)
        assertEquals(listOf(eventUrl), fetcher.called)
    }

    @Test
    fun syntaxGateRejectsBeforeWriting() {
        val (preview, _) =
            check(
                request(updateUrl = primaryUrl),
                mapOf(primaryUrl to new),
                catalog = BuiltinUpdateCatalog.EMPTY,
                syntaxChecker = ScriptSyntaxChecker { "unexpected end of string" },
            )
        assertTrue(preview is UpdatePreview.Failed)
        preview as UpdatePreview.Failed
        assertEquals(PreviewFailureReason.REJECTED, preview.reason)
        assertEquals(UpdateRejectReason.SYNTAX_ERROR, preview.rejectReason)
    }
}
