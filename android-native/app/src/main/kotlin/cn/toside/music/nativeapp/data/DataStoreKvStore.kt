package cn.toside.music.nativeapp.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import cn.toside.music.core.storage.KvStore
import kotlinx.coroutines.flow.first

/**
 * [KvStore] 的 Jetpack DataStore 实现 —— B1 映射表「AsyncStorage → DataStore」。
 *
 * 每键一条 Preferences 记录；键名沿用 RN storageDataPrefix 全表
 * （见 [cn.toside.music.core.storage.StorageKeys]），与 ShardedKvStore
 * 分片协议叠加后，RN 版写的数据在原生版可读。
 *
 * 注意：DataStore 文件独立于 RN 的 AsyncStorage SQLite，双版本并行期
 * 各管各的存储（B7 收官批做一次性迁移导入）。
 */
private val Context.dataStore by preferencesDataStore(name = "xunyin_kv")

class DataStoreKvStore(
    private val context: Context,
) : KvStore {
    override suspend fun getString(key: String): String? {
        val prefs = context.dataStore.data.first()
        return prefs[stringPreferencesKey(key)]
    }

    override suspend fun setString(
        key: String,
        value: String,
    ) {
        context.dataStore.edit { prefs ->
            prefs[stringPreferencesKey(key)] = value
        }
    }

    override suspend fun remove(key: String) {
        context.dataStore.edit { prefs ->
            prefs.remove(stringPreferencesKey(key))
        }
    }

    override suspend fun removeMultiple(keys: List<String>) {
        context.dataStore.edit { prefs ->
            for (key in keys) {
                prefs.remove(stringPreferencesKey(key))
            }
        }
    }

    override suspend fun allKeys(): List<String> {
        val prefs = context.dataStore.data.first()
        return prefs.asMap().keys.map { it.name }
    }

    override suspend fun clearAll() {
        context.dataStore.edit { it.clear() }
    }
}
