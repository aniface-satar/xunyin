package cn.toside.music.nativeapp.ui.list

import android.content.Context
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import cn.toside.music.core.backup.BackupManager
import cn.toside.music.core.list.ListStore
import cn.toside.music.core.list.MusicSort
import cn.toside.music.core.list.MusicSortId
import cn.toside.music.core.storage.StorageKeys
import cn.toside.music.nativeapp.player.PlayerRuntime
import cn.toside.music.nativeapp.util.SafDocuments
import com.moriafly.salt.ui.Button
import com.moriafly.salt.ui.ButtonAppearance
import com.moriafly.salt.ui.ItemCheck
import com.moriafly.salt.ui.SaltTheme
import com.moriafly.salt.ui.Text
import com.moriafly.salt.ui.UnstableSaltUiApi
import com.moriafly.salt.ui.dialog.BasicDialog
import com.moriafly.salt.ui.dialog.DialogTitle
import com.moriafly.salt.ui.dialog.InputDialog
import com.moriafly.salt.ui.dialog.YesNoDialog
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.util.Locale

// 列表操作的共享实现（W5-9 菜单统一）。
//
// 首页长按菜单（ListMenuHost）与列表详情页（ListDetailPage）此前各带一份
// 排序 / 导入 / 导出 / 重命名 / 删除逻辑，文案与副作用完全重复。本文件收口为单一实现：
// 宿主只保留各自的后处理（详情页刷新 items、删表后返回；菜单只广播更新）。

/** 排序档位与文案（对照 RN `MyList/ListMusicSort.tsx` + `zh-cn.json#list_sort_option_*`）。 */
internal val LIST_SORT_OPTIONS: List<Pair<String, String>> =
    listOf(
        "name" to "标题",
        "album" to "专辑（音轨）",
        "duration_up" to "时长（短→长）",
        "duration_down" to "时长（长→短）",
        "add_time_up" to "添加时间",
        "add_time_down" to "添加时间降序",
        "singer" to "歌手",
        "year" to "年份",
        "play_count" to "播放次数",
    )

/**
 * 排序语言：优先设置里的 `common.langId`（RN `global.i18n.locale`），
 * 未设置时退回系统语言；下划线形式由 [MusicSort] 归一化。
 */
internal fun listSortLocaleId(runtime: PlayerRuntime): String =
    runtime.settings.store
        .string("common.langId")
        .ifEmpty { Locale.getDefault().toLanguageTag() }

/** 本地是否已有同 id 列表（含内置列表）；返回其展示名供冲突弹窗使用。 */
internal fun localListName(
    runtime: PlayerRuntime,
    id: String,
): String? = localListNameOf(id, runtime.lists.store.state.value.userLists)

internal fun localListNameOf(
    id: String,
    userLists: List<ListStore.UserListInfo>,
): String? =
    when (id) {
        StorageKeys.ListIds.DEFAULT -> "试听列表"
        StorageKeys.ListIds.LOVE -> "我的收藏"
        else -> userLists.firstOrNull { it.id == id }?.name
    }

/** 整表按档位重排后落库，并同步随机队列（两个宿主的排序行为完全相同）。 */
internal suspend fun applyListSort(
    runtime: PlayerRuntime,
    listId: String,
    sortId: MusicSortId,
    localeId: String,
) {
    val current = runtime.lists.musics(listId)
    // 对照 RN ListMusicSort.tsx：添加时间按 `${listId}/${musicId}` 取，播放次数按 musicId 取
    val addTimes = runtime.lists.stats.addTimes()
    val playCounts = runtime.lists.stats.playCounts()
    val sorted =
        MusicSort.sort(
            current,
            sortId,
            localeId,
            getAddTime = { addTimes["$listId/$it"] ?: 0L },
            getPlayCount = { playCounts[it] ?: 0L },
        )
    runtime.lists.store.listMusicUpdatePosition(listId, 0, sorted.mapNotNull { it.text("id") })
    runtime.core.handleListMusicsUpdated(listOf(listId))
}

/** SAF 读到的待导入文件；plainJson 决定走 `importJson` 还是 gzip 解包路径（RN 按扩展名分流）。 */
internal data class PendingImportFile(
    val bytes: ByteArray,
    val plainJson: Boolean,
)

/** 单列表导入冲突信息（对照 RN handleImportListPart 的覆盖确认）。 */
internal data class ImportConflictInfo(
    val pending: PendingImportFile,
    val importName: String,
    val localName: String,
)

/** 选中文件后的分流结果（纯函数 [importDecision] 的产物，便于等值用例）。 */
internal sealed interface ImportDecision {
    data class Conflict(
        val info: ImportConflictInfo,
    ) : ImportDecision

    data class Ready(
        val pending: PendingImportFile,
        val mode: BackupManager.PartConflictMode,
    ) : ImportDecision

    data class FullBackup(
        val pending: PendingImportFile,
    ) : ImportDecision

    data object Unsupported : ImportDecision

    data object ParseError : ImportDecision
}

/**
 * 导入分流（对照 RN importPlayList）：单列表文件先判 ID 冲突，
 * 其余一律按整表备份二次确认；预览失败即解析失败。
 */
internal fun importDecision(
    preview: BackupManager.BackupPreview?,
    pending: PendingImportFile,
    localName: (String) -> String?,
): ImportDecision {
    if (preview == null) return ImportDecision.ParseError
    if (preview.type == "playListPart" || preview.type == "playListPart_v2") {
        val partId = preview.partId ?: return ImportDecision.ParseError
        val existing = localName(partId)
        return if (existing != null) {
            ImportDecision.Conflict(ImportConflictInfo(pending, preview.partName.orEmpty(), existing))
        } else {
            ImportDecision.Ready(pending, BackupManager.PartConflictMode.RENAME_COPY)
        }
    }
    return ImportDecision.FullBackup(pending)
}

/** 读入 SAF 选中文件并给出分流结果。 */
internal suspend fun readListImport(
    context: Context,
    uri: Uri,
    backup: BackupManager,
    runtime: PlayerRuntime,
): ImportDecision {
    val displayName = SafDocuments.displayName(context, uri)
    if (!SafDocuments.isSupportedImport(displayName)) return ImportDecision.Unsupported
    val bytes = SafDocuments.readBytes(context, uri).getOrElse { return ImportDecision.ParseError }
    val pending = PendingImportFile(bytes, SafDocuments.isPlainJson(displayName))
    val preview =
        if (pending.plainJson) {
            backup.previewJson(bytes.toString(Charsets.UTF_8))
        } else {
            backup.preview(bytes)
        }
    return importDecision(preview, pending) { localListName(runtime, it) }
}

/** 按冲突策略落库；与 RN 的「先 toast 再广播」顺序一致由调用方保证。 */
internal suspend fun executeListImport(
    backup: BackupManager,
    pending: PendingImportFile,
    mode: BackupManager.PartConflictMode,
): BackupManager.ImportResult =
    if (pending.plainJson) {
        backup.importJson(pending.bytes.toString(Charsets.UTF_8), mode)
    } else {
        backup.import(pending.bytes, mode)
    }

/** 导入流程对宿主暴露的状态与动作。 */
internal class ListImportFlow(
    val importing: Boolean,
    val conflict: ImportConflictInfo?,
    val fullConfirm: PendingImportFile?,
    val start: (Uri) -> Unit,
    val resolveConflict: (overwrite: Boolean) -> Unit,
    val confirmFull: () -> Unit,
    val dismissConflict: () -> Unit,
    val dismissFull: () -> Unit,
)

/**
 * 导入流程状态机（读取 → 预览 → 冲突/整表确认 → 落库）。
 *
 * [onImported] 只做宿主专属后处理（详情页刷新列表 / 删表后返回、菜单广播更新），
 * toast 文案与落库策略在共享侧统一，保证两边行为一致。
 */
@Composable
internal fun rememberListImportFlow(
    runtime: PlayerRuntime,
    backup: BackupManager,
    toast: (String) -> Unit,
    onImported: suspend (BackupManager.ImportResult) -> Unit,
): ListImportFlow {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var importing by remember { mutableStateOf(false) }
    var conflict by remember { mutableStateOf<ImportConflictInfo?>(null) }
    var fullConfirm by remember { mutableStateOf<PendingImportFile?>(null) }

    fun runImport(
        pending: PendingImportFile,
        mode: BackupManager.PartConflictMode,
    ) {
        scope.launch {
            importing = true
            val result = executeListImport(backup, pending, mode)
            importing = false
            when (result) {
                is BackupManager.ImportResult.PartImported -> toast("导入成功🎉")
                BackupManager.ImportResult.FullImported -> toast("导入成功🎉")
                is BackupManager.ImportResult.Unsupported -> toast("未知的文件类型，请尝试升级到最新版本后再试")
                BackupManager.ImportResult.ParseError -> toast("列表导入失败😕")
            }
            onImported(result)
        }
    }

    fun start(uri: Uri) {
        scope.launch {
            importing = true
            val decision = readListImport(context, uri, backup, runtime)
            importing = false
            when (decision) {
                is ImportDecision.Conflict -> conflict = decision.info
                is ImportDecision.Ready -> runImport(decision.pending, decision.mode)
                is ImportDecision.FullBackup -> fullConfirm = decision.pending
                ImportDecision.Unsupported -> toast("未知的文件类型，请尝试升级到最新版本后再试")
                ImportDecision.ParseError -> toast("列表导入失败😕")
            }
        }
    }

    fun resolveConflict(overwrite: Boolean) {
        val current = conflict ?: return
        conflict = null
        runImport(
            current.pending,
            if (overwrite) BackupManager.PartConflictMode.OVERWRITE else BackupManager.PartConflictMode.RENAME_COPY,
        )
    }

    fun confirmFull() {
        val pending = fullConfirm ?: return
        fullConfirm = null
        runImport(pending, BackupManager.PartConflictMode.RENAME_COPY)
    }

    return ListImportFlow(
        importing = importing,
        conflict = conflict,
        fullConfirm = fullConfirm,
        start = ::start,
        resolveConflict = ::resolveConflict,
        confirmFull = ::confirmFull,
        dismissConflict = { conflict = null },
        dismissFull = { fullConfirm = null },
    )
}

/** 导入文件选择器（两个宿主共用同一 filter）；返回的动作直接拉起选文件。 */
@Composable
internal fun rememberListImportAction(onSelected: (Uri) -> Unit): () -> Unit {
    val launcher =
        rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            if (uri != null) onSelected(uri)
        }
    return { launcher.launch(arrayOf("*/*")) }
}

/** 单列表导出动作：传入文件名即拉起保存位置选择（错误文案与成功提示共享）。 */
@Composable
internal fun rememberListExportAction(
    backup: BackupManager,
    listId: String,
    title: String,
    toast: (String) -> Unit,
): (String) -> Unit {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val launcher =
        rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
            if (uri == null) return@rememberLauncherForActivityResult
            scope.launch {
                val bytes =
                    runCatching { backup.exportSingleList(listId, title) }.getOrElse {
                        toast("歌单导出失败: ${it.message.orEmpty()}")
                        return@launch
                    }
                SafDocuments
                    .writeBytes(context, uri, bytes)
                    .onSuccess { toast("导出成功") }
                    .onFailure { toast("歌单导出失败: ${it.message.orEmpty()}") }
            }
        }
    return { fileName -> launcher.launch(fileName) }
}

/** 排序弹层：九档规则 + 自定义排序；确认动作由宿主决定（详情页进拖拽、菜单进详情）。 */
@OptIn(UnstableSaltUiApi::class)
@Composable
internal fun ListSortDialog(
    title: String,
    selection: String?,
    onSelect: (String) -> Unit,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
) {
    BasicDialog(onDismissRequest = onDismiss) {
        DialogTitle(text = title)
        Column(
            Modifier
                .heightIn(max = 360.dp)
                .verticalScroll(rememberScrollState()),
        ) {
            LIST_SORT_OPTIONS.forEach { (key, label) ->
                ItemCheck(
                    state = selection == key,
                    onChange = { checked -> if (checked) onSelect(key) },
                    text = label,
                )
            }
            ItemCheck(
                state = selection == "custom",
                onChange = { checked -> if (checked) onSelect("custom") },
                text = "自定义排序",
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(
                onClick = onDismiss,
                text = "取消",
                appearance = ButtonAppearance.Subtle,
                modifier = Modifier.weight(1f),
            )
            Button(
                onClick = onConfirm,
                text = "确定",
                enabled = selection != null,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

/** 重命名弹层：空名经 [normalize] 归一化后为空则不分发确认。 */
@OptIn(UnstableSaltUiApi::class)
@Composable
internal fun ListRenameDialog(
    initialName: String,
    normalize: (String) -> String,
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit,
) {
    var name by remember(initialName) { mutableStateOf(initialName) }
    InputDialog(
        onDismissRequest = onDismiss,
        onConfirm = {
            val normalized = normalize(name)
            if (normalized.isNotEmpty()) onConfirm(normalized)
        },
        onChange = { name = it },
        title = "重命名列表",
        text = name,
        cancelText = "取消",
        confirmText = "确定",
    )
}

/** 删除列表确认（用户列表专享；内置列表不会走到这里）。 */
@OptIn(UnstableSaltUiApi::class)
@Composable
internal fun ListDeleteDialog(
    title: String,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
) {
    YesNoDialog(
        onDismissRequest = onDismiss,
        onConfirm = onConfirm,
        title = "删除列表",
        content = "你真的想要移除「$title」吗？",
        cancelText = "取消",
        confirmText = "是的，没错",
    )
}

/** 「更新」同步确认（文案对照 RN `list_sync_confirm_tip`，按钮沿用 RN 的「是的，没错」）。 */
@OptIn(UnstableSaltUiApi::class)
@Composable
internal fun ListSyncConfirmDialog(
    title: String,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
) {
    YesNoDialog(
        onDismissRequest = onDismiss,
        onConfirm = onConfirm,
        title = "更新列表",
        content = "这将会把「$title」内的歌曲替换成在线列表的歌曲，你确认要更新吗？",
        cancelText = "取消",
        confirmText = "是的，没错",
    )
}

/** 导出提示（先说明文件名与同名不覆盖，再拉起 SAF 位置选择）。 */
@OptIn(UnstableSaltUiApi::class)
@Composable
internal fun ListExportHintDialog(
    title: String,
    onDismiss: () -> Unit,
    onPickLocation: () -> Unit,
) {
    val fileName = SafDocuments.exportFileName(title)
    YesNoDialog(
        onDismissRequest = onDismiss,
        onConfirm = onPickLocation,
        title = "导出列表",
        content =
            "将把「$title」保存为 $fileName。\n" +
                "若所选位置已有同名文件，系统会自动改名并追加「(1)」，不会覆盖原文件。",
        cancelText = "取消",
        confirmText = "选择保存位置",
    )
}

/** 单列表导入 ID 冲突：改名复制 vs 覆盖。 */
@OptIn(UnstableSaltUiApi::class)
@Composable
internal fun ListImportConflictDialog(
    conflict: ImportConflictInfo,
    onDismiss: () -> Unit,
    onChoose: (overwrite: Boolean) -> Unit,
) {
    BasicDialog(onDismissRequest = onDismiss) {
        DialogTitle(text = "导入列表")
        Text(
            text =
                "导入的列表「${conflict.importName}」与本地列表「${conflict.localName}」的 ID 相同，" +
                    "是否覆盖本地列表？",
            color = SaltTheme.colors.text,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(
                onClick = { onChoose(false) },
                text = "不要啊",
                appearance = ButtonAppearance.Subtle,
                modifier = Modifier.weight(1f),
            )
            Button(
                onClick = { onChoose(true) },
                text = "覆盖掉",
                modifier = Modifier.weight(1f),
            )
        }
    }
}

/** 整表备份覆盖全部列表前的二次确认。 */
@OptIn(UnstableSaltUiApi::class)
@Composable
internal fun ListFullImportConfirmDialog(
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
) {
    YesNoDialog(
        onDismissRequest = onDismiss,
        onConfirm = onConfirm,
        title = "导入列表",
        content =
            "备份文件中列表与现有列表 ID 相同时，现有列表内歌曲将被覆盖，是否继续？\n" +
                "若你不确定后果，建议先备份现有列表再来继续！",
        cancelText = "我不",
        confirmText = "是的",
    )
}

private fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content
