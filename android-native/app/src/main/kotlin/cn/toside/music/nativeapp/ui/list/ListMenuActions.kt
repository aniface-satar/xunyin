package cn.toside.music.nativeapp.ui.list

import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import cn.toside.music.core.backup.BackupManager
import cn.toside.music.core.list.MusicSort
import cn.toside.music.core.list.MusicSortId
import cn.toside.music.core.storage.StorageKeys
import cn.toside.music.nativeapp.player.PlayerRuntime
import cn.toside.music.nativeapp.util.SafDocuments
import com.moriafly.salt.ui.Button
import com.moriafly.salt.ui.ButtonAppearance
import com.moriafly.salt.ui.Item
import com.moriafly.salt.ui.ItemArrowType
import com.moriafly.salt.ui.ItemCheck
import com.moriafly.salt.ui.SaltTheme
import com.moriafly.salt.ui.Text
import com.moriafly.salt.ui.UnstableSaltUiApi
import com.moriafly.salt.ui.dialog.BasicDialog
import com.moriafly.salt.ui.dialog.DialogTitle
import com.moriafly.salt.ui.dialog.InputDialog
import com.moriafly.salt.ui.dialog.YesNoDialog
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.util.Locale

/**
 * 首页列表行长按菜单（S18 任务 1，对照 RN `MyList/ListMenu.tsx`）。
 *
 * 菜单项顺序与 `disabled` 规则逐条照抄 RN：
 * 新建 / 重命名 / 排序 / 重复歌曲 / 添加本地歌曲 / 更新 / 导入 / 导出 / 删除。
 * 试听列表与我的收藏禁「重命名」「删除」；非用户列表禁「更新」；导入进行中禁
 * 「添加本地歌曲」「更新」（RN 的 `fetchingListStatus`）。
 *
 * 已知取舍：导入/导出/排序的实现与 [ListDetailPage] 内联逻辑重复——那个文件归 Lane B，
 * 本波一个字不许改，Wave6 统一收口（见 lane 报告遗留）。
 */
enum class ListMenuAction(
    val label: String,
) {
    CREATE("新建列表"),
    RENAME("重命名"),
    SORT("排序歌曲"),
    DUPLICATE("重复歌曲"),
    LOCAL_FILE("添加本地歌曲"),
    SYNC("更新"),
    IMPORT("导入"),
    EXPORT("导出"),
    REMOVE("删除"),
}

/** 一行菜单项与它的可用性（纯数据，单测只测这一层）。 */
data class ListMenuEntry(
    val action: ListMenuAction,
    val enabled: Boolean,
)

/** 决定菜单可用性的上下文（全部来自界面状态，不含 Android 依赖）。 */
data class ListMenuState(
    val listId: String,
    val isUserList: Boolean,
    val source: String? = null,
    val importing: Boolean = false,
    val localFileReady: Boolean = false,
    /** 原生侧尚无 `syncSourceList`（RN `core/syncSourceList`），固定不可用并记遗留。 */
    val syncSupported: Boolean = false,
)

object ListMenuRules {
    /** 九个菜单项与 RN 同序；`enabled` 规则对照 `ListMenu.tsx#handleSetMenu`。 */
    fun entries(state: ListMenuState): List<ListMenuEntry> =
        listOf(
            ListMenuEntry(ListMenuAction.CREATE, enabled = true),
            ListMenuEntry(ListMenuAction.RENAME, enabled = state.isUserList),
            ListMenuEntry(ListMenuAction.SORT, enabled = true),
            ListMenuEntry(ListMenuAction.DUPLICATE, enabled = true),
            ListMenuEntry(ListMenuAction.LOCAL_FILE, enabled = state.localFileReady && !state.importing),
            ListMenuEntry(
                ListMenuAction.SYNC,
                enabled = hasSyncableSource(state.isUserList, state.source) && state.syncSupported && !state.importing,
            ),
            ListMenuEntry(ListMenuAction.IMPORT, enabled = true),
            ListMenuEntry(ListMenuAction.EXPORT, enabled = true),
            ListMenuEntry(ListMenuAction.REMOVE, enabled = state.isUserList),
        )

    /** RN `sync` 的源判定：用户列表带了 `source` 且该源支持 songList。原生暂无同步实现。 */
    fun hasSyncableSource(
        isUserList: Boolean,
        source: String?,
    ): Boolean = isUserList && !source.isNullOrEmpty()
}

/**
 * Lane B 的 `LocalMusicRuntime.importTo` 装配点。
 *
 * 本 lane 的 worktree 里看不到 Lane B 的代码（并行 worktree 互不可见），所以入口做成可注入：
 * 集成会话把 `LocalFileImport.importTo = LocalMusicRuntime::importTo` 接上后，
 * 「添加本地歌曲」从置灰变为可用，业务代码一行不用改。
 */
object LocalFileImport {
    var importTo: ((listId: String, listTitle: String) -> Boolean)? = null

    val isReady: Boolean get() = importTo != null
}

/** 长按命中的列表（[title] 用于弹层标题与导出文件名）。 */
data class ListMenuRequest(
    val listId: String,
    val title: String,
)

/**
 * 长按回调（不抢点击）。
 *
 * `Item` 自带 `clickable`，外层再套 `combinedClickable` 会被内层先消费掉按下事件——
 * 长按永远不触发。这里在 **Initial 阶段**观察手势：正常情况下一个事件都不消费
 * （点击、水波纹保持 SaltUI 原样），只有长按成立后才把后续事件吞掉，
 * 避免松手时再触发一次点击跳转。
 */
fun Modifier.onListLongPress(onLongPress: () -> Unit): Modifier =
    pointerInput(onLongPress) {
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
            val released =
                withTimeoutOrNull(viewConfiguration.longPressTimeoutMillis) {
                    var change = down
                    while (change.pressed) {
                        val event = awaitPointerEvent(PointerEventPass.Initial)
                        change = event.changes.firstOrNull { it.id == down.id } ?: change
                    }
                    true
                }
            if (released == null) {
                onLongPress()
                var change = down
                while (change.pressed) {
                    val event = awaitPointerEvent(PointerEventPass.Initial)
                    event.changes.forEach { it.consume() }
                    change = event.changes.firstOrNull { it.id == down.id } ?: change
                }
            }
        }
    }

/** 排序档位与文案（对照 RN `MyList/ListMusicSort.tsx` + `zh-cn.json#list_sort_option_*`）。 */
private val SORT_OPTIONS =
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
 * 长按菜单的全部界面与动作（菜单 + 重命名 + 排序 + 去重 + 导入/导出 + 删除）。
 *
 * [request] 为 null 时不渲染任何东西；宿主（首页「我的」）只负责把长按命中的列表塞进来。
 */
@OptIn(UnstableSaltUiApi::class)
@Composable
fun ListMenuHost(
    request: ListMenuRequest?,
    onDismiss: () -> Unit,
    onOpenList: (listId: String, title: String) -> Unit,
    onCreateList: () -> Unit,
) {
    val context = LocalContext.current
    val runtime = remember { PlayerRuntime.get(context) }
    val backup = remember { BackupManager(runtime.lists.store) }
    val scope = rememberCoroutineScope()
    val listsState by runtime.lists.store.state
        .collectAsState()
    val menu = request ?: return
    val userList = listsState.userLists.firstOrNull { it.id == menu.listId }
    var importing by remember(menu.listId) { mutableStateOf(false) }
    val state =
        ListMenuState(
            listId = menu.listId,
            isUserList = userList != null,
            source = userList?.source,
            importing = importing,
            localFileReady = LocalFileImport.isReady,
        )
    val entries = ListMenuRules.entries(state)

    var renameVisible by remember { mutableStateOf(false) }
    var renameName by remember { mutableStateOf("") }
    var sortVisible by remember { mutableStateOf(false) }
    var sortSelection by remember { mutableStateOf<String?>(null) }
    var duplicateVisible by remember(menu.listId) { mutableStateOf(false) }
    var removeVisible by remember { mutableStateOf(false) }
    var exportHintVisible by remember { mutableStateOf(false) }
    var importConflict by remember { mutableStateOf<MenuImportConflict?>(null) }
    var fullImportConfirm by remember { mutableStateOf<MenuPendingImport?>(null) }
    var items by remember(menu.listId) { mutableStateOf<List<JsonObject>>(emptyList()) }

    fun toast(message: String) = Toast.makeText(context, message, Toast.LENGTH_SHORT).show()

    fun sortLocaleId(): String =
        runtime.settings.store
            .string("common.langId")
            .ifEmpty { Locale.getDefault().toLanguageTag() }

    fun reload() {
        scope.launch { items = runtime.lists.musics(menu.listId) }
    }

    fun addLocation(): String =
        runtime.settings.store
            .string("list.addMusicLocationType")
            .ifEmpty { "top" }

    fun localListName(id: String): String? =
        when (id) {
            StorageKeys.ListIds.DEFAULT -> "试听列表"
            StorageKeys.ListIds.LOVE -> "我的收藏"
            else ->
                runtime.lists.store.state.value.userLists
                    .firstOrNull { it.id == id }
                    ?.name
        }

    fun runImport(
        pending: MenuPendingImport,
        mode: BackupManager.PartConflictMode,
    ) {
        scope.launch {
            importing = true
            val result =
                if (pending.plainJson) {
                    backup.importJson(pending.bytes.toString(Charsets.UTF_8), mode)
                } else {
                    backup.import(pending.bytes, mode)
                }
            importing = false
            when (result) {
                is BackupManager.ImportResult.PartImported -> {
                    toast("导入成功🎉")
                    runtime.core.handleListMusicsUpdated(listOf(result.listInfo.id))
                }
                BackupManager.ImportResult.FullImported -> {
                    toast("导入成功🎉")
                    val userLists = runtime.lists.store.state.value.userLists
                    val affected =
                        listOf(StorageKeys.ListIds.DEFAULT, StorageKeys.ListIds.LOVE) +
                            userLists.map { it.id }
                    runtime.core.handleListMusicsUpdated(affected)
                }
                is BackupManager.ImportResult.Unsupported -> toast("未知的文件类型，请尝试升级到最新版本后再试")
                BackupManager.ImportResult.ParseError -> toast("列表导入失败😕")
            }
        }
    }

    fun startImport(uri: Uri) {
        val displayName = SafDocuments.displayName(context, uri)
        if (!SafDocuments.isSupportedImport(displayName)) {
            toast("未知的文件类型，请尝试升级到最新版本后再试")
            return
        }
        scope.launch {
            importing = true
            val bytes =
                SafDocuments.readBytes(context, uri).getOrElse {
                    importing = false
                    toast("列表导入失败😕")
                    return@launch
                }
            val pending = MenuPendingImport(bytes, SafDocuments.isPlainJson(displayName))
            val preview =
                if (pending.plainJson) {
                    backup.previewJson(bytes.toString(Charsets.UTF_8))
                } else {
                    backup.preview(bytes)
                }
            importing = false
            if (preview == null) {
                toast("列表导入失败😕")
                return@launch
            }
            if (preview.type == "playListPart" || preview.type == "playListPart_v2") {
                val partId = preview.partId
                if (partId == null) {
                    toast("列表导入失败😕")
                    return@launch
                }
                val localName = localListName(partId)
                if (localName != null) {
                    importConflict = MenuImportConflict(pending, preview.partName.orEmpty(), localName)
                } else {
                    runImport(pending, BackupManager.PartConflictMode.RENAME_COPY)
                }
            } else {
                fullImportConfirm = pending
            }
        }
    }

    val importLauncher =
        rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            if (uri != null) startImport(uri)
        }
    val exportLauncher =
        rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
            if (uri == null) return@rememberLauncherForActivityResult
            scope.launch {
                val bytes =
                    runCatching { backup.exportSingleList(menu.listId, menu.title) }.getOrElse {
                        toast("歌单导出失败: ${it.message.orEmpty()}")
                        return@launch
                    }
                SafDocuments
                    .writeBytes(context, uri, bytes)
                    .onSuccess { toast("导出成功") }
                    .onFailure { toast("歌单导出失败: ${it.message.orEmpty()}") }
            }
        }

    fun applySort(key: String) {
        val sortId = MusicSortId.fromKey(key) ?: return
        sortVisible = false
        scope.launch {
            val current = runtime.lists.musics(menu.listId)
            val sorted = MusicSort.sort(current, sortId, sortLocaleId())
            runtime.lists.store.listMusicUpdatePosition(menu.listId, 0, sorted.mapNotNull { it.text("id") })
            runtime.core.handleListMusicsUpdated(listOf(menu.listId))
            toast("已排序")
        }
    }

    fun onAction(action: ListMenuAction) {
        when (action) {
            ListMenuAction.CREATE -> {
                onDismiss()
                onCreateList()
            }
            ListMenuAction.RENAME -> {
                renameName = userList?.name.orEmpty()
                renameVisible = true
            }
            ListMenuAction.SORT -> {
                sortSelection = null
                sortVisible = true
            }
            ListMenuAction.DUPLICATE -> {
                duplicateVisible = true
                reload()
            }
            ListMenuAction.LOCAL_FILE -> {
                val importer = LocalFileImport.importTo
                if (importer == null) {
                    toast("本地曲库尚未接入")
                } else if (!importer(menu.listId, menu.title)) {
                    toast("目录选择器还没装配，先在列表详情页用一次「添加本地歌曲」")
                }
                onDismiss()
            }
            ListMenuAction.SYNC -> toast("在线列表同步暂未迁移到原生")
            ListMenuAction.IMPORT -> importLauncher.launch(arrayOf("*/*"))
            ListMenuAction.EXPORT -> exportHintVisible = true
            ListMenuAction.REMOVE -> removeVisible = true
        }
    }

    BasicDialog(onDismissRequest = onDismiss) {
        DialogTitle(text = menu.title)
        entries.forEach { entry ->
            Item(
                onClick = { if (entry.enabled) onAction(entry.action) },
                text = entry.action.label,
                enabled = entry.enabled,
                arrowType = ItemArrowType.None,
            )
        }
        Button(
            onClick = onDismiss,
            text = "取消",
            appearance = ButtonAppearance.Subtle,
            modifier = Modifier.padding(top = 8.dp),
        )
    }

    if (renameVisible) {
        InputDialog(
            onDismissRequest = { renameVisible = false },
            onConfirm = {
                val normalized = runtime.lists.store.normalizeListName(renameName)
                if (normalized.isNotEmpty()) {
                    renameVisible = false
                    scope.launch { runtime.lists.store.renameUserList(menu.listId, normalized) }
                }
            },
            onChange = { renameName = it },
            title = "重命名列表",
            text = renameName,
            cancelText = "取消",
            confirmText = "确定",
        )
    }
    if (sortVisible) {
        BasicDialog(onDismissRequest = { sortVisible = false }) {
            DialogTitle(text = menu.title)
            Column(
                Modifier
                    .heightIn(max = 360.dp)
                    .verticalScroll(rememberScrollState()),
            ) {
                SORT_OPTIONS.forEach { (key, label) ->
                    ItemCheck(
                        state = sortSelection == key,
                        onChange = { checked -> if (checked) sortSelection = key },
                        text = label,
                    )
                }
                // 自定义排序（拖拽）只在列表详情页，选用后直接进详情
                ItemCheck(
                    state = sortSelection == "custom",
                    onChange = { checked -> if (checked) sortSelection = "custom" },
                    text = "自定义排序",
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = { sortVisible = false },
                    text = "取消",
                    appearance = ButtonAppearance.Subtle,
                    modifier = Modifier.weight(1f),
                )
                Button(
                    onClick = {
                        when (val key = sortSelection) {
                            null -> Unit
                            "custom" -> {
                                sortVisible = false
                                onDismiss()
                                onOpenList(menu.listId, menu.title)
                            }
                            else -> applySort(key)
                        }
                    },
                    text = "确定",
                    enabled = sortSelection != null,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
    if (duplicateVisible) {
        DuplicateMusicDialog(
            title = menu.title,
            items = items,
            localeId = sortLocaleId(),
            onDismiss = { duplicateVisible = false },
            onPlay = { musicId ->
                scope.launch {
                    runtime.core.playListById(menu.listId, musicId)
                    duplicateVisible = false
                }
            },
            onRemove = { ids ->
                scope.launch {
                    runtime.lists.store.listMusicRemove(menu.listId, ids)
                    runtime.core.handleListMusicsUpdated(listOf(menu.listId))
                    reload()
                }
            },
        )
    }
    if (removeVisible) {
        YesNoDialog(
            onDismissRequest = { removeVisible = false },
            onConfirm = {
                removeVisible = false
                scope.launch {
                    runtime.lists.store.userListsRemove(listOf(menu.listId))
                    if (runtime.lists.store.state.value.activeListId == menu.listId) {
                        runtime.lists.store.setActiveList(StorageKeys.ListIds.DEFAULT)
                    }
                    runtime.core.handleListMusicsUpdated(listOf(menu.listId))
                    onDismiss()
                }
            },
            title = "删除列表",
            content = "你真的想要移除「${menu.title}」吗？",
            cancelText = "取消",
            confirmText = "是的，没错",
        )
    }
    if (exportHintVisible) {
        val fileName = SafDocuments.exportFileName(menu.title)
        YesNoDialog(
            onDismissRequest = { exportHintVisible = false },
            onConfirm = {
                exportHintVisible = false
                exportLauncher.launch(fileName)
            },
            title = "导出列表",
            content =
                "将把「${menu.title}」保存为 $fileName。\n" +
                    "若所选位置已有同名文件，系统会自动改名并追加「(1)」，不会覆盖原文件。",
            cancelText = "取消",
            confirmText = "选择保存位置",
        )
    }
    importConflict?.let { conflict ->
        BasicDialog(onDismissRequest = { importConflict = null }) {
            DialogTitle(text = "导入列表")
            Text(
                text =
                    "导入的列表「${conflict.importName}」与本地列表「${conflict.localName}」的 ID 相同，" +
                        "是否覆盖本地列表？",
                color = SaltTheme.colors.text,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = {
                        importConflict = null
                        runImport(conflict.pending, BackupManager.PartConflictMode.RENAME_COPY)
                    },
                    text = "不要啊",
                    appearance = ButtonAppearance.Subtle,
                    modifier = Modifier.weight(1f),
                )
                Button(
                    onClick = {
                        importConflict = null
                        runImport(conflict.pending, BackupManager.PartConflictMode.OVERWRITE)
                    },
                    text = "覆盖掉",
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
    fullImportConfirm?.let { pending ->
        YesNoDialog(
            onDismissRequest = { fullImportConfirm = null },
            onConfirm = {
                fullImportConfirm = null
                runImport(pending, BackupManager.PartConflictMode.RENAME_COPY)
            },
            title = "导入列表",
            content =
                "备份文件中列表与现有列表 ID 相同时，现有列表内歌曲将被覆盖，是否继续？\n" +
                    "若你不确定后果，建议先备份现有列表再来继续！",
            cancelText = "我不",
            confirmText = "是的",
        )
    }
}

private data class MenuPendingImport(
    val bytes: ByteArray,
    val plainJson: Boolean,
)

private data class MenuImportConflict(
    val pending: MenuPendingImport,
    val importName: String,
    val localName: String,
)

private fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content
