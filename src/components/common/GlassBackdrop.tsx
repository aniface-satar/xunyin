import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { ImageBackground, StyleSheet, View, type ImageSourcePropType, type ViewProps } from 'react-native'

import { useTheme } from '@/store/theme/hook'
import { useSettingValue } from '@/store/setting/hook'
import { getCustomBgSource } from '@/utils/customBgBridge'
import useWindowSize from '@/utils/hooks/useWindowSize'
import { WALLPAPER_SCRIM, clampWallpaperVeil } from '@/utils/wallpaper/palette'

// 跟帧重测的落定条件：连续 N 帧测量值不变视为动画已结束；超过时限强制停止兜底
const SETTLE_STABLE_FRAMES = 3
const SETTLE_TIMEOUT = 1500

interface GlassBackdropProps {
  blurRadius?: number
  overlayOpacity?: number
  /**
   * 贴在"页面自己已经铺过柔光"的地方用（底部导航栏、播放栏）。壁纸模式下这两条横栏下面
   * 就是 PageContent 那层柔光，这里再补一层只会比页面更深 —— 于是壁纸正好在横栏那里
   * 显出一道色带。带 flat 就什么都不画，让横栏和页面严丝合缝地是同一张图。
   */
  flat?: boolean
  /**
   * 挂在播控页那一侧的弹层（更多、分享卡）用：只有用户把图片背景也应用到播控页
   * （`theme.customBg.applyToPlayer`）时才糊图，否则退回只有压暗的那一版。
   */
  playerScope?: boolean
  style?: ViewProps['style']
}

const GlassBackdrop = ({ blurRadius = 18, overlayOpacity = 0.62, flat = false, playerScope = false, style }: GlassBackdropProps) => {
  const theme = useTheme()
  const windowSize = useWindowSize()
  const veil = useSettingValue('theme.customBg.veil')
  const viewRef = useRef<View>(null)
  const [windowOffset, setWindowOffset] = useState({ x: 0, y: 0 })
  // 跟帧重测的运行标记：兼作卸载标记（cleanup 置 false，让在途回调直接丢弃）
  const settlingRef = useRef(false)

  const applyOffset = useCallback((x: number, y: number) => {
    setWindowOffset((offset) => {
      return offset.x == x && offset.y == y ? offset : { x, y }
    })
  }, [])

  // 弹层（Sheet / Dialog / 分享卡）的入场是祖先节点上的 translateY 动画（useSheetSlideAnimation 等），
  // 而 Android 的 measureInWindow 会把动画进行中的位移一并算进窗口坐标 —— 挂载那一刻面板还在
  // 屏幕外半路上，首测结果整体偏下，糊图跟着上移，最后只有面板顶部一小条能对上屏幕。
  // 所以测量不能只做一次：onLayout 后跟帧重测，直到数值连续数帧不再变化（动画落定）或超时。
  const startSettleLoop = useCallback(() => {
    if (settlingRef.current) return
    settlingRef.current = true
    let lastX = Number.NaN
    let lastY = Number.NaN
    let stableFrames = 0
    const startedAt = Date.now()
    const tick = () => {
      const view = viewRef.current
      if (view == null) {
        settlingRef.current = false
        return
      }
      view.measureInWindow((x, y) => {
        if (!settlingRef.current) return
        if (x == lastX && y == lastY) {
          stableFrames += 1
          if (stableFrames >= SETTLE_STABLE_FRAMES) {
            settlingRef.current = false
            return
          }
        } else {
          stableFrames = 0
          lastX = x
          lastY = y
          applyOffset(x, y)
        }
        if (Date.now() - startedAt > SETTLE_TIMEOUT) {
          settlingRef.current = false
          return
        }
        requestAnimationFrame(tick)
      })
    }
    tick()
  }, [applyOffset])

  useEffect(() => {
    return () => {
      settlingRef.current = false
    }
  }, [])

  const handleLayout = useCallback(() => {
    viewRef.current?.measureInWindow((x, y) => {
      applyOffset(x, y)
      startSettleLoop()
    })
  }, [applyOffset, startSettleLoop])

  // 壁纸模式：
  // - 贴在"页面自己铺过柔光的横栏"上（flat：底部导航栏、播放栏）什么都不画 —— 那两条下面
  //   就是 PageContent 那层柔光，再糊一遍等于把壁纸在原地打码，与"图直接铺在最底层"矛盾。
  // - 弹层（Sheet / Dialog / Popup / 分享卡）不同：它们的面在壁纸模式里是透明的，弹层自己的
  //   背景必须糊，否则一整块内容直接压在照片纹理上，每一行都要在图的明暗里找字。
  //   所以这里糊的是弹层自己的底：糊掉的壁纸 + 深色压暗，糊图按屏幕坐标铺，与页面上的壁纸对得上。
  const wallpaper = theme['is-wallpaper']

  const source: ImageSourcePropType | undefined = theme['bg-image']
  const hasSource = source != null

  if (wallpaper) {
    if (flat) {
      // 只为保留 measureInWindow 的 onLayout（播放栏那一支没有依赖它，但保住结构一致没坏处）
      return <View ref={viewRef} onLayout={handleLayout} pointerEvents="none" style={[styles.backdrop, style]} />
    }
    // 壁纸模式下 `bg-image` 只在 applyToPlayer 打开时才是那张自定义图（关掉时它是主题插画）。
    // 播控页那一侧的弹层跟着播控页走（playerScope）：用户关了 applyToPlayer 就是明说
    // "播放页不要这张图"，这里再糊出来等于绕过那个开关，退回只有压暗的那一版。
    const customSource = getCustomBgSource()
    const layerSource: ImageSourcePropType | undefined = customSource == null
      ? undefined
      : (playerScope && !customSource.applyToPlayer ? undefined : { uri: customSource.uri })
    return (
      <View ref={viewRef} onLayout={handleLayout} pointerEvents="none" style={[styles.backdrop, style]}>
        {layerSource != null && (
          <ImageBackground
            // 按屏幕坐标铺：弹层只占屏幕的一块（抽屉 3/4、底部面板大半屏），
            // 用 cover 铺容器会把这张图重新裁一遍，弹层里那块的纹理与页面上的对不上（糊过之后仍看得出来）
            style={{
              position: 'absolute',
              left: -windowOffset.x,
              top: -windowOffset.y,
              width: windowSize.width,
              height: windowSize.height,
            }}
            source={layerSource}
            resizeMode="cover"
            blurRadius={blurRadius}
          />
        )}
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: WALLPAPER_SCRIM,
              opacity: Math.max(clampWallpaperVeil(veil), 0.62),
            },
          ]}
        />
      </View>
    )
  }

  return (
    <View
      ref={viewRef}
      onLayout={handleLayout}
      pointerEvents="none"
      style={[styles.backdrop, style]}
    >
      {hasSource && (
        <ImageBackground
          style={{
            position: 'absolute',
            left: -windowOffset.x,
            top: -windowOffset.y,
            width: windowSize.width,
            height: windowSize.height,
          }}
          source={source}
          resizeMode="cover"
          blurRadius={blurRadius}
        />
      )}
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: theme['c-content-background'],
            opacity: hasSource ? overlayOpacity : overlayOpacity + 0.06,
          },
        ]}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
})

export default memo(GlassBackdrop)
