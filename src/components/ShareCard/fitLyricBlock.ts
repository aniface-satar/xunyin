/**
 * 歌词海报的"装得下多少句"判据。本模块必须保持零 import：
 * node --test 直接载它跑单测（规矩同 src/core/lyricCopy.ts）。
 */

export interface LyricBlockLine {
  text: string
  extendedLyrics?: string[] | null
}

export interface FitLyricOptions {
  /** 歌词块可用高度，单位 dp（不是物理像素） */
  maxHeight: number
  tiers?: readonly number[]
  lineHeightRatio?: number
  extendedTierFloor?: number
}

export interface FitLyricResult {
  fontSize: number
  extendedFontSize: number
  /** 能整句显示出来的行数（按"句"计，译文跟着自己的正文行走） */
  visibleCount: number
  truncated: boolean
}

export const LYRIC_TIERS: readonly number[] = [24, 22, 20, 18, 16]
/** 正文已在最低档时译文的下探地板，不再随档位继续往下 */
export const EXTENDED_TIER_FLOOR = 12
export const LYRIC_LINE_HEIGHT_RATIO = 1.5

const rowHeight = (fontSize: number, ratio: number) => fontSize * ratio

/** 一句占多高：正文一行 + 每个非空译文一行；空白行不占高（与 hasLyricText 同一口径） */
const blockHeight = (line: LyricBlockLine, body: number, ext: number, ratio: number) => {
  let height = line.text?.trim() ? rowHeight(body, ratio) : 0
  for (const text of line.extendedLyrics ?? []) {
    if (text?.trim()) height += rowHeight(ext, ratio)
  }
  return height
}

export const fitLyricBlock = (lines: readonly LyricBlockLine[], options: FitLyricOptions): FitLyricResult => {
  const tiers = options.tiers ?? LYRIC_TIERS
  const ratio = options.lineHeightRatio ?? LYRIC_LINE_HEIGHT_RATIO
  const floor = options.extendedTierFloor ?? EXTENDED_TIER_FLOOR
  // 兜底先按最低档摆好，visibleCount 给 -1 是为了让第一档一定"严格更多"从而接管它；
  // 之后同句数的平局就自然留在更大的字号上。tiers 传空数组才会走到这一条（生产传不到）。
  let fallback: FitLyricResult = {
    fontSize: tiers[tiers.length - 1],
    extendedFontSize: floor,
    visibleCount: -1,
    truncated: lines.length > 0,
  }

  for (let i = 0; i < tiers.length; i++) {
    const body = tiers[i]
    const ext = tiers[i + 1] ?? floor
    let height = 0
    let count = 0
    for (const line of lines) {
      const h = blockHeight(line, body, ext, ratio)
      // 整句才收：装不下的那一句连同它的译文一起丢掉（宁可少一句，不切半句）
      if (height + h > options.maxHeight) break
      height += h
      count++
    }
    // 档位越高字越大、装得下的越少，所以第一个"全装得下"的就是答案
    if (count === lines.length) return { fontSize: body, extendedFontSize: ext, visibleCount: count, truncated: false }
    if (count > fallback.visibleCount) {
      fallback = { fontSize: body, extendedFontSize: ext, visibleCount: count, truncated: true }
    }
  }
  return fallback
}
