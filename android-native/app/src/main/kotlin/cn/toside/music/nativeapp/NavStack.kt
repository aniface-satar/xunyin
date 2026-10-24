package cn.toside.music.nativeapp

import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember

/**
 * 可观察的导航栈骨架。
 *
 * B0 阶段的极简导航实现，语义对齐 SaltUI 的 SaltNavigator：
 * - back 栈为主历史，末位即当前屏；
 * - forward 栈保存被 back 弹出的路由，支持浏览器式前进；
 * - navigate 到 topLevel 路由时清空 back 栈只留根并清空 forward 栈；
 * - navigate 到当前栈顶路由为 no-op。
 *
 * B5 批次评估是否换回 salt-ui-navigation（见迁移文档 §七 B0 决策）。
 */
class NavStack(
    initialRoute: Route,
    topLevelRoutes: Set<Route>,
) {
    /** 全局覆盖页路由；首页内部详情由 HomeNavigator 分 tab 管理。 */
    sealed interface Route {
        data object Home : Route

        data object PlayDetail : Route

        data object Settings : Route
    }

    /** 触发 topLevel 重置行为的路由集合。 */
    val topLevelRoutes: Set<Route> = topLevelRoutes + initialRoute

    /** 主历史栈，末位为当前屏。 */
    val backStack = mutableStateListOf(initialRoute)

    /** 前进栈。 */
    val forwardStack = mutableStateListOf<Route>()

    /** 当前屏。 */
    val current: Route
        get() = backStack.last()

    /** 导航到 [route]。栈顶重复为 no-op；topLevel 路由触发重置。 */
    fun navigate(route: Route) {
        if (route == current) {
            return
        }
        if (forwardStack.isNotEmpty()) {
            forwardStack.clear()
        }
        if (route in topLevelRoutes) {
            backStack.subList(1, backStack.size).clear()
            backStack[0] = route
        } else {
            backStack.add(route)
        }
    }

    /** 回退一步，被弹出的路由压入 forward 栈。仅剩根时 no-op。 */
    fun back() {
        if (backStack.size > 1) {
            forwardStack.add(backStack.removeAt(backStack.size - 1))
        }
    }

    /** 前进一步。forward 栈空时 no-op。 */
    fun forward() {
        if (forwardStack.isNotEmpty()) {
            backStack.add(forwardStack.removeAt(forwardStack.size - 1))
        }
    }
}

/** 记住一个 [NavStack]。B0 仅静态单屏堆叠，无状态恢复需求。 */
@Composable
fun rememberNavStack(initial: NavStack.Route): NavStack =
    remember(initial) { NavStack(initialRoute = initial, topLevelRoutes = setOf(NavStack.Route.Home)) }
