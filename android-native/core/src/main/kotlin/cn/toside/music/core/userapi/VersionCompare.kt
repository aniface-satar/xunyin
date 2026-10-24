package cn.toside.music.core.userapi

/**
 * 音源版本号比较 —— RN `src/core/userApiUpdate/version.ts` 的逐条移植。
 *
 * 作者填的版本号没有统一规范（日期式、语义化、纯递增数字）。只在两边都「像版本号」
 * 时给结论；认不出返回 null，调用方不能把它当降级证据。
 */
object VersionCompare {
    private val VERSION_RXP = Regex("^\\d+(?:[.\\-_]\\d+)*$")
    private val SEPARATOR_RXP = Regex("[.\\-_]")
    private val LEADING_V_RXP = Regex("^v", RegexOption.IGNORE_CASE)
    private const val MAX_SAFE_INTEGER = 9_007_199_254_740_991L

    private data class Parsed(
        val segments: List<Long>,
        val single: Boolean,
    )

    /** 返回 -1 / 0 / 1；任一边认不出、或「纯数字」与「带分隔符」混用时返回 null。 */
    fun compare(
        a: String,
        b: String,
    ): Int? {
        val left = parse(a) ?: return null
        val right = parse(b) ?: return null
        // 「20261020」和「2026.10.21」混在一起分不清年份段，硬比会把合法升级判成降级
        if (left.single != right.single) return null
        val length = maxOf(left.segments.size, right.segments.size)
        for (index in 0 until length) {
            val l = left.segments.getOrElse(index) { 0L }
            val r = right.segments.getOrElse(index) { 0L }
            if (l < r) return -1
            if (l > r) return 1
        }
        return 0
    }

    private fun parse(version: String): Parsed? {
        val text = version.trim().replace(LEADING_V_RXP, "")
        if (!VERSION_RXP.matches(text)) return null
        val segments = text.split(SEPARATOR_RXP).map { it.toLongOrNull() ?: return null }
        if (segments.any { it > MAX_SAFE_INTEGER }) return null
        return Parsed(segments, !SEPARATOR_RXP.containsMatchIn(text))
    }
}
