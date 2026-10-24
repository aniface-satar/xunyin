package cn.toside.music.nativeapp.ui.play

import android.os.Build
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.changedToUp
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cn.toside.music.core.player.PlayerState
import cn.toside.music.core.player.TogglePlayMethod
import cn.toside.music.nativeapp.player.LyricsState
import cn.toside.music.nativeapp.player.PlayerRuntime
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.util.Locale

/**
 * B4 全屏播控页（竖屏）。
 *
 * 结构对照 RN `PlayDetail/Vertical`：封面台 / 歌词台左右翻页，底部固定播控；
 * 背景取封面模糊 + 压暗。头部「⋮」是 S11 收进来的播放设置面板（定时关闭 / 音量 / 倍速 /
 * 歌词字号 / 译文·音译），分享卡与桌面歌词留到后续批次（对照 B6 / Wave 2）。
 */
@Composable
fun PlayDetailPage(onBack: () -> Unit) {
    val context = LocalContext.current
    val runtime = remember { PlayerRuntime.get(context) }
    val state by runtime.core.state.collectAsState()
    val lyrics by runtime.lyrics.collectAsState()
    val scope = rememberCoroutineScope()

    val music = state.playMusicInfo.musicInfo
    val picUrl = music?.metaText("picUrl")
    var cover by remember(picUrl) { mutableStateOf<CoverArt?>(null) }
    LaunchedEffect(picUrl) {
        cover = CoverImageLoader.load(picUrl)
    }

    var positionMs by remember { mutableLongStateOf(0L) }
    LaunchedEffect(state.playMusicInfo.musicInfo?.musicKey()) {
        while (true) {
            positionMs = runtime.positionMs()
            if (runtime.core.state.value.isPlay) {
                androidx.compose.runtime.withFrameNanos { }
            } else {
                delay(250)
            }
        }
    }

    // 字号/译文/音译都以设置为唯一来源（RN：useSettingValue + Lyric.tsx:101-103 除以 10）
    LaunchedEffect(Unit) { runtime.settings.ensureLoaded() }
    val settings by runtime.settings.state.collectAsState()
    val timeout = remember { TimeoutExitRuntime.get(context) }
    val fontSizeTenths = lrcFontSizeTenths(settings)
    val translationShown = settings["player.isShowLyricTranslation"] as? Boolean ?: true
    val romaShown = settings["player.isShowLyricRoma"] as? Boolean ?: false
    var showPlaylist by remember { mutableStateOf(false) }
    var showMore by remember { mutableStateOf(false) }

    // RN SettingLrcFontSize.tsx:31-33：与已存值相同则不写设置
    val commitFontSize: (Int) -> Unit = { tenths ->
        if (tenths != fontSizeTenths) {
            scope.launch {
                runtime.settings.ensureLoaded()
                runtime.settings.store.set(KEY_LRC_FONT_SIZE, tenths)
            }
        }
    }
    val toggleTranslation = { runtime.setLyricTranslation(!translationShown) }
    val toggleRoma = { runtime.setLyricRoma(!romaShown) }

    Box(Modifier.fillMaxSize()) {
        PlayerBackdrop(cover)
        Column(Modifier.fillMaxSize()) {
            PlayerHeader(title = "正在播放", onBack = onBack, onOpenMore = { showMore = true })
            PagerAndControls(
                modifier = Modifier.weight(1f),
                runtime = runtime,
                state = state,
                lyrics = lyrics,
                cover = cover,
                positionMs = positionMs,
                fontSizeTenths = fontSizeTenths,
                onFontSizeCommit = commitFontSize,
                translationShown = translationShown,
                onToggleTranslation = toggleTranslation,
                onOpenPlaylist = { showPlaylist = true },
                scope = scope,
                music = music,
            )
        }
        if (showPlaylist) {
            PlaylistSheet(
                runtime = runtime,
                currentId = music?.text("id"),
                listId = state.playerListId,
                onDismiss = { showPlaylist = false },
            )
        }
        if (showMore) {
            MoreActionSheet(
                runtime = runtime,
                timeout = timeout,
                fontSizeTenths = fontSizeTenths,
                onFontSizeCommit = commitFontSize,
                translationShown = translationShown,
                romaShown = romaShown,
                onToggleTranslation = toggleTranslation,
                onToggleRoma = toggleRoma,
                onDismiss = { showMore = false },
            )
        }
    }
}

@Composable
private fun PagerAndControls(
    modifier: Modifier,
    runtime: PlayerRuntime,
    state: PlayerState,
    lyrics: LyricsState,
    cover: CoverArt?,
    positionMs: Long,
    fontSizeTenths: Int,
    onFontSizeCommit: (Int) -> Unit,
    translationShown: Boolean,
    onToggleTranslation: () -> Unit,
    onOpenPlaylist: () -> Unit,
    scope: kotlinx.coroutines.CoroutineScope,
    music: JsonObject?,
) {
    val pagerState = rememberPagerState(pageCount = { 2 })
    Column(modifier) {
        HorizontalPager(state = pagerState, modifier = Modifier.weight(1f)) { page ->
            if (page == 0) {
                CoverPage(cover = cover, title = music?.text("name").orEmpty(), singer = music?.text("singer").orEmpty())
            } else {
                LyricView(
                    parsed = lyrics.parsed,
                    positionMs = positionMs,
                    loading = lyrics.loading,
                    fontSizeSp = fontSizeTenths / 10f,
                ) { seekMs -> scope.launch { runtime.core.seekTo(seekMs) } }
            }
        }
        PageDots(
            pageCount = 2,
            current = pagerState.currentPage,
            onSelect = { page -> scope.launch { pagerState.animateScrollToPage(page) } },
        )
        PlayerControls(
            state = state,
            positionMs = positionMs,
            onPrev = { scope.launch { runtime.core.playPrev() } },
            onTogglePlay = { scope.launch { runtime.core.togglePlay() } },
            onNext = { scope.launch { runtime.core.playNext() } },
            onSeekFraction = { fraction ->
                scope.launch { runtime.core.seekTo((fraction * state.progress.maxPlayTimeSec * 1000).toLong()) }
            },
            onCycleMode = { scope.launch { runtime.togglePlayMethod() } },
            onToggleTranslation = onToggleTranslation,
            translationShown = translationShown,
            onFontSmaller = { onFontSizeCommit((fontSizeTenths - 10).coerceAtLeast(MIN_FONT_TENTHS)) },
            onFontLarger = { onFontSizeCommit((fontSizeTenths + 10).coerceAtMost(MAX_FONT_TENTHS)) },
            onOpenPlaylist = onOpenPlaylist,
        )
    }
}

@Composable
private fun PlayerHeader(
    title: String,
    onBack: () -> Unit,
    onOpenMore: () -> Unit,
) {
    val statusTop = WindowInsets.statusBars.asPaddingValues().calculateTopPadding()
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(top = statusTop + 4.dp, start = 8.dp, end = 8.dp)
                .height(52.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        GlyphButton(Glyph.Back, size = 44.dp, onClick = onBack)
        BasicText(
            text = title,
            modifier = Modifier.weight(1f),
            style =
                TextStyle(
                    color = Color.White.copy(alpha = 0.92f),
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Medium,
                    textAlign = TextAlign.Center,
                ),
        )
        // 与返回键等宽，标题保持居中
        GlyphButton(Glyph.More, size = 44.dp, onClick = onOpenMore)
    }
}

@Composable
private fun PlayerBackdrop(cover: CoverArt?) {
    Box(Modifier.fillMaxSize().background(Color(0xFF141218))) {
        if (cover != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                // API 31+：RenderEffect 硬件模糊
                Image(
                    bitmap = cover.cover,
                    contentDescription = null,
                    modifier = Modifier.fillMaxSize().blur(70.dp),
                    contentScale = ContentScale.Crop,
                    alpha = 0.85f,
                )
            } else {
                // 低版本 Modifier.blur 无效：拿 32px 小图放大，双线性插值近似模糊
                Image(
                    bitmap = cover.blurSource ?: cover.cover,
                    contentDescription = null,
                    modifier = Modifier.fillMaxSize(),
                    contentScale = ContentScale.Crop,
                    filterQuality = FilterQuality.Low,
                    alpha = 0.9f,
                )
            }
        }
        Box(
            Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        0f to Color.Black.copy(alpha = 0.30f),
                        0.55f to Color.Black.copy(alpha = 0.42f),
                        1f to Color(0xF0121016),
                    ),
                ),
        )
    }
}

@Composable
private fun CoverPage(
    cover: CoverArt?,
    title: String,
    singer: String,
) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val coverSize = minOf(maxWidth * 0.78f, maxHeight * 0.62f)
        Column(
            modifier = Modifier.fillMaxSize().padding(horizontal = 32.dp, vertical = 24.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(
                modifier =
                    Modifier
                        .size(coverSize)
                        .shadow(26.dp, RoundedCornerShape(20.dp), ambientColor = Color.Black, spotColor = Color.Black)
                        .clip(RoundedCornerShape(20.dp))
                        .background(Color.White.copy(alpha = 0.08f)),
                contentAlignment = Alignment.Center,
            ) {
                if (cover != null) {
                    Image(
                        bitmap = cover.cover,
                        contentDescription = null,
                        modifier = Modifier.fillMaxSize(),
                        contentScale = ContentScale.Crop,
                    )
                } else {
                    BasicText(
                        text = "寻音",
                        style = TextStyle(color = Color.White.copy(alpha = 0.4f), fontSize = 20.sp),
                    )
                }
            }
            Spacer(Modifier.height(28.dp))
            BasicText(
                text = title.ifEmpty { "暂无播放" },
                modifier = Modifier.fillMaxWidth(),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                style =
                    TextStyle(
                        color = Color.White,
                        fontSize = 22.sp,
                        fontWeight = FontWeight.SemiBold,
                        textAlign = TextAlign.Center,
                    ),
            )
            if (singer.isNotEmpty()) {
                Spacer(Modifier.height(6.dp))
                BasicText(
                    text = singer,
                    modifier = Modifier.fillMaxWidth(),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    style =
                        TextStyle(
                            color = Color.White.copy(alpha = 0.62f),
                            fontSize = 13.sp,
                            textAlign = TextAlign.Center,
                        ),
                )
            }
        }
    }
}

@Composable
private fun PageDots(
    pageCount: Int,
    current: Int,
    onSelect: (Int) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        repeat(pageCount) { index ->
            Box(
                modifier =
                    Modifier
                        .padding(horizontal = 4.dp)
                        .size(if (index == current) 7.dp else 5.dp)
                        .clip(CircleShape)
                        .background(Color.White.copy(alpha = if (index == current) 0.9f else 0.35f))
                        .clickable { onSelect(index) },
            )
        }
    }
}

@Composable
private fun PlayerControls(
    state: PlayerState,
    positionMs: Long,
    onPrev: () -> Unit,
    onTogglePlay: () -> Unit,
    onNext: () -> Unit,
    onSeekFraction: (Float) -> Unit,
    onCycleMode: () -> Unit,
    onToggleTranslation: () -> Unit,
    translationShown: Boolean,
    onFontSmaller: () -> Unit,
    onFontLarger: () -> Unit,
    onOpenPlaylist: () -> Unit,
) {
    val durationMs = (state.progress.maxPlayTimeSec * 1000).toLong().coerceAtLeast(0L)
    val fraction = if (durationMs > 0) (positionMs.toFloat() / durationMs).coerceIn(0f, 1f) else 0f
    val enabled = state.playMusicInfo.musicInfo != null

    Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 12.dp)) {
        SeekBar(fraction = fraction, enabled = enabled, onSeek = onSeekFraction)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            BasicText(
                text = formatTime(positionMs),
                style = TextStyle(color = Color.White.copy(alpha = 0.55f), fontSize = 11.sp),
            )
            BasicText(
                text = formatTime(durationMs),
                style = TextStyle(color = Color.White.copy(alpha = 0.55f), fontSize = 11.sp),
            )
        }
        Spacer(Modifier.height(10.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            GlyphButton(Glyph.Prev, size = 58.dp, enabled = enabled, onClick = onPrev)
            GlyphButton(
                glyph = if (state.isPlay) Glyph.Pause else Glyph.Play,
                size = 76.dp,
                enabled = enabled,
                filled = true,
                onClick = onTogglePlay,
            )
            GlyphButton(Glyph.Next, size = 58.dp, enabled = enabled, onClick = onNext)
        }
        Spacer(Modifier.height(16.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextAction(label = playModeLabel(state.playMethod), onClick = onCycleMode)
            TextAction(label = if (translationShown) "译文·开" else "译文·关", onClick = onToggleTranslation)
            TextAction(label = "A-", onClick = onFontSmaller)
            TextAction(label = "A+", onClick = onFontLarger)
            TextAction(label = "列表", onClick = onOpenPlaylist)
        }
        Spacer(Modifier.height(8.dp))
    }
}

@Composable
private fun SeekBar(
    fraction: Float,
    enabled: Boolean,
    onSeek: (Float) -> Unit,
) {
    var widthPx by remember { mutableStateOf(1) }
    var dragFraction by remember { mutableStateOf<Float?>(null) }
    val shown = dragFraction ?: fraction
    Box(
        modifier =
            Modifier
                .fillMaxWidth()
                .height(26.dp)
                .onSizeChanged { widthPx = it.width.coerceAtLeast(1) }
                .pointerInput(enabled) {
                    if (!enabled) return@pointerInput
                    awaitEachGesture {
                        val down = awaitFirstDown()
                        var x = down.position.x.coerceIn(0f, widthPx.toFloat())
                        dragFraction = x / widthPx
                        while (true) {
                            val event = awaitPointerEvent()
                            val change = event.changes.firstOrNull() ?: break
                            x = change.position.x.coerceIn(0f, widthPx.toFloat())
                            if (change.changedToUp()) {
                                dragFraction = null
                                onSeek(x / widthPx)
                                break
                            }
                            dragFraction = x / widthPx
                            change.consume()
                        }
                    }
                },
        contentAlignment = Alignment.CenterStart,
    ) {
        Canvas(Modifier.fillMaxWidth().height(26.dp)) {
            val centerY = size.height / 2
            val trackHeight = 3.dp.toPx()
            val radius = CornerRadius(trackHeight / 2)
            drawRoundRect(
                color = Color.White.copy(alpha = 0.22f),
                topLeft = Offset(0f, centerY - trackHeight / 2),
                size = Size(size.width, trackHeight),
                cornerRadius = radius,
            )
            drawRoundRect(
                color = Color.White.copy(alpha = 0.9f),
                topLeft = Offset(0f, centerY - trackHeight / 2),
                size = Size(size.width * shown, trackHeight),
                cornerRadius = radius,
            )
            drawCircle(
                color = Color.White,
                radius = 6.dp.toPx(),
                center = Offset(size.width * shown, centerY),
            )
        }
    }
}

@Composable
private fun TextAction(
    label: String,
    onClick: () -> Unit,
) {
    BasicText(
        text = label,
        modifier =
            Modifier
                .clip(RoundedCornerShape(10.dp))
                .clickable(onClick = onClick)
                .padding(horizontal = 8.dp, vertical = 6.dp),
        style = TextStyle(color = Color.White.copy(alpha = 0.75f), fontSize = 12.sp),
    )
}

private enum class Glyph { Play, Pause, Prev, Next, Back, More }

@Composable
private fun GlyphButton(
    glyph: Glyph,
    size: androidx.compose.ui.unit.Dp,
    enabled: Boolean = true,
    filled: Boolean = false,
    onClick: () -> Unit,
) {
    val alpha = if (enabled) 1f else 0.35f
    Box(
        modifier =
            Modifier
                .size(size)
                .clip(CircleShape)
                .background(if (filled) Color.White.copy(alpha = 0.14f * alpha) else Color.Transparent)
                .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        GlyphIcon(glyph = glyph, color = Color.White.copy(alpha = alpha), modifier = Modifier.size(size * 0.46f))
    }
}

@Composable
private fun GlyphIcon(
    glyph: Glyph,
    color: Color,
    modifier: Modifier,
) {
    Canvas(modifier) {
        val w = size.width
        val h = size.height
        when (glyph) {
            Glyph.Play -> {
                val path =
                    Path().apply {
                        moveTo(w * 0.18f, h * 0.08f)
                        lineTo(w * 0.88f, h * 0.5f)
                        lineTo(w * 0.18f, h * 0.92f)
                        close()
                    }
                drawPath(path, color)
            }
            Glyph.Pause -> {
                val barWidth = w * 0.2f
                drawRoundRect(
                    color = color,
                    topLeft = Offset(w * 0.22f, h * 0.1f),
                    size = Size(barWidth, h * 0.8f),
                    cornerRadius = CornerRadius(barWidth * 0.28f),
                )
                drawRoundRect(
                    color = color,
                    topLeft = Offset(w * 0.58f, h * 0.1f),
                    size = Size(barWidth, h * 0.8f),
                    cornerRadius = CornerRadius(barWidth * 0.28f),
                )
            }
            Glyph.Prev -> {
                drawRect(color, Offset(0f, h * 0.14f), Size(w * 0.11f, h * 0.72f))
                val path =
                    Path().apply {
                        moveTo(w * 0.92f, h * 0.1f)
                        lineTo(w * 0.92f, h * 0.9f)
                        lineTo(w * 0.24f, h * 0.5f)
                        close()
                    }
                drawPath(path, color)
            }
            Glyph.Next -> {
                drawRect(color, Offset(w * 0.89f, h * 0.14f), Size(w * 0.11f, h * 0.72f))
                val path =
                    Path().apply {
                        moveTo(w * 0.08f, h * 0.1f)
                        lineTo(w * 0.08f, h * 0.9f)
                        lineTo(w * 0.76f, h * 0.5f)
                        close()
                    }
                drawPath(path, color)
            }
            Glyph.Back -> {
                val path =
                    Path().apply {
                        moveTo(w * 0.66f, h * 0.16f)
                        lineTo(w * 0.3f, h * 0.5f)
                        lineTo(w * 0.66f, h * 0.84f)
                    }
                drawPath(
                    path = path,
                    color = color,
                    style = Stroke(width = w * 0.1f, cap = StrokeCap.Round),
                )
            }
            Glyph.More -> {
                val radius = w * 0.085f
                listOf(0.18f, 0.5f, 0.82f).forEach { y ->
                    drawCircle(color = color, radius = radius, center = Offset(w * 0.5f, h * y))
                }
            }
        }
    }
}

@Composable
private fun PlaylistSheet(
    runtime: PlayerRuntime,
    currentId: String?,
    listId: String?,
    onDismiss: () -> Unit,
) {
    var items by remember { mutableStateOf<List<JsonObject>>(emptyList()) }
    LaunchedEffect(listId) { items = runtime.playerList() }
    val scope = rememberCoroutineScope()

    Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.45f)).clickable(onClick = onDismiss)) {
        Column(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .align(Alignment.BottomCenter)
                    .clip(RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp))
                    .background(Color(0xFF1B1920))
                    .padding(top = 16.dp)
                    .pointerInput(Unit) { detectTapGestures { } },
        ) {
            BasicText(
                text = "播放列表 · ${items.size}",
                modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp),
                style =
                    TextStyle(
                        color = Color.White,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.SemiBold,
                    ),
            )
            if (items.isEmpty()) {
                BasicText(
                    text = "当前没有播放列表",
                    modifier = Modifier.fillMaxWidth().padding(24.dp),
                    style = TextStyle(color = Color.White.copy(alpha = 0.5f), fontSize = 13.sp, textAlign = TextAlign.Center),
                )
            } else {
                LazyColumn(contentPadding = PaddingValues(bottom = 24.dp), modifier = Modifier.height(420.dp)) {
                    items(items.size) { index ->
                        val item = items[index]
                        val id = item.text("id")
                        val active = id != null && id == currentId
                        Column(
                            modifier =
                                Modifier
                                    .fillMaxWidth()
                                    .clickable {
                                        scope.launch {
                                            if (listId != null && id != null) runtime.core.playListById(listId, id)
                                            onDismiss()
                                        }
                                    }.padding(horizontal = 20.dp, vertical = 12.dp),
                        ) {
                            BasicText(
                                text = item.text("name").orEmpty(),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                style =
                                    TextStyle(
                                        color = if (active) Color(0xFF8ED6FF) else Color.White.copy(alpha = 0.92f),
                                        fontSize = 14.sp,
                                    ),
                            )
                            BasicText(
                                text = item.text("singer").orEmpty(),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                style =
                                    TextStyle(
                                        color = Color.White.copy(alpha = 0.45f),
                                        fontSize = 11.sp,
                                    ),
                            )
                        }
                    }
                }
            }
        }
    }
}

private fun playModeLabel(method: TogglePlayMethod): String =
    when (method) {
        TogglePlayMethod.LIST_LOOP -> "列表循环"
        TogglePlayMethod.RANDOM -> "随机播放"
        TogglePlayMethod.LIST -> "顺序播放"
        TogglePlayMethod.SINGLE_LOOP -> "单曲循环"
        TogglePlayMethod.NONE -> "播完停止"
    }

private fun formatTime(ms: Long): String {
    val totalSec = ms.coerceAtLeast(0L) / 1000
    return String.format(Locale.US, "%d:%02d", totalSec / 60, totalSec % 60)
}

private fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content

private fun JsonObject.metaText(key: String): String? =
    ((this["meta"] as? JsonObject)?.get(key) as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content

private fun JsonObject.musicKey(): String = "${text("source").orEmpty()}|${text("id").orEmpty()}"
