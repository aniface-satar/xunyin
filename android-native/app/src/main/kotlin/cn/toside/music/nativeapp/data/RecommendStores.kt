package cn.toside.music.nativeapp.data

import android.content.Context

/**
 * 推荐 M3 的 app 侧装配点 —— 一处集中持有「需要 Context 才能建」的存储与运行时，
 * 避免每个 UI 各自 `new` 一个 store 导致缓存各存一份。
 *
 * 由 `MusicApp()` 在根组合函数里调 [init]（与 `CoverImageLoader.init` 同一时机）。
 * 未初始化就取用会立刻抛错而不是静默返回空数据——静默返回空会让「问卷没生效」
 * 这类问题变成极难定位的哑故障。
 */
object RecommendStores {
    @Volatile
    private var appContext: Context? = null

    fun init(context: Context) {
        if (appContext == null) appContext = context.applicationContext
    }

    private fun requireContext(): Context = appContext ?: error("RecommendStores 尚未初始化")

    /** 踩雷规则（既有）。 */
    val dislikes: DislikeStore by lazy { DislikeStore(requireContext()) }

    /** 被「不感兴趣」隐藏的歌单。 */
    val hidden: HiddenPlaylistStore by lazy { HiddenPlaylistStore(requireContext()) }

    /** 偏好问卷（`onboarding.weights`）。 */
    val onboarding: OnboardingStore by lazy { OnboardingStore(requireContext()) }

    /**
     * 电台落盘状态（只读出口）。
     *
     * 发现页的分类挑选要消费 `themeWeights`，而 [RadioRuntime] 不是单例；写侧仍只在
     * 电台运行时里，这里只给 UI/发现页读同一份落盘状态。
     */
    val radioState: RadioStateStore by lazy { RadioStateStore(requireContext()) }

    /** 歌手语言表（L3）。 */
    val artistLang: ArtistLangStore by lazy { ArtistLangStore(requireContext()) }

    /** 相似歌手通道 E。 */
    val similarArtist: SimilarArtistRuntime by lazy { SimilarArtistRuntime(requireContext()) }
}
