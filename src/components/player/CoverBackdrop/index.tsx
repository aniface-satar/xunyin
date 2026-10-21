import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Easing, StyleSheet, View } from 'react-native'

import ImageBackground from '@/components/common/ImageBackground'
import { defaultHeaders } from '@/components/common/Image'
import { getEnterBackdropOpacityRange } from '@/components/player/PlayerOverlay/transition'
import { useCoverStage } from '@/components/player/CoverStageProvider'
import { useCoverSurface } from '@/utils/monet/useCoverSurface'
import { COVER_BASE_FADE_MS, COVER_WASH_FADE_MS } from '@/utils/monet/backdropTiming'
import { coverLayerKey } from '@/utils/monet/backdropGate'
import { SCRIM_MAX, type CoverSurface } from '@/utils/monet/surface'

/** ① 莫奈档糊在蒙版底下那层：90dp 只剩大块起伏，前景证书就是按这个尺度核的，spec §10.4-3 要求逐像素不变。 */
const WASH_BLUR_RADIUS = 90
/** ②「动态取色」要的正是"隐隐看得出是糊掉的封面"。Fresco 把 dp 换成 `px/2` 的框半径并迭代两次，
 *  3.0 密度的机器上 9dp = 半径 13px —— 封面的大色块与字块边缘还留着，但已经读不出图案。
 *  可读性不靠"糊到看不见"，靠蒙版那一格：alpha 由 buildBlurSurface 按这一档重核过的线（BLUR_MIN_CONTRAST）交出来。 */
const COVER_BLUR_RADIUS = 9
const FADE_OUT_MS = 260
/** 糊封面那一支的外扩。Fresco 的框糊（RN 的 blurRadius 就交给它）在边缘会读到图外面，
 *  留一圈发暗的边；`absoluteFill` 摆着就把那条边贴在屏幕内缘 —— 正是当年"重度模糊"翻车的原因。
 *  用 GPU 变换撑开而不是把 View 做大了重排：View 尺寸一变，`resizeMode="cover"` 会重新裁图，
 *  那圈暗边只是换了个位置而不是没了。1.25 让每边外扩 10%，糊出来的边落在可见区以外。
 *  只给 ②：① 那一档在 §9 是按现状验收过的，spec §10.4-3 要求它逐像素不变。 */
const OVERSCAN = 1.25

interface Layer {
  /** 槽的身份：测量支是封面 url，② 的保守支是同一串加 `|p` 与档名（判据在 backdropGate.coverLayerKey，
   *  住在那里是为了能 node --test）。两支同图不同色，必须各占一个槽，否则测量色永远换不上去。 */
  key: string
  /** 图片资源始终是这张封面本身：保守支带着同一个 url，只是那一支不铺糊图层（见下面 showWash） */
  picUrl: string
  surface: CoverSurface
}

interface Slot {
  layer: Layer
  show: boolean
}

interface BackdropLayerProps {
  layer: Layer
  show: boolean
  /** 退场淡完（opacity 到 0）：这一支已经看不见，父层可以真的撤掉它 */
  onHide: (key: string) => void
  /** 进场淡到位（opacity 到 1）：这一支已经完整盖住全屏，压在它下面的那些可以开始退场 */
  onRevealed: (key: string) => void
  /**
   * 拖动手势的闸门（0=全屏、1=播放栏）。传了它，这一层的浓度就不再只跟墙钟走：
   * 展开那一下封面色是跟着卡片长大的，收起时跟着卡片退回去。
   * ②「封面模糊」那一档整层按整段行程淡入淡出（见 getEnterBackdropOpacityRange）。
   */
  progress?: Animated.Value
  /** 分台布光的压暗层位置（0=浏览台、1=歌词台），由翻页手势连续投递。
   *  这一层乘进 surface.stageDimAlpha 才落到 ① 的等价位；没挂 provider 的树拿到的是恒 1（暗台原样）。 */
  stageDim: Animated.Value
}

/**
 * 一支层的淡入淡出，分两段走：
 * 纯色底快（它是唯一动亮度的一段，淡多久就白字糊多久，见 backdropTiming.ts），
 * 糊封面 + 蒙版慢（只加彩度与云纹，亮度几乎不动，观感上的"浮现"由它负责）。
 *
 * opacity 的驱动方式跟着闸门走：没有 progress（PlayDetail 那棵树）走原生驱动，有则改走 JS 驱动
 * —— Animated.multiply 不允许原生节点和 JS 插值节点同树，而 morph 本身就是 JS 驱动的。
 * 动画跑完才通知父层撤槽，这样"卸载"永远发生在看不见的时候，
 * 不会留下半透明的一屏主题底。两条通知都来自 Animated.timing 的完成回调，组件里没有第二个 setTimeout。
 */
const BackdropLayer = memo(({ layer, show, onHide, onRevealed, progress, stageDim }: BackdropLayerProps) => {
  const baseAnim = useRef(new Animated.Value(0)).current
  const washAnim = useRef(new Animated.Value(0)).current
  const onHideRef = useRef(onHide)
  onHideRef.current = onHide
  const onRevealedRef = useRef(onRevealed)
  onRevealedRef.current = onRevealed
  // ②「封面模糊」那一档的铺底层就是这一屏的主背景：闸门铺满整段行程，跟着展开/收起一路淡；
  // ① 仍是窄窗（洗色只是蒙版底下的一层纹路，与底色同一个窗口翻完就够）。形状表在 transition.ts，
  // 这里只把"这一层是哪一档"递进去 —— 判据不在这里长第二个版本。
  const fullLengthFade = layer.surface.mode === 'blur'
  const gate = useMemo(
    () => (progress == null ? null : progress.interpolate(getEnterBackdropOpacityRange(fullLengthFade))),
    [progress, fullLengthFade],
  )
  // 有闸门就必须走 JS 驱动：Animated.multiply 不能把原生驱动的 Value 和 JS 插值节点混在同一棵树上
  // （morph 自己本来就是 useNativeDriver:false，两条轴同一侧才不会打架）
  const nativeDriven = progress == null
  const baseOpacity = gate == null ? baseAnim : Animated.multiply(baseAnim, gate)
  const washOpacity = gate == null ? washAnim : Animated.multiply(washAnim, gate)
  // 压暗层：浏览台 → 歌词台差的那一截蒙版。stageDim 是 JS 侧连续投递的（翻页手势），
  // 所以这条 opacity 恒为 JS 驱动 —— 它挂在 wash 层内部，与父层那条原生驱动不共用节点，不打架。
  const dimAlpha = layer.surface.stageDimAlpha
  const dimOpacity = useMemo(
    () => stageDim.interpolate({ inputRange: [0, 1], outputRange: [0, dimAlpha] }),
    [stageDim, dimAlpha],
  )

  useEffect(() => {
    if (show) {
      // 纯色底淡到 1 的那一帧才是"下面那支彻底看不见了"的唯一可靠信号（洗色是半透明的，不算盖住）：
      // 早一帧撤就是交叉淡（中间帧露主题底），不撤就是旧层一直堆在栈底。
      Animated.timing(baseAnim, {
        toValue: 1,
        duration: COVER_BASE_FADE_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: nativeDriven,
      }).start(({ finished }) => {
        if (finished) onRevealedRef.current(layer.key)
      })
      Animated.timing(washAnim, {
        toValue: 1,
        duration: COVER_WASH_FADE_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: nativeDriven,
      }).start()
      return
    }
    Animated.timing(baseAnim, {
      toValue: 0,
      duration: FADE_OUT_MS,
      easing: Easing.in(Easing.quad),
      useNativeDriver: nativeDriven,
    }).start()
    // 撤槽等洗色那支：它时长相同但收尾更晚看得见，让它说完再卸载
    Animated.timing(washAnim, {
      toValue: 0,
      duration: FADE_OUT_MS,
      easing: Easing.in(Easing.quad),
      useNativeDriver: nativeDriven,
    }).start(({ finished }) => {
      if (finished) onHideRef.current(layer.key)
    })
  // 只在挂载与 show 翻转时跑；两个 anim 与 layer 在挂载后不变
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show])

  // ②「动态取色」铺的就是这张封面本身（糊到 9dp 仍读得出大色块与字块边缘），① 那一档铺 90dp 的洗色。
  const usesCoverPhoto = layer.surface.mode === 'blur'
  // 蒙版铺的是**浏览台**那一格（surface.browseScrimAlpha）。是否挂糊封面的判据跟着它走：
  // 浏览台全遮（=100）时两台其实同值（δ=0），与分台之前一样"一个像素都不贡献"，不必解码。
  // 空着不铺没有风险：底下那支纯色底本来就不透明，露不出主题底。
  const showWash = layer.surface.browseScrimAlpha < SCRIM_MAX

  // source 必须是稳定引用：换对象等于重发一次 ImageRequest，而这一层在 morph 期间每帧都在渲染。
  const source = useRef({
    uri: layer.picUrl.startsWith('/') ? 'file://' + layer.picUrl : layer.picUrl,
    headers: defaultHeaders,
    cache: 'force-cache' as const,
  }).current

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: baseOpacity }]}>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: layer.surface.base }]} />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: washOpacity }]}>
        {showWash
          ? (
              <>
                <ImageBackground
                  style={[StyleSheet.absoluteFill, usesCoverPhoto ? { transform: [{ scale: OVERSCAN }] } : null]}
                  source={source}
                  resizeMode="cover"
                  blurRadius={usesCoverPhoto ? COVER_BLUR_RADIUS : WASH_BLUR_RADIUS}
                />
                <View style={[StyleSheet.absoluteFill, { backgroundColor: layer.surface.base, opacity: layer.surface.browseScrimAlpha }]} />
                {dimAlpha > 0
                  ? (
                      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: layer.surface.base, opacity: dimOpacity }]} />
                    )
                  : null}
              </>
            )
          : null}
      </Animated.View>
    </View>
  )
})

/**
 * 全屏播控页的封面铺底层。
 *
 * 「闪」的根因不是缺动画，是层在"有/无"两个状态之间硬卸载 —— 改法是先叠后撤：
 * 新层叠在旧层之上淡到 1，淡到位后旧层才走退场（它在下面，退场全程不可见），
 * 所以中间帧不露主题底。两支交叉淡（线性 a=t, b=1-t）会露 25%，不要改成那样。
 *
 * 屏上该铺哪一支由 resolveCoverBackdrop 决定（含 8s 宽限期），这里只负责"它变了就淡过去"，
 * 一点判据都不写在组件里 —— 判据要能 node --test（tests/monet-gate.mts）。
 * ②「动态取色」从保守底换到测量色走的也是这套先叠后撤（两支各占一个槽），所以这个组件里
 * 没有"读到新 surface 就原地改色"那条路，颜色始终是淡进来的。
 * 两套时间轴各管各的：墙钟淡入只管切歌；进入/收起那一下挂在 progress 上
 * （传 progress 进来即可，窗口表在 PlayerOverlay/transition.ts），morph 期间不让它抢跑 ——
 * ②「封面模糊」（设置里的档名，旧名「动态取色」）那一档是整段行程的淡入淡出，① 仍是窄窗。
 * 前景墨色同理：它是 context 换值、本身不能淡，所以 morph 层用两份副本按同一条曲线交叉淡。
 *
 * 分台布光（②）：蒙版铺的是浏览台那一格，压暗层（stageDim × stageDimAlpha）负责把它压回歌词台。
 * stageDim 由页面翻页手势投递 —— 滑向歌词页时灯光连续变暗，落定由 onPageSelected 钉端值；
 * 没挂 CoverStageProvider 的树拿到恒 1 的暗台值，铺设与分台之前逐像素一致（见 CoverStageProvider）。
 */
export default memo(({ progress }: { progress?: Animated.Value }) => {
  const { picUrl, surface } = useCoverSurface()
  const { dim: stageDim } = useCoverStage()
  // 身份由表给（② 的保守支与测量支是同一张封面的两层，共用一个槽的话测量色换不上去）
  const target: Layer | null = picUrl != null && surface != null ? { key: coverLayerKey(picUrl, surface), picUrl, surface } : null
  const [slots, setSlots] = useState<Slot[]>([])

  useEffect(() => {
    setSlots(prev => {
      if (target == null) return prev.map(s => ({ ...s, show: false }))
      if (prev.some(s => s.layer.key === target.key)) {
        return prev.map(s => ({ ...s, show: s.layer.key === target.key }))
      }
      // 新层叠上去；已经在淡出的那些保持淡出，别让一支退了半场的层又亮回来
      return [...prev, { layer: target, show: true }]
    })
  // 触发的是"published 的 picUrl / surface 变了"，不是"发生过一次 publish"：
  // 切歌那一次 store 会把同一支 {picUrl, surface} 原样重投（isSame 还比 wantsSurface，它在宽限分支里翻了），
  // 两个依赖项逐字段相同 → effect 不跑 → 不会白起一次动画。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picUrl, surface])

  const handleHide = (key: string) => {
    setSlots(prev => prev.filter(s => !(s.layer.key === key && !s.show)))
  }

  // spec §4.6-3「到 1 之后才卸载旧层」落地的地方：淡到位的这一支接手让压在它下面的层退场。
  // 比它晚叠上去的那些一律不动 —— 它们是更新的目标，由自己的完成回调负责；
  // 否则快切歌时"先淡完的那支"会把还在淡入的最新一支按回去。
  const handleRevealed = (key: string) => {
    setSlots(prev => {
      const idx = prev.findIndex(s => s.layer.key === key)
      if (idx < 1 || !prev.slice(0, idx).some(s => s.show)) return prev
      return prev.map((s, i) => (i < idx && s.show ? { ...s, show: false } : s))
    })
  }

  if (!slots.length) return null

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {slots.map(s => <BackdropLayer key={s.layer.key} layer={s.layer} show={s.show} onHide={handleHide} onRevealed={handleRevealed} progress={progress} stageDim={stageDim} />)}
    </View>
  )
})
