import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { ImageBackground, StyleSheet, View, type ImageSourcePropType, type ViewProps } from 'react-native'

import { useTheme } from '@/store/theme/hook'
import { useStatusbarHeight } from '@/store/common/hook'
import { getCachedBackdropSnapshot, requestBackdropSnapshot, type BackdropSnapshot } from '@/utils/backdropSnapshot'
import { getCustomBgSource } from '@/utils/customBgBridge'
import useWindowSize from '@/utils/hooks/useWindowSize'
import { dominantWallpaperScrim } from '@/utils/wallpaper/palette'
import { useSettingValue } from '@/store/setting/hook'

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
   * 位置重测信号。抽屉（DrawerLayoutAndroid）这类"整个面会平移"的容器用：
   * 它的导航视图在关闭时整块位于屏幕外，而这里的位置只在 onLayout 时测一次 ——
   * 挂载那一刻测到的是"还没滑进来"的坐标，糊图会整体偏出一个抽屉宽度。
   * 外部在容器挪动时换一个值（不传则不启用），这里就重跑一轮跟帧测量。
   */
  measureKey?: unknown
  /**
   * 静止位置（窗口坐标，dp）。面板自己会做入场位移，而这里铺的图必须钉在屏幕上 ——
   * 传了它就按它摆，不再逐帧 measureInWindow 去追面板。追是追不上的：测量回调比原生
   * 动画慢一帧以上，面板起步最快的那几帧错位最大，落定时再猛地对齐，观感就是背景"跳一下"。
   * 面板的 onLayout 坐标不含 translateY，正好就是这个位置（见 useSheetSlideAnimation.sheetLayout）。
   * 不传（抽屉那种整块平移的容器）才走测量。
   */
  restOffset?: { x: number, y: number } | null
  /**
   * 壁纸模式下玻璃面那层压色的不透明度。快照里已经烘着页面自己那对柔光
   * （`theme.customBg.veilDark` / `veilLight`），这里再按页面那档压一遍就会明显比四周
   * 黑一截、像一块深色框；固定成一个轻档，各处玻璃面才是"同一张图的磨砂版"。
   * 压色的方向按两层柔光里开得更深的那支取（见 dominantWallpaperScrim）。
   */
  scrimOpacity?: number
  /**
   * 挂在 RNN overlay（更新 / 公告 / 协议 / 同步模式）里时传 false。
   *
   * 那类窗口不是 RN Modal，跟页面同处一个 Activity 的 content —— 挂上之后再 captureScreen，
   * 拍到的画面里带着它自己（黑色遮罩 + 面板），糊出来就是"糊中糊"。这些面一律由
   * `showOverlayWithBackdrop` 在挂载前预拍；万一那次预拍超时，这里宁可空着（只留压暗层），
   * 也不去补拍一张把自己拍进去的图。
   */
  selfCapture?: boolean
  style?: ViewProps['style']
}

const GlassBackdrop = ({ blurRadius = 16, overlayOpacity = 0.62, scrimOpacity = 0.3, flat = false, selfCapture = true, measureKey, restOffset, style }: GlassBackdropProps) => {
  const theme = useTheme()
  // 两层柔光的主导方向：玻璃面只需要一支压色，跟页面里开得更深的那层同向
  const veilDark = useSettingValue('theme.customBg.veilDark')
  const veilLight = useSettingValue('theme.customBg.veilLight')
  const windowSize = useWindowSize()
  const statusBarHeight = useStatusbarHeight()
  const wallpaper = theme['is-wallpaper']
  // 判据只认"壁纸模式在不在"，不认 applyToPlayer：那个开关管的是播控页自己铺哪张底图，
  // 而这里糊的是快照（背后真实显示的页面）。播控页背景关掉时它背后可能是封面动态背景，
  // 快照照样拍得对 —— 再按 applyToPlayer 关门，只会让「更多」这类面板独独没有模糊。
  const customSource = wallpaper ? getCustomBgSource() : null
  const canUseBackdrop = customSource != null
  const viewRef = useRef<View>(null)
  const [measuredOffset, setMeasuredOffset] = useState({ x: 0, y: 0 })
  // 有静止锚点就用锚点，没有才用测量值（抽屉那条路）
  const windowOffset = restOffset ?? measuredOffset
  // 底图是"面板背后真实显示的那一帧"（见 utils/backdropSnapshot）。挂载时就取缓存：
  // 各面板在打开之前已经拍好，首帧拿到的就是最终那张图，没有"先垫一张、过一会儿再换"的中间态。
  const [snapshot, setSnapshot] = useState<BackdropSnapshot | null>(() => {
    return wallpaper && !flat && canUseBackdrop ? getCachedBackdropSnapshot() : null
  })
  // 跟帧重测的批次号：每次 startSettleLoop 自增，旧批次在下一帧发现批次号变了就自行退出。
  // 用它而不是"是否正在跑"的布尔量，是因为抽屉会二次触发（拖动 / 沉降 / 落定各一次），
  // 必须让在跑的那一轮立刻作废、由新一轮从当前坐标重测 —— 布尔量只能"有则忽略"，
  // 后到的触发会被吞掉，糊图就停在上一次（还在屏幕外的）坐标上。
  // 兼作卸载标记：cleanup 自增一次，在途的 measure 回调直接丢弃。
  const settleGenRef = useRef(0)

  const applyOffset = useCallback((x: number, y: number) => {
    setMeasuredOffset((offset) => {
      return offset.x == x && offset.y == y ? offset : { x, y }
    })
  }, [])

  // 弹层（Sheet / Dialog / 分享卡）的入场是祖先节点上的 translateY 动画（useSheetSlideAnimation 等），
  // 而 Android 的 measureInWindow 会把动画进行中的位移一并算进窗口坐标。能拿到静止锚点（restOffset）
  // 的弹层根本不测；只有抽屉这种"位置由外部决定、又拿不到布局坐标"的面才走这套跟帧测量：
  // onLayout 后跟帧重测，直到数值连续数帧不再变化（动画落定）或超时。
  const startSettleLoop = useCallback(() => {
    const gen = ++settleGenRef.current
    let lastX = Number.NaN
    let lastY = Number.NaN
    let stableFrames = 0
    const startedAt = Date.now()
    const tick = () => {
      if (settleGenRef.current != gen) return
      const view = viewRef.current
      if (view == null) return
      view.measureInWindow((x, y) => {
        if (settleGenRef.current != gen) return
        if (x == lastX && y == lastY) {
          stableFrames += 1
          if (stableFrames >= SETTLE_STABLE_FRAMES) return
        } else {
          stableFrames = 0
          lastX = x
          lastY = y
          applyOffset(x, y)
        }
        if (Date.now() - startedAt > SETTLE_TIMEOUT) return
        requestAnimationFrame(tick)
      })
    }
    tick()
  }, [applyOffset])

  useEffect(() => {
    return () => {
      // 自增一次，让在途的 measure 回调直接丢弃
      settleGenRef.current += 1
    }
  }, [])

  // RN Modal 在 Android 是独立 window，captureScreen 只拍 Activity 的 content 区，
  // 所以这里拿到的是面板背后真实的页面（含封面、文字、图标），不是另一张壁纸副本。
  // 同一次打开如果挂了多个玻璃层，它们共用 backdropSnapshot 里的在途请求与短缓存。
  useEffect(() => {
    if (!wallpaper || flat || !canUseBackdrop) return
    const cached = getCachedBackdropSnapshot()
    if (cached != null) {
      setSnapshot(cached)
      // 已经有"背后那一帧"就到此为止，不再重拍：换一张新 URI 就是换底，
      // 亮度、位置、模糊强度会跟着一起变，观感就是背景"跳一下"。
      return
    }
    // 没赶上预拍（截图失败 / 从别的入口挂上来）才补一张。这一档会有一次"从空到糊"，
    // 但至少不会两张图互跳 —— 补上之后就固定住。overlay 那一类面不许补拍（会拍到它自己），
    // 它们只认挂载前预拍的那一张。
    if (!selfCapture) return
    let active = true
    void requestBackdropSnapshot().then((next) => {
      if (!active || next == null) return
      setSnapshot(next)
    })
    return () => {
      active = false
    }
  }, [wallpaper, flat, canUseBackdrop, selfCapture, customSource?.uri])

  // 外部换值 = "这个面刚刚挪过位置"（抽屉从屏幕外滑进来）。首帧就会 applyOffset，
  // 所以这里不必额外先测一次。挂载时也会跑一轮，与 onLayout 那一轮重叠，无害。
  useEffect(() => {
    if (measureKey === undefined) return
    startSettleLoop()
  }, [measureKey, startSettleLoop])

  const handleLayout = useCallback(() => {
    // 有静止锚点时布局位置已经不再需要：锚点由父级 onLayout 给出，天然不带动画位移
    if (restOffset != null) return
    viewRef.current?.measureInWindow((x, y) => {
      applyOffset(x, y)
      startSettleLoop()
    })
  }, [applyOffset, startSettleLoop, restOffset])

  // 壁纸模式：
  // - 贴在"页面自己铺过柔光的横栏"上（flat：底部导航栏、播放栏）什么都不画 —— 那两条下面
  //   就是 PageContent 那层柔光，再糊一遍等于把壁纸在原地打码，与"图直接铺在最底层"矛盾。
  // - 弹层（Sheet / Dialog / Popup / 分享卡）不同：它们的面在壁纸模式里是透明的，弹层自己的
  //   背景必须糊，否则一整块内容直接压在照片纹理上，每一行都要在图的明暗里找字。
  //   糊的是**面板背后真实显示的页面**（封面、文字、图标一起进去），这就是"自身的毛玻璃"：
  //   面板内外是同一幅画面的清晰版与模糊版，不是"面板里另贴了一张糊壁纸"。
  //   模糊只算这一层 —— 快照是清晰的截图，没有预先糊过，不存在两层叠加。
  const source: ImageSourcePropType | undefined = theme['bg-image']
  const hasSource = source != null

  if (wallpaper) {
    if (flat) {
      // 只为保留 measureInWindow 的 onLayout（播放栏那一支没有依赖它，但保住结构一致没坏处）
      return <View ref={viewRef} onLayout={handleLayout} pointerEvents="none" style={[styles.backdrop, style]} />
    }
    return (
      <View ref={viewRef} onLayout={handleLayout} pointerEvents="none" style={[styles.backdrop, style]}>
        {snapshot != null && (
          <ImageBackground
            // 按屏幕坐标铺：弹层只占屏幕的一块（抽屉 3/4、底部面板大半屏），
            // 用 cover 铺容器会把这张图重新裁一遍，弹层里那块的纹理与页面上的对不上（糊过之后仍看得出来）
            style={{
              position: 'absolute',
              left: -windowOffset.x,
              // 快照来自 Activity content 区，起点在状态栏下；壁纸本身则覆盖整个屏幕
              top: statusBarHeight - windowOffset.y,
              width: windowSize.width,
              height: Math.max(1, windowSize.height - statusBarHeight),
            }}
            source={{ uri: snapshot.uri }}
            resizeMode="cover"
            // RN Android 给非资源图默认带 300ms 淡入（ReactImageView 里 REMOTE_IMAGE_FADE_DURATION_MS），
            // 底图不该自带淡入，否则面板会先透明一下再糊起来
            fadeDuration={0}
            // 快照只有屏幕 DP 的 1/4，半径同步缩小，放大回屏幕后才与这一层的模糊强度一致
            blurRadius={Math.max(1, blurRadius * snapshot.scale)}
          />
        )}
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              // 压色按两层柔光的主导方向取：只开压暗层就是深玻璃、只开提亮层就是浅玻璃，
              // 两层都开时跟主调走 —— 与页面的观感是同一套语言
              backgroundColor: dominantWallpaperScrim(veilDark, veilLight),
              opacity: scrimOpacity,
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
          // 同上：底图不该自带 300ms 淡入，否则"无壁纸"主题下也会先透明一下
          fadeDuration={0}
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
