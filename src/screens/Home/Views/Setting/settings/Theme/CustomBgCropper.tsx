import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Image,
  Modal,
  PanResponder,
  StatusBar,
  StyleSheet,
  TouchableOpacity,
  View,
  type GestureResponderEvent,
} from 'react-native'
import { captureRef } from 'react-native-view-shot'

import Slider from '@/components/common/Slider'
import Text from '@/components/common/Text'
import { Icon } from '@/components/common/Icon'
import { useI18n } from '@/lang'
import { useWindowSize } from '@/utils/hooks'
import { createStyle, toast } from '@/utils/tools'
import { scaleSizeW } from '@/utils/pixelRatio'
import {
  DEFAULT_CUSTOM_BG_BLUR,
  DEFAULT_CUSTOM_BG_VEIL,
  MAX_CUSTOM_BG_BLUR,
  MAX_CUSTOM_BG_VEIL,
  toImageUri,
  type CustomBgCrop,
} from '@/core/customBg'
import { WALLPAPER_SCRIM, clampWallpaperVeil } from '@/utils/wallpaper/palette'

/** 与导出同构：预览里留一点余量，旋转后边角不会露底 */
const OVERSCAN = 1.06
const MIN_ZOOM = 1
const MAX_ZOOM = 5
/** 导出宽度（像素）。再按手机比例算高度，铺到屏幕上正好不缩放 */
const OUTPUT_WIDTH = 1440

export interface CropResult {
  path: string
  crop: CustomBgCrop
  blur: number
  veil: number
}

interface Props {
  visible: boolean
  source: string
  /** 重新剪裁时回填上一次的参数 */
  initialCrop?: CustomBgCrop | null
  initialBlur?: number
  initialVeil?: number
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

export default memo(({ visible, source, initialCrop, initialBlur, initialVeil, onCancel, onApply }: Props) => {
  const t = useI18n()
  const { width: winWidth, height: winHeight } = useWindowSize()

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
  const [veil, setVeil] = useState(DEFAULT_CUSTOM_BG_VEIL)
  const [capturing, setCapturing] = useState(false)
  const [busy, setBusy] = useState(false)

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
    setVeil(clampWallpaperVeil(initialVeil ?? DEFAULT_CUSTOM_BG_VEIL))
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
        veil,
      })
    } catch (err) {
      console.log('capture custom bg failed', err)
      toast(t('setting_basic_theme_custom_bg_apply_failed'))
      setBusy(false)
      setCapturing(false)
    }
  }, [busy, zoom, rot, offset, blur, veil, onApply, t, stageSize.ratio])

  const frameWidth = size.width * baseScale * zoom
  const frameHeight = size.height * baseScale * zoom
  const canRender = Boolean(baseScale) && Boolean(size.width)

  return (
    <Modal visible={visible} animationType="fade" transparent={false} statusBarTranslucent onRequestClose={onCancel}>
      <StatusBar barStyle="light-content" backgroundColor="#14110e" />
      <View style={styles.root}>
        {/* 顶栏：取消在左、确认在右，中间只留一行标题 —— 竖向空间全给下面的画面 */}
        <View style={styles.topBar}>
          <TouchableOpacity
            style={styles.topBtnGhost}
            activeOpacity={0.7}
            onPress={onCancel}
            disabled={busy}
            accessibilityLabel={t('cancel')}
          >
            <Icon name="close" size={17} color="rgba(244,239,230,0.9)" rawSize={scaleSizeW(17)} />
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
            <Icon name="checkbox-marked" size={15} color="#14110e" rawSize={scaleSizeW(15)} />
            <Text size={13} color="#14110e" style={styles.topBtnText}>
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
              // 柔光预览：与主界面同一层、同一深度，拖滑块时能直接看到最终压暗多少。
              // 它属于"看得见的东西"，截图那一下要和取景框一起摘掉，否则会被烘进背景图里。
              canRender && !capturing
                ? <View pointerEvents="none" style={[styles.veilPreview, { opacity: veil }]} />
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
          <View style={styles.toolRow}>
            <Text size={12} color="rgba(244,239,230,0.72)" style={styles.toolLabel}>{t('setting_basic_theme_custom_bg_crop_zoom')}</Text>
            <Slider
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
            <Slider
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
            <Slider
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
            <Slider
              minimumValue={0}
              maximumValue={MAX_CUSTOM_BG_VEIL}
              step={0.01}
              value={veil}
              onValueChange={setVeil}
            />
            <Text size={11} color="rgba(244,239,230,0.5)" style={styles.toolValue}>{Math.round(veil * 100)}%</Text>
          </View>
          <Text size={11} color="rgba(244,239,230,0.42)" style={styles.toolsTip}>{t('setting_basic_theme_custom_bg_crop_tip')}</Text>
        </View>
      </View>
    </Modal>
  )
})

const styles = createStyle({
  root: {
    flex: 1,
    backgroundColor: '#14110e',
    paddingTop: 28,
    paddingBottom: 16,
  },
  // 取消 / 确认分居左右两端：和 App 里其它页面的顶栏同一手感，
  // 也不再在顶部堆两行说明，竖向空间全留给画面
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
  topBtnGhost: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(244,239,230,0.22)',
  },
  topBtnPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: '#f4efe6',
  },
  topBtnText: {
    marginStart: 4,
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
  // 柔光预览层：颜色与主界面的 WALLPAPER_SCRIM 一致，深度跟着滑块走
  veilPreview: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: WALLPAPER_SCRIM,
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
  toolValue: {
    width: 46,
    textAlign: 'right',
  },
  toolsTip: {
    marginTop: 2,
    paddingHorizontal: 2,
  },
})
