import { useEffect, useState, type PropsWithChildren } from 'react'

import themeState, { ThemeContext } from '@/store/theme/state'

/**
 * 播控页上"点按钮才出现的那些层"（播放列表、更多、歌词设置、定时关闭、分享卡）在这里挂回用户主题原本的底。
 *
 * 动态背景只管播控页自己那一片：② 的糊封面 + 黑纱面板是给铺底用的，弹层跟着换就成了
 * "半透明的黑纱浮在糊图上"，读起来像没做完的界面。挂回原主题之后，这些弹层跟 App 里其他弹层一个样。
 *
 * 为什么不是把 c-content-background 从 COVER_RULES 里摘掉：同一个键在场上还有两个正经用场 ——
 * `Vertical/Pic.tsx` 的碟片垫和 PlayerOverlay 展开动画的淡入底，摘了它们就各自塌成一块白板。
 * 差别在"哪一棵子树"，所以只能按子树作用域解决。
 *
 * 为什么一个 provider 就够：弹层里的字色、边框、滑块走的仍是 `useTheme()` 与 `useGlassColors`，
 * 而 React 的 context 会穿过 `Modal` 那一层 portal —— value 换回来，弹层内部一行都不用改。
 *
 * 订阅方式与根上的 ThemeProvider 一致（同一个 themeUpdated 事件），所以换主题时弹层照样跟着换；
 * 动态背景没开时这里的值与根上的引用相同，等于白包一层，不会多渲染。
 */
export default ({ children }: PropsWithChildren) => {
  const [theme, setTheme] = useState(themeState.theme)

  useEffect(() => {
    const handleUpdateTheme = (theme: LX.ActiveTheme) => {
      requestAnimationFrame(() => {
        setTheme(theme)
      })
    }
    global.state_event.on('themeUpdated', handleUpdateTheme)
    return () => {
      global.state_event.off('themeUpdated', handleUpdateTheme)
    }
  }, [])

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
}
