package cn.toside.music.core.music.leaderboard

/**
 * 五源排行榜静态榜单清单 —— 对照 RN 各源 `leaderboard.js` 的 boardList
 * （RN 的 getBoards 已全部改为返回固定列表，不再请求线上接口）。
 *
 * @param id 形如 `kw__93`；`bangid` 是各源请求用的数字 id。
 */
data class BoardItem(
    val id: String,
    val name: String,
    val bangid: String,
)

/** 榜单分页结果（对照 RN `leaderboard.getList` 的返回形状）。 */
data class BoardList(
    val list: List<kotlinx.serialization.json.JsonObject>,
    val total: Int,
    val limit: Int,
    val page: Int,
    val source: String,
)

/**
 * 排行榜源接口：`getBoards`（固定表）与 `getList`（榜单详情分页）。
 */
interface LeaderboardSource {
    val source: String

    fun getBoards(): List<BoardItem>

    /** 拉取榜单详情的某一“源分页”（RN `getList(bangid, page)` 语义）。 */
    suspend fun getList(
        bangid: String,
        page: Int,
    ): BoardList
}

object Leaderboards {
    val SOURCES: List<String> = listOf("kw", "kg", "tx", "wy", "mg")

    fun sourceName(source: String): String =
        when (source) {
            "kw" -> "酷我音乐"
            "kg" -> "酷狗音乐"
            "tx" -> "企鹅音乐"
            "wy" -> "网易音乐"
            "mg" -> "咪咕音乐"
            else -> source
        }
}
