package cn.toside.music.nativeapp.userapi

import cn.toside.music.core.userapi.ApplyUpdateResult
import cn.toside.music.core.userapi.PreviewFailureReason
import cn.toside.music.core.userapi.ScriptFetcher
import cn.toside.music.core.userapi.ScriptSyntaxChecker
import cn.toside.music.core.userapi.ToastKind
import cn.toside.music.core.userapi.UpdateAlertPlan
import cn.toside.music.core.userapi.UpdateAlertSettings
import cn.toside.music.core.userapi.UpdateAlerts
import cn.toside.music.core.userapi.UpdateCheck
import cn.toside.music.core.userapi.UpdateCheckRequest
import cn.toside.music.core.userapi.UpdateExecutor
import cn.toside.music.core.userapi.UpdateFailureReason
import cn.toside.music.core.userapi.UpdateOutcome
import cn.toside.music.core.userapi.UpdatePreview
import cn.toside.music.core.userapi.UpdateRejectReason
import cn.toside.music.core.userapi.UpdateSchedule
import cn.toside.music.core.userapi.UserApiUpdateCheckMode
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/** app 侧更新结论比 `:core` 的 [UpdateOutcome] 多带版本与回滚信息，供 UI/日志使用。 */
enum class UserApiUpdateStatus { UPDATED, UNCHANGED, OLDER, FAILED }

data class UserApiUpdateOutcome(
    val status: UserApiUpdateStatus,
    val name: String,
    val fromVersion: String = "",
    val toVersion: String = "",
    val reason: UpdateFailureReason? = null,
    val rejectReason: UpdateRejectReason? = null,
    val message: String = "",
    val openUrl: String? = null,
    /** 只有 reload_failed 会带：新版起不来时有没有真的退回旧脚本。 */
    val rolledBack: Boolean = false,
) {
    fun toCoreOutcome(): UpdateOutcome =
        when (status) {
            UserApiUpdateStatus.UPDATED -> UpdateOutcome.Updated(name)
            UserApiUpdateStatus.UNCHANGED -> UpdateOutcome.Unchanged
            UserApiUpdateStatus.OLDER -> UpdateOutcome.Older
            UserApiUpdateStatus.FAILED -> UpdateOutcome.Failed(reason ?: UpdateFailureReason.RESOLVE_FAILED, openUrl)
        }
}

/** 更新检查的设置（B5 设置页接线后由设置层提供；默认值对齐 RN defaultSetting）。 */
data class UpdaterSettings(
    val checkMode: UserApiUpdateCheckMode = UserApiUpdateCheckMode.DAILY,
    val autoUpdate: Boolean = true,
    val allowShowUpdateAlert: Boolean = false,
) {
    fun toAlertSettings(): UpdateAlertSettings =
        UpdateAlertSettings(
            autoUpdate = autoUpdate,
            allowShowUpdateAlert = allowShowUpdateAlert,
        )
}

/**
 * 更新执行层 —— RN `src/core/userApiUpdate/index.ts` 的编排部分：
 * 取地址/算结论走 `:core`，这里负责串行、落盘、换上新脚本后重新加载并验证，
 * 以及起不来时退回备份。
 *
 * 一轮只跑一个更新：两个更新撞在一起，第二个备份到的会是第一个刚换上去的脚本，
 * 那份「最后一个能用的版本」就丢了 —— 所以所有入口共用一把 [Mutex]。
 */
class UserApiUpdater(
    private val store: UserApiSourceStore,
    private val fetcher: ScriptFetcher,
    private val syntaxChecker: ScriptSyntaxChecker,
    private val currentSourceId: () -> String?,
    /** verify=true 是更新后的验证加载：失败由这里回滚，不结算成普通初始化失败。 */
    private val reloadSource: suspend (id: String, verify: Boolean) -> Boolean,
    private val settings: () -> UpdaterSettings = { UpdaterSettings() },
) {
    private val mutex = Mutex()

    var onToast: ((kind: ToastKind, name: String) -> Unit)? = null
    var onConfirm: ((name: String, log: String, url: String) -> Unit)? = null
    var onTip: ((name: String, log: String) -> Unit)? = null
    var onLog: ((type: String, message: String) -> Unit)? = null

    /** 「检查更新」按钮：只取地址、给结论，用户确认后再调 [apply]。 */
    suspend fun preview(
        id: String,
        eventUrl: String? = null,
        overrideUrl: String? = null,
        scheduled: Boolean = false,
    ): UpdatePreview = serialized { previewOnce(id, eventUrl, overrideUrl, scheduled) }

    suspend fun check(
        id: String,
        eventUrl: String? = null,
        overrideUrl: String? = null,
        scheduled: Boolean = false,
    ): UserApiUpdateOutcome = serialized { checkOnce(id, eventUrl, overrideUrl, scheduled) }

    suspend fun apply(
        id: String,
        preview: UpdatePreview,
        allowDowngrade: Boolean = false,
    ): UserApiUpdateOutcome = serialized { applyOnce(id, preview, allowDowngrade) }

    /** 脚本自己报「有新版本」时（`showUpdateAlert` 事件）的完整处理。 */
    suspend fun handleUpdateAlert(
        name: String,
        log: String,
        updateUrl: String,
    ): Unit =
        serialized {
            handleUpdateAlertOnce(name, log, updateUrl)
        }

    /** 按用户选的频率把到期的源过一遍；每个源查之前先记时间，失败也算查过。 */
    suspend fun runScheduledCheck(
        mode: UserApiUpdateCheckMode,
        onOutcome: (id: String, outcome: UserApiUpdateOutcome) -> Unit,
    ): Unit =
        serialized {
            val now = System.currentTimeMillis()
            val currentSettings = settings()
            val candidates = store.list().mapNotNull { source -> store.updateUrlSource(source.id) }
            val targets =
                UpdateSchedule.pickCheckTargets(
                    list = candidates,
                    mode = mode,
                    now = now,
                    autoUpdate = currentSettings.autoUpdate,
                    catalog = store.updateCatalog(),
                )
            for (target in targets) {
                store.setLastCheckAt(target.id, now)
                var outcome: UserApiUpdateOutcome
                try {
                    outcome = checkOnce(target.id, scheduled = true)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    outcome =
                        UserApiUpdateOutcome(
                            status = UserApiUpdateStatus.FAILED,
                            name = target.id,
                            reason = UpdateFailureReason.RESOLVE_FAILED,
                            message = e.message ?: "更新检查失败",
                        )
                }
                // 名字对不上是填错地址，不是网络抖动：只拉黑用户手填的地址，
                // 脚本头部和目录给的地址属于源本身，作者换了内容就会恢复
                if (
                    outcome.status == UserApiUpdateStatus.FAILED &&
                    outcome.rejectReason == UpdateRejectReason.NAME_MISMATCH &&
                    outcome.openUrl != null &&
                    outcome.openUrl == target.updateUrl
                ) {
                    store.setUpdateUrlRejected(target.id, outcome.openUrl)
                }
                onOutcome(target.id, outcome)
            }
        }

    /** 启动后的首次检查（对照 RN `runUserApiUpdateCheckOnStartup`）。 */
    suspend fun runStartupCheck() {
        try {
            runScheduledCheck(settings().checkMode) { _, outcome ->
                when (outcome.status) {
                    UserApiUpdateStatus.UPDATED -> onToast?.invoke(ToastKind.UPDATED, outcome.name)
                    UserApiUpdateStatus.FAILED -> {
                        onLog?.invoke(
                            "error",
                            "user api update check failed: ${outcome.name}, ${outcome.message}" +
                                (outcome.openUrl?.let { " <$it>" } ?: ""),
                        )
                        if (outcome.reason == UpdateFailureReason.RELOAD_FAILED) {
                            onToast?.invoke(ToastKind.FAILED, outcome.name)
                        }
                    }
                    else -> Unit
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            onLog?.invoke("error", "user api update check crashed: ${e.message}")
        }
    }

    /**
     * 保命一跳：盘上这份脚本是自动更新写进去的、还没被验证过，第一次真正加载就起不来。
     * 退回更新前的备份；只做一次 —— 标记先清掉，坏脚本不能靠反复重启一直重试。
     */
    suspend fun rollbackPending(id: String): Boolean =
        serialized {
            if (!store.verifyPending(id)) return@serialized false
            val rolledBack = runCatching { UpdateExecutor.rollbackScript(store, id) }.getOrElse { false }
            // 回滚写完再清标记：反过来的话，中途没电会留下「坏脚本 + 没有标记」，再也救不回来
            store.setVerifyPending(id, false)
            if (rolledBack) onLog?.invoke("info", "user api rolled back to the previous script: $id")
            rolledBack
        }

    private suspend fun <T> serialized(block: suspend () -> T): T = mutex.withLock { block() }

    private suspend fun previewOnce(
        id: String,
        eventUrl: String?,
        overrideUrl: String?,
        scheduled: Boolean,
    ): UpdatePreview =
        withContext(Dispatchers.Default) {
            val source =
                store.updateUrlSource(id)
                    ?: return@withContext UpdatePreview.Failed(PreviewFailureReason.NOT_FOUND, message = "音源不在了")
            val storedScript = store.readScript(id)
            if (storedScript.isEmpty()) {
                return@withContext UpdatePreview.Failed(PreviewFailureReason.NOT_FOUND, message = "音源不在了")
            }
            UpdateCheck.preview(
                request =
                    UpdateCheckRequest(
                        name = store.nameOf(id),
                        storedScript = storedScript,
                        source = source,
                        eventUrl = eventUrl,
                        overrideUrl = overrideUrl,
                        scheduled = scheduled,
                    ),
                fetcher = fetcher,
                catalog = store.updateCatalog(),
                syntaxChecker = syntaxChecker,
            )
        }

    private suspend fun checkOnce(
        id: String,
        eventUrl: String? = null,
        overrideUrl: String? = null,
        scheduled: Boolean = false,
    ): UserApiUpdateOutcome {
        val preview = previewOnce(id, eventUrl, overrideUrl, scheduled)
        return when (preview) {
            is UpdatePreview.UpToDate -> UserApiUpdateOutcome(UserApiUpdateStatus.UNCHANGED, preview.name)
            is UpdatePreview.Older ->
                UserApiUpdateOutcome(
                    status = UserApiUpdateStatus.OLDER,
                    name = preview.name,
                    fromVersion = preview.fromVersion,
                    toVersion = preview.toVersion,
                )
            is UpdatePreview.Failed ->
                UserApiUpdateOutcome(
                    status = UserApiUpdateStatus.FAILED,
                    name = store.nameOf(id),
                    reason = preview.reason.toFailureReason(),
                    rejectReason = preview.rejectReason,
                    message = preview.message,
                    // 带上实际试过的地址：日志里只看得到「取不到」，不知道取的是哪条线路
                    openUrl = preview.openUrl ?: preview.url,
                )
            is UpdatePreview.Available -> applyOnce(id, preview, allowDowngrade = false)
        }
    }

    private suspend fun applyOnce(
        id: String,
        preview: UpdatePreview,
        allowDowngrade: Boolean,
    ): UserApiUpdateOutcome {
        val script =
            when (preview) {
                is UpdatePreview.Available -> preview.script
                is UpdatePreview.Older -> preview.script
                else ->
                    return UserApiUpdateOutcome(
                        status = UserApiUpdateStatus.FAILED,
                        name = store.nameOf(id),
                        reason = UpdateFailureReason.REJECTED,
                        message = "这份更新结果不能应用",
                    )
            }
        val name = store.nameOf(id)
        // 上一版还没被验证过就不能拿它当备份，留住更早那份已知能用的
        val keepBackup = store.verifyPending(id)
        val applied =
            withContext(Dispatchers.Default) {
                UpdateExecutor.applyUpdateScript(
                    store = store,
                    id = id,
                    name = name,
                    script = script,
                    keepBackup = keepBackup,
                    allowDowngrade = allowDowngrade,
                    syntaxChecker = syntaxChecker,
                )
            }
        return when (applied) {
            is ApplyUpdateResult.Unchanged -> UserApiUpdateOutcome(UserApiUpdateStatus.UNCHANGED, name)
            is ApplyUpdateResult.Older ->
                UserApiUpdateOutcome(
                    status = UserApiUpdateStatus.OLDER,
                    name = name,
                    fromVersion = applied.fromVersion,
                    toVersion = applied.toVersion,
                    message = applied.message,
                )
            is ApplyUpdateResult.Rejected ->
                UserApiUpdateOutcome(
                    status = UserApiUpdateStatus.FAILED,
                    name = name,
                    reason = UpdateFailureReason.REJECTED,
                    rejectReason = applied.reason,
                    message = applied.message,
                )
            is ApplyUpdateResult.Updated -> {
                val updatedName = applied.header.name.ifEmpty { name }
                // 不是正在用的源就不必重新加载：换过去的时候自然会用到新脚本
                if (currentSourceId() != id) {
                    // 但这份脚本还没被任何一次加载验证过，先记上：它起不来时得能退回备份
                    store.setVerifyPending(id, true)
                    UserApiUpdateOutcome(
                        status = UserApiUpdateStatus.UPDATED,
                        name = updatedName,
                        fromVersion = applied.fromVersion,
                        toVersion = applied.toVersion,
                    )
                } else {
                    verifyCurrentSource(id, updatedName, applied)
                }
            }
        }
    }

    private suspend fun verifyCurrentSource(
        id: String,
        name: String,
        applied: ApplyUpdateResult.Updated,
    ): UserApiUpdateOutcome {
        val ok = runCatching { reloadSource(id, true) }.getOrElse { false }
        if (ok) {
            return UserApiUpdateOutcome(
                status = UserApiUpdateStatus.UPDATED,
                name = name,
                fromVersion = applied.fromVersion,
                toVersion = applied.toVersion,
            )
        }

        onLog?.invoke("error", "user api reload failed: $name")
        val rolledBack = runCatching { UpdateExecutor.rollbackScript(store, id) }.getOrElse { false }
        if (rolledBack) onLog?.invoke("info", "user api rolled back to the previous script: $name")
        // 没有备份可回滚时盘上留的仍是坏脚本，更要按普通加载再结算一次，
        // 不让运行时停在一个和盘上文件不一致的状态
        runCatching { reloadSource(id, false) }
        return UserApiUpdateOutcome(
            status = UserApiUpdateStatus.FAILED,
            name = name,
            reason = UpdateFailureReason.RELOAD_FAILED,
            message = if (rolledBack) "新脚本加载不起来，已退回更新前的版本" else "新脚本加载不起来，而且没有可退回的备份",
            rolledBack = rolledBack,
        )
    }

    private suspend fun handleUpdateAlertOnce(
        name: String,
        log: String,
        updateUrl: String,
    ) {
        val id = currentSourceId() ?: return
        val currentSettings = settings()
        var outcome: UserApiUpdateOutcome? = null
        if (currentSettings.autoUpdate) {
            outcome =
                try {
                    checkOnce(id, eventUrl = updateUrl, scheduled = true)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    UserApiUpdateOutcome(
                        status = UserApiUpdateStatus.FAILED,
                        name = name,
                        reason = UpdateFailureReason.RESOLVE_FAILED,
                        message = e.message ?: "更新检查失败",
                    )
                }
            if (
                outcome.status == UserApiUpdateStatus.FAILED &&
                outcome.rejectReason == UpdateRejectReason.NAME_MISMATCH &&
                outcome.openUrl != null
            ) {
                store.setUpdateUrlRejected(id, outcome.openUrl)
            }
            if (outcome.status == UserApiUpdateStatus.FAILED && outcome.reason == UpdateFailureReason.NO_URL) {
                // 没有可自动检查的地址不是失败：下面还能按脚本报的地址提醒用户手动更新
                outcome = null
            } else if (outcome.status == UserApiUpdateStatus.FAILED) {
                onLog?.invoke(
                    "error",
                    "auto update user api failed: $name, ${outcome.message}" +
                        (outcome.openUrl?.let { " <$it>" } ?: ""),
                )
            }
        }
        when (val plan = UpdateAlerts.plan(currentSettings.toAlertSettings(), outcome?.toCoreOutcome(), updateUrl)) {
            is UpdateAlertPlan.Toast -> {
                val toastName = if (outcome?.status == UserApiUpdateStatus.UPDATED) outcome.name else name
                onToast?.invoke(plan.kind, toastName)
            }
            is UpdateAlertPlan.Confirm -> onConfirm?.invoke(name, log, plan.url)
            UpdateAlertPlan.Tip -> onTip?.invoke(name, log)
            UpdateAlertPlan.Silent -> Unit
        }
    }
}

private fun PreviewFailureReason.toFailureReason(): UpdateFailureReason =
    when (this) {
        PreviewFailureReason.NOT_FOUND -> UpdateFailureReason.NOT_FOUND
        PreviewFailureReason.NO_URL -> UpdateFailureReason.NO_URL
        PreviewFailureReason.RESOLVE_FAILED -> UpdateFailureReason.RESOLVE_FAILED
        PreviewFailureReason.REJECTED -> UpdateFailureReason.REJECTED
    }
