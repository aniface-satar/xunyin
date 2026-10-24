package cn.toside.music.nativeapp.ui.songlist

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cn.toside.music.core.songlist.SonglistInfo
import cn.toside.music.core.storage.StorageKeys
import cn.toside.music.nativeapp.data.ListRuntime
import cn.toside.music.nativeapp.data.SonglistRuntime
import cn.toside.music.nativeapp.player.PlayerRuntime
import com.moriafly.salt.ui.Button
import com.moriafly.salt.ui.SaltTheme
import com.moriafly.salt.ui.UnstableSaltUiApi
import com.moriafly.salt.ui.screen.BasicScreen
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * 在线歌单详情页（Wave2 Lane A）—— 对照 RN `screens/SonglistDetail`：
 *
 * - 头部信息（名称/作者/播放量/简介）来自详情首包 `info`；
 * - 30 条/展示页本地分页（`SonglistDetailPager`），接近尾部自动加载；
 * - 起播复用排行榜的临时列表链路：当前页写入 TEMP → `playListById(TEMP)`
 *   → 后台拉全整单补全队列（RN `handlePlay` 的快起播分支）。
 *
 * RN 的「添加到我的歌单」「多选」不在本波范围（见 lane 报告遗留）。
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
                            InfoHeader(info = info, fallbackTitle = title, onPlayAll = { play(items, 0) })
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
                                Row(
                                    modifier =
                                        Modifier
                                            .fillMaxWidth()
                                            .clickable { play(items, index) }
                                            .padding(start = 16.dp, end = 16.dp, top = 10.dp, bottom = 10.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
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
                                    Column(Modifier.weight(1f)) {
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
}

@Composable
private fun InfoHeader(
    info: SonglistInfo?,
    fallbackTitle: String,
    onPlayAll: () -> Unit,
) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
        BasicText(
            text = info?.name ?: fallbackTitle,
            style =
                TextStyle(
                    color = SaltTheme.colors.text,
                    fontSize = 20.sp,
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
        Row(
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            horizontalArrangement = Arrangement.End,
        ) {
            Button(onClick = onPlayAll, text = "播放全部")
        }
    }
}

private fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content
