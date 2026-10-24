package cn.toside.music.core.userapi

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** 对照 RN `tests/user-api-update-schedule.mts`。 */
class UpdateScheduleTest {
    private val day = 24 * 60 * 60 * 1000L

    private val catalogUrls =
        listOf(
            "https://zrcdy.dpdns.org/lx/versionh2.php?ver=v3.2.13",
            "https://yy.zddyr.top/lx/versionh2.php?ver=v3.2.13",
        )

    private val catalog =
        BuiltinUpdateCatalog { id ->
            when (id) {
                "builtin_qdy" ->
                    BuiltinUpdateCatalogEntry(
                        kind = "online",
                        updateUrl = "https://fastly.jsdelivr.net/gh/pdone/lx-music-source@main/qdy/latest.js",
                        fallbackUpdateUrls =
                            listOf(
                                "https://ghproxy.net/raw.githubusercontent.com/pdone/lx-music-source/main/qdy/latest.js",
                                "https://raw.githubusercontent.com/pdone/lx-music-source/main/qdy/latest.js",
                            ),
                    )
                "builtin_xinghai" ->
                    BuiltinUpdateCatalogEntry(
                        kind = "local",
                        checkUpdateUrls =
                            listOf(
                                "https://zrcdy.dpdns.org/lx/versionh2.php?ver={version}",
                                "https://yy.zddyr.top/lx/versionh2.php?ver={version}",
                            ),
                        autoCheck = true,
                    )
                "builtin_animemusic" ->
                    BuiltinUpdateCatalogEntry(
                        kind = "local",
                        checkUpdateUrls =
                            listOf(
                                "https://animemusic.bzxhkj.com/v1/index.php/script/lxmusic" +
                                    "?checkUpdate=f50246eabbc1a141f9e1c46bcc352010&key=",
                            ),
                        autoCheck = true,
                    )
                else -> null
            }
        }

    private fun api(
        id: String,
        lastCheckAt: Long = 0L,
        updateUrl: String = "https://$id.example/src.js",
    ): UpdateUrlSource = UpdateUrlSource(id = id, updateUrl = updateUrl, lastCheckAt = lastCheckAt)

    @Test
    fun offModeNeverChecks() {
        assertFalse(UpdateSchedule.shouldCheck(UserApiUpdateCheckMode.OFF, 0, 1_000_000))
    }

    @Test
    fun neverCheckedChecksImmediately() {
        for (mode in UpdateSchedule.CHECK_MODES) {
            if (mode == UserApiUpdateCheckMode.OFF) continue
            assertTrue(UpdateSchedule.shouldCheck(mode, 0, 1_000_000))
        }
    }

    @Test
    fun startupIgnoresLastCheckTime() {
        val now = 1_700_000_000_000L
        assertTrue(UpdateSchedule.shouldCheck(UserApiUpdateCheckMode.STARTUP, now - 1000, now))
    }

    @Test
    fun dailyWaitsForFullDay() {
        val now = 1_700_000_000_000L
        assertFalse(UpdateSchedule.shouldCheck(UserApiUpdateCheckMode.DAILY, now - 60 * 60 * 1000, now))
        assertTrue(UpdateSchedule.shouldCheck(UserApiUpdateCheckMode.DAILY, now - day - 1, now))
    }

    @Test
    fun weeklyWaitsForSevenDays() {
        val now = 1_700_000_000_000L
        assertFalse(UpdateSchedule.shouldCheck(UserApiUpdateCheckMode.WEEKLY, now - 6 * day, now))
        assertTrue(UpdateSchedule.shouldCheck(UserApiUpdateCheckMode.WEEKLY, now - 7 * day, now))
    }

    @Test
    fun clockRolledBackStillAllowsCheck() {
        val now = 1_700_000_000_000L
        assertTrue(UpdateSchedule.shouldCheck(UserApiUpdateCheckMode.DAILY, now + 30 * day, now))
    }

    @Test
    fun pickCheckTargetsOnlyDueSourcesWithAddress() {
        val now = 1_700_000_000_000L
        val list =
            listOf(
                api("a", now - 2 * day),
                api("b", now - 60 * 60 * 1000),
                api("c", now - 60 * 60 * 1000),
            )
        assertEquals(
            listOf("a"),
            UpdateSchedule.pickCheckTargets(list, UserApiUpdateCheckMode.DAILY, now).map { it.id },
        )
    }

    @Test
    fun startupTakesEverySourceWithAddress() {
        val now = 1_700_000_000_000L
        val list = listOf(api("a", now), api("b"), api("c"))
        assertEquals(
            listOf("a", "b", "c"),
            UpdateSchedule.pickCheckTargets(list, UserApiUpdateCheckMode.STARTUP, now).map { it.id },
        )
    }

    @Test
    fun sourceWithoutAddressIsSkippedButHeaderAddressCounts() {
        val now = 1_700_000_000_000L
        val list =
            listOf(
                api("a", 0, ""),
                UpdateUrlSource(id = "b", updateUrl = "", scriptUpdateUrl = "https://head.example/src.js"),
                api("c", 0, ""),
            )
        assertEquals(
            listOf("b"),
            UpdateSchedule.pickCheckTargets(list, UserApiUpdateCheckMode.STARTUP, now).map { it.id },
        )
    }

    @Test
    fun masterAndModeSwitchesBothStopEverything() {
        val now = 1_700_000_000_000L
        val list = listOf(api("a"), api("b"))
        assertTrue(UpdateSchedule.pickCheckTargets(list, UserApiUpdateCheckMode.STARTUP, now, autoUpdate = false).isEmpty())
        assertTrue(UpdateSchedule.pickCheckTargets(list, UserApiUpdateCheckMode.OFF, now).isEmpty())
    }

    @Test
    fun userUrlBeatsEventUrl() {
        val user = UpdateUrlSource(id = "x", updateUrl = "https://user.example/src.js")
        assertEquals(
            "https://user.example/src.js",
            UpdateSchedule.pickUpdateUrl(user, "https://event.example/x.js"),
        )
    }

    @Test
    fun eventUrlThenHeaderUrlWhenUserUrlMissing() {
        val header = UpdateUrlSource(id = "x", scriptUpdateUrl = "https://a.example/src.js")
        assertEquals("https://event.example/x.js", UpdateSchedule.pickUpdateUrl(header, "https://event.example/x.js"))
        assertEquals("https://a.example/src.js", UpdateSchedule.pickUpdateUrl(header, ""))
        assertEquals("", UpdateSchedule.pickUpdateUrl(UpdateUrlSource(id = "x")))
    }

    @Test
    fun onlyHttpAddressesCountAndBadOnesDoNotBlock() {
        assertEquals(
            "",
            UpdateSchedule.pickUpdateUrl(UpdateUrlSource(id = "x", updateUrl = "javascript:alert(1)"), ""),
        )
        assertEquals(
            "",
            UpdateSchedule.pickUpdateUrl(UpdateUrlSource(id = "x", updateUrl = "ftp://a.example/x.js"), ""),
        )
        assertEquals(
            "https://a.example/src.js",
            UpdateSchedule.pickUpdateUrl(
                UpdateUrlSource(id = "x", updateUrl = "ftp://a.example/x.js", scriptUpdateUrl = "https://a.example/src.js"),
                "",
            ),
        )
    }

    @Test
    fun candidatesAreOrderedAndDeduplicated() {
        val source =
            UpdateUrlSource(
                id = "x",
                updateUrl = "https://user.example/src.js",
                scriptUpdateUrl = "https://head.example/src.js",
            )
        assertEquals(
            listOf("https://user.example/src.js", "https://event.example/x.js", "https://head.example/src.js"),
            UpdateSchedule.pickUpdateUrls(source, "https://event.example/x.js"),
        )
        val same =
            UpdateUrlSource(
                id = "x",
                updateUrl = "https://same.example/src.js",
                scriptUpdateUrl = "https://same.example/src.js",
            )
        assertEquals(
            listOf("https://same.example/src.js"),
            UpdateSchedule.pickUpdateUrls(same, "https://same.example/src.js"),
        )
    }

    @Test
    fun onlineBuiltinPutsCatalogFallbackInSecondTier() {
        val plan =
            UpdateSchedule.planUpdateUrls(
                UpdateUrlSource(
                    id = "builtin_qdy",
                    builtinKind = "online",
                    updateUrl = "https://fastly.jsdelivr.net/gh/pdone/lx-music-source@main/qdy/latest.js",
                ),
                catalog = catalog,
            )
        assertEquals(
            listOf(
                "https://fastly.jsdelivr.net/gh/pdone/lx-music-source@main/qdy/latest.js",
                "https://gcore.jsdelivr.net/gh/pdone/lx-music-source@main/qdy/latest.js",
                "https://cdn.jsdelivr.net/gh/pdone/lx-music-source@main/qdy/latest.js",
            ),
            plan.primary,
        )
        assertEquals(
            listOf(
                "https://ghproxy.net/raw.githubusercontent.com/pdone/lx-music-source/main/qdy/latest.js",
                "https://raw.githubusercontent.com/pdone/lx-music-source/main/qdy/latest.js",
            ),
            plan.fallback,
        )
    }

    @Test
    fun userFilledUrlDoesNotGetCatalogFallbackAndOverrideOnlyTriesItself() {
        val userOwned =
            UpdateSchedule.planUpdateUrls(
                UpdateUrlSource(id = "builtin_qdy", builtinKind = "online", updateUrl = "https://mine.example/update"),
                catalog = catalog,
            )
        assertEquals(listOf("https://mine.example/update"), userOwned.primary)
        assertTrue(userOwned.fallback.isEmpty())

        val override =
            UpdateSchedule.planUpdateUrls(
                UpdateUrlSource(id = "builtin_qdy", builtinKind = "online", updateUrl = "https://mine.example/old"),
                options = UpdateUrlOptions(overrideUrl = "https://mine.example/new"),
                catalog = catalog,
            )
        assertEquals(listOf("https://mine.example/new"), override.primary)
        assertTrue(override.fallback.isEmpty())
    }

    @Test
    fun scheduledLocalBuiltinOnlyUsesScriptOwnAddress() {
        val source =
            UpdateUrlSource(
                id = "builtin_xigua",
                builtinKind = "local",
                updateUrl = "https://mine.example/wrong.js",
            )
        assertTrue(UpdateSchedule.pickScheduledUpdateUrls(source, catalog).isEmpty())
        assertEquals(
            listOf("https://head.example/src.js"),
            UpdateSchedule.pickScheduledUpdateUrls(
                source.copy(scriptUpdateUrl = "https://head.example/src.js"),
                catalog,
            ),
        )
        val scheduledTargets =
            UpdateSchedule.pickCheckTargets(
                listOf(source),
                UserApiUpdateCheckMode.STARTUP,
                1_700_000_000_000L,
                catalog = catalog,
            )
        assertTrue(scheduledTargets.isEmpty())
    }

    @Test
    fun localBuiltinGetsCatalogVersionUrlsWithVersionEncoded() {
        val xinghai =
            UpdateUrlSource(
                id = "builtin_xinghai",
                builtinKind = "local",
                version = "v3.2.13",
            )
        assertEquals(catalogUrls, UpdateSchedule.planUpdateUrls(xinghai, catalog = catalog).primary)
        assertEquals(catalogUrls, UpdateSchedule.pickScheduledUpdateUrls(xinghai, catalog))

        val withUserUrl = xinghai.copy(updateUrl = "https://mine.example/x.js")
        assertEquals(
            listOf("https://mine.example/x.js") + catalogUrls,
            UpdateSchedule.planUpdateUrls(withUserUrl, catalog = catalog).primary,
        )
        assertEquals(catalogUrls, UpdateSchedule.pickScheduledUpdateUrls(withUserUrl, catalog))

        val withHeader =
            UpdateSchedule.planUpdateUrls(
                xinghai.copy(scriptUpdateUrl = "https://head.example/v.json"),
                catalog = catalog,
            )
        assertEquals(listOf("https://head.example/v.json") + catalogUrls, withHeader.primary)

        val anime =
            UpdateSchedule.planUpdateUrls(
                UpdateUrlSource(id = "builtin_animemusic", builtinKind = "local", version = "3.0.1"),
                catalog = catalog,
            )
        assertEquals(
            listOf(
                "https://animemusic.bzxhkj.com/v1/index.php/script/lxmusic" +
                    "?checkUpdate=f50246eabbc1a141f9e1c46bcc352010&key=",
            ),
            anime.primary,
        )

        val emptyPlan =
            UpdateSchedule.planUpdateUrls(
                UpdateUrlSource(id = "builtin_xigua", builtinKind = "local", version = "v1.40"),
                catalog = catalog,
            )
        assertTrue(emptyPlan.primary.isEmpty() && emptyPlan.fallback.isEmpty())

        assertEquals(
            listOf(catalogUrls[1]),
            UpdateSchedule.pickScheduledUpdateUrls(xinghai.copy(updateUrlRejected = catalogUrls[0]), catalog),
        )
    }

    @Test
    fun rejectedUrlIsSkippedOnScheduledChecksOnly() {
        val bad = "https://fastly.jsdelivr.net/gh/moxi5445/lx-music-cloud@main/lx-cloud.js"
        val source = UpdateUrlSource(id = "user_api_x", updateUrl = bad, updateUrlRejected = bad)
        assertTrue(UpdateSchedule.pickScheduledUpdateUrls(source).isEmpty())
        val targets =
            UpdateSchedule.pickCheckTargets(
                listOf(source),
                UserApiUpdateCheckMode.STARTUP,
                1,
            )
        assertTrue(targets.isEmpty())
        assertEquals(bad, UpdateSchedule.planUpdateUrls(source).primary.first())

        val rejectedGcore =
            UpdateSchedule.pickScheduledUpdateUrls(source.copy(updateUrlRejected = bad.replace("fastly", "gcore")))
        assertTrue(rejectedGcore.isEmpty())
        assertEquals(
            listOf("https://head.example/src.js"),
            UpdateSchedule.pickScheduledUpdateUrls(source.copy(scriptUpdateUrl = "https://head.example/src.js")),
        )
        assertEquals(
            listOf("https://new.example/x.js"),
            UpdateSchedule.pickScheduledUpdateUrls(source.copy(updateUrl = "https://new.example/x.js")),
        )
    }

    @Test
    fun jsdelivrAndRawUrlsGetOfficialMirrors() {
        assertEquals(
            listOf(
                "https://fastly.jsdelivr.net/gh/u/r@main/x.js",
                "https://gcore.jsdelivr.net/gh/u/r@main/x.js",
                "https://cdn.jsdelivr.net/gh/u/r@main/x.js",
            ),
            UpdateSchedule.pickUpdateUrls(
                UpdateUrlSource(id = "x", updateUrl = "https://fastly.jsdelivr.net/gh/u/r@main/x.js"),
            ),
        )
        assertEquals(
            listOf(
                "https://gcore.jsdelivr.net/gh/u/r@main/x.js?v=1",
                "https://fastly.jsdelivr.net/gh/u/r@main/x.js?v=1",
                "https://cdn.jsdelivr.net/gh/u/r@main/x.js?v=1",
            ),
            UpdateSchedule.pickUpdateUrls(
                UpdateUrlSource(id = "x", updateUrl = "https://gcore.jsdelivr.net/gh/u/r@main/x.js?v=1"),
            ),
        )
        assertEquals(
            listOf("https://example.com/x.js"),
            UpdateSchedule.pickUpdateUrls(UpdateUrlSource(id = "x", updateUrl = "https://example.com/x.js")),
        )
        assertEquals(
            listOf(
                "https://raw.githubusercontent.com/moxi5445/lx-music-cloud/main/lx-cloud.js",
                "https://fastly.jsdelivr.net/gh/moxi5445/lx-music-cloud@main/lx-cloud.js",
                "https://gcore.jsdelivr.net/gh/moxi5445/lx-music-cloud@main/lx-cloud.js",
                "https://cdn.jsdelivr.net/gh/moxi5445/lx-music-cloud@main/lx-cloud.js",
            ),
            UpdateSchedule.pickUpdateUrls(
                UpdateUrlSource(
                    id = "x",
                    updateUrl = "https://raw.githubusercontent.com/moxi5445/lx-music-cloud/main/lx-cloud.js",
                ),
            ),
        )
        val rejectedMoxi =
            UpdateSchedule.planUpdateUrls(
                UpdateUrlSource(
                    id = "builtin_moxi_cloud",
                    builtinKind = "local",
                    scriptUpdateUrl = "https://raw.githubusercontent.com/moxi5445/lx-music-cloud/main/lx-cloud.js",
                    updateUrlRejected = "https://gcore.jsdelivr.net/gh/moxi5445/lx-music-cloud@main/lx-cloud.js",
                ),
                options = UpdateUrlOptions(scheduled = true),
                catalog = catalog,
            )
        assertTrue(rejectedMoxi.primary.isEmpty())
    }
}
