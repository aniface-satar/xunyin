package cn.toside.music.nativeapp

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * NavStack 语义测试（对齐 SaltNavigator 行为）。
 */
class NavStackTest {
    private fun stack() =
        NavStack(
            initialRoute = NavStack.Route.Home,
            topLevelRoutes = setOf(NavStack.Route.Home),
        )

    @Test
    fun initial_state_is_root() {
        val nav = stack()
        assertEquals(NavStack.Route.Home, nav.current)
        assertEquals(1, nav.backStack.size)
        assertTrue(nav.forwardStack.isEmpty())
    }

    @Test
    fun navigate_pushes_route() {
        val nav = stack()
        nav.navigate(NavStack.Route.Settings)
        assertEquals(NavStack.Route.Settings, nav.current)
        assertEquals(2, nav.backStack.size)
    }

    @Test
    fun navigate_to_current_is_noop() {
        val nav = stack()
        nav.navigate(NavStack.Route.Settings)
        nav.navigate(NavStack.Route.Settings)
        assertEquals(2, nav.backStack.size)
        assertEquals(NavStack.Route.Settings, nav.current)
    }

    @Test
    fun navigate_clears_forward_stack() {
        val nav = stack()
        nav.navigate(NavStack.Route.Settings)
        nav.back()
        assertEquals(1, nav.forwardStack.size)
        nav.navigate(NavStack.Route.Settings)
        assertTrue(nav.forwardStack.isEmpty())
        assertEquals(NavStack.Route.Settings, nav.current)
    }

    @Test
    fun back_moves_route_to_forward_stack() {
        val nav = stack()
        nav.navigate(NavStack.Route.Settings)
        nav.back()
        assertEquals(NavStack.Route.Home, nav.current)
        assertEquals(listOf(NavStack.Route.Settings), nav.forwardStack)
    }

    @Test
    fun back_on_root_is_noop() {
        val nav = stack()
        nav.back()
        assertEquals(NavStack.Route.Home, nav.current)
        assertTrue(nav.forwardStack.isEmpty())
        assertEquals(1, nav.backStack.size)
    }

    @Test
    fun forward_restores_route() {
        val nav = stack()
        nav.navigate(NavStack.Route.Settings)
        nav.back()
        nav.forward()
        assertEquals(NavStack.Route.Settings, nav.current)
        assertTrue(nav.forwardStack.isEmpty())
        assertEquals(2, nav.backStack.size)
    }

    @Test
    fun forward_on_empty_stack_is_noop() {
        val nav = stack()
        nav.forward()
        assertEquals(NavStack.Route.Home, nav.current)
        assertEquals(1, nav.backStack.size)
    }

    @Test
    fun topLevel_reset_replaces_root() {
        val nav = stack()
        nav.navigate(NavStack.Route.Settings)
        nav.navigate(NavStack.Route.Home)
        // Home 是 topLevel：back 栈应只剩根，且被替换后的栈深度为 1
        assertEquals(1, nav.backStack.size)
        assertEquals(NavStack.Route.Home, nav.current)
    }
}
