package cn.toside.music.core.list

/**
 * 外部歌单与自建歌单的同认判据（对照 RN SonglistDetail/listAction.ts#isSameSourceList）。
 *
 * `sourceListId` 有两种历史写法：裸 id（整单导入）与 `source__id`
 * （播放临时列表元信息），两种都视为同一张外部歌单。
 */
object SourceListMatch {
    fun onlineListId(
        source: String,
        id: String,
    ): String = "${source}__$id"

    fun isSame(
        list: ListStore.UserListInfo,
        source: String,
        id: String,
    ): Boolean =
        list.source == source &&
            (list.sourceListId == id || list.sourceListId == onlineListId(source, id))

    fun find(
        lists: List<ListStore.UserListInfo>,
        source: String,
        id: String,
    ): ListStore.UserListInfo? = lists.firstOrNull { isSame(it, source, id) }
}
