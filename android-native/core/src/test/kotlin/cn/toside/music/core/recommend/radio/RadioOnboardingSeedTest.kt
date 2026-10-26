package cn.toside.music.core.recommend.radio

import cn.toside.music.core.recommend.ThemePreference
import cn.toside.music.core.recommend.TrackKeys
import cn.toside.music.core.recommend.m3.Onboarding
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 问卷播种的引擎侧语义（任务书 Lane A 任务 7 的「重答问卷必须能撤回」）。
 *
 * 关键约束：播种分量是 `onboardingWeights` 的纯函数，撤销靠 `onboardingSeeded` 里
 * 记录在案的那份分量——所以两个字段必须跟 `themeWeights` 一起持久化，否则重启后
 * 只会再叠一层，用户的第一次表态永远撤不掉。
 */
class RadioOnboardingSeedTest {
    private val now = RadioFixtures.NOW

    private val zhKeys = listOf("华语", "国语", "中文", "内地").map { TrackKeys.normalizeText(it) }
    private val westernKeys = listOf("欧美", "英文", "英语", "西洋").map { TrackKeys.normalizeText(it) }

    private fun engine(): RadioEngine =
        RadioEngine(
            platform =
                object : RadioPlatform {
                    override suspend fun buildProfile(): RadioProfile = RadioProfile()

                    override suspend fun buildExclusion(): ExclusionContext = ExclusionContext()

                    override suspend fun fetchCandidates(
                        reason: String,
                        budget: Int,
                        rotation: Int,
                        now: Long,
                    ): RadioFetchResult = RadioFetchResult()
                },
            rng = RadioFixtures.seededRandom(20260601),
            now = { now },
            scope = CoroutineScope(Dispatchers.Unconfined),
        )

    private fun positive(
        state: RadioState,
        key: String,
    ): Double = state.themeWeights[key]?.positiveWeight ?: 0.0

    private fun negative(
        state: RadioState,
        key: String,
    ): Double = state.themeWeights[key]?.negativeWeight ?: 0.0

    @Test
    fun seedsAboveNeutralAsPositiveWeight() {
        val engine = engine()
        val applied = engine.applyOnboarding(mapOf("zh" to 100.0), now)

        assertEquals(mapOf("zh" to 100.0), applied)
        // 100% → (100-50)/(100-50) × saturation(4.0)
        for (key in zhKeys) assertEquals(4.0, positive(engine.state, key), 1e-9)
        assertEquals(4.0, engine.state.onboardingSeeded[zhKeys.first()] ?: 0.0, 1e-9)
    }

    @Test
    fun seedsBelowNeutralAsHalfAmplitudeNegativeWeight() {
        val engine = engine()
        engine.applyOnboarding(mapOf("western" to 0.0), now)

        // 0% → -(50/50 × 4.0 × 0.5)，负支只取一半幅度
        for (key in westernKeys) {
            assertEquals(0.0, positive(engine.state, key), 1e-9)
            assertEquals(2.0, negative(engine.state, key), 1e-9)
        }
    }

    @Test
    fun reansweringRevokesPreviousSeedCompletely() {
        val engine = engine()
        engine.applyOnboarding(mapOf("zh" to 100.0), now)
        engine.applyOnboarding(mapOf("zh" to 0.0), now)

        // 旧的正分量必须被对称退掉，新答案给负分量
        for (key in zhKeys) {
            assertEquals(0.0, positive(engine.state, key), 1e-9)
            assertEquals(2.0, negative(engine.state, key), 1e-9)
        }
    }

    @Test
    fun reansweringToEmptyDropsSeededEntries() {
        val engine = engine()
        engine.applyOnboarding(mapOf("zh" to 100.0), now)
        engine.applyOnboarding(emptyMap(), now)

        assertTrue(engine.state.themeWeights.isEmpty())
        assertTrue(engine.state.onboardingSeeded.isEmpty())
        assertTrue(engine.state.onboardingWeights.isEmpty())
    }

    @Test
    fun applyingSameAnswersTwiceIsIdempotent() {
        val once = engine()
        once.applyOnboarding(mapOf("zh" to 100.0, "rock" to 80.0), now)
        val twice = engine()
        twice.applyOnboarding(mapOf("zh" to 100.0, "rock" to 80.0), now)
        twice.applyOnboarding(mapOf("zh" to 100.0, "rock" to 80.0), now)

        assertEquals(once.state.themeWeights, twice.state.themeWeights)
        assertEquals(once.state.onboardingSeeded, twice.state.onboardingSeeded)
    }

    @Test
    fun reseedingKeepsUserFeedbackWeights() {
        val engine = engine()
        val rockKey = TrackKeys.normalizeText("摇滚")
        // 模拟存量用户：主题净权里已有他自己听出来的 1.5 分
        engine.restoreState(
            RadioState(
                themeWeights =
                    mapOf(
                        rockKey to
                            ThemePreference(
                                themeId = rockKey,
                                positiveWeight = 1.5,
                                negativeWeight = 0.0,
                                lastDecayTime = now,
                                lastUsedTime = now,
                            ),
                    ),
            ),
        )
        engine.applyOnboarding(mapOf("rock" to 100.0), now)

        assertEquals(1.5 + 4.0, positive(engine.state, rockKey), 1e-9)
    }

    @Test
    fun neutralAnswerIsTreatedAsNoOpinion() {
        val engine = engine()
        val applied = engine.applyOnboarding(mapOf("zh" to 50.0), now)

        assertTrue(applied.isEmpty())
        assertTrue(engine.state.themeWeights.isEmpty())
    }

    @Test
    fun percentIsRoundedToTensBeforeSeeding() {
        val engine = engine()
        // 55 → 60 → (60-50)/50 × 4.0 = 0.8
        engine.applyOnboarding(mapOf("zh" to 55.0), now)

        assertEquals(0.8, positive(engine.state, zhKeys.first()), 1e-9)
    }

    @Test
    fun seedsSurviveStateCodecRoundTrip() {
        val engine = engine()
        engine.applyOnboarding(mapOf("zh" to 100.0), now)
        val decoded = RadioStateCodec.decode(RadioStateCodec.encode(engine.state))

        assertTrue(decoded != null)
        assertEquals(engine.state.themeWeights, decoded?.themeWeights)
        assertEquals(engine.state.onboardingWeights, decoded?.onboardingWeights)
        assertEquals(engine.state.onboardingSeeded, decoded?.onboardingSeeded)
        // 重启后 UI 拿这份答案回填滑条
        assertEquals(Onboarding.sanitizeWeights(mapOf("zh" to 100.0)), decoded?.onboardingWeights)
    }
}
