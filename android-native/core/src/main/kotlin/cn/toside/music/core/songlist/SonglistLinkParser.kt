package cn.toside.music.core.songlist

/** 粘贴式打开歌单的判定结果；[id] 是可直接交给 `SonglistRuntime.getListDetail` 的 id。 */
data class ParsedSonglistLink(
    val source: String,
    val id: String,
)

/**
 * 歌单链接/ID 判定链（对照 RN `SongList/HeaderBar/OpenList/Modal`：先选来源再输入）。
 *
 * 各源复用既有 `normalizeId`，仅补「来源 → 解析器」的判定与空值兜底：
 * - kw/kg/tx：要求归一化结果是裸 id（不含 `?&:/`）；kg 纯数字是酷狗码，本波未接；
 * - wy：`###token` 原样保留，详情层自己拆 MUSIC_U；
 * - mg：支持纯 id、`playlistId=`/`id=` 与 `/playlist/<id>` 三种形态，
 *   短链跳转（`c.migu.cn/xxxx`）需跟重定向，本波不接。
 */
object SonglistLinkParser {
    private const val MAX_INPUT = 500
    private val PLAIN_ID = Regex("""[^?&:/]+""")
    private val DIGITS = Regex("""\d+""")
    private val MG_QUERY_ID = Regex("""(?:playlistId|[?&]id)=(\d+)""")
    private val MG_PATH_ID = Regex("""/playlist/(\d+)""")

    fun parse(
        raw: String,
        source: String,
    ): ParsedSonglistLink? {
        val input = raw.trim().take(MAX_INPUT)
        if (input.isEmpty()) return null
        val id =
            when (source) {
                "kw" -> runCatching { KwSonglist.normalizeId(input) }.getOrNull()?.takeIf(::isPlainId)
                "kg" -> runCatching { KgSonglist.normalizeId(input) }.getOrNull()?.takeIf(DIGITS::matches)
                "tx" -> runCatching { TxSonglist.normalizeId(input) }.getOrNull()?.takeIf(DIGITS::matches)
                "wy" -> parseWy(input)
                "mg" -> parseMg(input)
                else -> null
            } ?: return null
        return ParsedSonglistLink(source, id)
    }

    private fun parseWy(input: String): String? {
        val id = runCatching { WySonglist.normalizeId(input).first }.getOrNull() ?: return null
        if (id.isEmpty()) return null
        // 带 ###token 的输入要整段交给详情层，归一化后的 id 会丢掉 MUSIC_U
        return if (input.contains("###")) input else id
    }

    private fun parseMg(input: String): String? {
        if (DIGITS.matches(input)) return input
        if (!input.contains("/playlist") && !input.contains("playlistId")) return null
        MG_QUERY_ID.find(input)?.let { return it.groupValues[1] }
        MG_PATH_ID.find(input)?.let { return it.groupValues[1] }
        return null
    }

    private fun isPlainId(id: String): Boolean = id.isNotEmpty() && PLAIN_ID.matches(id)
}
