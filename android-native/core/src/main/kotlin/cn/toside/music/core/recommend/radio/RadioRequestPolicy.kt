package cn.toside.music.core.recommend.radio

import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToLong

/**
 * 请求超时/重试/指数退避 —— RN `core/recommend/requestPolicy.ts` 移植。
 *
 * 随机抖动与 sleep 都从参数注入，JVM 单测不真的等。
 */
data class RequestPolicy(
    val timeoutMs: Long = RadioConfig.Request.TIMEOUT_MS,
    val retryCount: Int = RadioConfig.Request.RETRY_COUNT,
    val backoffBaseMs: Long = RadioConfig.Request.BACKOFF_BASE_MS,
    val backoffMaxMs: Long = RadioConfig.Request.BACKOFF_MAX_MS,
)

class RequestTimeoutError(
    message: String = "request_timeout",
) : Exception(message)

class RequestCancelledError : Exception("request_cancelled")

object RadioRequestPolicy {
    val DEFAULT = RequestPolicy()

    fun computeBackoffMs(
        attempt: Int,
        policy: RequestPolicy = DEFAULT,
        random: () -> Double,
    ): Long {
        val base = min(policy.backoffMaxMs.toDouble(), policy.backoffBaseMs * 2.0.pow(max(0, attempt)))
        // 加入 0~25% 抖动，避免多路请求同时重试
        return (base * (1 + random() * 0.25)).roundToLong()
    }

    /**
     * 请求超时、有限重试、指数退避；失败次数达到上限后向上抛出，由源级冷却兜底。
     */
    suspend fun <T> runWithRetry(
        request: suspend () -> T,
        policy: RequestPolicy = DEFAULT,
        sleep: suspend (Long) -> Unit = { delay(it) },
        random: () -> Double,
        isCancelled: () -> Boolean = { false },
        shouldRetry: ((Throwable, Int) -> Boolean)? = null,
        onRetry: ((Throwable, Int, Long) -> Unit)? = null,
    ): T {
        var lastError: Throwable? = null
        for (attempt in 0..policy.retryCount) {
            if (isCancelled()) throw RequestCancelledError()
            try {
                return if (policy.timeoutMs > 0) {
                    withTimeoutOrNull(policy.timeoutMs) { request() } ?: throw RequestTimeoutError()
                } else {
                    request()
                }
            } catch (error: Throwable) {
                lastError = error
                if (attempt >= policy.retryCount) break
                if (shouldRetry != null && !shouldRetry(error, attempt)) break
                val backoff = computeBackoffMs(attempt, policy, random)
                onRetry?.invoke(error, attempt, backoff)
                sleep(backoff)
            }
        }
        throw (lastError ?: RequestTimeoutError())
    }

    fun isLikelyNetworkError(error: Throwable): Boolean {
        if (error is RequestTimeoutError) return true
        val message = error.message.orEmpty()
        return Regex(
            "timeout|network|fail|fetch|request_cancelled|socket|connect|ENOTFOUND|ECONN",
            RegexOption.IGNORE_CASE,
        ).containsMatchIn(message)
    }
}
