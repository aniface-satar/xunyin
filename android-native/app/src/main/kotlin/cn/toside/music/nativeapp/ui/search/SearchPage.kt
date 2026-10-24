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
import androidx.compose.runtime.collectAsState
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
import cn.toside.music.core.storage.StorageKeys
import cn.toside.music.nativeapp.data.ListRuntime
import cn.toside.music.nativeapp.data.SearchRuntime
import cn.toside.music.nativeapp.player.PlayerRuntime
import com.moriafly.salt.ui.Button
import com.moriafly.salt.ui.Item
import com.moriafly.salt.ui.ItemArrowType
import com.moriafly.salt.ui.SaltTheme
import com.moriafly.salt.ui.Text
import com.moriafly.salt.ui.UnstableSaltUiApi
import com.moriafly.salt.ui.dialog.BasicDialog
import com.moriafly.salt.ui.dialog.DialogTitle
import com.moriafly.salt.ui.screen.BasicScreen
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * 搜索页（B5 第二、三、八切片）—— 五源搜索 + 全部聚合 + 翻页加载更多。
 *
 * 对照 RN `screens/Home/Views/Search`：HeaderBar 的源下拉（含「全部」）+ OnlineList
 * 的 onEndReached 加载更多。点击播放 = 写入试听列表 → `playListById` → 进播放页
 * （RN `OnlineList.listAction.handlePlay` 语义）。
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
    var items by remember { mutableStateOf<List<JsonObject>>(emptyList()) }
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
        scope.launch {
            if (targetPage == 1) {
                loading = true
                items = emptyList()
            } else {
                loadingMore = true
            }
            error = null
            runCatching { SearchRuntime.search(text, targetPage, source) }
                .onSuccess { result ->
                    if (result == null) return@launch // 旧关键词的迟到响应，丢弃
                    items = result.list
                    page = targetPage
                    searched = true
                    activeKeyword = text
                    reachedEnd = SearchRuntime.reachedEnd(source, targetPage)
                }.onFailure {
                    if (targetPage == 1) items = emptyList()
                    error = it.message ?: "搜索失败"
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
                onSelect = { picked ->
                    if (picked == source) return@SourceTabs
                    source = picked
                    // RN handleSourceChange：立即用当前关键词重查（缓存命中则不发请求）
                    val text = keyword.trim()
                    searched = false
                    error = null
                    reachedEnd = false
                    if (text.isNotEmpty()) {
                        page = 1
                        runSearch(text, 1)
                    } else {
                        items = emptyList()
                    }
                },
            )
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
            addTarget?.let { target ->
                AddToListDialog(
                    target = target,
                    onDismiss = { addTarget = null },
                    onPick = { listId ->
                        addTarget = null
                        scope.launch {
                            val existed = lists.musics(listId).any { it.text("id") == target.text("id") }
                            if (!existed) {
                                lists.store.listMusicAdd(listId, listOf(target), addLocation())
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

@Composable
private fun AddToListDialog(
    target: JsonObject,
    onDismiss: () -> Unit,
    onPick: (String) -> Unit,
) {
    val context = LocalContext.current
    val lists = remember { ListRuntime.get(context) }
    val listState by lists.store.state.collectAsState()
    LaunchedEffect(Unit) { lists.ensureLoaded() }
    BasicDialog(onDismissRequest = onDismiss) {
        DialogTitle("把「${target.text("name").orEmpty()}」加入")
        Item(
            onClick = { onPick(StorageKeys.ListIds.DEFAULT) },
            text = "试听列表",
            arrowType = ItemArrowType.None,
        )
        Item(
            onClick = { onPick(StorageKeys.ListIds.LOVE) },
            text = "我的收藏",
            arrowType = ItemArrowType.None,
        )
        listState.userLists.forEach { info ->
            Item(
                onClick = { onPick(info.id) },
                text = info.name,
                arrowType = ItemArrowType.None,
            )
        }
    }
}

private fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content

private fun JsonObject.metaText(key: String): String? =
    ((this["meta"] as? JsonObject)?.get(key) as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content
