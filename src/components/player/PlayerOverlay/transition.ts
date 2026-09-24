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


export const getFullscreenActionTop = (
  fullTitleTop: number,
  measuredActionY: number | null | undefined,
  measuredTitleY: number | null | undefined,
  paddingTop: number,
) => fullTitleTop + (measuredActionY ?? ((measuredTitleY ?? 0) + paddingTop))

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

export const getLyricCloseGestureArea = ({
  coverBottom,
  windowWidth,
}: {
  coverBottom: number
  windowWidth: number
}) => ({
  top: 0,
  bottom: coverBottom,
  left: 0,
  right: windowWidth,
})

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
export const getCardMorphTransformRange = ({
  bar,
  windowHeight,
  windowWidth,
}: {
  bar: OverlayRect
  windowHeight: number
  windowWidth: number
}): { from: CardMorphTransform, to: CardMorphTransform } => {
  const clampScale = (value: number) => Math.min(1, Math.max(0.01, value))
  const scaleX = clampScale(bar.width / windowWidth)
  const scaleY = clampScale(bar.height / windowHeight)

  return {
    from: {
      translateX: 0,
      translateY: 0,
      scaleX: 1,
      scaleY: 1,
    },
    to: {
      translateX: bar.x + (bar.width - windowWidth) / 2,
      translateY: bar.y + (bar.height - windowHeight) / 2,
      scaleX,
      scaleY,
    },
  }
}

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
