package cn.toside.music.nativeapp.deeplink

import android.content.Context
import android.net.Uri
import android.widget.Toast
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.platform.LocalContext
import cn.toside.music.core.backup.BackupManager
import cn.toside.music.core.storage.StorageKeys
import cn.toside.music.nativeapp.player.PlayerRuntime
import cn.toside.music.nativeapp.util.SafDocuments
import com.moriafly.salt.ui.UnstableSaltUiApi
import com.moriafly.salt.ui.dialog.YesNoDialog
import kotlinx.coroutines.launch

/**
 * 文件打开确认层（对照 RN `handleFileLXMCAction` / `handleFileJSAction`）。
 *
 * 宿主是首页（常驻组合，进详情页也不销毁），所以 deeplink 落在任何界面都能弹出来。
 * 本波认 json / lxmc（列表备份导入）与 js（自定义音源导入）；
 * 音频文件不经过这里——RN 的 `handleFileMusicAction` 不弹确认，直接进试听列表起播
 * （见 [DeeplinkRuntime]）。
 */
@OptIn(UnstableSaltUiApi::class)
@Composable
fun DeeplinkFileHost() {
    val request by DeeplinkRuntime.fileRequest.collectAsState()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val runtime = remember { PlayerRuntime.get(context) }
    val backup = remember { BackupManager(runtime.lists.store) }
    val pending = request ?: return

    val uri = remember(pending.uri) { Uri.parse(pending.uri) }
    val fileName = remember(pending.uri) { SafDocuments.displayName(context, uri) ?: pending.uri.substringAfterLast('/') }

    fun toast(message: String) = Toast.makeText(context, message, Toast.LENGTH_SHORT).show()

    YesNoDialog(
        onDismissRequest = { DeeplinkRuntime.clearFileRequest() },
        onConfirm = {
            DeeplinkRuntime.clearFileRequest()
            scope.launch {
                if (pending.kind == FileKind.USER_API_SCRIPT) {
                    importUserApiScript(context, uri, runtime, ::toast)
                    return@launch
                }
                runtime.lists.ensureLoaded()
                val bytes =
                    SafDocuments.readBytes(context, uri).getOrElse {
                        toast("列表导入失败😕")
                        return@launch
                    }
                val result =
                    if (pending.extension == "json") {
                        backup.importJson(bytes.toString(Charsets.UTF_8), BackupManager.PartConflictMode.RENAME_COPY)
                    } else {
                        backup.import(bytes, BackupManager.PartConflictMode.RENAME_COPY)
                    }
                when (result) {
                    is BackupManager.ImportResult.PartImported -> {
                        toast("导入成功🎉")
                        runtime.core.handleListMusicsUpdated(listOf(result.listInfo.id))
                    }
                    BackupManager.ImportResult.FullImported -> {
                        toast("导入成功🎉")
                        val userLists = runtime.lists.store.state.value.userLists
                        val affected =
                            buildList {
                                add(StorageKeys.ListIds.DEFAULT)
                                add(StorageKeys.ListIds.LOVE)
                                userLists.forEach { add(it.id) }
                            }
                        runtime.core.handleListMusicsUpdated(affected)
                    }
                    is BackupManager.ImportResult.Unsupported -> toast("未知的文件类型，请尝试升级到最新版本后再试")
                    BackupManager.ImportResult.ParseError -> toast("列表导入失败😕")
                }
            }
        },
        title = if (pending.kind == FileKind.USER_API_SCRIPT) "导入音源" else "导入列表",
        content =
            if (pending.kind == FileKind.USER_API_SCRIPT) {
                "确认要导入音源文件「$fileName」吗？"
            } else {
                "确认要导入列表文件「$fileName」吗？"
            },
        cancelText = "取消",
        confirmText = "确定",
    )
}

/**
 * `.js` 音源导入（对照 RN `handleFileJSAction` → `handleImportLocalFile`）。
 *
 * 只调既有公开流程 [UserApiRuntime.importScript]（与设置页「粘贴脚本」同一个入口），
 * 不碰 `userapi/` 内部；导入失败按 RN 的习惯把原因直接提示出来。
 */
private suspend fun importUserApiScript(
    context: Context,
    uri: Uri,
    runtime: PlayerRuntime,
    toast: (String) -> Unit,
) {
    val script =
        SafDocuments.readText(context, uri).getOrElse {
            toast("音源导入失败😕")
            return
        }
    // 用播放器的进程级实例，导入后与播放器/设置页共用同一个源清单
    val result = runtime.userApi.importScript(script)
    result.onSuccess { toast("导入成功🎉") }
    result.onFailure { toast("音源导入失败：${it.message ?: "脚本格式不正确"}") }
}
