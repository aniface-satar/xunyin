package cn.toside.music.nativeapp.ui.list

import cn.toside.music.core.list.ListSync
import cn.toside.music.nativeapp.data.LeaderboardRuntime
import cn.toside.music.nativeapp.data.SonglistRuntime
import cn.toside.music.nativeapp.player.PlayerRuntime

/**
 * 「更新」同步的网络接线（W5-10）。
 *
 * RN `syncSourceList` 取数时传 `isRefresh=true`。原生在公开的详情接口上先清一次
 * 该歌单的第 1 页缓存，随后 `getListDetailAll` 逐页补齐，等价于清整单缓存后重拉。
 * 失败返回 null（列表保持原样，仅由宿主提示）。
 */
internal suspend fun syncUserList(
    runtime: PlayerRuntime,
    listId: String,
): ListSync.Done? {
    val info =
        runtime.lists.store.state.value.userLists
            .firstOrNull { it.id == listId } ?: return null
    val done =
        ListSync.run(runtime.lists.store, info) { target ->
            when (target) {
                is ListSync.FetchTarget.Songlist -> {
                    SonglistRuntime.getListDetail(target.source, target.id, 1, isRefresh = true)
                    SonglistRuntime.getListDetailAll(target.source, target.id)
                }
                is ListSync.FetchTarget.Board -> {
                    LeaderboardRuntime.getListDetail(target.boardId, 1, isRefresh = true)
                    LeaderboardRuntime.getListDetailAll(target.boardId)
                }
            }
        } ?: return null
    runtime.core.handleListMusicsUpdated(listOf(done.listId))
    return done
}
