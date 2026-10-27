package cn.toside.music.nativeapp.ui.list

import android.widget.Toast
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.padding
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
import cn.toside.music.core.list.MusicSortId
import cn.toside.music.core.storage.StorageKeys
import cn.toside.music.nativeapp.data.SonglistRuntime
import cn.toside.music.nativeapp.player.PlayerRuntime
import cn.toside.music.nativeapp.util.SafDocuments
import com.moriafly.salt.ui.Button
import com.moriafly.salt.ui.ButtonAppearance
import com.moriafly.salt.ui.Item
import com.moriafly.salt.ui.ItemArrowType
import com.moriafly.salt.ui.UnstableSaltUiApi
import com.moriafly.salt.ui.dialog.BasicDialog
import com.moriafly.salt.ui.dialog.DialogTitle
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonObject

/**
 * 首页列表行长按菜单（S18 任务 1，对照 RN `MyList/ListMenu.tsx`）。
 *
 * 菜单项顺序与 `disabled` 规则逐条照抄 RN：
 * 新建 / 重命名 / 排序 / 重复歌曲 / 添加本地歌曲 / 更新 / 导入 / 导出 / 删除。
 * 试听列表与我的收藏禁「重命名」「删除」；非用户列表禁「更新」；导入进行中禁
 * 「添加本地歌曲」「更新」（RN 的 `fetchingListStatus`）。
 *
 * W5-9 起排序/导入/导出/重命名/删表与 [ListDetailPage] 共用 [ListFileActions] 里的单一实现，
 * 两处只剩各自的后处理（菜单广播更新，详情页刷新列表/返回）。
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
    val sourceListId: String? = null,
    val importing: Boolean = false,
    val localFileReady: Boolean = false,
    /** 该源是否支持在线歌单同步（宿主用 `SonglistRuntime.isSupported` 判定）。 */
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
                enabled =
                    hasSyncableSource(state.isUserList, state.source, state.sourceListId) &&
                        state.syncSupported &&
                        !state.importing,
            ),
            ListMenuEntry(ListMenuAction.IMPORT, enabled = true),
            ListMenuEntry(ListMenuAction.EXPORT, enabled = true),
            ListMenuEntry(ListMenuAction.REMOVE, enabled = state.isUserList),
        )

    /**
     * RN `sync` 的源判定（`userList.source` + `musicSdk[source].songList`）；
     * 原生再加 `sourceListId`——RN 的同步执行对缺该字段的列表会直接早退，
     * 老歌单没有这份元数据时置灰与之一致。
     */
    fun hasSyncableSource(
        isUserList: Boolean,
        source: String?,
        sourceListId: String?,
    ): Boolean = isUserList && !source.isNullOrEmpty() && !sourceListId.isNullOrEmpty()
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

    fun toast(message: String) = Toast.makeText(context, message, Toast.LENGTH_SHORT).show()

    val importFlow =
        rememberListImportFlow(
            runtime = runtime,
            backup = backup,
            toast = ::toast,
            onImported = { result ->
                when (result) {
                    is BackupManager.ImportResult.PartImported ->
                        runtime.core.handleListMusicsUpdated(listOf(result.listInfo.id))
                    BackupManager.ImportResult.FullImported -> {
                        val userLists = runtime.lists.store.state.value.userLists
                        runtime.core.handleListMusicsUpdated(
                            listOf(StorageKeys.ListIds.DEFAULT, StorageKeys.ListIds.LOVE) + userLists.map { it.id },
                        )
                    }
                    else -> Unit
                }
            },
        )
    val importAction = rememberListImportAction { importFlow.start(it) }
    val exportAction = rememberListExportAction(backup, menu.listId, menu.title, ::toast)

    var syncing by remember { mutableStateOf(false) }
    var syncVisible by remember(menu.listId) { mutableStateOf(false) }

    val state =
        ListMenuState(
            listId = menu.listId,
            isUserList = userList != null,
            source = userList?.source,
            sourceListId = userList?.sourceListId,
            importing = importFlow.importing || syncing,
            localFileReady = LocalFileImport.isReady,
            syncSupported = userList?.source?.let { SonglistRuntime.isSupported(it) } == true,
        )
    val entries = ListMenuRules.entries(state)

    var renameVisible by remember { mutableStateOf(false) }
    var sortVisible by remember { mutableStateOf(false) }
    var sortSelection by remember { mutableStateOf<String?>(null) }
    var duplicateVisible by remember(menu.listId) { mutableStateOf(false) }
    var removeVisible by remember { mutableStateOf(false) }
    var exportHintVisible by remember { mutableStateOf(false) }
    var items by remember(menu.listId) { mutableStateOf<List<JsonObject>>(emptyList()) }

    fun reload() {
        scope.launch { items = runtime.lists.musics(menu.listId) }
    }

    fun applySort(key: String) {
        val sortId = MusicSortId.fromKey(key) ?: return
        sortVisible = false
        scope.launch {
            applyListSort(runtime, menu.listId, sortId, listSortLocaleId(runtime))
            toast("已排序")
        }
    }

    fun onAction(action: ListMenuAction) {
        when (action) {
            ListMenuAction.CREATE -> {
                onDismiss()
                onCreateList()
            }
            ListMenuAction.RENAME -> renameVisible = true
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
            ListMenuAction.SYNC -> syncVisible = true
            ListMenuAction.IMPORT -> importAction()
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
        ListRenameDialog(
            initialName = userList?.name.orEmpty(),
            normalize = runtime.lists.store::normalizeListName,
            onDismiss = { renameVisible = false },
            onConfirm = { name ->
                renameVisible = false
                scope.launch { runtime.lists.store.renameUserList(menu.listId, name) }
            },
        )
    }
    if (sortVisible) {
        ListSortDialog(
            title = menu.title,
            selection = sortSelection,
            onSelect = { sortSelection = it },
            onDismiss = { sortVisible = false },
            onConfirm = {
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
        )
    }
    if (duplicateVisible) {
        DuplicateMusicDialog(
            title = menu.title,
            items = items,
            localeId = listSortLocaleId(runtime),
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
        ListDeleteDialog(
            title = menu.title,
            onDismiss = { removeVisible = false },
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
        )
    }
    if (syncVisible) {
        ListSyncConfirmDialog(
            title = menu.title,
            onDismiss = { syncVisible = false },
            onConfirm = {
                syncVisible = false
                if (!syncing) {
                    syncing = true
                    scope.launch {
                        val done = syncUserList(runtime, menu.listId)
                        syncing = false
                        toast(if (done != null) "「${menu.title}」更新成功" else "「${menu.title}」更新失败")
                    }
                }
            },
        )
    }
    if (exportHintVisible) {
        ListExportHintDialog(
            title = menu.title,
            onDismiss = { exportHintVisible = false },
            onPickLocation = {
                exportHintVisible = false
                exportAction(SafDocuments.exportFileName(menu.title))
            },
        )
    }
    importFlow.conflict?.let { conflict ->
        ListImportConflictDialog(
            conflict = conflict,
            onDismiss = importFlow.dismissConflict,
            onChoose = importFlow.resolveConflict,
        )
    }
    importFlow.fullConfirm?.let {
        ListFullImportConfirmDialog(
            onDismiss = importFlow.dismissFull,
            onConfirm = importFlow.confirmFull,
        )
    }
}
