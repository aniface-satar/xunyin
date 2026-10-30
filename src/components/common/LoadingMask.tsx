import { useState, useCallback, useMemo, useRef, forwardRef, useImperativeHandle } from 'react'
import { Animated, StyleSheet, View } from 'react-native'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'
import { WALLPAPER_SCRIM, WALLPAPER_SCRIM_LIGHT, clampWallpaperVeil } from '@/utils/wallpaper/palette'
import { useSettingValue } from '@/store/setting/hook'
import Loading from './Loading'

// interface LoadingMaskProps {

// }

export interface LoadingMaskType {
  setVisible: (visible: boolean) => void
}

export default forwardRef<LoadingMaskType, {}>((props, ref) => {
  const theme = useTheme()
  const veilDark = useSettingValue('theme.customBg.veilDark')
  const veilLight = useSettingValue('theme.customBg.veilLight')
  const t = useI18n()
  const animFade = useRef(new Animated.Value(0)).current
  const [maskVisible, setMaskVisible] = useState(false)

  useImperativeHandle(ref, () => ({
    setVisible(visible: boolean) {
      if (maskVisible == visible) return
      visible ? handleShow() : handleHide()
    },
  }))

  const handleShow = useCallback(() => {
    // console.log('handleShow')
    setMaskVisible(true)

    Animated.parallel([
      Animated.timing(animFade, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start()
  }, [animFade])

  const handleHide = useCallback(() => {
    // Will change fadeAnim value to 0 in 5 seconds
    // console.log('handleHide')
    Animated.parallel([
      Animated.timing(animFade, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start((finished) => {
      // console.log(finished)
      if (!finished) return
      setMaskVisible(false)
    })
  }, [animFade])


  const maskComponent = useMemo(() => (
    // 壁纸模式下 c-main-background 是全透明的（背景要一直透到最底下），这层遮罩就失去了
    // "先盖住、再淡出"的意义 —— 加载中还看得见下面那半张列表。所以那时候改铺与页面同款的
    // 一对柔光（压暗 + 提亮两层、深度跟当前那张背景走），淡出时仍然是"从柔光回到照片"，
    // 与别处是同一套语言。两层放遮罩内部：整体一起淡出，不会露出一层"没淡干净"的底色。
    <Animated.View style={{ ...styles.container, backgroundColor: theme['is-wallpaper'] ? 'transparent' : theme['c-main-background'], opacity: animFade }}>
      {
        theme['is-wallpaper']
          ? (
              <>
                <View style={[StyleSheet.absoluteFill, { backgroundColor: WALLPAPER_SCRIM, opacity: clampWallpaperVeil(veilDark) }]} />
                <View style={[StyleSheet.absoluteFill, { backgroundColor: WALLPAPER_SCRIM_LIGHT, opacity: clampWallpaperVeil(veilLight) }]} />
              </>
            )
          : null
      }
      <Loading size={25} label={t('list_loading')} />
    </Animated.View>
  ), [animFade, t, theme, veilDark, veilLight])

  return maskVisible ? maskComponent : null
})

const styles = createStyle({
  container: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: '100%',
    height: '100%',
    zIndex: 10,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
  },
})
