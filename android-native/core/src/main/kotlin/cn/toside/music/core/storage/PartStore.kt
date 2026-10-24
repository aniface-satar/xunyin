package cn.toside.music.core.storage

/**
 * AsyncStorage 分片存储编解码 —— 从 RN 侧 src/plugins/storage.ts 精确移植。
 *
 * 背景：RN 版把超过 500k 字符的 JSON 值切成多个键存储（PART 机制）。
 * 迁移到 DataStore 时必须能读回这些旧分片数据（B1 映射表：
 * AsyncStorage → DataStore 的兼容层）。
 *
 * 两种历史格式：
 * 1. v1.4.0 前：'@___PART___' + 分片键逗号拼接（键内容与分隔符冲突，已废弃）
 * 2. v1.4.0 起：'@___PART_A___' + 分片键数组的 JSON
 *
 * 新写入一律用 v2 格式。
 */
object PartStore {
    const val PART_KEY_PREFIX = "@___PART___"
    const val PART_KEY_ARR_PREFIX = "@___PART_A___"
    private val PART_KEY_ARR_RX = Regex("^@___PART_A___")
    private const val LIMIT = 500_000
    private const val KEY_SPLIT = ","

    /** 分片键列表（数据键 → 分片键们）；非分片键返回 null。 */
    fun partKeysOf(value: String): List<String>? {
        if (value.startsWith(PART_KEY_ARR_PREFIX)) {
            val json = value.replaceFirst(PART_KEY_ARR_RX, "")
            return runCatching {
                // JSON 数组解析（不引入依赖，键名仅含 [A-Za-z0-9_@.:-]）
                JsonArrayParser.parse(json)
            }.getOrNull()
        }
        return null
    }

    /**
     * 构建 [key] 的存储键值对（数据键/分片键 → JSON 串）。
     * 与 RN buildData 一致：超限时根键存 '@___PART_A___["分片键",...]'，
     * 每个分片键存对应片段。
     */
    fun buildData(
        key: String,
        valueJson: String,
    ): List<Pair<String, String>> {
        if (valueJson.length <= LIMIT) return listOf(key to valueJson)

        val datas = mutableListOf<Pair<String, String>>()
        val partKeys = mutableListOf<String>()
        val len = valueJson.length / LIMIT
        for (i in 0..len) {
            val partKey = "${PART_KEY_ARR_PREFIX}${key}$i"
            partKeys.add(partKey)
            val end = minOf(valueJson.length, (i + 1) * LIMIT)
            datas.add(partKey to valueJson.substring(i * LIMIT, end))
        }
        datas.add(key to PART_KEY_ARR_PREFIX + partKeys.joinToString(prefix = "[", separator = ",", postfix = "]") { "\"$it\"" })
        return datas
    }

    /** 按 [buildData] 的逆操作拼接分片。 */
    fun joinParts(parts: List<String>): String = parts.joinToString("")

    /** v1（逗号拼接）格式的分片键解析——仅用于读旧数据。 */
    fun legacyPartKeysOf(value: String): List<String>? {
        if (!value.startsWith(PART_KEY_PREFIX)) return null
        if (value.startsWith(PART_KEY_ARR_PREFIX)) return null // v2 优先
        return value.substring(PART_KEY_PREFIX.length).split(KEY_SPLIT)
    }

    /** 极简 JSON 字符串数组解析（分片键数组专用）。 */
    private object JsonArrayParser {
        fun parse(json: String): List<String> {
            require(json.startsWith("[") && json.endsWith("]")) { "not a JSON array" }
            val inner = json.substring(1, json.length - 1).trim()
            if (inner.isEmpty()) return emptyList()
            return inner.split(",").map { el ->
                val t = el.trim()
                require(t.startsWith("\"") && t.endsWith("\"")) { "unexpected element: $t" }
                t.substring(1, t.length - 1)
            }
        }
    }
}
