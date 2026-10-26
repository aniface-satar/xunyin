package cn.toside.music.core.local

import java.util.Base64

/**
 * 本地歌词文本解析 —— 对照 RN `src/core/music/local.ts#parseLyric`。
 *
 * RN 的本地歌词有两种来源：文件内嵌歌词（原生模块）与同目录 `.lrc`，两者都会经过
 * 这段解析：先剥掉 `[awlrc:<base64>]` 汇总标签，标签里再按 `lrc:/awlrc:/tlrc:/rlrc:`
 * 分段 base64 解出原文/逐字/翻译/音译。原生只做 **同名 `.lrc`** 这一路
 * （内嵌歌词要解析 ID3，本波不做，见 lane 报告遗留）。
 */
object LocalLyric {
    /** 解析结果；[tlyric] / [rlyric] 直接喂给既有歌词链路（`LyricsState.translation/roma`）。 */
    data class Parsed(
        val lyric: String,
        val lxlyric: String? = null,
        val tlyric: String? = null,
        val rlyric: String? = null,
    ) {
        val hasLyric: Boolean get() = lyric.isNotBlank()
    }

    /** RN `tagRxp = /(?:^|\n\s*)\[awlrc:([^\]]+)]/i`。 */
    private val TAG_RXP = Regex("""(?:^|\n\s*)\[awlrc:([^\]]+)]""", RegexOption.IGNORE_CASE)

    /** RN `lrcRxp = /^(lrc|awlrc|tlrc|rlrc):([^,]+)$/i`。 */
    private val ENTRY_RXP = Regex("""^(lrc|awlrc|tlrc|rlrc):([^,]+)$""", RegexOption.IGNORE_CASE)

    /** RN `verifyAwlrc`：逐字歌词必须带 `<起,长>`。 */
    private val AWLRC_VERIFY = Regex("""(?:^|\s*)\[\d+:\d+(?:\.\d+)]<\d+,\d+>.+$""", RegexOption.MULTILINE)

    /** RN `verifylrc`。 */
    private val LRC_VERIFY = Regex("""(?:^|\s*)\[\d+:\d+(?:\.\d+)].+$""", RegexOption.MULTILINE)

    fun parse(text: String): Parsed {
        var body = text
        var extras: Map<String, String> = emptyMap()
        TAG_RXP.find(text)?.let { match ->
            extras = parseAwlrc(match.groupValues[1])
            body = text.replaceFirst(match.value, "")
        }
        return Parsed(
            // RN：{ lyric, ...parsedInfo } —— 标签里的 lrc 段会覆盖正文
            lyric = extras["lyric"] ?: body.trim(),
            lxlyric = extras["lxlyric"],
            tlyric = extras["tlyric"],
            rlyric = extras["rlyric"],
        )
    }

    private fun parseAwlrc(payload: String): Map<String, String> {
        val result = mutableMapOf<String, String>()
        for (raw in payload.split(',')) {
            val entry = ENTRY_RXP.matchEntire(raw.trim()) ?: continue
            val kind = entry.groupValues[1].lowercase()
            val data = decodeBase64(entry.groupValues[2]) ?: continue
            when (kind) {
                "awlrc" -> if (AWLRC_VERIFY.containsMatchIn(data)) result["lxlyric"] = data
                "lrc" -> if (LRC_VERIFY.containsMatchIn(data)) result["lyric"] = data
                "tlrc" -> if (LRC_VERIFY.containsMatchIn(data)) result["tlyric"] = data
                "rlrc" -> if (LRC_VERIFY.containsMatchIn(data)) result["rlyric"] = data
            }
        }
        return result
    }

    /** JS `Buffer.from(x, 'base64')` 对空白宽容、对坏字符忽略；Java 严格解码失败就退回 MIME 变体。 */
    private fun decodeBase64(value: String): String? {
        val bytes =
            runCatching { Base64.getDecoder().decode(value) }
                .recoverCatching { Base64.getMimeDecoder().decode(value) }
                .getOrNull() ?: return null
        val text = String(bytes, Charsets.UTF_8).trim()
        return text.ifEmpty { null }
    }
}
