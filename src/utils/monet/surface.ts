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

/** 背景是哪一档给的。定义在这里而不是 coverPalette.ts：配色层已经 import 这个文件，反过来就成环。
 *  ① monet：官方量化挑出的源色 + 洗色 + 蒙版；② blur：重度模糊的封面直接铺底，颜色跟着封面整体走。
 *  两档共用同一套 tone 锚点写法与对比度闸门，分岔只在"底色从哪来"。 */
export type CoverBackdropMode = 'monet' | 'blur'

/** ② 分两台布光：浏览台（歌曲页）亮、歌词台（读词）暗。两台共用同一支底色与糊封面，只差蒙版透出量 ——
 *  浏览台薄（闸门 BLUR_BROWSE_MIN_CONTRAST）、歌词台厚（BLUR_MIN_CONTRAST）。渲染层铺浏览台那一格，
 *  再叠一层 δ 蒙版从浏览台压回歌词台（见 CoverSurface.stageDimAlpha）。
 *  分台的可读性账：2026-10-18 两条线一度并平（浏览页那支淡白小字层并进了实白，δ 恒 0）；2026-10-19
 *  用户要"当前行与非当前行拉开"，歌词那两层被压到 0.49/0.44 的有效 α（见 onCoverTheme 的歌词梯队），
 *  只有更暗的场兜得住，两台就此分开（5.0 / 5.5）。浏览页没有这两层，能安全地保留亮一档的照片。 */
export type CoverStage = 'browse' | 'lyric'

export interface CoverSurface {
  /** 哪一档交出的这一支。渲染层与闸门都要靠它分岔：② 即使还没测量也要铺底（见 provisional）。 */
  mode: CoverBackdropMode
  /** 测量还没到手时的保守起点（spec §10.2"切换加载最短"）。真的色到位之后会被换成非 provisional 的那一支。 */
  provisional: boolean
  /** 铺底色，同时用作蒙版色：保证前景字色始终落在它这一侧 */
  base: string
  /** 歌词台（暗台）的蒙版总不透明度：闸门 BLUR_MIN_CONTRAST 的解，证书核的就是它。
   *  渲染层不直接铺这一格 —— 它铺 browseScrimAlpha，靠 stageDimAlpha 那一层补到这一格。 */
  scrimAlpha: number
  /** 浏览台（亮台）的蒙版：闸门 BLUR_BROWSE_MIN_CONTRAST 的解。恒 <= scrimAlpha（更松的线只会更薄）。 */
  browseScrimAlpha: number
  /** 从浏览台压回歌词台、再叠一层底色蒙版的不透明度 δ。渲染层把它挂在"跟随页面滑动的压暗层"上
   *  （δ × dim，dim 0=浏览台、1=歌词台）。恒等式在整数百分格上精确成立：
   *  1 - (1 - browseScrimAlpha)(1 - stageDimAlpha) === scrimAlpha。 */
  stageDimAlpha: number
  /** 纹理层可用的整数明度带：带内每一档对字色都 >= MIN_CONTRAST + BAND_HEADROOM。
   *  带顶在 TEXTURE_ANCHOR_TONE 上沿、只往下摆，所以不再包住 base（base 是纯色底，另按自己的锚点走）。
   *  只喂纹理支；纯色背景不依赖它，算不出来就是 null。② 恒为 null（那一档没有纹路可言）。 */
  band: ToneBand | null
  /** 纹理层的那"一套颜色"：莫奈式上色是同一支颜料摆明暗，不是把封面糊一下。
   *  色相取源色、彩度已按 CHROMA_CAP 夹过，封面只贡献明度结构（见 texture.ts 的 HUE_DEV）。
   *  ② 交的是彩度 0：那一档的颜色由糊封面自己提供，前景只剩白与灰，不再中途翻色相。 */
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

// 合成 ≈ scrim(base, a) 盖在模糊封面(最亮块) 上：偏离量 = (1 - a) * |块 tone - 底色 tone|
// 混法按 sRGB 通道走，不是按线性光：RN/Android 的 alpha 混合就在 sRGB 编码值上做，
// 线性混会把场算亮 4~6 个 L*（真机蓝封面夹具、锚点 32 蒙版 0.92 时线性 40.9 对 sRGB 36.5，差 4.5；
// 白底亮封面夹具差 5.6；暗封面夹具几乎不差，因为蒙版只有 0.55）。
// 这 4~6 个色阶不是白留的 —— 它是前景"灰"和"带色相的高亮"两档的全部空间：
// 按线性混算时次级字色、图标色、强调色会一起被顶到接近白，层次塌成一片白。
// 安全余量另有来源：参照物是 1/16 屏宽的块均色，比 blurRadius=90 糊完剩下的起伏更悲观。
//
// 两支（莫奈纯色底、模糊封面铺底）共用这两个函数：**闸门只许有一个定义**。
// 第二份混法就算今天数值一样，将来改一侧忘了另一侧，破线的那一档是没人拦的。
const mixFieldArgb = (baseArgb: number, highlightArgb: number, a: number) => argbFromRgb(
  Math.round(a * redFromArgb(baseArgb) + (1 - a) * redFromArgb(highlightArgb)),
  Math.round(a * greenFromArgb(baseArgb) + (1 - a) * greenFromArgb(highlightArgb)),
  Math.round(a * blueFromArgb(baseArgb) + (1 - a) * blueFromArgb(highlightArgb)),
) >>> 0

const fieldToneOf = (baseArgb: number, highlightArgb: number, a: number) => Hct.fromInt(mixFieldArgb(baseArgb, highlightArgb, a)).tone

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
  // 在"两位小数"的格点上搜：渲染层拿到的就是这一格，证书也必须核这一格。
  // 早先是拿未取整的 alpha 过闸、再把 toFixed(2) 的值交出去，两者最多差 0.005 ——
  // 那 0.005 恰好是往"多透封面"的方向差，等于交出去的场比判过的场更亮一点。
  let scrimCenti = Math.round(scrimAlpha * 100)
  while (scrimCenti < SCRIM_MAX * 100 && Contrast.ratioOfTones(fieldToneOf(base, highlightArgb, scrimCenti / 100), font.tone) < MIN_CONTRAST) {
    scrimCenti += 2
  }
  const scrim = Math.min(SCRIM_MAX, scrimCenti / 100)
  const fieldTone = fieldToneOf(base, highlightArgb, scrim)
  if (Contrast.ratioOfTones(fieldTone, font.tone) < MIN_CONTRAST) return null

  // 带是纹理支的事：它算不出来（字色 tone 落在底色两侧都够不着闸门时）不该连带把纯色背景一起废掉。
  // 实测暗主题字色 rgb(219,219,219) 下三支夹具的带全塌，旧代码据此 return null —— 整个功能在暗主题静默不生效。
  const band = buildToneBand(Hct.from(source.hue, chroma, isDark ? TEXTURE_ANCHOR_TONE : LIGHT_ANCHOR_TONE).toInt() >>> 0, fontArgb)

  return {
    mode: 'monet',
    provisional: false,
    base: cssRgb(base),
    scrimAlpha: scrim,
    // 莫奈支没有分台：一台布光，浏览页与歌词页共用同一个蒙版（δ=0 等于没有压暗层）
    browseScrimAlpha: scrim,
    stageDimAlpha: 0,
    band,
    tint: { hue: source.hue, chroma },
    fieldTone,
  }
}

/** ②的底色锚点。它**不是**亮度旋钮 —— 亮度归闸门钉；锚点决定的是"同样过闸时透多少照片"：
 *  底色越暗，越薄的蒙版就能把场压到线上，照片读得越清楚。
 *  §14.1 的六档扫描（.scratch/t107_grid.mts，四张真封面的整屏均值 L*）：
 *  锚点 20 → 26.0/29.3/33.6/29.6，28 → 28.9/32.5/35.0/32.2，32 → 31.3/34.4/36.1/34.0，36 → 35.4/37.0/37.4/36.5；
 *  同一趟量到的封面起伏 P95−P5 是 18.7/14.7/11.4/16.2 → 14.3/8.8/7.2/10.8 → 10.1/5.7/4.5/7.0 → 3.7/2.0/1.6/2.5。
 *  20 是 2026-10-18 重新选定的一格：用户圈定的那档小样（t85 的 9dp 列）就是"锚 20 + 闸门 4.5"解出来的
 *  （逐字段复现见 .scratch/t150_ship.mts），换到 5.0 那条线之后只从 α0.60 加厚到 α0.64，照片还是读得得出轮廓。
 *  同一闸门下的对照（.scratch/t154_gate_table.mts）：锚 20 → α0.40~0.64 场 L\*45.0~46.9，锚 28 → α0.44~0.72 场 L\*46.6~46.8，
 *  两档一样亮，但锚 28 每张多蒙 6~8 个百分点、起伏先塌掉。
 *  再往下（锚 16 之类）没有硬约束、只是没必要：闸门已经由 5.0 那条线管住亮度，锚点低到头照片就变成"底下一张黑卡"。
 *  代价写明（§14.4）：② 的底色比莫奈档（DARK_ANCHOR_TONE 32）暗 12 格、合成完的场反而亮得多，
 *  明度先后从来不是两档的分界；撑开两档的是糊半径（② 9dp + 1.25 外扩读得出照片轮廓，① 90dp 只剩大块色与纹路）。 */
export const BLUR_ANCHOR_TONE = 20
/** ②的"最少透出量"比莫奈的 SCRIM_MIN 更松：这一档要的就是看见封面。
 *  再松没收益（闸门常常就在这一档收手），再紧则暗封面也要蒙一层灰。 */
export const BLUR_SCRIM_MIN = 0.4
/** ②歌词台（读词那一面）的白字线。这一档的前景是一支不随背景变的白（`onCoverTheme.BLUR_INK`），连"小字层"
 *  都是实白 —— 亮度只能从这条线买：闸门每紧 0.5，模型场上限就低 2~3 个 L\*、蒙版厚 6~10 个百分点。
 *  2026-10-18 定在 5.0，那天的诉求是"背景太暗了"。2026-10-19 用户反馈"当前歌词与非当前歌词区分不明显"，
 *  拍板要最强烈的那一档落差（组件透明度 0.75 → 0.50，见 `onCoverTheme.BLUR_LYRIC_COMPONENT_OPACITY`），
 *  而压下去的那两层要的正是"场再暗一点"：同一套有效 α（0.49 / 0.44），5.0 上最坏封面只有 2.39 / 2.21，
 *  5.5 上是 2.52 / 2.31；实白（当前行、控件）自己也从 4.74 抬到 5.17。
 *  所以取 5.5 这一格（.scratch/t166_gap.mts 的闸门×透明度扫描表：5.5 → 场 L\*43.7~44.3、蒙版 α0.42~0.73）。
 *  为什么不高于 5.5：6.0 那一格场 L\*41.5~42.0、蒙版每张多压 6~11 个百分点，照片只剩大块色，
 *  换来的只是 0.12 的余量 —— 那是"把亮度还给平涂"的方向（用户 2026-10-18 否掉过更暗的 7.0）。
 *  代价写明：歌词那两层的下限从 3.0 掉到 2.3 一线（2026-10-19 的实测最坏值 2.52 / 2.31，
 *  逐张见 .scratch/t171_ship.mts），这是"更大的梯队落差"与"非当前行还够不够读"之间的交换，
 *  由用户 2026-10-19 在四档小样里选定了这一档。 */
export const BLUR_MIN_CONTRAST = 5.5

/** ② 浏览台（歌曲页）那一条闸门。两台共用同一支底色，只差蒙版；**2026-10-19 起两台不再同值**（5.0 / 5.5）。
 *  为什么这一页不回跟歌词台：这一页看的是封面照片本身，只有一档实白（标题/时间/控件/歌词预览都是那支白），
 *  没有第二层字色阶梯要摆 —— 把歌词页那一档落差买下来不必连歌曲页的照片一起压暗。
 *  两条线分开之后 `solveStages` 解出的歌词格比浏览格厚，δ = (歌词 − 浏览)/(100 − 浏览) > 0，
 *  CoverBackdrop 那层压暗层（stageDim × δ）第一次有了读者：滑向歌词页时背景连续压深，落定钉在歌词台那一格。
 *  这一条自己仍守着 5.0：它是为浏览页那支实白买的，读数与 2026-10-18 定稿时一致（场 ≤L\*46.9、实白 ≥4.74）。 */
export const BLUR_BROWSE_MIN_CONTRAST = 5.0

/** ②只要这两个测量值：那一档不用官方量化挑出来的源色，颜色由封面整体与照片自己给。 */
export interface BlurMeasure {
  averageArgb: number
  highlightArgb: number
}

/** 解一条闸门线下的蒙版整数百分位：从这一档自己的"最少透出量"起，一直加到合成场过线为止。
 *  ② 的两台（浏览/歌词）只是线与下限不同，步进同一个定义 —— 各写一份循环迟早会分岔。 */
const solveScrimCenti = (base: number, highlightArgb: number, fontTone: number, gate: number, floor: number) => {
  let centi = Math.round(floor * 100)
  while (centi < SCRIM_MAX * 100 && Contrast.ratioOfTones(fieldToneOf(base, highlightArgb, centi / 100), fontTone) < gate) {
    centi += 1
  }
  return centi
}

/** ② 的"两台蒙版"解算：同一支底色上按两条线各解一格，折成渲染层要的三格。
 *  只留一支定义的原因是 δ 那条恒等式 —— 1-(1-浏览)(1-δ)=歌词 在整数百分格上精确成立，
 *  分两处写就有两份"精确"，而破线的那一格是没人拦的。
 *  解不出（加到全遮还过不了歌词台那条线）交 null，由调用方回落到保守底。 */
const solveStages = (base: number, highlightArgb: number, fontTone: number, floor: number) => {
  const centiMax = SCRIM_MAX * 100
  const lyricCenti = solveScrimCenti(base, highlightArgb, fontTone, BLUR_MIN_CONTRAST, floor)
  const scrimAlpha = Math.min(SCRIM_MAX, lyricCenti / 100)
  const fieldTone = fieldToneOf(base, highlightArgb, scrimAlpha)
  if (Contrast.ratioOfTones(fieldTone, fontTone) < BLUR_MIN_CONTRAST) return null
  const browseCenti = solveScrimCenti(base, highlightArgb, fontTone, BLUR_BROWSE_MIN_CONTRAST, floor)
  const browseScrimAlpha = Math.min(SCRIM_MAX, browseCenti / 100)
  // δ 由两格的整数百分位直接解，渲染层拿到的就是同一个数（见上面那条恒等式）。
  // 浏览台已是全遮（两格并成 100）时 δ=0，不叠空层。
  const stageDimAlpha = browseCenti >= centiMax ? 0 : (lyricCenti - browseCenti) / (centiMax - browseCenti)
  return { scrimAlpha, browseScrimAlpha, stageDimAlpha, fieldTone }
}

/**
 * 「动态取色」= 重度模糊封面固定铺底那一档的蒙版。
 * 与莫奈支的三点区别：底色锚得更低、透出量从更松的地方起步、前景没有色相可跟（tint 彩度 0）。
 * 混法用的是模块级那两个函数，与莫奈支同一个定义 —— 一支改混法另一支也跑不掉；
 * 闸门线是这一档自己的：歌词台 BLUR_MIN_CONTRAST、浏览台 BLUR_BROWSE_MIN_CONTRAST。
 * 两条线在同一支底色上各解一格 —— 浏览台那格只会更薄（更松的线停得更早），差值折成 stageDimAlpha。
 */
export const buildBlurSurface = (measure: BlurMeasure | null, fontArgb: number): CoverSurface | null => {
  if (measure == null) return null
  const { averageArgb, highlightArgb } = measure
  if (!isUsableArgb(fontArgb) || !isUsableArgb(averageArgb) || !isUsableArgb(highlightArgb)) return null

  const font = Hct.fromInt(fontArgb)
  const coverAvg = Hct.fromInt(averageArgb)
  const isDark = font.tone > 50
  // 彩度直接跟封面整体走、只夹一个上限：这一档不做"洗色"，蒙版的作用是把照片压到字色能站住。
  const chroma = Math.min(coverAvg.chroma, CHROMA_CAP)
  const anchor = isDark ? BLUR_ANCHOR_TONE : 100 - BLUR_ANCHOR_TONE
  const base = Hct.from(coverAvg.hue, chroma, anchor).toInt() >>> 0
  // 夹完 sRGB 色域读回来的才是真铺出来的那一层，判断以它为准（同 §7.4：够不到就 null，不跨侧硬凑）
  const baseTone = Hct.fromInt(base).tone
  if (Contrast.ratioOfTones(baseTone, font.tone) < MIN_CONTRAST) return null

  const stages = solveStages(base, highlightArgb, font.tone, BLUR_SCRIM_MIN)
  if (stages == null) return null

  return {
    mode: 'blur',
    provisional: false,
    base: cssRgb(base),
    ...stages,
    band: null,
    tint: { hue: coverAvg.hue, chroma: 0 },
  }
}

// 测量还没到手时先铺的那一支：完全不透的中性深色。保守到"对任意封面都过闸"只有全遮这一个解
// —— 糊完的最亮块可能接近纯白，白字要对它过 4.5，任何透出量都不敢留。
// 两台同值（都是全遮、δ=0）：测量还没到手就分不出"浏览台该透多少"，分台只发生在测量色那一支上。
// 之所以是常量而不是函数：store 的 isSame 按引用比 surface，每帧造一份会把订阅子树白刷一遍。
const PROVISIONAL_BASE = Hct.from(0, 0, 8).toInt() >>> 0

export const PROVISIONAL_BLUR_SURFACE: CoverSurface = {
  mode: 'blur',
  provisional: true,
  base: cssRgb(PROVISIONAL_BASE),
  scrimAlpha: SCRIM_MAX,
  browseScrimAlpha: SCRIM_MAX,
  stageDimAlpha: 0,
  band: null,
  tint: { hue: 0, chroma: 0 },
  fieldTone: Hct.fromInt(PROVISIONAL_BASE).tone,
}
