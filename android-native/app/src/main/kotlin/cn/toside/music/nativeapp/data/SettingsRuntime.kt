package cn.toside.music.nativeapp.data

import android.content.Context
import cn.toside.music.core.data.DataRepository
import cn.toside.music.core.setting.SettingsStore
import cn.toside.music.core.storage.ShardedKvStore
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * 设置运行时 —— DataStore → SettingsStore 的进程级单例。
 *
 * 与 [ListRuntime] 共用同一套 `@setting_v1` 键；设置页与播放运行时都从这里读，
 * 保证音质/歌词开关/音量均衡只有一个事实来源。
 */
class SettingsRuntime private constructor(
    context: Context,
) {
    private val repo = DataRepository(ShardedKvStore(DataStoreKvStore(context.applicationContext)))
    val store = SettingsStore(repo)
    private val loadLock = Mutex()
    private var loaded = false

    val state: StateFlow<Map<String, Any?>> get() = store.state

    suspend fun ensureLoaded() {
        if (loaded) return
        loadLock.withLock {
            if (loaded) return
            store.load()
            loaded = true
        }
    }

    companion object {
        /** RN 的 low/mid/high → VolumeBalancer 的 0/1/2。 */
        fun volumeBalancerLevelIndex(level: String): Int =
            when (level) {
                "low" -> 0
                "high" -> 2
                else -> 1
            }

        @Volatile
        private var instance: SettingsRuntime? = null

        fun get(context: Context): SettingsRuntime =
            instance ?: synchronized(this) {
                instance ?: SettingsRuntime(context.applicationContext).also { instance = it }
            }
    }
}
