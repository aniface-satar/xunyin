package cn.toside.music.nativeapp

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import cn.toside.music.core.music.search.album.AlbumItem
import cn.toside.music.core.music.search.artist.ArtistItem

enum class HomeTab {
    DISCOVER,
    MY,
    SEARCH,
}

/** 三个一级 tab 各自持有详情栈，切换时不清空其他 tab。 */
class HomeNavigator {
    sealed interface Route {
        data class ListDetail(
            val listId: String,
            val title: String,
        ) : Route

        data class LeaderboardDetail(
            val boardId: String,
            val title: String,
        ) : Route

        data class SonglistDetail(
            val source: String,
            val id: String,
            val title: String,
        ) : Route

        /**
         * 专辑详情（W6-6）：搜索页专辑行进入，进 SEARCH tab 的详情栈而不再是页内覆盖。
         *
         * [fallback] 是搜索行的快照——详情页自己会按 id 重拉详情，但重拉失败/慢时
         * 头部先显示这一份（对照 [cn.toside.music.nativeapp.ui.search.AlbumDetailPage]
         * 既有的 `fallback` 参数语义，行为不变）。
         */
        data class AlbumDetail(
            val source: String,
            val id: String,
            val fallback: AlbumItem?,
        ) : Route

        /**
         * 歌手详情（W6-6）：与 [AlbumDetail] 同理。歌手详情头部本来就只用搜索行数据
         * （`ArtistDetailPage` 的 `artist` 参数），所以这里整份带上。
         */
        data class ArtistDetail(
            val source: String,
            val artist: ArtistItem,
        ) : Route

        /** 个性电台（S13 M2）：发现页「推荐」顶部卡片进入。 */
        data object Radio : Route
    }

    var currentTab by mutableStateOf(HomeTab.DISCOVER)
        private set

    private val detailStacks = HomeTab.entries.associateWith { mutableStateListOf<Route>() }

    fun currentDetail(tab: HomeTab = currentTab): Route? = detailStacks.getValue(tab).lastOrNull()

    /** @return 是否重复选择了当前 tab，供发现页重置内部二级 tab。 */
    fun selectTab(tab: HomeTab): Boolean {
        if (tab != currentTab) {
            currentTab = tab
            return false
        }
        reset()
        return true
    }

    fun push(route: Route) {
        detailStacks.getValue(currentTab).add(route)
    }

    /**
     * deeplink 进入的详情：先切到「发现」再压栈（RN 的 deeplink 一律在主页栈顶打开，
     * 不跟随当前 tab —— 否则从「我的」进来的歌单会叠在列表详情上面，返回层级会乱）。
     */
    fun openFromDeeplink(route: Route) {
        currentTab = HomeTab.DISCOVER
        detailStacks.getValue(HomeTab.DISCOVER).add(route)
    }

    /** @return 当前 tab 是否成功 pop 一层；根页面返回 false。 */
    fun back(): Boolean {
        val stack = detailStacks.getValue(currentTab)
        if (stack.isEmpty()) return false
        stack.removeAt(stack.lastIndex)
        return true
    }

    fun reset() {
        detailStacks.getValue(currentTab).clear()
    }
}
