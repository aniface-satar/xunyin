package cn.toside.music.core.local

/**
 * 导入分批与时序常量 —— 对照 RN `listAction.ts`：
 *
 * - `handleUpdateMusics` 每轮取 `slice(index + 1, index + 11)` → **每批 10 条**，处理完递归下一批；
 * - `createLocalMusicInfos` 每轮 `shift()` 五次并 `Promise.all` → **批内并发 5**；
 * - `createThrottleAddMusics` 用 `BackgroundTimer.setTimeout(..., 1000)` 合并落库 → **节流 1 秒**。
 *
 * 纯常量与切分规则放 `:core` 便于锁测；真正的调度在 app 侧。
 */
object LocalImportPlan {
    const val METADATA_BATCH_SIZE: Int = 10
    const val METADATA_CONCURRENCY: Int = 5
    const val FLUSH_DELAY_MS: Long = 1_000L

    fun <T> batches(items: List<T>): List<List<T>> = chunks(items, METADATA_BATCH_SIZE)

    /** 固定窗口切分（与 RN 的 `slice(index+1, index+11)` 等价，末批可短）。 */
    fun <T> chunks(
        items: List<T>,
        size: Int,
    ): List<List<T>> {
        require(size > 0) { "chunk size must be positive" }
        if (items.isEmpty()) return emptyList()
        val result = mutableListOf<List<T>>()
        var index = 0
        while (index < items.size) {
            val end = minOf(index + size, items.size)
            result.add(items.subList(index, end).toList())
            index = end
        }
        return result
    }
}

/**
 * 导入进度快照（UI 与报告共用）。
 *
 * [added] 是「已快速入库」的占位数（RN `list_select_local_file_temp_add_tip` 里那个 total），
 * [processed] 是已经跑过标签读取的条数，[failed] 是其中被移除的条数。
 */
data class LocalImportProgress(
    val total: Int = 0,
    val added: Int = 0,
    val processed: Int = 0,
    val failed: Int = 0,
) {
    val running: Boolean get() = processed < total
    val success: Int get() = (processed - failed).coerceAtLeast(0)

    /** 0f..1f；total 为 0 时按 0 处理（避免除零）。 */
    val ratio: Float get() = if (total <= 0) 0f else (processed.toFloat() / total).coerceIn(0f, 1f)

    /** 读标签阶段推进一条。 */
    fun advance(
        count: Int,
        failedCount: Int,
    ): LocalImportProgress {
        val next = processed + count
        return copy(
            // total 已知时封顶在 total；total 未知（0）时照常累加，别把进度卡死
            processed = if (total > 0) minOf(next, total) else next,
            failed = (failed + failedCount).coerceAtMost(if (total > 0) total else failed + failedCount),
        )
    }
}
