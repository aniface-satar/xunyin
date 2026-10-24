package cn.toside.music.core.songlist

import kotlinx.serialization.json.JsonObject

/**
 * 传输中立 HTTP 请求 —— 与 `music/search/SearchRequest` 同形，另带 form
 * （网易、酷狗等 weapi/POST 表单源需要）。
 */
data class SonglistRequest(
    val url: String,
    val method: String = "GET",
    val headers: Map<String, String> = emptyMap(),
    val body: String? = null,
    val form: Map<String, String>? = null,
)

/** 排序项（对照 RN 各源 songList.js 的 sortList）。 */
data class SonglistSort(
    val id: String,
    val name: String,
    val tid: String = id,
)

/** 歌单分类标签。`id` 是各源请求用的 tagId（酷我形如 `<id>-<digest>`）。 */
data class SonglistTag(
    val id: String,
    val name: String,
)

data class SonglistTagGroup(
    val name: String,
    val list: List<SonglistTag>,
)

/** 标签清单（RN `getTags()` 的 `{ tags, hotTag, source }`）。 */
data class SonglistTags(
    val tags: List<SonglistTagGroup>,
    val hotTags: List<SonglistTag>,
    val source: String,
)

/** 歌单列表项（RN `filterList` 返回形状）。 */
data class PlaylistItem(
    val id: String,
    val name: String,
    val author: String = "",
    val img: String? = null,
    val playCount: String = "",
    val total: Int? = null,
    val desc: String = "",
    val time: String = "",
    val source: String,
)

/** 歌单列表分页（RN `getList` 返回形状）。 */
data class SonglistPage(
    val list: List<PlaylistItem>,
    val total: Int,
    val limit: Int,
    val page: Int,
    val source: String,
)

/** 歌单详情信息（RN `getListDetail().info`）。 */
data class SonglistInfo(
    val name: String? = null,
    val img: String? = null,
    val desc: String? = null,
    val author: String? = null,
    val playCount: String? = null,
)

/**
 * 歌单详情“源分页”（RN `getListDetail` 返回形状）。
 * `list` 已是 RN v2 MusicInfo（`MusicInfoTools.toNewMusicInfo` 输出），可直接写列表播放。
 */
data class SonglistDetail(
    val list: List<JsonObject>,
    val total: Int,
    val limit: Int,
    val page: Int,
    val source: String,
    val info: SonglistInfo? = null,
)

/** 五源在线歌单源接口（对照 RN `musicSdk[source].songList`）。 */
interface SonglistSource {
    val source: String

    val sorts: List<SonglistSort>

    suspend fun getTags(): SonglistTags

    /** 歌单列表；`tagId = null` 表示“全部/推荐”分类（RN 的 `!tagId` 分支）。 */
    suspend fun getList(
        sortId: String,
        tagId: String? = null,
        page: Int = 1,
    ): SonglistPage

    /** 歌单详情某一“源分页”（源自身的分页语义，展示分页由 [SonglistDetailPager] 负责）。 */
    suspend fun getDetail(
        id: String,
        page: Int = 1,
    ): SonglistDetail
}

object Songlists {
    /** 源顺序与展示名（对照 RN `musicSdk/index.js` 与搜索的 SOURCES 保持一致）。 */
    val SOURCES: List<Pair<String, String>> =
        listOf(
            "kw" to "酷我音乐",
            "kg" to "酷狗音乐",
            "tx" to "企鹅音乐",
            "wy" to "网易音乐",
            "mg" to "咪咕音乐",
        )

    /** RN `core/songlist.ts` 的展示分页大小。 */
    const val LIST_LOAD_LIMIT: Int = 30
}
