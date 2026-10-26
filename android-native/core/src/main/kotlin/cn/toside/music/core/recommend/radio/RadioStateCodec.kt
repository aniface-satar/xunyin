package cn.toside.music.core.recommend.radio

import kotlinx.serialization.json.Json

/**
 * 电台状态编解码 —— RN `core/recommend/storage.ts` 的序列化部分。
 *
 * 只做 JSON 编解码与形状兜底：读写时机（1500ms 防抖）、键名与分片由 app 侧
 * `RadioStateStore` 决定。解析失败一律返回 null（冷启动回空状态），
 * 与 RN「storage 损坏即重建」一致。
 */
object RadioStateCodec {
    private val json =
        Json {
            ignoreUnknownKeys = true
            encodeDefaults = true
        }

    fun encode(state: RadioState): String = json.encodeToString(RadioState.serializer(), state)

    fun decode(raw: String?): RadioState? {
        if (raw.isNullOrEmpty() || raw == "null") return null
        return runCatching { json.decodeFromString(RadioState.serializer(), raw) }.getOrNull()
    }
}
