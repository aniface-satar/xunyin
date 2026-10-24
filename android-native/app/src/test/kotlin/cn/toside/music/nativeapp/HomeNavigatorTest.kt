package cn.toside.music.nativeapp

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

    @Test
    fun reselecting_discover_emits_reset_signal() {
        val nav = HomeNavigator()

        assertFalse(nav.selectTab(HomeTab.MY))
        assertFalse(nav.selectTab(HomeTab.DISCOVER))
        assertTrue(nav.selectTab(HomeTab.DISCOVER))
    }
}
