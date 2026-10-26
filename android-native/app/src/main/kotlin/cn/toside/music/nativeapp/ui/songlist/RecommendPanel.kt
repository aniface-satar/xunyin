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
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cn.toside.music.core.storage.StorageKeys
import cn.toside.music.nativeapp.data.CuratedNewSongs
import cn.toside.music.nativeapp.data.CuratedPlaylists
import cn.toside.music.nativeapp.data.ListRuntime
import cn.toside.music.nativeapp.data.RecommendRuntime
import cn.toside.music.nativeapp.player.PlayerRuntime
import com.moriafly.salt.ui.SaltTheme
import com.moriafly.salt.ui.UnstableSaltUiApi
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * 发现页「推荐」面板（Wave2 Lane A 建立，Wave4 Lane A 接电台入口）。
 *
 * - 个性电台：顶部卡片进入 [cn.toside.music.nativeapp.ui.radio.RadioPage]（S13 M2）；
 * - 推荐歌单：轮换源/分类取一页封面歌单，点卡片进歌单详情；
 * - 新歌速递：新歌榜（无则飙升榜）前几首，点歌起播（临时列表链路）。
 *
 * 「更多」分页与 onboarding 问卷仍属可选项，本波未做（见 lane 报告遗留）。
 * 两块取不到内容时显示空态而不是假数据。
 */
@OptIn(UnstableSaltUiApi::class)
@Composable
fun RecommendPanel(
    onOpenSonglist: (source: String, id: String, title: String) -> Unit,
    onOpenRadio: () -> Unit,
    onOpenPlayer: () -> Unit,
) {
    val context = LocalContext.current
    val runtime = remember { PlayerRuntime.get(context) }
    val lists = remember { ListRuntime.get(context) }
    val scope = rememberCoroutineScope()

    var playlists by remember { mutableStateOf<CuratedPlaylists?>(null) }
    var playlistsLoading by remember { mutableStateOf(false) }
    var playlistsError by remember { mutableStateOf<String?>(null) }
    var playlistsTick by remember { mutableStateOf(0) }
    var playlistsLoaded by remember { mutableStateOf(false) }

    var newSongs by remember { mutableStateOf<CuratedNewSongs?>(null) }
    var newSongsLoading by remember { mutableStateOf(false) }
    var newSongsError by remember { mutableStateOf<String?>(null) }
    var newSongsTick by remember { mutableStateOf(0) }
    var newSongsLoaded by remember { mutableStateOf(false) }

    LaunchedEffect(playlistsTick) {
        playlistsLoading = true
        playlistsError = null
        runCatching { RecommendRuntime.getCuratedPlaylists(isRefresh = playlistsTick > 0) }
            .onSuccess {
                playlists = it
                if (it == null) playlistsError = "暂时取不到推荐歌单"
            }.onFailure { playlistsError = it.message ?: "推荐歌单加载失败" }
        playlistsLoading = false
        playlistsLoaded = true
    }

    LaunchedEffect(newSongsTick) {
        newSongsLoading = true
        newSongsError = null
        runCatching { RecommendRuntime.getCuratedNewSongs() }
            .onSuccess {
                newSongs = it
                if (it == null) newSongsError = "暂时取不到新歌"
            }.onFailure { newSongsError = it.message ?: "新歌加载失败" }
        newSongsLoading = false
        newSongsLoaded = true
    }

    fun play(
        tracks: List<JsonObject>,
        index: Int,
    ) {
        if (index !in tracks.indices) return
        scope.launch {
            lists.store.listMusicOverwrite(StorageKeys.ListIds.TEMP, tracks)
            val musicId = tracks[index].text("id") ?: return@launch
            runtime.core.playListById(StorageKeys.ListIds.TEMP, musicId)
            runtime.core.handleListMusicsUpdated(listOf(StorageKeys.ListIds.TEMP))
            onOpenPlayer()
        }
    }

    LazyColumn(Modifier.fillMaxSize()) {
        item(key = "radio-entry") {
            RadioEntryCard(onClick = onOpenRadio)
        }
        item(key = "playlists-header") {
            SectionHeader(
                title = "推荐歌单",
                loading = playlistsLoading,
                onRefresh = { playlistsTick++ },
            )
        }
        val playlistItems = playlists?.list.orEmpty()
        if (playlistsLoading && !playlistsLoaded) {
            item(key = "playlists-loading") { SectionHint("加载中…") }
        } else if (playlistItems.isEmpty()) {
            item(key = "playlists-empty") {
                SectionHint(playlistsError ?: "暂无推荐歌单")
            }
        } else {
            items(playlistItems.size, key = { index -> "pl_${playlistItems[index].source}_${playlistItems[index].id}_$index" }) { index ->
                val item = playlistItems[index]
                PlaylistRow(item = item) { onOpenSonglist(item.source, item.id, item.name) }
            }
        }

        item(key = "new-songs-header") {
            SectionHeader(
                title = "新歌速递",
                loading = newSongsLoading,
                onRefresh = { newSongsTick++ },
                trailing =
                    if (newSongs?.tracks?.isNotEmpty() == true) {
                        { play(newSongs?.tracks.orEmpty(), 0) }
                    } else {
                        null
                    },
                trailingText = "播放全部",
            )
        }
        val tracks = newSongs?.tracks.orEmpty()
        if (newSongsLoading && !newSongsLoaded) {
            item(key = "new-songs-loading") { SectionHint("加载中…") }
        } else if (tracks.isEmpty()) {
            item(key = "new-songs-empty") { SectionHint(newSongsError ?: "暂无新歌") }
        } else {
            items(tracks.size, key = { index -> "ns_${tracks[index].text("id").orEmpty()}_$index" }) { index ->
                TrackRow(
                    index = index,
                    track = tracks[index],
                    onClick = { play(tracks, index) },
                )
            }
        }
    }
}

/** 发现页「推荐」顶部的电台入口卡（S13 M2 主线入口）。 */
@OptIn(UnstableSaltUiApi::class)
@Composable
private fun RadioEntryCard(onClick: () -> Unit) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(start = 16.dp, end = 16.dp, top = 12.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(SaltTheme.colors.highlight.copy(alpha = 0.12f))
                .clickable(onClick = onClick)
                .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            BasicText(
                text = "个性电台",
                style =
                    TextStyle(
                        color = SaltTheme.colors.text,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.SemiBold,
                    ),
            )
            BasicText(
                text = "按你的口味连着放；不喜欢就说一声，立刻换掉并记住",
                modifier = Modifier.padding(top = 4.dp),
                style = TextStyle(color = SaltTheme.colors.subText, fontSize = 12.sp),
            )
        }
        BasicText(
            text = "进入 ›",
            style = TextStyle(color = SaltTheme.colors.highlight, fontSize = 13.sp, fontWeight = FontWeight.Medium),
        )
    }
}

@Composable
private fun SectionHeader(
    title: String,
    loading: Boolean,
    onRefresh: () -> Unit,
    trailing: (() -> Unit)? = null,
    trailingText: String = "",
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        BasicText(
            text = title,
            modifier = Modifier.weight(1f),
            style =
                TextStyle(
                    color = SaltTheme.colors.text,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                ),
        )
        if (trailing != null) {
            ActionText(text = trailingText, onClick = trailing)
        }
        ActionText(
            text = if (loading) "刷新中…" else "换一批",
            onClick = { if (!loading) onRefresh() },
            modifier = Modifier.padding(start = 12.dp),
        )
    }
}

@Composable
private fun ActionText(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier =
            modifier
                .clip(RoundedCornerShape(8.dp))
                .clickable(onClick = onClick)
                .padding(horizontal = 8.dp, vertical = 6.dp),
    ) {
        BasicText(text = text, style = TextStyle(color = SaltTheme.colors.highlight, fontSize = 13.sp))
    }
}

@Composable
private fun SectionHint(text: String) {
    BasicText(
        text = text,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        style = TextStyle(color = SaltTheme.colors.subText, fontSize = 13.sp),
    )
}

@Composable
private fun TrackRow(
    index: Int,
    track: JsonObject,
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
        BasicText(
            text = "${index + 1}",
            modifier = Modifier.padding(end = 12.dp),
            style = TextStyle(color = SaltTheme.colors.highlight, fontSize = 14.sp, fontWeight = FontWeight.Bold),
        )
        Column(Modifier.weight(1f)) {
            BasicText(
                text = track.text("name").orEmpty(),
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
                text = track.text("singer").orEmpty(),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                style = TextStyle(color = SaltTheme.colors.subText, fontSize = 12.sp),
            )
        }
    }
}

private fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content
