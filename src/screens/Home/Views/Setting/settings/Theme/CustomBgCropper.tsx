import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Animated,
  Image,
  Modal,
  PanResponder,
  ScrollView,
  StatusBar,
  StyleSheet,
  TouchableOpacity,
  View,
  type GestureResponderEvent,
} from 'react-native'
import { captureRef } from 'react-native-view-shot'

import Slider, { type SliderProps } from '@/components/common/Slider'
import Text from '@/components/common/Text'
import { Icon } from '@/components/common/Icon'
import { useI18n } from '@/lang'
import { useStatusbarHeight } from '@/store/common/hook'
import { BorderRadius } from '@/theme'
import { useWindowSize } from '@/utils/hooks'
import { createStyle, toast } from '@/utils/tools'
import { scaleSizeH, scaleSizeW } from '@/utils/pixelRatio'
import {
  DEFAULT_CUSTOM_BG_BLUR,
  DEFAULT_CUSTOM_BG_INK,
  DEFAULT_CUSTOM_BG_VEIL_DARK,
  DEFAULT_CUSTOM_BG_VEIL_LIGHT,
  MAX_CUSTOM_BG_BLUR,
  MAX_CUSTOM_BG_VEIL,
  toImageUri,
  type CustomBgCrop,
} from '@/core/customBg'
import {
  WALLPAPER_INK_BASES,
  WALLPAPER_SCRIM,
  WALLPAPER_SCRIM_LIGHT,
  clampWallpaperVeil,
  matchWallpaperInkBase,
  normalizeWallpaperInk,
  wallpaperInkFromBase,
  type WallpaperInkBase,
} from '@/utils/wallpaper/palette'
import CustomBgPreviewMock from './CustomBgPreviewMock'

/** 与导出同构：预览里留一点余量，旋转后边角不会露底 */
const OVERSCAN = 1.06
const MIN_ZOOM = 1
const MAX_ZOOM = 5
/** 导出宽度（像素）。再按手机比例算高度，铺到屏幕上正好不缩放 */
const OUTPUT_WIDTH = 1440

// —— 底部工具区的尺寸账 ——
// Slider 组件自身的 style.height 40 走 createStyle → scaleSizeH（逐档取整），
// 覆盖板高度必须按「每行实际高度」累加，不能拿 scaleSizeH(200) 一步算到位
const SLIDER_ROW_H = scaleSizeH(40)
/** 「背景图片」覆盖板：5 行滑块 */
const SLIDER_DECK_HEIGHT = SLIDER_ROW_H * 5
// 色块与行距走内联尺寸（不经 createStyle 缩放），跟这里的公式同口径
const SWATCH_CELL = 32
const SWATCH_GAP = 2
const SWATCH_PER_ROW = 7
/** 「颜色」覆盖板：两排基础色（各带一行距）+ 一条饱和度滑杆 */
const COLOR_DECK_HEIGHT = (SWATCH_CELL + SWATCH_GAP) * 2 + scaleSizeH(6) + SLIDER_ROW_H
/** 翻页容器固定高：两块覆盖板之外剩下的空带，就是「右滑翻页」的手势区 */
const PAGER_HEIGHT = SLIDER_DECK_HEIGHT + scaleSizeH(60)

/** 编辑页专用白色滑杆：这个页面的主题色就是正在编辑的墨色（选什么色整棵主题树实时换），
 * 公共 Slider 的滑块/滑轨取 c-primary，跟着主题走就会随选色变 —— 本页钉死纯白 */
const SLIDER_WHITE = '#ffffff'
const WhiteSlider = (props: SliderProps) => (
  <Slider
    {...props}
    thumbTintColor={SLIDER_WHITE}
    minimumTrackTintColor={SLIDER_WHITE}
    maximumTrackTintColor={SLIDER_WHITE}
  />
)

export interface CropResult {
  path: string
  crop: CustomBgCrop
  blur: number
  /** 压暗层（深色柔光）深度：把照片的高光按下去 */
  veilDark: number
  /** 提亮层（浅色柔光）深度：把照片的阴影抬起来；两层同时生效、可叠加成雾面感 */
  veilLight: number
  /** 这一张自己的前景色（网格色板里选的那支） */
  ink: string
}

interface Props {
  visible: boolean
  source: string
  /** 重新剪裁时回填上一次的参数 */
  initialCrop?: CustomBgCrop | null
  initialBlur?: number
  initialVeilDark?: number
  initialVeilLight?: number
  initialInk?: string
  onCancel: () => void
  onApply: (result: CropResult) => void
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

const touchDistance = (event: GestureResponderEvent) => {
  const touches = event.nativeEvent.touches
  if (touches.length < 2) return 0
  const [a, b] = touches
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY)
}

export default memo(({ visible, source, initialCrop, initialBlur, initialVeilDark, initialVeilLight, initialInk, onCancel, onApply }: Props) => {
  const t = useI18n()
  const { width: winWidth, height: winHeight } = useWindowSize()
  const statusBarHeight = useStatusbarHeight()
  // 顶栏的上边距。这一层是 statusBarTranslucent，内容从 y=0 起画，写死的 28 在刘海屏/挖孔屏上
  // 不够（状态栏 32~40dp 的机器，按钮会压到状态栏图标上）。改成跟真实状态栏高度走，
  // 留 6dp 呼吸；28 作下限 —— 首帧 statusbarHeight 还是 0 时不该把按钮顶到屏幕边缘。
  const topInset = Math.max(statusBarHeight + 6, 28)

  // 裁剪框按当前手机的屏幕比例来：导出的图正好铺满整屏，不会再被 cover 二次裁掉边角。
  // 竖屏下是一根窄高的框，看着别扭但那是真实比例；横屏/平板会自动变宽。
  //
  // 尺寸不再写死"屏幕高度的一半"：滑块全部收进底部工具区之后，中间剩下的地方都归画面，
  // 所以这里按 stageWrap 实测出来的可用空间撑到最大（保持比例的前提下先撞哪边就以哪边为准）。
  const [wrapSize, setWrapSize] = useState({ width: 0, height: 0 })
  const stageSize = useMemo(() => {
    const ratio = winWidth > 0 && winHeight > 0 ? winWidth / winHeight : 9 / 16
    const availW = wrapSize.width || Math.max(120, winWidth - 24)
    const availH = wrapSize.height || winHeight * 0.5
    let width = availH * ratio
    let height = availH
    if (width > availW) {
      width = availW
      height = width / ratio
    }
    return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)), ratio }
  }, [winWidth, winHeight, wrapSize.width, wrapSize.height])
  const stageW = stageSize.width
  const stageH = stageSize.height
  const stageRef = useRef<View>(null)

  const [size, setSize] = useState({ width: 0, height: 0 })
  const [zoom, setZoom] = useState(1)
  const [rot, setRot] = useState(0)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [blur, setBlur] = useState(DEFAULT_CUSTOM_BG_BLUR)
  // 柔光两条滑块各归各、可同时开：压暗层把高光按下去，提亮层把阴影抬起来，
  // 同时生效叠出来是"雾面 / 胶片感"。与墨色解绑 —— 任何一个颜色都两档全开，
  // 不再由墨的明暗替用户决定"该往哪边压"
  const [veilDark, setVeilDark] = useState(DEFAULT_CUSTOM_BG_VEIL_DARK)
  const [veilLight, setVeilLight] = useState(DEFAULT_CUSTOM_BG_VEIL_LIGHT)
  const [capturing, setCapturing] = useState(false)
  const [busy, setBusy] = useState(false)
  // 这一张自己的前景色：每张背景各配一支，切图时跟着这张走（不再有全局那一个）
  const [ink, setInk] = useState(() => normalizeWallpaperInk(initialInk ?? DEFAULT_CUSTOM_BG_INK))
  // 底部工具区是两个横向翻页的标签页：「背景图片」= 五条滑块，「颜色」= 基础色 + 饱和度。
  // 两页的可操控件都浮在翻页容器之上（sliderDeck / colorDeck），控件区域里的横向手势归控件，
  // 右滑翻页只发生在控件下方的空带；tab 由翻页进度过半时回写
  const [tab, setTab] = useState(0)
  const [pagerW, setPagerW] = useState(0)
  const pagerRef = useRef<ScrollView>(null)
  const pagerWRef = useRef(0)
  pagerWRef.current = pagerW
  const switchTab = useCallback((index: number) => {
    setTab(index)
    pagerRef.current?.scrollTo({ x: index * pagerWRef.current, animated: true })
  }, [])
  // 翻页进度驱动两块覆盖板交叉淡出：拖页 / 点标签时，这页的控件跟着退场、对面那页进场
  const scrollX = useRef(new Animated.Value(0)).current
  const sliderDeckOpacity = useMemo(() => scrollX.interpolate({
    inputRange: [0, Math.max(1, pagerW * 0.6)],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  }), [scrollX, pagerW])
  const colorDeckOpacity = useMemo(() => scrollX.interpolate({
    inputRange: [Math.max(1, pagerW * 0.4), Math.max(2, pagerW)],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  }), [scrollX, pagerW])
  // 滚动同步两件事：上面的淡出插值，以及过半就翻 tab（下划线与覆盖板显隐跟手）
  const handlePagerScroll = Animated.event(
    [{ nativeEvent: { contentOffset: { x: scrollX } } }],
    {
      useNativeDriver: false,
      listener: (event: { nativeEvent: { contentOffset: { x: number } } }) => {
        const page = event.nativeEvent.contentOffset.x / Math.max(1, pagerWRef.current)
        const next = page < 0.5 ? 0 : 1
        setTab((prev) => (prev === next ? prev : next))
      },
    },
  )
  // 基础色选中支 + 滑杆比例只是编辑器游标；ink（字符串）仍是唯一存档真相。
  // 初值从上一次的墨色反推，重开一张旧背景时游标就落在它自己的基础色与比例上
  const [baseId, setBaseId] = useState(() => Math.max(0, WALLPAPER_INK_BASES.indexOf(matchWallpaperInkBase(initialInk ?? DEFAULT_CUSTOM_BG_INK).base)))
  const [satRatio, setSatRatio] = useState(() => matchWallpaperInkBase(initialInk ?? DEFAULT_CUSTOM_BG_INK).ratio)
  const activeBase = WALLPAPER_INK_BASES[baseId]
  // 14 支基础色按每排 7 支折成两排
  const baseRows = useMemo(() => {
    const rows: WallpaperInkBase[][] = []
    for (let i = 0; i < WALLPAPER_INK_BASES.length; i += SWATCH_PER_ROW) {
      rows.push(WALLPAPER_INK_BASES.slice(i, i + SWATCH_PER_ROW))
    }
    return rows
  }, [])

  // PanResponder 的闭包拿不到最新 state，用 ref 兜住；minZoom 同理（旋转会把它顶上去）
  const live = useRef({ zoom: 1, rot: 0, x: 0, y: 0 })
  live.current = { zoom, rot, x: offset.x, y: offset.y }
  const gesture = useRef({ startX: 0, startY: 0, startZoom: 1, startDistance: 0 })

  useEffect(() => {
    if (!visible || !source) return
    setSize({ width: 0, height: 0 })
    setZoom(clamp(initialCrop?.zoom ?? 1, MIN_ZOOM, MAX_ZOOM))
    setRot(initialCrop?.rot ?? 0)
    setOffset({ x: initialCrop?.x ?? 0, y: initialCrop?.y ?? 0 })
    setBlur(clamp(initialBlur ?? DEFAULT_CUSTOM_BG_BLUR, 0, MAX_CUSTOM_BG_BLUR))
    setVeilDark(clampWallpaperVeil(initialVeilDark ?? DEFAULT_CUSTOM_BG_VEIL_DARK))
    setVeilLight(clampWallpaperVeil(initialVeilLight ?? DEFAULT_CUSTOM_BG_VEIL_LIGHT))
    const initial = initialInk ?? DEFAULT_CUSTOM_BG_INK
    const matched = matchWallpaperInkBase(initial)
    setInk(normalizeWallpaperInk(initial))
    setBaseId(Math.max(0, WALLPAPER_INK_BASES.indexOf(matched.base)))
    setSatRatio(matched.ratio)
    // Modal 隐藏时子树整体卸载、ScrollView 复位回第 0 页，tab 也得跟着归位 ——
    // 不然重新编辑一张已保存的背景时会停在「背景图片」页、标签却亮着「颜色」
    setTab(0)
    scrollX.setValue(0)
    setCapturing(false)
    setBusy(false)
    Image.getSize(toImageUri(source), (width, height) => {
      setSize({ width, height })
    }, () => {
      toast(t('setting_basic_theme_custom_bg_read_failed'))
      onCancel()
    })
  // initialCrop / initialBlur 只在打开那一下取一次快照，剪的过程中不该被外部重渲染打断
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, source])

  /** 铺满裁剪框的基础比例（含一点点过扫） */
  const baseScale = useMemo(() => {
    if (!size.width || !size.height) return 0
    return Math.max(stageW / size.width, stageH / size.height) * OVERSCAN
  }, [size, stageW, stageH])

  /** 旋转到 nextRot 之后仍要盖满裁剪框所需的最小缩放 */
  const zoomForRot = useCallback((nextRot: number) => {
    if (!baseScale || !size.width || !size.height) return MIN_ZOOM
    const rad = (nextRot * Math.PI) / 180
    const c = Math.abs(Math.cos(rad))
    const s = Math.abs(Math.sin(rad))
    const needW = (stageW / 2) * c + (stageH / 2) * s
    const needH = (stageW / 2) * s + (stageH / 2) * c
    return Math.max(MIN_ZOOM, needW / (size.width * baseScale / 2), needH / (size.height * baseScale / 2))
  }, [baseScale, size, stageW, stageH])

  const minZoom = useMemo(() => zoomForRot(rot), [zoomForRot, rot])
  const minZoomRef = useRef(minZoom)
  minZoomRef.current = minZoom

  /** 位移按裁剪框比例记，越界就往回推 —— 与导出时用的是同一套公式 */
  const clampOffset = useCallback((x: number, y: number, nextZoom: number, nextRot: number) => {
    if (!baseScale || !size.width || !size.height) return { x, y }
    const scale = baseScale * nextZoom
    const rad = (nextRot * Math.PI) / 180
    const c = Math.cos(rad)
    const s = Math.sin(rad)
    const dx = x * stageW
    const dy = y * stageH
    let ux = (c * dx + s * dy) / scale
    let uy = (-s * dx + c * dy) / scale
    const aImg = ((stageW / 2) * Math.abs(c) + (stageH / 2) * Math.abs(s)) / scale
    const bImg = ((stageW / 2) * Math.abs(s) + (stageH / 2) * Math.abs(c)) / scale
    ux = clamp(ux, -Math.max(0, size.width / 2 - aImg), Math.max(0, size.width / 2 - aImg))
    uy = clamp(uy, -Math.max(0, size.height / 2 - bImg), Math.max(0, size.height / 2 - bImg))
    const ndx = (c * ux - s * uy) * scale
    const ndy = (s * ux + c * uy) * scale
    return { x: stageW ? ndx / stageW : 0, y: stageH ? ndy / stageH : 0 }
  }, [baseScale, size, stageW, stageH])

  const applyZoom = useCallback((next: number) => {
    const target = clamp(next, minZoomRef.current, MAX_ZOOM)
    setZoom(target)
    setOffset((prev) => clampOffset(prev.x, prev.y, target, live.current.rot))
  }, [clampOffset])

  const applyRotate = useCallback((next: number) => {
    let value = next
    while (value > 180) value -= 360
    while (value < -180) value += 360
    setRot(value)
    // 转过去之后可能盖不满了，缩放同步抬到下限
    const target = clamp(Math.max(live.current.zoom, zoomForRot(value)), MIN_ZOOM, MAX_ZOOM)
    setZoom(target)
    setOffset((prev) => clampOffset(prev.x, prev.y, target, value))
  }, [clampOffset, zoomForRot])

  /** 点基础色：换色相，滑杆比例保持不动（「由白到鲜」的轨迹对每支基础色都成立） */
  const selectBase = (base: WallpaperInkBase, index: number) => {
    setBaseId(index)
    setInk(wallpaperInkFromBase(base, satRatio))
  }

  /** 拖饱和度滑杆：在当前基础色上由白（0）推到本色（100%），白 / 灰 / 近黑同样适用 */
  const applySaturation = (value: number) => {
    const ratio = Math.min(1, Math.max(0, value / 100))
    setSatRatio(ratio)
    setInk(wallpaperInkFromBase(activeBase, ratio))
  }

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event) => {
      gesture.current = {
        startX: live.current.x,
        startY: live.current.y,
        startZoom: live.current.zoom,
        startDistance: touchDistance(event),
      }
    },
    onPanResponderMove: (event, state) => {
      const touches = event.nativeEvent.touches
      if (touches.length >= 2) {
        const distance = touchDistance(event)
        if (!gesture.current.startDistance || !distance) {
          gesture.current.startDistance = distance
          gesture.current.startZoom = live.current.zoom
          return
        }
        applyZoom(gesture.current.startZoom * (distance / gesture.current.startDistance))
        return
      }
      setOffset(clampOffset(
        gesture.current.startX + state.dx / stageW,
        gesture.current.startY + state.dy / stageH,
        live.current.zoom,
        live.current.rot,
      ))
    },
    onPanResponderRelease: () => {
      gesture.current.startDistance = 0
    },
    onPanResponderTerminate: () => {
      gesture.current.startDistance = 0
    },
  }), [applyZoom, clampOffset, stageW, stageH])

  const handleApply = useCallback(async() => {
    if (busy || !stageRef.current) return
    setBusy(true)
    // 模糊是运行时效果，不烘进图里；截之前先把它摘掉，等两帧让原生层真的重画完
    setCapturing(true)
    try {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => { requestAnimationFrame(() => { resolve() }) })
      })
      const path = await captureRef(stageRef, {
        format: 'jpg',
        quality: 0.95,
        result: 'tmpfile',
        width: OUTPUT_WIDTH,
        height: Math.round(OUTPUT_WIDTH / stageSize.ratio),
      })
      onApply({
        path,
        crop: {
          zoom: Number(zoom.toFixed(4)),
          rot: Number(rot.toFixed(2)),
          x: Number(offset.x.toFixed(5)),
          y: Number(offset.y.toFixed(5)),
        },
        blur,
        veilDark,
        veilLight,
        ink,
      })
    } catch (err) {
      console.log('capture custom bg failed', err)
      toast(t('setting_basic_theme_custom_bg_apply_failed'))
      setBusy(false)
      setCapturing(false)
    }
  }, [busy, zoom, rot, offset, blur, veilDark, veilLight, ink, onApply, t, stageSize.ratio])

  const frameWidth = size.width * baseScale * zoom
  const frameHeight = size.height * baseScale * zoom
  const canRender = Boolean(baseScale) && Boolean(size.width)

  return (
    <Modal visible={visible} animationType="fade" transparent={false} statusBarTranslucent onRequestClose={onCancel}>
      <StatusBar barStyle="light-content" backgroundColor="#14110e" />
      <View style={styles.root}>
        {/* 顶栏：取消在左、确认在右，中间只留一行标题 —— 竖向空间全给下面的画面 */}
        <View style={[styles.topBar, { paddingTop: topInset }]}>
          {/* 关闭沿用歌词卡片分享页那套：裸图标、48dp 触控区、无描边无底色，
             两处是同一个动作，观感该一致。底色固定深，所以字色也固定取这页的墨色 */}
          <TouchableOpacity
            style={styles.topBtnGhost}
            activeOpacity={0.7}
            onPress={onCancel}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={t('cancel')}
          >
            <Icon name="close" size={20} color="#f4efe6" rawSize={scaleSizeW(20)} />
          </TouchableOpacity>
          <View style={styles.topTitleWrap}>
            <Text size={14} numberOfLines={1} color="#f4efe6">{t('setting_basic_theme_custom_bg_crop_title')}</Text>
          </View>
          <TouchableOpacity
            style={[styles.topBtnPrimary, busy ? styles.btnDisabled : null]}
            activeOpacity={0.8}
            onPress={() => { void handleApply() }}
            disabled={busy}
          >
            <Text size={13} color="#14110e">
              {busy ? t('setting_basic_theme_custom_bg_crop_processing') : t('confirm')}
            </Text>
          </TouchableOpacity>
        </View>

        <View
          style={styles.stageWrap}
          onLayout={(event) => {
            const { width, height } = event.nativeEvent.layout
            setWrapSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }))
          }}
        >
          <View
            ref={stageRef}
            collapsable={false}
            style={[styles.stage, { width: stageW, height: stageH }, capturing ? styles.stageCapturing : null]}
            {...panResponder.panHandlers}
          >
            {
              canRender
                ? <Image
                    source={{ uri: toImageUri(source) }}
                    style={{
                      position: 'absolute',
                      width: frameWidth,
                      height: frameHeight,
                      left: (stageW - frameWidth) / 2 + offset.x * stageW,
                      top: (stageH - frameHeight) / 2 + offset.y * stageH,
                      transform: [{ rotate: `${rot}deg` }],
                    }}
                    resizeMode="stretch"
                    blurRadius={capturing ? 0 : blur}
                  />
                : null
            }
            {
              // 柔光预览：与主界面同两层（压暗 + 提亮）、各自同深度，拖哪条滑块都能直接看到
              // 它叠进最终观感的样子 —— 包括两层同时开时的雾面感。
              // 它们属于"看得见的东西"，截图那一下要和取景框一起摘掉，否则会被烘进背景图里。
              canRender && !capturing
                ? (
                    <>
                      <View pointerEvents="none" style={[styles.veilPreview, { backgroundColor: WALLPAPER_SCRIM, opacity: clampWallpaperVeil(veilDark) }]} />
                      <View pointerEvents="none" style={[styles.veilPreview, { backgroundColor: WALLPAPER_SCRIM_LIGHT, opacity: clampWallpaperVeil(veilLight) }]} />
                    </>
                  )
                : null
            }
            {
              // 整页样张：把「我的」这一页铺在照片上，判断的是"这套配色在真界面上还读不读得清"，
              // 不是"这张图好不好看"。颜色跟着上面色板选中的那支实时变，柔光/模糊则透过背景体现。
              // 与柔光层一样，截图那一下必须摘掉 —— 否则整页 UI 会被烘进壁纸图里。
              canRender && !capturing
                ? <CustomBgPreviewMock width={stageW} height={stageH} ink={ink} />
                : null
            }
            {/* 取景框只是给人看的：截图那一下必须摘掉，否则白线会烘进背景图里 */}
            {
              capturing
                ? null
                : (
                    <>
                      <View pointerEvents="none" style={styles.frame} />
                      <View pointerEvents="none" style={[styles.gridLine, styles.gridV1]} />
                      <View pointerEvents="none" style={[styles.gridLine, styles.gridV2]} />
                      <View pointerEvents="none" style={[styles.gridLine, styles.gridH1]} />
                      <View pointerEvents="none" style={[styles.gridLine, styles.gridH2]} />
                    </>
                  )
            }
          </View>
        </View>

        <View style={styles.tools}>
          {/* 底部工具区 = 两个横向翻页的标签页：「背景图片」（五条滑块）/「颜色」（基础色 + 饱和度）。
              两页的可操控件都不住在翻页容器里 —— 它们浮在容器之上（sliderDeck / colorDeck），
              控件区域里的横向手势归控件，右滑翻页只发生在控件下方的空带；
              翻页时两块覆盖板跟着进度交叉淡出，点标签用 scrollTo 对齐页 */}
          {/* 两个标签压在操作区上面：先选页、再看下面的控件，视线自上而下 */}
          <View style={styles.toolTabs}>
            <TouchableOpacity style={styles.toolTabBtn} activeOpacity={0.7} onPress={() => { switchTab(0) }} accessibilityRole="tab">
              <Text size={12} color={tab === 0 ? '#f4efe6' : 'rgba(244,239,230,0.5)'}>{t('setting_basic_theme_custom_bg_tab_image')}</Text>
              <View style={[styles.toolTabLine, tab === 0 ? null : styles.toolTabLineOff]} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.toolTabBtn} activeOpacity={0.7} onPress={() => { switchTab(1) }} accessibilityRole="tab">
              <Text size={12} color={tab === 1 ? '#f4efe6' : 'rgba(244,239,230,0.5)'}>{t('setting_basic_theme_custom_bg_tab_color')}</Text>
              <View style={[styles.toolTabLine, tab === 1 ? null : styles.toolTabLineOff]} />
            </TouchableOpacity>
          </View>
          <View
            style={[styles.toolPagerWrap, { height: PAGER_HEIGHT }]}
            onLayout={(event) => {
              const { width } = event.nativeEvent.layout
              setPagerW((prev) => (prev === width ? prev : width))
            }}
          >
            <ScrollView
              ref={pagerRef}
              style={{ flex: 1 }}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              scrollEventThrottle={16}
              onScroll={handlePagerScroll}
            >
              <View style={[styles.toolPage, { width: pagerW, minHeight: PAGER_HEIGHT }]}>
                {/* 占位：真滑块浮在覆盖板上（见 sliderDeck），这里垫出同样的高度 */}
                <View style={{ height: SLIDER_DECK_HEIGHT }} />
                <Text size={11} color="rgba(244,239,230,0.42)" style={styles.toolsTip}>{t('setting_basic_theme_custom_bg_veil_tip')}</Text>
              </View>
              <View style={[styles.toolPage, { width: pagerW, minHeight: PAGER_HEIGHT }]}>
                {/* 占位：基础色块与饱和度滑杆浮在覆盖板上（见 colorDeck），这里垫出同样的高度 */}
                <View style={{ height: COLOR_DECK_HEIGHT }} />
                <Text size={11} color="rgba(244,239,230,0.42)" style={styles.paletteTip}>{t('setting_basic_theme_custom_bg_ink_tip')}</Text>
              </View>
            </ScrollView>
            {/* 「背景图片」覆盖板：五条滑块浮在翻页容器之上，拖动不会再被翻页手势抢走 */}
            <Animated.View
              pointerEvents={tab === 0 ? 'auto' : 'none'}
              style={[styles.sliderDeck, { opacity: sliderDeckOpacity }]}
            >
              <View style={styles.toolRow}>
                <Text size={12} color="rgba(244,239,230,0.72)" style={styles.toolLabel}>{t('setting_basic_theme_custom_bg_crop_zoom')}</Text>
                <WhiteSlider
                  minimumValue={MIN_ZOOM * 100}
                  maximumValue={MAX_ZOOM * 100}
                  step={1}
                  value={zoom * 100}
                  onValueChange={(value) => { applyZoom(value / 100) }}
                />
                <Text size={11} color="rgba(244,239,230,0.5)" style={styles.toolValue}>{Math.round(zoom * 100)}%</Text>
              </View>
              <View style={styles.toolRow}>
                <Text size={12} color="rgba(244,239,230,0.72)" style={styles.toolLabel}>{t('setting_basic_theme_custom_bg_crop_rotate')}</Text>
                <WhiteSlider
                  minimumValue={-180}
                  maximumValue={180}
                  step={1}
                  value={rot}
                  onValueChange={applyRotate}
                />
                <Text size={11} color="rgba(244,239,230,0.5)" style={styles.toolValue}>{Math.round(rot)}°</Text>
              </View>
              <View style={styles.toolRow}>
                <Text size={12} color="rgba(244,239,230,0.72)" style={styles.toolLabel}>{t('setting_basic_theme_custom_bg_crop_blur')}</Text>
                <WhiteSlider
                  minimumValue={0}
                  maximumValue={MAX_CUSTOM_BG_BLUR}
                  step={1}
                  value={blur}
                  onValueChange={setBlur}
                />
                <Text size={11} color="rgba(244,239,230,0.5)" style={styles.toolValue}>{Math.round(blur)}px</Text>
              </View>
              <View style={styles.toolRow}>
                <Text size={12} color="rgba(244,239,230,0.72)" style={styles.toolLabel}>{t('setting_basic_theme_custom_bg_veil')}</Text>
                <WhiteSlider
                  minimumValue={0}
                  maximumValue={MAX_CUSTOM_BG_VEIL}
                  step={0.01}
                  value={veilDark}
                  onValueChange={setVeilDark}
                />
                <Text size={11} color="rgba(244,239,230,0.5)" style={styles.toolValue}>{Math.round(veilDark * 100)}%</Text>
              </View>
              <View style={styles.toolRow}>
                <Text size={12} color="rgba(244,239,230,0.72)" style={styles.toolLabel}>{t('setting_basic_theme_custom_bg_veil_light')}</Text>
                <WhiteSlider
                  minimumValue={0}
                  maximumValue={MAX_CUSTOM_BG_VEIL}
                  step={0.01}
                  value={veilLight}
                  onValueChange={setVeilLight}
                />
                <Text size={11} color="rgba(244,239,230,0.5)" style={styles.toolValue}>{Math.round(veilLight * 100)}%</Text>
              </View>
            </Animated.View>
            {/* 「颜色」覆盖板：两排基础色 + 一条饱和度滑杆。点基础色换色相，
                拖滑杆在「由白到鲜」这条线上推拉；白 / 灰 / 近黑三支同样适用 */}
            <Animated.View
              pointerEvents={tab === 1 ? 'auto' : 'none'}
              style={[styles.colorDeck, { opacity: colorDeckOpacity }]}
            >
              {
                baseRows.map((row, rowIndex) => (
                  <View key={rowIndex} style={[styles.swatchRow, { marginBottom: SWATCH_GAP }]}>
                    {
                      row.map((base) => {
                        const index = WALLPAPER_INK_BASES.indexOf(base)
                        const active = index === baseId
                        return (
                          <TouchableOpacity
                            key={base.color}
                            style={[
                              styles.swatchCell,
                              { width: SWATCH_CELL, height: SWATCH_CELL, marginRight: SWATCH_GAP, backgroundColor: base.color },
                              active ? styles.swatchCellActive : null,
                            ]}
                            activeOpacity={0.7}
                            onPress={() => { selectBase(base, index) }}
                            accessibilityRole="button"
                            accessibilityLabel={base.color}
                          />
                        )
                      })
                    }
                  </View>
                ))
              }
              <View style={[styles.toolRow, { marginTop: scaleSizeH(6) }]}>
                <Text size={12} color="rgba(244,239,230,0.72)" style={styles.toolLabel}>{t('setting_basic_theme_custom_bg_sub_saturation')}</Text>
                <WhiteSlider
                  minimumValue={0}
                  maximumValue={100}
                  step={1}
                  value={Math.round(satRatio * 100)}
                  onValueChange={applySaturation}
                />
                <Text size={11} color="rgba(244,239,230,0.5)" style={styles.toolValue}>{Math.round(satRatio * 100)}%</Text>
              </View>
            </Animated.View>
          </View>
        </View>
      </View>
    </Modal>
  )
})

const styles = createStyle({
  root: {
    flex: 1,
    backgroundColor: '#14110e',
    paddingBottom: 16,
  },
  // 取消 / 确认分居左右两端：和 App 里其它页面的顶栏同一手感，
  // 也不再在顶部堆两行说明，竖向空间全留给画面。
  // paddingTop 不再写死，由 topInset（状态栏高度）在 JSX 里给 —— 见那边的注释
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingBottom: 10,
  },
  topTitleWrap: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
  },
  // 与 ShareCardModal 的 closeBtn 同尺寸：48 是触控区，图标本身 20，不画描边也不垫底色
  topBtnGhost: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 圆角跟 App 内其它按钮同一套（BorderRadius.normal = 4），不再是 18 的胶囊；
  // 左侧那枚勾选图标已去掉，按钮只剩文字
  topBtnPrimary: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 36,
    paddingHorizontal: 16,
    borderRadius: BorderRadius.normal,
    backgroundColor: '#f4efe6',
  },
  btnDisabled: {
    opacity: 0.6,
  },
  // 画面区吃掉顶栏与工具区之外的全部剩余空间，尺寸由它自己的 onLayout 喂给 stageSize
  stageWrap: {
    flex: 1,
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  stage: {
    overflow: 'hidden',
    backgroundColor: '#000',
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // 截图那一下把圆角去掉：圆角也属于"看得见的东西"，会被一起烘进图里，
  // 铺到全屏背景上就是四个黑角
  stageCapturing: {
    borderRadius: 0,
  },
  // 柔光预览层：底色运行时给（与主界面那层同源），这里只钉位置
  veilPreview: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  frame: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.45)',
    borderRadius: 10,
  },
  // 三分线：比原来那个居中小方框更像"取景辅助"，也不会被误读成保留区域
  gridLine: {
    position: 'absolute',
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  gridV1: { top: 0, bottom: 0, left: '33.33%', width: StyleSheet.hairlineWidth },
  gridV2: { top: 0, bottom: 0, left: '66.66%', width: StyleSheet.hairlineWidth },
  gridH1: { left: 0, right: 0, top: '33.33%', height: StyleSheet.hairlineWidth },
  gridH2: { left: 0, right: 0, top: '66.66%', height: StyleSheet.hairlineWidth },
  tools: {
    flexShrink: 0,
    paddingHorizontal: 14,
    paddingTop: 12,
  },
  toolRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  toolLabel: {
    width: 56,
  },
  // —— 工具区顶部：两个标签压在操作区（翻页容器）上面 ——
  toolTabs: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  toolTabBtn: {
    alignItems: 'center',
    marginRight: 20,
    paddingVertical: 4,
  },
  // 选中标签下面那条 2dp 的米白短线，与工具区的浅色文字同一支；未选中时整条透明（尺寸不跳）
  toolTabLine: {
    alignSelf: 'stretch',
    height: 2,
    borderRadius: 1,
    marginTop: 3,
    backgroundColor: '#f4efe6',
  },
  toolTabLineOff: {
    opacity: 0,
  },
  toolPagerWrap: {
    // 宽度由父级给，高度运行时给（PAGER_HEIGHT：覆盖板 + 控件下方的翻页空带）
  },
  // 两块覆盖板浮在翻页容器之上，高度运行时给（与页内占位块同高、同一套尺寸账）
  sliderDeck: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  colorDeck: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  swatchRow: {
    flexDirection: 'row',
    alignSelf: 'center',
  },
  toolPage: {
    // 页宽运行时给（pagingEnabled 需要整页宽），这里只放公共内边距
    paddingBottom: 2,
  },
  // —— 基础色板：两排各 7 支，格子尺寸内联给（不经 createStyle 缩放，与覆盖板尺寸账同口径） ——
  // 格子本身就是颜色：恒留 2px 描边（未选中是极淡的白线，白格压深底靠它认边界），
  // 选中换成米白 —— 尺寸不跳，只是描边变色
  swatchCell: {
    borderRadius: 6,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  swatchCellActive: {
    borderColor: '#f4efe6',
  },
  paletteTip: {
    marginTop: 4,
    lineHeight: 15,
  },
  toolValue: {
    width: 46,
    textAlign: 'right',
  },
  toolsTip: {
    marginTop: 2,
    paddingHorizontal: 2,
  },
})
