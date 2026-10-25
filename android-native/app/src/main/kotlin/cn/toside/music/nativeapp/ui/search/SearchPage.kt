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
import cn.toside.music.core.storage.StorageKeys
import cn.toside.music.nativeapp.data.ListRuntime
import cn.toside.music.nativeapp.data.SearchRuntime
import cn.toside.music.nativeapp.data.SonglistSearchRuntime
import cn.toside.music.nativeapp.player.PlayerRuntime
import cn.toside.music.nativeapp.ui.songlist.AddToListDialog
import cn.toside.music.nativeapp.ui.songlist.SonglistDetailPage
import com.moriafly.salt.ui.Button
import com.moriafly.salt.ui.SaltTheme
import com.moriafly.salt.ui.Text
import com.moriafly.salt.ui.UnstableSaltUiApi
import com.moriafly.salt.ui.screen.BasicScreen
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** 搜索类型（对照 RN 提交版 `SearchTypeSelector`：只有歌曲/歌单两档）。 */
private const val SEARCH_TYPE_MUSIC = "music"
private const val SEARCH_TYPE_SONGLIST = "songlist"

/**
 * 搜索页（B5 第八切片 + S12 歌单类型）—— 五源单曲/歌单搜索 + 「全部」聚合 + 翻页。
 *
 * 对照 RN `screens/Home/Views/Search`：HeaderBar 的源下拉（含「全部」）+
 * SearchTypeSelector 的歌曲/歌单切换 + OnlineList 的 onEndReached 加载更多。
 * 点击歌曲 = 写入试听列表 → `playListById` → 进播放页；点击歌单 = 在页内
 * 打开在线歌单详情（HomeNavigator 本波禁触，路由缺口记在车道报告）。
 */
@OptIn(UnstableSaltUiApi::class)
@Composable
fun SearchPage(
    onBack: (() -> Unit)? = null,
    onOpenPlayer: () -> Unit,
) {
    val context = LocalContext.current
    val runtime = remember { PlayerRuntime.get(context) }
    val scope = rememberCoroutineScope()
    var keyword by remember { mutableStateOf("") }
    var source by remember { mutableStateOf("kw") }
    var searchType by remember { mutableStateOf(SEARCH_TYPE_MUSIC) }
    var items by remember { mutableStateOf<List<JsonObject>>(emptyList()) }
    var songlists by remember { mutableStateOf<List<SonglistSearchItem>>(emptyList()) }
    var detailTarget by remember { mutableStateOf<SonglistSearchItem?>(null) }
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
            } else {
                loadingMore = true
            }
            error = null
            if (type == SEARCH_TYPE_MUSIC) {
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
            } else {
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
        searched = false
        error = null
        reachedEnd = false
        page = 1
        // RN searchTypeChanged：用上一次提交的关键词立即重查（缓存命中则不发请求）
        if (activeKeyword.isNotEmpty()) runSearch(activeKeyword, 1)
    }

    fun switchSource(picked: String) {
        if (picked == source) return
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

    // 在线歌单详情：页内覆盖（HomeNavigator 禁触，详见车道报告路由缺口）
    val target = detailTarget
    if (target != null) {
        SonglistDetailPage(
            source = target.source,
            id = target.id,
            title = target.name,
            onBack = { detailTarget = null },
            onOpenPlayer = onOpenPlayer,
        )
        return
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
            SourceTabs(source = source, onSelect = { switchSource(it) })
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
                searchType == SEARCH_TYPE_SONGLIST -> {
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
                            onOpen = { detailTarget = it },
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
                        text = sourceLabel(item.source),
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

/** 源选择横滑条：五个单源 + 「全部」聚合（对照 RN HeaderBar 的 SourceSelector）。 */
@Composable
private fun SourceTabs(
    source: String,
    onSelect: (String) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
    ) {
        SearchRuntime.SOURCES.forEach { (id, label) ->
            val selected = id == source
            Column(
                modifier =
                    Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(8.dp))
                        .background(if (selected) SaltTheme.colors.highlight.copy(alpha = 0.12f) else Color.Transparent)
                        .clickable { onSelect(id) }
                        .padding(vertical = 8.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                BasicText(
                    text = label.removeSuffix("音乐").removeSuffix("搜索"),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    style =
                        TextStyle(
                            color = if (selected) SaltTheme.colors.highlight else SaltTheme.colors.subText,
                            fontSize = 13.sp,
                            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                        ),
                )
            }
        }
    }
}

/** 歌曲/歌单类型切换（对照 RN SearchTypeSelector：两档 + 选中下划线）。 */
@Composable
private fun SearchTypeTabs(
    type: String,
    onSelect: (String) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 2.dp),
        horizontalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        listOf(SEARCH_TYPE_MUSIC to "歌曲", SEARCH_TYPE_SONGLIST to "歌单").forEach { (id, label) ->
            val selected = id == type
            BasicText(
                text = label,
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

private fun sourceLabel(source: String): String =
    SearchRuntime.SOURCES
        .firstOrNull { it.first == source }
        ?.second
        ?.removeSuffix("音乐")
        ?.removeSuffix("搜索")
        .orEmpty()

private fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content

private fun JsonObject.metaText(key: String): String? =
    ((this["meta"] as? JsonObject)?.get(key) as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content
