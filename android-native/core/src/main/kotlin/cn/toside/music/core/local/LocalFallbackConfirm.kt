package cn.toside.music.core.local

/**
 * 本地曲库在线兜底的「人工确认」判定（W6-2）—— 纯规则，UI 与网络都不在这里。
 *
 * ## RN 实证（2026-10-26）
 *
 * `src/core/music/local.ts#getOtherSourceByLocal`（19-67 行）**完全静默**：六级阶梯里
 * 某一级搜到结果就把整组候选交给 `handler`，`handler` 取 `getOnlineOtherSourceMusicUrl`
 * 第一个能取到链的走（utils.ts:237-280），**没有任何确认/回退交互**。
 * 所以 RN 确实会同名兜错 —— 原生这层弹层是**体验增强**，不是对齐 RN 的缺失功能，
 * 因此按「增强但可关」实现：规则判定在这里，开关由 app 层注入（[SETTING_KEY]）。
 *
 * ## 判定规则
 *
 * | 情形 | 判定 | 弹层 |
 * |:--|:--|:--|
 * | 期望歌手为空（本地标签没歌手） | [Verdict.SINGER_UNKNOWN] | 弹 |
 * | 候选歌手与期望歌手互含都不成立 | [Verdict.SINGER_MISMATCH] | 弹 |
 * | 多个候选的歌手彼此不一致（同名不同歌手） | —— | 弹 |
 * | 其余 | [Verdict.OK] | 不弹（RN 静默语义） |
 *
 * 归一化复用 [LocalSourceQuery.normalize]（RN `filterStr` 口径：删空白标点 + 小写 + 全角转半角），
 * 保证「与搜索命中判定同一把尺子」。
 */
object LocalFallbackConfirm {
    /** 关闭位（设置层键；设置表里没有这个键时按默认开处理）。 */
    const val SETTING_KEY: String = "local.fallbackConfirm"

    /** 本地曲目的期望标识（标签里的歌名/歌手）。 */
    data class Expectation(
        val name: String,
        val singer: String,
    )

    /** 一个在线兜底候选（core 侧不认识 JsonObject，只收展示用字符串）。 */
    data class Option(
        val name: String,
        val singer: String,
        val source: String = "",
        val interval: String = "",
    )

    /** 单个候选的可信度。 */
    enum class Verdict {
        /** 歌手对得上（或互含），可以按 RN 静默语义直接采用。 */
        OK,

        /** 歌手对不上：同名不同歌手的典型形态。 */
        SINGER_MISMATCH,

        /** 核无可核：期望歌手为空，或候选自己没带歌手。 */
        SINGER_UNKNOWN,
    }

    /** 单个候选的判定。 */
    fun verdict(
        expect: Expectation,
        candidate: Option,
    ): Verdict {
        val expectSinger = LocalSourceQuery.normalize(expect.singer)
        val actualSinger = LocalSourceQuery.normalize(candidate.singer)
        if (expectSinger.isEmpty() || actualSinger.isEmpty()) return Verdict.SINGER_UNKNOWN
        return if (actualSinger.contains(expectSinger) || expectSinger.contains(actualSinger)) {
            Verdict.OK
        } else {
            Verdict.SINGER_MISMATCH
        }
    }

    /**
     * 这组候选要不要让用户自己挑。
     *
     * 无候选时返回 false（没得挑，交给失败提示，RN 同）；
     * 用户挑错可重挑由上层弹层保证（选完不满意 -> 下次兜底重新弹）。
     */
    fun needsConfirm(
        expect: Expectation,
        candidates: List<Option>,
    ): Boolean {
        if (candidates.isEmpty()) return false
        if (verdict(expect, candidates.first()) != Verdict.OK) return true
        if (candidates.size == 1) return false
        val singers = candidates.map { LocalSourceQuery.normalize(it.singer) }.distinct()
        return singers.size > 1
    }

    /**
     * 弹层候选顺序：歌手判定 [Verdict.OK] 的在前，其余保持原顺序（稳定排序，
     * 不改变阶梯已有的优先级语义）。
     */
    fun ordered(
        expect: Expectation,
        candidates: List<Option>,
    ): List<Option> = candidates.sortedBy { if (verdict(expect, it) == Verdict.OK) 0 else 1 }
}
