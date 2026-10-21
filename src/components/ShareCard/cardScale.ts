/**
 * 分享卡的"基准整体 + 等比缩放"：全屏档那张卡是基准，其它比例只把这同一个整体等比缩进画布并居中，
 * 卡内内容之间的大小比例一律不变（用户 2026-10-17 指定）。
 *
 * 所以卡盒的两个比例常数住在这里、不住在渲染层 —— 缩放因子必须对着"基准卡盒"算，而 node 测试加载不了
 * import 了 react-native 的那一层（同 cardTheme.ts / cardTypography.ts 的零导入路数）。
 */
export const CARD_WIDTH_RATIO = 0.78
export const CARD_MAX_HEIGHT_RATIO = 0.62

export interface CardScaleInput {
  /** 被拍矩形（导出图的画布）尺寸，dp */
  rectWidth: number
  rectHeight: number
  /** 基准整体所在的那块屏幕尺寸，dp —— 全屏档下两者相等 */
  masterWidth: number
  masterHeight: number
}

/**
 * 卡片外层的等比缩放因子。封顶 1：基准就是全屏那张，切比例只有"缩出去"、没有"放大填满"，
 * 代价是画布相对宽松的那一档（9:16）卡边会留一点空隙。
 * 两个轴共用这一个数 —— 等比是构造上保证的，卡里的度量不需要各自再乘一次。
 */
export const cardScale = ({ rectWidth, rectHeight, masterWidth, masterHeight }: CardScaleInput): number =>
  Math.min(1,
    rectWidth / (masterWidth * CARD_WIDTH_RATIO),
    rectHeight / (masterHeight * CARD_MAX_HEIGHT_RATIO))

/**
 * 比例档（竖屏方向）。用整数对而不是 w/h 的小数：算长度是 `宽 × h ÷ w`，
 * 2:3 / 5:7 / 3:4 / 9:16 四档在 360dp 宽上都恰好落在整数（540/504/480/640），
 * 而 `360 / (2/3)` 会浮点出 540.0000000000001 这种没法钉的值。
 * 没有 w/h 的那一档 = 全屏（沿用整屏被拍面，长就是屏长）。
 */
export const RATIO_OPTIONS = [
  { key: '2:3', w: 2, h: 3 },
  { key: '5:7', w: 5, h: 7 },
  { key: '3:4', w: 3, h: 4 },
  { key: '9:16', w: 9, h: 16 },
  { key: 'fullscreen' },
] as const

export type RatioKey = (typeof RATIO_OPTIONS)[number]['key']

/**
 * 被拍矩形（= 导出图）的尺寸，dp。用户 2026-10-17 指定的口径：**宽恒等于屏宽，比例只改长度**。
 * 旧算法把矩形圈进"屏幕减去头部/底部控件"的可用区，于是宽也跟着比例一起缩 —— 那张卡就变了形。
 * 已知代价：9:16（长 1.78 倍宽）与全屏那两档，面会伸到比例行/动作行底下，只是预览被按钮压住一角，
 * 导出图不受影响。
 */
export const shotRect = (ratio: RatioKey, screenWidth: number, screenHeight: number): { width: number, height: number } => {
  const option = RATIO_OPTIONS.find(o => o.key === ratio)
  if (option == null || !('w' in option)) return { width: screenWidth, height: screenHeight }
  return { width: screenWidth, height: screenWidth * option.h / option.w }
}
