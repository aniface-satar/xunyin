export interface OverlayTransitionState {
  isOpen: boolean
  isTransitioning: boolean
  gestureEnabled: boolean
}

export const getOverlayTransitionVisibility = ({
  isOpen,
  isTransitioning,
  gestureEnabled,
}: OverlayTransitionState) => ({
  showMorphContent: !isOpen || isTransitioning || gestureEnabled,
  showStaticContent: isOpen && !isTransitioning && !gestureEnabled,
})


export const getGhostLyricTop = (
  fullTitleTop: number,
  measuredOffsetY: number | null | undefined,
  fallbackOffsetY: number,
) => fullTitleTop + (measuredOffsetY ?? fallbackOffsetY)

export const getActionColumnLayout = (
  right: number,
  buttonWidth: number,
  gap: number,
) => {
  const width = buttonWidth * 2 + gap
  const heartLeft = right - width

  return {
    width,
    heartLeft,
    moreLeft: heartLeft + buttonWidth + gap,
    gapWidth: gap,
  }
}

export const getMorphProgressTrackStyle = () => ({ width: '100%' as const })

export const canMeasureFullscreenTarget = ({
  progress,
  isTransitioning,
  gestureEnabled,
  settled,
}: {
  progress: number
  isTransitioning: boolean
  gestureEnabled: boolean
  settled: boolean
}) => settled && progress === 0 && !isTransitioning && !gestureEnabled


// measuredActionY 是操作列容器自身的 frame y（不含其 paddingTop），而静态页喜欢/更多按钮
// 的顶部还要再往下偏移 paddingTop，两条路径都必须补上，否则动画收尾与静态页切换时按钮会竖向跳变
export const getFullscreenActionTop = (
  fullTitleTop: number,
  measuredActionY: number | null | undefined,
  measuredTitleY: number | null | undefined,
  paddingTop: number,
) => fullTitleTop + (measuredActionY ?? measuredTitleY ?? 0) + paddingTop

export const getActionColumnTarget = ({
  containerLeft,
  actionX,
  actionWidth,
  buttonWidth,
}: {
  containerLeft: number
  actionX: number
  actionWidth: number
  buttonWidth: number
}) => ({
  width: actionWidth,
  heartLeft: containerLeft + actionX,
  moreLeft: containerLeft + actionX + actionWidth - buttonWidth,
})

export const getTransitionAnimationMode = (velocity: number) => (
  velocity === 0 ? 'timing' : 'spring'
)

export const getLyricPagerVisibility = ({
  isLyricOrigin,
  isTransitioning,
  gestureEnabled,
}: {
  isLyricOrigin: boolean
  isTransitioning: boolean
  gestureEnabled: boolean
}) => (
  isLyricOrigin && (isTransitioning || gestureEnabled)
)

export const CLOSE_GESTURE_ACTIVATION_THRESHOLD = 4

export const getCloseGestureActivationThreshold = () => CLOSE_GESTURE_ACTIVATION_THRESHOLD

export const getCloseGestureDistance = (gestureDy: number, startDy: number) => (
  gestureDy - startDy
)

export const shouldRenderLyricCurrentPreview = (isLyricOrigin: boolean) => !isLyricOrigin

export interface OverlayRect {
  x: number
  y: number
  width: number
  height: number
}

export interface LyricSummaryLayout {
  cover: OverlayRect
  title: OverlayRect
  artist: OverlayRect
  action: OverlayRect
  titleFontSize: number
  titleLineHeight: number
  artistFontSize: number
  artistLineHeight: number
}

export interface LyricSummaryMetrics {
  paddingLeft: number
  coverTextGap: number
  actionGap: number
  titleFontSize: number
  titleLineHeight: number
  artistFontSize: number
  artistLineHeight: number
  artistGap: number
}

// 歌词页顶部封面摘要的静态尺寸与间距，必须与 MusicSummary 保持一致，收起动画才能无缝衔接
export const LYRIC_SUMMARY_COVER_SIZE = 52
// Design values; callers pass the same scaled values used by MusicSummary.
export const LYRIC_SUMMARY_PADDING_LEFT = 20
export const LYRIC_SUMMARY_COVER_TEXT_GAP = 16
export const LYRIC_SUMMARY_ACTION_GAP = 2
export const LYRIC_SUMMARY_TITLE_FONT_SIZE = 20
export const LYRIC_SUMMARY_TITLE_LINE_HEIGHT = 26
export const LYRIC_SUMMARY_ARTIST_FONT_SIZE = 15
export const LYRIC_SUMMARY_ARTIST_LINE_HEIGHT = 20
export const LYRIC_SUMMARY_ARTIST_GAP = 5

export const getLyricSummaryLayout = ({
  headerHeight,
  coverGap,
  contentWidth,
  buttonWidth,
  metrics,
}: {
  headerHeight: number
  coverGap: number
  contentWidth: number
  buttonWidth: number
  metrics: LyricSummaryMetrics
}): LyricSummaryLayout => {
  const top = headerHeight + coverGap
  const actionWidth = buttonWidth * 2 + metrics.actionGap
  const textHeight = metrics.titleLineHeight + metrics.artistGap + metrics.artistLineHeight
  const rowHeight = Math.max(LYRIC_SUMMARY_COVER_SIZE, buttonWidth, textHeight)
  const textLeft = metrics.paddingLeft + LYRIC_SUMMARY_COVER_SIZE + metrics.coverTextGap
  const textTop = top + (rowHeight - textHeight) / 2

  return {
    cover: {
      x: metrics.paddingLeft,
      y: top,
      width: LYRIC_SUMMARY_COVER_SIZE,
      height: LYRIC_SUMMARY_COVER_SIZE,
    },
    title: {
      x: textLeft,
      y: textTop,
      width: Math.max(0, contentWidth - LYRIC_SUMMARY_COVER_SIZE - metrics.coverTextGap - actionWidth),
      height: metrics.titleLineHeight,
    },
    artist: {
      x: textLeft,
      y: textTop + metrics.titleLineHeight + metrics.artistGap,
      width: Math.max(0, contentWidth - LYRIC_SUMMARY_COVER_SIZE - metrics.coverTextGap - actionWidth),
      height: metrics.artistLineHeight,
    },
    action: {
      x: metrics.paddingLeft + contentWidth - actionWidth,
      y: top + (rowHeight - buttonWidth) / 2,
      width: actionWidth,
      height: buttonWidth,
    },
    titleFontSize: metrics.titleFontSize,
    titleLineHeight: metrics.titleLineHeight,
    artistFontSize: metrics.artistFontSize,
    artistLineHeight: metrics.artistLineHeight,
  }
}

export const LYRIC_CURRENT_PREVIEW_GAP = 16
export const LYRIC_CURRENT_PREVIEW_HEIGHT = 20

export const getLyricCurrentPreviewLayout = ({
  coverBottom,
  windowWidth,
}: {
  coverBottom: number
  windowWidth: number
}) => ({
  left: LYRIC_SUMMARY_PADDING_LEFT,
  top: coverBottom + LYRIC_CURRENT_PREVIEW_GAP,
  width: Math.max(0, windowWidth - LYRIC_SUMMARY_PADDING_LEFT * 2),
  height: LYRIC_CURRENT_PREVIEW_HEIGHT,
})

export interface CardMorphTransform {
  translateX: number
  translateY: number
  scaleX: number
  scaleY: number
}

// Layout props force Android to measure and redraw the whole card every frame.
// Scaling a fixed-size card keeps the same morph on the render thread.
//
// 三段关键帧：p=0 整屏、p=BOTTOM_STRIP_SETTLE_SPAN（卡片下缘已到屏幕下缘）、p=1 播放栏。
// 上沿还是 bar.y → 0 那条线性支；下沿改挂在底部那一条的窗口上（与 getCardBottomClampRange、
// BottomTabBar 的位移同窗）——展开时导航栏一动，卡片下缘就跟着把露出来的那一条盖上。
// 若下沿仍按整段线性走，它永远落在导航栏上沿之上，中间会撕出一条后面页面的底色。
// 段内 translateY/scaleY 都是上沿/下沿的线性组合，所以逐段线性就是精确值，不必再加关键帧。
export const getCardMorphTransformRange = ({
  bar,
  windowHeight,
  windowWidth,
  span = BOTTOM_STRIP_SETTLE_SPAN,
}: {
  bar: OverlayRect
  windowHeight: number
  windowWidth: number
  span?: number
}): { from: CardMorphTransform, mid: CardMorphTransform, to: CardMorphTransform } => {
  const clampScale = (value: number) => Math.min(1, Math.max(0.01, value))
  // span 越界（含 ≥1：那等于整段行程才收到位，等于没绑）就退回默认值；
  // Animated 还要求 inputRange 严格递增，所以 span 只取 (0, 1)
  const settleAt = Number.isFinite(span) && span > 0 && span < 1 ? span : BOTTOM_STRIP_SETTLE_SPAN
  // 矩形 → transform：卡片的 layout 盒就是整屏，变换以它为原点（中心缩放）再平移
  const toTransform = (x: number, y: number, width: number, height: number): CardMorphTransform => ({
    translateX: x + (width - windowWidth) / 2,
    translateY: y + (height - windowHeight) / 2,
    scaleX: clampScale(width / windowWidth),
    scaleY: clampScale(height / windowHeight),
  })
  // 水平那一支仍走整屏 ↔ 播放栏的线性插值，取同一个 p 上的值跟竖支对齐；
  // 竖支的上沿还是 bar.y * p，下沿落在屏幕下缘
  const midLeft = bar.x * settleAt
  const midWidth = windowWidth + (bar.width - windowWidth) * settleAt
  const midTop = bar.y * settleAt

  return {
    from: toTransform(0, 0, windowWidth, windowHeight),
    mid: toTransform(midLeft, midTop, midWidth, windowHeight - midTop),
    to: toTransform(bar.x, bar.y, bar.width, bar.height),
  }
}

// 底部那一条（卡片下缘 + 播放栏下面的导航栏）共用同一条窗口，两端分别是：
//   p ≤ SPAN：整屏那一面 —— 卡片下缘在屏幕下缘（静止的全屏页要盖满），导航栏整条在屏幕外；
//   p = 1：播放栏那一面 —— 卡片下缘收到播放栏下沿（= 导航栏上沿），导航栏升回原位。
// [SPAN, 1] 段里两者一起走：展开时进度一离开 1（动画第一帧 / 手指刚动），导航栏就跟着往下走，
// 展开量到 (1 - SPAN)（= 60%）时卡片下缘已经到屏幕下缘、导航栏也整条离开屏幕；
// 收起对称：收起行程的后 60% 里，卡片下缘与导航栏一起收回播放栏下沿。
// 旧版窗口开在 [0, 0.3]：展开要等展开量到 70% 导航栏才动、收起又只在起手那 30% 里升回来，
// 两头都不跟着手指走（真机反馈"导航栏并没有跟着先动"）。
// 上限必须平滑收上去：p=0 又必须回到整屏（静止的全屏页要盖满，底部不能露出后面那层页面），
// 一步切过去会在起手那一帧撕出一条 winHeight - barBottom 高的色带。
export const BOTTOM_STRIP_SETTLE_SPAN = 0.4

// 播放栏还没上报（source 为空 / barBottom 不在屏内）时退化成整屏：没有上限，行为与改动前一致。
export const getCardBottomClampRange = ({
  winHeight,
  barBottom,
  span = BOTTOM_STRIP_SETTLE_SPAN,
}: {
  winHeight: number
  barBottom: number
  span?: number
}) => {
  // 播放栏量到的必须是屏内的一段有效区间：y+height 为 0（还没布局）或越出下缘时一律不裁，
  // 否则会把卡片压成一条线
  const limit = Number.isFinite(barBottom) && barBottom > 0 && barBottom < winHeight ? barBottom : winHeight
  const settleAt = Number.isFinite(span) && span > 0 && span < 1 ? span : BOTTOM_STRIP_SETTLE_SPAN

  return {
    inputRange: [0, settleAt, 1],
    // 整屏一侧停在全屏高度：p ≤ span 之后卡片下缘不再动
    outputRange: [winHeight, winHeight, limit],
  }
}

// 底部导航栏跟同一条窗口走：p = 1 时回到原位，p ≤ span 之后整条停在屏幕外（它的下沿会越出屏底，
// 上沿收在屏幕下缘），中途与卡片下缘同速率下移/回升。
// barHeight 用 BottomTabBar 自己的高度（TAB_BAR_HEIGHT）：它 ≥ 卡片下缘要收的那一段（winHeight - barBottom）时，
// 导航栏上沿才始终不高于卡片下沿，卡片不会啃掉导航栏的顶边；多出来的 (barHeight - 那一段) 是两者之间的缝，
// 真机实测 54 - 47 = 7dp。真机实测 54 ≥ 800 - 753 = 47。
export const getBottomBarRiseRange = ({
  barHeight,
  span = BOTTOM_STRIP_SETTLE_SPAN,
}: {
  barHeight: number
  span?: number
}) => {
  const settleAt = Number.isFinite(span) && span > 0 && span < 1 ? span : BOTTOM_STRIP_SETTLE_SPAN
  const shift = Number.isFinite(barHeight) && barHeight > 0 ? barHeight : 0

  return {
    inputRange: [0, settleAt, 1],
    // 整屏一侧留在屏幕外，播放栏一侧回到 0
    outputRange: [shift, shift, 0],
  }
}

// 背景层是卡片的子层，铺满卡片即可：展开态卡片 identity 等于整屏，
// 收起态卡片被裁进播放栏、背景层跟着一起被裁，两端都不需要额外位移。
// 一旦按 bar 的位置给背景层加位移，展开态就只盖住 winHeight - bar.y 高的一条，
// 屏幕下方整片露出卡片白底（真机实测 800 - 685.7 = 114dp，即 400px 高的色带）。
export const getBackdropFrame = (winWidth: number, winHeight: number) => ({
  position: 'absolute' as const,
  left: 0,
  top: 0,
  width: winWidth,
  height: winHeight,
})

export const getLyricDragLineSpacing = ({
  pageHeight,
  summaryTop,
  summaryHeight,
}: {
  pageHeight: number
  summaryTop: number
  summaryHeight: number
}) => Math.max(0, pageHeight * 0.4 - summaryTop - summaryHeight)

export const getLyricFallbackDragLineSpacing = ({
  pageHeight,
  coverGap,
  coverSize,
  buttonWidth,
}: {
  pageHeight: number
  coverGap: number
  coverSize: number
  buttonWidth: number
}) => getLyricDragLineSpacing({
  pageHeight,
  summaryTop: coverGap,
  summaryHeight: Math.max(coverSize, buttonWidth),
})

export type TransitionOrigin = 'pic' | 'lyric'

let lastOverlayPage = 0

export const getLastOverlayPage = () => lastOverlayPage

export const setLastOverlayPage = (pageIndex: number) => {
  if (pageIndex != 0 && pageIndex != 1) return
  lastOverlayPage = pageIndex
}

// 收起动画的起点取决于当前页：歌曲页从大封面出发，歌词页从顶部小封面摘要出发
export const getTransitionOrigin = (pageIndex: number, lyricPageIndex: number): TransitionOrigin => (
  pageIndex == lyricPageIndex ? 'lyric' : 'pic'
)

// ghost 元素只在接近全屏时淡入、离开全屏时立刻淡出，避免手势刚开始时闪现
export const getGhostFadeConfig = () => ({
  inputRange: [0, 0.04, 0.9, 0.96],
  outputRange: [1, 0, 0, 0],
})

// 歌词页 pager 的交叉淡化只覆盖歌词文本；摘要/头部/播放器与 morph 层原子切换，避免末端重影
export const getLyricPagerFadeConfig = getGhostFadeConfig

// 歌词页摘要封面在收起时补上阴影/描边，这是运动元素自己的淡入时机
export const LYRIC_FADE_OUT_END = 0.5

// 静态底部栏是一整段 "歌名 - 歌手"，morph 层拆成标题/歌手两个独立盒子，
// 中间空出来的正是 " - " 的位置；收尾时必须补上，否则动画结束切静态栏时连接符凭空跳出
// columnRight（文字栏右缘，即 barTextRight）是必须的夹取：歌名长到占满文字栏时，
// 歌手盒子的自然位置落在栏外，不夹住连接符盒会整个伸到按钮区前面，画出一个孤立的 "-"
export const getMorphSeparatorRect = (title: OverlayRect, artist: OverlayRect, columnRight: number) => {
  const left = title.x + title.width

  return {
    left,
    width: Math.max(0, Math.min(artist.x, columnRight) - left),
  }
}

// " - " 只存在于底部栏排版里，全屏页没有；它随歌手盒子一起淡入，
// 保证动画最后一帧与底部栏一致，而不是在卸载瞬间凭空出现
export const getMorphSeparatorFadeConfig = (textMorphThresholds: number[]) => ({
  inputRange: textMorphThresholds,
  outputRange: [0, 0, 1, 1],
})

export interface MorphFadeConfig {
  inputRange: number[]
  outputRange: number[]
  extrapolate: 'clamp'
}

// 阴影只属于全屏页的大封面：静态控制栏的封面（PlayerBar/components/Pic.tsx）只写了 iOS 阴影属性、
// 没有 elevation，在安卓上画不出影子。收起时若阴影一路保持到 progress=1，overlay 卸载的那一帧
// 就会看到影子凭空消失。这里让它随封面飞行整段缓慢淡掉，最后一帧与静态控制栏一致。
// coverTravelStart 是封面离开全屏位置、开始飞行的 progress（即 textMoveThreshold）。
export const getMorphCoverShadowFadeConfig = (isLyricOrigin: boolean, coverTravelStart: number): MorphFadeConfig => {
  const travelStart = Math.min(Math.max(coverTravelStart, 0.2), 0.9)
  if (!isLyricOrigin) {
    return {
      inputRange: [0, travelStart, 1],
      outputRange: [1, 1, 0],
      extrapolate: 'clamp',
    }
  }
  // 歌词页摘要的小封面本身没有阴影，仍按原时机先淡入托住飞行中的卡片，落到控制栏前再淡掉
  const appearEnd = Math.min(LYRIC_FADE_OUT_END, travelStart * 0.8)
  return {
    inputRange: [0, appearEnd, travelStart, 1],
    outputRange: [0, 1, 1, 0],
    extrapolate: 'clamp',
  }
}

export interface MorphTextAnchor {
  y: number
  height: number
}

// 歌名长到占满底部栏的文字栏时，静态栏的跑马灯把整行硬裁在栏右缘，歌手根本不会出现在末态。
// morph 层却仍会让歌手沿着与歌名收敛的轨迹飞进同一行，两个词叠在一起、又被零宽的裁切框啃掉，
// 看起来就像歌手躲在一块空白后面。这里让它在行程中淡出（展开时沿同一条曲线反向淡入），
// 最后一帧与静态栏一致。淡出时机取两个文本盒首次重合的那一刻：
// 全屏时上下相距 (artistTop - titleTop)，行程内线性收敛到 0，剩余间距小于歌名盒高度即为重合。
export const getMorphArtistFadeConfig = (
  textMorphThresholds: number[],
  titleStart: MorphTextAnchor,
  artistStart: MorphTextAnchor,
): MorphFadeConfig => {
  const travelStart = textMorphThresholds[2] ?? 0.5
  const span = Math.max(0.01, 1 - travelStart)
  const gap = artistStart.y - titleStart.y
  const overlapFraction = gap > titleStart.height
    ? Math.min(0.6, Math.max(0.08, 1 - titleStart.height / gap))
    : 0.08
  return {
    inputRange: [0, travelStart, Math.min(0.99, travelStart + span * overlapFraction), 1],
    outputRange: [1, 1, 0, 0],
    extrapolate: 'clamp',
  }
}

// ===================== 进入/收起时的"变色"淡入淡出 =====================
//
// 根因（真机反馈"一碰就跳色"）：morph 走的是 progress 轴（0=全屏，1=播放栏），拖动段跟着手指走，
// 松手后的补间是 PlayerOverlay 的 TRANSITION_DURATION_MS=800ms；而底色和墨色都是 OnCoverThemeProvider
// 从 context 发下来的**静态值**，卡片挂载那一帧就整体换完。所以任何挂在墙钟上的淡入（上一版是
// COVER_BASE_FADE_MS=110ms）都跑在动画前面，观感等于没淡。
// 改法只有一个：把"变色"搬到 progress 轴上，展开淡入、收起淡出，同一条曲线自动对称。
//
// 交叉点消不掉：起点是"浅底深字"，终点是"深底白字"，两者必须互换，中间必然有一帧字与底同明度。
// 于是底色走宽窗（0.45→1 全程，它承担"淡入"的观感），墨色走窄窗（0.62→0.8 共 0.18 的行程，
// 把糊在一起的那截压到最短），并把窄窗对准底色走到中间明度的那一段 —— 两端各自留足对比，只有中间一小段是过渡。
export const ENTER_FADE_FIELD_END = 0.45
export const ENTER_FADE_INK_START = 0.62
export const ENTER_FADE_INK_END = 0.8

export interface EnterFadeRange<T> {
  inputRange: number[]
  outputRange: T[]
  extrapolate: 'clamp'
}

/** 底色（卡片本身、背景层根）：barColor 在播放栏一面，coverColor 在展开到位后 */
export const getEnterFieldRange = (barColor: string, coverColor: string): EnterFadeRange<string> => ({
  inputRange: [0, ENTER_FADE_FIELD_END, 1],
  outputRange: [coverColor, coverColor, barColor],
  extrapolate: 'clamp',
})

/** 墨色（morph 文字）：窄窗翻转，比底色晚 */
export const getEnterInkRange = (barColor: string, coverColor: string): EnterFadeRange<string> => ({
  inputRange: [0, ENTER_FADE_INK_START, ENTER_FADE_INK_END, 1],
  outputRange: [coverColor, coverColor, barColor, barColor],
  extrapolate: 'clamp',
})

/**
 * Icon 一类的 color 不是 Animated，只能两份叠放、各自淡：active=false（动态背景没生效）
 * 时固定只留播放栏那一份，等于改之前只有一个组件、一次都不重绘。
 */
export const getEnterInkOpacityRanges = (active: boolean): { expanded: EnterFadeRange<number>, collapsed: EnterFadeRange<number> } => {
  if (!active) {
    return {
      expanded: { inputRange: [0, 1], outputRange: [0, 0], extrapolate: 'clamp' },
      collapsed: { inputRange: [0, 1], outputRange: [1, 1], extrapolate: 'clamp' },
    }
  }
  const inputRange = [0, ENTER_FADE_INK_START, ENTER_FADE_INK_END, 1]
  return {
    expanded: { inputRange, outputRange: [1, 1, 0, 0], extrapolate: 'clamp' },
    collapsed: { inputRange, outputRange: [0, 0, 1, 1], extrapolate: 'clamp' },
  }
}

/**
 * 封面铺底层（糊封面 + 蒙版）在拖动手势里的闸门：到播放栏那一面整层为 0，别把封面色留在栏上。
 *
 * 两支形状由"这一层是哪一档"选（调用方按 surface.mode 传 fullLength）：
 * - ②「封面模糊」那一档，铺底层就是这一屏的主背景，要"跟着控制栏到全屏那一下淡入淡出" ——
 *   闸门铺满整段行程（[0, 1] → [1, 0] 线性，中间没有平台段）。旧的窄窗（progress 到 0.45 就整层满上）
 *   落在 800ms / bezier(0.22, 1, 0.36, 1) 那条补间上时只用掉行程前 ~116ms
 *   （easing 在 x≈0.145 处已把"已走行程"推到 0.55，即 progress 已到 0.45），观感是
 *   "一开整层就钉在那里"，不是淡。
 * - ① 保持窄窗一字不动：它的洗色只是蒙版底下的一层纹路，与底色同一个窗口翻完就够，
 *   而且 §10.4-3 的逐像素凭证钉在它身上。
 */
export const getEnterBackdropOpacityRange = (fullLength = false): EnterFadeRange<number> => (
  fullLength
    ? { inputRange: [0, 1], outputRange: [1, 0], extrapolate: 'clamp' }
    : { inputRange: [0, ENTER_FADE_FIELD_END, 1], outputRange: [1, 1, 0], extrapolate: 'clamp' }
)
