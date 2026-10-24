package cn.toside.music.core.songlist

/** 推荐通道里的一张榜单（`source` + `id` 可直接交给排行榜分页器）。 */
data class RecommendBoard(
    val source: String,
    val id: String,
    val name: String,
)

/**
 * 推荐 tab 官方内容通道的纯选择规则 —— 对照 RN `core/recommend/tabSections.ts`
 * 中**不依赖个性化引擎**的部分（冷启动等价行为）：
 *
 * - `pickNewSongBoard`：新歌榜优先、其次飙升榜、同组取名字最短；
 * - `pickHotSort`：排序目录里挑「最热/热门/hot」，否则首档；
 * - `flattenTags`：把分类目录的分组展平（热门标签不参与分类挑选）；
 * - `pickTag`：无画像时按轮次在目录里游走（RN `rankPlaylistTags` 冷启动恒等序）。
 *
 * 画像学习（artistStats/tokenWeights/主题权重/踩雷名单）在 Wave 3 立项，
 * 本波只做冷启动通道；规则纯函数、无网络、可 JVM 测。
 */
object RecommendSelection {
    private val NEW_SONG_PATTERN = Regex("新歌|新曲|新品|new", RegexOption.IGNORE_CASE)
    private val RISING_PATTERN = Regex("飙升|上升|热升|rise", RegexOption.IGNORE_CASE)
    private val HOT_SORT_PATTERN = Regex("最热|热歌|热门|popular|hot", RegexOption.IGNORE_CASE)

    /** 视作「新歌」的榜单池，新歌组为空时退到飙升组；组内按名字最短排序。 */
    fun newSongBoardCandidates(boards: List<RecommendBoard>): List<RecommendBoard> {
        val fresh = boards.filter { NEW_SONG_PATTERN.containsMatchIn(it.name) }
        val pool = fresh.ifEmpty { boards.filter { RISING_PATTERN.containsMatchIn(it.name) } }
        // 限定词越少越通用：新歌榜 > ACG新歌榜 > 网红新歌榜
        return pool.sortedBy { it.name.length }
    }

    /** RN `pickNewSongBoard`：候选池第一张；没有新歌/飙升榜返回 null。 */
    fun pickNewSongBoard(boards: List<RecommendBoard>): RecommendBoard? = newSongBoardCandidates(boards).firstOrNull()

    /** RN `pickPlaylistSort`：优先「最热/热门/hot」，源没有该档时退回目录首档。 */
    fun pickHotSort(sorts: List<SonglistSort>): SonglistSort? =
        sorts.firstOrNull { HOT_SORT_PATTERN.containsMatchIn("${it.name} ${it.tid}") } ?: sorts.firstOrNull()

    /** RN `getPlaylistTags`：只展平普通分组；分组为空时退回热门标签。 */
    fun flattenTags(tags: SonglistTags): List<SonglistTag> {
        val grouped = tags.tags.flatMap { it.list }
        return grouped.ifEmpty { tags.hotTags }
    }

    /** RN `pickPlaylistTag` 冷启动：无正偏好分类时 `ranked[rotation % size]`。 */
    fun pickTag(
        tags: List<SonglistTag>,
        rotation: Int,
    ): SonglistTag? = if (tags.isEmpty()) null else tags[Math.floorMod(rotation, tags.size)]
}
