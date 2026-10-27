package cn.toside.music.core.list

import cn.toside.music.core.data.DataRepository
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * 歌曲列表元数据（添加时间 / 播放次数）—— 对照 RN `src/utils/data.ts`。
 *
 * - 添加时间键为 `${listId}/${musicId}`，值为 epoch 毫秒；
 * - 播放次数以 musicId 为键，每次进播放历史 +1；
 * - 内存快照按需加载一次，之后写穿持久层（RN 同语义，只把 1s 节流换成同步写）。
 *
 * 写入时机对齐 RN `core/list.ts#initMusicAddTimeTracker`：仅加歌/移动；
 * 覆盖、导入、删除都不动时间戳。
 */
class MusicStatsStore(
    private val repo: DataRepository,
) {
    private val mutex = Mutex()
    private var addTimes: Map<String, Long>? = null
    private var playCounts: Map<String, Long>? = null

    /** 添加时间快照（key = `${listId}/${musicId}`）。 */
    suspend fun addTimes(): Map<String, Long> = mutex.withLock { addTimes ?: repo.getMusicAddTimes().also { addTimes = it } }

    /** 播放次数快照（key = musicId）。 */
    suspend fun playCounts(): Map<String, Long> = mutex.withLock { playCounts ?: repo.getMusicPlayCounts().also { playCounts = it } }

    /**
     * RN `stampMusicAddTimes`：整批写同一时间戳。
     * 重复项与已在列表里的曲目同样重打（RN 事件监听就是这么调的）。
     */
    suspend fun stampAddTimes(
        listId: String,
        musicIds: List<String>,
        now: Long = System.currentTimeMillis(),
    ) {
        if (musicIds.isEmpty()) return
        mutex.withLock {
            val next = (addTimes ?: repo.getMusicAddTimes()).toMutableMap()
            for (musicId in musicIds) next["$listId/$musicId"] = now
            addTimes = next
            repo.saveMusicAddTimes(next)
        }
    }

    /** RN `addMusicPlayCount`：播放次数 +1（无记录按 0 起算）。 */
    suspend fun addPlayCount(musicId: String) {
        if (musicId.isEmpty()) return
        mutex.withLock {
            val next = (playCounts ?: repo.getMusicPlayCounts()).toMutableMap()
            next[musicId] = (next[musicId] ?: 0L) + 1L
            playCounts = next
            repo.saveMusicPlayCounts(next)
        }
    }
}
