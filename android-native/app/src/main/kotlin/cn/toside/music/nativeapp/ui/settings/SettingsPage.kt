package cn.toside.music.nativeapp.ui.settings

import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.isSystemInDarkTheme
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
import cn.toside.music.core.local.LocalFallbackConfirm
import cn.toside.music.core.theme.ActiveThemes
import cn.toside.music.nativeapp.cache.AppCache
import cn.toside.music.nativeapp.data.SettingsRuntime
import cn.toside.music.nativeapp.player.PlayerRuntime
import cn.toside.music.nativeapp.util.SystemSettings
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
import com.moriafly.salt.ui.dialog.YesNoDialog
import com.moriafly.salt.ui.screen.BasicScreen
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** 可选音质（对齐 RN deeplink utils.qualitys 的四档）。 */
private val QUALITY_OPTIONS = listOf("128k", "320k", "flac", "flac24bit")

private val VOLUME_LEVEL_OPTIONS = listOf("low" to "轻", "mid" to "中", "high" to "强")

private enum class SettingsSubPage {
    THEME,
    USER_API,
    LOGS,
    BACKGROUND_PLAY,
}

/**
 * 设置页：播放、音源、列表、存储与系统。
 *
 * 所有开关都写入 [SettingsStore]（与 PlayerRuntime 共用同一份设置事实来源），
 * 音量均衡额外调用运行时立即重挂音效；歌词开关只重新解析已有歌词，不重新下载。
 * 音源管理和音源日志是本页的两个子页，用本地状态整页切换 ——
 * 全局导航栈（MusicApp/NavStack）不在本车道范围内。
 */
@Composable
fun SettingsPage(onBack: () -> Unit) {
    var subPage by remember { mutableStateOf<SettingsSubPage?>(null) }
    // 子页开着的时候，系统返回键先退回设置首页，而不是把整个设置关掉
    BackHandler(enabled = subPage != null) { subPage = null }
    when (subPage) {
        null ->
            SettingsContent(
                onBack = onBack,
                onOpenTheme = { subPage = SettingsSubPage.THEME },
                onOpenUserApi = { subPage = SettingsSubPage.USER_API },
                onOpenLogs = { subPage = SettingsSubPage.LOGS },
                onOpenBackgroundHelp = { subPage = SettingsSubPage.BACKGROUND_PLAY },
            )
        SettingsSubPage.THEME -> ThemeSettingsPage(onBack = { subPage = null })
        SettingsSubPage.USER_API -> UserApiManagePage(onBack = { subPage = null })
        SettingsSubPage.LOGS -> UserApiLogsPage(onBack = { subPage = null })
        SettingsSubPage.BACKGROUND_PLAY -> BackgroundPlayHelpPage(onBack = { subPage = null })
    }
}

@OptIn(UnstableSaltUiApi::class)
@Composable
private fun SettingsContent(
    onBack: () -> Unit,
    onOpenTheme: () -> Unit,
    onOpenUserApi: () -> Unit,
    onOpenLogs: () -> Unit,
    onOpenBackgroundHelp: () -> Unit,
) {
    val context = LocalContext.current
    val runtime = remember { PlayerRuntime.get(context) }
    val settings by runtime.settings.state.collectAsState()
    val scope = rememberCoroutineScope()
    val systemDark = isSystemInDarkTheme()

    var qualityPicker by remember { mutableStateOf(false) }
    var levelPicker by remember { mutableStateOf(false) }
    var locationPicker by remember { mutableStateOf(false) }
    var checkPicker by remember { mutableStateOf(false) }
    var clearCacheVisible by remember { mutableStateOf(false) }
    var cacheSize by remember { mutableStateOf<String?>(null) }
    // 电池优化/通知这两项由系统页面决定，回到本页时把计数加一，状态才会重新读一次
    var systemTick by remember { mutableStateOf(0) }
    val ignoringBattery = remember(systemTick) { SystemSettings.isIgnoringBatteryOptimization(context) }
    val notificationsOn = remember(systemTick) { SystemSettings.isNotificationsEnabled(context) }

    val quality = settings["player.playQuality"] as? String ?: "128k"
    val translation = settings["player.isShowLyricTranslation"] as? Boolean ?: false
    val roma = settings["player.isShowLyricRoma"] as? Boolean ?: false
    val balancer = settings["player.isEnableVolumeBalancer"] as? Boolean ?: false
    val level = settings["player.volumeBalancerLevel"] as? String ?: "mid"
    val location = settings["list.addMusicLocationType"] as? String ?: "top"
    val savePlayTime = settings["player.isSavePlayTime"] as? Boolean ?: false
    val updateCheck = settings["common.userApiUpdateCheck"] as? String ?: "daily"
    val autoUpdate = settings["common.userApiAutoUpdate"] as? Boolean ?: true
    val allowAlert = settings["common.userApiAllowShowUpdateAlert"] as? Boolean ?: false
    val themeId = settings["theme.id"] as? String
    val autoTheme = settings["common.isAutoTheme"] as? Boolean ?: false
    val hideBgDark = settings["theme.hideBgDark"] as? Boolean ?: false
    val fallbackConfirm = settings[LocalFallbackConfirm.SETTING_KEY] as? Boolean ?: true
    val activeThemeName =
        remember(themeId, autoTheme, hideBgDark, systemDark) {
            ActiveThemes.active(themeId, autoTheme, systemDark, hideBgDark).name
        }

    // 滑杆拖动时先记在本地，松手才落库：一边拖一边写存储会写出一串没用的中间值
    val storedVolume = ((settings["player.volume"] as? Number)?.toDouble() ?: 1.0).toFloat()
    val storedRate = ((settings["player.playbackRate"] as? Number)?.toDouble() ?: 1.0).toFloat()
    var volumeDraft by remember { mutableStateOf<Float?>(null) }
    var rateDraft by remember { mutableStateOf<Float?>(null) }
    val volume = volumeDraft ?: storedVolume
    val rate = rateDraft ?: storedRate

    LaunchedEffect(Unit) { runtime.settings.ensureLoaded() }
    LaunchedEffect(Unit) {
        // 数文件要跑磁盘，别在组合线程上做
        cacheSize = withContext(Dispatchers.IO) { formatCacheSize(AppCache.getAppCacheSize(context)) }
    }
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
            Text(text = "外观", color = SaltTheme.colors.subText, modifier = Modifier.padding(horizontal = 16.dp))
            Item(
                onClick = onOpenTheme,
                text = "主题",
                tag = activeThemeName,
                arrowType = ItemArrowType.Arrow,
            )
            ItemSpacer()
            Text(text = "播放", color = SaltTheme.colors.subText, modifier = Modifier.padding(horizontal = 16.dp))
            Item(
                onClick = { qualityPicker = true },
                text = "优先播放的音质",
                tag = qualityLabel(quality),
            )
            ItemSlider(
                value = volume,
                onValueChange = { volumeDraft = it },
                onValueChangeFinished = {
                    val picked = volumeDraft ?: return@ItemSlider
                    volumeDraft = null
                    scope.launch {
                        runtime.settings.store.set("player.volume", picked.toDouble())
                        runtime.setVolume(picked)
                    }
                },
                text = "音量大小",
                sub = formatVolumePercent(volume.toDouble()),
            )
            ItemSlider(
                value = (rate - MIN_PLAYBACK_RATE) / (MAX_PLAYBACK_RATE - MIN_PLAYBACK_RATE),
                onValueChange = { slide -> rateDraft = MIN_PLAYBACK_RATE + slide * (MAX_PLAYBACK_RATE - MIN_PLAYBACK_RATE) },
                onValueChangeFinished = {
                    val picked = rateDraft ?: return@ItemSlider
                    rateDraft = null
                    scope.launch {
                        runtime.settings.store.set("player.playbackRate", picked.toDouble())
                        runtime.setRate(picked)
                    }
                },
                text = "播放倍速",
                sub = formatPlaybackRate(rate.toDouble()),
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
                state = savePlayTime,
                onChange = { save ->
                    scope.launch { runtime.settings.store.set("player.isSavePlayTime", save) }
                },
                text = "记住播放进度",
                sub = "换回这首歌时从上次停下的位置继续",
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
            DesktopLyricSettingsSection(runtime)
            Item(
                onClick = onOpenBackgroundHelp,
                text = "后台播放帮助",
                sub = "锁屏后音乐/桌面歌词被清掉？按厂商指引打开白名单",
                arrowType = ItemArrowType.Arrow,
            )
            ItemSpacer()
            Text(text = "音源", color = SaltTheme.colors.subText, modifier = Modifier.padding(horizontal = 16.dp))
            Item(
                onClick = onOpenUserApi,
                text = "自定义源管理",
                arrowType = ItemArrowType.Arrow,
            )
            Item(
                onClick = { checkPicker = true },
                text = "音源更新检查",
                tag = userApiUpdateCheckLabel(updateCheck),
            )
            Text(
                text =
                    "「自动更新源」打开时，按上面的频率检查所有有更新地址的音源：找到新版本就替你换上，" +
                        "换上之后要是有问题会自动退回原来的版本。",
                color = SaltTheme.colors.subText,
                modifier = Modifier.padding(horizontal = 16.dp),
            )
            ItemSwitcher(
                state = autoUpdate,
                onChange = { enable ->
                    scope.launch { runtime.settings.store.set("common.userApiAutoUpdate", enable) }
                },
                text = "自动更新源",
            )
            ItemSwitcher(
                state = allowAlert,
                onChange = { enable ->
                    scope.launch { runtime.settings.store.set("common.userApiAllowShowUpdateAlert", enable) }
                },
                text = "允许显示更新弹窗",
                sub = "关掉时新版本直接换上，不再先问一次",
            )
            Item(
                onClick = onOpenLogs,
                text = "音源日志",
                arrowType = ItemArrowType.Arrow,
            )
            ItemSpacer()
            Text(text = "列表", color = SaltTheme.colors.subText, modifier = Modifier.padding(horizontal = 16.dp))
            Item(
                onClick = { locationPicker = true },
                text = "添加歌曲到列表时的位置",
                tag = if (location == "bottom") "底部" else "顶部",
            )
            ItemSpacer()
            Text(text = "本地曲库", color = SaltTheme.colors.subText, modifier = Modifier.padding(horizontal = 16.dp))
            ItemSwitcher(
                state = fallbackConfirm,
                onChange = { enable ->
                    scope.launch { runtime.settings.store.set(LocalFallbackConfirm.SETTING_KEY, enable) }
                },
                text = "在线兜底前先让我确认",
                sub = "本地歌曲找不到时，同名但不同歌手的候选先问你一句",
            )
            ItemSpacer()
            Text(text = "存储与系统", color = SaltTheme.colors.subText, modifier = Modifier.padding(horizontal = 16.dp))
            Item(
                onClick = {
                    cacheSize = null
                    scope.launch {
                        cacheSize =
                            withContext(Dispatchers.IO) {
                                formatCacheSize(AppCache.getAppCacheSize(context))
                            }
                    }
                },
                text = "已用缓存",
                tag = cacheSize ?: "统计缓存中...",
            )
            Item(
                onClick = { clearCacheVisible = true },
                text = "清理缓存",
                sub = "只清临时缓存，不动收藏、歌单和已下载的脚本",
                arrowType = ItemArrowType.None,
            )
            Item(
                onClick = {
                    if (!SystemSettings.requestIgnoreBatteryOptimization(context)) {
                        Toast.makeText(context, "这台设备的系统没有这个设置页", Toast.LENGTH_SHORT).show()
                    }
                    systemTick++
                },
                text = "电池优化",
                tag = if (ignoringBattery) "已允许" else "未允许",
            )
            Item(
                onClick = {
                    if (!SystemSettings.openNotificationSettings(context)) {
                        Toast.makeText(context, "这台设备的系统没有这个设置页", Toast.LENGTH_SHORT).show()
                    }
                    systemTick++
                },
                text = "通知权限",
                tag = if (notificationsOn) "已开启" else "未开启",
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
    if (checkPicker) {
        ChoiceDialog(
            title = "音源更新检查",
            selected = updateCheck,
            options = USER_API_UPDATE_CHECK_OPTIONS,
            onDismiss = { checkPicker = false },
            onPick = { value ->
                checkPicker = false
                scope.launch { runtime.settings.store.set("common.userApiUpdateCheck", value) }
            },
        )
    }
    if (clearCacheVisible) {
        YesNoDialog(
            onDismissRequest = { clearCacheVisible = false },
            onConfirm = {
                clearCacheVisible = false
                scope.launch {
                    withContext(Dispatchers.IO) { AppCache.clearAppCache(context) }
                    cacheSize = withContext(Dispatchers.IO) { formatCacheSize(AppCache.getAppCacheSize(context)) }
                    Toast.makeText(context, "缓存清理完成", Toast.LENGTH_SHORT).show()
                }
            },
            title = "清理缓存",
            content = "确定要清理缓存吗？若没有歌曲播放相关的问题，一般不必清理。",
            cancelText = "取消",
            confirmText = "清理",
        )
    }
}

/**
 * 倍速滑杆的实际范围（对照 RN 播放页弹层的 50%~200%）；
 * [ItemSlider] 只吃 0..1 的槽位，所以界面里做一次换算。
 */
private const val MIN_PLAYBACK_RATE = 0.5f
private const val MAX_PLAYBACK_RATE = 2.0f

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
