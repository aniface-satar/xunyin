import { useCallback, useMemo, useRef } from 'react'
import { Animated, Easing, useWindowDimensions, type LayoutChangeEvent } from 'react-native'

const ENTER_DURATION = 250
const EXIT_DURATION = 200

type Phase = 'idle' | 'armed' | 'entering' | 'entered' | 'exiting'

// RN 的 Modal 在 Android 上 animationType="slide" 是对整个 dialog 窗口做位移，
// 遮罩会随面板一起硬边扫过屏幕造成闪屏，故改为窗口内自绘动画：遮罩原地淡入、仅面板位移
export const useSheetSlideAnimation = () => {
  const { height: windowHeight } = useWindowDimensions()
  const windowHeightRef = useRef(windowHeight)
  windowHeightRef.current = windowHeight

  const maskOpacity = useMemo(() => new Animated.Value(0), [])
  const sheetY = useMemo(() => new Animated.Value(0), [])
  const sheetHeightRef = useRef(0)
  const phaseRef = useRef<Phase>('idle')

  const show = useCallback(() => {
    phaseRef.current = 'armed'
    maskOpacity.setValue(0)
    sheetY.setValue(sheetHeightRef.current || windowHeightRef.current)
  }, [maskOpacity, sheetY])

  const onSheetLayout = useCallback((event: LayoutChangeEvent) => {
    const height = event.nativeEvent.layout.height
    if (!height) return
    sheetHeightRef.current = height
    if (phaseRef.current != 'armed') return
    phaseRef.current = 'entering'
    sheetY.setValue(height)
    Animated.parallel([
      Animated.timing(sheetY, {
        toValue: 0,
        duration: ENTER_DURATION,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(maskOpacity, {
        toValue: 1,
        duration: ENTER_DURATION,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished && phaseRef.current == 'entering') phaseRef.current = 'entered'
    })
  }, [maskOpacity, sheetY])

  const hide = useCallback((onHidden?: () => void) => {
    if (phaseRef.current == 'exiting') return
    if (phaseRef.current == 'idle' || phaseRef.current == 'armed') {
      phaseRef.current = 'idle'
      onHidden?.()
      return
    }
    phaseRef.current = 'exiting'
    Animated.parallel([
      Animated.timing(sheetY, {
        toValue: sheetHeightRef.current || windowHeightRef.current,
        duration: EXIT_DURATION,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(maskOpacity, {
        toValue: 0,
        duration: EXIT_DURATION,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    ]).start(() => {
      phaseRef.current = 'idle'
      onHidden?.()
    })
  }, [maskOpacity, sheetY])

  return useMemo(() => ({
    show,
    hide,
    onSheetLayout,
    maskOpacity,
    sheetY,
  }), [show, hide, onSheetLayout, maskOpacity, sheetY])
}
