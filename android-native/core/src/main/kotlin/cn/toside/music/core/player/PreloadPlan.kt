package cn.toside.music.core.player

// 「这一刻该为下一首发哪几步」的纯表 —— RN `src/core/player/preloadPlan.ts` 的移植。
// 除判据外零副作用：不读播放器状态、不读设置、不发请求，全部从入参拿，
// 这样能像 RN 侧一样拿 JVM 单测把边界钉死。副作用与在途作废由调用方负责。

/** 预热音频档位（RN `player.preloadNextMusicAudio`）。 */
enum class PreloadAudioTier {
    OFF,
    HEAD,
    FULL,
}

/** 预热步骤；枚举顺序即 RN 纯表里的发起顺序。 */
enum class PreloadStep {
    PIC,
    LYRIC,
    PALETTE,
    COVER_BYTES,
    AUDIO,
}

data class PreloadProgress(
    val nowPlayTimeSec: Float,
    val maxPlayTimeSec: Float,
)

data class PreloadFlags(
    /** 总开关：关掉就是五步全不发，连「下一首是谁」都不问。 */
    val preloadNextMusic: Boolean,
    /** 取色那一步单独受它管，别把整条预热带过去。 */
    val dynamicBg: Boolean,
    val audioTier: PreloadAudioTier,
    /**
     * 播放器那份 SimpleCache 的容量，字节。`player.cacheSize` 的单位是 MB，换算由调用方做。
     * 两道都要过才发音频字节：`<= 0` 时原生根本不建 cache，下字节无处可写；
     * `> 0` 但装不下 8MB 前缀时更要命 —— LRU 会把正在播那首的片段挤出去，预热反而拖垮播放。
     */
    val cacheBytes: Long,
)

data class PreloadPlanInput(
    val progress: PreloadProgress,
    val flags: PreloadFlags,
    /** 本曲是否已经问过「下一首是谁」；返回 null（列表播完）也算问过，不再每秒重问。 */
    val resolveTried: Boolean,
    val hasTarget: Boolean,
    /** 本地曲 / 下载曲为假：这两类没有「再下一趟网络」可省。 */
    val targetIsOnline: Boolean,
    val hasPicUrl: Boolean,
    /** 目标解析完成后经过的秒数（音频字节那一步的延迟判据）。 */
    val resolvedAgeSec: Float,
    /** 本曲已经发起过的步骤（RN 的 done 记录；每步每曲只发一次）。 */
    val doneSteps: Set<PreloadStep>,
)

data class PreloadPlan(
    val resolveTarget: Boolean,
    val steps: List<PreloadStep>,
)

/** 剩多少秒开始准备下一首；10s 那条旧门限被它包含，不再单独写分支。 */
const val RESOLVE_AHEAD_SECONDS: Float = 60f

/** 时长下界：电台与未知长度的流式曲 maxPlayTime 为 0，此时「剩余 <=60」恒真，没有这个下界就会每秒问一次。 */
const val MIN_DURATION_SECONDS: Float = 10f

/** 反悔窗口：给「连点下一首 / 拖到尾部」留出作废时间，过了这个点才动音频字节。 */
const val AUDIO_DELAY_SECONDS: Float = 3f

const val AUDIO_HEAD_BYTES: Long = 8L * 1024 * 1024

/** head 档给 8MB 上限；full 档给 0，由原生换成 C.LENGTH_UNSET（整首）。off 不会被调用。 */
fun audioMaxBytes(tier: PreloadAudioTier): Long = if (tier == PreloadAudioTier.FULL) 0L else AUDIO_HEAD_BYTES

/**
 * 缓存装不下一个 8MB 前缀时，下字节只会把正在播的那首挤出去 —— 宁可这步不发。
 * 表与执行器（发起那一刻的重读）必须共用这一句，两边一旦分叉，保护就没了。
 */
fun cacheFitsAudioWarm(cacheBytes: Long): Boolean = cacheBytes >= AUDIO_HEAD_BYTES

fun buildPreloadPlan(input: PreloadPlanInput): PreloadPlan {
    if (!input.flags.preloadNextMusic) return PreloadPlan(resolveTarget = false, steps = emptyList())

    val remaining = input.progress.maxPlayTimeSec - input.progress.nowPlayTimeSec
    val resolveTarget =
        !input.resolveTried &&
            input.progress.maxPlayTimeSec > MIN_DURATION_SECONDS &&
            remaining <= RESOLVE_AHEAD_SECONDS

    if (!input.hasTarget) return PreloadPlan(resolveTarget = resolveTarget, steps = emptyList())

    val steps = mutableListOf<PreloadStep>()
    if (PreloadStep.PIC !in input.doneSteps) steps += PreloadStep.PIC
    if (PreloadStep.LYRIC !in input.doneSteps) steps += PreloadStep.LYRIC
    // 取色要等 pic 的结果：配色层的缓存键是 `picUrl|fontArgb`，没有 url 就没有这一步
    if (input.flags.dynamicBg && input.hasPicUrl && PreloadStep.PALETTE !in input.doneSteps) {
        steps += PreloadStep.PALETTE
    }
    if (input.targetIsOnline && input.hasPicUrl && PreloadStep.COVER_BYTES !in input.doneSteps) {
        steps += PreloadStep.COVER_BYTES
    }
    // 容量这道门限 head 与 full 共用：full 档没有上限兜底，挤掉的只能是正在播的那首
    if (input.targetIsOnline &&
        input.flags.audioTier != PreloadAudioTier.OFF &&
        cacheFitsAudioWarm(input.flags.cacheBytes) &&
        input.resolvedAgeSec >= AUDIO_DELAY_SECONDS &&
        PreloadStep.AUDIO !in input.doneSteps
    ) {
        steps += PreloadStep.AUDIO
    }

    return PreloadPlan(resolveTarget = resolveTarget, steps = steps)
}
