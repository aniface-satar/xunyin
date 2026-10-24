package cn.toside.music.core.userapi

/**
 * 「这次按这些地址去取，最后得出什么结论」—— RN
 * `src/core/userApiUpdate/index.ts` 里 `previewUserApiUpdateOnce` 的移植。
 *
 * 只取地址、算结论，不碰存储；网络由注入的 [ScriptFetcher] 提供，
 * 真机上换脚本与失败回滚由 app 侧执行器负责。
 *
 * 一个源可能同时列出多个地址：先按用户填的/脚本报的/头部存的顺序试，
 * 第一个地址已经确认能升到更高版本就停；否则继续试，最后挑最好的那个结论。
 * 主地址全是失败时再走目录给的备用线路；已经拿到明确结论就不替作者多花请求。
 */
data class UpdateCheckRequest(
    val name: String,
    val storedScript: String,
    val source: UpdateUrlSource,
    /** 脚本这次上报的地址 */
    val eventUrl: String? = null,
    /** 手动更新里用户这次填的地址：只试它，不拿存档地址顶替 */
    val overrideUrl: String? = null,
    /** 后台定时检查：本地内置源只试脚本自带的地址 */
    val scheduled: Boolean = false,
)

object UpdateCheck {
    suspend fun preview(
        request: UpdateCheckRequest,
        fetcher: ScriptFetcher,
        catalog: BuiltinUpdateCatalog = BuiltinUpdateCatalog.EMPTY,
        syntaxChecker: ScriptSyntaxChecker = ScriptSyntaxChecker { null },
    ): UpdatePreview {
        val plan =
            UpdateSchedule.planUpdateUrls(
                api = request.source,
                eventUrl = request.eventUrl,
                options = UpdateUrlOptions(overrideUrl = request.overrideUrl, scheduled = request.scheduled),
                catalog = catalog,
            )
        if (plan.primary.isEmpty() && plan.fallback.isEmpty()) {
            return UpdatePreview.Failed(
                reason = PreviewFailureReason.NO_URL,
                message = "这个源没有可用的更新地址",
            )
        }

        val currentVersion = ScriptResolver.parseScriptHeader(request.storedScript)?.version.orEmpty()
        val previews = mutableListOf<UpdatePreview>()

        suspend fun tryUrls(urls: List<String>): Boolean {
            for (url in urls) {
                val resolved =
                    ScriptResolver.resolveScriptFromUrl(
                        url,
                        ScriptResolveOptions(
                            fetcher = fetcher,
                            hint = request.name,
                            currentVersion = currentVersion,
                        ),
                    )
                when (resolved) {
                    is ScriptResolveResult.Success -> {
                        val preview =
                            UpdatePlanner.previewUpdate(
                                name = request.name,
                                storedScript = request.storedScript,
                                script = resolved.script,
                                url = url,
                                syntaxChecker = syntaxChecker,
                            )
                        previews.add(preview)
                        // 正常情况只有一个候选；已经确认能升级就不用再花请求试备用的
                        if (preview is UpdatePreview.Available && preview.comparison == UpdateComparison.NEWER) return true
                    }
                    is ScriptResolveResult.Failure -> {
                        // 版本接口查过当前版本说「已是最新」：这是检查成功，不是地址坏了
                        if (resolved.reason == ResolveFailureReason.NO_UPDATE) {
                            previews.add(UpdatePreview.UpToDate(request.name))
                            continue
                        }
                        // 只给了版本号、网页里没有脚本：版本相同也是「已最新」，只有确实更新才报手动更新
                        val byDescriptor =
                            resolved.descriptor?.let { descriptor ->
                                UpdatePlanner.previewDescriptor(
                                    name = request.name,
                                    storedScript = request.storedScript,
                                    descriptor = descriptor,
                                    url = url,
                                )
                            }
                        previews.add(
                            byDescriptor
                                ?: UpdatePreview.Failed(
                                    reason = PreviewFailureReason.RESOLVE_FAILED,
                                    message = resolved.message,
                                    url = url,
                                    openUrl = url,
                                ),
                        )
                    }
                }
            }
            return false
        }

        if (tryUrls(plan.primary)) return previews.last()
        if (plan.fallback.isNotEmpty() && previews.all { it is UpdatePreview.Failed }) {
            if (tryUrls(plan.fallback)) return previews.last()
        }
        return UpdatePlanner.pickBestPreview(previews)
            ?: UpdatePreview.Failed(
                reason = PreviewFailureReason.RESOLVE_FAILED,
                message = "更新地址没有返回可用结果",
            )
    }
}
