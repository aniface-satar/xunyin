package cn.toside.music.core.userapi

import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/**
 * 「这份新脚本能不能覆盖当前那份」—— RN `src/core/userApiUpdate/applyUpdate.ts`
 * 与 `preview.ts` 的移植（只含不碰存储的纯判断）。
 *
 * 真机上「新脚本加载失败就还原」需要读写存储，由 app 侧的更新执行器负责；
 * 这里只回答「会不会写、为什么拒绝」，好让每条闸门都能用 JVM 用例锁死。
 */
enum class UpdateAction { WRITE, UNCHANGED, REJECT }

enum class UpdateRejectReason { INVALID_SCRIPT, NAME_MISMATCH, TOO_LARGE, SYNTAX_ERROR, OLDER }

enum class UpdateComparison { NEWER, SAME, UNKNOWN }

data class UpdatePlan(
    val action: UpdateAction,
    val reason: UpdateRejectReason? = null,
    val header: ScriptHeaderInfo? = null,
    val fromVersion: String = "",
    val toVersion: String = "",
    /** 版本号相同时，靠构建时间判断这次到底是升级还是 CDN 旧缓存回退。 */
    val comparison: UpdateComparison? = null,
    val message: String? = null,
)

sealed interface UpdatePreview {
    data class Available(
        val name: String,
        val fromVersion: String,
        val toVersion: String,
        val comparison: UpdateComparison,
        val url: String,
        val script: String,
        val header: ScriptHeaderInfo,
    ) : UpdatePreview

    data class UpToDate(
        val name: String,
    ) : UpdatePreview

    data class Older(
        val name: String,
        val fromVersion: String,
        val toVersion: String,
        val url: String,
        val script: String,
        val header: ScriptHeaderInfo,
    ) : UpdatePreview

    data class Failed(
        val reason: PreviewFailureReason,
        /** rejected 时具体是哪条闸门拦下的；别的失败没有 */
        val rejectReason: UpdateRejectReason? = null,
        /** 地址本身没问题，只是给的是版本/更新网页：这些地址留着下次还有用 */
        val versionPage: Boolean = false,
        val message: String,
        val url: String? = null,
        val openUrl: String? = null,
    ) : UpdatePreview
}

enum class PreviewFailureReason { NOT_FOUND, NO_URL, RESOLVE_FAILED, REJECTED }

/** 语法检查失败时返回原因，通过时返回 null；app 侧用 QuickJS 编译实现。 */
fun interface ScriptSyntaxChecker {
    fun check(script: String): String?
}

object UpdatePlanner {
    // 解析器会跟着网页里的链接到处取内容，网盘和下载页随手就能返回几百兆的东西，
    // 不挡住就会把一大坨写进存储；9MB 这条线是音源脚本实际大小往上留的余量
    private const val MAX_SCRIPT_LENGTH = 9_000_000

    private val BUILD_TIME_FORMATTER = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")

    fun planUpdate(
        currentName: String,
        storedScript: String,
        newScript: String,
        allowDowngrade: Boolean = false,
        syntaxChecker: ScriptSyntaxChecker = ScriptSyntaxChecker { null },
    ): UpdatePlan {
        if (newScript == storedScript) return UpdatePlan(UpdateAction.UNCHANGED)
        if (newScript.length > MAX_SCRIPT_LENGTH) {
            return UpdatePlan(
                UpdateAction.REJECT,
                reason = UpdateRejectReason.TOO_LARGE,
                message = "更新地址取回的内容太大，不像音源脚本",
            )
        }
        val header = ScriptResolver.parseScriptHeader(newScript)
        if (header == null) {
            return UpdatePlan(
                UpdateAction.REJECT,
                reason = UpdateRejectReason.INVALID_SCRIPT,
                message = "更新地址里的内容不是音源脚本",
            )
        }
        // 作者没写 @name 时不拦；写了就必须是同一个源，否则等于用别人的音源覆盖你正在用的这个
        if (header.name.isNotEmpty() && currentName.isNotEmpty() && !sameName(header.name, currentName)) {
            val message =
                "更新地址返回的是另一个音源「${header.name}」，和当前源「$currentName」对不上，" +
                    "已跳过（这个地址可能填错了）"
            return UpdatePlan(
                UpdateAction.REJECT,
                reason = UpdateRejectReason.NAME_MISMATCH,
                message = message,
            )
        }
        // 编译最贵，放在其它检查之后：头部注释齐全、名字也对得上的半截文件只能靠这一步认出来
        val syntaxMessage = syntaxChecker.check(newScript)
        if (syntaxMessage != null) {
            return UpdatePlan(
                UpdateAction.REJECT,
                reason = UpdateRejectReason.SYNTAX_ERROR,
                message = "新版脚本语法不完整，不能覆盖当前这份（$syntaxMessage）",
            )
        }
        val fromHeader = ScriptResolver.parseScriptHeader(storedScript)
        val fromVersion = fromHeader?.version.orEmpty()
        val fromBuildTime = fromHeader?.buildTime ?: 0L
        val toVersion = header.version
        val toBuildTime = header.buildTime
        val versionCompared = VersionCompare.compare(toVersion, fromVersion)
        // 某个固定提交的地址会一直返回同一版旧脚本；按它自动更新会让源越更越旧，
        // 所以认得出的旧版本一律不写。认不出（作者没用数字版本）时不拦，不能凭空猜。
        if (!allowDowngrade && versionCompared == -1) {
            return UpdatePlan(
                UpdateAction.REJECT,
                reason = UpdateRejectReason.OLDER,
                header = header,
                fromVersion = fromVersion,
                toVersion = toVersion,
                comparison = UpdateComparison.SAME,
                message = "更新地址里是旧版本（$toVersion），当前已经是 $fromVersion，不能越更越旧",
            )
        }
        // 一天发好几版的源常把 @version 只写到日期，同版本号的新旧只能看构建时间。
        // 没这条的话，多个 CDN 镜像缓存进度不同时，旧节点会被当成「同版本新内容」写回去。
        if (
            !allowDowngrade &&
            versionCompared == 0 &&
            fromBuildTime > 0 &&
            toBuildTime > 0 &&
            toBuildTime < fromBuildTime
        ) {
            val message =
                "更新地址里是同一版本的旧构建（${formatBuildTime(toBuildTime)}），" +
                    "当前已经是 ${formatBuildTime(fromBuildTime)} 的构建，不能越更越旧"
            return UpdatePlan(
                UpdateAction.REJECT,
                reason = UpdateRejectReason.OLDER,
                header = header,
                fromVersion = fromVersion,
                toVersion = toVersion,
                comparison = UpdateComparison.SAME,
                message = message,
            )
        }
        val comparison =
            when {
                versionCompared == null -> UpdateComparison.UNKNOWN
                versionCompared > 0 -> UpdateComparison.NEWER
                versionCompared == 0 && toBuildTime > 0 && fromBuildTime > 0 && toBuildTime > fromBuildTime ->
                    UpdateComparison.NEWER
                else -> UpdateComparison.SAME
            }
        return UpdatePlan(
            UpdateAction.WRITE,
            header = header,
            fromVersion = fromVersion,
            toVersion = toVersion,
            comparison = comparison,
        )
    }

    fun previewUpdate(
        name: String,
        storedScript: String,
        script: String,
        url: String,
        syntaxChecker: ScriptSyntaxChecker = ScriptSyntaxChecker { null },
    ): UpdatePreview {
        val plan =
            planUpdate(
                currentName = name,
                storedScript = storedScript,
                newScript = script,
                syntaxChecker = syntaxChecker,
            )
        return when (plan.action) {
            UpdateAction.UNCHANGED -> UpdatePreview.UpToDate(name)
            UpdateAction.REJECT -> {
                val header = plan.header
                if (plan.reason == UpdateRejectReason.OLDER && header != null) {
                    UpdatePreview.Older(
                        name = name,
                        fromVersion = plan.fromVersion,
                        toVersion = plan.toVersion,
                        url = url,
                        script = script,
                        header = header,
                    )
                } else {
                    UpdatePreview.Failed(
                        reason = PreviewFailureReason.REJECTED,
                        rejectReason = plan.reason,
                        message = plan.message ?: "无法更新",
                        url = url,
                    )
                }
            }
            UpdateAction.WRITE -> {
                val header = plan.header
                if (header == null) {
                    UpdatePreview.Failed(
                        reason = PreviewFailureReason.REJECTED,
                        message = "无法更新",
                        url = url,
                    )
                } else {
                    UpdatePreview.Available(
                        name = name,
                        fromVersion = plan.fromVersion,
                        toVersion = plan.toVersion,
                        comparison = plan.comparison ?: UpdateComparison.UNKNOWN,
                        url = url,
                        script = script,
                        header = header,
                    )
                }
            }
        }
    }

    /**
     * 更新地址只回了版本描述、没有可下载脚本时的结论。
     *
     * 念心、长青这类源把 updateUrl 指向网盘/文档页，网页里永远找不到脚本：
     * 同版或更旧说明用户已经是最新；确实更新时只能让用户自己打开作者给的页面。
     *
     * @return null 表示版本号格式认不出，调用方按普通失败处理
     */
    fun previewDescriptor(
        name: String,
        storedScript: String,
        descriptor: VersionDescriptor,
        url: String? = null,
    ): UpdatePreview? {
        val currentVersion = ScriptResolver.parseScriptHeader(storedScript)?.version.orEmpty()
        val compared = VersionCompare.compare(descriptor.version, currentVersion) ?: return null
        if (compared <= 0) return UpdatePreview.UpToDate(name)
        val openUrl = descriptor.url.ifEmpty { url.orEmpty() }
        return UpdatePreview.Failed(
            reason = PreviewFailureReason.RESOLVE_FAILED,
            versionPage = true,
            message = "发现新版本 ${descriptor.version}，但更新地址给的是网页，没法自动下载，请手动打开更新页面",
            openUrl = openUrl.ifEmpty { null },
        )
    }

    /**
     * 一个源可能同时有用户填的、脚本这次报的、头部存的三个地址。
     * 可更新优先；都不行时也要挑一个最能说明问题的结论给用户。
     */
    fun pickBestPreview(previews: List<UpdatePreview>): UpdatePreview? {
        if (previews.isEmpty()) return null
        val available = previews.filterIsInstance<UpdatePreview.Available>()
        if (available.isNotEmpty()) {
            return available.reduce { best, current ->
                val compared = VersionCompare.compare(current.toVersion, best.toVersion)
                when {
                    compared != null && compared > 0 -> current
                    // 同版本号时构建时间更晚的那份才是新的：jsDelivr 不同镜像可能一个还停在旧构建
                    compared == 0 &&
                        current.header.buildTime > 0 &&
                        best.header.buildTime > 0 &&
                        current.header.buildTime > best.header.buildTime -> current
                    else -> best
                }
            }
        }
        return previews.firstOrNull { it is UpdatePreview.UpToDate }
            ?: previews.firstOrNull { it is UpdatePreview.Older }
            ?: previews.first()
    }

    private fun sameName(
        a: String,
        b: String,
    ): Boolean = a.trim().equals(b.trim(), ignoreCase = true)

    private fun formatBuildTime(time: Long): String = BUILD_TIME_FORMATTER.format(Instant.ofEpochMilli(time).atOffset(ZoneOffset.UTC))
}
