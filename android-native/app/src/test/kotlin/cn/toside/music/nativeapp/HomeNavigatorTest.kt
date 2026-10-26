package cn.toside.music.nativeapp

import cn.toside.music.core.music.search.album.AlbumItem
import cn.toside.music.core.music.search.artist.ArtistItem
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HomeNavigatorTest {
    @Test
    fun initial_state_is_discover_with_empty_detail_stacks() {
        val nav = HomeNavigator()

        assertEquals(HomeTab.DISCOVER, nav.currentTab)
        HomeTab.entries.forEach { tab ->
            assertNull(nav.currentDetail(tab))
        }
    }

    @Test
    fun switching_tabs_preserves_each_detail_stack() {
        val nav = HomeNavigator()
        val discoverDetail = HomeNavigator.Route.ListDetail("discover", "发现详情")
        val myDetail = HomeNavigator.Route.ListDetail("my", "我的详情")
        nav.push(discoverDetail)
        nav.selectTab(HomeTab.MY)
        nav.push(myDetail)

        nav.selectTab(HomeTab.DISCOVER)

        assertEquals(discoverDetail, nav.currentDetail())
        assertEquals(myDetail, nav.currentDetail(HomeTab.MY))
    }

    @Test
    fun reselecting_current_tab_clears_only_its_detail_stack() {
        val nav = HomeNavigator()
        val discoverDetail = HomeNavigator.Route.ListDetail("discover", "发现详情")
        val myDetail = HomeNavigator.Route.ListDetail("my", "我的详情")
        nav.push(discoverDetail)
        nav.selectTab(HomeTab.MY)
        nav.push(myDetail)

        assertTrue(nav.selectTab(HomeTab.MY))

        assertNull(nav.currentDetail())
        assertEquals(discoverDetail, nav.currentDetail(HomeTab.DISCOVER))
    }

    @Test
    fun push_and_back_only_affect_current_tab() {
        val nav = HomeNavigator()
        val discoverDetail = HomeNavigator.Route.ListDetail("discover", "发现详情")
        val firstMyDetail = HomeNavigator.Route.ListDetail("my-1", "我的详情一")
        val secondMyDetail = HomeNavigator.Route.ListDetail("my-2", "我的详情二")
        nav.push(discoverDetail)
        nav.selectTab(HomeTab.MY)
        nav.push(firstMyDetail)
        nav.push(secondMyDetail)

        assertTrue(nav.back())

        assertEquals(firstMyDetail, nav.currentDetail())
        assertEquals(discoverDetail, nav.currentDetail(HomeTab.DISCOVER))
        assertEquals(HomeTab.MY, nav.currentTab)
    }

    @Test
    fun back_on_root_returns_false_without_switching_to_discover() {
        val nav = HomeNavigator()
        nav.selectTab(HomeTab.SEARCH)

        assertFalse(nav.back())

        assertEquals(HomeTab.SEARCH, nav.currentTab)
        assertNull(nav.currentDetail())
    }

    /**
     * W6-6：专辑/歌手详情压进 SEARCH tab 的详情栈。
     *
     * 关键回归点是「返回只弹自己那一层」——搜索页自己的关键词/结果/滚动位置靠
     * `remember` 留在组合里，导航器不该动它；叠了歌单再叠专辑时，返回顺序要对得上。
     */
    @Test
    fun album_and_artist_details_share_the_search_detail_stack() {
        val nav = HomeNavigator()
        nav.selectTab(HomeTab.SEARCH)
        val songlist = HomeNavigator.Route.SonglistDetail("kw", "1001", "歌单")
        val album = HomeNavigator.Route.AlbumDetail("kw", "2001", albumItem("2001"))
        val artist = HomeNavigator.Route.ArtistDetail("kw", artistItem("3001"))
        nav.push(songlist)
        nav.push(album)

        assertEquals(album, nav.currentDetail())
        assertTrue(nav.back())
        assertEquals(songlist, nav.currentDetail())

        nav.push(artist)
        assertEquals(artist, nav.currentDetail())
        assertTrue(nav.back())
        assertEquals(songlist, nav.currentDetail())
        assertTrue(nav.back())
        assertNull(nav.currentDetail())
        assertFalse(nav.back())
    }

    @Test
    fun search_details_do_not_leak_into_other_tabs() {
        val nav = HomeNavigator()
        nav.selectTab(HomeTab.SEARCH)
        nav.push(HomeNavigator.Route.AlbumDetail("tx", "2002", null))

        nav.selectTab(HomeTab.DISCOVER)

        assertNull(nav.currentDetail())
        assertEquals(
            HomeNavigator.Route.AlbumDetail("tx", "2002", null),
            nav.currentDetail(HomeTab.SEARCH),
        )
    }

    @Test
    fun album_route_keeps_fallback_snapshot_and_equality() {
        // 详情页重拉详情失败时头部用这份快照；两条 Route 只在字段上比相等（data class 语义）
        val fallback = albumItem("2003", name = "叶惠美")
        val route = HomeNavigator.Route.AlbumDetail("wy", "2003", fallback)
        assertEquals("wy", route.source)
        assertEquals("2003", route.id)
        assertEquals("叶惠美", route.fallback?.name)
        assertEquals(route, HomeNavigator.Route.AlbumDetail("wy", "2003", fallback))
    }

    @Test
    fun reselecting_discover_emits_reset_signal() {
        val nav = HomeNavigator()

        assertFalse(nav.selectTab(HomeTab.MY))
        assertFalse(nav.selectTab(HomeTab.DISCOVER))
        assertTrue(nav.selectTab(HomeTab.DISCOVER))
    }

    private fun albumItem(
        id: String,
        name: String = "专辑$id",
    ): AlbumItem = AlbumItem(id = id, name = name, source = "kw")

    private fun artistItem(
        id: String,
        name: String = "歌手$id",
    ): ArtistItem = ArtistItem(id = id, name = name, source = "kw")
}
