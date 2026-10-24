package cn.toside.music.core.storage

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive

/**
 * 分片兼容存储门面 —— RN 侧 src/plugins/storage.ts（saveData/getData/...）的等价物。
 *
 * 在 [KvStore] 之上实现 RN 的分片存储协议：
 * - 值以 JSON 字符串存储（RN JSON.stringify 语义）；
 * - 超过 500k 字符自动分片（@___PART_A___ v2 机制）；
 * - 读取时透明拼接 v1（@___PART___ 逗号拼接）/ v2 两种历史分片格式。
 *
 * 这是 B1 映射表「AsyncStorage → DataStore」的核心兼容层：
 * RN 版写入的分片数据在这里可无损读出，反之亦然。
 */
class ShardedKvStore(
    private val store: KvStore,
) {
    private val json = Json { ignoreUnknownKeys = true }

    /** 值的完整 JSON 串（分片透明拼接）；无分片标记时原样返回。 */
    private suspend fun fullJsonOf(
        key: String,
        value: String,
    ): String? {
        val v2Keys = PartStore.partKeysOf(value)
        if (v2Keys != null) {
            val parts = v2Keys.mapNotNull { store.getString(it) }
            if (parts.size != v2Keys.size) return null // 分片缺失 → 视为损坏
            return PartStore.joinParts(parts)
        }
        val v1Keys = PartStore.legacyPartKeysOf(value)
        if (v1Keys != null) {
            val parts = v1Keys.mapNotNull { store.getString(it) }
            if (parts.size != v1Keys.size) return null
            return PartStore.joinParts(parts)
        }
        return value
    }

    /** RN getData：读键 → JSON 解析。不存在/损坏返回 null。 */
    suspend fun <T : JsonElement> getData(key: String): T? {
        val value = store.getString(key) ?: return null
        val fullJson = fullJsonOf(key, value) ?: return null
        return runCatching { json.parseToJsonElement(fullJson) as T }.getOrNull()
    }

    /** RN saveData：JSON 序列化 → 超 500k 分片写入。 */
    suspend fun saveData(
        key: String,
        value: JsonElement,
    ) {
        val valueJson = value.toString()
        val datas = PartStore.buildData(key, valueJson)
        removeData(key) // RN 行为：先删旧值（含旧分片）再写
        for ((k, v) in datas) {
            store.setString(k, v)
        }
    }

    /** 直接存字符串值（不经 JSON 数值包装：等价 RN saveData(key, "str")，存储形式 `"str"`）。 */
    suspend fun saveString(
        key: String,
        value: String,
    ) {
        saveData(key, JsonPrimitive(value))
    }

    /** 读取字符串值（JSON 解码语义，对应 RN getData<string>）。 */
    suspend fun getString(key: String): String? {
        val v = getData<JsonPrimitive>(key) ?: return null
        return if (v is JsonPrimitive && v !is kotlinx.serialization.json.JsonNull) v.content else null
    }

    /** RN removeData：连分片键一起删（v1/v2 两种格式）。 */
    suspend fun removeData(key: String) {
        val value = store.getString(key)
        val keys = mutableListOf(key)
        if (value != null) {
            PartStore.legacyPartKeysOf(value)?.let { keys.addAll(it) }
            PartStore.partKeysOf(value)?.let { keys.addAll(it) }
        }
        store.removeMultiple(keys)
    }

    /** RN removeDataMultiple。 */
    suspend fun removeDataMultiple(keys: List<String>) {
        if (keys.isEmpty()) return
        val allKeys = mutableListOf<String>()
        for (key in keys) {
            allKeys.add(key)
            val value = store.getString(key)
            if (value != null) {
                PartStore.legacyPartKeysOf(value)?.let { allKeys.addAll(it) }
                PartStore.partKeysOf(value)?.let { allKeys.addAll(it) }
            }
        }
        store.removeMultiple(allKeys)
    }

    /** RN clearAll。 */
    suspend fun clearAll() = store.clearAll()
}
