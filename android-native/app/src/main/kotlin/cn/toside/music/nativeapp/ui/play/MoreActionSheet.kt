package cn.toside.music.nativeapp.ui.play

import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cn.toside.music.core.player.SleepTimer
import cn.toside.music.nativeapp.lyric.DesktopLyricRow
import cn.toside.music.nativeapp.player.PlayerRuntime
import cn.toside.music.nativeapp.ui.share.ShareCardOverlay
import com.moriafly.salt.ui.Button
import com.moriafly.salt.ui.ButtonAppearance
import com.moriafly.salt.ui.Item
import com.moriafly.salt.ui.ItemSlider
import com.moriafly.salt.ui.ItemSpacer
import com.moriafly.salt.ui.ItemSwitcher
import com.moriafly.salt.ui.UnstableSaltUiApi
import com.moriafly.salt.ui.dialog.InputDialog
import kotlinx.coroutines.launch
import java.util.Locale

/**
 * 播放页 ⋮ 弹层（S11）。
 *
 * 形状沿用本页既有的手写底部面板（见 `PlaylistSheet`）：SaltUI 没有对外暴露
 * Modal/BottomSheet，`Slider` 也是 internal，公开入口只有 `ItemSlider`。
 *
 * 内容对照 RN：RN 播放页的 ⋮（`MusicMoreSheet`）装的是「下一首/不感兴趣/加歌单/换源/下载」，
 * 而音量、播放速率、歌词字号在另一张 `LyricSettingSheet` 里，定时关闭走控制排按钮 +
 * `TimeoutExitEditModal`。任务书要求把后几类收进同一个 ⋮，所以这里是一张合并面板，
 * 差异已记入 lane 报告。
 *
 * 落库时机对照 RN：**音量/倍速拖动即时作用于播放器、松手才写设置，与已存值相同则不写**
 * （`SettingVolume.tsx:24-33`、`SettingPlaybackRate.tsx:30-42`）；
 * **歌词字号拖动不预览**，因为 RN 的歌词行直接从设置取值（`Vertical/Lyric.tsx:101-103`），
 * 面板里同样只在松手时提交（`SettingLrcFontSize.tsx:27-34`）。
 */
@OptIn(UnstableSaltUiApi::class)
@Composable
fun MoreActionSheet(
    runtime: PlayerRuntime,
    timeout: TimeoutExitRuntime,
    fontSizeTenths: Int,
    onFontSizeCommit: (Int) -> Unit,
    translationShown: Boolean,
    romaShown: Boolean,
    onToggleTranslation: () -> Unit,
    onToggleRoma: () -> Unit,
    onDismiss: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val timeoutStatus by timeout.status.collectAsState()
    var showTimeout by remember { mutableStateOf(false) }
    var showShare by remember { mutableStateOf(false) }

    // RN 的滑杆数值空间是整数（音量/倍速按百分比、字号按 ×10），这里保持同一空间再换算
    var volumePercent by remember { mutableFloatStateOf(storedVolumePercent(runtime).toFloat()) }
    var ratePercent by remember { mutableFloatStateOf(storedRatePercent(runtime).toFloat()) }
    var fontTenths by remember { mutableFloatStateOf(fontSizeTenths.toFloat()) }

    SheetScaffold(title = "播放器设置", onDismiss = onDismiss) {
        Item(
            onClick = { showTimeout = true },
            text = "定时关闭",
            sub = timeoutStatus.statusText,
        )
        Item(
            onClick = { showShare = true },
            text = "分享",
        )
        ItemSpacer()
        ItemSlider(
            value = volumePercent,
            onValueChange = { raw ->
                // RN SettingVolume.tsx:24-27 拖动中即 setVolume(value / 100)
                val percent = clampedPercent(raw, 0, 100)
                volumePercent = percent.toFloat()
                scope.launch { runtime.setVolume(percent / 100f) }
            },
            onValueChangeFinished = {
                val percent = volumePercent.toInt()
                if (storedVolumePercent(runtime) != percent) {
                    scope.launch {
                        runtime.settings.ensureLoaded()
                        runtime.settings.store.set("player.volume", percent / 100.0)
                    }
                }
            },
            text = "音量大小",
            sub = volumePercent.toInt().toString(),
            valueRange = 0f..100f,
            steps = 99,
        )
        ItemSlider(
            value = ratePercent,
            onValueChange = { raw ->
                // RN SettingPlaybackRate.tsx:30-34 拖动中即 setPlaybackRate
                val percent = clampedPercent(raw, MIN_RATE, MAX_RATE)
                ratePercent = percent.toFloat()
                scope.launch { runtime.setRate(percent / 100f) }
            },
            onValueChangeFinished = {
                val percent = ratePercent.toInt()
                if (storedRatePercent(runtime) != percent) {
                    scope.launch {
                        runtime.settings.ensureLoaded()
                        runtime.settings.store.set("player.playbackRate", percent / 100.0)
                    }
                }
            },
            text = "播放速率",
            sub = String.format(Locale.US, "%.2fx", ratePercent / 100.0),
            valueRange = MIN_RATE.toFloat()..MAX_RATE.toFloat(),
            steps = MAX_RATE - MIN_RATE - 1,
        )
        Button(
            onClick = {
                // RN SettingPlaybackRate.tsx:44-52：已是 1 倍速时什么都不做
                if (storedRatePercent(runtime) != 100) {
                    ratePercent = 100f
                    scope.launch {
                        runtime.setRate(1f)
                        runtime.settings.ensureLoaded()
                        runtime.settings.store.set("player.playbackRate", 1.0)
                    }
                }
            },
            text = "重置",
            appearance = ButtonAppearance.Plain,
        )
        ItemSpacer()
        ItemSlider(
            value = fontTenths,
            onValueChange = { raw ->
                // RN SettingLrcFontSize.tsx:24-26：拖动中只动标签，不碰歌词渲染
                fontTenths = clampedPercent(raw, MIN_FONT_TENTHS, MAX_FONT_TENTHS).toFloat()
            },
            onValueChangeFinished = {
                val tenths = fontTenths.toInt()
                // RN SettingLrcFontSize.tsx:31-33：与已存值相同则不写设置
                if (tenths != fontSizeTenths) onFontSizeCommit(tenths)
            },
            text = "歌词字体大小",
            sub = fontTenths.toInt().toString(),
            valueRange = MIN_FONT_TENTHS.toFloat()..MAX_FONT_TENTHS.toFloat(),
            steps = (MAX_FONT_TENTHS - MIN_FONT_TENTHS) / 2 - 1,
        )
        ItemSpacer()
        ItemSwitcher(
            state = translationShown,
            onChange = { onToggleTranslation() },
            text = "显示歌词翻译（如果可用）",
        )
        ItemSwitcher(
            state = romaShown,
            onChange = { onToggleRoma() },
            text = "显示歌词罗马音（如果可用）",
        )
        DesktopLyricRow()
        ItemSpacer()
        // 只读展示当前音质；切换仍走设置页（Lane B 范围）
        ReadOnlyRow(label = "当前音质", value = qualityLabel(runtime.playQuality()))
    }

    if (showTimeout) {
        TimeoutExitSheet(timeout = timeout, onDismiss = { showTimeout = false })
    }

    if (showShare) {
        // 全屏层叠在设置面板之上：关掉分享卡回到面板，与 RN 从播放页直接开卡等价
        ShareCardOverlay(
            runtime = runtime,
            fontSizeTenths = fontSizeTenths,
            onDismiss = { showShare = false },
        )
    }
}

/**
 * 定时关闭面板（对照 RN `TimeoutExitEditModal.tsx`）：状态行 + 输入分钟 + 「等待播完」开关 +
 * 按 [SleepTimer.ButtonMode] 切换的取消按钮。
 */
@OptIn(UnstableSaltUiApi::class)
@Composable
private fun TimeoutExitSheet(
    timeout: TimeoutExitRuntime,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    var editing by remember { mutableStateOf(false) }
    var minutesText by remember { mutableStateOf(timeout.lastMinutesText) }
    val status by timeout.status.collectAsState()
    var waitSongEnd by remember { mutableStateOf(timeout.waitUntilSongEnd) }

    SheetScaffold(title = "定时停止播放", onDismiss = onDismiss) {
        SheetHint(text = status.statusText)
        if (status.buttonMode == SleepTimer.ButtonMode.WAITING_EXIT) {
            SheetHint(text = "计时已结束，正在等待退出...", dim = true)
        }
        ItemSwitcher(
            state = waitSongEnd,
            onChange = {
                waitSongEnd = it
                timeout.setWaitUntilSongEnd(it)
            },
            text = "等待歌曲播放完毕再停止播放",
        )
        ItemSpacer()
        Item(
            onClick = {
                // RN:157 每次打开都回填设置里的分钟数
                minutesText = timeout.lastMinutesText
                editing = true
            },
            text = if (status.buttonMode == SleepTimer.ButtonMode.COUNTING) "更新定时" else "设置定时",
            sub = if (minutesText.isBlank()) "未设置" else "$minutesText 分钟",
        )
        when (status.buttonMode) {
            SleepTimer.ButtonMode.COUNTING -> {
                ItemSpacer()
                Item(
                    onClick = {
                        timeout.cancel()
                        toast(context, "已取消定时停止播放")
                    },
                    text = "取消定时",
                )
            }
            SleepTimer.ButtonMode.WAITING_EXIT -> {
                ItemSpacer()
                Item(
                    onClick = { timeout.cancelPlayedStop() },
                    text = "取消退出",
                )
            }
            SleepTimer.ButtonMode.OFF -> Unit
        }
    }

    if (editing) {
        InputDialog(
            onDismissRequest = { editing = false },
            onConfirm = {
                when (val parsed = SleepTimer.parseMinutes(minutesText)) {
                    // RN:198 空输入直接 return，不提示、不开始计时
                    SleepTimer.MinutesInput.Empty -> Unit
                    // 文案照抄 RN `input_error`（zh-cn.json:116，原文就带表情）
                    is SleepTimer.MinutesInput.Invalid -> toast(context, "不要乱输好吧😡")
                    is SleepTimer.MinutesInput.TooLong ->
                        toast(context, "最多只能设置 ${SleepTimer.MAX_MINUTES} 分钟哦")
                    is SleepTimer.MinutesInput.Valid -> {
                        timeout.start(parsed.minutes)
                        minutesText = parsed.minutes.toString()
                        editing = false
                        toast(context, "${SleepTimer.formatTime(parsed.minutes * 60)} 后停止播放")
                    }
                }
            },
            onChange = { minutesText = it },
            title = "定时停止播放",
            text = minutesText,
            hint = "输入倒计时分钟数",
            cancelText = "取消",
            confirmText = "确定",
        )
    }
}

/** 弹层外壳：与本页既有的 `PlaylistSheet` 同一形状（SaltUI 未公开 Modal/BottomSheet）。 */
@Composable
private fun SheetScaffold(
    title: String,
    onDismiss: () -> Unit,
    content: @Composable () -> Unit,
) {
    Box(
        Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.45f))
            .clickable(onClick = onDismiss),
    ) {
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
                text = title,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp),
                style = TextStyle(color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.SemiBold),
            )
            Column(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .heightIn(max = 460.dp)
                        .verticalScroll(rememberScrollState())
                        .padding(bottom = 20.dp),
            ) {
                content()
            }
        }
    }
}

@Composable
private fun SheetHint(
    text: String,
    dim: Boolean = false,
) {
    BasicText(
        text = text,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = if (dim) 2.dp else 6.dp),
        style =
            TextStyle(
                color = if (dim) Color.White.copy(alpha = 0.55f) else Color(0xFFE7E3EC),
                fontSize = if (dim) 12.sp else 14.sp,
            ),
    )
}

@Composable
private fun ReadOnlyRow(
    label: String,
    value: String,
) {
    BasicText(
        text = "$label · $value",
        modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 10.dp),
        style = TextStyle(color = Color.White.copy(alpha = 0.75f), fontSize = 14.sp),
    )
}

/** RN `Math.trunc(setting * 100)`（SettingVolume.tsx:16 / SettingPlaybackRate.tsx:22）。 */
private fun storedVolumePercent(runtime: PlayerRuntime): Int =
    (runtime.settings.store.double("player.volume") * 100).toInt().coerceIn(0, 100)

private fun storedRatePercent(runtime: PlayerRuntime): Int =
    (runtime.settings.store.double("player.playbackRate") * 100).toInt().coerceIn(MIN_RATE, MAX_RATE)

/** 滑杆回调按 RN 的方式先截断再夹进区间（RN 用 `Math.trunc(value)` + min/max）。 */
private fun clampedPercent(
    raw: Float,
    min: Int,
    max: Int,
): Int = raw.toInt().coerceIn(min, max)

private fun toast(
    context: Context,
    message: String,
) {
    Toast.makeText(context, message, Toast.LENGTH_SHORT).show()
}

/** 与设置页 `qualityLabel` 同一套中文档位名（那份是 private，这里按同文案复制）。 */
private fun qualityLabel(quality: String): String =
    when (quality) {
        "128k" -> "标准 128k"
        "320k" -> "高清 320k"
        "flac" -> "无损 FLAC"
        "flac24bit" -> "Hi-Res 24bit"
        else -> quality
    }

/** RN `defaultSetting.ts:51`：竖屏歌词字号，设置里存的是 ×10 整数。 */
internal const val KEY_LRC_FONT_SIZE = "playDetail.vertical.style.lrcFontSize"

internal const val DEFAULT_FONT_TENTHS = 210

internal const val MIN_FONT_TENTHS = 100

internal const val MAX_FONT_TENTHS = 300

/**
 * 播放页歌词字号（RN `Vertical/Lyric.tsx:101-103` 就是 `useSettingValue(...) / 10`）：
 * 设置是唯一事实来源，读写都在 ×10 的整数空间里。
 */
internal fun lrcFontSizeTenths(settings: Map<String, Any?>): Int =
    ((settings[KEY_LRC_FONT_SIZE] as? Number)?.toInt() ?: DEFAULT_FONT_TENTHS).coerceIn(MIN_FONT_TENTHS, MAX_FONT_TENTHS)

// RN 滑杆区间：音量 0..100 步进 1；倍速 60..200 步进 1；字号 100..300 步进 2
private const val MIN_RATE = 60

private const val MAX_RATE = 200
