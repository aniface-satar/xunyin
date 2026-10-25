package cn.toside.music.nativeapp

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import cn.toside.music.nativeapp.ui.HomePage
import cn.toside.music.nativeapp.ui.RetainedContent
import cn.toside.music.nativeapp.ui.play.CoverImageLoader
import cn.toside.music.nativeapp.ui.play.PlayDetailPage
import cn.toside.music.nativeapp.ui.settings.SettingsPage
import com.moriafly.salt.ui.SaltConfigs
import com.moriafly.salt.ui.SaltTheme

/**
 * 应用根组合函数。
 *
 * SaltTheme 外壳：跟随系统深浅色（主题偏好持久化在 B1 数据层接入后实现）。
 * 屏幕方向固定竖屏（AndroidManifest android:screenOrientation="portrait"），
 * 不写横屏分支（AGENTS.md 约定）。
 */
@Composable
fun MusicApp() {
    val context = LocalContext.current
    // 封面磁盘缓存需要 applicationContext（CoverImageLoader 其余 API 不变）
    remember(context) { CoverImageLoader.init(context) }
    val isDark = isSystemInDarkTheme()
    SaltTheme(
        configs = SaltConfigs.default(isDarkTheme = isDark),
    ) {
        val nav = rememberNavStack(NavStack.Route.Home)
        val homeNavigator = remember { HomeNavigator() }
        val route = nav.current
        RetainedContent(
            visibleIndex = if (route == NavStack.Route.Home) 0 else 1,
            modifier = Modifier.fillMaxSize(),
        ) {
            HomePage(
                navigator = homeNavigator,
                onOpenPlayer = { nav.navigate(NavStack.Route.PlayDetail) },
                onOpenSettings = { nav.navigate(NavStack.Route.Settings) },
            )
            when (route) {
                NavStack.Route.Home -> Unit
                NavStack.Route.PlayDetail -> PlayDetailPage(onBack = { nav.back() })
                NavStack.Route.Settings -> SettingsPage(onBack = { nav.back() })
            }
        }
        BackHandler(enabled = route != NavStack.Route.Home) {
            nav.back()
        }
    }
}
