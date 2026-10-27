package cn.toside.music.nativeapp.ui.settings

import cn.toside.music.core.local.LocalFallbackConfirm
import cn.toside.music.core.userapi.PreviewFailureReason
import cn.toside.music.core.userapi.ScriptHeaderInfo
import cn.toside.music.core.userapi.UpdateComparison
import cn.toside.music.core.userapi.UpdateFailureReason
import cn.toside.music.core.userapi.UpdatePreview
import cn.toside.music.nativeapp.userapi.UserApiUpdateOutcome
import cn.toside.music.nativeapp.userapi.UserApiUpdateStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 设置页/音源页里「显示成什么样」的那几条规矩。
 *
 * Compose 界面本身在 JVM 里跑不起来，能锁死的只有这些纯函数。
 */
class SettingsFormatTest {
    private companion object {
        fun header(
            name: String,
            version: String,
        ) = ScriptHeaderInfo(
            name = name,
            version = version,
            description = "",
            author = "",
            homepage = "",
            updateUrl = "",
            buildTime = 0L,
        )

        fun available(
            comparison: UpdateComparison,
            from: String = "1.0.0",
            to: String = "1.1.0",
        ) = UpdatePreview.Available(
            name = "我的源",
            fromVersion = from,
            toVersion = to,
            comparison = comparison,
            url = "https://mine.example/latest.js",
            script = "module.exports = function() {}",
            header = header("我的源", to),
        )

        fun older(
            from: String = "2.0.0",
            to: String = "1.9.0",
        ) = UpdatePreview.Older(
            name = "我的源",
            fromVersion = from,
            toVersion = to,
            url = "https://mine.example/latest.js",
            script = "module.exports = function() {}",
            header = header("我的源", to),
        )
    }

    // ---------- 大小/数值格式化 ----------

    @Test
    fun cacheSizeUsesIecUnitsWithTwoDecimals() {
        // 对照 RN sizeFormate：按 1024 取档、留两位小数
        assertEquals("0 B", formatCacheSize(0L))
        assertEquals("512.00 B", formatCacheSize(512L))
        assertEquals("1023.00 B", formatCacheSize(1023L))
        assertEquals("1.00 KiB", formatCacheSize(1024L))
        assertEquals("1.50 KiB", formatCacheSize(1536L))
        assertEquals("1.00 MiB", formatCacheSize(1024L * 1024L))
        assertEquals("1.00 GiB", formatCacheSize(1024L * 1024L * 1024L))
        assertEquals("2.50 GiB", formatCacheSize((2.5 * 1024 * 1024 * 1024).toLong()))
    }

    @Test
    fun cacheSizeStaysOnTheLastUnitInsteadOfBreaking() {
        // RN 超出五档会拼出 undefined，这里停在 TiB：设置页不该显示乱码
        assertEquals("8192.00 TiB", formatCacheSize(8192L * 1024L * 1024L * 1024L * 1024L))
        assertEquals("8388608.00 TiB", formatCacheSize(Long.MAX_VALUE))
    }

    @Test
    fun negativeCacheSizeReadsAsZero() {
        // 磁盘统计偶发负数时不要把「-0.01 B」这种字样甩给用户
        assertEquals("0 B", formatCacheSize(-1L))
    }

    @Test
    fun volumeIsShownAsATruncatedPercent() {
        assertEquals("0%", formatVolumePercent(0.0))
        assertEquals("50%", formatVolumePercent(0.5))
        assertEquals("100%", formatVolumePercent(1.0))
        // 截断不四舍五入（RN 用 Math.trunc）
        assertEquals("99%", formatVolumePercent(0.999))
    }

    @Test
    fun playbackRateKeepsTwoDecimalsAndASuffix() {
        assertEquals("1.00x", formatPlaybackRate(1.0))
        assertEquals("1.25x", formatPlaybackRate(1.25))
        assertEquals("2.00x", formatPlaybackRate(2.0))
    }

    // ---------- 更新检查档位 ----------

    @Test
    fun updateCheckLabelsMatchTheFourStoredModes() {
        assertEquals("不自动检查", userApiUpdateCheckLabel("off"))
        assertEquals("每次启动", userApiUpdateCheckLabel("startup"))
        assertEquals("每天", userApiUpdateCheckLabel("daily"))
        assertEquals("每周", userApiUpdateCheckLabel("weekly"))
    }

    @Test
    fun unknownUpdateCheckModeFallsBackToTheDefault() {
        // 存储里可能是空、也可能是旧版本写坏的串：认不出来就按默认档「每天」显示
        assertEquals("每天", userApiUpdateCheckLabel(null))
        assertEquals("每天", userApiUpdateCheckLabel(""))
        assertEquals("每天", userApiUpdateCheckLabel("hourly"))
        assertEquals(
            listOf("off", "startup", "daily", "weekly"),
            USER_API_UPDATE_CHECK_OPTIONS.map { it.first },
        )
    }

    // ---------- 源条目上的标记 ----------

    @Test
    fun sourceTagsPutTheInUseMarkerFirst() {
        assertEquals("使用中 · 内置", sourceTags(isCurrent = true, builtinKind = "local"))
        assertEquals("使用中 · 内置·在线", sourceTags(isCurrent = true, builtinKind = "online"))
        assertEquals("内置", sourceTags(isCurrent = false, builtinKind = "local"))
        // 用户自己导入的源没有任何内置标记，正在用的时候只有一句「使用中」
        assertEquals("", sourceTags(isCurrent = false, builtinKind = null))
        assertEquals("使用中", sourceTags(isCurrent = true, builtinKind = null))
    }

    // ---------- 检查更新的措辞 ----------

    @Test
    fun checkTipOnlySpeaksWhenNoConfirmationIsNeeded() {
        assertEquals(
            "音源「我的源」已经是最新的",
            userApiCheckTip(UpdatePreview.UpToDate(name = "我的源"), "我的源"),
        )
        // 有新版本 / 地址里是旧版本都要弹确认框，这里返回 null 让界面去弹
        assertNull(userApiCheckTip(available(UpdateComparison.NEWER), "我的源"))
        assertNull(userApiCheckTip(older(), "我的源"))
    }

    @Test
    fun failureTipsNameTheCauseInTheUsersWords() {
        assertEquals(
            "音源「我的源」没有可用的更新地址：先填一个更新地址，或者到它的发布页下载脚本再手动导入",
            userApiCheckTip(
                UpdatePreview.Failed(reason = PreviewFailureReason.NO_URL, message = "no url"),
                "我的源",
            ),
        )
        // 取回内容失败要把失败原因带出来，用户才知道是网络还是脚本本身坏了
        assertEquals(
            "音源「我的源」检查更新失败：连接超时",
            userApiCheckTip(
                UpdatePreview.Failed(reason = PreviewFailureReason.RESOLVE_FAILED, message = "连接超时"),
                "我的源",
            ),
        )
        assertEquals(
            "这个源已经不在了，返回列表再进来一次看看",
            userApiCheckTip(UpdatePreview.Failed(reason = PreviewFailureReason.NOT_FOUND, message = ""), "我的源"),
        )
    }

    @Test
    fun confirmTipWordingDependsOnHowTheVersionNumbersCompared() {
        assertEquals(
            "发现新版本 1.1.0（当前 1.0.0），要现在更新吗？",
            userApiUpdateConfirmTip(available(UpdateComparison.NEWER)),
        )
        assertEquals(
            "更新地址里是同一版本（1.1.0）的新内容，要换上吗？",
            userApiUpdateConfirmTip(available(UpdateComparison.SAME)),
        )
        assertEquals(
            "更新地址里的脚本和当前不一样，但版本号认不出来，要更新吗？",
            userApiUpdateConfirmTip(available(UpdateComparison.UNKNOWN)),
        )
        assertEquals(
            "这个地址里是旧版本 1.9.0，当前已经是 2.0.0。换回去以后可能有些功能不能用，仍要更新吗？",
            userApiUpdateConfirmTip(older()),
        )
        assertNull(userApiUpdateConfirmTip(UpdatePreview.UpToDate(name = "我的源")))
    }

    @Test
    fun outcomeTipLeadsWithTheRollbackWhenTheNewScriptDidNotStart() {
        // 回滚那句比「失败」更要紧：得先让用户知道原来那份还在用
        val rolledBack =
            UserApiUpdateOutcome(
                status = UserApiUpdateStatus.FAILED,
                name = "我的源",
                reason = UpdateFailureReason.RELOAD_FAILED,
                message = "加载失败",
                toVersion = "1.1.0",
                rolledBack = true,
            )
        assertEquals("新版脚本加载不起来，已退回更新前的版本", userApiUpdateOutcomeTip(rolledBack))

        assertEquals(
            "音源「我的源」已更新到 1.1.0",
            userApiUpdateOutcomeTip(
                UserApiUpdateOutcome(status = UserApiUpdateStatus.UPDATED, name = "我的源", toVersion = "1.1.0"),
            ),
        )
        assertEquals(
            "音源「我的源」已经是最新的",
            userApiUpdateOutcomeTip(UserApiUpdateOutcome(status = UserApiUpdateStatus.UNCHANGED, name = "我的源")),
        )
        assertEquals(
            "更新地址里是旧版本 1.9.0，当前已经是 2.0.0，已跳过",
            userApiUpdateOutcomeTip(
                UserApiUpdateOutcome(
                    status = UserApiUpdateStatus.OLDER,
                    name = "我的源",
                    fromVersion = "2.0.0",
                    toVersion = "1.9.0",
                ),
            ),
        )
        assertEquals(
            "音源「我的源」更新失败：地址打不开",
            userApiUpdateOutcomeTip(
                UserApiUpdateOutcome(
                    status = UserApiUpdateStatus.FAILED,
                    name = "我的源",
                    reason = UpdateFailureReason.RESOLVE_FAILED,
                    message = "地址打不开",
                ),
            ),
        )
        // 失败但没带上原因时也要有话说，不能显示成「更新失败：」
        assertEquals(
            "音源「我的源」更新失败：未知原因",
            userApiUpdateOutcomeTip(UserApiUpdateOutcome(status = UserApiUpdateStatus.FAILED, name = "我的源")),
        )
    }

    // ---------- W7-2 本地兜底确认开关 ----------

    @Test
    fun fallbackConfirmDefaultsToOnWhenKeyIsMissing() {
        // 存量设置文件里还没有这个键（旧版本存下来的）：必须保持「问一句」，
        // 不能因为缺键就静默换源
        assertTrue(fallbackConfirmEnabled(emptyMap()))
        assertTrue(fallbackConfirmEnabled(mapOf("theme.id" to "cyan")))
    }

    @Test
    fun fallbackConfirmFollowsTheSettingValue() {
        assertTrue(fallbackConfirmEnabled(mapOf(LocalFallbackConfirm.SETTING_KEY to true)))
        assertFalse(fallbackConfirmEnabled(mapOf(LocalFallbackConfirm.SETTING_KEY to false)))
    }

    @Test
    fun fallbackConfirmIgnoresWrongTypes() {
        // 键在但值不是布尔（历史写入异常）：同样回落默认开，而不是崩溃/关闭
        assertTrue(fallbackConfirmEnabled(mapOf(LocalFallbackConfirm.SETTING_KEY to "true")))
        assertTrue(fallbackConfirmEnabled(mapOf(LocalFallbackConfirm.SETTING_KEY to 1)))
    }
}
