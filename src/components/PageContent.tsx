// import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { useTheme } from '@/store/theme/hook'
import ImageBackground from '@/components/common/ImageBackground'
import { useWindowSize } from '@/utils/hooks'
import { useMemo } from 'react'
import { useSettingValue } from '@/store/setting/hook'
import { toImageUri, useActiveCustomBg } from '@/core/customBg'
import { WALLPAPER_SCRIM, WALLPAPER_SCRIM_LIGHT, clampWallpaperVeil } from '@/utils/wallpaper/palette'
import SizeView from './SizeView'

interface Props {
  children: React.ReactNode
}

export default ({ children }: Props) => {
  const theme = useTheme()
  const windowSize = useWindowSize()
  // 自定义图片背景优先于主题自带背景图：模糊度是每套自己的，所以不能只靠 theme['bg-image']
  // （那个键在主题里是单值、且被播控页共用），这里直接读原始条目，带 blurRadius 一起铺。
  const customBgEnabled = useSettingValue('theme.customBg.enabled')
  const veilDark = useSettingValue('theme.customBg.veilDark')
  const veilLight = useSettingValue('theme.customBg.veilLight')
  const customBg = useActiveCustomBg()
  const customSource = useMemo(() => customBg ? { uri: toImageUri(customBg.file) } : null, [customBg])
  const usingCustomBg = customBgEnabled && customSource != null
  // const [wh, setWH] = useState<{ width: number | string, height: number | string }>({ width: '100%', height: Dimensions.get('screen').height })

  // 固定宽高度 防止弹窗键盘时大小改变导致背景被缩放
  // useEffect(() => {
  //   const onChange = () => {
  //     setWH({ width: '100%', height: '100%' })
  //   }

  //   const changeEvent = Dimensions.addEventListener('change', onChange)
  //   return () => {
  //     changeEvent.remove()
  //   }
  // }, [])
  // const handleLayout = (e: LayoutChangeEvent) => {
  //   // console.log('handleLayout', e.nativeEvent)
  //   // console.log(Dimensions.get('screen'))
  //   setWH({ width: e.nativeEvent.layout.width, height: Dimensions.get('screen').height })
  // }
  // console.log('render page content')

  const themeComponent = useMemo(() => (
    <View style={{ flex: 1, overflow: 'hidden' }}>
      <ImageBackground
        style={{ position: 'absolute', left: 0, top: 0, height: windowSize.height, width: windowSize.width, backgroundColor: theme['c-content-background'] }}
        source={usingCustomBg ? customSource : theme['bg-image']}
        resizeMode="cover"
        blurRadius={usingCustomBg && customBg ? customBg.blur : 0}
      >
      </ImageBackground>
      {
        // 铺了自定义图之后，这层不能再是不透明的 c-main-background（它是 rgba(255,255,255,1)，
        // 会把整张图连主题自带的 bg-image 一起盖死）。
        //
        // 之前这里是一层 0.24 的同色薄纱（亮色主题白纱 / 暗色主题黑纱），也就是"把图洗淡"。
        // 现在是两支常量、两条独立的滑块（编辑页每张背景自己的 veilDark / veilLight）：
        // 压暗层把高光按下去、提亮层把阴影抬起来，**同时生效、可以叠加** ——
        // 一压一提的组合就是"雾面 / 胶片感"；只开一支就是原来的单向柔光。
        // 深度归用户调，因为"明信片一样亮的图"和"夜景"要的量差很多，而且两层叠多少也随口味。
        usingCustomBg
          ? (
              <>
                <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: WALLPAPER_SCRIM, opacity: clampWallpaperVeil(veilDark) }} />
                <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: WALLPAPER_SCRIM_LIGHT, opacity: clampWallpaperVeil(veilLight) }} />
              </>
            )
          : null
      }
      <View style={{ flex: 1, flexDirection: 'column', backgroundColor: usingCustomBg ? 'transparent' : theme['c-main-background'] }}>
        {children}
      </View>
    </View>
  ), [children, theme, windowSize.height, windowSize.width, usingCustomBg, customSource, customBg, veilDark, veilLight])
  return (
    <>
      <SizeView />
      {themeComponent}
    </>
  )
}
