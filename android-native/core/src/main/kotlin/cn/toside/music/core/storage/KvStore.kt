package cn.toside.music.core.storage

/**
 * 键值存储抽象 —— RN 侧 AsyncStorage（@react-native-async-storage）的等价接口。
 *
 * `:core` 只依赖此接口；app 模块提供 DataStore 实现（B1 映射表：
 * AsyncStorage → Jetpack DataStore），测试用 [InMemoryKvStore]。
 */
interface KvStore {
    /** 读取单键原始字符串值；不存在返回 null。 */
    suspend fun getString(key: String): String?

    /** 写入单键（整体替换）。 */
    suspend fun setString(
        key: String,
        value: String,
    )

    /** 删除单键。 */
    suspend fun remove(key: String)

    /** 批量删除。 */
    suspend fun removeMultiple(keys: List<String>)

    /** 全部键。 */
    suspend fun allKeys(): List<String>

    /** 清空全部数据。 */
    suspend fun clearAll()
}

/** 测试与预览用的内存实现。 */
class InMemoryKvStore : KvStore {
    private val map = mutableMapOf<String, String>()

    override suspend fun getString(key: String): String? = map[key]

    override suspend fun setString(
        key: String,
        value: String,
    ) {
        map[key] = value
    }

    override suspend fun remove(key: String) {
        map.remove(key)
    }

    override suspend fun removeMultiple(keys: List<String>) {
        keys.forEach { map.remove(it) }
    }

    override suspend fun allKeys(): List<String> = map.keys.toList()

    override suspend fun clearAll() {
        map.clear()
    }

    /** 测试辅助：当前内容快照。 */
    fun snapshot(): Map<String, String> = map.toMap()
}
