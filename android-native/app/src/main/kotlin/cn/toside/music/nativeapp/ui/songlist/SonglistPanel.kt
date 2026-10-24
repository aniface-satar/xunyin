package cn.toside.music.nativeapp.ui.songlist

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
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
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cn.toside.music.core.songlist.PlaylistItem
import cn.toside.music.core.songlist.SonglistTags
import cn.toside.music.nativeapp.data.SonglistRuntime
import com.moriafly.salt.ui.SaltTheme
import com.moriafly.salt.ui.UnstableSaltUiApi
import kotlinx.coroutines.launch

/**
 * 发现页「歌单」面板（Wave2 Lane A）—— 对照 RN `screens/Home/Views/SongList`：
 *
 * - 源选择（kw/kg/tx/wy/mg）+ 排序 tab + 分类标签横滑（热门在前，分组名作分隔）；
 * - 30 条/页的列表分页（`SonglistRuntime.reachedEnd` 对照 RN `maxPage`）；
 * - 点歌单进详情页（`HomeNavigator.Route.SonglistDetail`）。
 *
 * RN 的标签是侧滑抽屉 + 分组面板；竖屏窄宽下本波改为两行横滑条，
 * 分组名以不可点的小标签呈现（详见 lane 报告）。
 */
@OptIn(UnstableSaltUiApi::class)
@Composable
fun SonglistPanel(onOpenSonglist: (source: String, id: String, title: String) -> Unit) {
    var source by remember { mutableStateOf(SonglistRuntime.SOURCES.first().first) }
    var sortId by remember(source) {
        mutableStateOf(
            SonglistRuntime
                .sorts(source)
                .firstOrNull()
                ?.id
                .orEmpty(),
        )
    }
    var tagId by remember(source) { mutableStateOf<String?>(null) }
    var tags by remember(source) { mutableStateOf<SonglistTags?>(null) }
    var tagsError by remember(source) { mutableStateOf<String?>(null) }
    var items by remember { mutableStateOf<List<PlaylistItem>>(emptyList()) }
    var page by remember { mutableStateOf(1) }
    var reachedEnd by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var loadingMore by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var generation by remember { mutableStateOf(0) }
    var retryTick by remember { mutableStateOf(0) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(source) {
        tags = null
        tagsError = null
        runCatching { SonglistRuntime.getTags(source) }
            .onSuccess { tags = it }
            .onFailure { tagsError = it.message ?: "标签加载失败" }
    }

    LaunchedEffect(source, sortId, tagId, retryTick) {
        val gen = ++generation
        items = emptyList()
        page = 1
        reachedEnd = false
        loading = true
        loadingMore = false
        error = null
        runCatching { SonglistRuntime.getList(source, sortId, tagId, 1) }
            .onSuccess { result ->
                if (gen != generation) return@LaunchedEffect
                items = result.list
                reachedEnd = SonglistRuntime.reachedEnd(result, 1)
            }.onFailure {
                if (gen != generation) return@LaunchedEffect
                error = it.message ?: "加载失败"
            }
        loading = false
    }

    fun loadMore() {
        if (loading || loadingMore || reachedEnd) return
        val gen = generation
        val targetPage = page + 1
        scope.launch {
            loadingMore = true
            val result =
                runCatching { SonglistRuntime.getList(source, sortId, tagId, targetPage) }
                    .onFailure { if (gen == generation) error = it.message ?: "加载失败" }
                    .getOrNull()
            if (gen == generation && result != null) {
                items = items + result.list
                page = targetPage
                reachedEnd = SonglistRuntime.reachedEnd(result, targetPage)
                error = null
            }
            loadingMore = false
        }
    }

    Column(Modifier.fillMaxSize()) {
        SourceRow(source = source, onSelect = { source = it })
        SortRow(source = source, sortId = sortId, onSelect = { sortId = it })
        TagRow(
            hotTags = tags?.hotTags.orEmpty(),
            groups = tags?.tags.orEmpty(),
            selectedId = tagId,
            onSelect = { tagId = it },
        )
        if (tagsError != null && tags == null) {
            BasicText(
                text = "标签加载失败：${tagsError.orEmpty()}",
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                style = TextStyle(color = SaltTheme.colors.subText, fontSize = 12.sp),
            )
        }
        Box(Modifier.fillMaxSize()) {
            when {
                loading ->
                    CenterHint("加载中…")
                error != null ->
                    Column(
                        Modifier.fillMaxWidth().padding(24.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        BasicText(
                            text = error.orEmpty(),
                            style = TextStyle(color = SaltTheme.colors.subText, fontSize = 14.sp),
                        )
                        TextButton(text = "重试", onClick = { retryTick++ })
                    }
                items.isEmpty() ->
                    CenterHint("暂无歌单")
                else -> {
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
                        itemsIndexed(
                            items,
                            key = { index, item -> "${item.source}_${item.id}_$index" },
                        ) { _, item ->
                            PlaylistRow(item = item) {
                                onOpenSonglist(item.source, item.id, item.name)
                            }
                        }
                        if (loadingMore) {
                            item(key = "loading-more") { FooterHint("加载中…") }
                        } else if (reachedEnd) {
                            item(key = "end") { FooterHint("到底啦~") }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SourceRow(
    source: String,
    onSelect: (String) -> Unit,
) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 2.dp)) {
        SonglistRuntime.SOURCES.forEach { (id, label) ->
            Chip(
                text = label.removeSuffix("音乐"),
                selected = id == source,
                modifier = Modifier.weight(1f),
                onClick = { onSelect(id) },
            )
        }
    }
}

@Composable
private fun SortRow(
    source: String,
    sortId: String,
    onSelect: (String) -> Unit,
) {
    val sorts = remember(source) { SonglistRuntime.sorts(source) }
    LazyRow(
        Modifier.fillMaxWidth(),
        contentPadding =
            androidx.compose.foundation.layout
                .PaddingValues(horizontal = 12.dp),
    ) {
        items(sorts, key = { it.id }) { sort ->
            Chip(
                text = sort.name,
                selected = sort.id == sortId,
                modifier = Modifier.padding(horizontal = 4.dp),
                onClick = { onSelect(sort.id) },
            )
        }
    }
}

/** 标签横滑：全部 + 热门 + 各分组（分组名只作分隔，不可点）。 */
@Composable
private fun TagRow(
    hotTags: List<cn.toside.music.core.songlist.SonglistTag>,
    groups: List<cn.toside.music.core.songlist.SonglistTagGroup>,
    selectedId: String?,
    onSelect: (String?) -> Unit,
) {
    LazyRow(
        Modifier.fillMaxWidth(),
        contentPadding =
            androidx.compose.foundation.layout
                .PaddingValues(horizontal = 12.dp),
    ) {
        item(key = "all") {
            Chip(
                text = "全部",
                selected = selectedId == null,
                modifier = Modifier.padding(horizontal = 4.dp),
                onClick = { onSelect(null) },
            )
        }
        items(hotTags, key = { "hot_${it.id}" }) { tag ->
            Chip(
                text = tag.name,
                selected = tag.id == selectedId,
                modifier = Modifier.padding(horizontal = 4.dp),
                onClick = { onSelect(tag.id) },
            )
        }
        groups.forEach { group ->
            item(key = "group_${group.name}") {
                BasicText(
                    text = group.name,
                    modifier = Modifier.padding(horizontal = 8.dp),
                    style = TextStyle(color = SaltTheme.colors.subText, fontSize = 12.sp),
                )
            }
            items(group.list, key = { "${group.name}_${it.id}" }) { tag ->
                Chip(
                    text = tag.name,
                    selected = tag.id == selectedId,
                    modifier = Modifier.padding(horizontal = 4.dp),
                    onClick = { onSelect(tag.id) },
                )
            }
        }
    }
}

@Composable
private fun Chip(
    text: String,
    selected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Box(
        modifier =
            modifier
                .clip(RoundedCornerShape(8.dp))
                .background(if (selected) SaltTheme.colors.highlight.copy(alpha = 0.12f) else Color.Transparent)
                .clickable(onClick = onClick)
                .padding(horizontal = 10.dp, vertical = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        BasicText(
            text = text,
            maxLines = 1,
            style =
                TextStyle(
                    color = if (selected) SaltTheme.colors.highlight else SaltTheme.colors.subText,
                    fontSize = 13.sp,
                    fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                ),
        )
    }
}

@Composable
internal fun PlaylistRow(
    item: PlaylistItem,
    onClick: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clickable(onClick = onClick)
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
            BasicText(
                text = listOf(item.author, item.playCount).filter { it.isNotBlank() }.joinToString(" · "),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                style = TextStyle(color = SaltTheme.colors.subText, fontSize = 12.sp),
            )
        }
    }
}

@Composable
private fun CenterHint(text: String) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        BasicText(text = text, style = TextStyle(color = SaltTheme.colors.subText, fontSize = 14.sp))
    }
}

@Composable
private fun FooterHint(text: String) {
    BasicText(
        text = text,
        modifier = Modifier.fillMaxWidth().padding(16.dp),
        style = TextStyle(color = SaltTheme.colors.subText, fontSize = 13.sp),
    )
}

@Composable
private fun TextButton(
    text: String,
    onClick: () -> Unit,
) {
    Box(
        modifier =
            Modifier
                .padding(top = 12.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(SaltTheme.colors.highlight.copy(alpha = 0.12f))
                .clickable(onClick = onClick)
                .padding(horizontal = 16.dp, vertical = 8.dp),
    ) {
        BasicText(text = text, style = TextStyle(color = SaltTheme.colors.highlight, fontSize = 14.sp))
    }
}
