package cn.toside.music.nativeapp.ui.settings

import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import cn.toside.music.nativeapp.data.SettingsRuntime
import cn.toside.music.nativeapp.player.PlayerRuntime
import com.moriafly.salt.ui.Item
import com.moriafly.salt.ui.ItemArrowType
import com.moriafly.salt.ui.ItemSpacer
import com.moriafly.salt.ui.ItemSwitcher
import com.moriafly.salt.ui.SaltTheme
import com.moriafly.salt.ui.Text
import com.moriafly.salt.ui.UnstableSaltUiApi
import com.moriafly.salt.ui.dialog.BasicDialog
import com.moriafly.salt.ui.dialog.DialogTitle
import com.moriafly.salt.ui.screen.BasicScreen
import kotlinx.coroutines.launch

/** 可选音质（对齐 RN deeplink utils.qualitys 的四档）。 */
private val QUALITY_OPTIONS = listOf("128k", "320k", "flac", "flac24bit")

private val VOLUME_LEVEL_OPTIONS = listOf("low" to "轻", "mid" to "中", "high" to "强")

/**
 * 设置页（B5 第四切片）：音质、歌词翻译/音译、音量均衡、加歌位置。
 *
 * 所有开关都写入 SettingsStore（与 PlayerRuntime 共用同一份设置事实来源），
 * 音量均衡额外调用运行时立即重挂音效；歌词开关只重新解析已有歌词，不重新下载。
 */
@OptIn(UnstableSaltUiApi::class)
@Composable
fun SettingsPage(onBack: () -> Unit) {
    val context = LocalContext.current
    val runtime = remember { PlayerRuntime.get(context) }
    val settings by runtime.settings.state.collectAsState()
    val scope = rememberCoroutineScope()

    var qualityPicker by remember { mutableStateOf(false) }
    var levelPicker by remember { mutableStateOf(false) }
    var locationPicker by remember { mutableStateOf(false) }

    val quality = settings["player.playQuality"] as? String ?: "128k"
    val translation = settings["player.isShowLyricTranslation"] as? Boolean ?: false
    val roma = settings["player.isShowLyricRoma"] as? Boolean ?: false
    val balancer = settings["player.isEnableVolumeBalancer"] as? Boolean ?: false
    val level = settings["player.volumeBalancerLevel"] as? String ?: "mid"
    val location = settings["list.addMusicLocationType"] as? String ?: "top"

    LaunchedEffect(Unit) { runtime.settings.ensureLoaded() }
    DisposableEffect(runtime) {
        runtime.onVolumeBalancerFailed = {
            Toast.makeText(context, "当前设备不支持音量均衡，请完全重启应用后再试", Toast.LENGTH_LONG).show()
        }
        onDispose { runtime.onVolumeBalancerFailed = null }
    }

    BasicScreen(onBack = onBack, title = "设置") { padding ->
        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(padding),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            ItemSpacer()
            Text(text = "播放", color = SaltTheme.colors.subText, modifier = Modifier.padding(horizontal = 16.dp))
            Item(
                onClick = { qualityPicker = true },
                text = "优先播放的音质",
                tag = qualityLabel(quality),
            )
            ItemSwitcher(
                state = translation,
                onChange = { show ->
                    runtime.setLyricTranslation(show)
                },
                text = "显示歌词翻译（如果可用）",
            )
            ItemSwitcher(
                state = roma,
                onChange = { show ->
                    runtime.setLyricRoma(show)
                },
                text = "显示歌词罗马音（如果可用）",
            )
            ItemSwitcher(
                state = balancer,
                onChange = { enabled ->
                    scope.launch {
                        runtime.settings.store.set("player.isEnableVolumeBalancer", enabled)
                        runtime.setVolumeBalancer(
                            enabled,
                            SettingsRuntime.volumeBalancerLevelIndex(level),
                        )
                    }
                },
                text = "音量均衡",
                sub = "压低偏响的歌曲，缩小切歌时的音量差异",
            )
            if (balancer) {
                Item(
                    onClick = { levelPicker = true },
                    text = "均衡强度",
                    tag = VOLUME_LEVEL_OPTIONS.firstOrNull { it.first == level }?.second ?: "中",
                )
            }
            ItemSpacer()
            Text(text = "列表", color = SaltTheme.colors.subText, modifier = Modifier.padding(horizontal = 16.dp))
            Item(
                onClick = { locationPicker = true },
                text = "添加歌曲到列表时的位置",
                tag = if (location == "bottom") "底部" else "顶部",
            )
            ItemSpacer()
        }
    }

    if (qualityPicker) {
        ChoiceDialog(
            title = "优先播放的音质",
            selected = quality,
            options = QUALITY_OPTIONS.map { it to qualityLabel(it) },
            onDismiss = { qualityPicker = false },
            onPick = { value ->
                qualityPicker = false
                scope.launch { runtime.settings.store.set("player.playQuality", value) }
            },
        )
    }
    if (levelPicker) {
        ChoiceDialog(
            title = "均衡强度",
            selected = level,
            options = VOLUME_LEVEL_OPTIONS,
            onDismiss = { levelPicker = false },
            onPick = { value ->
                levelPicker = false
                scope.launch {
                    runtime.settings.store.set("player.volumeBalancerLevel", value)
                    runtime.setVolumeBalancer(
                        true,
                        SettingsRuntime.volumeBalancerLevelIndex(value),
                    )
                }
            },
        )
    }
    if (locationPicker) {
        ChoiceDialog(
            title = "添加歌曲到列表时的位置",
            selected = location,
            options = listOf("top" to "顶部", "bottom" to "底部"),
            onDismiss = { locationPicker = false },
            onPick = { value ->
                locationPicker = false
                scope.launch { runtime.settings.store.set("list.addMusicLocationType", value) }
            },
        )
    }
}

@OptIn(UnstableSaltUiApi::class)
@Composable
private fun ChoiceDialog(
    title: String,
    selected: String,
    options: List<Pair<String, String>>,
    onDismiss: () -> Unit,
    onPick: (String) -> Unit,
) {
    BasicDialog(onDismissRequest = onDismiss) {
        DialogTitle(text = title)
        options.forEach { (value, label) ->
            Item(
                onClick = { onPick(value) },
                text = label,
                tag = if (value == selected) "已选" else null,
                arrowType = ItemArrowType.None,
            )
        }
    }
}

private fun qualityLabel(quality: String): String =
    when (quality) {
        "128k" -> "标准 128k"
        "320k" -> "高清 320k"
        "flac" -> "无损 FLAC"
        "flac24bit" -> "Hi-Res 24bit"
        else -> quality
    }
