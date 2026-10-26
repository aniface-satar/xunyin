package cn.toside.music.nativeapp.ui.list

import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import cn.toside.music.core.backup.BackupManager
import cn.toside.music.core.list.MusicSort
import cn.toside.music.core.list.MusicSortId
import cn.toside.music.core.storage.StorageKeys
import cn.toside.music.nativeapp.data.LocalMusicRuntime
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
import com.moriafly.salt.ui.screen.BasicScreen
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.util.Locale

/** 排序档位与文案（对照 RN MyList/ListMusicSort.tsx + zh-cn.json#list_sort_option_*）。 */
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
 * 歌单详情页（B5 第一、三、五、七切片）—— 读取 ListStore 的列表歌曲、整表播放与编辑。
 *
 * 用户歌单支持重命名/清空/删除；任意列表支持单曲移除、多选批量删除/移动到其他列表、
 * 拖拽排序，以及 9 档规则排序（自定义排序与多选互斥）。
 * 变更后同步随机队列（`PlayerCore.handleListMusicsUpdated`）。
 */
@OptIn(UnstableSaltUiApi::class)
@Composable
fun ListDetailPage(
    listId: String,
    title: String,
    onBack: () -> Unit,
    onOpenPlayer: () -> Unit,
) {
    val context = LocalContext.current
    val runtime = remember { PlayerRuntime.get(context) }
    val playerState by runtime.core.state.collectAsState()
    val listsState by runtime.lists.store.state
        .collectAsState()
    val lazyState = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val userList = listsState.userLists.firstOrNull { it.id == listId }
    var items by remember(listId) { mutableStateOf<List<JsonObject>>(emptyList()) }
    var displayTitle by remember(listId) { mutableStateOf(title) }
    var renameVisible by remember { mutableStateOf(false) }
    var renameName by remember { mutableStateOf("") }
    var clearVisible by remember { mutableStateOf(false) }
    var deleteVisible by remember { mutableStateOf(false) }
    var editMode by remember(listId) { mutableStateOf(false) }
    var selectedIds by remember(listId) { mutableStateOf<Set<String>>(emptySet()) }
    var moveVisible by remember { mutableStateOf(false) }
    var removeSelectedVisible by remember { mutableStateOf(false) }
    var dragId by remember(listId) { mutableStateOf<String?>(null) }
    var dragOffsetY by remember(listId) { mutableFloatStateOf(0f) }
    // 自定义排序与多选互斥（RN MusicList/index.tsx#hancelMultiSelect / enterCustomSort）
    var customSortMode by remember(listId) { mutableStateOf(false) }
    var sortVisible by remember { mutableStateOf(false) }
    var sortSelection by remember { mutableStateOf<String?>(null) }
    // 记住上次确认过的档位（RN ListMusicSort.tsx#lastSelectedSortId）
    var lastSortKey by remember { mutableStateOf<String?>(null) }
    var duplicateVisible by remember(listId) { mutableStateOf(false) }
    var exportHintVisible by remember { mutableStateOf(false) }
    var importing by remember { mutableStateOf(false) }
    // 本地曲库导入（Wave5 Lane B）
    var localImportVisible by remember { mutableStateOf(false) }
    var localImportTitle by remember { mutableStateOf("") }
    val localImportProgress by LocalMusicRuntime.progress.collectAsState()
    val localImportOutcome by LocalMusicRuntime.outcome.collectAsState()
    val localImportingListId by LocalMusicRuntime.importingListId.collectAsState()
    // 本地曲目重定位（Wave6 Lane C）：弹层打开时数一次失效数，按钮 N>0 才渲染
    var relinkStaleCount by remember { mutableStateOf(0) }
    val relinkingListId by LocalMusicRuntime.relinkingListId.collectAsState()
    val relinkOutcome by LocalMusicRuntime.relinkOutcome.collectAsState()
    var importConflict by remember { mutableStateOf<ImportPartConflict?>(null) }
    var fullImportConfirm by remember { mutableStateOf<PendingImport?>(null) }
    val backup = remember { BackupManager(runtime.lists.store) }

    LaunchedEffect(listId) { items = runtime.lists.musics(listId) }

    fun toast(message: String) = Toast.makeText(context, message, Toast.LENGTH_SHORT).show()

    /** 本地是否已有同 id 列表（含内置列表）；返回其展示名供冲突弹窗使用。 */
    fun localListName(id: String): String? =
        when (id) {
            StorageKeys.ListIds.DEFAULT -> "试听列表"
            StorageKeys.ListIds.LOVE -> "我的收藏"
            else -> {
                val store = runtime.lists.store.state.value
                val found = store.userLists.firstOrNull { it.id == id }
                found?.name
            }
        }

    /** 执行导入：单列表按冲突策略落库，整表备份覆盖全部列表（RN importPlayList）。 */
    fun runImport(
        pending: PendingImport,
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
                    if (result.listInfo.id == listId) items = runtime.lists.musics(listId)
                }
                BackupManager.ImportResult.FullImported -> {
                    toast("导入成功🎉")
                    val userLists = runtime.lists.store.state.value.userLists
                    val affectedIds =
                        buildList {
                            add(StorageKeys.ListIds.DEFAULT)
                            add(StorageKeys.ListIds.LOVE)
                            userLists.forEach { add(it.id) }
                            add(listId)
                        }
                    runtime.core.handleListMusicsUpdated(affectedIds)
                    val stillExists =
                        listId == StorageKeys.ListIds.DEFAULT ||
                            listId == StorageKeys.ListIds.LOVE ||
                            userLists.any { it.id == listId }
                    if (stillExists) items = runtime.lists.musics(listId) else onBack()
                }
                is BackupManager.ImportResult.Unsupported -> toast("未知的文件类型，请尝试升级到最新版本后再试")
                BackupManager.ImportResult.ParseError -> toast("列表导入失败😕")
            }
        }
    }

    /** 读入 SAF 选中文件：单列表文件先判冲突，其余按整表备份二次确认（RN importPlayList）。 */
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
            val pending = PendingImport(bytes, SafDocuments.isPlainJson(displayName))
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
                    importConflict = ImportPartConflict(pending, preview.partName.orEmpty(), localName)
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
                    runCatching { backup.exportSingleList(listId, displayTitle) }.getOrElse {
                        toast("歌单导出失败: ${it.message.orEmpty()}")
                        return@launch
                    }
                SafDocuments
                    .writeBytes(context, uri, bytes)
                    .onSuccess { toast("导出成功") }
                    .onFailure { toast("歌单导出失败: ${it.message.orEmpty()}") }
            }
        }

    /**
     * 本地曲库：目录树选择器。拿到的授权必须立刻持久化，
     * 否则重启后 `content://` 全部失效（RN 用真实路径没这问题）。
     */
    val localTreeLauncher =
        rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
            if (uri == null) return@rememberLauncherForActivityResult
            val persisted = SafDocuments.takePersistablePermission(context, uri)
            if (!persisted || !SafDocuments.hasPersistedPermission(context, uri)) {
                toast("目录授权未能持久保存，重启应用后可能无法继续播放")
            }
            localImportVisible = true
            LocalMusicRuntime.importTree(context, listId, localImportTitle.ifEmpty { displayTitle }, uri)
        }

    // 把「拉起目录选择」的能力挂到运行时（Lane C 的首页长按菜单也走同一个入口）
    val localPickerOwner = remember(listId) { Any() }
    DisposableEffect(localPickerOwner) {
        LocalMusicRuntime.registerPicker(localPickerOwner) { _, title ->
            localImportTitle = title
            localTreeLauncher.launch(null)
        }
        onDispose { LocalMusicRuntime.unregisterPicker(localPickerOwner) }
    }

    // 导入过程中列表在变，跟着进度刷新，别等弹层关掉才更新
    LaunchedEffect(localImportProgress) {
        if (localImportProgress != null) items = runtime.lists.musics(listId)
    }

    // 重定位：弹层打开时统计失效数；重定位结束后刷新列表与失效数（恢复的曲目换过 id）
    LaunchedEffect(localImportVisible) {
        if (localImportVisible) relinkStaleCount = LocalMusicRuntime.countStale(context, listId)
    }
    LaunchedEffect(relinkOutcome) {
        if (relinkOutcome != null && relinkOutcome?.stale != 0) {
            items = runtime.lists.musics(listId)
            relinkStaleCount = LocalMusicRuntime.countStale(context, listId)
        }
    }

    fun addLocation(): String =
        runtime.settings.store
            .string("list.addMusicLocationType")
            .ifEmpty { "top" }

    /** 拖拽结束：按当前预览顺序把被拖歌曲落到最终位置并落库。 */
    fun finishDrag() {
        val movedId = dragId ?: return
        val targetIndex = items.indexOfFirst { it.text("id") == movedId }
        dragId = null
        dragOffsetY = 0f
        if (targetIndex < 0) return
        scope.launch {
            runtime.lists.store.listMusicUpdatePosition(listId, targetIndex, listOf(movedId))
            runtime.core.handleListMusicsUpdated(listOf(listId))
        }
    }

    /**
     * 排序语言：优先设置里的 common.langId（RN global.i18n.locale），
     * 未设置时退回系统语言；下划线形式由 [MusicSort] 归一化。
     */
    fun sortLocaleId(): String =
        runtime.settings.store
            .string("common.langId")
            .ifEmpty { Locale.getDefault().toLanguageTag() }

    /** 应用普通排序档位：整表按规则重排后走既有 listMusicUpdatePosition 落库。 */
    fun applySort(key: String) {
        val sortId = MusicSortId.fromKey(key) ?: return
        lastSortKey = key
        sortVisible = false
        scope.launch {
            val current = runtime.lists.musics(listId)
            // add_time / play_count 在原生侧暂无读写者，取值恒 0（见车道报告数据缺口）。
            val sorted = MusicSort.sort(current, sortId, sortLocaleId())
            runtime.lists.store.listMusicUpdatePosition(
                listId,
                0,
                sorted.mapNotNull { it.text("id") },
            )
            runtime.core.handleListMusicsUpdated(listOf(listId))
            items = runtime.lists.musics(listId)
        }
    }

    val currentId = playerState.playMusicInfo.musicInfo?.text("id")
    val currentListId = playerState.playerListId
    val playable = items.isNotEmpty()

    BasicScreen(onBack = onBack, title = displayTitle) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            Row(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 2.dp)
                        .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                if (editMode) {
                    ActionText("完成") {
                        editMode = false
                        selectedIds = emptySet()
                    }
                    ActionText(if (items.isNotEmpty() && selectedIds.size == items.size) "取消全选" else "全选") {
                        selectedIds =
                            if (items.isNotEmpty() && selectedIds.size == items.size) {
                                emptySet()
                            } else {
                                items.mapNotNull { it.text("id") }.toSet()
                            }
                    }
                    ActionText("删除") { if (selectedIds.isNotEmpty()) removeSelectedVisible = true }
                    ActionText("移动到") { if (selectedIds.isNotEmpty()) moveVisible = true }
                    // 多选态下排序不可用（RN MylistDetail/index.tsx 的 disabled）
                    ActionText("排序", enabled = false) {}
                } else if (customSortMode) {
                    ActionText("完成") { customSortMode = false }
                    ActionText("多选") {
                        customSortMode = false
                        editMode = true
                        selectedIds = emptySet()
                    }
                } else {
                    if (userList != null) {
                        ActionText("重命名") {
                            renameName = userList.name
                            renameVisible = true
                        }
                    }
                    ActionText("清空") { clearVisible = true }
                    if (userList != null) {
                        ActionText("删除列表") { deleteVisible = true }
                    }
                    ActionText("多选") {
                        editMode = true
                        selectedIds = emptySet()
                    }
                    ActionText("排序") {
                        sortSelection = lastSortKey
                        sortVisible = true
                    }
                    ActionText("去重") { duplicateVisible = true }
                    ActionText("导入", enabled = !importing) {
                        importLauncher.launch(arrayOf("*/*"))
                    }
                    ActionText("导出") { exportHintVisible = true }
                    ActionText("本地文件", enabled = localImportingListId == null) {
                        if (!LocalMusicRuntime.importTo(listId, displayTitle)) {
                            toast("当前没有可用的目录选择入口")
                        }
                    }
                }
            }
            Button(
                onClick = {
                    val first = items.firstOrNull() ?: return@Button
                    scope.launch {
                        runtime.core.playListById(listId, first.text("id").orEmpty())
                        onOpenPlayer()
                    }
                },
                text = "播放全部（${items.size}）",
                enabled = playable,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            )
            if (editMode) {
                Text(
                    text = "已选 ${selectedIds.size} 首",
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 2.dp),
                    color = SaltTheme.colors.subText,
                )
            }
            if (items.isEmpty()) {
                Text(
                    text = "暂无歌曲",
                    modifier = Modifier.fillMaxWidth().padding(32.dp),
                    color = SaltTheme.colors.subText,
                )
            } else {
                LazyColumn(state = lazyState, modifier = Modifier.fillMaxSize()) {
                    itemsIndexed(items, key = { index, item -> item.text("id") ?: "index-$index" }) { index, item ->
                        val id = item.text("id")
                        val active = currentListId == listId && id != null && id == currentId
                        val selected = id != null && selectedIds.contains(id)
                        val dragging = id != null && dragId == id
                        Row(
                            modifier =
                                Modifier
                                    .fillMaxWidth()
                                    .zIndex(if (dragging) 1f else 0f)
                                    .graphicsLayer { translationY = if (dragging) dragOffsetY else 0f }
                                    .padding(horizontal = 12.dp, vertical = 2.dp)
                                    .clip(RoundedCornerShape(10.dp))
                                    .background(
                                        when {
                                            active -> SaltTheme.colors.highlight.copy(alpha = 0.12f)
                                            selected -> SaltTheme.colors.highlight.copy(alpha = 0.08f)
                                            else -> Color.Transparent
                                        },
                                    ).clickable {
                                        if (editMode) {
                                            if (id != null) {
                                                selectedIds =
                                                    if (selected) selectedIds - id else selectedIds + id
                                            }
                                        } else {
                                            val musicId = id ?: return@clickable
                                            scope.launch {
                                                runtime.core.playListById(listId, musicId)
                                                onOpenPlayer()
                                            }
                                        }
                                    }.padding(start = 12.dp, end = 4.dp, top = 10.dp, bottom = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            if (editMode || customSortMode) {
                                if (editMode) {
                                    SelectMark(selected = selected)
                                }
                                Column(Modifier.weight(1f).padding(start = if (editMode) 10.dp else 0.dp)) {
                                    MusicTitle(item = item, index = index, active = active)
                                }
                                DragHandle(
                                    modifier =
                                        Modifier.pointerInput(id) {
                                            detectDragGesturesAfterLongPress(
                                                onDragStart = {
                                                    if (id != null) {
                                                        dragId = id
                                                        dragOffsetY = 0f
                                                    }
                                                },
                                                onDrag = { change, amount ->
                                                    change.consume()
                                                    dragOffsetY += amount.y
                                                    val currentDragId = dragId
                                                    val from =
                                                        if (currentDragId == null) {
                                                            -1
                                                        } else {
                                                            items.indexOfFirst { it.text("id") == currentDragId }
                                                        }
                                                    val info =
                                                        if (from >= 0) {
                                                            lazyState.layoutInfo.visibleItemsInfo.firstOrNull { it.index == from }
                                                        } else {
                                                            null
                                                        }
                                                    if (info != null) {
                                                        val center = info.offset + info.size / 2f + dragOffsetY
                                                        val target =
                                                            lazyState.layoutInfo.visibleItemsInfo.firstOrNull {
                                                                center.toInt() in it.offset..(it.offset + it.size)
                                                            }
                                                        if (target != null && target.index != from && target.index in items.indices) {
                                                            val next = items.toMutableList()
                                                            next.add(target.index, next.removeAt(from))
                                                            items = next
                                                            dragOffsetY -= (target.index - from) * info.size
                                                        }
                                                        val viewportStart = lazyState.layoutInfo.viewportStartOffset
                                                        val viewportEnd = lazyState.layoutInfo.viewportEndOffset
                                                        val edge = 72.dp.toPx()
                                                        when {
                                                            center < viewportStart + edge ->
                                                                scope.launch { lazyState.scrollBy(-24.dp.toPx()) }
                                                            center > viewportEnd - edge ->
                                                                scope.launch { lazyState.scrollBy(24.dp.toPx()) }
                                                        }
                                                    }
                                                },
                                                onDragEnd = { finishDrag() },
                                                onDragCancel = { finishDrag() },
                                            )
                                        },
                                )
                            } else {
                                Column(Modifier.weight(1f)) {
                                    MusicTitle(item = item, index = index, active = active)
                                }
                                BasicText(
                                    text = "移除",
                                    modifier =
                                        Modifier
                                            .clip(RoundedCornerShape(8.dp))
                                            .clickable {
                                                val musicId = id ?: return@clickable
                                                scope.launch {
                                                    runtime.lists.store.listMusicRemove(listId, listOf(musicId))
                                                    runtime.core.handleListMusicsUpdated(listOf(listId))
                                                    items = runtime.lists.musics(listId)
                                                }
                                            }.padding(horizontal = 10.dp, vertical = 8.dp),
                                    style = TextStyle(color = SaltTheme.colors.subText, fontSize = 12.sp),
                                )
                            }
                        }
                    }
                }
            }
            if (sortVisible) {
                // 对照 RN MyList/ListMusicSort.tsx：单选档位 + 自定义排序，确认后才生效。
                BasicDialog(onDismissRequest = { sortVisible = false }) {
                    DialogTitle(text = displayTitle)
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
                                        editMode = false
                                        selectedIds = emptySet()
                                        customSortMode = true
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
            if (renameVisible) {
                InputDialog(
                    onDismissRequest = { renameVisible = false },
                    onConfirm = {
                        val normalized = runtime.lists.store.normalizeListName(renameName)
                        if (normalized.isNotEmpty()) {
                            renameVisible = false
                            scope.launch {
                                if (runtime.lists.store.renameUserList(listId, normalized)) {
                                    displayTitle = normalized
                                }
                            }
                        }
                    },
                    onChange = { renameName = it },
                    title = "重命名列表",
                    text = renameName,
                    cancelText = "取消",
                    confirmText = "确定",
                )
            }
            if (clearVisible) {
                YesNoDialog(
                    onDismissRequest = { clearVisible = false },
                    onConfirm = {
                        clearVisible = false
                        scope.launch {
                            runtime.lists.store.listMusicClear(listOf(listId))
                            runtime.core.handleListMusicsUpdated(listOf(listId))
                            items = runtime.lists.musics(listId)
                            selectedIds = emptySet()
                        }
                    },
                    title = "清空列表",
                    content = "要清空「$displayTitle」里的全部歌曲吗？",
                    cancelText = "取消",
                    confirmText = "清空",
                )
            }
            if (deleteVisible) {
                YesNoDialog(
                    onDismissRequest = { deleteVisible = false },
                    onConfirm = {
                        deleteVisible = false
                        scope.launch {
                            runtime.lists.store.userListsRemove(listOf(listId))
                            if (listsState.activeListId == listId) {
                                runtime.lists.store.setActiveList(StorageKeys.ListIds.DEFAULT)
                            }
                            runtime.core.handleListMusicsUpdated(listOf(listId))
                            onBack()
                        }
                    },
                    title = "删除列表",
                    content = "你真的想要移除「$displayTitle」吗？",
                    cancelText = "取消",
                    confirmText = "是的，没错",
                )
            }
            if (removeSelectedVisible) {
                YesNoDialog(
                    onDismissRequest = { removeSelectedVisible = false },
                    onConfirm = {
                        removeSelectedVisible = false
                        val ids = selectedIds.toList()
                        scope.launch {
                            runtime.lists.store.listMusicRemove(listId, ids)
                            runtime.core.handleListMusicsUpdated(listOf(listId))
                            items = runtime.lists.musics(listId)
                            selectedIds = emptySet()
                        }
                    },
                    title = "移除歌曲",
                    content = "要从「$displayTitle」移除选中的 ${selectedIds.size} 首歌吗？",
                    cancelText = "取消",
                    confirmText = "移除",
                )
            }
            if (moveVisible) {
                val targets =
                    buildList {
                        if (listId != StorageKeys.ListIds.DEFAULT) add(StorageKeys.ListIds.DEFAULT to "试听列表")
                        if (listId != StorageKeys.ListIds.LOVE) add(StorageKeys.ListIds.LOVE to "我的收藏")
                        listsState.userLists.filter { it.id != listId }.forEach { add(it.id to it.name) }
                    }
                BasicDialog(onDismissRequest = { moveVisible = false }) {
                    DialogTitle(text = "移动到")
                    targets.forEach { (targetId, targetName) ->
                        Item(
                            onClick = {
                                moveVisible = false
                                val moving = items.filter { it.text("id")?.let(selectedIds::contains) == true }
                                scope.launch {
                                    runtime.lists.store.listMusicMove(listId, targetId, moving, addLocation())
                                    runtime.core.handleListMusicsUpdated(listOf(listId, targetId))
                                    items = runtime.lists.musics(listId)
                                    selectedIds = emptySet()
                                    Toast.makeText(context, "已移动到「$targetName」", Toast.LENGTH_SHORT).show()
                                }
                            },
                            text = targetName,
                            arrowType = ItemArrowType.None,
                        )
                    }
                }
            }
            if (duplicateVisible) {
                DuplicateMusicDialog(
                    title = displayTitle,
                    items = items,
                    localeId = sortLocaleId(),
                    onDismiss = { duplicateVisible = false },
                    onPlay = { musicId ->
                        scope.launch {
                            runtime.core.playListById(listId, musicId)
                            onOpenPlayer()
                        }
                    },
                    onRemove = { ids ->
                        scope.launch {
                            runtime.lists.store.listMusicRemove(listId, ids)
                            runtime.core.handleListMusicsUpdated(listOf(listId))
                            items = runtime.lists.musics(listId)
                            selectedIds = emptySet()
                        }
                    },
                )
            }
            if (exportHintVisible) {
                val fileName = SafDocuments.exportFileName(displayTitle)
                YesNoDialog(
                    onDismissRequest = { exportHintVisible = false },
                    onConfirm = {
                        exportHintVisible = false
                        exportLauncher.launch(fileName)
                    },
                    title = "导出列表",
                    content =
                        "将把「$displayTitle」保存为 $fileName。\n" +
                            "若所选位置已有同名文件，系统会自动改名并追加「(1)」，不会覆盖原文件。",
                    cancelText = "取消",
                    confirmText = "选择保存位置",
                )
            }
            importConflict?.let { conflict ->
                BasicDialog(onDismissRequest = { importConflict = null }) {
                    DialogTitle(text = "导入列表")
                    Text(
                        text = "导入的列表「${conflict.importName}」与本地列表「${conflict.localName}」的 ID 相同，是否覆盖本地列表？",
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
            if (localImportVisible) {
                LocalFileImportDialog(
                    listTitle = localImportTitle.ifEmpty { displayTitle },
                    progress = localImportProgress,
                    outcome = localImportOutcome,
                    onCancel = { LocalMusicRuntime.cancel() },
                    onDismiss = {
                        localImportVisible = false
                        scope.launch { items = runtime.lists.musics(listId) }
                    },
                    staleCount = relinkStaleCount,
                    relinking = relinkingListId == listId,
                    relinkOutcome = relinkOutcome,
                    onRelink = { LocalMusicRuntime.relink(context, listId) },
                )
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
    }
}

/** SAF 读到的待导入文件；plainJson 决定走 `importJson` 还是 gzip 解包路径（RN 按扩展名分流）。 */
private data class PendingImport(
    val bytes: ByteArray,
    val plainJson: Boolean,
)

/** 单列表导入冲突信息（对照 RN handleImportListPart 的覆盖确认）。 */
private data class ImportPartConflict(
    val pending: PendingImport,
    val importName: String,
    val localName: String,
)

@Composable
private fun MusicTitle(
    item: JsonObject,
    index: Int,
    active: Boolean,
) {
    BasicText(
        text = "${index + 1}. ${item.text("name").orEmpty()}",
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        style =
            TextStyle(
                color = if (active) SaltTheme.colors.highlight else SaltTheme.colors.text,
                fontSize = 15.sp,
                fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
            ),
    )
    BasicText(
        text = item.text("singer").orEmpty(),
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        style = TextStyle(color = SaltTheme.colors.subText, fontSize = 12.sp),
    )
}

/** 多选状态的圆形勾选标记（不引入额外图标依赖）。 */
@Composable
private fun SelectMark(selected: Boolean) {
    val highlight = SaltTheme.colors.highlight
    val strokeColor = SaltTheme.colors.stroke
    Canvas(Modifier.size(20.dp)) {
        val radius = size.minDimension / 2f
        if (selected) {
            drawCircle(color = highlight, radius = radius)
            val path =
                Path().apply {
                    moveTo(size.width * 0.28f, size.height * 0.52f)
                    lineTo(size.width * 0.44f, size.height * 0.68f)
                    lineTo(size.width * 0.74f, size.height * 0.32f)
                }
            drawPath(
                path = path,
                color = Color.White,
                style =
                    Stroke(
                        width = size.width * 0.1f,
                        cap = StrokeCap.Round,
                        join = StrokeJoin.Round,
                    ),
            )
        } else {
            drawCircle(
                color = strokeColor,
                radius = radius - 1.dp.toPx(),
                style = Stroke(width = 1.5.dp.toPx()),
            )
        }
    }
}

/** 拖拽手柄：长按后上下拖动排序（编辑模式下显示）。 */
@Composable
private fun DragHandle(modifier: Modifier = Modifier) {
    val color = SaltTheme.colors.subText
    Canvas(modifier.size(40.dp)) {
        val lineWidth = 1.5.dp.toPx()
        for (i in -1..1) {
            val y = size.height / 2f + i * size.height * 0.18f
            drawLine(
                color = color,
                start = Offset(size.width * 0.32f, y),
                end = Offset(size.width * 0.68f, y),
                strokeWidth = lineWidth,
                cap = StrokeCap.Round,
            )
        }
    }
}

@Composable
private fun ActionText(
    label: String,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    BasicText(
        text = label,
        modifier =
            Modifier
                .clip(RoundedCornerShape(8.dp))
                .then(if (enabled) Modifier.clickable(onClick = onClick) else Modifier)
                .padding(horizontal = 10.dp, vertical = 6.dp),
        style =
            TextStyle(
                color = if (enabled) SaltTheme.colors.highlight else SaltTheme.colors.subText.copy(alpha = 0.4f),
                fontSize = 13.sp,
            ),
    )
}

private fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content
