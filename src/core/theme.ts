import themeActions from '@/store/theme/action'
import { getTheme } from '@/theme/themes'
import { updateSetting } from './common'
import themeState from '@/store/theme/state'

export const setShouldUseDarkColors = (shouldUseDarkColors: boolean) => {
  themeActions.setShouldUseDarkColors(shouldUseDarkColors)
}

export const applyTheme = (theme: LX.Theme) => {
  themeActions.setTheme(theme)
}

export const setTheme = (id: string) => {
  updateSetting({ 'theme.id': id })
  void getTheme().then(theme => {
    if (theme.id == themeState.theme.id) return
    applyTheme(theme)
  })
}

/**
 * 按当前设置重算一次生效主题。
 *
 * `setTheme` 那条路认的是"主题 id 变了没"，而自定义背景是挂在同一个主题上的另一层 ——
 * 换图、切开关时 id 没动，走 setTheme 会被它自己那句提前返回挡掉，播放页仍旧铺着上一张。
 */
export const refreshTheme = async() => {
  applyTheme(await getTheme())
}
