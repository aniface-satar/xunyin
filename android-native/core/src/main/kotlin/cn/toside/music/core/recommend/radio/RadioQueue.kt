package cn.toside.music.core.recommend.radio

/**
 * 本地候选队列 —— RN `core/recommend/queue.ts` 原样移植。
 *
 * 异步生成结果带版本号，旧请求返回时整批丢弃；同一首歌不会并发插入多次。
 */
data class RadioQueueSnapshot(
    val version: Long,
    val size: Int,
    val items: List<RecommendQueueItem>,
    val keys: List<String>,
)

class RadioQueue {
    private var versionValue: Long = 1
    private var items: MutableList<RecommendQueueItem> = mutableListOf()
    private var knownKeys: MutableSet<String> = mutableSetOf()

    val version: Long get() = versionValue

    private fun rebuildKeys() {
        knownKeys = items.mapTo(mutableSetOf()) { RadioTrackKeys.buildTrackKey(it.musicInfo) }
    }

    fun invalidate(): Long {
        versionValue += 1
        items = mutableListOf()
        knownKeys.clear()
        return versionValue
    }

    fun clear() {
        items = mutableListOf()
        knownKeys.clear()
    }

    fun size(): Int = items.size

    fun has(trackKey: String): Boolean = knownKeys.contains(trackKey)

    fun keys(): List<String> = knownKeys.toList()

    fun peek(count: Int = 5): List<RecommendQueueItem> = items.take(count.coerceAtLeast(0))

    fun snapshot(): RadioQueueSnapshot =
        RadioQueueSnapshot(
            version = versionValue,
            size = items.size,
            items = items.toList(),
            keys = knownKeys.toList(),
        )

    /** 只有版本匹配时才接收异步生成结果，防止旧请求把旧队列写回来。 */
    fun enqueue(
        next: List<RecommendQueueItem>,
        token: Long,
    ): Boolean {
        if (token != versionValue) return false
        val accepted = mutableListOf<RecommendQueueItem>()
        for (item in next) {
            val key = RadioTrackKeys.buildTrackKey(item.musicInfo)
            if (knownKeys.contains(key)) continue
            knownKeys.add(key)
            accepted.add(item)
        }
        items.addAll(accepted)
        return accepted.isNotEmpty()
    }

    /** 切歌优先消费本地候选；版本不匹配返回空，不阻塞网络。 */
    fun shift(
        count: Int,
        token: Long,
    ): List<RecommendQueueItem> {
        if (token != versionValue || count <= 0) return emptyList()
        val taken = items.take(count)
        items = items.drop(count).toMutableList()
        for (item in taken) knownKeys.remove(RadioTrackKeys.buildTrackKey(item.musicInfo))
        return taken
    }

    fun removeTrackKey(trackKey: String): Int {
        val before = items.size
        items = items.filterNot { RadioTrackKeys.buildTrackKey(it.musicInfo) == trackKey }.toMutableList()
        if (items.size != before) rebuildKeys()
        return before - items.size
    }

    fun removeMany(
        trackKeys: Set<String>,
        token: Long? = null,
    ): Int {
        if (token != null && token != versionValue) return 0
        val before = items.size
        items = items.filterNot { trackKeys.contains(RadioTrackKeys.buildTrackKey(it.musicInfo)) }.toMutableList()
        if (items.size != before) rebuildKeys()
        return before - items.size
    }
}
