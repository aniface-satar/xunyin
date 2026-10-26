package cn.toside.music.nativeapp.ui.radio

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cn.toside.music.core.recommend.radio.RadioMode
import cn.toside.music.nativeapp.player.PlayerRuntime
import com.moriafly.salt.ui.SaltTheme
import com.moriafly.salt.ui.Text
import com.moriafly.salt.ui.UnstableSaltUiApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * 个性电台页（S13 M2）—— 电台主线的唯一 UI 入口。
 *
 * 只做三件事：开播/停播与模式切换、当前曲的「喜欢 / 不感兴趣」反馈、
 * 队列预览与异常提示。取曲、补位、踩雷持久化全在 [cn.toside.music.nativeapp.data.RadioRuntime]，
 * 本页不持有任何电台状态（只有提示文案是本地状态）。
 */
@OptIn(UnstableSaltUiApi::class)
@Composable
fun RadioPage(
    onBack: () -> Unit,
    onOpenPlayer: () -> Unit,
) {
    val context = LocalContext.current
    val player = remember { PlayerRuntime.get(context) }
    val radio = player.radio
    val status by radio.status.collectAsState()
    val playerState by player.core.state.collectAsState()
    val scope = rememberCoroutineScope()
    var message by remember { mutableStateOf<String?>(null) }

    val current = playerState.playMusicInfo.musicInfo
    val currentIsRadio = current != null && radio.isRadioTrack(current)

    // 收听区间采样（RN playbackTracker）：每秒一次，引擎据此算完播/早切
    LaunchedEffect(Unit) {
        while (true) {
            delay(1000)
            if (!radio.isActive()) continue
            val state = player.core.state.value
            radio.observePlayback(
                positionMs = (state.progress.nowPlayTimeSec * 1000f).toLong(),
                playing = state.isPlay,
                durationMs = (state.progress.maxPlayTimeSec * 1000f).toLong().takeIf { it > 0 },
            )
        }
    }

    Column(
        modifier =
            Modifier
                .fillMaxSize()
                .background(SaltTheme.colors.background)
                .verticalScroll(rememberScrollState()),
    ) {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .statusBarsPadding()
                    .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "‹ 返回",
                modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable(onClick = onBack).padding(8.dp),
                color = SaltTheme.colors.highlight,
            )
            Text(
                text = "个性电台",
                modifier = Modifier.weight(1f).padding(start = 8.dp),
                color = SaltTheme.colors.text,
                fontSize = 20.sp,
                fontWeight = FontWeight.Bold,
            )
            if (current != null) {
                Text(
                    text = "播放页",
                    modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable(onClick = onOpenPlayer).padding(8.dp),
                    color = SaltTheme.colors.highlight,
                )
            }
        }

        ModeRow(
            current = status.mode,
            enabled = !status.starting,
            onPick = { picked ->
                scope.launch { message = radio.start(picked) }
            },
        )

        StatusCard(
            active = status.active,
            starting = status.starting,
            poolSize = status.poolSize,
            queueSize = status.queueSize,
            pending = status.pending,
            safeMode = status.safeMode,
            negativeStreak = status.negativeStreak,
            error = status.error,
        )

        if (current != null) {
            CurrentTrackCard(
                name = current.text("name").orEmpty(),
                singer = current.text("singer").orEmpty(),
                isRadioTrack = currentIsRadio,
                onLike = {
                    scope.launch {
                        radio.like(current)
                        message = null
                    }
                },
                onDislike = {
                    scope.launch {
                        message = radio.dislike(current) ?: "已加入不感兴趣"
                    }
                },
            )
        } else {
            Hint("还没有播放中的歌曲：点下面「开始电台」随机性推荐一批")
        }

        ActionRow(
            active = status.active,
            onStart = { scope.launch { message = radio.start(status.mode) } },
            onStop = { scope.launch { radio.stop() } },
            onNext = { scope.launch { player.core.playNext() } },
        )

        if (status.upcoming.isNotEmpty()) {
            Text(
                text = "接下来",
                modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 18.dp, bottom = 6.dp),
                color = SaltTheme.colors.subText,
                fontSize = 13.sp,
            )
            status.upcoming.forEach { name ->
                Text(
                    text = name.ifEmpty { "（未知曲目）" },
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
                    color = SaltTheme.colors.text,
                    fontSize = 15.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }

        message?.let { Hint(it) }
        Hint(
            "不感兴趣会写进踩雷列表（与 RN 同一份 @dislike_list），" +
                "同时给来源歌单降权；喜欢会立刻影响下一批候选。",
        )
    }
}

@OptIn(UnstableSaltUiApi::class)
@Composable
private fun ModeRow(
    current: RadioMode,
    enabled: Boolean,
    onPick: (RadioMode) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        listOf(RadioMode.RADIO to "电台", RadioMode.EXPLORE to "探索").forEach { (mode, label) ->
            val selected = mode == current
            Box(
                modifier =
                    Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(10.dp))
                        .background(
                            if (selected) SaltTheme.colors.highlight.copy(alpha = 0.12f) else SaltTheme.colors.subBackground,
                        ).clickable(enabled = enabled) { onPick(mode) }
                        .padding(vertical = 10.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = if (selected) "$label（进行中）" else label,
                    color = if (selected) SaltTheme.colors.highlight else SaltTheme.colors.subText,
                    fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                )
            }
        }
    }
}

@OptIn(UnstableSaltUiApi::class)
@Composable
private fun StatusCard(
    active: Boolean,
    starting: Boolean,
    poolSize: Int,
    queueSize: Int,
    pending: Int,
    safeMode: Boolean,
    negativeStreak: Int,
    error: String?,
) {
    val text =
        when {
            starting -> "正在取曲…"
            active -> "电台进行中 · 候选池 $poolSize · 队列 $queueSize · 待提交 $pending"
            error != null -> "取曲失败：${errorText(error)}"
            else -> "未开播"
        }
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 10.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(SaltTheme.colors.subBackground)
                .padding(14.dp),
    ) {
        Text(text = text, color = SaltTheme.colors.text, fontSize = 14.sp)
        if (safeMode) {
            Text(
                text = "安全模式：连续 $negativeStreak 首不合胃口，已撤下相似待播曲",
                modifier = Modifier.padding(top = 6.dp),
                color = SaltTheme.colors.highlight,
                fontSize = 12.sp,
            )
        }
    }
}

@OptIn(UnstableSaltUiApi::class)
@Composable
private fun CurrentTrackCard(
    name: String,
    singer: String,
    isRadioTrack: Boolean,
    onLike: () -> Unit,
    onDislike: () -> Unit,
) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 6.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(SaltTheme.colors.subBackground)
                .padding(14.dp),
    ) {
        Text(text = name.ifEmpty { "未知曲目" }, color = SaltTheme.colors.text, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
        Text(text = singer, color = SaltTheme.colors.subText, fontSize = 13.sp)
        if (!isRadioTrack) {
            Text(
                text = "当前曲不是电台推的（来自其他列表），反馈仍会计入踩雷/画像",
                modifier = Modifier.padding(top = 6.dp),
                color = SaltTheme.colors.subText,
                fontSize = 12.sp,
            )
        }
        Row(
            modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            ActionChip(text = "喜欢", onClick = onLike, modifier = Modifier.weight(1f))
            ActionChip(text = "不感兴趣", onClick = onDislike, modifier = Modifier.weight(1f))
        }
    }
}

@OptIn(UnstableSaltUiApi::class)
@Composable
private fun ActionRow(
    active: Boolean,
    onStart: () -> Unit,
    onStop: () -> Unit,
    onNext: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (active) {
            ActionChip(text = "停止电台", onClick = onStop, modifier = Modifier.weight(1f))
        } else {
            ActionChip(text = "开始电台", onClick = onStart, modifier = Modifier.weight(1f))
        }
        ActionChip(text = "下一首", onClick = onNext, modifier = Modifier.weight(1f))
    }
}

@OptIn(UnstableSaltUiApi::class)
@Composable
private fun ActionChip(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier =
            modifier
                .clip(RoundedCornerShape(10.dp))
                .background(SaltTheme.colors.highlight.copy(alpha = 0.12f))
                .clickable(onClick = onClick)
                .padding(vertical = 11.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text = text, color = SaltTheme.colors.highlight, fontSize = 14.sp, fontWeight = FontWeight.Medium)
    }
}

@OptIn(UnstableSaltUiApi::class)
@Composable
private fun Hint(text: String) {
    Text(
        text = text,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        color = SaltTheme.colors.subText,
        fontSize = 12.sp,
    )
}

private fun errorText(raw: String): String =
    when (raw) {
        "no_candidates" -> "没有取到可用候选（音源不可用或全部被排除）"
        "radio_starting" -> "上一次开播还没结束"
        else -> raw
    }

private fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content
