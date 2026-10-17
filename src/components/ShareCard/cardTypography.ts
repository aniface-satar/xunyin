// 音乐卡字号判据：一行最多容纳 26 个英文字母（spec §11.11）。纯函数，不 import RN，所以能从 node 测试直接调。
//
// 字宽是量出来的（arial.ttf，1000px 字号下 getlength / 字符数）：小写 a–z 平均 0.489em、
// 真实歌名那种混合大小写 0.507em ⇒ 取 0.5。**全大写字母是 0.66em**，那种标题装不下 26 个，
// 这条判据的口径本来就是"平均英文字母"，不是"任何 26 个字符"。
const AVG_LATIN_LETTER_EM = 0.5
const MAX_LETTERS_PER_LINE = 26
// 上限钉在改动前手写的 24dp：卡再宽也不把字放回去 —— 这条判据是"往小调"，不是双向缩放。
const MAX_TITLE_FONT_SIZE = 24
// 下限：屏宽 <285dp 那种小屏上按判据会算到 14 以下，字小到读不动就没有"优雅换行"可言了。
const MIN_TITLE_FONT_SIZE = 14
// 歌手 : 歌名 = 旧值 18 : 24，层级比例不动，只把整块往下平移。
const SINGER_FONT_RATIO = 0.75
// 行高比同样是旧值 30 : 24。
const TITLE_LINE_HEIGHT_RATIO = 1.25

export const cardTextSizes = (textWidth: number) => {
  const byLetters = textWidth / MAX_LETTERS_PER_LINE / AVG_LATIN_LETTER_EM
  // NaN/Infinity 过不了 Math.min（它一路把 NaN 传到底，最后 fontSize 是 NaN），所以先判有限；
  // 量不出宽度时就按上限那档走，和改动前的手写值一致。
  const title = Number.isFinite(byLetters)
    ? Math.min(MAX_TITLE_FONT_SIZE, Math.max(MIN_TITLE_FONT_SIZE, byLetters))
    : MAX_TITLE_FONT_SIZE
  // 字号先落到 0.1dp：零点几档的差在屏上看不出来，但不落的话下面两个派生值会跟着抖出三位小数
  const rounded = Math.round(title * 10) / 10
  return {
    title: rounded,
    titleLineHeight: Math.round(rounded * TITLE_LINE_HEIGHT_RATIO * 10) / 10,
    singer: Math.round(rounded * SINGER_FONT_RATIO * 10) / 10,
  }
}
