package cn.toside.music.core.list

import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.JsonObject

/**
 * 在线歌单「更新」同步（W5-10）—— 对照 RN `core/syncSourceList.ts`。
 *
 * 只保留可单测的判定与落库，取数由调用方注入（网络在 app 层）：
 * 1. `source` 与 `sourceListId` 都在才可同步，`board__` 前缀走榜单；
 * 2. 拉全整单后 [ListStore.listMusicOverwrite] 整表替换（RN 同语义，空列表也照换）；
 * 3. 成功后记列表元信息 `locationUpdateTime` 与 `@list_update_info` 更新时间；
 * 4. 任一步失败不动列表 —— RN 的 catch 只 toast，不落库。
 */
object ListSync {
    /** `sourceListId` 的榜单前缀（RN `syncSourceList`）。 */
    const val BOARD_PREFIX: String = "board__"

    /** 同步成功的结果（宿主据此广播列表更新并提示）。 */
    data class Done(
        val listId: String,
        val trackCount: Int,
        val updateTime: Long,
    )

    /** 取数目标（RN `fetchList` 的分叉）。 */
    sealed interface FetchTarget {
        data class Songlist(
            val source: String,
            val id: String,
        ) : FetchTarget

        /** `sourceListId` 形如 `board__tx__xxx`，去前缀后交给榜单接口。 */
        data class Board(
            val boardId: String,
        ) : FetchTarget
    }

    /** RN `syncSourceList` 的源判定；老列表缺元数据返回 null（菜单侧应已置灰）。 */
    fun fetchTarget(info: ListStore.UserListInfo): FetchTarget? {
        val source = info.source?.takeIf { it.isNotEmpty() } ?: return null
        val sourceListId = info.sourceListId?.takeIf { it.isNotEmpty() } ?: return null
        return if (sourceListId.startsWith(BOARD_PREFIX)) {
            FetchTarget.Board(sourceListId.removePrefix(BOARD_PREFIX))
        } else {
            FetchTarget.Songlist(source, sourceListId)
        }
    }

    /** 执行一次同步；[fetch] 抛异常视为失败（含取消——取消照样向上抛）。 */
    suspend fun run(
        store: ListStore,
        info: ListStore.UserListInfo,
        now: Long = System.currentTimeMillis(),
        fetch: suspend (FetchTarget) -> List<JsonObject>,
    ): Done? {
        val target = fetchTarget(info) ?: return null
        val tracks =
            try {
                fetch(target)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                return null
            }
        store.listMusicOverwrite(info.id, tracks)
        store.userListsUpdate(listOf(info.copy(locationUpdateTime = now)))
        store.setListUpdateTime(info.id, now)
        return Done(info.id, tracks.size, now)
    }
}
