import { memo, useCallback, useRef, useEffect } from 'react'
import { type LayoutChangeEvent, StyleSheet, View, StatusBar, Dimensions, AppState, PixelRatio } from 'react-native'
import commonState from '@/store/common/state'
import settingState from '@/store/setting/state'
import { setNavigationBarHeight, setStatusbarHeight } from '@/core/common'
import { windowSizeTools, getWindowSize } from '@/utils/windowSizeTools'
import { getWindowInsets, onWindowInsetsChange, type WindowInsets } from '@/utils/nativeModules/utils'

const getStatusbarHeight = (winHeight: number, layoutHeight: number) => {
  const height = (!settingState.setting['common.alwaysKeepStatusbarHeight'] &&
          parseFloat(winHeight.toFixed(2)) >= parseFloat(layoutHeight.toFixed(2)))
    ? 0
    : (StatusBar.currentHeight ?? 0)

  return height
}

export default memo(() => {
  const currentHeightRef = useRef(commonState.statusbarHeight)
  const sizeRef = useRef([0, 0])
  const dimensionsChangedRef = useRef(true)
  const handleInsets = useCallback((insets: WindowInsets) => {
    // 原生给的是 px，界面用的都是 dp
    setNavigationBarHeight(Math.round(insets.navigationBar / PixelRatio.get()))
  }, [])
  const refreshInsets = useCallback(() => {
    void getWindowInsets().then(handleInsets).catch(() => {})
  }, [handleInsets])
  const handleLayout = useCallback(({ nativeEvent: { layout } }: LayoutChangeEvent | { nativeEvent: { layout: { width: number, height: number } } }) => {
    // console.log('handleLayout')
    refreshInsets()
    if (!dimensionsChangedRef.current) return
    void getWindowSize().then(size => {
      dimensionsChangedRef.current = false
      // console.log(layout, size)
      sizeRef.current = [size.height, layout.height]
      const height = getStatusbarHeight(size.height, layout.height)

      if (currentHeightRef.current != height) {
        currentHeightRef.current = height
        setStatusbarHeight(height)
      }
      // console.log(layout, size)
      const currentSize = windowSizeTools.getSize()
      if (currentSize.width != layout.width || currentSize.height != layout.height) {
        windowSizeTools.setWindowSize(layout.width, layout.height)
      }
    })
  }, [refreshInsets])
  useEffect(() => {
    // let timeout: NodeJS.Timeout | null = null
    const subscription = Dimensions.addEventListener('change', () => {
      dimensionsChangedRef.current = true
      refreshInsets()
      // if (timeout) clearTimeout(timeout)
      // timeout = setTimeout(() => {
      //   timeout = null
      //   viewRef.current?.measureInWindow((x, y, width, height) => {
      //     handleLayout({ nativeEvent: { layout: { width, height } } })
      //   })
      // }, 100)
    })

    // 导航方式（三键 / 手势）切换要去系统设置里改，回来时窗口不重建、Dimensions 也不一定变，
    // 只能在回到前台时再取一次
    const appStateListener = AppState.addEventListener('change', (appState) => {
      if (appState == 'active') refreshInsets()
    })
    const removeInsetsListener = onWindowInsetsChange(handleInsets)
    refreshInsets()

    const handleSettingUpdate = (keys: Array<keyof LX.AppSetting>) => {
      if (!keys.includes('common.alwaysKeepStatusbarHeight') || !sizeRef.current[1]) return
      const height = getStatusbarHeight(sizeRef.current[0], sizeRef.current[1])

      if (currentHeightRef.current != height) {
        currentHeightRef.current = height
        setStatusbarHeight(height)
      }
    }
    global.state_event.on('configUpdated', handleSettingUpdate)

    return () => {
      subscription.remove()
      appStateListener.remove()
      removeInsetsListener()
      global.state_event.off('configUpdated', handleSettingUpdate)
    }
  }, [handleInsets, refreshInsets])
  return (<View style={StyleSheet.absoluteFill} onLayout={handleLayout} />)
}, () => true)

