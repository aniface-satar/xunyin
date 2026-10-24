package cn.toside.music.nativeapp.ui.list

import android.widget.Toast
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
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
import cn.toside.music.core.storage.StorageKeys
import cn.toside.music.nativeapp.player.PlayerRuntime
import com.moriafly.salt.ui.Button
import com.moriafly.salt.ui.Item
import com.moriafly.salt.ui.ItemArrowType
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

/**
 * 歌单详情页（B5 第一、三、五切片）—— 读取 ListStore 的列表歌曲、整表播放与编辑。
 *
 * 用户歌单支持重命名/清空/删除；任意列表支持单曲移除与多选批量删除/移动到其他列表；
 * 变更后同步随机队列（`PlayerCore.handleListMusicsUpdated`）。拖拽排序随后续切片补。
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

    LaunchedEffect(listId) { items = runtime.lists.musics(listId) }

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

    val currentId = playerState.playMusicInfo.musicInfo?.text("id")
    val currentListId = playerState.playerListId
    val playable = items.isNotEmpty()

    BasicScreen(onBack = onBack, title = displayTitle) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 2.dp),
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
                            if (editMode) {
                                SelectMark(selected = selected)
                                Column(Modifier.weight(1f).padding(start = 10.dp)) {
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
        }
    }
}

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
    onClick: () -> Unit,
) {
    BasicText(
        text = label,
        modifier =
            Modifier
                .clip(RoundedCornerShape(8.dp))
                .clickable(onClick = onClick)
                .padding(horizontal = 10.dp, vertical = 6.dp),
        style = TextStyle(color = SaltTheme.colors.highlight, fontSize = 13.sp),
    )
}

private fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content
