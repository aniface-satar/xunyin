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

// 歌词页顶部封面摘要的静态尺寸与间距，必须与 MusicSummary 保持一致，收起动画才能无缝衔接
export const LYRIC_SUMMARY_COVER_SIZE = 52
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
}: {
  headerHeight: number
  coverGap: number
  contentWidth: number
  buttonWidth: number
}): LyricSummaryLayout => {
  const top = headerHeight + coverGap
  const actionWidth = buttonWidth * 2 + LYRIC_SUMMARY_ACTION_GAP
  const rowHeight = Math.max(LYRIC_SUMMARY_COVER_SIZE, buttonWidth)
  const textHeight = LYRIC_SUMMARY_TITLE_LINE_HEIGHT + LYRIC_SUMMARY_ARTIST_GAP + LYRIC_SUMMARY_ARTIST_LINE_HEIGHT
  const textLeft = LYRIC_SUMMARY_PADDING_LEFT + LYRIC_SUMMARY_COVER_SIZE + LYRIC_SUMMARY_COVER_TEXT_GAP
  const textTop = top + (rowHeight - textHeight) / 2

  return {
    cover: {
      x: LYRIC_SUMMARY_PADDING_LEFT,
      y: top,
      width: LYRIC_SUMMARY_COVER_SIZE,
      height: LYRIC_SUMMARY_COVER_SIZE,
    },
    title: {
      x: textLeft,
      y: textTop,
      width: Math.max(0, contentWidth - LYRIC_SUMMARY_COVER_SIZE - LYRIC_SUMMARY_COVER_TEXT_GAP - actionWidth),
      height: LYRIC_SUMMARY_TITLE_LINE_HEIGHT,
    },
    artist: {
      x: textLeft,
      y: textTop + LYRIC_SUMMARY_TITLE_LINE_HEIGHT + LYRIC_SUMMARY_ARTIST_GAP,
      width: Math.max(0, contentWidth - LYRIC_SUMMARY_COVER_SIZE - LYRIC_SUMMARY_COVER_TEXT_GAP - actionWidth),
      height: LYRIC_SUMMARY_ARTIST_LINE_HEIGHT,
    },
    action: {
      x: LYRIC_SUMMARY_PADDING_LEFT + contentWidth - actionWidth,
      y: top + (rowHeight - buttonWidth) / 2,
      width: actionWidth,
      height: buttonWidth,
    },
    titleFontSize: LYRIC_SUMMARY_TITLE_FONT_SIZE,
    titleLineHeight: LYRIC_SUMMARY_TITLE_LINE_HEIGHT,
    artistFontSize: LYRIC_SUMMARY_ARTIST_FONT_SIZE,
    artistLineHeight: LYRIC_SUMMARY_ARTIST_LINE_HEIGHT,
  }
}

export type TransitionOrigin = 'pic' | 'lyric'

// 收起动画的起点取决于当前页：歌曲页从大封面出发，歌词页从顶部小封面摘要出发
export const getTransitionOrigin = (pageIndex: number, lyricPageIndex: number): TransitionOrigin => (
  pageIndex == lyricPageIndex ? 'lyric' : 'pic'
)

// 歌词页收起时歌词列表在这段进度内淡出，避免手势开始时整页文字瞬间消失
export const LYRIC_FADE_OUT_END = 0.25
