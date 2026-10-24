package cn.toside.music.core.userapi

/**
 * 「把新脚本写进源、失败能退回」—— RN `src/core/userApiUpdate/applyUpdate.ts` 的后半段。
 *
 * 写入顺序是先备份、后覆盖：新脚本在 QuickJS 里起不来时还能还原。
 * 存储细节由 app 侧实现（内置源来自 assets，自定义源来自 KvStore），这里只管顺序与闸门。
 */
interface UserApiScriptStore {
    suspend fun readScript(id: String): String

    suspend fun writeScript(
        id: String,
        script: String,
        header: ScriptHeaderInfo?,
    )

    suspend fun writeBackup(
        id: String,
        script: String,
    )

    suspend fun readBackup(id: String): String?
}

sealed interface ApplyUpdateResult {
    data class Updated(
        val header: ScriptHeaderInfo,
        val fromVersion: String,
        val toVersion: String,
    ) : ApplyUpdateResult

    data object Unchanged : ApplyUpdateResult

    data class Older(
        val fromVersion: String,
        val toVersion: String,
        val message: String,
    ) : ApplyUpdateResult

    data class Rejected(
        val reason: UpdateRejectReason,
        val message: String,
    ) : ApplyUpdateResult
}

object UpdateExecutor {
    suspend fun applyUpdateScript(
        store: UserApiScriptStore,
        id: String,
        name: String,
        script: String,
        keepBackup: Boolean = false,
        allowDowngrade: Boolean = false,
        syntaxChecker: ScriptSyntaxChecker = ScriptSyntaxChecker { null },
    ): ApplyUpdateResult {
        val stored = store.readScript(id)
        val plan =
            UpdatePlanner.planUpdate(
                currentName = name,
                storedScript = stored,
                newScript = script,
                allowDowngrade = allowDowngrade,
                syntaxChecker = syntaxChecker,
            )
        when (plan.action) {
            UpdateAction.UNCHANGED -> return ApplyUpdateResult.Unchanged
            UpdateAction.REJECT -> {
                if (plan.reason == UpdateRejectReason.OLDER) {
                    return ApplyUpdateResult.Older(
                        fromVersion = plan.fromVersion,
                        toVersion = plan.toVersion,
                        message = plan.message ?: "不能更新到更旧的版本",
                    )
                }
                return ApplyUpdateResult.Rejected(
                    reason = plan.reason ?: UpdateRejectReason.INVALID_SCRIPT,
                    message = plan.message ?: "无法更新",
                )
            }
            UpdateAction.WRITE -> Unit
        }

        // 先备份再覆盖：万一新脚本在 QuickJS 里加载不起来，还有东西可以还原
        if (!keepBackup) store.writeBackup(id, stored)
        val header = plan.header ?: return ApplyUpdateResult.Rejected(UpdateRejectReason.INVALID_SCRIPT, "无法更新")
        store.writeScript(id, script, header)
        return ApplyUpdateResult.Updated(
            header = header,
            fromVersion = plan.fromVersion,
            toVersion = plan.toVersion,
        )
    }

    /** 备份是「上一个还能听的脚本」，还原时不再拿头部注释格式卡它。 */
    suspend fun rollbackScript(
        store: UserApiScriptStore,
        id: String,
    ): Boolean {
        val backup = store.readBackup(id) ?: return false
        store.writeScript(id, backup, ScriptResolver.parseScriptHeader(backup))
        return true
    }
}
