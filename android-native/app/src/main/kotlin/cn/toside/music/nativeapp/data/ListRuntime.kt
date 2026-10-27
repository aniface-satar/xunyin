package cn.toside.music.nativeapp.data

import android.content.Context
import cn.toside.music.core.data.DataRepository
import cn.toside.music.core.list.ListStore
import cn.toside.music.core.list.MusicStatsStore
import cn.toside.music.core.storage.ShardedKvStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonObject

/**
 * 列表运行时 —— B5 第一切片：把 B1 的 [ListStore]/[DataRepository] 接到原生壳。
 *
 * 存储链与 B1 一致：DataStore（键）→ ShardedKvStore（RN 分片协议）→
 * DataRepository（data.ts 语义）→ ListStore（listManage.ts 语义）。
 * 播放列表 sheet 与歌单页都从这里取数据，避免两套缓存。
 */
class ListRuntime private constructor(
    context: Context,
) {
    /** 应用上下文（[RecommendProfileRuntime] 复用同一 DataStore 读画像信号）。 */
    val appContext: Context = context.applicationContext

    private val repo =
        DataRepository(
            ShardedKvStore(DataStoreKvStore(appContext)),
        )

    /** 歌曲列表元数据（添加时间 / 播放次数），与 [store] 共用同一持久层。 */
    val stats = MusicStatsStore(repo)

    val store = ListStore(repo, stats)

    private val loadLock = Mutex()
    private var loaded = false

    private val _ready = MutableStateFlow(false)

    /** 用户歌单元信息就绪信号（首页订阅后刷新列表）。 */
    val ready: StateFlow<Boolean> = _ready.asStateFlow()

    /** 读取用户歌单；多次调用只真正加载一次。 */
    suspend fun ensureLoaded() {
        if (loaded) return
        loadLock.withLock {
            if (loaded) return
            store.loadUserLists()
            loaded = true
            _ready.value = true
        }
    }

    /** 列表内歌曲（按 [listId] 区分 default/love/temp/user-*）。 */
    suspend fun musics(listId: String): List<JsonObject> {
        ensureLoaded()
        return store.getListMusics(listId)
    }

    companion object {
        @Volatile
        private var instance: ListRuntime? = null

        fun get(context: Context): ListRuntime =
            instance ?: synchronized(this) {
                instance ?: ListRuntime(context.applicationContext).also { instance = it }
            }

        /** 已建实例；未初始化返回 null（无参 object 的装配层取上下文用）。 */
        fun current(): ListRuntime? = instance
    }
}
