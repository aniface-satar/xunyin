
import { getAppearance, getIsSupportedAutoTheme, onAppearanceChange } from '@/utils/tools'
import { setShouldUseDarkColors, applyTheme } from '@/core/theme'
import { getTheme } from '@/theme/themes/index'
import { loadCustomBg } from '@/core/customBg'
import settingState from '@/store/setting/state'
import StatusBar from '@/components/common/StatusBar'
// import { Dimensions, PixelRatio } from 'react-native'


export default async(setting: LX.AppSetting) => {
  if (getIsSupportedAutoTheme()) {
    setShouldUseDarkColors(getAppearance() == 'dark')

    onAppearanceChange(color => {
      setShouldUseDarkColors((color ?? 'light') == 'dark')
      if (settingState.setting['common.isAutoTheme']) void getTheme().then(applyTheme)
    })
  }

  // 自定义背景要在第一次拼主题之前就位：buildActiveThemeColors 是同步读桥的，
  // 晚一步加载，首帧的播控页就没有那张图（首页不受影响，它自己读列表）
  await loadCustomBg()

  applyTheme(await getTheme())

  global.state_event.on('themeUpdated', (theme) => {
    StatusBar.setBarStyle(theme.isDark ? 'light-content' : 'dark-content')
  })
  // onDimensionChange(({ window }) => {
  //   let screenW = window.width
  //   let screenH = window.height
  //   if (screenW > screenH) {
  //     const temp = screenW
  //     screenW = screenH
  //     screenH = temp
  //   }
  //   global.lx.windowInfo.screenW = screenW
  //   global.lx.windowInfo.screenH = screenH
  //   global.lx.windowInfo.screenPxW = PixelRatio.getPixelSizeForLayoutSize(screenW)
  //   global.lx.windowInfo.screenPxH = PixelRatio.getPixelSizeForLayoutSize(screenH)
  //   console.log('change', global.lx.windowInfo)
  // })
}
