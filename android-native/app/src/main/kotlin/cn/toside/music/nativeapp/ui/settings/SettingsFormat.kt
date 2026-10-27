package cn.toside.music.nativeapp.ui.settings

import cn.toside.music.core.local.LocalFallbackConfirm
import cn.toside.music.core.userapi.PreviewFailureReason
import cn.toside.music.core.userapi.UpdateComparison
import cn.toside.music.core.userapi.UpdatePreview
import cn.toside.music.nativeapp.userapi.UserApiUpdateOutcome
import cn.toside.music.nativeapp.userapi.UserApiUpdateStatus
import java.util.Locale
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.pow

/**
 * 设置页用到的几个纯格式化函数（RN `utils/common.ts` 的 `sizeFormate` 等价的移植）。
 *
 * 单独拆出来是因为它们各有一条「显示成什么样」的规矩，值得用 JVM 用例锁死，
 * 而 Compose 界面本身在 JVM 里跑不起来，只能在真机上验收。
 */

private val CACHE_UNITS = listOf("B", "KiB", "MiB", "GiB", "TiB")

/**
 * 字节数转可读大小 —— RN `sizeFormate`：按 1024 取档、保留两位小数。
 *
 * RN 取到第五档以后会拼出 `undefined`，这里改成停在最后一档：
 * 缓存再大也不该让设置页显示成一句乱码。
 */
fun formatCacheSize(bytes: Long): String {
    if (bytes <= 0L) return "0 B"
    val unit = floor(ln(bytes.toDouble()) / ln(1024.0)).toInt().coerceAtMost(CACHE_UNITS.lastIndex)
    val value = bytes / 1024.0.pow(unit)
    return "${String.format(Locale.US, "%.2f", value)} ${CACHE_UNITS[unit]}"
}

/**
 * W7-2：本地曲库在线兜底前的人工确认开关（`local.fallbackConfirm`）读取器。
 *
 * 键不在表里、或存量设置文件里还没有这个键时按**默认开**返回 —— 兜底确认是
 * W6-2 加出来的体验增强，缺键必须保持「问一句」而不是静默换源（RN 原版是静默的）。
 * 拆成纯函数是为了能在 JVM 用例里锁住这层语义：调用点是 `MusicApp` 的顶层装配，
 * Compose 那里跑不了单测。
 */
fun fallbackConfirmEnabled(settings: Map<String, Any?>): Boolean = settings[LocalFallbackConfirm.SETTING_KEY] as? Boolean ?: true

/** 音量（0..1）显示成百分比，和小数点后的余数一起截掉（RN 用 `Math.trunc`）。 */
fun formatVolumePercent(volume: Double): String = "${floor(volume * 100).toInt()}%"

/** 倍速显示成 `1.25x` 这种样子（RN 播放页弹层里是 `toFixed(2)` 加 x）。 */
fun formatPlaybackRate(rate: Double): String = "${String.format(Locale.US, "%.2f", rate)}x"

/** 「音源更新检查」四档的中文标签（对照 RN `setting_basic_user_api_update_check_*`）。 */
fun userApiUpdateCheckLabel(mode: String?): String =
    when (mode) {
        "off" -> "不自动检查"
        "startup" -> "每次启动"
        "weekly" -> "每周"
        "daily" -> "每天"
        else -> "每天"
    }

/** 更新检查四档（值串和 RN 的 `common.userApiUpdateCheck` 一致，顺序也一致）。 */
val USER_API_UPDATE_CHECK_OPTIONS: List<Pair<String, String>> =
    listOf(
        "off" to "不自动检查",
        "startup" to "每次启动",
        "daily" to "每天",
        "weekly" to "每周",
    )

/** 源条目右边的标记：正在用的那个排最前，内置源标出来免得用户以为删得掉。 */
fun sourceTags(
    isCurrent: Boolean,
    builtinKind: String?,
): String =
    listOf(
        if (isCurrent) "使用中" else null,
        when (builtinKind) {
            "online" -> "内置·在线"
            "local" -> "内置"
            else -> null
        },
    ).filterNotNull().joinToString(" · ")

/**
 * 「检查更新」拿到结果后直接告诉用户的话（不需要确认的那些）。
 *
 * 需要确认（有新版本 / 地址里是旧版本）时返回 null，由界面弹确认框。
 * 文案对照 RN `user_api_update_*_tip`。
 */
fun userApiCheckTip(
    preview: UpdatePreview,
    sourceName: String,
): String? =
    when (preview) {
        is UpdatePreview.UpToDate -> "音源「${preview.name}」已经是最新的"
        is UpdatePreview.Failed ->
            when (preview.reason) {
                PreviewFailureReason.NO_URL ->
                    "音源「$sourceName」没有可用的更新地址：先填一个更新地址，" +
                        "或者到它的发布页下载脚本再手动导入"
                PreviewFailureReason.NOT_FOUND -> "这个源已经不在了，返回列表再进来一次看看"
                else -> "音源「$sourceName」检查更新失败：${preview.message.ifEmpty { "未知原因" }}"
            }
        is UpdatePreview.Available, is UpdatePreview.Older -> null
    }

/** 确认框里那句「要不要换上」，按版本号的三种认法分别措辞。 */
fun userApiUpdateConfirmTip(preview: UpdatePreview): String? =
    when (preview) {
        is UpdatePreview.Available ->
            when (preview.comparison) {
                UpdateComparison.NEWER -> "发现新版本 ${preview.toVersion}（当前 ${preview.fromVersion}），要现在更新吗？"
                UpdateComparison.SAME -> "更新地址里是同一版本（${preview.toVersion}）的新内容，要换上吗？"
                UpdateComparison.UNKNOWN -> "更新地址里的脚本和当前不一样，但版本号认不出来，要更新吗？"
            }
        is UpdatePreview.Older ->
            "这个地址里是旧版本 ${preview.toVersion}，当前已经是 ${preview.fromVersion}。" +
                "换回去以后可能有些功能不能用，仍要更新吗？"
        else -> null
    }

/** 更新跑完之后的结论（对照 RN `user_api_update_check_*_tip`）。 */
fun userApiUpdateOutcomeTip(outcome: UserApiUpdateOutcome): String =
    when {
        // 换上去的新脚本连加载都过不了：已经退回原来那份，这句比「失败」更要紧
        outcome.rolledBack -> "新版脚本加载不起来，已退回更新前的版本"
        outcome.status == UserApiUpdateStatus.UPDATED -> "音源「${outcome.name}」已更新到 ${outcome.toVersion}"
        outcome.status == UserApiUpdateStatus.UNCHANGED -> "音源「${outcome.name}」已经是最新的"
        outcome.status == UserApiUpdateStatus.OLDER ->
            "更新地址里是旧版本 ${outcome.toVersion}，当前已经是 ${outcome.fromVersion}，已跳过"
        else -> "音源「${outcome.name}」更新失败：${outcome.message.ifEmpty { "未知原因" }}"
    }
