import { Contrast } from '@material/material-color-utilities/contrast/contrast.js'
import { Hct } from '@material/material-color-utilities/hct/hct.js'
import { argbFromRgb, blueFromArgb, greenFromArgb, redFromArgb } from '@material/material-color-utilities/utils/color_utils.js'

export const CHROMA_CAP = 24
/** 洗色有多浓，看"这张唱片整体有多少颜色"：取封面平均色的彩度按比例走。
 *  取色器那支 scored source 挑的是画面里最跳的一块（实测三张夹具 54.5 / 17.3 / 61.1），
 *  整屏照它上彩，亮封面就变成一坨糖果色。比例 0.65 是量着参考图定的。 */
export const COVER_CHROMA_RATIO = 0.65
/** 灰封面也留一点色相，别让整屏退成监控画面；代价是纯灰封面也会染上一丝源色的调子。 */
export const WASH_CHROMA_FLOOR = 6
export const MIN_CONTRAST = 4.5
// 纯色底（以及蒙版色）的明度锚点。动态背景一开，播放页的墨色就恒为白（见 onCoverTheme.ts），
// 所以暗支不再被"主题那支中灰字色"钉死：白字 tone=100 时锚点 40 只留 5.5 的余量，
// 次级字色会被顶到和主字色一样亮（灰这一层直接不存在）。
// 锚点 32 实测（真机蓝封面夹具）：底色 L*31.9、蒙版 0.92、合成场 L*36.5，
// 白字 92 对场 6.0；次级灰/图标/强调三档都退到 83，对场 4.7~4.7；歌词 69 对场 3.1。
// 代价要说清：再往上抬，"灰 / 图标 / 强调"三档在明度上会并成一层，只靠彩度区分；
// 白和它们之间还剩 9 个 L*（26 时是 15），够分开"主字 vs 一切非主字"，但分不开那三档彼此。
// 取 32 而不是更高：底色已比 26 亮 6 档，白字闸门还剩 6.0；36 档白字掉到 5.2，
// 40 档只剩 4.6 且四档并成同一个 93（灰彻底不存在）。用户反馈"有点暗"是在 26 上，26 的场只有 L*30。
// 亮支（墨色偏深）线上不再触发，仍用 LIGHT_ANCHOR_TONE。
export const DARK_ANCHOR_TONE = 32
export const LIGHT_ANCHOR_TONE = 78
/** 动态背景开启后播放页唯一的墨色：取色必须对着它算，不能再读主题的 c-font，
 *  否则 provider 刷白 → 底色重算变深 → provider 才生效，第一次上色会来回跳一次。 */
export const ON_COVER_FONT = 0xFFFFFFFF
export const ON_COVER_FONT_CSS = 'rgb(255, 255, 255)'
export const TONE_DRIFT_LIMIT = 4
export const SCRIM_MIN = 0.55
export const SCRIM_MAX = 1
const MAX_TONE_STEPS = 8
/** 纹理色阶带的上沿锚点。两张参考图量下来背景中位 L* 53~57、下沿 45，而白字 4.5 闸门只允许到 48 ——
 *  所以带顶就钉在 48，带内整体往上挤；参考图比这更亮的部分是靠"正文只占下半屏"换来的，我们用 TEXTURE_TONE_SWING
 *  和纹理层的纵向柔光各自解决一半。亮支（墨色偏深）线上不再触发，仍用 LIGHT_ANCHOR_TONE。 */
export const TEXTURE_ANCHOR_TONE = 48
/** 纹理明度摆幅（自锚点往下单边）：参考图去掉纵向色阶后局部起伏只有 11~17 个色阶。
 *  旧值 26 量出来是 29 —— 云纹比封面本身还抢眼，看着就不像"一张放大的照片"。 */
export const TEXTURE_TONE_SWING = 11
/** 色域余量：HCT→sRGB 夹色域会把带边缘的 tone 拉回来一点。实测余量 0 时 971,280 例里有 10 例破线（最差 4.495），
 *  留 0.1 之后 0 例破线（最差 4.632），代价只是带宽 29→28。见 spec §7.5。 */
export const BAND_HEADROOM = 0.1

export interface ToneBand {
  lo: number
  hi: number
}

/** 封面侧的三个测量值，全是 argb。
 *  之所以不写成三个位置参数：average 与 highlight 传反不会报错，只会让闸门悄悄变乐观 —— 那正是本次要修的缺陷。 */
export interface CoverMeasure {
  /** Monet 源色：色相与彩度的来源 */
  sourceArgb: number
  /** 全图平均色：只用来判"这张唱片整体有多少颜色" */
  averageArgb: number
  /** 最亮局部块的平均色：封面透出来多少以它为准 */
  highlightArgb: number
}

export interface CoverSurface {
  /** 铺底色，同时用作蒙版色：保证前景字色始终落在它这一侧 */
  base: string
  /** 蒙版不透明度：封面越亮/越暗（相对底色）越实，限制封面透出的 tone 漂移 */
  scrimAlpha: number
  /** 纹理层可用的整数明度带：带内每一档对字色都 >= MIN_CONTRAST + BAND_HEADROOM。
   *  带顶在 TEXTURE_ANCHOR_TONE 上沿、只往下摆，所以不再包住 base（base 是纯色底，另按自己的锚点走）。
   *  只喂纹理支；纯色背景不依赖它，算不出来就是 null。 */
  band: ToneBand | null
  /** 纹理层的那"一套颜色"：莫奈式上色是同一支颜料摆明暗，不是把封面糊一下。
   *  色相取源色、彩度已按 CHROMA_CAP 夹过，封面只贡献明度结构（见 texture.ts 的 HUE_DEV）。 */
  tint: { hue: number, chroma: number }
  /** 最亮那块上、蒙版合成之后用户真正看到的明度（L*）。
   *  前景色阶必须对着它算：对着 base 算会得到乐观结果，白字恰好就破在透出最多的那块上。 */
  fieldTone: number
}

export const cssRgb = (argb: number) => `rgb(${redFromArgb(argb)}, ${greenFromArgb(argb)}, ${blueFromArgb(argb)})`

const rgbColorRxp = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/
// CSS 语义是"超过 255 钳到 255"。少了这一步，`300 << 16` 会溢出污染相邻通道，
// 交出去一个看起来正常的暗色，比抛错更难查。
const clampChannel = (value: string) => Math.min(255, Number(value))

export const parseCssColor = (color: string): number | null => {
  const matched = rgbColorRxp.exec(color.trim())
  if (!matched) return null
  return ((255 << 24) | (clampChannel(matched[1]) << 16) | (clampChannel(matched[2]) << 8) | clampChannel(matched[3])) >>> 0
}

// 上游（原生像素与 parseCssColor）保证 alpha=255；非整数或带透明通道就是取色失败。
// 注意 `NaN >>> 0 === 0`：不在这一层挡住，失败会被静默当成"不透明黑"参与配色。
const isUsableArgb = (argb: number) => Number.isInteger(argb) && (argb >>> 24) === 255

// 从底色往两边各走整数 tone 一步，走到"再走一步就破线"、"走出 swing"或"走出 tone 域"为止。
// 底色 tone 是 HCT→sRGB 夹完色域再读回来的小数（实测 96.1149 / 10.0143），带必须落在整数格上：
// 从小数起走，lo 会掉到 -0.99 这种 tone 域外的值，两端也永远差一小截小数，纹理层拿到没法直接用。
// 下界锚在 floor（含底色本身），上界从 ceil 起步，通常就包住了底色。
// 上界永远被 tone<=100（纯白）顶死：亮主题的纵深只能从靠字色的那端挖，所以带宽是数学上限，不是手艺差。
// 取整会把靠字色那端往字色推一格，底色本身也只保证 4.5（不含余量）：字色 tone 落在 47~55 一带时
// 端点会掉到 4.43。所以走完再从两端往里收到合法为止，可读性优先于"包住小数底色"；收空就 null。
export const buildToneBand = (baseArgb: number, fontArgb: number): ToneBand | null => {
  if (!isUsableArgb(baseArgb) || !isUsableArgb(fontArgb)) return null
  const fontTone = Hct.fromInt(fontArgb).tone
  const baseTone = Hct.fromInt(baseArgb).tone
  const anchor = Math.floor(baseTone)
  const keeps = (t: number) => Contrast.ratioOfTones(t, fontTone) >= MIN_CONTRAST + BAND_HEADROOM
  let lo = anchor
  while (lo > 0 && anchor - lo < TEXTURE_TONE_SWING && keeps(lo - 1)) lo -= 1
  let hi = Math.min(100, Math.ceil(baseTone))
  while (hi + 1 <= 100 && hi - anchor < TEXTURE_TONE_SWING && keeps(hi + 1)) hi += 1
  while (lo <= hi && !keeps(lo)) lo += 1
  while (hi >= lo && !keeps(hi)) hi -= 1
  return lo <= hi ? { lo, hi } : null
}

export const buildCoverSurface = (measure: CoverMeasure, fontArgb: number): CoverSurface | null => {
  const { sourceArgb, averageArgb, highlightArgb } = measure
  if (!isUsableArgb(fontArgb) || !isUsableArgb(sourceArgb) || !isUsableArgb(averageArgb) || !isUsableArgb(highlightArgb)) return null

  const font = Hct.fromInt(fontArgb)
  const source = Hct.fromInt(sourceArgb)
  const coverAvg = Hct.fromInt(averageArgb)
  // 封面透出来多少，看的不是整张的平均，而是糊完之后仍然最亮的那一块：白字破线就破在它上面。
  const highlight = Hct.fromInt(highlightArgb)
  const isDark = font.tone > 50
  // 洗色浓淡仍然跟整张唱片的颜色量走（见 COVER_CHROMA_RATIO）：局部最亮块往往是被照亮的边缘，
  // 拿它的彩度定全屏浓度会把一张主体灰、局部橘的封面涂成整屏橘色。
  const chroma = Math.min(source.chroma, CHROMA_CAP, Math.max(WASH_CHROMA_FLOOR, COVER_CHROMA_RATIO * coverAvg.chroma))

  let tone = isDark ? DARK_ANCHOR_TONE : LIGHT_ANCHOR_TONE
  for (let i = 0; i < MAX_TONE_STEPS && Contrast.ratioOfTones(tone, font.tone) < MIN_CONTRAST; i++) {
    tone = isDark ? Math.max(0, tone - 4) : Math.min(100, tone + 3)
  }
  const base = Hct.from(source.hue, chroma, tone).toInt() >>> 0
  // HCT→sRGB 夹色域后真正铺出来的底色 tone 才是给用户看的那个值，判断以它为准。
  // 字色 tone 落在 49.9~50.0 且带彩度时（例：Hct.from(0, 20, 49.95)）亮分支最好也只有
  // 纯白的 4.4962。另一侧够得到（tone 0 → 4.6706），但底色跨侧等于把整页从亮翻成黑，
  // 那是看得见的乱来 —— 所以够不到就 null 回落到主题纯色，不跨侧硬凑。
  const baseTone = Hct.fromInt(base).tone
  if (Contrast.ratioOfTones(baseTone, font.tone) < MIN_CONTRAST) return null

  // 合成 ≈ scrim(base, a) 盖在模糊封面(最亮块) 上：偏离量 = (1 - a) * |块 tone - 底色 tone|
  const drift = Math.abs(highlight.tone - baseTone)
  let scrimAlpha = drift <= TONE_DRIFT_LIMIT ? SCRIM_MIN : 1 - TONE_DRIFT_LIMIT / drift
  scrimAlpha = Math.min(SCRIM_MAX, Math.max(SCRIM_MIN, scrimAlpha))

  // 闸门核的是"看到的那层"，不是底色本身：底色按蒙版混进糊掉的封面之后才是用户眼里的背景。
  // 旧实现只核底色就交出去，实测暗主题配亮封面时底色 4.67、合成只剩 3.39。
  // 透出量把合成顶出闸门时，做法是少透（蒙版往上顶），顶到完全不透还是不过才 null 回落。
  //
  // 混法按 sRGB 通道走，不是按线性光：RN/Android 的 alpha 混合就在 sRGB 编码值上做，
  // 线性混会把场算亮 4~6 个 L*（真机蓝封面夹具、锚点 32 蒙版 0.92 时线性 40.9 对 sRGB 36.5，差 4.5；
  // 白底亮封面夹具差 5.6；暗封面夹具几乎不差，因为蒙版只有 0.55）。
  // 这 4~6 个色阶不是白留的 —— 它是前景"灰"和"带色相的高亮"两档的全部空间：
  // 按线性混算时次级字色、图标色、强调色会一起被顶到接近白，层次塌成一片白。
  // 安全余量另有来源：参照物是 1/16 屏宽的块均色，比 blurRadius=90 糊完剩下的起伏更悲观。
  const fieldToneOf = (a: number) => Hct.fromInt(argbFromRgb(
    Math.round(a * redFromArgb(base) + (1 - a) * redFromArgb(highlightArgb)),
    Math.round(a * greenFromArgb(base) + (1 - a) * greenFromArgb(highlightArgb)),
    Math.round(a * blueFromArgb(base) + (1 - a) * blueFromArgb(highlightArgb)),
  ) >>> 0).tone
  // 在"两位小数"的格点上搜：渲染层拿到的就是这一格，证书也必须核这一格。
  // 早先是拿未取整的 alpha 过闸、再把 toFixed(2) 的值交出去，两者最多差 0.005 ——
  // 那 0.005 恰好是往"多透封面"的方向差，等于交出去的场比判过的场更亮一点。
  let scrimCenti = Math.round(scrimAlpha * 100)
  while (scrimCenti < SCRIM_MAX * 100 && Contrast.ratioOfTones(fieldToneOf(scrimCenti / 100), font.tone) < MIN_CONTRAST) {
    scrimCenti += 2
  }
  const scrim = Math.min(SCRIM_MAX, scrimCenti / 100)
  const fieldTone = fieldToneOf(scrim)
  if (Contrast.ratioOfTones(fieldTone, font.tone) < MIN_CONTRAST) return null

  // 带是纹理支的事：它算不出来（字色 tone 落在底色两侧都够不着闸门时）不该连带把纯色背景一起废掉。
  // 实测暗主题字色 rgb(219,219,219) 下三支夹具的带全塌，旧代码据此 return null —— 整个功能在暗主题静默不生效。
  const band = buildToneBand(Hct.from(source.hue, chroma, isDark ? TEXTURE_ANCHOR_TONE : LIGHT_ANCHOR_TONE).toInt() >>> 0, fontArgb)

  return { base: cssRgb(base), scrimAlpha: scrim, band, tint: { hue: source.hue, chroma }, fieldTone }
}
