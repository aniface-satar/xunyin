package cn.toside.music.nativeapp.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import cn.toside.music.nativeapp.player.PlayerRuntime
import com.moriafly.salt.ui.Item
import com.moriafly.salt.ui.ItemArrowType
import com.moriafly.salt.ui.ItemSpacer
import com.moriafly.salt.ui.ItemSwitcher
import com.moriafly.salt.ui.SaltTheme
import com.moriafly.salt.ui.Text
import com.moriafly.salt.ui.UnstableSaltUiApi
import com.moriafly.salt.ui.screen.BasicScreen
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 音源日志页 —— RN「其他 → 查看错误日志」里那一份自定义源日志的原生版。
 *
 * 日志只存在运行时内存里，只留最新 200 条，重启即清空。
 * 脚本自己打印的内容默认不记（和 RN 的 `isEnableUserApiLog` 一样默认关着），
 * 更新检查的结论则一直都在记。
 */
@OptIn(UnstableSaltUiApi::class)
@Composable
fun UserApiLogsPage(onBack: () -> Unit) {
    val context = LocalContext.current
    val userApi = remember { PlayerRuntime.get(context).userApi }
    val logs by userApi.logs.collectAsState()
    // 开关是运行时的进程级状态，页面自己留一份镜像才能立刻回显
    var recordScriptLog by remember { mutableStateOf(userApi.logsEnabled) }

    BasicScreen(onBack = onBack, title = "音源日志") { padding ->
        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(padding),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            ItemSpacer()
            ItemSwitcher(
                state = recordScriptLog,
                onChange = { enable ->
                    recordScriptLog = enable
                    userApi.logsEnabled = enable
                },
                text = "记录自定义源日志",
                sub = "打开后才把脚本自己打印的内容记在这里；更新检查的结论一直都在",
            )
            Item(
                onClick = { userApi.clearLogs() },
                text = "清空日志",
                tag = "${logs.size} 条",
                arrowType = ItemArrowType.None,
            )
            ItemSpacer()
            if (logs.isEmpty()) {
                Text(
                    text = "日志是空的。取链、检查更新或者上面的开关打开后，这里才会有内容。",
                    color = SaltTheme.colors.subText,
                    modifier = Modifier.padding(horizontal = 16.dp),
                )
            }
            logs.forEach { entry ->
                Text(
                    text = "${formatLogTime(entry.time)} [${entry.type}] ${entry.message}",
                    color = if (entry.type == "error") SaltTheme.colors.text else SaltTheme.colors.subText,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 2.dp),
                )
            }
            ItemSpacer()
        }
    }
}

private val LOG_TIME_FORMAT = SimpleDateFormat("MM-dd HH:mm:ss", Locale.getDefault())

private fun formatLogTime(time: Long): String = LOG_TIME_FORMAT.format(Date(time))
