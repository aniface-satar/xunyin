package cn.toside.music.core.recommend.radio

import cn.toside.music.core.recommend.DislikeRules
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject

/**
 * 候选排除判定 —— RN `core/recommend/filter.ts` 移植。
 *
 * library / disliked / queued / session_played / recent_radio_7d 五类键判重，
 * 加上「歌单/歌手/歌名+歌手」三种显式屏蔽。全部只读集合，便于 JVM 单测。
 */
enum class ExclusionReason(
    val rn: String,
) {
    LIBRARY("library"),
    DISLIKED("disliked"),
    BLOCKED_SONG("blocked_song"),
    BLOCKED_ARTIST("blocked_artist"),
    BLOCKED_PAIR("blocked_pair"),
    QUEUED("queued"),
    SESSION_PLAYED("session_played"),
    RECENT_RADIO_7D("recent_radio_7d"),
}

data class ExclusionContext(
    val libraryKeys: Set<String> = emptySet(),
    /** 歌名+歌手字面完全一致的判重集合：跨音源排版差异归一后仍然同字段才算命中。 */
    val libraryPairKeys: Set<String> = emptySet(),
    val dislikedTrackKeys: Set<String> = emptySet(),
    val queuedTrackKeys: Set<String> = emptySet(),
    val sessionTrackKeys: Set<String> = emptySet(),
    val recentRadioTrackKeys: Set<String> = emptySet(),
    val blocked: DislikeRules = DislikeRules.EMPTY,
)

object RadioFilter {
    /** 与 utils/dislikeManage 的输出规则保持一致（均为小写）。 */
    const val DISLIKE_PAIR_SEPARATOR: String = "@"

    fun isDislikedByName(
        name: String,
        singer: String,
        blocked: DislikeRules,
    ): ExclusionReason? {
        val trackName = RadioTrackKeys.normalizeText(name)
        if (trackName.isEmpty()) return null
        if (blocked.musicNames.contains(trackName)) return ExclusionReason.BLOCKED_SONG
        for (artist in RadioTrackKeys.getArtistKeys(singer)) {
            if (blocked.singerNames.contains(artist)) return ExclusionReason.BLOCKED_ARTIST
            if (blocked.names.contains("$trackName$DISLIKE_PAIR_SEPARATOR$artist")) return ExclusionReason.BLOCKED_PAIR
        }
        return null
    }

    fun buildTrackIdentity(
        name: String?,
        singer: String?,
    ): String = RadioTrackKeys.canonicalTrackKey(name, singer)

    fun getExclusionReason(
        musicInfo: JsonObject,
        ctx: ExclusionContext,
    ): ExclusionReason? {
        val name = musicInfo.stringField("name").orEmpty()
        val singer = musicInfo.stringField("singer").orEmpty()
        val source = musicInfo.stringField("source")
        val songId =
            musicInfo.metaObject()?.get("songId")?.let { it !is JsonNull }
        val trackKey =
            if (!source.isNullOrEmpty() &&
                songId == true
            ) {
                RadioTrackKeys.buildTrackKey(musicInfo)
            } else {
                buildTrackIdentity(name, singer)
            }
        if (ctx.libraryKeys.contains(trackKey)) return ExclusionReason.LIBRARY
        // canonical key 会被歌名版本括号/歌手分隔符的排版差异绕过，字面完全一致的歌在这里兜底
        if (ctx.libraryPairKeys.isNotEmpty() && ctx.libraryPairKeys.contains(RadioTrackKeys.exactPairKey(name, singer))) {
            return ExclusionReason.LIBRARY
        }
        if (ctx.dislikedTrackKeys.contains(trackKey)) return ExclusionReason.DISLIKED
        if (ctx.queuedTrackKeys.contains(trackKey)) return ExclusionReason.QUEUED
        if (ctx.sessionTrackKeys.contains(trackKey)) return ExclusionReason.SESSION_PLAYED
        if (ctx.recentRadioTrackKeys.contains(trackKey)) return ExclusionReason.RECENT_RADIO_7D
        return isDislikedByName(name, singer, ctx.blocked)
    }

    /** 出队/补位前的排除复检（RN `isTrackExcluded`）。 */
    fun isExcluded(
        musicInfo: JsonObject,
        ctx: ExclusionContext,
    ): Boolean = getExclusionReason(musicInfo, ctx) != null
}
