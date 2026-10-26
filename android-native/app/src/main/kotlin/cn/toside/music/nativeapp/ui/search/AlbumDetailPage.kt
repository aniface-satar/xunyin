package cn.toside.music.nativeapp.ui.search

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
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
import cn.toside.music.core.music.search.album.AlbumDetail
import cn.toside.music.core.music.search.album.AlbumItem
import cn.toside.music.core.storage.StorageKeys
import cn.toside.music.nativeapp.data.AlbumSearchRuntime
import cn.toside.music.nativeapp.data.ListRuntime
import cn.toside.music.nativeapp.player.PlayerRuntime
import com.moriafly.salt.ui.Button
import com.moriafly.salt.ui.SaltTheme
import com.moriafly.salt.ui.Text
import com.moriafly.salt.ui.UnstableSaltUiApi
import com.moriafly.salt.ui.screen.BasicScreen
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject

/**
 * 专辑详情页（W6 laneB）—— 头部信息 + 曲目列表 + 「播放全部」。
 *
 * 起播复用歌单详情的临时列表链路：当前曲目写入 TEMP → `playListById(TEMP)`
 * （对照 `SonglistDetailPage.play`，任务书「加入试听列表并起播」）。
 * 挂载方式：SearchPage 页内覆盖（SEARCH tab 既有模式；HomeNavigator 的 sealed Route
 * 由 HomePage 穷尽渲染，禁触壳结构，路由缺口记 lane 报告）。
 */
@OptIn(UnstableSaltUiApi::class)
@Composable
fun AlbumDetailPage(
    source: String,
    id: String,
    fallback: AlbumItem?,
    onBack: () -> Unit,
    onOpenPlayer: () -> Unit,
) {
    val context = LocalContext.current
    val runtime = remember { PlayerRuntime.get(context) }
    val lists = remember { ListRuntime.get(context) }
    val scope = rememberCoroutineScope()
    var detail by remember { mutableStateOf<AlbumDetail?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }

    LaunchedEffect(source, id) {
        loading = true
        error = null
        runCatching { AlbumSearchRuntime.detail(source, id) }
            .onSuccess {
                detail = it
                loading = false
            }.onFailure {
                error = it.message ?: "专辑详情加载失败"
                loading = false
            }
    }

    // 起播：写临时列表 → TEMP 起播（对照 SonglistDetailPage.play）
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
        }
    }

    val info = detail?.info
    BasicScreen(onBack = onBack, title = info?.name ?: fallback?.name ?: "专辑") { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            when {
                loading ->
                    Text(
                        text = "加载中…",
                        modifier = Modifier.fillMaxWidth().padding(24.dp),
                        color = SaltTheme.colors.subText,
                    )
                error != null ->
                    Column(
                        Modifier
                            .fillMaxWidth()
                            .padding(24.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        BasicText(
                            text = error.orEmpty(),
                            style = TextStyle(color = SaltTheme.colors.subText, fontSize = 14.sp),
                        )
                        Button(onClick = onBack, text = "返回")
                    }
                else -> {
                    val songs = detail?.songs.orEmpty()
                    val header =
                        listOfNotNull(
                            (info ?: fallback)?.singer?.takeIf { it.isNotBlank() },
                            (info ?: fallback)?.publishTime?.takeIf { it.isNotBlank() },
                            (detail?.total ?: 0).takeIf { it > 0 }?.let { "$it 首" },
                        ).joinToString(" · ")
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            BasicText(
                                text = info?.name ?: fallback?.name.orEmpty(),
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                                style =
                                    TextStyle(
                                        color = SaltTheme.colors.text,
                                        fontSize = 17.sp,
                                        fontWeight = FontWeight.SemiBold,
                                    ),
                            )
                            if (header.isNotEmpty()) {
                                BasicText(
                                    text = header,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    style = TextStyle(color = SaltTheme.colors.subText, fontSize = 12.sp),
                                )
                            }
                        }
                        Button(
                            onClick = { play(songs, 0) },
                            text = "播放全部",
                            enabled = songs.isNotEmpty(),
                        )
                    }
                    val listState = rememberLazyListState()
                    LazyColumn(state = listState, modifier = Modifier.fillMaxSize()) {
                        itemsIndexed(songs, key = { index, song -> "${song.text("id").orEmpty()}__$index" }) { index, song ->
                            Row(
                                modifier =
                                    Modifier
                                        .fillMaxWidth()
                                        .clickable { play(songs, index) }
                                        .padding(horizontal = 16.dp, vertical = 10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(Modifier.weight(1f)) {
                                    BasicText(
                                        text = song.text("name").orEmpty(),
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
                                        text = song.text("singer").orEmpty(),
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                        style = TextStyle(color = SaltTheme.colors.subText, fontSize = 12.sp),
                                    )
                                }
                                BasicText(
                                    text = searchSourceLabel(song.text("source").orEmpty()),
                                    modifier = Modifier.padding(start = 8.dp),
                                    style = TextStyle(color = SaltTheme.colors.subText, fontSize = 11.sp),
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
