package cn.toside.music.nativeapp.ui.play

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cn.toside.music.core.lyric.ParsedLyric

/**
 * 竖屏歌词列：逐帧由播放位置算当前行，自动居中滚动；用户手动拖动期间不抢滚动。
 *
 * 当前行判定用 [ParsedLyric.indexAt]，与 RN `lrc-file-parser` 的行边界一致
 * （含插件 100ms offset 与 `[offset:]` 标签）。
 */
@Composable
fun LyricView(
    parsed: ParsedLyric,
    positionMs: Long,
    loading: Boolean,
    fontSizeSp: Float,
    modifier: Modifier = Modifier,
    onSeek: (Long) -> Unit,
) {
    val lines = parsed.lines
    val current = parsed.indexAt(positionMs)
    val listState = rememberLazyListState()
    var userScrolling by remember { mutableStateOf(false) }
    LaunchedEffect(listState.isScrollInProgress) {
        userScrolling = listState.isScrollInProgress
    }
    LaunchedEffect(current, lines.size) {
        if (!userScrolling && current in lines.indices) {
            listState.animateScrollToItem(current)
        }
    }

    BoxWithConstraints(modifier.fillMaxSize()) {
        val verticalPadding = maxHeight / 2
        if (lines.isEmpty()) {
            BasicText(
                text = if (loading) "歌词加载中…" else "暂无歌词",
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .align(Alignment.Center),
                style =
                    TextStyle(
                        color = Color.White.copy(alpha = 0.6f),
                        fontSize = 15.sp,
                        textAlign = TextAlign.Center,
                    ),
            )
            return@BoxWithConstraints
        }
        LazyColumn(
            state = listState,
            modifier = Modifier.fillMaxSize(),
            contentPadding =
                androidx.compose.foundation.layout.PaddingValues(
                    top = verticalPadding,
                    bottom = verticalPadding,
                ),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            items(lines.size) { index ->
                val line = lines[index]
                val active = index == current
                LyricLineItem(
                    text = line.text,
                    extended = line.extendedLyrics,
                    active = active,
                    fontSizeSp = fontSizeSp,
                    onClick = { onSeek(line.timeMs) },
                )
            }
        }
    }
}

@Composable
private fun LyricLineItem(
    text: String,
    extended: List<String>,
    active: Boolean,
    fontSizeSp: Float,
    onClick: () -> Unit,
) {
    val targetScale = if (active) 1f else 0.86f
    val scale by animateFloatAsState(targetScale, label = "lyricScale")
    val alpha by animateFloatAsState(if (active) 1f else 0.45f, label = "lyricAlpha")
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .pointerInput(text) { detectTapGestures(onTap = { onClick() }) }
                .padding(horizontal = 28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        BasicText(
            text = text,
            style =
                TextStyle(
                    color = Color.White.copy(alpha = alpha),
                    fontSize = (fontSizeSp * scale).sp,
                    fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
                    textAlign = TextAlign.Center,
                    lineHeight = (fontSizeSp * scale * 1.3f).sp,
                ),
        )
        for (extra in extended) {
            BasicText(
                text = extra,
                style =
                    TextStyle(
                        color = Color.White.copy(alpha = alpha * 0.72f),
                        fontSize = (fontSizeSp * scale * 0.72f).sp,
                        textAlign = TextAlign.Center,
                        lineHeight = (fontSizeSp * scale * 1.2f).sp,
                    ),
                modifier = Modifier.padding(top = 2.dp),
            )
        }
    }
}
