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
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import cn.toside.music.core.theme.ActiveThemes
import cn.toside.music.core.theme.ThemeRoles
import cn.toside.music.nativeapp.data.LocalMusicRuntime
import cn.toside.music.nativeapp.data.RecommendStores
import cn.toside.music.nativeapp.data.SettingsRuntime
import cn.toside.music.nativeapp.ui.HomePage
import cn.toside.music.nativeapp.ui.LocalMorphScopes
import cn.toside.music.nativeapp.ui.MorphScopes
import cn.toside.music.nativeapp.ui.RetainedContent
import cn.toside.music.nativeapp.ui.play.CoverImageLoader
import cn.toside.music.nativeapp.ui.play.PlayDetailPage
import cn.toside.music.nativeapp.ui.settings.SettingsPage
import cn.toside.music.nativeapp.ui.settings.fallbackConfirmEnabled
import com.moriafly.salt.ui.SaltColors
import com.moriafly.salt.ui.SaltConfigs
import com.moriafly.salt.ui.SaltDynamicColors
import com.moriafly.salt.ui.SaltTheme

/**
 * 应用根组合函数。
 *
 * SaltTheme 外壳：主题来自设置（`theme.id` / `common.isAutoTheme`），设置一变整棵树实时换色。
 * 「跟随系统」的语义对齐 RN `getTheme`：只在系统深色时强制 black 主题；
 * `theme.lightId/darkId` 在 RN 里是死键（读取代码被注释），这里同样不消费。
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
    val settingsRuntime = remember(context) { SettingsRuntime.get(context) }
    val settings by settingsRuntime.state.collectAsState()
    LaunchedEffect(settingsRuntime) {
        settingsRuntime.ensureLoaded()
        // W7-2：本地源兜底的人工确认开关（设置键不存在时保持默认开）
        LocalMusicRuntime.bindFallbackConfirm { fallbackConfirmEnabled(settingsRuntime.state.value) }
    }
    val systemDark = isSystemInDarkTheme()
    val themeId = settings["theme.id"] as? String
    val autoTheme = settings["common.isAutoTheme"] as? Boolean ?: false
    val hideBgDark = settings["theme.hideBgDark"] as? Boolean ?: false
    val roles =
        remember(themeId, autoTheme, systemDark, hideBgDark) {
            ActiveThemes.roles(ActiveThemes.active(themeId, autoTheme, systemDark, hideBgDark))
        }
    SaltTheme(
        configs = SaltConfigs.default(isDarkTheme = roles.isDark),
        dynamicColors =
            remember(roles) {
                val active = saltColors(roles)
                if (roles.isDark) {
                    SaltDynamicColors(light = SaltColors.defaultLight(), dark = active)
                } else {
                    SaltDynamicColors(light = active, dark = SaltColors.defaultDark())
                }
            },
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

/** 把 core 的主题角色映射成 SaltUI 的颜色表（success/warning/error 保留 SaltUI 默认）。 */
private fun saltColors(roles: ThemeRoles): SaltColors {
    val highlight = Color(roles.highlight)
    val text = Color(roles.text)
    val subText = Color(roles.subText)
    val background = Color(roles.background)
    val subBackground = Color(roles.subBackground)
    val popup = Color(roles.popup)
    val stroke = Color(roles.stroke)
    val onHighlight = Color(roles.onHighlight)
    return if (roles.isDark) {
        SaltColors.defaultDark(
            highlight = highlight,
            text = text,
            subText = subText,
            background = background,
            subBackground = subBackground,
            popup = popup,
            stroke = stroke,
            onHighlight = onHighlight,
        )
    } else {
        SaltColors.defaultLight(
            highlight = highlight,
            text = text,
            subText = subText,
            background = background,
            subBackground = subBackground,
            popup = popup,
            stroke = stroke,
            onHighlight = onHighlight,
        )
    }
}
