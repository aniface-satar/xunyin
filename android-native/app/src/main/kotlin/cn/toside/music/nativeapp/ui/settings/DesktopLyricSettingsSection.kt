package cn.toside.music.nativeapp.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import cn.toside.music.core.lyric.DesktopLyricColor
import cn.toside.music.nativeapp.lyric.DesktopLyricRow
import cn.toside.music.nativeapp.player.PlayerRuntime
import com.moriafly.salt.ui.Item
import com.moriafly.salt.ui.ItemArrowType
import com.moriafly.salt.ui.ItemSlider
import com.moriafly.salt.ui.ItemSpacer
import com.moriafly.salt.ui.ItemSwitcher
import com.moriafly.salt.ui.SaltTheme
import com.moriafly.salt.ui.Text
import com.moriafly.salt.ui.UnstableSaltUiApi
import com.moriafly.salt.ui.dialog.BasicDialog
import com.moriafly.salt.ui.dialog.DialogTitle
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/**
 * 设置页的「桌面歌词」小节 —— 逐键对照 RN
 * `src/screens/Home/Views/Setting/settings/LyricDesktop/`：
 *
 * - 开关行复用播放页同一个 [DesktopLyricRow]（同一个 [cn.toside.music.nativeapp.lyric.DesktopLyricController]）；
 * - 锁定/切换动画/单行是布尔键；
 * - 主题只写 `lyricPlayedColor` + `lyricShadowColor`，与 RN `Theme.tsx` 的九套预设一致；
 * - 字号/宽度/最大行数/透明度对应 RN 四个滑杆的区间与步长
 *   （100~500 步长 2、10~100 步长 1、1~8 步长 1、10~100 步长 2）；
 * - 文字水平/垂直对齐对应 RN 的三选一。
 *
 * 写库后用设置流的实时刷新驱动浮窗重配（[cn.toside.music.nativeapp.lyric.DesktopLyricService]
 * 订阅了 `SettingsStore.state`），锁定态因此不需要重启服务。
 */
@OptIn(UnstableSaltUiApi::class)
@Composable
internal fun DesktopLyricSettingsSection(runtime: PlayerRuntime) {
    val settings by runtime.settings.state.collectAsState()
    val scope = rememberCoroutineScope()

    fun save(
        key: String,
        value: Any,
    ) {
        scope.launch { runtime.settings.store.set(key, value) }
    }

    val locked = settings[KEY_LOCK] as? Boolean ?: false
    val showToggleAnima = settings[KEY_TOGGLE_ANIMA] as? Boolean ?: true
    val singleLine = settings[KEY_SINGLE_LINE] as? Boolean ?: false
    // W7 新增：桌面歌词独立的译文/罗马音开关（RN 没有这两键，桌面扩展行原本无条件显示）
    val showTranslation = settings[KEY_SHOW_TRANSLATION] as? Boolean ?: true
    val showRoma = settings[KEY_SHOW_ROMA] as? Boolean ?: true
    val playedColor = settings[KEY_PLAYED_COLOR] as? String ?: DEFAULT_PLAYED_COLOR
    val fontSize = (settings[KEY_FONT_SIZE] as? Number)?.toInt() ?: 180
    val width = (settings[KEY_WIDTH] as? Number)?.toInt() ?: 100
    val maxLineNum = (settings[KEY_MAX_LINE] as? Number)?.toInt() ?: 5
    val opacity = (settings[KEY_OPACITY] as? Number)?.toInt() ?: 100
    val textX = settings[KEY_TEXT_X] as? String ?: "left"
    val textY = settings[KEY_TEXT_Y] as? String ?: "top"

    var fontDraft by remember { mutableStateOf<Int?>(null) }
    var widthDraft by remember { mutableStateOf<Int?>(null) }
    var lineDraft by remember { mutableStateOf<Int?>(null) }
    var opacityDraft by remember { mutableStateOf<Int?>(null) }
    var textXPicker by remember { mutableStateOf(false) }
    var textYPicker by remember { mutableStateOf(false) }

    ItemSpacer()
    Text(
        text = "桌面歌词",
        color = SaltTheme.colors.subText,
        modifier = Modifier.padding(horizontal = 16.dp),
    )
    DesktopLyricRow()
    ItemSwitcher(
        state = locked,
        onChange = { save(KEY_LOCK, it) },
        text = "锁定桌面歌词",
        sub = "锁定后浮窗不响应触摸，避免误拖",
    )
    ItemSwitcher(
        state = showToggleAnima,
        onChange = { save(KEY_TOGGLE_ANIMA, it) },
        text = "切换歌词时的动画",
    )
    ItemSwitcher(
        state = singleLine,
        onChange = { save(KEY_SINGLE_LINE, it) },
        text = "单行模式",
        sub = "只显示当前一句，过长时横向滚动",
    )
    ItemSwitcher(
        state = showTranslation,
        onChange = { save(KEY_SHOW_TRANSLATION, it) },
        text = "显示翻译",
        sub = "只管桌面歌词，不影响播放页的译文开关",
    )
    ItemSwitcher(
        state = showRoma,
        onChange = { save(KEY_SHOW_ROMA, it) },
        text = "显示罗马音",
        sub = "只管桌面歌词，不影响播放页的罗马音开关",
    )
    Text(
        text = "颜色",
        color = SaltTheme.colors.subText,
        modifier = Modifier.padding(horizontal = 16.dp),
    )
    LyricThemeRow(
        selected = playedColor,
        onPick = { theme ->
            save(KEY_PLAYED_COLOR, theme.played)
            save(KEY_SHADOW_COLOR, theme.shadow)
        },
    )
    LyricSlider(
        text = "字号",
        value = fontDraft ?: fontSize,
        min = 100,
        max = 500,
        step = 2,
        onDraft = { fontDraft = it },
        onCommit = { save(KEY_FONT_SIZE, it) },
    )
    LyricSlider(
        text = "宽度（屏幕百分比）",
        value = widthDraft ?: width,
        min = 10,
        max = 100,
        step = 1,
        onDraft = { widthDraft = it },
        onCommit = { save(KEY_WIDTH, it) },
    )
    LyricSlider(
        text = "最大行数",
        value = lineDraft ?: maxLineNum,
        min = 1,
        max = 8,
        step = 1,
        onDraft = { lineDraft = it },
        onCommit = { save(KEY_MAX_LINE, it) },
    )
    LyricSlider(
        text = "文字不透明度",
        value = opacityDraft ?: opacity,
        min = 10,
        max = 100,
        step = 2,
        onDraft = { opacityDraft = it },
        onCommit = { save(KEY_OPACITY, it) },
    )
    Item(
        onClick = { textXPicker = true },
        text = "文字水平对齐",
        tag = TEXT_X.firstOrNull { it.first == textX }?.second ?: "左对齐",
    )
    Item(
        onClick = { textYPicker = true },
        text = "文字垂直对齐",
        tag = TEXT_Y.firstOrNull { it.first == textY }?.second ?: "顶部",
    )

    if (textXPicker) {
        LyricChoiceDialog(
            title = "文字水平对齐",
            selected = textX,
            options = TEXT_X,
            onDismiss = { textXPicker = false },
            onPick = {
                textXPicker = false
                save(KEY_TEXT_X, it)
            },
        )
    }
    if (textYPicker) {
        LyricChoiceDialog(
            title = "文字垂直对齐",
            selected = textY,
            options = TEXT_Y,
            onDismiss = { textYPicker = false },
            onPick = {
                textYPicker = false
                save(KEY_TEXT_Y, it)
            },
        )
    }
}

/**
 * 一个带草稿的整数滑杆：拖动时只改本地草稿，松手才落库，
 * 避免一边拖一边把一串中间值写进设置存储。
 */
@OptIn(UnstableSaltUiApi::class)
@Composable
private fun LyricSlider(
    text: String,
    value: Int,
    min: Int,
    max: Int,
    step: Int,
    onDraft: (Int?) -> Unit,
    onCommit: (Int) -> Unit,
) {
    fun quantize(raw: Float): Int {
        val snapped = min + (((raw * (max - min)) / step).roundToInt() * step)
        return snapped.coerceIn(min, max)
    }
    ItemSlider(
        value = (value - min).toFloat() / (max - min),
        onValueChange = { onDraft(quantize(it)) },
        onValueChangeFinished = {
            onDraft(null)
            onCommit(value)
        },
        text = text,
        sub = value.toString(),
    )
}

@OptIn(UnstableSaltUiApi::class)
@Composable
private fun LyricThemeRow(
    selected: String,
    onPick: (LyricTheme) -> Unit,
) {
    Row(
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        for (theme in LYRIC_THEMES) {
            val color = remember(theme.played) { Color(DesktopLyricColor.parse(theme.played)) }
            val active = theme.played == selected
            val borderModifier =
                if (active) {
                    Modifier.border(2.dp, SaltTheme.colors.highlight, RoundedCornerShape(4.dp))
                } else {
                    Modifier
                }
            Box(
                modifier =
                    Modifier
                        .size(26.dp)
                        .clip(RoundedCornerShape(4.dp))
                        .background(color)
                        .clickable { onPick(theme) }
                        .then(borderModifier),
            )
        }
    }
}

@OptIn(UnstableSaltUiApi::class)
@Composable
private fun LyricChoiceDialog(
    title: String,
    selected: String,
    options: List<Pair<String, String>>,
    onDismiss: () -> Unit,
    onPick: (String) -> Unit,
) {
    BasicDialog(onDismissRequest = onDismiss) {
        DialogTitle(text = title)
        for ((value, label) in options) {
            Item(
                onClick = { onPick(value) },
                text = label,
                tag = if (value == selected) "已选" else null,
                arrowType = ItemArrowType.None,
            )
        }
    }
}

private data class LyricTheme(
    val played: String,
    val shadow: String,
)

/** RN `Theme.tsx` 的九套预设（播放色 + 阴影色）。 */
private val LYRIC_THEMES =
    listOf(
        LyricTheme("#08e664", "rgba(0,0,0,0.6)"),
        LyricTheme("#fffa12", "rgba(0,0,0,0.6)"),
        LyricTheme("#019ce4", "rgba(0,0,0,0.6)"),
        LyricTheme("#ff1222", "rgba(0,0,0,0.6)"),
        LyricTheme("#ef6976", "rgba(0,0,0,0.6)"),
        LyricTheme("#c851d4", "rgba(0,0,0,0.6)"),
        LyricTheme("#ffa600", "rgba(0,0,0,0.6)"),
        LyricTheme("#000000", "#ffffff"),
        LyricTheme("#ffffff", "rgba(0,0,0,0.6)"),
    )

private val TEXT_X =
    listOf(
        "left" to "左对齐",
        "center" to "居中",
        "right" to "右对齐",
    )

private val TEXT_Y =
    listOf(
        "top" to "顶部",
        "center" to "居中",
        "bottom" to "底部",
    )

private const val KEY_LOCK = "desktopLyric.isLock"
private const val KEY_TOGGLE_ANIMA = "desktopLyric.showToggleAnima"
private const val KEY_SINGLE_LINE = "desktopLyric.isSingleLine"
private const val KEY_SHOW_TRANSLATION = "desktopLyric.isShowTranslation"
private const val KEY_SHOW_ROMA = "desktopLyric.isShowRoma"
private const val KEY_WIDTH = "desktopLyric.width"
private const val KEY_MAX_LINE = "desktopLyric.maxLineNum"
private const val KEY_FONT_SIZE = "desktopLyric.style.fontSize"
private const val KEY_OPACITY = "desktopLyric.style.opacity"
private const val KEY_PLAYED_COLOR = "desktopLyric.style.lyricPlayedColor"
private const val KEY_SHADOW_COLOR = "desktopLyric.style.lyricShadowColor"
private const val KEY_TEXT_X = "desktopLyric.textPosition.x"
private const val KEY_TEXT_Y = "desktopLyric.textPosition.y"
private const val DEFAULT_PLAYED_COLOR = "rgba(7, 197, 86, 1)"
