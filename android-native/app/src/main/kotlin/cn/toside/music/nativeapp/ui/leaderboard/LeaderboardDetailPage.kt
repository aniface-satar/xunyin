package cn.toside.music.nativeapp.ui.leaderboard

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
import cn.toside.music.core.storage.StorageKeys
import cn.toside.music.nativeapp.data.LeaderboardRuntime
import cn.toside.music.nativeapp.data.ListRuntime
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
 * 排行榜详情页（B5 第九切片）—— 对照 RN `LeaderboardDetail` + `MusicList`：
 *
 * - 30 条/展示页的本地分页（`BoardPager`），接近尾部自动加载下一页；
 * - 点击歌曲：榜单页写入临时列表（`listMusicOverwrite`）→ `playListById(TEMP)`
 *   → 进播放页（RN `handlePlay` 的「先快速起播」分支）；
 *   整榜拉全后在后台补全临时列表（RN `getListDetailAll` 分支，保持队列完整）；
 * - 「播放全部」：拉整榜后从第 1 首起播（RN handlePlay 无列表时走 getListDetailAll）。
 */
@OptIn(UnstableSaltUiApi::class)
@Composable
fun LeaderboardDetailPage(
    boardId: String,
    title: String,
    onBack: () -> Unit,
    onOpenPlayer: () -> Unit,
) {
    val context = LocalContext.current
    val runtime = remember { PlayerRuntime.get(context) }
    val lists = remember { ListRuntime.get(context) }
    val scope = rememberCoroutineScope()
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
            runCatching { LeaderboardRuntime.getListDetail(boardId, targetPage, isRefresh) }
                .onSuccess { result ->
                    items = result.list
                    page = targetPage
                    reachedEnd = LeaderboardRuntime.reachedEnd(boardId, targetPage)
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

    LaunchedEffect(boardId) { load(1) }

    // 播放：写临时列表 → TEMP 起播；后台拉全整榜补全队列（对照 RN handlePlay）
    fun play(
        list: List<JsonObject>,
        index: Int,
    ) {
        if (list.isEmpty()) return
        scope.launch {
            lists.store.listMusicOverwrite(StorageKeys.ListIds.TEMP, list)
            val id = list[index].text("id") ?: return@launch
            runtime.core.playListById(StorageKeys.ListIds.TEMP, id)
            runtime.core.handleListMusicsUpdated(listOf(StorageKeys.ListIds.TEMP))
            onOpenPlayer()
            // 起播后拉整榜补全（RN：起播后 getListDetailAll 覆盖同一临时列表）
            runCatching { LeaderboardRuntime.getListDetailAll(boardId) }
                .onSuccess { full ->
                    if (full.size > list.size) {
                        lists.store.listMusicOverwrite(StorageKeys.ListIds.TEMP, full)
                        runtime.core.handleListMusicsUpdated(listOf(StorageKeys.ListIds.TEMP))
                    }
                }
        }
    }

    BasicScreen(onBack = onBack, title = title) { padding ->
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
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                        horizontalArrangement = Arrangement.End,
                    ) {
                        Button(onClick = { play(items, 0) }, text = "播放全部")
                    }
                    if (items.isEmpty()) {
                        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            BasicText(
                                text = "暂无歌曲",
                                style = TextStyle(color = SaltTheme.colors.subText, fontSize = 14.sp),
                            )
                        }
                    } else {
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
                            if (shouldLoadMore) loadMore()
                        }
                        LazyColumn(state = listState, modifier = Modifier.fillMaxSize()) {
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
                            } else if (reachedEnd && items.isNotEmpty()) {
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

private fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content
