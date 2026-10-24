package cn.toside.music.core.setting

import cn.toside.music.core.data.DataRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * 应用设置读写 —— RN `src/config/setting.ts#updateSetting` + `store/setting` 的移植。
 *
 * 读取语义：默认表打底，持久层里的同键原始值覆盖；未知键与 null 值忽略
 * （RN `mergeSetting` 只接受 primitive 且键必须存在于默认表）。
 * 写入语义：改一个键即整体写回（RN 也是整表 saveData），`version` 每次对齐当前版本。
 */
class SettingsStore(
    private val repo: DataRepository,
) {
    private val mutex = Mutex()
    private val _state = MutableStateFlow(DefaultSetting.defaultSetting())
    private var loaded = false

    val state: StateFlow<Map<String, Any?>> = _state

    suspend fun load() =
        mutex.withLock {
            if (loaded) return@withLock
            _state.value = merge(DefaultSetting.defaultSetting(), repo.getSetting())
            loaded = true
        }

    fun get(key: String): Any? = _state.value[key]

    fun string(key: String): String = _state.value[key] as? String ?: ""

    fun bool(key: String): Boolean = _state.value[key] as? Boolean ?: false

    fun int(key: String): Int = (_state.value[key] as? Number)?.toInt() ?: 0

    fun double(key: String): Double = (_state.value[key] as? Number)?.toDouble() ?: 0.0

    suspend fun set(
        key: String,
        value: Any?,
    ) = mutex.withLock {
        val next = _state.value.toMutableMap()
        next[key] = value
        next["version"] = DefaultSetting.SETTING_VERSION
        _state.value = next
        repo.saveSetting(toJson(next))
    }

    private fun toJson(setting: Map<String, Any?>): JsonObject =
        buildJsonObject {
            for ((key, value) in setting) put(key, value.toJsonElement())
        }

    private fun Any?.toJsonElement(): JsonElement =
        when (this) {
            null -> JsonNull
            is Boolean -> JsonPrimitive(this)
            is Number -> JsonPrimitive(this)
            is String -> JsonPrimitive(this)
            else -> JsonPrimitive(toString())
        }

    companion object {
        /** 默认表 + 持久层覆盖（类型跟随默认值，避免 210 被读成 210.0）。 */
        fun merge(
            defaults: Map<String, Any?>,
            saved: JsonObject?,
        ): Map<String, Any?> {
            val result = defaults.toMutableMap()
            if (saved != null) {
                for ((key, element) in saved) {
                    val default = defaults[key] ?: continue
                    val primitive = element as? JsonPrimitive ?: continue
                    if (primitive is JsonNull) continue
                    result[key] =
                        when (default) {
                            is Boolean -> primitive.content.toBooleanStrictOrNull() ?: continue
                            is Int -> primitive.content.toIntOrNull() ?: continue
                            is Long -> primitive.content.toLongOrNull() ?: continue
                            is Double -> primitive.content.toDoubleOrNull() ?: continue
                            else -> primitive.content
                        }
                }
            }
            result["version"] = DefaultSetting.SETTING_VERSION
            return result
        }
    }
}
