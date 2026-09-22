import { scaleSizeW, setSpText } from '@/utils/pixelRatio'

export const FULL_COVER_RADIUS = 16
export const BAR_COVER_RADIUS = 8
export const FULL_TEXT_PADDING_X = 15
export const FULL_TITLE_FONT_SIZE = setSpText(30)
export const FULL_ARTIST_FONT_SIZE = setSpText(16)
export const FULL_TITLE_LINE_HEIGHT = Math.ceil(FULL_TITLE_FONT_SIZE * 1.24)
export const FULL_ARTIST_LINE_HEIGHT = Math.ceil(FULL_ARTIST_FONT_SIZE * 1.24)
export const FULL_HEART_SIZE = scaleSizeW(36)

export interface PlayDetailLayout {
  coverGap: number
  coverSize: number
  contentLeft: number
  contentWidth: number
  titleGap: number
  titleTop: number
  artistTop: number
  textWidth: number
  titleWidth: number
}

export const getPlayDetailLayout = (winWidth: number, winHeight: number, headerHeight: number): PlayDetailLayout => {
  const coverGap = Math.max(winHeight * 0.024, 16)
  const coverSize = Math.min(
    winWidth * 0.86,
    winHeight * 0.44,
    Math.max((winHeight - headerHeight - 180) * 0.6, 160),
  )
  const titleGap = Math.max(winHeight * 0.042, 28)
  const contentLeft = (winWidth - coverSize) / 2
  const contentWidth = coverSize
  const titleTop = coverGap + coverSize + titleGap
  const artistTop = titleTop + FULL_TITLE_LINE_HEIGHT + 4
  return {
    coverGap,
    coverSize,
    contentLeft,
    contentWidth,
    titleGap,
    titleTop,
    artistTop,
    textWidth: contentWidth,
    titleWidth: contentWidth - FULL_HEART_SIZE - 10,
  }
}
