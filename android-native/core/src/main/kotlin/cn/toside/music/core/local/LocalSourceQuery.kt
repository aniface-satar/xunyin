package cn.toside.music.core.local

/**
 * 本地曲目的在线兜底查询候选（W5-8）—— 对照 RN `src/core/music/local.ts#getOtherSourceByLocal`
 * 的六级候选阶梯，逐级产出 `(keyword, expectName, expectSinger)`：
 *
 * | 级 | 触发条件 | 查询口径 | 失败降级 |
 * |:--:|:--|:--|:--|
 * | 1 | 恒有 | `name + singer` 原样 | 进下一级 |
 * | 2 | `name` 含 `-` | 拆前段当歌名、后段当歌手 | 进下一级 |
 * | 3 | 同上 | 前后对调（歌手当歌名） | 进下一级 |
 * | 4 | 文件名 stem 存在且 ≠ `name`，stem 含 `-` | 拆前段当歌名、后段当歌手 | 进下一级 |
 * | 5 | 同上 | 前后对调 | 进下一级 |
 * | 6 | stem 存在且 ≠ `name`，stem 不含 `-` | 纯 stem 当歌名、歌手留空 | 全失败 |
 *
 * RN 的 `searchMusic` 用 `` `${name} ${singer}`.trim() `` 当关键词、搜五源第 1 页
 * （`src/utils/musicSdk/index.js:62`）；匹配规则是 `filterStr` 归一化后的
 * 「歌名相等/互含 + 歌手互含」（[matches]）。
 */
object LocalSourceQuery {
    /** RN 的文件名拆分分隔符（歌名 - 歌手）。 */
    const val ARTIST_SEPARATOR: String = "-"

    /** 一条有序查询候选。 */
    data class Candidate(
        val keyword: String,
        val expectName: String,
        val expectSinger: String,
    )

    /**
     * 六级阶梯。`fileNameStem` 传 null 表示拿不到文件名（跳过 4~6 级）；
     * 与 `name` 相同（原文比较，RN `fileName != musicInfo.name`）时同样跳过文件名级。
     */
    fun candidates(
        name: String,
        singer: String,
        fileNameStem: String? = null,
    ): List<Candidate> {
        val result = mutableListOf(Candidate(keyword = "$name $singer".trim(), expectName = name, expectSinger = singer))
        if (name.contains(ARTIST_SEPARATOR)) {
            val parts = name.split(ARTIST_SEPARATOR).map { it.trim() }
            if (parts.size >= 2) {
                val (first, second) = parts
                result.add(Candidate(keyword = "$first $second".trim(), expectName = first, expectSinger = second))
                result.add(Candidate(keyword = "$second $first".trim(), expectName = second, expectSinger = first))
            }
        }
        if (fileNameStem != null && fileNameStem != name) {
            if (fileNameStem.contains(ARTIST_SEPARATOR)) {
                val parts = fileNameStem.split(ARTIST_SEPARATOR).map { it.trim() }
                if (parts.size >= 2) {
                    val (first, second) = parts
                    result.add(Candidate(keyword = "$first $second".trim(), expectName = first, expectSinger = second))
                    result.add(Candidate(keyword = "$second $first".trim(), expectName = second, expectSinger = first))
                }
            } else {
                result.add(Candidate(keyword = fileNameStem.trim(), expectName = fileNameStem.trim(), expectSinger = ""))
            }
        }
        return result
    }

    /**
     * RN `filterStr`：把空白与常见标点全删掉再比；在此基础上补全半角→小写归一
     * （ID3 标签里全角英文极常见，纯 `filterStr` 会把 `BLUE` 和 `ＢＬＵＥ` 判成两首）。
     */
    fun normalize(value: String): String =
        value
            .replace(RN_FILTER_RXP, "")
            .lowercase()
            .map { ch ->
                when {
                    ch.code in 0xFF01..0xFF5E -> (ch.code - 0xFEE0).toChar()
                    else -> ch
                }
            }.joinToString("")

    private val RN_FILTER_RXP = Regex("""[\s'|.,，&"、()（）`~\-<>|/\[\]!！]""")

    /**
     * 搜索结果与期望是否对得上（RN `findMusic` 的简化口径）：
     * 歌名归一化后相等或互含；歌手归一化后互含，期望歌手为空时放行。
     */
    fun matches(
        expectName: String,
        expectSinger: String,
        actualName: String,
        actualSinger: String,
    ): Boolean {
        val name = normalize(expectName)
        val actual = normalize(actualName)
        if (name.isEmpty() || actual.isEmpty()) return false
        val nameOk = actual == name || actual.contains(name) || name.contains(actual)
        if (!nameOk) return false
        val singer = normalize(expectSinger)
        if (singer.isEmpty()) return true
        val actualSingerNormalized = normalize(actualSinger)
        return actualSingerNormalized.contains(singer) || singer.contains(actualSingerNormalized)
    }
}
