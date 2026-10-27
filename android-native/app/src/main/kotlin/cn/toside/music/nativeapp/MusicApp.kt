package cn.toside.music.nativeapp

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionLayout
import androidx.compose.animation.core.MutableTransitionState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import cn.toside.music.nativeapp.data.RecommendStores
import cn.toside.music.nativeapp.ui.HomePage
import cn.toside.music.nativeapp.ui.LocalMorphScopes
import cn.toside.music.nativeapp.ui.MorphScopes
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
 *
 * 播放页进出由 [AnimatedVisibility] 驱动，配合 [SharedTransitionLayout] 做迷你播放条
 * → 播放页的封面/歌名共享元素转场（W5-14 试点）。
 */
@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
fun MusicApp() {
    val context = LocalContext.current
    // 封面磁盘缓存需要 applicationContext（CoverImageLoader 其余 API 不变）
    remember(context) { CoverImageLoader.init(context) }
    // 推荐 M3 的存储/运行时（问卷、歌手语言表、隐藏歌单、相似歌手通道 E）统一装配一次
    remember(context) { RecommendStores.init(context) }
    val isDark = isSystemInDarkTheme()
    SaltTheme(
        configs = SaltConfigs.default(isDarkTheme = isDark),
    ) {
        val nav = rememberNavStack(NavStack.Route.Home)
        val homeNavigator = remember { HomeNavigator() }
        val route = nav.current
        val playVisible = remember { MutableTransitionState(false) }
        LaunchedEffect(route) { playVisible.targetState = route == NavStack.Route.PlayDetail }
        // 共享元素要求两端同时处于布局中：转场期间首页也要测量并绘制。
        // 首页始终留在组合里，所以未选中时把 visibleIndex 拨到 -1（不测量不绘制）即可保留状态。
        val homeInLayout =
            route == NavStack.Route.Home || playVisible.currentState || playVisible.targetState
        SharedTransitionLayout(Modifier.fillMaxSize()) {
            Box(Modifier.fillMaxSize()) {
                RetainedContent(visibleIndex = if (homeInLayout) 0 else -1) {
                    // 首页没有自己的显隐动画，但 sharedElement 需要一个 AnimatedVisibilityScope
                    AnimatedVisibility(
                        visible = true,
                        enter = EnterTransition.None,
                        exit = ExitTransition.None,
                    ) {
                        CompositionLocalProvider(
                            LocalMorphScopes provides MorphScopes(this@SharedTransitionLayout, this),
                        ) {
                            HomePage(
                                navigator = homeNavigator,
                                onOpenPlayer = { nav.navigate(NavStack.Route.PlayDetail) },
                                onOpenSettings = { nav.navigate(NavStack.Route.Settings) },
                            )
                        }
                    }
                }
                AnimatedVisibility(
                    visibleState = playVisible,
                    enter = fadeIn(tween(200)),
                    exit = fadeOut(tween(160)),
                ) {
                    CompositionLocalProvider(
                        LocalMorphScopes provides MorphScopes(this@SharedTransitionLayout, this),
                    ) {
                        PlayDetailPage(onBack = { nav.back() })
                    }
                }
                if (route == NavStack.Route.Settings) {
                    SettingsPage(onBack = { nav.back() })
                }
            }
        }
        BackHandler(enabled = route != NavStack.Route.Home) {
            nav.back()
        }
    }
}
