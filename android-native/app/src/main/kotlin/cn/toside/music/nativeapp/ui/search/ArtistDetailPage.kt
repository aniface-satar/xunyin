package cn.toside.music.nativeapp.ui.search

import androidx.compose.foundation.clickable
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
import cn.toside.music.core.music.search.album.AlbumItem
import cn.toside.music.core.music.search.artist.ArtistDetail
import cn.toside.music.core.music.search.artist.ArtistItem
import cn.toside.music.core.storage.StorageKeys
import cn.toside.music.nativeapp.data.ArtistSearchRuntime
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
 * 歌手详情页（W6 laneB）—— 信息头部 + 「热门歌曲 / 专辑」两个分区。
 *
 * 数据来自 [ArtistSearchRuntime.detail]（kw/kg/wy 三源；咪咕歌手只有搜索，
 * 搜索行不可点入，任务书「宁可少做」）。专辑行点击 = 页内再叠一层专辑详情
 * （返回回到歌手页）。挂载方式与 [AlbumDetailPage] 相同：SearchPage 页内覆盖。
 */
@OptIn(UnstableSaltUiApi::class)
@Composable
fun ArtistDetailPage(
    source: String,
    artist: ArtistItem,
    onBack: () -> Unit,
    onOpenPlayer: () -> Unit,
) {
    val context = LocalContext.current
    val runtime = remember { PlayerRuntime.get(context) }
    val lists = remember { ListRuntime.get(context) }
    val scope = rememberCoroutineScope()
    var detail by remember { mutableStateOf<ArtistDetail?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }
    var albumTarget by remember { mutableStateOf<AlbumItem?>(null) }

    LaunchedEffect(source, artist.id) {
        loading = true
        error = null
        runCatching { ArtistSearchRuntime.detail(source, artist) }
            .onSuccess {
                detail = it
                loading = false
            }.onFailure {
                error = it.message ?: "歌手详情加载失败"
                loading = false
            }
    }

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

    // 专辑行 → 页内再叠一层专辑详情
    albumTarget?.let { album ->
        AlbumDetailPage(
            source = album.source,
            id = album.id,
            fallback = album,
            onBack = { albumTarget = null },
            onOpenPlayer = onOpenPlayer,
        )
        return
    }

    val info = detail?.info ?: artist
    BasicScreen(onBack = onBack, title = info.name) { padding ->
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
                    ) {
                        BasicText(
                            text = error.orEmpty(),
                            style = TextStyle(color = SaltTheme.colors.subText, fontSize = 14.sp),
                        )
                        Button(onClick = onBack, text = "返回")
                    }
                else -> {
                    val headerMeta =
                        listOfNotNull(
                            info.alias.takeIf { it.isNotBlank() },
                            info.albumCount.takeIf { it > 0 }?.let { "专辑 $it" },
                            info.musicCount.takeIf { it > 0 }?.let { "歌曲 $it" },
                        ).joinToString(" · ")
                    val songs = detail?.songs.orEmpty()
                    val albums = detail?.albums.orEmpty()
                    val listState = rememberLazyListState()
                    LazyColumn(state = listState, modifier = Modifier.fillMaxSize()) {
                        item(key = "header") {
                            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
                                BasicText(
                                    text = info.name,
                                    style =
                                        TextStyle(
                                            color = SaltTheme.colors.text,
                                            fontSize = 17.sp,
                                            fontWeight = FontWeight.SemiBold,
                                        ),
                                )
                                if (headerMeta.isNotEmpty()) {
                                    BasicText(
                                        text = headerMeta,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                        style = TextStyle(color = SaltTheme.colors.subText, fontSize = 12.sp),
                                    )
                                }
                            }
                        }
                        item(key = "songs-title") {
                            SectionTitle("热门歌曲")
                        }
                        if (songs.isEmpty()) {
                            item(key = "songs-empty") {
                                BasicText(
                                    text = "暂无热门歌曲",
                                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
                                    style = TextStyle(color = SaltTheme.colors.subText, fontSize = 13.sp),
                                )
                            }
                        }
                        itemsIndexed(songs, key = { index, song -> "song__${song.text("id").orEmpty()}__$index" }) { index, song ->
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
                            }
                        }
                        item(key = "albums-title") {
                            SectionTitle("专辑")
                        }
                        if (albums.isEmpty()) {
                            item(key = "albums-empty") {
                                BasicText(
                                    text = "暂无专辑",
                                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
                                    style = TextStyle(color = SaltTheme.colors.subText, fontSize = 13.sp),
                                )
                            }
                        }
                        itemsIndexed(albums, key = { index, album -> "album__${album.source}__${album.id}__$index" }) { _, album ->
                            Row(
                                modifier =
                                    Modifier
                                        .fillMaxWidth()
                                        .clickable { albumTarget = album }
                                        .padding(horizontal = 16.dp, vertical = 10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(Modifier.weight(1f)) {
                                    BasicText(
                                        text = album.name,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                        style =
                                            TextStyle(
                                                color = SaltTheme.colors.text,
                                                fontSize = 15.sp,
                                                fontWeight = FontWeight.Medium,
                                            ),
                                    )
                                    val albumMeta =
                                        listOfNotNull(
                                            album.singer.takeIf { it.isNotBlank() },
                                            album.publishTime?.takeIf { it.isNotBlank() },
                                        ).joinToString(" · ")
                                    if (albumMeta.isNotEmpty()) {
                                        BasicText(
                                            text = albumMeta,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis,
                                            style = TextStyle(color = SaltTheme.colors.subText, fontSize = 12.sp),
                                        )
                                    }
                                }
                                BasicText(
                                    text = searchSourceLabel(album.source),
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

@Composable
private fun SectionTitle(title: String) {
    BasicText(
        text = title,
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 6.dp),
        style =
            TextStyle(
                color = SaltTheme.colors.text,
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
            ),
    )
}
