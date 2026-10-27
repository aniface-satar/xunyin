package cn.toside.music.nativeapp.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cn.toside.music.core.theme.ActiveThemes
import cn.toside.music.core.theme.CssColor
import cn.toside.music.core.theme.DefaultThemes
import cn.toside.music.core.theme.Theme
import cn.toside.music.nativeapp.data.SettingsRuntime
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

private val ALGORITHM_OPTIONS = listOf("monet" to "封面取色", "blur" to "模糊封面")

/**
 * 主题设置子页。
 *
 * 选择语义对齐 RN `getTheme`：`theme.id` 是唯一选择；「跟随系统深色」只在系统深色时
 * 强制 black 主题，`theme.lightId/darkId` 在 RN 里是死键，这里不提供入口。
 * 所有开关写入 [SettingsRuntime] 的同一份设置，MusicApp 顶层实时重组换色。
 */
@OptIn(UnstableSaltUiApi::class)
@Composable
fun ThemeSettingsPage(onBack: () -> Unit) {
    val context = LocalContext.current
    val runtime = remember(context) { SettingsRuntime.get(context) }
    val settings by runtime.state.collectAsState()
    val scope = rememberCoroutineScope()
    LaunchedEffect(runtime) { runtime.ensureLoaded() }

    val themes = remember { DefaultThemes.generate() }
    val selectedId = settings["theme.id"] as? String ?: "cyan"
    val autoTheme = settings["common.isAutoTheme"] as? Boolean ?: false
    val dynamicBg = settings["theme.dynamicBg"] as? Boolean ?: true
    val algorithm = settings["theme.dynamicBgAlgorithm"] as? String ?: "blur"
    val activeId = ActiveThemes.resolveId(selectedId, autoTheme, isSystemInDarkTheme())

    var algorithmPicker by remember { mutableStateOf(false) }

    fun save(
        key: String,
        value: Any,
    ) {
        scope.launch { runtime.store.set(key, value) }
    }

    BasicScreen(onBack = onBack, title = "主题") { padding ->
        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(padding),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            ItemSpacer()
            Text(
                text = "选择应用配色，点一下立即生效。",
                color = SaltTheme.colors.subText,
                modifier = Modifier.padding(horizontal = 16.dp),
            )
            ThemeGrid(
                themes = themes,
                selectedId = selectedId,
                onPick = { id -> save("theme.id", id) },
            )
            ItemSpacer()
            ItemSwitcher(
                state = autoTheme,
                onChange = { enable -> save("common.isAutoTheme", enable) },
                text = "跟随系统深色",
                sub = "手机切到深色模式时自动换成黑色主题；日间仍用上面选的配色",
            )
            ItemSwitcher(
                state = dynamicBg,
                onChange = { enable -> save("theme.dynamicBg", enable) },
                text = "播放页动态背景",
                sub = "背景颜色跟着当前歌曲的封面走",
            )
            if (dynamicBg) {
                Item(
                    onClick = { algorithmPicker = true },
                    text = "动态背景方式",
                    tag = ALGORITHM_OPTIONS.firstOrNull { it.first == algorithm }?.second ?: "模糊封面",
                )
            }
            Text(
                text = "主题自带背景图（新年、中秋等皮肤）暂未移植，只有配色与取色背景。",
                color = SaltTheme.colors.subText,
                modifier = Modifier.padding(horizontal = 16.dp),
            )
            ItemSpacer()
            // activeId 只用于提示当前实际生效的主题（自动深色时会和选中项不同）
            if (activeId != selectedId) {
                Text(
                    text = "当前跟随系统，实际使用：${themes.firstOrNull { it.id == activeId }?.name.orEmpty()}",
                    color = SaltTheme.colors.subText,
                    modifier = Modifier.padding(horizontal = 16.dp),
                )
            }
        }
    }

    if (algorithmPicker) {
        BasicDialog(onDismissRequest = { algorithmPicker = false }) {
            DialogTitle(text = "动态背景方式")
            ALGORITHM_OPTIONS.forEach { (value, label) ->
                Item(
                    onClick = {
                        algorithmPicker = false
                        save("theme.dynamicBgAlgorithm", value)
                    },
                    text = label,
                    tag = if (value == algorithm) "已选" else null,
                    arrowType = ItemArrowType.None,
                )
            }
        }
    }
}

@Composable
private fun ThemeGrid(
    themes: List<Theme>,
    selectedId: String,
    onPick: (String) -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        themes.chunked(4).forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { theme ->
                    Column(
                        modifier =
                            Modifier
                                .weight(1f)
                                .padding(vertical = 4.dp)
                                .clip(RoundedCornerShape(10.dp))
                                .clickable { onPick(theme.id) }
                                .semantics {
                                    contentDescription = "主题：${theme.name}"
                                    role = Role.Button
                                    if (theme.id == selectedId) selected = true
                                },
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        val color = CssColor.parse(theme.themeColors["c-theme"])?.let { Color(it) } ?: Color.Gray
                        Box(
                            modifier =
                                Modifier
                                    .size(52.dp)
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(color)
                                    .border(
                                        width = if (theme.id == selectedId) 2.dp else 1.dp,
                                        color = if (theme.id == selectedId) SaltTheme.colors.highlight else SaltTheme.colors.stroke,
                                        shape = RoundedCornerShape(8.dp),
                                    ),
                        )
                        Text(
                            text = theme.name,
                            color = if (theme.id == selectedId) SaltTheme.colors.highlight else SaltTheme.colors.subText,
                            fontSize = 12.sp,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.padding(top = 4.dp),
                        )
                    }
                }
                // 补齐空位，避免最后一行被拉伸
                repeat(4 - row.size) { Box(Modifier.weight(1f)) }
            }
        }
    }
}
