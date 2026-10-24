package cn.toside.music.core.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 对照 RN `tests/preload-next-music-plan.mts` 的逐条移植：
 * 每条用例对应纯表的一处边界，别按「看起来能过」重写期望。
 */
class PreloadPlanTest {
    // cacheBytes 给 1GB（默认 player.cacheSize='1024' 换算出来的字节数），远大于 8MB 前缀
    private val flags =
        PreloadFlags(
            preloadNextMusic = true,
            dynamicBg = true,
            audioTier = PreloadAudioTier.HEAD,
            cacheBytes = 1024L * 1024 * 1024,
        )

    /** 默认输入：播到 50s / 共 60s（剩 10s，落在 60s 门限内），下一首已解析、还没有封面 URL、解析刚完成。 */
    private fun input(
        progress: PreloadProgress = PreloadProgress(50f, 60f),
        flags: PreloadFlags = this.flags,
        resolveTried: Boolean = true,
        hasTarget: Boolean = true,
        targetIsOnline: Boolean = true,
        hasPicUrl: Boolean = false,
        resolvedAgeSec: Float = 0f,
        doneSteps: Set<PreloadStep> = emptySet(),
    ) = PreloadPlanInput(
        progress = progress,
        flags = flags,
        resolveTried = resolveTried,
        hasTarget = hasTarget,
        targetIsOnline = targetIsOnline,
        hasPicUrl = hasPicUrl,
        resolvedAgeSec = resolvedAgeSec,
        doneSteps = doneSteps,
    )

    @Test
    fun `剩余超过 60 秒时不解析目标也不发任何步骤`() {
        val plan = buildPreloadPlan(input(progress = PreloadProgress(10f, 200f), resolveTried = false, hasTarget = false))
        assertFalse(plan.resolveTarget)
        assertEquals(emptyList<PreloadStep>(), plan.steps)
    }

    @Test
    fun `剩余 60 秒内且没问过时只让解析目标`() {
        val plan = buildPreloadPlan(input(progress = PreloadProgress(30f, 90f), resolveTried = false, hasTarget = false))
        assertTrue(plan.resolveTarget)
        assertEquals(emptyList<PreloadStep>(), plan.steps)
    }

    @Test
    fun `目标问过就不再问第二次无论成功还是 null`() {
        assertTrue(buildPreloadPlan(input(resolveTried = false, hasTarget = false)).resolveTarget)
        assertFalse(buildPreloadPlan(input(resolveTried = true, hasTarget = false)).resolveTarget)
        assertFalse(buildPreloadPlan(input(resolveTried = true, hasTarget = true)).resolveTarget)
    }

    @Test
    fun `时长不超过 10 秒整条不启动`() {
        for (maxPlayTime in listOf(0f, 5f, MIN_DURATION_SECONDS)) {
            val plan =
                buildPreloadPlan(
                    input(progress = PreloadProgress(0f, maxPlayTime), resolveTried = false, hasTarget = false),
                )
            assertFalse("maxPlayTime=$maxPlayTime", plan.resolveTarget)
        }
        assertTrue(
            buildPreloadPlan(
                input(progress = PreloadProgress(0f, 11f), resolveTried = false, hasTarget = false),
            ).resolveTarget,
        )
    }

    @Test
    fun `剩余 8 秒与剩余 40 秒的判据相同`() {
        assertTrue(RESOLVE_AHEAD_SECONDS > MIN_DURATION_SECONDS)
        val nearEnd = buildPreloadPlan(input(progress = PreloadProgress(52f, 60f)))
        val midEnd = buildPreloadPlan(input(progress = PreloadProgress(20f, 60f)))
        assertEquals(listOf(PreloadStep.PIC, PreloadStep.LYRIC), nearEnd.steps)
        assertEquals(nearEnd.steps, midEnd.steps)
    }

    @Test
    fun `目标一定就立刻发 pic 与 lyric`() {
        assertEquals(listOf(PreloadStep.PIC, PreloadStep.LYRIC), buildPreloadPlan(input()).steps)
    }

    @Test
    fun `dynamicBg 为假只跳取色那一步`() {
        val plan = buildPreloadPlan(input(hasPicUrl = true, flags = flags.copy(dynamicBg = false)))
        assertFalse(plan.steps.contains(PreloadStep.PALETTE))
        assertEquals(listOf(PreloadStep.PIC, PreloadStep.LYRIC, PreloadStep.COVER_BYTES), plan.steps)
    }

    @Test
    fun `palette 与 coverBytes 都要等 pic 的结果`() {
        assertEquals(listOf(PreloadStep.PIC, PreloadStep.LYRIC), buildPreloadPlan(input()).steps)
        assertEquals(
            listOf(PreloadStep.PIC, PreloadStep.LYRIC, PreloadStep.PALETTE, PreloadStep.COVER_BYTES),
            buildPreloadPlan(input(hasPicUrl = true)).steps,
        )
    }

    @Test
    fun `本地或下载曲不发 coverBytes 也不发 audio`() {
        val offline = buildPreloadPlan(input(targetIsOnline = false, hasPicUrl = true, resolvedAgeSec = 10f))
        assertFalse(offline.steps.contains(PreloadStep.COVER_BYTES))
        assertFalse(offline.steps.contains(PreloadStep.AUDIO))
        assertEquals(listOf(PreloadStep.PIC, PreloadStep.LYRIC, PreloadStep.PALETTE), offline.steps)
    }

    @Test
    fun `audio 要等解析完成后满 3 秒才发`() {
        val before = buildPreloadPlan(input(hasPicUrl = true, resolvedAgeSec = AUDIO_DELAY_SECONDS - 1))
        assertFalse(before.steps.contains(PreloadStep.AUDIO))
        val atDelay = buildPreloadPlan(input(hasPicUrl = true, resolvedAgeSec = AUDIO_DELAY_SECONDS))
        assertTrue(atDelay.steps.contains(PreloadStep.AUDIO))
    }

    @Test
    fun `audio 三种关闭情形各自只少 audio 一步`() {
        val tierOff =
            buildPreloadPlan(input(hasPicUrl = true, resolvedAgeSec = 5f, flags = flags.copy(audioTier = PreloadAudioTier.OFF)))
        assertFalse(tierOff.steps.contains(PreloadStep.AUDIO))
        val noCache = buildPreloadPlan(input(hasPicUrl = true, resolvedAgeSec = 5f, flags = flags.copy(cacheBytes = 0L)))
        assertFalse(noCache.steps.contains(PreloadStep.AUDIO))
        assertEquals(
            listOf(PreloadStep.PIC, PreloadStep.LYRIC, PreloadStep.PALETTE, PreloadStep.COVER_BYTES),
            noCache.steps,
        )
        val offline = buildPreloadPlan(input(targetIsOnline = false, hasPicUrl = true, resolvedAgeSec = 5f))
        assertFalse(offline.steps.contains(PreloadStep.AUDIO))
    }

    @Test
    fun `缓存装不下 8MB 前缀时只少 audio 一步 head 与 full 共用门限`() {
        val smallCache = flags.copy(cacheBytes = 6L * 1024 * 1024)
        val head = buildPreloadPlan(input(hasPicUrl = true, resolvedAgeSec = 5f, flags = smallCache))
        assertFalse(head.steps.contains(PreloadStep.AUDIO))
        assertEquals(
            listOf(PreloadStep.PIC, PreloadStep.LYRIC, PreloadStep.PALETTE, PreloadStep.COVER_BYTES),
            head.steps,
        )
        val full =
            buildPreloadPlan(input(hasPicUrl = true, resolvedAgeSec = 5f, flags = smallCache.copy(audioTier = PreloadAudioTier.FULL)))
        assertFalse(full.steps.contains(PreloadStep.AUDIO))
        assertEquals(
            listOf(PreloadStep.PIC, PreloadStep.LYRIC, PreloadStep.PALETTE, PreloadStep.COVER_BYTES),
            full.steps,
        )
    }

    @Test
    fun `缓存恰好等于 8MB 时 audio 要发`() {
        val exact =
            buildPreloadPlan(
                input(hasPicUrl = true, resolvedAgeSec = 5f, flags = flags.copy(cacheBytes = AUDIO_HEAD_BYTES)),
            )
        assertEquals(
            listOf(PreloadStep.PIC, PreloadStep.LYRIC, PreloadStep.PALETTE, PreloadStep.COVER_BYTES, PreloadStep.AUDIO),
            exact.steps,
        )
    }

    @Test
    fun `preloadNextMusic 为假时五步全不发也不解析`() {
        val plan =
            buildPreloadPlan(
                input(
                    flags = flags.copy(preloadNextMusic = false),
                    hasPicUrl = true,
                    resolvedAgeSec = 10f,
                    resolveTried = false,
                ),
            )
        assertFalse(plan.resolveTarget)
        assertEquals(emptyList<PreloadStep>(), plan.steps)
    }

    @Test
    fun `已经发起过的步骤不再重复发起`() {
        val done = setOf(PreloadStep.PIC, PreloadStep.LYRIC)
        assertEquals(emptyList<PreloadStep>(), buildPreloadPlan(input(doneSteps = done)).steps)
        val mostlyDone = done + PreloadStep.PALETTE
        assertEquals(
            listOf(PreloadStep.COVER_BYTES, PreloadStep.AUDIO),
            buildPreloadPlan(input(hasPicUrl = true, resolvedAgeSec = 5f, doneSteps = mostlyDone)).steps,
        )
    }

    @Test
    fun `音频档位换算 head 给 8MB 上限 full 给 0`() {
        assertEquals(AUDIO_HEAD_BYTES, audioMaxBytes(PreloadAudioTier.HEAD))
        assertEquals(0L, audioMaxBytes(PreloadAudioTier.FULL))
    }
}
