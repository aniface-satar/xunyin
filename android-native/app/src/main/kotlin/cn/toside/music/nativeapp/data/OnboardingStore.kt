package cn.toside.music.nativeapp.data

import android.content.Context
import cn.toside.music.core.recommend.ThemePreference
import cn.toside.music.core.recommend.m3.Onboarding
import cn.toside.music.core.storage.ShardedKvStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull

/**
 * 偏好问卷的持久层 —— 键名沿用 RN 的语义：`onboarding.weights`（选项 id → 百分比）。
 *
 * 写侧一律过 [Onboarding.sanitizeWeights]：只留合法 id、钳 0-100、取整到 10 的倍数、
 * 丢掉停在中性点 50% 的项。读侧再过一次是防「跨版本写坏的存量」——
 * 读侧不挡的话，一条历史中性值会冒充「华语占窗口一半」。
 *
 * 播种到 `themeWeights` 是**另一件事**：本类只管存取，播种由
 * [RadioRuntime.applyOnboardingSeeds] 在拿到引擎状态后做（要能对称回退）。
 */
class OnboardingStore(
    context: Context,
) {
    private val kv = ShardedKvStore(DataStoreKvStore(context.applicationContext))
    private val mutex = Mutex()

    @Volatile
    private var cache: Map<String, Double>? = null

    /** 已归一化的权重；没答过卷返回空表。 */
    suspend fun weights(force: Boolean = false): Map<String, Double> {
        cache?.takeIf { !force }?.let { return it }
        return mutex.withLock {
            cache?.takeIf { !force }?.let { return@withLock it }
            val loaded =
                withContext(Dispatchers.IO) {
                    runCatching { kv.getData<JsonObject>(KEY) }.getOrNull()
                }
            val raw =
                buildMap {
                    loaded?.forEach { (key, value) ->
                        (value as? JsonPrimitive)?.doubleOrNull?.let { put(key, it) }
                    }
                }
            val sanitized = Onboarding.sanitizeWeights(raw)
            cache = sanitized
            sanitized
        }
    }

    /** 是否已经答过卷（有任意一条非中性表态即为 true）。 */
    suspend fun hasAnswer(): Boolean = weights().isNotEmpty()

    /** 写入问卷答案，返回落盘后的归一化结果（调用方拿它去播种，别再自己 sanitize 一遍）。 */
    suspend fun save(answers: Map<String, Double>): Map<String, Double> {
        val sanitized = Onboarding.sanitizeWeights(answers)
        withContext(Dispatchers.IO) {
            runCatching {
                kv.saveData(KEY, JsonObject(sanitized.mapValues { JsonPrimitive(it.value) }))
            }
        }
        cache = sanitized
        return sanitized
    }

    suspend fun clear() {
        withContext(Dispatchers.IO) { runCatching { kv.removeData(KEY) } }
        cache = emptyMap()
    }

    /**
     * 把当前问卷播种进分类净权（就地改传入的 map）。
     *
     * 先 [Onboarding.revokeSeedWeights] 再 [Onboarding.applySeedWeights]：
     * 重答问卷时旧播种必须对称退回，否则「把华语从 100% 改成 0%」只会叠一层负权，
     * 用户的第一次表态永远撤不掉。用户自己的反馈净权不受影响。
     */
    fun applySeeds(
        themes: MutableMap<String, ThemePreference>,
        weights: Map<String, Double>,
        previousWeights: Map<String, Double>,
        now: Long,
    ) {
        val previous = Onboarding.computeSeedWeights(previousWeights)
        if (previous.isNotEmpty()) Onboarding.revokeSeedWeights(themes, previous)
        val seeds = Onboarding.computeSeedWeights(weights)
        if (seeds.isNotEmpty()) Onboarding.applySeedWeights(themes, seeds, now)
    }

    companion object {
        const val KEY = "xunyin_recommend_onboarding_v1"
    }
}
