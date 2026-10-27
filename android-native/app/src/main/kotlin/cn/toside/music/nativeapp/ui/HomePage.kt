package cn.toside.music.nativeapp.ui

import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cn.toside.music.core.backup.BackupManager
import cn.toside.music.core.storage.StorageKeys
import cn.toside.music.nativeapp.HomeNavigator
import cn.toside.music.nativeapp.HomeTab
import cn.toside.music.nativeapp.data.LeaderboardRuntime
import cn.toside.music.nativeapp.data.ListRuntime
import cn.toside.music.nativeapp.data.LocalMusicRuntime
import cn.toside.music.nativeapp.data.SearchRuntime
import cn.toside.music.nativeapp.deeplink.DeeplinkFileHost
import cn.toside.music.nativeapp.deeplink.DeeplinkRuntime
import cn.toside.music.nativeapp.player.PlayerRuntime
import cn.toside.music.nativeapp.ui.leaderboard.LeaderboardDetailPage
import cn.toside.music.nativeapp.ui.list.ListDetailPage
import cn.toside.music.nativeapp.ui.list.ListFullImportConfirmDialog
import cn.toside.music.nativeapp.ui.list.ListImportConflictDialog
import cn.toside.music.nativeapp.ui.list.ListMenuHost
import cn.toside.music.nativeapp.ui.list.ListMenuRequest
import cn.toside.music.nativeapp.ui.list.LocalFileImport
import cn.toside.music.nativeapp.ui.list.LocalFileImportDialog
import cn.toside.music.nativeapp.ui.list.onListLongPress
import cn.toside.music.nativeapp.ui.list.rememberListImportAction
import cn.toside.music.nativeapp.ui.list.rememberListImportFlow
import cn.toside.music.nativeapp.ui.radio.RadioPage
import cn.toside.music.nativeapp.ui.search.AlbumDetailPage
import cn.toside.music.nativeapp.ui.search.ArtistDetailPage
import cn.toside.music.nativeapp.ui.search.SearchPage
import cn.toside.music.nativeapp.ui.songlist.RecommendPanel
import cn.toside.music.nativeapp.ui.songlist.SonglistDetailPage
import cn.toside.music.nativeapp.ui.songlist.SonglistPanel
import cn.toside.music.nativeapp.util.SafDocuments
import com.moriafly.salt.ui.Item
import com.moriafly.salt.ui.ItemSpacer
import com.moriafly.salt.ui.SaltTheme
import com.moriafly.salt.ui.Text
import com.moriafly.salt.ui.UnstableSaltUiApi
import com.moriafly.salt.ui.dialog.InputDialog
import com.moriafly.salt.ui.dialog.YesNoDialog
import kotlinx.coroutines.launch

private enum class DiscoverSection {
    RECOMMEND,
    RANKING,
    SONGLIST,
}

/** 首页正式导航壳：三个一级 tab、独立详情栈、迷你播放条与全局设置入口。 */
@Composable
fun HomePage(
    navigator: HomeNavigator,
    onOpenPlayer: () -> Unit,
    onOpenSettings: () -> Unit,
) {
    var discoverSection by remember { mutableStateOf(DiscoverSection.RECOMMEND) }
    val currentDetail = navigator.currentDetail()
    val context = LocalContext.current

    // 冷启动（进程被 deeplink 拉起）时命令先进队列，导航器一挂上就补发
    DisposableEffect(navigator) {
        DeeplinkRuntime.attach(navigator)
        onDispose { }
    }

    // ---------- 本地曲库：目录选择器宿主（Lane C 首页长按菜单的「添加本地歌曲」走这里） ----------
    // 首页常驻注册，列表详情页在屏时会再压一层（见 LocalMusicRuntime 的宿主栈），
    // 退场只弹自己那一层，首页入口不会因此失效。
    var localTargetListId by remember { mutableStateOf("") }
    var localTargetTitle by remember { mutableStateOf("") }
    var localImportVisible by remember { mutableStateOf(false) }
    val localImportProgress by LocalMusicRuntime.progress.collectAsState()
    val localImportOutcome by LocalMusicRuntime.outcome.collectAsState()

    // 目录授权必须立刻持久化，否则重启后 `content://` 全部失效（RN 用真实路径没这问题）
    val localTreeLauncher =
        rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
            if (uri == null) return@rememberLauncherForActivityResult
            val persisted = SafDocuments.takePersistablePermission(context, uri)
            if (!persisted || !SafDocuments.hasPersistedPermission(context, uri)) {
                Toast.makeText(context, "目录授权未能持久保存，重启应用后可能无法继续播放", Toast.LENGTH_SHORT).show()
            }
            localImportVisible = true
            LocalMusicRuntime.importTree(context, localTargetListId, localTargetTitle, uri)
        }

    val localPickerOwner = remember { Any() }
    DisposableEffect(localPickerOwner) {
        LocalMusicRuntime.registerPicker(localPickerOwner) { listId, title ->
            localTargetListId = listId
            localTargetTitle = title
            localTreeLauncher.launch(null)
        }
        // 装配 Lane C 留的注入点：菜单项的可用性由 importTo 是否为 null 决定
        LocalFileImport.importTo = LocalMusicRuntime::importTo
        onDispose { LocalMusicRuntime.unregisterPicker(localPickerOwner) }
    }

    BackHandler(enabled = currentDetail != null) {
        navigator.back()
    }

    Column(Modifier.fillMaxSize().background(SaltTheme.colors.background)) {
        if (currentDetail == null) {
            HomeTopBar(
                title =
                    when (navigator.currentTab) {
                        HomeTab.DISCOVER -> "发现"
                        HomeTab.MY -> "我的"
                        HomeTab.SEARCH -> "搜索"
                    },
                onOpenSettings = onOpenSettings,
            )
        }
        RetainedContent(
            visibleIndex = navigator.currentTab.ordinal,
            modifier = Modifier.weight(1f),
        ) {
            HomeTab.entries.forEach { tab ->
                HomeTabContent(
                    tab = tab,
                    navigator = navigator,
                    discoverSection = discoverSection,
                    onDiscoverSectionChange = { discoverSection = it },
                    onOpenPlayer = onOpenPlayer,
                    onOpenSettings = onOpenSettings,
                )
            }
        }
        MiniPlayer(onOpen = onOpenPlayer)
        HomeBottomTabs(
            currentTab = navigator.currentTab,
            onSelect = { tab ->
                val reset = navigator.selectTab(tab)
                if (reset && tab == HomeTab.DISCOVER) {
                    discoverSection = DiscoverSection.RECOMMEND
                }
            },
        )
        // deeplink 落下来的 json/lxmc 文件确认层（首页常驻，进详情页也不销毁）
        DeeplinkFileHost()
        // 本地曲库导入进度/结果：首页菜单触发的导入在此显示（详情页有自己的那一层）
        if (localImportVisible) {
            LocalFileImportDialog(
                listTitle = localTargetTitle,
                progress = localImportProgress,
                outcome = localImportOutcome,
                onCancel = { LocalMusicRuntime.cancel() },
                onDismiss = { localImportVisible = false },
            )
        }
    }
}

@Composable
private fun HomeTabContent(
    tab: HomeTab,
    navigator: HomeNavigator,
    discoverSection: DiscoverSection,
    onDiscoverSectionChange: (DiscoverSection) -> Unit,
    onOpenPlayer: () -> Unit,
    onOpenSettings: () -> Unit,
) {
    val detail = navigator.currentDetail(tab)
    RetainedContent(
        visibleIndex = if (detail == null) 0 else 1,
        modifier = Modifier.fillMaxSize(),
    ) {
        when (tab) {
            HomeTab.DISCOVER ->
                DiscoverPage(
                    section = discoverSection,
                    onSectionChange = onDiscoverSectionChange,
                    onOpenLeaderboard = { boardId, title ->
                        navigator.push(HomeNavigator.Route.LeaderboardDetail(boardId, title))
                    },
                    onOpenSonglist = { source, id, title ->
                        navigator.push(HomeNavigator.Route.SonglistDetail(source, id, title))
                    },
                    onOpenRadio = { navigator.push(HomeNavigator.Route.Radio) },
                    onOpenPlayer = onOpenPlayer,
                )
            HomeTab.MY ->
                MyPage(
                    onOpenList = { listId, title ->
                        navigator.push(HomeNavigator.Route.ListDetail(listId, title))
                    },
                    onOpenSettings = onOpenSettings,
                )
            HomeTab.SEARCH ->
                SearchPage(
                    onBack = null,
                    onOpenPlayer = onOpenPlayer,
                    // W6-6：三类详情改走导航栈（返回保留关键词/结果/滚动位置）
                    onOpenSonglist = { source, id, title ->
                        navigator.push(HomeNavigator.Route.SonglistDetail(source, id, title))
                    },
                    onOpenAlbum = { item ->
                        navigator.push(HomeNavigator.Route.AlbumDetail(item.source, item.id, item))
                    },
                    onOpenArtist = { item ->
                        navigator.push(HomeNavigator.Route.ArtistDetail(item.source, item))
                    },
                )
        }
        when (detail) {
            null -> Unit
            is HomeNavigator.Route.ListDetail ->
                ListDetailPage(
                    listId = detail.listId,
                    title = detail.title,
                    onBack = { navigator.back() },
                    onOpenPlayer = onOpenPlayer,
                )
            is HomeNavigator.Route.LeaderboardDetail ->
                LeaderboardDetailPage(
                    boardId = detail.boardId,
                    title = detail.title,
                    onBack = { navigator.back() },
                    onOpenPlayer = onOpenPlayer,
                )
            is HomeNavigator.Route.SonglistDetail ->
                SonglistDetailPage(
                    source = detail.source,
                    id = detail.id,
                    title = detail.title,
                    onBack = { navigator.back() },
                    onOpenPlayer = onOpenPlayer,
                )
            HomeNavigator.Route.Radio ->
                RadioPage(
                    onBack = { navigator.back() },
                    onOpenPlayer = onOpenPlayer,
                )
            is HomeNavigator.Route.AlbumDetail ->
                AlbumDetailPage(
                    source = detail.source,
                    id = detail.id,
                    fallback = detail.fallback,
                    onBack = { navigator.back() },
                    onOpenPlayer = onOpenPlayer,
                )
            is HomeNavigator.Route.ArtistDetail ->
                ArtistDetailPage(
                    source = detail.source,
                    artist = detail.artist,
                    onBack = { navigator.back() },
                    onOpenPlayer = onOpenPlayer,
                )
        }
    }
}

@Composable
private fun HomeTopBar(
    title: String,
    onOpenSettings: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .statusBarsPadding()
                .height(56.dp)
                .padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = title,
            modifier = Modifier.weight(1f),
            color = SaltTheme.colors.text,
            fontSize = 22.sp,
            fontWeight = FontWeight.Bold,
        )
        Box(
            modifier =
                Modifier
                    .height(48.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .clickable(onClick = onOpenSettings)
                    .padding(horizontal = 12.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(text = "设置", color = SaltTheme.colors.highlight)
        }
    }
}

@Composable
private fun HomeBottomTabs(
    currentTab: HomeTab,
    onSelect: (HomeTab) -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .background(SaltTheme.colors.subBackground)
                .navigationBarsPadding()
                .height(56.dp),
    ) {
        HomeTab.entries.forEach { tab ->
            val selected = tab == currentTab
            val label =
                when (tab) {
                    HomeTab.DISCOVER -> "发现"
                    HomeTab.MY -> "我的"
                    HomeTab.SEARCH -> "搜索"
                }
            Box(
                modifier =
                    Modifier
                        .weight(1f)
                        .height(56.dp)
                        .clickable { onSelect(tab) },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = label,
                    color = if (selected) SaltTheme.colors.highlight else SaltTheme.colors.subText,
                    fontSize = 15.sp,
                    fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                )
            }
        }
    }
}

@Composable
private fun DiscoverPage(
    section: DiscoverSection,
    onSectionChange: (DiscoverSection) -> Unit,
    onOpenLeaderboard: (String, String) -> Unit,
    onOpenSonglist: (String, String, String) -> Unit,
    onOpenRadio: () -> Unit,
    onOpenPlayer: () -> Unit,
) {
    Column(Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            DiscoverSection.entries.forEach { item ->
                val selected = item == section
                val label =
                    when (item) {
                        DiscoverSection.RECOMMEND -> "推荐"
                        DiscoverSection.RANKING -> "排行榜"
                        DiscoverSection.SONGLIST -> "歌单"
                    }
                Box(
                    modifier =
                        Modifier
                            .weight(1f)
                            .height(48.dp)
                            .clip(RoundedCornerShape(10.dp))
                            .background(
                                if (selected) {
                                    SaltTheme.colors.highlight.copy(alpha = 0.12f)
                                } else {
                                    Color.Transparent
                                },
                            ).clickable { onSectionChange(item) },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = label,
                        color = if (selected) SaltTheme.colors.highlight else SaltTheme.colors.subText,
                        fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                    )
                }
            }
        }
        when (section) {
            DiscoverSection.RECOMMEND ->
                RecommendPanel(
                    onOpenSonglist = onOpenSonglist,
                    onOpenRadio = onOpenRadio,
                    onOpenPlayer = onOpenPlayer,
                )
            DiscoverSection.RANKING ->
                LeaderboardBoardsPage(onOpenLeaderboard = onOpenLeaderboard)
            DiscoverSection.SONGLIST ->
                SonglistPanel(onOpenSonglist = onOpenSonglist)
        }
    }
}

@Composable
private fun DiscoverPlaceholder(message: String) {
    Box(
        modifier = Modifier.fillMaxSize().padding(32.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text = message, color = SaltTheme.colors.subText)
    }
}

/** 排行榜面板：源选择 + 榜单网格（B5 第九切片；kw/kg 可进详情，其余源提示未接入）。 */
@Composable
private fun LeaderboardBoardsPage(onOpenLeaderboard: (String, String) -> Unit) {
    val context = LocalContext.current
    var source by remember { mutableStateOf("kw") }
    val boards = remember(source) { LeaderboardRuntime.boards(source) }
    Column(Modifier.fillMaxSize()) {
        // 源选择横滑条
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
        ) {
            SearchRuntime.SOURCES
                .filter { it.first != "all" }
                .forEach { (id, label) ->
                    val selected = id == source
                    Box(
                        modifier =
                            Modifier
                                .weight(1f)
                                .clip(RoundedCornerShape(8.dp))
                                .background(if (selected) SaltTheme.colors.highlight.copy(alpha = 0.12f) else Color.Transparent)
                                .clickable { source = id }
                                .padding(vertical = 8.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            text = label.removeSuffix("音乐"),
                            color = if (selected) SaltTheme.colors.highlight else SaltTheme.colors.subText,
                            fontSize = 13.sp,
                            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                        )
                    }
                }
        }
        val detailSupported = LeaderboardRuntime.isDetailSupported(source)
        LazyColumn(Modifier.fillMaxSize()) {
            itemsIndexed(boards) { _, board ->
                Item(
                    onClick = {
                        if (detailSupported) {
                            onOpenLeaderboard(board.id, board.name)
                        } else {
                            Toast
                                .makeText(context, "该源的榜单详情暂未接入", Toast.LENGTH_SHORT)
                                .show()
                        }
                    },
                    text = board.name,
                )
            }
            item { ItemSpacer() }
        }
    }
}

@OptIn(UnstableSaltUiApi::class)
@Composable
private fun MyPage(
    onOpenList: (listId: String, title: String) -> Unit,
    onOpenSettings: () -> Unit,
) {
    val context = LocalContext.current
    val lists = remember { ListRuntime.get(context) }
    val listState by lists.store.state.collectAsState()
    val scope = rememberCoroutineScope()
    var createName by remember { mutableStateOf("") }
    var createVisible by remember { mutableStateOf(false) }
    var duplicateName by remember { mutableStateOf<String?>(null) }
    var menuRequest by remember { mutableStateOf<ListMenuRequest?>(null) }
    LaunchedEffect(Unit) { lists.ensureLoaded() }

    // 旧版（RN 版，applicationId 不同）歌单迁移入口。列表为空时直接给一条明路，
    // 免得用户非得先摸到「长按列表 → 导入」。导入流程与列表页共用同一套实现。
    val runtime = remember { PlayerRuntime.get(context) }
    val backup = remember { BackupManager(runtime.lists.store) }
    val importFlow =
        rememberListImportFlow(
            runtime = runtime,
            backup = backup,
            toast = { Toast.makeText(context, it, Toast.LENGTH_SHORT).show() },
            onImported = { result ->
                when (result) {
                    is BackupManager.ImportResult.PartImported ->
                        runtime.core.handleListMusicsUpdated(listOf(result.listInfo.id))
                    BackupManager.ImportResult.FullImported -> {
                        val userLists = runtime.lists.store.state.value.userLists
                        runtime.core.handleListMusicsUpdated(
                            listOf(StorageKeys.ListIds.DEFAULT, StorageKeys.ListIds.LOVE) +
                                userLists.map { it.id },
                        )
                    }
                    else -> Unit
                }
            },
        )
    val importAction = rememberListImportAction { importFlow.start(it) }

    Box(Modifier.fillMaxSize()) {
        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.Top),
        ) {
            Text(text = "我的列表", color = SaltTheme.colors.subText)
            if (listState.userLists.isEmpty()) {
                // 自动迁移（RnAutoMigration）没带过来时的兜底入口。
                Text(
                    text = "旧版歌单会在首次启动时自动带过来；若没出现，可在旧版「设置 → 备份 → 导出列表」后点下面导入。",
                    color = SaltTheme.colors.subText,
                )
                Item(onClick = { importAction() }, text = "从旧版导入歌单")
            }
            Item(
                onClick = {
                    createName = ""
                    createVisible = true
                },
                text = "新建列表",
            )
            Item(
                onClick = { onOpenList(StorageKeys.ListIds.DEFAULT, "试听列表") },
                text = "试听列表",
                modifier = Modifier.onListLongPress { menuRequest = ListMenuRequest(StorageKeys.ListIds.DEFAULT, "试听列表") },
            )
            Item(
                onClick = { onOpenList(StorageKeys.ListIds.LOVE, "我的收藏") },
                text = "我的收藏",
                modifier = Modifier.onListLongPress { menuRequest = ListMenuRequest(StorageKeys.ListIds.LOVE, "我的收藏") },
            )
            listState.userLists.forEach { info ->
                Item(
                    onClick = { onOpenList(info.id, info.name) },
                    text = info.name,
                    modifier = Modifier.onListLongPress { menuRequest = ListMenuRequest(info.id, info.name) },
                )
            }
            ItemSpacer()
            Item(onClick = onOpenSettings, text = "设置")
        }
        if (createVisible) {
            InputDialog(
                onDismissRequest = { createVisible = false },
                onConfirm = {
                    val normalized = lists.store.normalizeListName(createName)
                    if (normalized.isNotEmpty()) {
                        createVisible = false
                        if (lists.store.hasUserListNamed(normalized)) {
                            duplicateName = normalized
                        } else {
                            scope.launch { lists.store.createUserList(normalized) }
                        }
                    }
                },
                onChange = { createName = it },
                title = "新建列表",
                text = createName,
                hint = "你想起啥名...",
                cancelText = "取消",
                confirmText = "确定",
            )
        }
        duplicateName?.let { pendingName ->
            YesNoDialog(
                onDismissRequest = { duplicateName = null },
                onConfirm = {
                    duplicateName = null
                    scope.launch { lists.store.createUserList(pendingName) }
                },
                title = "新建列表",
                content = "已存在同名列表，是否继续创建？",
                cancelText = "取消",
                confirmText = "确定",
            )
        }
        // 长按列表行 → RN 同构九项菜单（重命名/排序/去重/本地/更新/导入/导出/删除）
        ListMenuHost(
            request = menuRequest,
            onDismiss = { menuRequest = null },
            onOpenList = onOpenList,
            onCreateList = {
                createName = ""
                createVisible = true
            },
        )
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
}

/** 仅测量并摆放当前页，未选中页仍留在组合中以保留一级页面与详情状态。 */
@Composable
internal fun RetainedContent(
    visibleIndex: Int,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Layout(content = content, modifier = modifier) { measurables, constraints ->
        val placeable = measurables.getOrNull(visibleIndex)?.measure(constraints)
        layout(placeable?.width ?: constraints.minWidth, placeable?.height ?: constraints.minHeight) {
            placeable?.place(0, 0)
        }
    }
}
