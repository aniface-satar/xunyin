package cn.toside.music.core.recommend.radio

import cn.toside.music.core.recommend.TrackKeys
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.text.Normalizer

/**
 * 电台判重键 —— RN `core/recommend/trackKey.ts` 的 M2 子集。
 *
 * M1 的 [TrackKeys] 只有 normalizeText/splitSinger/getArtistKeys；这里补上
 * 版本标记、canonical key、精确判重键与 JsonObject 版 buildTrackKey。
 * 相似度/录音判等（isSameRecording 等）服务 M3，不移植；M3 的 diversity 退化为
 * 通道配额抽样，不需要同作品软降频。
 */
object RadioTrackKeys {
    private val VERSION_MARKERS =
        listOf(
            "live",
            "remix",
            "cover",
            "acoustic",
            "instrumental",
            "伴奏",
            "现场",
            "翻唱",
            "纯音乐",
            "dj",
            "piano",
            "demo",
            "karaoke",
            "演唱会",
            "演奏",
            "不插电",
            "清唱",
            "人声版",
        )

    private val BRACKET_RXP = Regex("[(\\[](.*?)[)\\]]")
    private val BRACKET_EDGE_RXP = Regex("^[(\\[]|[)\\]]$")
    private val TAIL_RXP = Regex("(?:\\s*[-–—]\\s*|\\s+)([a-z0-9\\u4e00-\\u9fa5\\s]+?)(?:版|version|ver\\.?)?$")
    private val BASE_BRACKET_RXP = Regex("[([][^)\\]]*[)\\]]")
    private val BASE_TAIL_RXP =
        Regex(
            "\\s*[-–—]\\s*(?:live|remix|cover|acoustic|instrumental|伴奏|现场|翻唱|纯音乐|dj|piano|demo|karaoke|演唱会|演奏|不插电|清唱)\\s*版?\\s*$",
            RegexOption.IGNORE_CASE,
        )
    private val BASE_SUFFIX_RXP =
        Regex(
            "\\s*(?:live|remix|cover|acoustic|instrumental|伴奏|现场|翻唱|纯音乐|dj|piano|demo|karaoke|演唱会|演奏|不插电|清唱)\\s*版?$",
            RegexOption.IGNORE_CASE,
        )

    fun normalizeText(text: String?): String = TrackKeys.normalizeText(text)

    private fun hasMarker(text: String): Boolean = VERSION_MARKERS.any { text.contains(it) }

    fun getVersionLabel(name: String?): String {
        val raw = (name ?: "").trim()
        if (raw.isEmpty()) return ""
        val lower = raw.lowercase()

        for (match in BRACKET_RXP.findAll(raw)) {
            val inner = normalizeText(BRACKET_EDGE_RXP.replace(match.value, ""))
            if (inner.isNotEmpty() && hasMarker(inner)) return inner
        }

        val tail = TAIL_RXP.find(lower)
        if (tail != null && hasMarker(tail.groupValues[1])) return normalizeText(tail.groupValues[1])

        for (marker in VERSION_MARKERS) {
            if (lower.contains(marker)) return marker
        }
        return ""
    }

    fun getBaseName(name: String?): String {
        var base = (name ?: "").trim()
        base = BASE_BRACKET_RXP.replace(base, " ")
        base = BASE_TAIL_RXP.replace(base, " ")
        base = BASE_SUFFIX_RXP.replace(base, " ")
        val normalized = normalizeText(base)
        return normalized.ifEmpty { normalizeText(name) }
    }

    fun canonicalTrackKey(
        name: String?,
        singer: String?,
    ): String {
        val base = getBaseName(name)
        val version = getVersionLabel(name)
        val artist = normalizeText(singer)
        return if (version.isNotEmpty()) "ns:$base[$version]__$artist" else "ns:${base}__$artist"
    }

    fun canonicalWorkKey(
        name: String?,
        singer: String?,
    ): String = "work:${getBaseName(name)}__${normalizeText(singer)}"

    fun normalizeExactText(text: String?): String =
        normalizeText(
            Normalizer
                .normalize(text ?: "", Normalizer.Form.NFKC)
                .replace(Regex("[’‘ʼ`´]"), "'")
                .replace(Regex("[“＂]"), "\""),
        )

    fun exactPairKey(
        name: String?,
        singer: String?,
    ): String {
        val artists = TrackKeys.getArtistKeys(singer).map { normalizeExactText(it) }.sorted()
        return "pair:${normalizeExactText(name)}__${artists.joinToString("+")}"
    }

    fun buildTrackKey(musicInfo: JsonObject): String {
        val source = musicInfo.stringField("source")
        if (source == "local") return "local:${musicInfo.stringField("id").orEmpty()}"
        return canonicalTrackKey(musicInfo.stringField("name"), musicInfo.stringField("singer"))
    }

    fun buildTrackKey(
        name: String?,
        singer: String?,
    ): String = canonicalTrackKey(name, singer)

    fun getArtistKeys(singer: String?): List<String> = TrackKeys.getArtistKeys(singer)

    fun getArtistKeys(musicInfo: JsonObject): List<String> = TrackKeys.getArtistKeys(musicInfo.stringField("singer"))

    fun getPrimaryArtist(musicInfo: JsonObject): String = TrackKeys.splitSinger(musicInfo.stringField("singer")).firstOrNull().orEmpty()

    fun getAlbumName(musicInfo: JsonObject): String {
        val meta = musicInfo["meta"] as? JsonObject
        return ((meta?.get("albumName") as? JsonPrimitive)?.content ?: musicInfo.stringField("albumName")).orEmpty().trim()
    }
}

internal fun JsonObject.stringField(key: String): String? {
    val value = this[key] as? JsonPrimitive ?: return null
    return if (value is kotlinx.serialization.json.JsonNull) null else value.content
}

internal fun JsonObject.metaObject(): JsonObject? = this["meta"] as? JsonObject
