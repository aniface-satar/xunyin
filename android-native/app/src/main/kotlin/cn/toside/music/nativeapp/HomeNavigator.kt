package cn.toside.music.nativeapp

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

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
