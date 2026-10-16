import { Hct } from '@material/material-color-utilities/hct/hct.js'

export interface CardTheme {
  cardBackground: string
  titleColor: string
  subtitleColor: string
  lyricColor: string
  scrimColor: string
}

/** tone 严格大于这个值才算亮封面。与 surface.ts 的 `font.tone > 50` 同写法，但输入是封面平均色而不是主题字色 */
export const LIGHT_CARD_TONE = 50

export const LIGHT_CARD_THEME: CardTheme = {
  cardBackground: '#FFFFFF',
  titleColor: '#1C1C1E',
  subtitleColor: '#8E8E93',
  lyricColor: '#1C1C1E',
  scrimColor: 'rgba(0,0,0,0.20)',
}

export const DARK_CARD_THEME: CardTheme = {
  cardBackground: 'rgba(28,28,30,0.72)',
  titleColor: '#FFFFFF',
  subtitleColor: 'rgba(255,255,255,0.72)',
  lyricColor: '#FFFFFF',
  scrimColor: 'rgba(0,0,0,0.20)',
}

/** 歌词卡固定深卡半透明（spec §3），不参与封面自适应 */
export const LYRIC_CARD_THEME: CardTheme = DARK_CARD_THEME

const toneOf = (argb: number) => Hct.fromInt(argb >>> 0).tone

export const isLightCover = (averageArgb: number | null | undefined): boolean => {
  if (typeof averageArgb !== 'number' || !Number.isFinite(averageArgb)) return false
  return toneOf(averageArgb) > LIGHT_CARD_TONE
}

export const pickMusicCardTheme = (averageArgb: number | null | undefined): CardTheme =>
  isLightCover(averageArgb) ? LIGHT_CARD_THEME : DARK_CARD_THEME
