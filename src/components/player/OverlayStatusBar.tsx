import { useEffect } from 'react'
import { StatusBar } from 'react-native'

import { useTheme } from '@/store/theme/hook'
import themeState from '@/store/theme/state'

const barStyleOf = (isDark: boolean) => isDark ? 'light-content' : 'dark-content'

/**
 * 播控页的状态栏图标明暗：只改 style，**不挂 RN 的 `<StatusBar>` 组件**。
 *
 * 为什么不能用组件：RN 的 StatusBar 在合并 props 时对 translucent 是无条件下发的
 * （Libraries/Components/StatusBar/StatusBar.js）——
 *   `if (!oldProps || oldProps.translucent !== mergedProps.translucent || mergedProps.translucent)`
 *   -> `NativeStatusBarManagerAndroid.setTranslucent(mergedProps.translucent)`
 * 只要 translucent 为真，**每挂载一次就走一次原生**；而原生实现在
 * modules/statusbar/StatusBarModule.java 里是：
 *   `decorView.setOnApplyWindowInsetsListener(...)` + `ViewCompat.requestApplyInsets(decorView)`
 * —— 强制整个 window 重新分发 system inset 并全量重排。布局一个都还没变，但要重新量一遍
 * 整棵树；有虚拟导航键时底部 inset 非零，这一下重排正好砸在从控制栏展开的第一帧上：
 * 页面（顶部标题栏 + 控制栏 + 底部导航栏）被整体重排，而 progress 是墙上时间驱动的
 * 补间，丢掉的那一两帧不会补偿，于是卡片上沿/导航栏/控制栏同时瞬移一段。
 *
 * 播控页里原本有两份 Header（静态头部 + ghost 头部），也就是两次 requestApplyInsets。
 * 现在两份都不再挂 `<StatusBar>`（Header 的 statusBar={false}），由这里统一把明暗切一次：
 * 静态 setBarStyle 只走 setStyle -> setSystemBarsAppearance，不碰 inset，也不重排。
 *
 * 首页自己那份 `<StatusBar>` 在播控页打开期间一直挂着，所以 translucent 的状态不会被撤销；
 * 这里只覆盖"图标明暗"这一项，退出时还原成页面主题的那一档（与 core/init/theme.ts 同源）。
 */
export default () => {
  const theme = useTheme()
  const barStyle = barStyleOf(theme.isDark)

  useEffect(() => {
    StatusBar.setBarStyle(barStyle)
  }, [barStyle])

  useEffect(() => () => {
    StatusBar.setBarStyle(barStyleOf(themeState.theme.isDark))
  }, [])

  return null
}
