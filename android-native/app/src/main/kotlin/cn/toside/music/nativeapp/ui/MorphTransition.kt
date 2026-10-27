package cn.toside.music.nativeapp.ui

import androidx.compose.animation.AnimatedVisibilityScope
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionScope
import androidx.compose.animation.SharedTransitionScope.ResizeMode
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.Modifier

/**
 * 共享元素转场的两个作用域（W5-14 试点）。
 *
 * 只有 MusicApp 里「首页 / 播放页」两条分支会提供它；其余页面读到 null，
 * [sharedMorph] 直接退化成原 Modifier。
 */
data class MorphScopes(
    val shared: SharedTransitionScope,
    val visibility: AnimatedVisibilityScope,
)

val LocalMorphScopes = compositionLocalOf<MorphScopes?> { null }

/** 迷你播放条封面 ↔ 播放页封面。 */
const val MORPH_COVER_KEY = "morph.cover"

/** 迷你播放条歌名 ↔ 播放页歌名。 */
const val MORPH_TITLE_KEY = "morph.title"

/** 两端尺寸一致、只做位置/尺寸补间的共享元素（封面）。 */
@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
fun Modifier.sharedMorph(key: String): Modifier {
    val scopes = LocalMorphScopes.current ?: return this
    val state = scopes.shared.rememberSharedContentState(key)
    return with(scopes.shared) {
        this@sharedMorph.sharedElement(
            sharedContentState = state,
            animatedVisibilityScope = scopes.visibility,
        )
    }
}

/** 字号/宽度会变的共享文本（歌名）：按两端边界缩放内容而不是硬裁。 */
@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
fun Modifier.sharedMorphBounds(key: String): Modifier {
    val scopes = LocalMorphScopes.current ?: return this
    val state = scopes.shared.rememberSharedContentState(key)
    return with(scopes.shared) {
        this@sharedMorphBounds.sharedBounds(
            sharedContentState = state,
            animatedVisibilityScope = scopes.visibility,
            resizeMode = ResizeMode.scaleToBounds(),
        )
    }
}
