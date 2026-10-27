package cn.toside.music.nativeapp.ui.search

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cn.toside.music.core.music.search.SonglistSearchItem
import cn.toside.music.core.music.search.album.AlbumItem
import cn.toside.music.core.music.search.artist.ArtistItem
import cn.toside.music.core.storage.StorageKeys
import cn.toside.music.nativeapp.data.AlbumSearchRuntime
import cn.toside.music.nativeapp.data.ArtistSearchRuntime
import cn.toside.music.nativeapp.data.ListRuntime
import cn.toside.music.nativeapp.data.SearchRuntime
import cn.toside.music.nativeapp.data.SearchTypes
import cn.toside.music.nativeapp.data.SonglistSearchRuntime
import cn.toside.music.nativeapp.player.PlayerRuntime
import cn.toside.music.nativeapp.ui.songlist.AddToListDialog
import com.moriafly.salt.ui.Button
import com.moriafly.salt.ui.SaltTheme
import com.moriafly.salt.ui.Text
import com.moriafly.salt.ui.UnstableSaltUiApi
import com.moriafly.salt.ui.screen.BasicScreen
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * 搜索页（B5 第八切片 + S12 歌单类型 + W6 专辑/歌手类型）——
 * 五源单曲/歌单/专辑/歌手搜索 + 「全部」聚合 + 翻页 + 详情走导航栈（W6-6）。
 *
 * 对照 RN `screens/Home/Views/Search`：HeaderBar 的源下拉（含「全部」）+
 * SearchTypeSelector 的四类型切换 + OnlineList 的 onEndReached 加载更多。
 * 点击歌曲 = 写入试听列表 → `playListById` → 进播放页；点击歌单/专辑/歌手 =
 * 压进 [cn.toside.music.nativeapp.HomeNavigator] 的详情栈（W6-6 前的页内覆盖已移除）。
 */
@OptIn(UnstableSaltUiApi::class)
@Composable
fun SearchPage(
    onBack: (() -> Unit)? = null,
    onOpenPlayer: () -> Unit,
    /**
     * W6-6：三类详情改走 [cn.toside.music.nativeapp.HomeNavigator] 的详情栈。
     *
     * 页内覆盖（`detailTarget` 那种 `return` 换内容）会丢掉搜索页的组合状态之外的东西：
     * 返回时关键词/结果/滚动位置靠 `remember` 侥幸留住，但详情再叠详情（歌手 → 专辑）
     * 与系统返回键的层级都对不上。改走导航栈后，搜索页留在组合里不销毁，
     * 返回只是弹栈，状态天然保留。**搜索逻辑与详情页本体一点没动。**
     */
    onOpenSonglist: (source: String, id: String, title: String) -> Unit = { _, _, _ -> },
    onOpenAlbum: (AlbumItem) -> Unit = {},
    onOpenArtist: (ArtistItem) -> Unit = {},
) {
    val context = LocalContext.current
    val runtime = remember { PlayerRuntime.get(context) }
    val scope = rememberCoroutineScope()
    var keyword by remember { mutableStateOf("") }
    var source by remember { mutableStateOf("kw") }
    var searchType by remember { mutableStateOf(SearchTypes.MUSIC) }
    var items by remember { mutableStateOf<List<JsonObject>>(emptyList()) }
    var songlists by remember { mutableStateOf<List<SonglistSearchItem>>(emptyList()) }
    var albums by remember { mutableStateOf<List<AlbumItem>>(emptyList()) }
    var artists by remember { mutableStateOf<List<ArtistItem>>(emptyList()) }
    var loading by remember { mutableStateOf(false) }
    var loadingMore by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var searched by remember { mutableStateOf(false) }
    var reachedEnd by remember { mutableStateOf(false) }
    var activeKeyword by remember { mutableStateOf("") }
    var page by remember { mutableStateOf(1) }
    var addTarget by remember { mutableStateOf<JsonObject?>(null) }
    val lists = remember { ListRuntime.get(context) }
    LaunchedEffect(Unit) { runtime.settings.ensureLoaded() }

    fun addLocation(): String =
        runtime.settings.store
            .string("list.addMusicLocationType")
            .ifEmpty { "top" }

    fun runSearch(
        text: String,
        targetPage: Int,
    ) {
        val type = searchType
        scope.launch {
            if (targetPage == 1) {
                loading = true
                items = emptyList()
                songlists = emptyList()
                albums = emptyList()
                artists = emptyList()
            } else {
                loadingMore = true
            }
            error = null
            when (type) {
                SearchTypes.MUSIC ->
                    runCatching { SearchRuntime.search(text, targetPage, source) }
                        .onSuccess { result ->
                            if (result == null || type != searchType) return@launch // 旧关键词的迟到响应
                            items = result.list
                            page = targetPage
                            searched = true
                            activeKeyword = text
                            reachedEnd = SearchRuntime.reachedEnd(source, targetPage)
                        }.onFailure {
                            if (type != searchType) return@launch
                            if (targetPage == 1) items = emptyList()
                            error = it.message ?: "搜索失败"
                        }
                SearchTypes.SONGLIST ->
                    runCatching { SonglistSearchRuntime.search(text, targetPage, source) }
                        .onSuccess { result ->
                            if (result == null || type != searchType) return@launch
                            songlists = result.list
                            page = targetPage
                            searched = true
                            activeKeyword = text
                            reachedEnd = SonglistSearchRuntime.reachedEnd(source, targetPage)
                        }.onFailure {
                            if (type != searchType) return@launch
                            if (targetPage == 1) songlists = emptyList()
                            error = it.message ?: "搜索失败"
                        }
                SearchTypes.ALBUM ->
                    runCatching { AlbumSearchRuntime.search(text, targetPage, source) }
                        .onSuccess { result ->
                            if (result == null || type != searchType) return@launch
                            albums = result.list
                            page = targetPage
                            searched = true
                            activeKeyword = text
                            reachedEnd = AlbumSearchRuntime.reachedEnd(source, targetPage)
                        }.onFailure {
                            if (type != searchType) return@launch
                            if (targetPage == 1) albums = emptyList()
                            error = it.message ?: "搜索失败"
                        }
                else ->
                    runCatching { ArtistSearchRuntime.search(text, targetPage, source) }
                        .onSuccess { result ->
                            if (result == null || type != searchType) return@launch
                            artists = result.list
                            page = targetPage
                            searched = true
                            activeKeyword = text
                            reachedEnd = ArtistSearchRuntime.reachedEnd(source, targetPage)
                        }.onFailure {
                            if (type != searchType) return@launch
                            if (targetPage == 1) artists = emptyList()
                            error = it.message ?: "搜索失败"
                        }
            }
            if (targetPage == 1) loading = false else loadingMore = false
        }
    }

    fun submit() {
        val text = keyword.trim()
        if (text.isEmpty() || loading) return
        page = 1
        runSearch(text, 1)
    }

    fun loadMore() {
        if (loading || loadingMore || reachedEnd || activeKeyword.isEmpty()) return
        runSearch(activeKeyword, page + 1)
    }

    fun switchType(next: String) {
        if (next == searchType) return
        searchType = next
        items = emptyList()
        songlists = emptyList()
        albums = emptyList()
        artists = emptyList()
        searched = false
        error = null
        reachedEnd = false
        page = 1
        // 置灰规则：新类型禁用当前源（歌手类型禁 tx）时回落到 kw（SearchTypes.effectiveSource）
        source = SearchTypes.effectiveSource(next, source)
        // RN searchTypeChanged：用上一次提交的关键词立即重查（缓存命中则不发请求）
        if (activeKeyword.isNotEmpty()) runSearch(activeKeyword, 1)
    }

    fun switchSource(picked: String) {
        if (picked == source) return
        // 置灰规则兜底：禁用源不可选中（歌手类型禁 tx）
        if (!SearchTypes.isSourceEnabled(searchType, picked)) return
        source = picked
        val text = keyword.trim()
        searched = false
        error = null
        reachedEnd = false
        if (text.isNotEmpty()) {
            page = 1
            runSearch(text, 1)
        } else {
            items = emptyList()
            songlists = emptyList()
        }
    }

    val searchContent: @Composable (Modifier) -> Unit = { contentModifier ->
        Column(contentModifier) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                BasicTextField(
                    value = keyword,
                    onValueChange = { keyword = it },
                    singleLine = true,
                    textStyle = TextStyle(color = SaltTheme.colors.text, fontSize = 15.sp),
                    cursorBrush = SolidColor(SaltTheme.colors.highlight),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    keyboardActions = KeyboardActions(onSearch = { submit() }),
                    modifier =
                        Modifier
                            .weight(1f)
                            .heightIn(min = 48.dp)
                            .clip(RoundedCornerShape(10.dp))
                            .background(SaltTheme.colors.subBackground)
                            .padding(horizontal = 12.dp, vertical = 10.dp),
                )
                Button(
                    onClick = { submit() },
                    text = if (loading) "搜索中" else "搜索",
                    modifier = Modifier.heightIn(min = 48.dp),
                )
            }
            SourceTabs(
                source = source,
                enabled = SearchTypes.enabledSources(searchType),
                onSelect = { switchSource(it) },
            )
            SearchTypeTabs(type = searchType, onSelect = { switchType(it) })
            when {
                error != null ->
                    Text(
                        text = error.orEmpty(),
                        modifier = Modifier.fillMaxWidth().padding(24.dp),
                        color = SaltTheme.colors.subText,
                    )
                loading ->
                    Text(
                        text = "正在搜索…",
                        modifier = Modifier.fillMaxWidth().padding(24.dp),
                        color = SaltTheme.colors.subText,
                    )
                searchType == SearchTypes.SONGLIST -> {
                    if (searched && songlists.isEmpty()) {
                        Text(
                            text = "没有找到歌单",
                            modifier = Modifier.fillMaxWidth().padding(24.dp),
                            color = SaltTheme.colors.subText,
                        )
                    } else {
                        SonglistResults(
                            songlists = songlists,
                            loadingMore = loadingMore,
                            reachedEnd = reachedEnd,
                            showSource = source == "all",
                            onEndReached = { loadMore() },
                            onOpen = { onOpenSonglist(it.source, it.id, it.name) },
                        )
                    }
                }
                searchType == SearchTypes.ALBUM -> {
                    if (searched && albums.isEmpty()) {
                        Text(
                            text = "没有找到专辑",
                            modifier = Modifier.fillMaxWidth().padding(24.dp),
                            color = SaltTheme.colors.subText,
                        )
                    } else {
                        AlbumResults(
                            albums = albums,
                            loadingMore = loadingMore,
                            reachedEnd = reachedEnd,
                            showSource = source == "all",
                            onEndReached = { loadMore() },
                            onOpen = onOpenAlbum,
                        )
                    }
                }
                searchType == SearchTypes.ARTIST -> {
                    if (searched && artists.isEmpty()) {
                        Text(
                            text = "没有找到歌手",
                            modifier = Modifier.fillMaxWidth().padding(24.dp),
                            color = SaltTheme.colors.subText,
                        )
                    } else {
                        ArtistResults(
                            artists = artists,
                            loadingMore = loadingMore,
                            reachedEnd = reachedEnd,
                            showSource = source == "all",
                            onEndReached = { loadMore() },
                            onOpen = onOpenArtist,
                        )
                    }
                }
                searched && items.isEmpty() ->
                    Text(
                        text = "没有找到歌曲",
                        modifier = Modifier.fillMaxWidth().padding(24.dp),
                        color = SaltTheme.colors.subText,
                    )
                else -> {
                    if (items.isNotEmpty()) {
                        Text(
                            text = "点击歌曲会加入试听列表并播放",
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                            color = SaltTheme.colors.subText,
                        )
                    }
                    val listState = rememberLazyListState()
                    // 对照 RN OnlineList onEndReached：接近列表尾自动加载下一页
                    val shouldLoadMore by remember {
                        derivedStateOf {
                            val last = listState.layoutInfo.totalItemsCount
                            val lastVisible =
                                listState.layoutInfo.visibleItemsInfo
                                    .lastOrNull()
                                    ?.index ?: -1
                            last > 0 && lastVisible >= last - 6
                        }
                    }
                    LaunchedEffect(shouldLoadMore) {
                        if (shouldLoadMore) loadMore()
                    }
                    LazyColumn(
                        state = listState,
                        modifier = Modifier.fillMaxSize(),
                    ) {
                        itemsIndexed(items, key = { _, item -> item.text("id").orEmpty() + item.hashCode() }) { _, item ->
                            val id = item.text("id") ?: return@itemsIndexed
                            Row(
                                modifier =
                                    Modifier
                                        .fillMaxWidth()
                                        .clickable {
                                            scope.launch {
                                                lists.store.listMusicAdd(
                                                    StorageKeys.ListIds.DEFAULT,
                                                    listOf(item),
                                                    addLocation(),
                                                )
                                                runtime.core.playListById(StorageKeys.ListIds.DEFAULT, id)
                                                onOpenPlayer()
                                            }
                                        }.padding(start = 16.dp, end = 4.dp, top = 10.dp, bottom = 10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(Modifier.weight(1f)) {
                                    val album = item.metaText("albumName").orEmpty()
                                    val singer =
                                        buildString {
                                            append(item.text("singer").orEmpty())
                                            if (album.isNotEmpty()) append(" · $album")
                                        }
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
                                        text = singer,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                        style = TextStyle(color = SaltTheme.colors.subText, fontSize = 12.sp),
                                    )
                                }
                                BasicText(
                                    text = "加入",
                                    modifier =
                                        Modifier
                                            .heightIn(min = 48.dp)
                                            .clip(RoundedCornerShape(8.dp))
                                            .clickable { addTarget = item }
                                            .padding(horizontal = 10.dp, vertical = 8.dp),
                                    style = TextStyle(color = SaltTheme.colors.highlight, fontSize = 13.sp),
                                )
                            }
                        }
                        if (loadingMore) {
                            item(key = "loading-more") {
                                Text(
                                    text = "加载中…",
                                    modifier = Modifier.fillMaxWidth().padding(16.dp),
                                    color = SaltTheme.colors.subText,
                                )
                            }
                        } else if (reachedEnd && items.isNotEmpty()) {
                            item(key = "end") {
                                Text(
                                    text = "到底啦~",
                                    modifier = Modifier.fillMaxWidth().padding(16.dp),
                                    color = SaltTheme.colors.subText,
                                )
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
                        scope.launch {
                            val existed = lists.musics(listId).any { it.text("id") == music.text("id") }
                            if (!existed) {
                                lists.store.listMusicAdd(listId, listOf(music), addLocation())
                                runtime.core.handleListMusicsUpdated(listOf(listId))
                            }
                            Toast
                                .makeText(
                                    context,
                                    if (existed) "该列表已经有这首歌啦" else "添加成功",
                                    Toast.LENGTH_SHORT,
                                ).show()
                        }
                    },
                )
            }
        }
    }
    if (onBack == null) {
        searchContent(Modifier.fillMaxSize())
    } else {
        BasicScreen(onBack = onBack, title = "搜索") { padding ->
            searchContent(Modifier.fillMaxSize().padding(padding))
        }
    }
}

/** 歌单结果列表（对照 RN Songlist/ListItem：标题 + 来源；原生不逐行取封面）。 */
@Composable
private fun SonglistResults(
    songlists: List<SonglistSearchItem>,
    loadingMore: Boolean,
    reachedEnd: Boolean,
    showSource: Boolean,
    onEndReached: () -> Unit,
    onOpen: (SonglistSearchItem) -> Unit,
) {
    val listState = rememberLazyListState()
    val shouldLoadMore by remember {
        derivedStateOf {
            val last = listState.layoutInfo.totalItemsCount
            val lastVisible =
                listState.layoutInfo.visibleItemsInfo
                    .lastOrNull()
                    ?.index ?: -1
            last > 0 && lastVisible >= last - 6
        }
    }
    LaunchedEffect(shouldLoadMore) {
        if (shouldLoadMore) onEndReached()
    }
    LazyColumn(state = listState, modifier = Modifier.fillMaxSize()) {
        itemsIndexed(
            songlists,
            key = { index, item -> "${item.source}__${item.id}__$index" },
        ) { _, item ->
            Row(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .clickable { onOpen(item) }
                        .padding(horizontal = 16.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    BasicText(
                        text = item.name,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        style =
                            TextStyle(
                                color = SaltTheme.colors.text,
                                fontSize = 15.sp,
                                fontWeight = FontWeight.Medium,
                            ),
                    )
                    val meta =
                        listOfNotNull(
                            item.author.takeIf { it.isNotBlank() },
                            item.playCount.takeIf { it.isNotBlank() },
                            if (item.total > 0) "${item.total}首" else null,
                        ).joinToString(" · ")
                    if (meta.isNotEmpty()) {
                        BasicText(
                            text = meta,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            style = TextStyle(color = SaltTheme.colors.subText, fontSize = 12.sp),
                        )
                    }
                }
                if (showSource) {
                    BasicText(
                        text = searchSourceLabel(item.source),
                        modifier = Modifier.padding(start = 8.dp),
                        style = TextStyle(color = SaltTheme.colors.subText, fontSize = 11.sp),
                    )
                }
            }
        }
        if (loadingMore) {
            item(key = "loading-more") {
                Text(
                    text = "加载中…",
                    modifier = Modifier.fillMaxWidth().padding(16.dp),
                    color = SaltTheme.colors.subText,
                )
            }
        } else if (reachedEnd && songlists.isNotEmpty()) {
            item(key = "end") {
                Text(
                    text = "到底啦~",
                    modifier = Modifier.fillMaxWidth().padding(16.dp),
                    color = SaltTheme.colors.subText,
                )
            }
        }
    }
}

/** 专辑结果列表（对照任务书：封面 + 名称 + 歌手 + 发行时间；原生不逐行拉封面图）。 */
@Composable
private fun AlbumResults(
    albums: List<AlbumItem>,
    loadingMore: Boolean,
    reachedEnd: Boolean,
    showSource: Boolean,
    onEndReached: () -> Unit,
    onOpen: (AlbumItem) -> Unit,
) {
    val listState = rememberLazyListState()
    val shouldLoadMore by remember {
        derivedStateOf {
            val last = listState.layoutInfo.totalItemsCount
            val lastVisible =
                listState.layoutInfo.visibleItemsInfo
                    .lastOrNull()
                    ?.index ?: -1
            last > 0 && lastVisible >= last - 6
        }
    }
    LaunchedEffect(shouldLoadMore) {
        if (shouldLoadMore) onEndReached()
    }
    LazyColumn(state = listState, modifier = Modifier.fillMaxSize()) {
        itemsIndexed(
            albums,
            key = { index, item -> "${item.source}__${item.id}__$index" },
        ) { _, item ->
            Row(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .clickable { onOpen(item) }
                        .padding(horizontal = 16.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    BasicText(
                        text = item.name,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        style =
                            TextStyle(
                                color = SaltTheme.colors.text,
                                fontSize = 15.sp,
                                fontWeight = FontWeight.Medium,
                            ),
                    )
                    val meta =
                        listOfNotNull(
                            item.singer.takeIf { it.isNotBlank() },
                            item.publishTime?.takeIf { it.isNotBlank() },
                            item.songCount.takeIf { it > 0 }?.let { "${it}首" },
                        ).joinToString(" · ")
                    if (meta.isNotEmpty()) {
                        BasicText(
                            text = meta,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            style = TextStyle(color = SaltTheme.colors.subText, fontSize = 12.sp),
                        )
                    }
                }
                if (showSource) {
                    BasicText(
                        text = searchSourceLabel(item.source),
                        modifier = Modifier.padding(start = 8.dp),
                        style = TextStyle(color = SaltTheme.colors.subText, fontSize = 11.sp),
                    )
                }
            }
        }
        if (loadingMore) {
            item(key = "loading-more") {
                Text(
                    text = "加载中…",
                    modifier = Modifier.fillMaxWidth().padding(16.dp),
                    color = SaltTheme.colors.subText,
                )
            }
        } else if (reachedEnd && albums.isNotEmpty()) {
            item(key = "end") {
                Text(
                    text = "到底啦~",
                    modifier = Modifier.fillMaxWidth().padding(16.dp),
                    color = SaltTheme.colors.subText,
                )
            }
        }
    }
}

/** 歌手结果列表（对照任务书：名称 + 别名/作品数；咪咕行不可点入详情）。 */
@Composable
private fun ArtistResults(
    artists: List<ArtistItem>,
    loadingMore: Boolean,
    reachedEnd: Boolean,
    showSource: Boolean,
    onEndReached: () -> Unit,
    onOpen: (ArtistItem) -> Unit,
) {
    val listState = rememberLazyListState()
    val shouldLoadMore by remember {
        derivedStateOf {
            val last = listState.layoutInfo.totalItemsCount
            val lastVisible =
                listState.layoutInfo.visibleItemsInfo
                    .lastOrNull()
                    ?.index ?: -1
            last > 0 && lastVisible >= last - 6
        }
    }
    LaunchedEffect(shouldLoadMore) {
        if (shouldLoadMore) onEndReached()
    }
    LazyColumn(state = listState, modifier = Modifier.fillMaxSize()) {
        itemsIndexed(
            artists,
            key = { index, item -> "${item.source}__${item.id}__$index" },
        ) { _, item ->
            val canOpen = ArtistSearchRuntime.canOpenDetail(item.source)
            Row(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .clickable(enabled = canOpen) { onOpen(item) }
                        .padding(horizontal = 16.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    BasicText(
                        text = item.name,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        style =
                            TextStyle(
                                color = SaltTheme.colors.text,
                                fontSize = 15.sp,
                                fontWeight = FontWeight.Medium,
                            ),
                    )
                    val meta =
                        listOfNotNull(
                            item.alias.takeIf { it.isNotBlank() },
                            item.albumCount.takeIf { it > 0 }?.let { "专辑 $it" },
                            item.musicCount.takeIf { it > 0 }?.let { "歌曲 $it" },
                        ).joinToString(" · ")
                    BasicText(
                        text = if (meta.isEmpty()) "点击查看热门歌曲与专辑" else meta,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        style = TextStyle(color = SaltTheme.colors.subText, fontSize = 12.sp),
                    )
                }
                if (showSource) {
                    BasicText(
                        text = searchSourceLabel(item.source),
                        modifier = Modifier.padding(start = 8.dp),
                        style = TextStyle(color = SaltTheme.colors.subText, fontSize = 11.sp),
                    )
                }
            }
        }
        if (loadingMore) {
            item(key = "loading-more") {
                Text(
                    text = "加载中…",
                    modifier = Modifier.fillMaxWidth().padding(16.dp),
                    color = SaltTheme.colors.subText,
                )
            }
        } else if (reachedEnd && artists.isNotEmpty()) {
            item(key = "end") {
                Text(
                    text = "到底啦~",
                    modifier = Modifier.fillMaxWidth().padding(16.dp),
                    color = SaltTheme.colors.subText,
                )
            }
        }
    }
}

/**
 * 源选择横滑条：五个单源 + 「全部」聚合（对照 RN HeaderBar 的 SourceSelector）。
 * 当前类型禁用的源置灰且不可点（对照 RN sources 只收有能力的源）。
 */
@Composable
private fun SourceTabs(
    source: String,
    enabled: Set<String>,
    onSelect: (String) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
    ) {
        SearchRuntime.SOURCES.forEach { (id, label) ->
            val selected = id == source
            val enabledSource = id in enabled
            Column(
                modifier =
                    Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(8.dp))
                        .background(if (selected) SaltTheme.colors.highlight.copy(alpha = 0.12f) else Color.Transparent)
                        .clickable(enabled = enabledSource) { onSelect(id) }
                        .padding(vertical = 8.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                BasicText(
                    text = label.removeSuffix("音乐").removeSuffix("搜索"),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    style =
                        TextStyle(
                            color =
                                when {
                                    selected -> SaltTheme.colors.highlight
                                    !enabledSource -> SaltTheme.colors.subText.copy(alpha = 0.35f)
                                    else -> SaltTheme.colors.subText
                                },
                            fontSize = 13.sp,
                            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                        ),
                )
            }
        }
    }
}

/** 类型切换：歌曲/歌单/专辑/歌手四档（对照 RN SearchTypeSelector）。 */
@Composable
private fun SearchTypeTabs(
    type: String,
    onSelect: (String) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 2.dp),
        horizontalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        SearchTypes.ALL.forEach { id ->
            val selected = id == type
            BasicText(
                text = SearchTypes.label(id),
                modifier =
                    Modifier
                        .clip(RoundedCornerShape(6.dp))
                        .clickable { onSelect(id) }
                        .padding(horizontal = 4.dp, vertical = 6.dp),
                style =
                    TextStyle(
                        color = if (selected) SaltTheme.colors.highlight else SaltTheme.colors.text,
                        fontSize = 14.sp,
                        fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                    ),
            )
        }
    }
}

internal fun searchSourceLabel(source: String): String =
    SearchRuntime.SOURCES
        .firstOrNull { it.first == source }
        ?.second
        ?.removeSuffix("音乐")
        ?.removeSuffix("搜索")
        .orEmpty()

internal fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content

private fun JsonObject.metaText(key: String): String? =
    ((this["meta"] as? JsonObject)?.get(key) as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content
