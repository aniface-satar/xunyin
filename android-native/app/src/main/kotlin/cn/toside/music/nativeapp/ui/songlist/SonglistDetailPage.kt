package cn.toside.music.nativeapp.ui.songlist

import android.widget.Toast
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cn.toside.music.core.list.ListStore
import cn.toside.music.core.list.SourceListMatch
import cn.toside.music.core.songlist.SonglistInfo
import cn.toside.music.core.storage.StorageKeys
import cn.toside.music.nativeapp.data.ListRuntime
import cn.toside.music.nativeapp.data.SonglistRuntime
import cn.toside.music.nativeapp.player.PlayerRuntime
import cn.toside.music.nativeapp.ui.play.CoverImageLoader
import com.moriafly.salt.ui.Button
import com.moriafly.salt.ui.SaltTheme
import com.moriafly.salt.ui.UnstableSaltUiApi
import com.moriafly.salt.ui.screen.BasicScreen
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * 在线歌单详情页（Wave2 Lane A + Wave3 Lane C 二轮）—— 对照 RN `screens/SonglistDetail`：
 *
 * - 头部信息（名称/作者/播放量/简介）+ 一张封面（复用 `CoverImageLoader`，LRU 只有 6 张，
 *   所以只取头图，不逐行取封面）；
 * - 30 条/展示页本地分页（`SonglistDetailPager`），接近尾部自动加载；
 * - 起播复用排行榜的临时列表链路：当前页写入 TEMP → `playListById(TEMP)`
 *   → 后台拉全整单补全队列（RN `handlePlay` 的快起播分支）；
 * - 单曲「加入我的歌单」+ 多选批量加入（对齐 Wave1 用户歌单多选页），
 *   落库走 `ListStore.listMusicAdd`（插入位置遵循设置），重复条目跳过。
 *
 * RN 的「整单导入为自建歌单」「下载/分享/相似歌曲」不在本波范围（见 lane 报告遗留）。
 */
@OptIn(UnstableSaltUiApi::class)
@Composable
fun SonglistDetailPage(
    source: String,
    id: String,
    title: String,
    onBack: () -> Unit,
    onOpenPlayer: () -> Unit,
) {
    val context = LocalContext.current
    val runtime = remember { PlayerRuntime.get(context) }
    val lists = remember { ListRuntime.get(context) }
    val scope = rememberCoroutineScope()
    var info by remember { mutableStateOf<SonglistInfo?>(null) }
    var items by remember { mutableStateOf<List<JsonObject>>(emptyList()) }
    var loading by remember { mutableStateOf(false) }
    var loadingMore by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var page by remember { mutableStateOf(1) }
    var reachedEnd by remember { mutableStateOf(false) }
    var loadedOnce by remember { mutableStateOf(false) }
    var editMode by remember(source, id) { mutableStateOf(false) }
    var selectedIds by remember(source, id) { mutableStateOf<Set<String>>(emptySet()) }
    var addTarget by remember { mutableStateOf<JsonObject?>(null) }
    var batchAddVisible by remember { mutableStateOf(false) }
    var cover by remember(source, id) { mutableStateOf<ImageBitmap?>(null) }
    var importingAsList by remember(source, id) { mutableStateOf(false) }

    fun load(
        targetPage: Int,
        isRefresh: Boolean = false,
    ) {
        scope.launch {
            if (targetPage == 1 && !isRefresh) loading = true else loadingMore = true
            error = null
            runCatching { SonglistRuntime.getListDetail(source, id, targetPage, isRefresh) }
                .onSuccess { result ->
                    items = result.list
                    info = result.info ?: info
                    page = targetPage
                    reachedEnd = SonglistRuntime.reachedEnd(source, id, targetPage)
                    loadedOnce = true
                }.onFailure {
                    if (targetPage == 1) items = emptyList()
                    error = it.message ?: "加载失败"
                }
            if (targetPage == 1 && !isRefresh) loading = false else loadingMore = false
        }
    }

    fun loadMore() {
        if (loading || loadingMore || reachedEnd) return
        load(page + 1)
    }

    LaunchedEffect(source, id) { load(1) }
    // 只加载一张头图（CoverImageLoader 的 LRU 仅 6 张，别给列表行挤缓存）
    LaunchedEffect(info?.img) {
        cover = info?.img?.let { CoverImageLoader.load(it)?.cover }
    }

    fun addLocation(): String =
        runtime.settings.store
            .string("list.addMusicLocationType")
            .ifEmpty { "top" }

    fun toast(message: String) = Toast.makeText(context, message, Toast.LENGTH_SHORT).show()

    /**
     * 整单导入（对照 RN SonglistDetail/listAction.ts#handleImportAsList）：
     * 整张外部歌单**新建一张自建歌单**（不是塞进已有列表），并写入 source/sourceListId，
     * 同一源+歌单 id 已有自建歌单时只提示、不建第二张。
     */
    fun importAsList() {
        if (importingAsList) return
        val name = info?.name ?: title
        scope.launch {
            val existingLists = lists.store.state.value.userLists
            if (SourceListMatch.find(existingLists, source, id) != null) {
                toast("这个歌单已经在你的自建歌单里了")
                return@launch
            }
            val normalized = lists.store.normalizeListName(name)
            if (normalized.isEmpty()) {
                toast("加入失败")
                return@launch
            }
            importingAsList = true
            toast("正在读取全部歌曲...")
            val full = runCatching { SonglistRuntime.getListDetailAll(source, id) }.getOrNull()
            if (full.isNullOrEmpty()) {
                importingAsList = false
                toast("加入失败")
                return@launch
            }
            val now = System.currentTimeMillis()
            val createdId = "userlist_$now"
            lists.store.userListCreate(
                ListStore.UserListInfo(
                    id = createdId,
                    name = normalized,
                    source = source,
                    sourceListId = id,
                    locationUpdateTime = now,
                ),
                position = existingLists.size,
            )
            // bottom 插入保持在线歌单原始顺序
            lists.store.listMusicAdd(createdId, full, "bottom")
            runtime.core.handleListMusicsUpdated(listOf(createdId))
            importingAsList = false
            toast("已加入自建歌单")
        }
    }

    /** 单曲加入：先查目标列表是否已有，重复则只提示不落库。 */
    fun addOne(
        music: JsonObject,
        listId: String,
    ) {
        scope.launch {
            val existed = lists.musics(listId).any { it.text("id") == music.text("id") }
            if (existed) {
                toast("该列表已经有这首歌啦")
                return@launch
            }
            lists.store.listMusicAdd(listId, listOf(music), addLocation())
            runtime.core.handleListMusicsUpdated(listOf(listId))
            toast("添加成功")
        }
    }

    /** 多选批量加入：跳过目标列表已有与本批次重复，全重复时提示对照 RN 文案。 */
    fun addSelected(listId: String) {
        batchAddVisible = false
        scope.launch {
            val selected =
                items.filter { item ->
                    item.text("id")?.let { selectedIds.contains(it) } == true
                }
            val plan = AddToMylist.plan(lists.musics(listId), selected)
            if (plan.toAdd.isEmpty()) {
                toast("该列表已经有这首歌啦")
            } else {
                lists.store.listMusicAdd(listId, plan.toAdd, addLocation())
                runtime.core.handleListMusicsUpdated(listOf(listId))
                toast(
                    if (plan.skipped > 0) {
                        "已添加 ${plan.toAdd.size} 首，跳过 ${plan.skipped} 首重复"
                    } else {
                        "已添加 ${plan.toAdd.size} 首"
                    },
                )
            }
            editMode = false
            selectedIds = emptySet()
        }
    }

    // 起播：写临时列表 → TEMP 起播；后台拉全整单补全队列（对照 RN handlePlay）
    fun play(
        list: List<JsonObject>,
        index: Int,
    ) {
        if (list.isEmpty()) return
        scope.launch {
            lists.store.listMusicOverwrite(StorageKeys.ListIds.TEMP, list)
            val musicId = list[index].text("id") ?: return@launch
            runtime.core.playListById(StorageKeys.ListIds.TEMP, musicId)
            runtime.core.handleListMusicsUpdated(listOf(StorageKeys.ListIds.TEMP))
            onOpenPlayer()
            runCatching { SonglistRuntime.getListDetailAll(source, id) }
                .onSuccess { full ->
                    if (full.size > list.size) {
                        lists.store.listMusicOverwrite(StorageKeys.ListIds.TEMP, full)
                        runtime.core.handleListMusicsUpdated(listOf(StorageKeys.ListIds.TEMP))
                    }
                }
        }
    }

    BasicScreen(onBack = onBack, title = info?.name ?: title) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            when {
                error != null ->
                    Column(
                        Modifier.fillMaxWidth().padding(24.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        BasicText(
                            text = error.orEmpty(),
                            style = TextStyle(color = SaltTheme.colors.subText, fontSize = 14.sp),
                        )
                        Button(
                            onClick = { if (loadedOnce) load(1) else load(1, isRefresh = true) },
                            text = "重试",
                            modifier = Modifier.padding(top = 12.dp),
                        )
                    }
                loading ->
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        BasicText(
                            text = "加载中…",
                            style = TextStyle(color = SaltTheme.colors.subText, fontSize = 14.sp),
                        )
                    }
                else -> {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 2.dp),
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        if (editMode) {
                            ActionText("完成") {
                                editMode = false
                                selectedIds = emptySet()
                            }
                            val allSelected = items.isNotEmpty() && selectedIds.size == items.size
                            ActionText(if (allSelected) "取消全选" else "全选") {
                                selectedIds =
                                    if (allSelected) {
                                        emptySet()
                                    } else {
                                        items.mapNotNull { it.text("id") }.toSet()
                                    }
                            }
                            ActionText("加入我的歌单", enabled = selectedIds.isNotEmpty()) {
                                batchAddVisible = true
                            }
                        } else {
                            ActionText("多选") {
                                editMode = true
                                selectedIds = emptySet()
                            }
                        }
                    }
                    val listState = rememberLazyListState()
                    val shouldLoadMore by remember {
                        derivedStateOf {
                            val total = listState.layoutInfo.totalItemsCount
                            val lastVisible =
                                listState.layoutInfo.visibleItemsInfo
                                    .lastOrNull()
                                    ?.index ?: -1
                            total > 0 && lastVisible >= total - 6
                        }
                    }
                    LaunchedEffect(shouldLoadMore) {
                        if (shouldLoadMore) loadMore()
                    }
                    LazyColumn(state = listState, modifier = Modifier.fillMaxSize()) {
                        item(key = "info") {
                            InfoHeader(
                                info = info,
                                fallbackTitle = title,
                                cover = cover,
                                selectedCount = if (editMode) selectedIds.size else 0,
                                importingAsList = importingAsList,
                                onPlayAll = { play(items, 0) },
                                onImportAsList = { importAsList() },
                            )
                        }
                        if (items.isEmpty()) {
                            item(key = "empty") {
                                Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
                                    BasicText(
                                        text = "暂无歌曲",
                                        style = TextStyle(color = SaltTheme.colors.subText, fontSize = 14.sp),
                                    )
                                }
                            }
                        } else {
                            itemsIndexed(
                                items,
                                key = { index, item -> item.text("id").orEmpty() + index },
                            ) { index, item ->
                                val musicId = item.text("id")
                                val selected = musicId != null && selectedIds.contains(musicId)
                                Row(
                                    modifier =
                                        Modifier
                                            .fillMaxWidth()
                                            .background(
                                                if (selected) {
                                                    SaltTheme.colors.highlight.copy(alpha = 0.08f)
                                                } else {
                                                    Color.Transparent
                                                },
                                            ).clickable {
                                                if (editMode) {
                                                    if (musicId != null) {
                                                        selectedIds =
                                                            if (selected) selectedIds - musicId else selectedIds + musicId
                                                    }
                                                } else {
                                                    play(items, index)
                                                }
                                            }.padding(start = 16.dp, end = 4.dp, top = 10.dp, bottom = 10.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    if (editMode) {
                                        SelectMark(selected = selected)
                                    } else {
                                        BasicText(
                                            text = "${index + 1}",
                                            modifier = Modifier.padding(end = 12.dp),
                                            style =
                                                TextStyle(
                                                    color = if (index < 3) SaltTheme.colors.highlight else SaltTheme.colors.subText,
                                                    fontSize = 14.sp,
                                                    fontWeight = if (index < 3) FontWeight.Bold else FontWeight.Normal,
                                                ),
                                        )
                                    }
                                    Column(Modifier.weight(1f).padding(start = if (editMode) 10.dp else 0.dp)) {
                                        BasicText(
                                            text = item.text("name").orEmpty(),
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis,
                                            style =
                                                TextStyle(
                                                    color = SaltTheme.colors.text,
                                                    fontSize = 15.sp,
                                                    fontWeight = FontWeight.Medium,
                                                ),
                                        )
                                        BasicText(
                                            text = item.text("singer").orEmpty(),
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis,
                                            style = TextStyle(color = SaltTheme.colors.subText, fontSize = 12.sp),
                                        )
                                    }
                                    if (!editMode) {
                                        BasicText(
                                            text = "加入",
                                            modifier =
                                                Modifier
                                                    .clip(RoundedCornerShape(8.dp))
                                                    .clickable { addTarget = item }
                                                    .padding(horizontal = 10.dp, vertical = 8.dp),
                                            style = TextStyle(color = SaltTheme.colors.highlight, fontSize = 13.sp),
                                        )
                                    }
                                }
                            }
                            if (loadingMore) {
                                item(key = "loading-more") {
                                    BasicText(
                                        text = "加载中…",
                                        modifier = Modifier.fillMaxWidth().padding(16.dp),
                                        style = TextStyle(color = SaltTheme.colors.subText, fontSize = 13.sp),
                                    )
                                }
                            } else if (reachedEnd) {
                                item(key = "end") {
                                    BasicText(
                                        text = "到底啦~",
                                        modifier = Modifier.fillMaxWidth().padding(16.dp),
                                        style = TextStyle(color = SaltTheme.colors.subText, fontSize = 13.sp),
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    addTarget?.let { music ->
        AddToListDialog(
            title = "把「${music.text("name").orEmpty()}」加入",
            onDismiss = { addTarget = null },
            onPick = { listId ->
                addTarget = null
                addOne(music, listId)
            },
        )
    }
    if (batchAddVisible) {
        AddToListDialog(
            title = "把已选的 ${selectedIds.size} 首加入",
            onDismiss = { batchAddVisible = false },
            onPick = { listId -> addSelected(listId) },
        )
    }
}

@Composable
private fun InfoHeader(
    info: SonglistInfo?,
    fallbackTitle: String,
    cover: ImageBitmap?,
    selectedCount: Int,
    importingAsList: Boolean,
    onPlayAll: () -> Unit,
    onImportAsList: () -> Unit,
) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
        Row {
            Box(
                modifier =
                    Modifier
                        .size(72.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .background(SaltTheme.colors.subBackground),
            ) {
                if (cover != null) {
                    Image(
                        bitmap = cover,
                        contentDescription = null,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxSize(),
                    )
                }
            }
            Column(Modifier.weight(1f).padding(start = 12.dp)) {
                BasicText(
                    text = info?.name ?: fallbackTitle,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    style =
                        TextStyle(
                            color = SaltTheme.colors.text,
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Bold,
                        ),
                )
                val meta =
                    listOfNotNull(
                        info?.author?.takeIf { it.isNotBlank() },
                        info?.playCount?.takeIf { it.isNotBlank() },
                    ).joinToString(" · ")
                if (meta.isNotEmpty()) {
                    BasicText(
                        text = meta,
                        modifier = Modifier.padding(top = 4.dp),
                        style = TextStyle(color = SaltTheme.colors.subText, fontSize = 12.sp),
                    )
                }
                info?.desc?.takeIf { it.isNotBlank() }?.let { desc ->
                    BasicText(
                        text = desc,
                        modifier = Modifier.padding(top = 6.dp),
                        maxLines = 3,
                        overflow = TextOverflow.Ellipsis,
                        style = TextStyle(color = SaltTheme.colors.subText, fontSize = 12.sp),
                    )
                }
            }
        }
        if (selectedCount > 0) {
            BasicText(
                text = "已选 $selectedCount 首",
                modifier = Modifier.padding(top = 8.dp),
                style = TextStyle(color = SaltTheme.colors.subText, fontSize = 12.sp),
            )
        }
        Row(
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Button(
                onClick = onPlayAll,
                text = "播放全部",
                modifier = Modifier.weight(1f),
            )
            Button(
                onClick = onImportAsList,
                text = if (importingAsList) "读取中…" else "导入为新歌单",
                enabled = !importingAsList,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

/** 多选状态的圆形勾选标记（对齐用户歌单多选页，不引入额外图标依赖）。 */
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
