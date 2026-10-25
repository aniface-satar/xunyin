package cn.toside.music.core.recommend

import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json

/**
 * 画像持久层 —— 对照 RN `core/recommend/storage.ts` 的 M1 子集。
 *
 * RN 把整个 RecommendationState 存进一个键（`xunyin_recommend_state_v2`，
 * 1500ms 防抖、落盘前剥离候选缓存）。M1 只持久化装配结果
 * [LearnedProfile]（artistStats/tokenWeights/keywords），键名对齐 RN；
 * 其余字段（bandit/候选缓存/电台历史）M1 不产生，不写。
 *
 * 与 RN 的形状差异：RN 存的是「原始学习状态」，重排时在线衰减；
 * Kotlin M1 存的是「装配好的画像」（[RecommendProfile.build] 的输出）。
 * 同一键名下两版数据不互通（RN 侧对象含 version/tracks 等大量字段，
 * Kotlin 读取时按自身 schema 解析、失败即视为空画像重新装配）——
 * 本应用原生版与 RN 版不共享存储（B1 决策），键名对齐只为将来统一预留。
 */
object RecommendProfileStore {
    /** RN `storage.ts` 的 RECOMMEND_STATE_KEY。 */
    const val STATE_KEY = "xunyin_recommend_state_v2"

    private val json =
        Json {
            ignoreUnknownKeys = true
            encodeDefaults = true
        }
    private val serializer = LearnedProfile.serializer()

    /** 读取画像；无数据/解析失败返回 null（冷启动，由调用方重新装配）。 */
    fun load(raw: String?): LearnedProfile? {
        if (raw.isNullOrEmpty()) return null
        return runCatching { json.decodeFromString(serializer, raw) }.getOrNull()
    }

    /** 序列化画像供落盘。 */
    fun save(profile: LearnedProfile): String = json.encodeToString(serializer, profile)

    /** 画像裁剪：对照 RN trimState 中 themeWeights/tokenWeights/artistStats 三个限额。 */
    fun trim(
        profile: LearnedProfile,
        themeWeightLimit: Int = 200,
        artistStatsLimit: Int = 800,
    ): LearnedProfile {
        fun trimMap(
            map: Map<String, ThemePreference>,
            limit: Int,
        ): Map<String, ThemePreference> =
            if (map.size <= limit) {
                map
            } else {
                map.entries
                    .sortedByDescending { it.value.positiveWeight + it.value.negativeWeight }
                    .take(limit)
                    .associate { it.key to it.value }
            }

        return profile.copy(
            artistStats = trimMap(profile.artistStats, artistStatsLimit),
            tokenWeights = trimMap(profile.tokenWeights, themeWeightLimit),
        )
    }

    /** 隐藏歌单名单的独立读写（对照 RN hiddenPlaylists，M1 无「不感兴趣」入口，读侧预留）。 */
    fun loadHidden(raw: String?): Map<String, Long> {
        if (raw.isNullOrEmpty()) return emptyMap()
        return runCatching {
            Json.decodeFromString(MapSerializer(String.serializer(), Long.serializer()), raw)
        }.getOrDefault(emptyMap())
    }

    fun saveHidden(hidden: Map<String, Long>): String =
        Json.encodeToString(
            MapSerializer(String.serializer(), Long.serializer()),
            hidden,
        )
}
