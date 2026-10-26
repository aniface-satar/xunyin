package cn.toside.music.nativeapp.ui.share

import android.content.Context
import android.graphics.Bitmap
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cn.toside.music.core.share.RATIO_OPTIONS
import cn.toside.music.core.share.RatioKey
import cn.toside.music.core.share.buildShareCardLayout
import cn.toside.music.core.share.buildShareLyricLayout
import cn.toside.music.core.share.cardFileName
import cn.toside.music.core.share.lyricBlockLines
import cn.toside.music.nativeapp.player.PlayerRuntime
import cn.toside.music.nativeapp.ui.play.CoverImageLoader
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

private enum class ShareCardMode(
    val label: String,
) {
    MUSIC("音乐卡"),
    LYRIC("歌词卡"),
}

/** 竖屏歌词页左右各 28dp（`LyricView`），卡上「这一句在歌词页是否一行」要拿同一宽度判定。 */
private const val LYRIC_PAGE_SIDE_PADDING = 28.0

/**
 * 分享模式全屏层（任务书 §4）。
 *
 * 预览显示的就是 [ShareCardRenderer] 画出的那张位图，保存写入的也是它（WYSIWYG）。
 * 比例/排版/取值的全部决策在 `:core/share`，这里只负责状态与绘制调度。
 */
@Composable
fun ShareCardOverlay(
    runtime: PlayerRuntime,
    fontSizeTenths: Int,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    val configuration = LocalConfiguration.current
    val screenWidth = configuration.screenWidthDp.toDouble()
    val screenHeight = configuration.screenHeightDp.toDouble()
    val isDark = isSystemInDarkTheme()
    val state by runtime.core.state.collectAsState()
    val lyrics by runtime.lyrics.collectAsState()
    val music = state.playMusicInfo.musicInfo
    val musicKey =
        music
            ?.let { "${it.text("source").orEmpty()}|${it.text("id").orEmpty()}" }
            .orEmpty()
    val track =
        remember(musicKey, music) {
            ShareTrackInfo(
                name = music?.text("name").orEmpty(),
                singer = music?.text("singer").orEmpty(),
                coverUrl = music?.metaText("picUrl"),
            )
        }
    val lyricLines =
        remember(lyrics, musicKey, fontSizeTenths, screenWidth) {
            if (lyrics.musicId == musicKey && lyrics.parsed.lines.isNotEmpty()) {
                lyricBlockLines(
                    parsed = lyrics.parsed,
                    pageFontSize = fontSizeTenths / 10.0,
                    pageTextWidth = (screenWidth - LYRIC_PAGE_SIDE_PADDING * 2).coerceAtLeast(1.0),
                )
            } else {
                emptyList()
            }
        }

    var mode by remember { mutableStateOf(ShareCardMode.MUSIC) }
    var ratio by remember { mutableStateOf(RatioKey.FULLSCREEN) }
    var bitmap by remember { mutableStateOf<Bitmap?>(null) }
    var preparing by remember { mutableStateOf(true) }
    var saving by remember { mutableStateOf(false) }

    /** 本次预览内已落盘的图（分享复用；预览重画即失效，避免把上一张分享出去）。 */
    var saved by remember { mutableStateOf<ShareSaveResult.Saved?>(null) }

    val scope = rememberCoroutineScope()

    val hasMusic = music != null
    val canDraw = hasMusic && (mode == ShareCardMode.MUSIC || lyricLines.isNotEmpty())
    val lyricLoading = mode == ShareCardMode.LYRIC && (lyrics.loading || lyrics.musicId != musicKey)

    LaunchedEffect(canDraw, mode, ratio, isDark, screenWidth, screenHeight, track, lyricLines, fontSizeTenths) {
        bitmap = null
        saved = null
        if (!canDraw) {
            preparing = false
            return@LaunchedEffect
        }
        preparing = true
        val card = buildShareCardLayout(isDark, ratio, screenWidth, screenHeight)
        val cover = CoverImageLoader.load(track.coverUrl)
        val lyric =
            if (mode == ShareCardMode.LYRIC) {
                buildShareLyricLayout(lyricLines, card, fontSizeTenths / 10.0)
            } else {
                null
            }
        val rendered = withContext(Dispatchers.Default) { ShareCardRenderer.render(context, track, card, lyric, cover) }
        bitmap = rendered
        preparing = false
    }

    fun save(shareAfter: Boolean = false) {
        val image = bitmap ?: return
        if (saving) return
        saving = true
        scope.launch {
            val result =
                saved ?: withContext(Dispatchers.IO) {
                    ShareCardSaver.save(context, image, cardFileName(track.name, track.singer))
                }
            saving = false
            when (result) {
                is ShareSaveResult.Saved -> {
                    saved = result
                    if (shareAfter) {
                        // RN `ShareCardModal#handleShare` 三个入参：chooser 标题 / SUBJECT / TEXT
                        ShareImageSender.sendWithToast(
                            context = context,
                            uri = result.uri,
                            chooserTitle = "将「${track.name}」分享到...",
                            subject = "歌曲分享",
                            text = "${track.name} - ${track.singer}",
                        )
                    } else {
                        toast(context, "已保存：${result.fileName}")
                    }
                }
                is ShareSaveResult.Failed -> toast(context, result.message)
            }
        }
    }

    // 保存中不接受关闭：这一刻丢层会让正在写的图变成一个没人引用的半成品
    BackHandler { if (!saving) onDismiss() }

    Box(
        Modifier
            .fillMaxSize()
            .background(Color(0xFF0B0B0D))
            .pointerInput(Unit) { detectTapGestures { } },
    ) {
        Column(
            Modifier
                .fillMaxSize()
                .windowInsetsPadding(WindowInsets.statusBars)
                .windowInsetsPadding(WindowInsets.navigationBars)
                .padding(horizontal = 20.dp, vertical = 14.dp),
        ) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                BasicText(
                    text = "分享卡片",
                    style = TextStyle(color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.SemiBold),
                )
                Spacer(Modifier.weight(1f))
                BasicText(
                    text = if (saving) "正在保存…" else "关闭",
                    modifier =
                        Modifier
                            .clip(RoundedCornerShape(9.dp))
                            .clickable(enabled = !saving, onClick = onDismiss)
                            .padding(horizontal = 12.dp, vertical = 8.dp),
                    style =
                        TextStyle(
                            color = Color.White.copy(alpha = if (saving) 0.35f else 0.75f),
                            fontSize = 14.sp,
                        ),
                )
            }
            Box(
                modifier = Modifier.weight(1f).fillMaxWidth(),
                contentAlignment = Alignment.Center,
            ) {
                val image = bitmap
                when {
                    image != null ->
                        Image(
                            bitmap = image.asImageBitmap(),
                            contentDescription = "分享卡预览",
                            contentScale = ContentScale.Fit,
                            modifier = Modifier.fillMaxSize().padding(vertical = 10.dp),
                        )
                    preparing ->
                        BasicText(
                            text = "正在生成图片...",
                            style = TextStyle(color = Color.White.copy(alpha = 0.55f), fontSize = 14.sp),
                        )
                    !hasMusic ->
                        BasicText(
                            text = "暂无可分享的歌曲",
                            style = TextStyle(color = Color.White.copy(alpha = 0.55f), fontSize = 14.sp),
                        )
                    lyricLoading ->
                        BasicText(
                            text = "正在加载歌词...",
                            style = TextStyle(color = Color.White.copy(alpha = 0.55f), fontSize = 14.sp),
                        )
                    else ->
                        BasicText(
                            text = "暂无歌词",
                            style = TextStyle(color = Color.White.copy(alpha = 0.55f), fontSize = 14.sp),
                        )
                }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ShareChoiceChip(
                    text = ShareCardMode.MUSIC.label,
                    selected = mode == ShareCardMode.MUSIC,
                    modifier = Modifier.weight(1f),
                    onClick = { mode = ShareCardMode.MUSIC },
                )
                ShareChoiceChip(
                    text = ShareCardMode.LYRIC.label,
                    selected = mode == ShareCardMode.LYRIC,
                    modifier = Modifier.weight(1f),
                    onClick = { mode = ShareCardMode.LYRIC },
                )
            }
            Spacer(Modifier.height(10.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                RATIO_OPTIONS.forEach { option ->
                    ShareChoiceChip(
                        text = if (option == RatioKey.FULLSCREEN) "全屏" else option.label,
                        selected = ratio == option,
                        modifier = Modifier.weight(1f),
                        onClick = { ratio = option },
                    )
                }
            }
            Spacer(Modifier.height(14.dp))
            val actionEnabled = bitmap != null && !saving
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                ShareActionButton(
                    text = if (saving) "正在处理…" else "保存图片",
                    primary = true,
                    enabled = actionEnabled,
                    modifier = Modifier.weight(1f),
                    onClick = { save() },
                )
                ShareActionButton(
                    text = "分享卡片",
                    primary = false,
                    enabled = actionEnabled,
                    modifier = Modifier.weight(1f),
                    onClick = { save(shareAfter = true) },
                )
            }
        }
    }
}

@Composable
private fun ShareActionButton(
    text: String,
    primary: Boolean,
    enabled: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val background =
        when {
            primary && enabled -> Color(0xFFEDEAF2)
            primary -> Color(0xFF2A282F)
            enabled -> Color(0xFF242229)
            else -> Color(0xFF1F1D24)
        }
    val textColor =
        when {
            !enabled -> Color.White.copy(alpha = 0.35f)
            primary -> Color(0xFF1B1920)
            else -> Color.White.copy(alpha = 0.85f)
        }
    Box(
        modifier =
            modifier
                .height(48.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(background)
                .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        BasicText(
            text = text,
            maxLines = 1,
            style =
                TextStyle(
                    color = textColor,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Medium,
                    textAlign = TextAlign.Center,
                ),
        )
    }
}

@Composable
private fun ShareChoiceChip(
    text: String,
    selected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Box(
        modifier =
            modifier
                .height(34.dp)
                .clip(RoundedCornerShape(9.dp))
                .background(if (selected) Color(0xFFEDEAF2) else Color(0xFF242229))
                .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        BasicText(
            text = text,
            maxLines = 1,
            style =
                TextStyle(
                    color = if (selected) Color(0xFF1B1920) else Color.White.copy(alpha = 0.72f),
                    fontSize = 12.sp,
                ),
        )
    }
}

private fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content

private fun JsonObject.metaText(key: String): String? =
    ((this["meta"] as? JsonObject)?.get(key) as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content

private fun toast(
    context: Context,
    message: String,
) {
    Toast.makeText(context, message, Toast.LENGTH_SHORT).show()
}
