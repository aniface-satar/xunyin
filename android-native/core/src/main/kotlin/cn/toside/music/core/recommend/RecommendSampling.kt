package cn.toside.music.core.recommend

import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.min

/**
 * 推荐卡片取样与榜单定向 —— RN `tabSections.ts` 的 `pickCardPlaylists` /
 * `pickNewSongBoard`（带画像关键词版）与 `profile.ts` 的 `pickChartBoard`。
 *
 * Wave2 的 [cn.toside.music.core.songlist.RecommendSelection] 是它们的
 * 冷启动退化（无画像输入）；本文件补上画像定向后供运行时替换调用。
 */
object RecommendSampling {
    private val NEW_SONG_PATTERN = Regex("新歌|新曲|新品|new", RegexOption.IGNORE_CASE)
    private val RISING_PATTERN = Regex("飙升|上升|热升|rise", RegexOption.IGNORE_CASE)

    /** 刷新取样只在画像靠前的这一带里换，不会跳到画像垫底的候选。 */
    private const val REFRESH_POOL_SPAN = 12

    /**
     * 卡片一屏要显示的歌单：从排序结果前段随机截一段。
     * [rnd] 注入以保证可测（运行时传随机源）。
     */
    fun <T> pickCardPlaylists(
        ranked: List<T>,
        count: Int,
        rnd: () -> Double,
    ): List<T> {
        if (ranked.size <= count) return ranked.toList()
        val pool = ranked.subList(0, min(ranked.size, maxOf(count, REFRESH_POOL_SPAN)))
        val start = floor(rnd() * (pool.size - count + 1)).toInt()
        return pool.subList(start, (start + count).coerceAtMost(pool.size)).toList()
    }

    /**
     * 挑一张真正代表「新歌」的榜单（RN pickNewSongBoard 完整版）：新歌榜优先、
     * 其次飙升榜；都没有时返回 null。命中画像关键词最多的榜单优先，
     * 并列按轮次轮换；一个都没命中时保持「名字最短越通用」的规则。
     */
    fun <T : RecommendBoardLike> pickNewSongBoard(
        boards: List<T>,
        keywords: List<String> = emptyList(),
        rotation: Int = 0,
    ): T? {
        val fresh = boards.filter { NEW_SONG_PATTERN.containsMatchIn(it.name) }
        val pool = fresh.ifEmpty { boards.filter { RISING_PATTERN.containsMatchIn(it.name) } }
        if (pool.isEmpty()) return null
        val scored = pool.map { it to PlaylistRank.keywordHits(keywords, it.name) }
        val best = scored.maxOf { it.second }
        if (best > 0) {
            val hits = scored.filter { it.second == best }.map { it.first }
            return hits[Math.floorMod(abs(rotation), hits.size)]
        }
        return pool.minByOrNull { it.name.length }
    }

    /** 与 [RecommendBoard] 同形的最小接口（name + 定位键），避免 core 内部重复建模。 */
    interface RecommendBoardLike {
        val name: String
    }
}
