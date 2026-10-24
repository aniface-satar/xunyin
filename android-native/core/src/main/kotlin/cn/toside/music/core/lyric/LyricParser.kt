package cn.toside.music.core.lyric

/**
 * LRC 解析 —— RN 侧 `lrc-file-parser@2.4.2` 的静态部分移植。
 *
 * 只移植「文本 → 行表」和「时间 → 行号」两段纯逻辑；逐帧推进/定时器属于 UI 层，
 * Compose 用播放位置每帧重算行号即可，语义与库的 `_findCurLineNum` 一致。
 */
data class LyricTags(
    val title: String = "",
    val artist: String = "",
    val album: String = "",
    val offset: Int = 0,
    val by: String = "",
)

data class LyricLine(
    val timeMs: Long,
    val text: String,
    val extendedLyrics: List<String> = emptyList(),
)

data class ParsedLyric(
    val lines: List<LyricLine> = emptyList(),
    val tags: LyricTags = LyricTags(),
) {
    /**
     * 当前行号。`extraOffsetMs` 对应 RN 初始化时固定传入的 `offset: 100`，
     * [LyricParser] 会在其之上再加 `[offset:]` 标签值。
     */
    fun indexAt(
        positionMs: Long,
        extraOffsetMs: Int = LyricParser.DEFAULT_OFFSET_MS,
    ): Int = LyricParser.indexAt(lines, positionMs, extraOffsetMs, tags.offset)

    fun lineAt(
        positionMs: Long,
        extraOffsetMs: Int = LyricParser.DEFAULT_OFFSET_MS,
    ): LyricLine? = lines.getOrNull(indexAt(positionMs, extraOffsetMs))
}

object LyricParser {
    /**
     * RN 的插件初始化固定 `offset: 100`：歌词行比播放位置提前 100ms 切过去。
     * 逐帧渲染时也按这个值算，否则和 RN 版差一行。
     */
    const val DEFAULT_OFFSET_MS = 100

    // 行首连续的时间标签：[mm:ss.xx][mm:ss.yy]
    private val TIME_FIELD = Regex("""^(?:\[[\d:.]+])+""")

    // 单个时间值，必须有小数位；[00:03] 这类没有小数的标签整行丢弃（库的原行为）
    private val TIME = Regex("""\d{1,3}(?::\d{1,3}){0,2}(?:\.\d{1,3})""")

    // 任意一个三位小数的时间标签存在时，全曲按毫秒位解释小数部分
    private val MS_TIME = Regex("""\[\d{1,3}(?::\d{1,3}){0,2}\.\d{3}]""")

    private val LEADING_ZEROS = Regex("^0+(\\d+)")
    private val COLON_ZEROS = Regex(":0+(\\d+)")
    private val DOT_ZEROS = Regex("\\.0+(\\d+)")
    private val INTEGER_PREFIX = Regex("^\\s*([+-]?\\d+)")

    private val TAG_KEYS = mapOf("title" to "ti", "artist" to "ar", "album" to "al", "offset" to "offset", "by" to "by")

    fun parse(
        lyric: String,
        extendedLyrics: List<String> = emptyList(),
    ): ParsedLyric {
        val tags = parseTags(lyric)
        val isMsTime = MS_TIME.containsMatchIn(lyric)
        val lines = LinkedHashMap<String, LyricLine>()
        for (rawLine in lyric.split(LINE_BREAK)) {
            val line = rawLine.trim()
            val timeField = TIME_FIELD.find(line)?.value ?: continue
            val text = TIME_FIELD.replace(line, "").trim()
            // isRemoveBlankLine 在 RN 插件里恒为 true：没有正文的时间标签行不占位
            if (text.isEmpty()) continue
            for (time in TIME.findAll(timeField).map { it.value }) {
                val timeLabel = formatTimeLabel(time)
                val existing = lines[timeLabel]
                if (existing != null) {
                    // 同一时间点写了多段文字：后写的并入首行的扩展歌词（翻译/音译同槽位）
                    lines[timeLabel] = existing.copy(extendedLyrics = existing.extendedLyrics + text)
                    continue
                }
                val timeMs = timeLabelToMs(timeLabel, isMsTime) ?: continue
                lines[timeLabel] = LyricLine(timeMs = timeMs, text = text)
            }
        }
        for (extended in extendedLyrics) {
            mergeExtended(lines, extended)
        }
        return ParsedLyric(
            lines = lines.values.sortedBy { it.timeMs },
            tags = tags,
        )
    }

    /**
     * 当前行号：找第一个「时间 >= 播放位置」的行，取它的前一行；
     * 位置为负或还没到第一行时归 0，越过后停在最后一行。
     *
     * 与 RN `_findCurLineNum` 相同，时间正好等于某行起点时仍算上一行
     * （库要等下一毫秒才切）。
     */
    fun indexAt(
        lines: List<LyricLine>,
        positionMs: Long,
        extraOffsetMs: Int = DEFAULT_OFFSET_MS,
        tagOffsetMs: Int = 0,
    ): Int {
        if (lines.isEmpty()) return -1
        val time = positionMs + extraOffsetMs + tagOffsetMs
        if (time <= 0) return 0
        for (index in lines.indices) {
            if (time <= lines[index].timeMs) {
                return if (index == 0) 0 else index - 1
            }
        }
        return lines.size - 1
    }

    fun formatTimeLabel(label: String): String =
        label
            .replace(LEADING_ZEROS, "$1")
            .replace(COLON_ZEROS, ":$1")
            .replace(DOT_ZEROS, ".$1")

    private fun parseTags(lyric: String): LyricTags {
        fun tag(key: String): String =
            Regex("""\[$key:([^\]]*)]""", RegexOption.IGNORE_CASE)
                .find(lyric)
                ?.groupValues
                ?.get(1)
                .orEmpty()
        return LyricTags(
            title = tag("ti"),
            artist = tag("ar"),
            album = tag("al"),
            by = tag("by"),
            offset = parseJsInt(tag("offset")),
        )
    }

    /** JS `parseInt` 语义：取开头可选符号的数字，解析不了给 0。 */
    private fun parseJsInt(value: String): Int =
        INTEGER_PREFIX
            .find(value)
            ?.groupValues
            ?.get(1)
            ?.toIntOrNull() ?: 0

    private fun mergeExtended(
        lines: MutableMap<String, LyricLine>,
        extendedLyric: String,
    ) {
        for (rawLine in extendedLyric.split(LINE_BREAK)) {
            val line = rawLine.trim()
            val timeField = TIME_FIELD.find(line)?.value ?: continue
            val text = TIME_FIELD.replace(line, "").trim()
            if (text.isEmpty()) continue
            for (time in TIME.findAll(timeField).map { it.value }) {
                val label = formatTimeLabel(time)
                val target = lines[label] ?: continue
                lines[label] = target.copy(extendedLyrics = target.extendedLyrics + text)
            }
        }
    }

    /**
     * 时间标签换算。先把每个分量去前导零，再按 `:` 拆；
     * 不足三段补到三段（`[1.00]` 是 1 秒，不是 1 分），第三段带小数时拆成秒+小数。
     */
    private fun timeLabelToMs(
        timeLabel: String,
        isMsTime: Boolean,
    ): Long? {
        val parts = timeLabel.split(":").toMutableList()
        if (parts.size > 3) return null
        while (parts.size < 3) parts.add(0, "0")
        if ('.' in parts[2]) {
            val split = parts[2].split('.')
            parts.removeAt(2)
            parts.addAll(2, split)
        }
        val msText = parts.getOrNull(3) ?: "0"
        val hours = parts[0].toLongOrNull() ?: return null
        val minutes = parts[1].toLongOrNull() ?: return null
        val seconds = parts[2].toLongOrNull() ?: return null
        val ms = if (isMsTime) msText.toLongOrNull() ?: 0L else (msText.padEnd(3, '0')).toLongOrNull() ?: 0L
        return hours * 3_600_000L + minutes * 60_000L + seconds * 1_000L + ms
    }

    private val LINE_BREAK = Regex("""\r\n|\n|\r""")
}
