import { useContext, useEffect, useState } from 'react'
import { ThemeContext } from './state'
import settingState from '@/store/setting/state'

// export const useSetting = () => {
//   const [setting, updateSetting] = useState(state.setting)

//   useEffect(() => {
//     const handleUpdate = () => {
//       updateSetting(state.setting)
//     }
//     global.state_event.on('configUpdated', handleUpdate)
//     return () => {
//       global.state_event.off('configUpdated', handleUpdate)
//     }
//   }, [])

//   return setting
// }

// export const useSettingValue = <T extends keyof LX.AppSetting>(key: T): LX.AppSetting[T] => {
//   const [value, update] = useState(state.setting[key])

//   useEffect(() => {
//     const handleUpdate = (keys: Array<keyof LX.AppSetting>) => {
//       if (!keys.includes(key)) return
//       update(state.setting[key])
//     }
//     global.state_event.on('configUpdated', handleUpdate)
//     return () => {
//       global.state_event.off('configUpdated', handleUpdate)
//     }
//   }, [key])

//   return value
// }

export const useTheme = () => useContext(ThemeContext)

/**
 * 文字/图标阴影开关。
 *
 * 壁纸模式下强制打开：那时候字恒为白、底是任意一张照片，笔画边缘的对比度没有任何东西兜着 ——
 * 柔光只能压"整张图有多亮"，压不住"这一行字正好落在高光上"。阴影管的就是这一格。
 * 阴影颜色由 utils/wallpaper/palette.ts 换成实黑（主题那支 0.20 的彩色阴影在照片上等于没有）。
 */
export const useTextShadow = () => {
  const [value, update] = useState(settingState.setting['theme.fontShadow'])
  const theme = useTheme()

  useEffect(() => {
    const handleUpdate = (keys: Array<keyof LX.AppSetting>, setting: Partial<LX.AppSetting>) => {
      if (!keys.includes('theme.fontShadow')) return
      requestAnimationFrame(() => {
        update(setting['theme.fontShadow']!)
      })
    }
    global.state_event.on('configUpdated', handleUpdate)
    return () => {
      global.state_event.off('configUpdated', handleUpdate)
    }
  }, [])

  return value || theme['is-wallpaper']
}
