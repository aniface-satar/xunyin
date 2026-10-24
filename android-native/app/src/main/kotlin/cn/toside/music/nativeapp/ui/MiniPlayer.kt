package cn.toside.music.nativeapp.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cn.toside.music.nativeapp.player.PlayerRuntime
import cn.toside.music.nativeapp.ui.play.CoverArt
import cn.toside.music.nativeapp.ui.play.CoverImageLoader
import com.moriafly.salt.ui.SaltTheme
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * 首页迷你播放条（B5）：封面 + 歌名/歌手 + 播放暂停，点击进入播放页。
 *
 * 播放状态直接订阅 `PlayerRuntime.core.state`，与播放页/通知栏共用同一份事实来源。
 */
@Composable
fun MiniPlayer(
    onOpen: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val runtime = remember { PlayerRuntime.get(context) }
    val state by runtime.core.state.collectAsState()
    val scope = rememberCoroutineScope()
    val music = state.playMusicInfo.musicInfo ?: return
    val picUrl = music.metaText("picUrl")
    var cover by remember(picUrl) { mutableStateOf<CoverArt?>(null) }
    LaunchedEffect(picUrl) { cover = CoverImageLoader.load(picUrl) }

    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 6.dp)
                .clip(RoundedCornerShape(14.dp))
                .background(SaltTheme.colors.subBackground)
                .clickable(onClick = onOpen)
                .padding(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier =
                Modifier
                    .size(44.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(SaltTheme.colors.stroke),
        ) {
            cover?.let {
                Image(
                    bitmap = it.cover,
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize(),
                )
            }
        }
        Column(Modifier.weight(1f).padding(horizontal = 10.dp)) {
            BasicText(
                text = music.text("name").orEmpty(),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                style =
                    TextStyle(
                        color = SaltTheme.colors.text,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Medium,
                    ),
            )
            BasicText(
                text = music.text("singer").orEmpty(),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                style = TextStyle(color = SaltTheme.colors.subText, fontSize = 12.sp),
            )
        }
        Box(
            modifier =
                Modifier
                    .size(48.dp)
                    .clip(CircleShape)
                    .background(SaltTheme.colors.background)
                    .clickable { scope.launch { runtime.core.togglePlay() } },
            contentAlignment = Alignment.Center,
        ) {
            PlayPauseGlyph(isPlay = state.isPlay, color = SaltTheme.colors.text)
        }
    }
}

@Composable
private fun PlayPauseGlyph(
    isPlay: Boolean,
    color: Color,
) {
    Canvas(Modifier.size(16.dp)) {
        val w = size.width
        val h = size.height
        if (isPlay) {
            val barWidth = w * 0.26f
            drawRoundRect(
                color = color,
                topLeft = Offset(w * 0.2f, h * 0.12f),
                size = Size(barWidth, h * 0.76f),
                cornerRadius = CornerRadius(1.5f, 1.5f),
            )
            drawRoundRect(
                color = color,
                topLeft = Offset(w * 0.54f, h * 0.12f),
                size = Size(barWidth, h * 0.76f),
                cornerRadius = CornerRadius(1.5f, 1.5f),
            )
        } else {
            val path =
                Path().apply {
                    moveTo(w * 0.24f, h * 0.1f)
                    lineTo(w * 0.86f, h * 0.5f)
                    lineTo(w * 0.24f, h * 0.9f)
                    close()
                }
            drawPath(path, color)
        }
    }
}

private fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content

private fun JsonObject.metaText(key: String): String? =
    ((this["meta"] as? JsonObject)?.get(key) as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content
