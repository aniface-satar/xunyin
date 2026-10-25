package cn.toside.music.core.recommend

/**
 * 歌手名/文本归一 —— RN `core/recommend/trackKey.ts` 中 M1 用到的子集
 * （`normalizeText` / `splitSinger` / `getArtistKeys`）。
 *
 * M1 不移植：版本标记提取（getVersionLabel）、canonical key、判重（isSameRecording）——
 * 它们服务电台判重与 M3 相似度，推荐 tab 重排只按「归一化歌手名」与「歌名词面」打分。
 */
object TrackKeys {
    private val CJK_RXP = Regex("[\\u3400-\\u9fff]")
    private val ACDC_RXP = Regex("^[A-Z]{1,4}/[A-Z]{1,4}$")
    private val FEAT_RXP = Regex("\\s+(?:feat\\.?|ft\\.?|with)\\s+", RegexOption.IGNORE_CASE)

    /**
     * RN normalizeText：trim、小写、全角括号归一、间隔号当空格、破折号两侧留空。
     *
     * `(?U)` 是必须的：JS 的 `\s` 含全角空格 U+3000 / NBSP 等，而 Java 默认
     * `\s` 只认 ASCII 空白；不加这个标志会把「A　B」当成一个词。
     */
    fun normalizeText(text: String?): String =
        (text ?: "")
            .trim { it.isWhitespace() }
            .lowercase()
            .replace("（", "(")
            .replace("）", ")")
            .replace("【", "[")
            .replace("】", "]")
            .replace(Regex("[·・•]"), " ")
            .replace(Regex("(?U)\\s+"), " ")
            .replace(Regex("(?U)\\s*[-–—]\\s*"), " - ")
            .trim { it.isWhitespace() }

    /**
     * 谨慎拆分歌手：不拆坏 AC/DC，也不把 "Simon & Garfunkel" 这类组合名拆开。
     * 对明确的多人分隔符（、；| 等）总是拆分 —— RN splitSinger 原样移植。
     */
    fun splitSinger(singer: String?): List<String> {
        val raw = (singer ?: "").trim()
        if (raw.isEmpty()) return emptyList()

        // 先处理 feat./ft./with 这类对唱标记
        val parts = FEAT_RXP.replace(raw, "、").split(Regex("[、;；|]"))

        val result = mutableListOf<String>()
        for (part in parts) {
            // 斜杠：AC/DC 这类全大写短名不拆
            if (part.contains('/')) {
                val slashParts = part.split('/').map { it.trim() }.filter { it.isNotEmpty() }
                if (slashParts.size == 2 && ACDC_RXP.matches(part.replace(Regex("\\s+"), ""))) {
                    result.add(part.trim())
                } else {
                    result.addAll(slashParts)
                }
            } else {
                result.add(part.trim())
            }
        }

        val expanded = mutableListOf<String>()
        for (part in result) {
            val hasCjk = CJK_RXP.containsMatchIn(part)
            val pieces = part.split(Regex("[,，&]")).map { it.trim() }.filter { it.isNotEmpty() }
            if (pieces.size <= 1) {
                expanded.add(part)
                continue
            }
            // "Simon & Garfunkel" 这种带空格的拉丁组合名保留整体；中文/无空格分隔则拆
            if (!hasCjk && Regex("\\s&\\s").containsMatchIn(part) && !Regex("[,，]").containsMatchIn(part)) {
                expanded.add(part)
            } else {
                expanded.addAll(pieces)
            }
        }

        return expanded.map { it.trim() }.filter { it.isNotEmpty() }.distinct()
    }

    /** RN getArtistKeys：拆分歌手并归一化。 */
    fun getArtistKeys(singer: String?): List<String> = splitSinger(singer).map { normalizeText(it) }.filter { it.isNotEmpty() }
}
