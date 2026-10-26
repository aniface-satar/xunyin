package cn.toside.music.core.recommend

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray

/**
 * 踩雷规则解析 —— RN `utils/dislikeManage.ts` 的 `updateDislikeInfo` 纯规则部分。
 *
 * 规则文本每行一条：`歌名@歌手`（组合规则进 names）、`歌名`（进 musicNames）、
 * `@歌手`（进 singerNames）；`@` 是分隔符，规则文本里歌手名内出现的 `@`
 * 与 RN 一致不做别名转义（RN 的 DISLIKE_NAME_ALIAS 处理保持同语义）。
 * Kotlin 侧从 `@dislike_list` 原始字符串解析，与 RN 读写同一存储语义。
 */
object DislikeRulesParser {
    /** RN SPLIT_CHAR.DISLIKE_NAME。 */
    const val SPLIT_CHAR = "@"

    fun parse(rules: String): DislikeRules {
        val names = mutableSetOf<String>()
        val musicNames = mutableSetOf<String>()
        val singerNames = mutableSetOf<String>()
        for (item in rules.split('\n')) {
            if (item.isEmpty()) continue
            val idx = item.indexOf(SPLIT_CHAR)
            val name: String?
            val singer: String?
            if (idx >= 0) {
                name = item.substring(0, idx).ifEmpty { null }
                singer = item.substring(idx + 1)
            } else {
                name = item
                singer = null
            }
            if (name != null) {
                val normalized = name.lowercase().trim()
                if (singer != null && singer.isNotEmpty()) {
                    val normalizedSinger = singer.lowercase().trim()
                    // 组合规则键：`歌名@歌手`（对照 RN dislikeInfo.names）
                    names.add("$normalized$SPLIT_CHAR$normalizedSinger")
                } else {
                    musicNames.add(normalized)
                }
            } else if (singer != null && singer.isNotEmpty()) {
                singerNames.add(singer.lowercase().trim())
            }
        }
        return DislikeRules(names, musicNames, singerNames)
    }

    /** RN getDislikeListRules 的原始文本读取等价物：KvStore 直接给文本。 */
    fun parseFromStorage(raw: String?): DislikeRules = parse(raw ?: "")

    /** RN DISLIKE_NAME_ALIAS：规则文本里不允许出现裸分隔符，与 RN 一致转义成 `#`。 */
    private const val SPLIT_CHAR_ALIAS = "#"

    private fun normalizeRulePart(part: String): String = part.replace(SPLIT_CHAR, SPLIT_CHAR_ALIAS).lowercase().trim()

    /**
     * 规则文本归一化 —— RN `utils/dislikeManage.ts` 的 `updateDislikeInfo` 写侧。
     *
     * 不感兴趣写入时 RN 会整体重写规则文本：逐行归一化、去空行、去重（保序）。
     * 归一化结果与 [parse] 的读取语义必须一致，因此两侧都走同一份规则格式。
     */
    fun normalize(raw: String): String {
        val list = mutableListOf<String>()
        for (item in raw.split('\n')) {
            if (item.isEmpty()) continue
            val idx = item.indexOf(SPLIT_CHAR)
            if (idx >= 0) {
                val name = normalizeRulePart(item.substring(0, idx))
                val singer = normalizeRulePart(item.substring(idx + 1))
                when {
                    name.isNotEmpty() && singer.isNotEmpty() -> list.add("$name$SPLIT_CHAR$singer")
                    name.isNotEmpty() -> list.add(name)
                    singer.isNotEmpty() -> list.add("$SPLIT_CHAR$singer")
                }
            } else {
                val name = normalizeRulePart(item)
                if (name.isNotEmpty()) list.add(name)
            }
        }
        return list.distinct().joinToString("\n")
    }

    /** RN `addDislikeInfo`：追加一条 `歌名@歌手` 规则后整体重写（空字段按规则退化）。 */
    fun appendRule(
        raw: String,
        name: String?,
        singer: String?,
    ): String {
        val line = "${name.orEmpty()}$SPLIT_CHAR${singer.orEmpty()}"
        return normalize(if (raw.isEmpty()) line else "$raw\n$line")
    }
}

/**
 * 画像信号提取 —— 从原生已有的 JsonObject 曲目表（ListStore / 播放历史）
 * 提取 [ProfileTrack]。core 不依赖具体音源结构，字段读取与 RN
 * `buildCurrentProfile` 一致：name/singer 直取 MusicInfo 顶层。
 */
object ProfileSignals {
    fun trackOf(musicInfo: JsonObject): ProfileTrack =
        ProfileTrack(
            name = musicInfo.str("name"),
            singer = musicInfo.str("singer"),
        )

    fun tracksOf(musicList: List<JsonObject>): List<ProfileTrack> = musicList.map { trackOf(it) }

    private fun JsonObject.str(key: String): String? =
        (this[key] as? kotlinx.serialization.json.JsonPrimitive)?.takeIf { it !is kotlinx.serialization.json.JsonNull }?.content
}

/**
 * 画像输入装配 —— 把原生各信号表合成 [ProfileInput] 的纯规则（不做 IO）。
 *
 * - 收藏/自建歌单：ListStore 的同形曲目表；
 * - 播放历史：`@play_history` 的解析结果（带真实 playTime）；
 * - 实时曲目：PlayerCore `playedList`（个性电台；没有 playTime，按装配时刻计入）。
 *
 * 实时曲目与历史按「归一化歌名@歌手」去重：历史带真实时间，优先保留；
 * 去重避免同一首歌在一轮装配里被记两次权重。
 */
object ProfileInputAssembler {
    /** 画像只看最近 100 条历史（与 RN `buildCurrentProfile` 的近期视线同量级）。 */
    const val HISTORY_LIMIT = 100

    fun assemble(
        loveTracks: List<JsonObject>,
        userListTracks: List<JsonObject>,
        storedHistory: List<ProfileHistoryEntry>,
        livePlayed: List<JsonObject> = emptyList(),
        livePlayedAt: Long,
        historyLimit: Int = HISTORY_LIMIT,
    ): ProfileInput {
        val history = storedHistory.take(historyLimit).toMutableList()
        val seen = history.map { trackKey(it.track) }.toMutableSet()
        for (musicInfo in livePlayed) {
            if (history.size >= historyLimit) break
            val track = ProfileSignals.trackOf(musicInfo)
            if (track.name.isNullOrEmpty() && track.singer.isNullOrEmpty()) continue
            if (!seen.add(trackKey(track))) continue
            history += ProfileHistoryEntry(track, livePlayedAt)
        }
        return ProfileInput(
            loveTracks = ProfileSignals.tracksOf(loveTracks),
            userListTracks = ProfileSignals.tracksOf(userListTracks),
            playHistory = history,
        )
    }

    private fun trackKey(track: ProfileTrack): String = TrackKeys.normalizeText(track.name) + "@" + TrackKeys.normalizeText(track.singer)
}

/** 播放历史条目解析（RN `LX.Player.PlayHistoryItem`：musicInfo + playTime）。 */
object PlayHistoryParser {
    fun parse(raw: String?): List<ProfileHistoryEntry> {
        if (raw.isNullOrEmpty()) return emptyList()
        val array =
            runCatching { Json.parseToJsonElement(raw).jsonArray }.getOrNull() ?: return emptyList()
        return array.mapNotNull { element ->
            val obj = element as? JsonObject ?: return@mapNotNull null
            val musicInfo = obj["musicInfo"] as? JsonObject ?: return@mapNotNull null
            val playTime = (obj["playTime"] as? kotlinx.serialization.json.JsonPrimitive)?.content?.toLongOrNull() ?: return@mapNotNull null
            ProfileHistoryEntry(ProfileSignals.trackOf(musicInfo), playTime)
        }
    }
}
