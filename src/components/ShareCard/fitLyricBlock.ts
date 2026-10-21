/**
 * 歌词海报的"装得下多少句"判据。本模块必须保持零 import：
 * node --test 直接载它跑单测（规矩同 src/core/lyricCopy.ts）。
 */

export interface LyricBlockLine {
  text: string
  extendedLyrics?: string[] | null
  /**
   * 这一句在歌词页上没有折行（歌词页按自己的宽度量出来的）。卡里也要保持一行：
   * 字号搜索会先缩到"这些句子在卡里仍是一行"的最大一档，渲染层再按同一个判据钉 numberOfLines={1}。
   */
  noWrap?: boolean
}

export interface FitLyricOptions {
  /** 歌词块可用高度，单位 dp（不是物理像素） */
  maxHeight: number
  tiers?: readonly number[]
  lineHeightRatio?: number
  extendedTierFloor?: number
  /**
   * 卡内文字列宽度(dp)。给了就按「自动换行」算高度：一句按估宽折几行就算几行的高度；
   * 不给退回旧行为（一句当一行）。旧模型正是图一溢出的来源：五句以下取最高档仍"装得下"，
   * 但每句在窄卡上实际渲染成两行，真实高度接近预算的两倍，落款被顶出圆角卡外。
   */
  textWidth?: number
  /**
   * 译文 : 正文 的字号比例。给了就每档从正文字号现推译文（同歌词页的 0.8），
   * 不再把「下一档」当译文 —— 逐 dp 下探的档位里，下一档是正文档，不是译文档。
   * 不给时保留旧行为（ext = 下一档 ?? 地板），既有五档模型与它的用例原样成立。
   */
  extendedRatio?: number
  /**
   * 正文字号上界(dp)：歌词页里用户选的那一档。与 minFontSize 一起启用
   * 「从用户字号逐 dp 下探」这条路（歌词卡现在走的就是它）。
   */
  fontSize?: number
  /** 下探地板(dp)：卡内歌手名那一档，见 LYRIC_MIN_FONT_SIZE */
  minFontSize?: number
  /** 下探步长(dp)，默认 1 */
  fontSizeStep?: number
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
/** 歌词卡落款那一行（歌名 / 歌手）的字号：卡内唯一不随歌词字号变的两个数 */
export const LYRIC_FOOTER_TITLE_FONT_SIZE = 16
export const LYRIC_FOOTER_SINGER_FONT_SIZE = 14
/**
 * 歌词正文逐 dp 下探时的地板：卡内歌手名那一档。
 * 用户 2026-10-19 指定「最多歌词传达到卡片的最小字体为卡片内歌手名的大小」。
 */
export const LYRIC_MIN_FONT_SIZE = LYRIC_FOOTER_SINGER_FONT_SIZE
/** 译文 : 正文 的字号比例，与歌词页 LrcLine 的 size * 0.8 同源 */
export const EXTENDED_FONT_RATIO = 0.8

const rowHeight = (fontSize: number, ratio: number) => fontSize * ratio

/** 估宽的字宽模型：全宽区段（汉字/假名/谚文/全角符号）1em；拉丁、空格、标点取 0.55em。 */
const isWideCodePoint = (code: number) => {
  if (code < 0x1100) return false
  if (code === 0x303f) return false // 半宽 CJK 区段收尾
  return code <= 0x115f || // 谚文字母
    (code >= 0x2e80 && code <= 0xa4cf) || // CJK 汉字/假名等
    (code >= 0xac00 && code <= 0xd7a3) || // 谚文音节
    (code >= 0xf900 && code <= 0xfaff) || // CJK 兼容表意
    (code >= 0xfe30 && code <= 0xfe6f) || // CJK 兼容形式
    (code >= 0xff00 && code <= 0xff60) || // 全角形式
    (code >= 0xffe0 && code <= 0xffe6) || // 全角符号
    (code >= 0x20000 && code <= 0x3fffd) // CJK 扩展 B~G
}

// 0.55em 按 arial.ttf 量的口径往保守侧抬（cardTypography 的平均小写是 0.489em、
// 全大写 0.66em；海报正文这层现在是 bold，再加粗也不越过这条线）。
const NARROW_EM = 0.55

const textWidthEm = (text: string) => {
  let total = 0
  for (const ch of text) {
    total += isWideCodePoint(ch.codePointAt(0) ?? 0) ? 1 : NARROW_EM
  }
  return total
}

/**
 * 一句在给定字号/列宽下折几行。ceil 本身取的是保守侧（宁可多算一行也不少算）；
 * 空白句不占行（与 blockHeight 同一口径），textWidth 非正时退回「一句一行」。
 * 导出供单测直接钉这条估宽判据。
 */
export const estimateRowCount = (text: string | null | undefined, fontSize: number, textWidth: number): number => {
  if (!text?.trim()) return 0
  if (!(textWidth > 0) || !(fontSize > 0)) return 1
  return Math.max(1, Math.ceil(textWidthEm(text) * fontSize / textWidth))
}

/** 这一档字号下，歌词页上没折行的句子在卡里还放不放得进一行（决定能不能钉 numberOfLines={1}） */
export const fitsSingleRow = (line: LyricBlockLine, fontSize: number, textWidth: number): boolean =>
  !line.noWrap || estimateRowCount(line.text, fontSize, textWidth) <= 1

/**
 * 这一句在卡里该不该钉成一行。
 *
 * 歌词页量到的行数（onTextLayout）就是场上真相，优先用它；但 FlatList 只挂载屏幕附近那几行，
 * 「全选 → 海报」时绝大多数行从没排过版，量不到。那部分退回按**歌词页自己的**排版宽度与真实渲染字号
 * 估一行 —— 估宽那条 0.55em 的线是往保守侧抬的，误判只会落在"该钉的没钉"（顶多这一行仍自动折行），
 * 不会反过来把一句本来看得见的歌词钉到裁掉。
 *
 * @param measuredRows 歌词页量到的行数，没量到时传 undefined
 * @param pageFontSize 歌词页实际渲染的字号(dp)，即 setSpText(设置值 ÷ 10)
 * @param pageTextWidth 歌词页一行的可用宽度(dp)
 */
export const resolveNoWrap = (measuredRows: number | undefined, text: string, pageFontSize: number, pageTextWidth: number): boolean =>
  measuredRows == null ? estimateRowCount(text, pageFontSize, pageTextWidth) <= 1 : measuredRows <= 1

/**
 * 换行估宽不会万无一失（窄字符占比、断点位置都有侵入），预算里先扣掉一整行
 * 最高正文字号的高度兜住那部分误差；整块都确定是一行时不减。
 */
export const WRAP_SLACK_ROWS = 1

/** 一句占多高：正文按折行数 + 每个非空译文按折行数；空白行不占高（与 hasLyricText 同口径） */
const blockHeight = (line: LyricBlockLine, body: number, ext: number, ratio: number, textWidth: number) => {
  let height = estimateRowCount(line.text, body, textWidth) * rowHeight(body, ratio)
  for (const text of line.extendedLyrics ?? []) {
    height += estimateRowCount(text, ext, textWidth) * rowHeight(ext, ratio)
  }
  return height
}

const round1 = (value: number) => Math.round(value * 10) / 10

const isPositive = (value: number | undefined): value is number =>
  value != null && Number.isFinite(value) && value > 0

/**
 * 从用户字号往下到地板的一串候选（含两端、降序、去重），默认步长 1dp。
 * 地板一定出现在末尾：max 不是整步时会差一档，末尾补上地板才探得到。
 * 导出供单测直接钉这条档位序列。
 */
export const lyricFontSizes = (max: number, min: number, step = 1): number[] => {
  if (!isPositive(max)) return []
  const floor = isPositive(min) ? round1(Math.min(max, min)) : round1(max)
  const sizes = [round1(max)]
  const stride = isPositive(step) ? step : 1
  for (let size = max; size - stride > floor; size -= stride) {
    const next = round1(size - stride)
    if (next !== sizes[sizes.length - 1]) sizes.push(next)
  }
  if (sizes[sizes.length - 1] !== floor) sizes.push(floor)
  return sizes
}

export const fitLyricBlock = (lines: readonly LyricBlockLine[], options: FitLyricOptions): FitLyricResult => {
  const ratio = options.lineHeightRatio ?? LYRIC_LINE_HEIGHT_RATIO
  const floor = options.extendedTierFloor ?? EXTENDED_TIER_FLOOR
  // 宽度只认正的有限数：NaN 会顺着预算乘加一路传下去（同 cardTextSizes 的教训），负数没有宽度可言
  const wrapWidth = options.textWidth != null && Number.isFinite(options.textWidth) && options.textWidth > 0
    ? options.textWidth
    : 0

  const countFitting = (body: number, ext: number) => {
    // 旧模型（没给 noWrap 的行）一律留余量；歌词卡那种"歌词页上一行"的整块，
    // 只在真有折行（或带译文）时才留 —— 行高确定时那行余量会白白挤掉一句。
    const estimated = wrapWidth > 0 && lines.some(line =>
      !line.noWrap ||
      (line.extendedLyrics ?? []).some(text => !!text?.trim()) ||
      estimateRowCount(line.text, body, wrapWidth) > 1)
    const slack = estimated ? WRAP_SLACK_ROWS * rowHeight(body, ratio) : 0
    const budget = options.maxHeight - slack
    let height = 0
    let count = 0
    for (const line of lines) {
      const h = blockHeight(line, body, ext, ratio, wrapWidth)
      // 整句才收：装不下的那一句连同它的译文一起丢掉（宁可少一句，不切半句）
      if (height + h > budget) break
      height += h
      count++
    }
    return count
  }

  // 连续档（歌词卡）：从用户选的字号逐 dp 往下探到歌手名那一档。
  // 取"装得最多"的档，同句数时留更大的字号（降序扫描 + 严格更多才换档）。
  if (isPositive(options.fontSize) && isPositive(options.minFontSize)) {
    const extendedRatio = options.extendedRatio ?? EXTENDED_FONT_RATIO
    // 译文跟着正文字号走，但不越过正文，也不低于既有地板（正文比地板还小时跟着正文）
    const extendedOf = (body: number) => Math.min(body, Math.max(floor, round1(body * extendedRatio)))
    const sizes = lyricFontSizes(options.fontSize, options.minFontSize, options.fontSizeStep)
    // 上界：让"歌词页上没折行"的句子在卡里也保持一行的最大字号（字号越小越窄，从大到小
    // 第一次满足就是它）。连地板都放不进一行的句子（长英文句那种）不在约束里 —— 它只能折行，
    // 不该为它把整张卡的字号拖到地板。
    const keepOneRow = lines.filter(line => line.noWrap && fitsSingleRow(line, sizes[sizes.length - 1], wrapWidth))
    const safeIndex = sizes.findIndex(body => keepOneRow.every(line => fitsSingleRow(line, body, wrapWidth)))
    const start = safeIndex >= 0 ? safeIndex : 0
    let best: FitLyricResult | null = null
    for (let i = start; i < sizes.length; i++) {
      const body = sizes[i]
      const extendedFontSize = extendedOf(body)
      const visibleCount = countFitting(body, extendedFontSize)
      if (best == null || visibleCount > best.visibleCount) {
        best = { fontSize: body, extendedFontSize, visibleCount, truncated: visibleCount < lines.length }
      }
      // 降序扫描：第一次"全装得下"就是能装下全部的最大字号
      if (visibleCount === lines.length) break
    }
    if (best != null) return best
  }

  const tiers = options.tiers ?? LYRIC_TIERS
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
    const count = countFitting(body, ext)
    // 档位越高字越大、装得下的越少，所以第一个"全装得下"的就是答案
    if (count === lines.length) return { fontSize: body, extendedFontSize: ext, visibleCount: count, truncated: false }
    if (count > fallback.visibleCount) {
      fallback = { fontSize: body, extendedFontSize: ext, visibleCount: count, truncated: true }
    }
  }
  return fallback
}
