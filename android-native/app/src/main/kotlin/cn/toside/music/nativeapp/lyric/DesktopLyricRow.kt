package cn.toside.music.nativeapp.lyric

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.moriafly.salt.ui.ItemSwitcher
import com.moriafly.salt.ui.UnstableSaltUiApi

/**
 * 播放器设置里的「桌面歌词」开关行（自包含）。
 *
 * 状态与动作都在本行内：进程级 [DesktopLyricController] + `LocalContext`，
 * 不要求宿主页面改签名。授权页返回靠 Activity 的 ON_RESUME 兜住。
 */
@OptIn(UnstableSaltUiApi::class)
@Composable
fun DesktopLyricRow() {
    val context = LocalContext.current
    val controller = remember(context) { DesktopLyricController.get(context) }
    val enabled by controller.enabled.collectAsState()
    val activity = remember(context) { context.findComponentActivity() }

    LaunchedEffect(controller) { controller.sync() }

    DisposableEffect(activity, controller) {
        val observer =
            LifecycleEventObserver { _, event ->
                if (event == Lifecycle.Event.ON_RESUME) controller.onActivityResumed()
            }
        activity?.lifecycle?.addObserver(observer)
        onDispose { activity?.lifecycle?.removeObserver(observer) }
    }

    ItemSwitcher(
        state = enabled,
        onChange = { controller.setEnabled(it) },
        text = "桌面歌词",
    )
}
