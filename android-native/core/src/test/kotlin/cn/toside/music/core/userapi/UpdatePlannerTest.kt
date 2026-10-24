package cn.toside.music.core.userapi

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 对照 RN `tests/user-api-update-apply.mts` 与 `user-api-update-preview.mts`。 */
class UpdatePlannerTest {
    private val name = "落雪云更新音源(实测)"

    private fun header(
        headerName: String,
        version: String,
        extra: String = "",
    ): String = "/**\n * @name $headerName\n * @version $version\n$extra */\nuserApi.register.action(() => {})\n"

    private val old = header(name, "2026.10.18")
    private val new = header(name, "2026.10.20")
    private val sameVersionNewBytes = header(name, "2026.10.20", " * @author 补丁\n")

    private fun plan(
        stored: String,
        script: String,
        currentName: String = name,
        allowDowngrade: Boolean = false,
        checker: ScriptSyntaxChecker = ScriptSyntaxChecker { null },
    ): UpdatePlan =
        UpdatePlanner.planUpdate(
            currentName = currentName,
            storedScript = stored,
            newScript = script,
            allowDowngrade = allowDowngrade,
            syntaxChecker = checker,
        )

    @Test
    fun identicalScriptIsUnchanged() {
        assertEquals(UpdateAction.UNCHANGED, plan(new, new).action)
    }

    @Test
    fun nameMismatchIsRejected() {
        val result =
            plan(
                old,
                header("落雪云更新音源(实测)", "2026.10.20"),
                currentName = "西瓜聚合源",
            )
        assertEquals(UpdateAction.REJECT, result.action)
        assertEquals(UpdateRejectReason.NAME_MISMATCH, result.reason)
    }

    @Test
    fun contentWithoutHeaderIsRejected() {
        val result = plan(old, "<html>404</html>")
        assertEquals(UpdateAction.REJECT, result.action)
        assertEquals(UpdateRejectReason.INVALID_SCRIPT, result.reason)
    }

    @Test
    fun oversizedContentIsRejected() {
        val huge = header(name, "2026.10.20") + "x".repeat(9_000_000)
        val result = plan(old, huge)
        assertEquals(UpdateAction.REJECT, result.action)
        assertEquals(UpdateRejectReason.TOO_LARGE, result.reason)
    }

    @Test
    fun syntaxFailureIsRejectedAfterHeaderChecks() {
        val result =
            plan(
                old,
                new,
                checker = ScriptSyntaxChecker { if (it.contains("BROKEN")) "Unexpected token" else null },
            )
        assertEquals(UpdateAction.WRITE, result.action)
        val broken = plan(old, new + "BROKEN", checker = ScriptSyntaxChecker { "Unexpected token" })
        assertEquals(UpdateRejectReason.SYNTAX_ERROR, broken.reason)
    }

    @Test
    fun olderVersionIsRejectedWithoutWriting() {
        val result = plan(new, old)
        assertEquals(UpdateAction.REJECT, result.action)
        assertEquals(UpdateRejectReason.OLDER, result.reason)
        assertEquals("2026.10.20", result.fromVersion)
        assertEquals("2026.10.18", result.toVersion)
    }

    @Test
    fun explicitDowngradeIsAllowed() {
        val result = plan(new, old, allowDowngrade = true)
        assertEquals(UpdateAction.WRITE, result.action)
    }

    @Test
    fun sameVersionNewContentIsWritable() {
        val result = plan(new, sameVersionNewBytes)
        assertEquals(UpdateAction.WRITE, result.action)
        assertEquals(UpdateComparison.SAME, result.comparison)
    }

    @Test
    fun sameVersionNewerBuildIsNewer() {
        val oldBuild = header(name, "2026.10.20", " * 于 2026-10-20 13:00:02 自动生成\n")
        val newBuild = header(name, "2026.10.20", " * 于 2026-10-20 19:00:02 自动生成\n")
        val result = plan(oldBuild, newBuild)
        assertEquals(UpdateAction.WRITE, result.action)
        assertEquals(UpdateComparison.NEWER, result.comparison)
        assertEquals(UpdateRejectReason.OLDER, plan(newBuild, oldBuild).reason)
    }

    @Test
    fun unparseableVersionsAreUnknownNotDowngrade() {
        val result = plan(header(name, "beta"), header(name, "nightly"))
        assertEquals(UpdateAction.WRITE, result.action)
        assertEquals(UpdateComparison.UNKNOWN, result.comparison)
    }

    @Test
    fun missingNameOnNewScriptIsNotRejected() {
        val unnamed = header("", "2026.10.21")
        assertEquals(UpdateAction.WRITE, plan(old, unnamed).action)
    }

    @Test
    fun nameComparisonIgnoresCaseAndWhitespace() {
        val spaced = header("  $name ", "2026.10.21")
        assertEquals(UpdateAction.WRITE, plan(old, spaced).action)
    }

    @Test
    fun previewOfNewerKeepsScriptForConfirmation() {
        val result = UpdatePlanner.previewUpdate(name, old, new, "https://a.test/lx.js")
        assertTrue(result is UpdatePreview.Available)
        result as UpdatePreview.Available
        assertEquals(UpdateComparison.NEWER, result.comparison)
        assertEquals("2026.10.18", result.fromVersion)
        assertEquals("2026.10.20", result.toVersion)
        assertEquals(new, result.script)
        assertEquals("https://a.test/lx.js", result.url)
    }

    @Test
    fun previewOfIdenticalIsUpToDate() {
        assertEquals(
            UpdatePreview.UpToDate(name),
            UpdatePlanner.previewUpdate(name, new, new, "https://a.test/lx.js"),
        )
    }

    @Test
    fun previewOfOlderIsSeparateStatus() {
        val result = UpdatePlanner.previewUpdate(name, new, old, "https://a.test/lx.js")
        assertTrue(result is UpdatePreview.Older)
        result as UpdatePreview.Older
        assertEquals("2026.10.20", result.fromVersion)
        assertEquals("2026.10.18", result.toVersion)
        assertEquals(old, result.script)
    }

    @Test
    fun previewOfInvalidScriptFailsBeforeConfirmation() {
        val result = UpdatePlanner.previewUpdate(name, old, "<html>404</html>", "https://a.test/lx.js")
        assertTrue(result is UpdatePreview.Failed)
        result as UpdatePreview.Failed
        assertEquals(PreviewFailureReason.REJECTED, result.reason)
        assertEquals(UpdateRejectReason.INVALID_SCRIPT, result.rejectReason)
    }

    @Test
    fun previewCarriesRejectReasonAndUrl() {
        val result =
            UpdatePlanner.previewUpdate(
                "西瓜聚合源",
                old,
                header(name, "2026.10.20"),
                "https://a.test/lx.js",
            )
        assertTrue(result is UpdatePreview.Failed)
        result as UpdatePreview.Failed
        assertEquals(UpdateRejectReason.NAME_MISMATCH, result.rejectReason)
        assertEquals("https://a.test/lx.js", result.url)
    }

    @Test
    fun pickBestPrefersAvailableWithHighestVersion() {
        val newer20 = UpdatePlanner.previewUpdate(name, old, new, "https://a.test/20.js")
        val newer21 = UpdatePlanner.previewUpdate(name, old, header(name, "2026.10.21"), "https://b.test/21.js")
        val best =
            UpdatePlanner.pickBestPreview(
                listOf(
                    UpdatePreview.UpToDate(name),
                    newer20,
                    UpdatePlanner.previewUpdate(name, new, old, "https://c.test/old.js"),
                    newer21,
                ),
            )
        assertEquals(newer21, best)
    }

    @Test
    fun pickBestUsesBuildTimeForSameVersion() {
        val stale =
            UpdatePlanner.previewUpdate(
                name,
                old,
                header(name, "2026.10.20", " * 于 2026-10-20 13:00:02 自动生成\n"),
                "https://fastly.test/lx.js",
            )
        val fresh =
            UpdatePlanner.previewUpdate(
                name,
                old,
                header(name, "2026.10.20", " * 于 2026-10-20 19:00:02 自动生成\n"),
                "https://gcore.test/lx.js",
            )
        assertEquals(fresh, UpdatePlanner.pickBestPreview(listOf(stale, fresh)))
        assertEquals(fresh, UpdatePlanner.pickBestPreview(listOf(fresh, stale)))
    }

    @Test
    fun descriptorSameOrOlderIsUpToDate() {
        val stored = header(name, "1.0.2")
        for (version in listOf("1.0.2", "1.0.1")) {
            val result =
                UpdatePlanner.previewDescriptor(
                    name,
                    stored,
                    VersionDescriptor(version, "https://doc.test/update"),
                )
            assertEquals(UpdatePreview.UpToDate(name), result)
        }
    }

    @Test
    fun descriptorNewerButOnlyWebPageNeedsManualOpen() {
        val result =
            UpdatePlanner.previewDescriptor(
                name,
                header(name, "1.0.2"),
                VersionDescriptor("1.0.3", "https://doc.test/update"),
            )
        assertNotNull(result)
        assertTrue(result is UpdatePreview.Failed)
        result as UpdatePreview.Failed
        assertEquals(PreviewFailureReason.RESOLVE_FAILED, result.reason)
        assertEquals("https://doc.test/update", result.openUrl)
        assertTrue(result.versionPage)
        assertTrue(result.message.contains("1.0.3"))
        assertTrue(result.message.contains("手动"))
    }

    @Test
    fun descriptorWithUnparseableVersionReturnsNull() {
        assertNull(
            UpdatePlanner.previewDescriptor(
                name,
                header(name, "beta"),
                VersionDescriptor("nightly", ""),
            ),
        )
    }

    @Test
    fun pickBestFallsBackInOrder() {
        val upToDate: UpdatePreview = UpdatePreview.UpToDate(name)
        val older = UpdatePlanner.previewUpdate(name, new, old, "https://a.test/lx.js")
        val failed = UpdatePlanner.previewUpdate(name, old, "<html>404</html>", "https://a.test/lx.js")
        assertEquals(upToDate, UpdatePlanner.pickBestPreview(listOf(failed, older, upToDate)))
        assertEquals(older, UpdatePlanner.pickBestPreview(listOf(failed, older)))
        assertEquals(failed, UpdatePlanner.pickBestPreview(listOf(failed)))
    }
}
