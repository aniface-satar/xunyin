/**
 * 壁纸模式（自定义图片背景开启时）的通用配色。
 *
 * 为什么不做"按图片明暗自动挑字色"：任意一张照片上都会同时有亮处和暗处，按平均值挑一支
 * 必然在另一半上失效。所以这里不替图做决定，只提供整棵树共用的一支墨，由用户按自己这一张图挑：
 *
 *   1. **一支墨**（字 / 图标 / 线 / 按钮都用它），用一条 alpha 阶梯拉开层次（c-000 → c-1000 换成墨 @0.20 → 1.00）；
 *   2. **两层可调的柔光**（PageContent 铺）：压暗层（WALLPAPER_SCRIM）与提亮层（WALLPAPER_SCRIM_LIGHT），
 *      深度各自存在每张背景的条目里（`veilDark` / `veilLight`），**同时生效、可以叠加** ——
 *      一压一提的组合就是"雾面 / 胶片感"（阴影被抬起、高光被压下），这是编辑器语义；
 *   3. **文字阴影**（就是 theme.fontShadow 那条）。
 *
 * 三件事各管一段：柔光把照片拉到"墨够读"的那一档（全局对比度），阴影兜住局部（笔画边缘的对比度），
 * 墨色负责字本身。任何一张图都落在这三段里。
 *
 * 墨不再只有白/黑两支：每个背景条目各自存一个颜色（`CustomBgItem.ink`），编辑页给的是
 * `WALLPAPER_INK_BASES` 那 14 支基础色加一条"由白到鲜"的滑杆 —— 滑杆从白（0）线性推到
 * 基础色本色（100%），一支基础色摊开一整条浅调，占的地方小，鲜色反而管够。
 * 整棵树的灰阶阶梯、分割线、
 * 按钮、图标、进度条**全部由这一支颜色派生**（见 buildOverrides），所以换一次颜色是整棵树一起换。
 *
 * 柔光与墨是**解绑**的：两支柔光底色是常量、永远同时可用，任何一个墨色配两个方向都成立。
 * 墨自己的亮度（`isDarkWallpaperInk`）只剩两个职责 —— 决定 isDark（状态栏图标的明暗）
 * 与文字阴影要不要描边，不再替用户决定"该往哪边压"。
 *
 * 面（c-content-background / c-main-background）在这里变成全透明 —— 壁纸要真的落在所有面板下面。
 * 这是壁纸模式本身的取舍：面板那一层层次没了，改由柔光 + 阴影补。
 *
 * 这个模块不许 import react-native / store / core：`buildActiveThemeColors` 在启动最早那一步
 * 同步调它，那边连 storage 都还没准备好。
 */

/** 墨：任意 CSS 颜色串（'white' / 'black' / '#RRGGBB' / 'rgb(...)'）。 */
export type WallpaperInk = string

/** rgb（0~255 三元组）→ HSL（h 0~360 / s、l 0~1）。把存档墨色归位到基础色时用 */
const rgbToHsl = (rgb: number[]): [number, number, number] => {
  const [r, g, b] = rgb.map((value) => value / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const light = (max + min) / 2
  if (max === min) return [0, 0, light]
  const d = max - min
  const sat = light > 0.5 ? d / (2 - max - min) : d / (max + min)
  let hue: number
  if (max === r) hue = (g - b) / d + (g < b ? 6 : 0)
  else if (max === g) hue = (b - r) / d + 2
  else hue = (r - g) / d + 4
  return [hue * 60, sat, light]
}

const INK_LIGHT_RGB = [255, 255, 255]
const INK_DARK_RGB = [20, 20, 24]

const hexRxp = /^#([0-9a-f]{3}|[0-9a-f]{6})$/
const rgbRxp = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/

/**
 * 设置/条目里存的东西可能是任何历史值与任何写法：`'white'`、`'black'`（老存档的两个字面量）、
 * `'#141418'`、`'rgb(20,20,24)'`、`'rgba(...)'`。统一解析成 RGB 三元组，认不出来的一律当白墨。
 */
const parseInk = (value: unknown): number[] | null => {
  if (typeof value !== 'string') return null
  const text = value.trim().toLowerCase()
  // 老存档的两个字面量：'black' 当时指的是近黑，不是纯黑 —— 升级后观感不该变
  if (text === 'white') return [...INK_LIGHT_RGB]
  if (text === 'black') return [...INK_DARK_RGB]
  const hex = hexRxp.exec(text)
  if (hex) {
    const raw = hex[1].length === 3
      ? hex[1].split('').map((char) => char + char).join('')
      : hex[1]
    return [0, 2, 4].map((index) => parseInt(raw.slice(index, index + 2), 16))
  }
  const matched = rgbRxp.exec(text)
  if (!matched) return null
  return [Number(matched[1]), Number(matched[2]), Number(matched[3])]
}

const toRgb = (css: string) => parseInk(css)

/**
 * 消色差判定线：饱和度低于它的存档色一律按"白 / 灰 / 近黑"就近归支。
 * 老网格的整条灰阶（连 #141418 那一点蓝味都算上）都落在这条线内。
 */
const ACHROMATIC_SATURATION = 0.15

/**
 * 基础色：白 / 灰 / 近黑 + 11 个色相（红 橙 黄 黄绿 绿 青 天蓝 蓝 紫 洋红 粉），
 * 首支白与近黑支同 WALLPAPER_INK / WALLPAPER_INK_DARK —— 老存档与默认值在这盘里都有落点。
 *
 * 彩色支的饱和度全给到位（≥ 0.65）、明度按各色相的舒服档手工挑：滑杆往左推的浅调
 * 全部交给"向白混合"现算，盘里只存最鲜的那一档。
 */
const WALLPAPER_INK_BASE_COLORS = [
  '#FFFFFF', '#8E8E98', '#141418',
  '#E5484D', '#F76B15', '#F5D90A', '#84D944', '#22C55E',
  '#00BBA7', '#0091FF', '#3E63DD', '#A855F7', '#D6409F', '#EC4899',
] as const

export interface WallpaperInkBase {
  /** 存档 / 选中态用的颜色串（hex，大写） */
  readonly color: string
  /** 解析好的 RGB 三元组：从白到这支的逐通道线性混合就是"由白到鲜"的轨迹 */
  readonly rgb: number[]
  /** HSL 三件套从颜色串现算：色相用于归列，明度用于反推滑杆比例 */
  readonly hue: number
  readonly sat: number
  readonly light: number
  /** 消色差支（白 / 灰 / 近黑）：归列时按明度就近，不参与色相比对 */
  readonly achromatic: boolean
}

export const WALLPAPER_INK_BASES: ReadonlyArray<WallpaperInkBase> =
  WALLPAPER_INK_BASE_COLORS.map((color) => {
    const rgb = parseInk(color) ?? INK_LIGHT_RGB
    const [hue, sat, light] = rgbToHsl(rgb)
    return { color, rgb, hue, sat, light, achromatic: sat < ACHROMATIC_SATURATION }
  })

/**
 * 基础色 + 滑杆比例（0~1）→ 实际墨色：**由白到鲜**。
 *
 * 0 是纯白、1 逐字节回到基础色本色，中间是向白线性混合的浅调 —— 这比"降饱和"直觉：
 * 拖出来的每一步都是"这支色掺了多少白"，浅调不发灰、不发闷。三支消色差基础色
 * 同样适用（灰支是白→灰、近黑支是白→近黑的明度带，白支恒为白）。
 */
export const wallpaperInkFromBase = (base: WallpaperInkBase, ratio: number) => {
  const r = Math.min(1, Math.max(0, Number(ratio) || 0))
  const channel = (to: number) => {
    const value = Math.round(255 + (to - 255) * r)
    return value.toString(16).padStart(2, '0')
  }
  return `#${channel(base.rgb[0])}${channel(base.rgb[1])}${channel(base.rgb[2])}`.toUpperCase()
}

/**
 * 把任何存档墨色归位到「基础色 + 滑杆比例」（编辑页重开一张旧背景时靠它回填游标）。
 *
 * 消色差（老网格的整条灰阶、近黑、白）按明度就近归到白 / 灰 / 近黑；彩色按色相就近归列。
 * 比例从明度反推：向白混合是逐通道线性混合，明度沿这条线线性走
 * （l = 1 − r(1 − l_base)），8bit 取整带来的误差不到 1%，用户几乎无感。
 * 旧存档里比基础色更深的颜色按满档收 —— 反正重编辑页里一切可见，拖一下就归位。
 */
export const matchWallpaperInkBase = (value: unknown): { base: WallpaperInkBase, ratio: number } => {
  const rgb = parseInk(value) ?? INK_LIGHT_RGB
  const [hue, sat, light] = rgbToHsl(rgb)
  let best = WALLPAPER_INK_BASES[0]
  let bestDist = Number.POSITIVE_INFINITY
  if (sat < ACHROMATIC_SATURATION) {
    for (const base of WALLPAPER_INK_BASES) {
      if (!base.achromatic) continue
      const dist = Math.abs(light - base.light)
      if (dist < bestDist) {
        best = base
        bestDist = dist
      }
    }
  } else {
    for (const base of WALLPAPER_INK_BASES) {
      if (base.achromatic) continue
      const d = Math.abs(hue - base.hue) % 360
      const dist = d > 180 ? 360 - d : d
      if (dist < bestDist) {
        best = base
        bestDist = dist
      }
    }
  }
  if (best.light >= 0.999) return { base: best, ratio: 1 }
  return { base: best, ratio: Math.min(1, Math.max(0, (1 - light) / (1 - best.light))) }
}

/**
 * 柔光的底色（深墨那套）：带一点点蓝的近黑。纯黑在 OLED 上会糊成一块死黑，照片的暗部会整片消失。
 */
export const WALLPAPER_SCRIM = 'rgb(10, 10, 12)'

/**
 * 柔光的底色（浅墨那套）：同样不是纯白，留 3% 的灰。
 * 纯白会把照片的高光整片烧平（云、天空、白墙全变成同一块），这一点灰正好保住亮部的层次。
 */
export const WALLPAPER_SCRIM_LIGHT = 'rgb(247, 247, 249)'

/** 白色墨（默认，也是色板第一格）。 */
export const WALLPAPER_INK = 'rgb(255, 255, 255)'

/**
 * 近黑墨：色板里那一格深色，也是老存档里 `'black'` 的落点。
 *
 * 纯黑压在照片上笔画会显得"硬"，边缘的抗锯齿过渡也更容易看出发毛；20/20/24 这一档
 * 对纸面仍有 16:1 以上的对比，视觉上就是黑的，只是没那么刺。这也是需求里说的"近黑（次色）"：
 * 主字用它，次级字/线/图标走同一支的 alpha 阶梯。
 */
export const WALLPAPER_INK_DARK = 'rgb(20, 20, 24)'

/**
 * 柔光强度（每个字面不同）：0 ~ 0.85。
 *
 * 浅墨 0.55 是照"最坏那张图"定的：纯白照片压 0.55 之后场约 L*46，白字压在上面 4.6:1，
 * 正好过正文那条 4.5 的线（0.45 只有 3.2，0.60 有 5.3）。
 * 深墨反过来 —— 白纱盖 0.55 之后同样落在近白的场，近黑字对它有 15:1 以上。
 * 所以同一条滑块在两个方向下都是"往上调 = 更好读、往下调 = 多看一点图"。
 */
export const DEFAULT_WALLPAPER_VEIL = 0.55
export const MAX_WALLPAPER_VEIL = 0.85

export const clampWallpaperVeil = (value: unknown) => {
  const num = Number(value)
  if (!Number.isFinite(num)) return DEFAULT_WALLPAPER_VEIL
  return Math.min(MAX_WALLPAPER_VEIL, Math.max(0, num))
}

/** 壁纸模式下页面/歌词那层统一的透明度：它乘在颜料自己的 alpha 上，用来把非当前行压下去 */
export const WALLPAPER_LYRIC_OPACITY = 0.72

const WHITE_RGB = [255, 255, 255]
const BLACK_RGB = [0, 0, 0]

const mix = (from: number[], to: number[], ratio: number) =>
  from.map((value, index) => Math.round(value + (to[index] - value) * ratio))

const css = (rgb: number[], alpha: number) =>
  alpha >= 1
    ? `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`
    : `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha.toFixed(2)})`

/** 相对亮度（WCAG）。只用来判"这支墨偏深还是偏浅"，决定场该压暗还是提亮 */
const luminance = (rgb: number[]) => {
  const [r, g, b] = rgb.map((value) => {
    const channel = value / 255
    return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const isDarkInk = (rgb: number[]) => luminance(rgb) < 0.5

/** 收口：任何输入都变成一支 `rgb(r, g, b)`，认不出来就是白 */
export const normalizeWallpaperInk = (value: unknown): WallpaperInk =>
  css(parseInk(value) ?? INK_LIGHT_RGB, 1)

/**
 * 这支墨偏深吗？决定柔光方向与状态栏图标的明暗。
 *
 * 0.5 这条线落在中灰附近：右边（浅墨）压暗场，左边（深墨）提亮场。
 * 色板里的近黑、藏青、墨绿在左边，白、米白、浅灰、黄在右边 —— 这正是它们各自的用法。
 */
export const isDarkWallpaperInk = (value: unknown) => isDarkInk(parseInk(value) ?? INK_LIGHT_RGB)

/** 与 normalizeWallpaperInk 同一件事，留着这个名字给"把设置值还原成颜色"的调用点读得顺 */
export const wallpaperInkColor = normalizeWallpaperInk

/**
 * 同一支墨的 alpha 变体。
 *
 * 主题里那条阶梯（c-000 ~ c-1000）是"给全 App 用的"，而编辑页的整页样张要自己画一套
 * 假界面（标题、分割线、卡片底），它得跟真机同一支颜色、同一条轻重关系 —— 用这个函数现取，
 * 不用为了几个临时图层去主题里加键（加进去也没人读）。
 */
export const wallpaperInkAlpha = (value: unknown, alpha: number) =>
  css(parseInk(value) ?? INK_LIGHT_RGB, alpha)

/**
 * 两层柔光并存时的「主导方向」。
 *
 * 页面上压暗层与提亮层各铺各的、同时生效；但有些地方只需要**一支**底色 ——
 * 弹层玻璃、加载遮罩、没铺图的播控场。这些地方按"哪层开得更深"取方向：
 * 纯用一层时（绝大多数图）它就是原来的方向，两层都开着时取主调，
 * 剩下那层只贡献一点反向的呼吸感，不会把玻璃面推到中间灰。
 */
export const dominantWallpaperScrim = (veilDark: unknown, veilLight: unknown) => {
  const dark = Number(veilDark)
  const light = Number(veilLight)
  return Number.isFinite(light) && light > (Number.isFinite(dark) ? dark : 0)
    ? WALLPAPER_SCRIM_LIGHT
    : WALLPAPER_SCRIM
}

/**
 * 歌词页那一档（壁纸模式专用）。
 *
 * 为什么不能沿用主题的灰阶：壁纸模式把 c-000~c-1000 整条换成"墨 @0.20~1.00"，
 * 非当前行读的 `c-350` 落在 0.48、译文 `c-300` 落在 0.44，再乘页面上那层 0.72，
 * 屏上只剩 0.35 / 0.32 —— 对最坏的场只有 2 出头。所以歌词页自己带一档：
 *
 * 取值：颜料 × 页面 opacity 0.72。
 *   - 正文 0.98 → 屏上 0.706
 *   - 译文 0.74 → 屏上 0.533
 * 当前行是满墨（c-primary = 墨本身，alpha 1.00），所以"非当前行明显比当前行淡、
 * 又仍然读得清"这两件事同时成立。
 *
 * 入参给的是**墨色**（theme['wallpaper-ink']）而不是模式：描边用黑还是白、要不要描边
 * 全由墨自己的亮度决定。
 */
export interface WallpaperLyricPalette {
  ink: string
  translation: string
  opacity: number
  activeShadow: {
    color: string
    offset: { width: number, height: number }
    radius: number
  }
}

export const getWallpaperLyricPalette = (inkColor: string): WallpaperLyricPalette => {
  // 非壁纸模式下主题上没有这一支（`wallpaper-ink` 只在 buildWallpaperTheme 里写），
  // 而调用方是按 hook 规则无条件算的 —— 拿不到就按白墨算，绝不会抛
  const base = (typeof inkColor === 'string' ? toRgb(inkColor) : null) ?? INK_LIGHT_RGB
  const dark = isDarkInk(base)
  return {
    ink: css(base, 0.98),
    translation: css(base, 0.74),
    opacity: WALLPAPER_LYRIC_OPACITY,
    // 当前行是满墨、色值已经到顶，想再"加深"只剩笔画外沿那一圈反色。
    //
    // 但深墨那套**不描边**：浅色柔光已经把场提亮到近白，再套一圈白环，笔画边缘会糊成
    // "发光的字"，近黑字反而变虚。深墨的层级只靠 alpha（当前行 1.00 vs 非当前行 0.706）拉开，
    // 这一档差距本身就够。
    activeShadow: {
      color: dark ? 'transparent' : 'rgba(0, 0, 0, 0.90)',
      offset: { width: 0.5, height: 0.6 },
      radius: 3.5,
    },
  }
}

/**
 * 灰阶阶梯：c-000 ~ c-1000。
 *
 * 这条阶梯在主题里的语义是**"与底色的对比度"**，不是"明度"：亮色主题里 1000 最深（近黑），
 * 暗色主题里 1000 最亮（近白）—— 两头都是"最跳"的那一档。所以换成"墨 @alpha"时不用分亮暗主题，
 * 直接把序号当强度用，任何一支墨、两套主题同一条映射都是对的。
 *
 * 系数 0.20 + 0.04i：c-000 落在 0.20（几乎只是底噪），c-450（次级说明文字）0.56，
 * c-850（主文字）0.88，c-1000 满墨。
 */
const RAMP_KEYS = [
  'c-000', 'c-050', 'c-100', 'c-150', 'c-200', 'c-250', 'c-300', 'c-350', 'c-400',
  'c-450', 'c-500', 'c-550', 'c-600', 'c-650', 'c-700', 'c-750', 'c-800', 'c-850',
  'c-900', 'c-950', 'c-1000',
] as const

/**
 * 把主题的 `c-primary-light-*` / `c-primary-dark-*` 两族按"场"的方向重算。
 *
 * 这两族的命名语义同样是"相对底色"：`light-N` 往底色里退，`dark-N` 从底色里跳出来。
 * 壁纸模式把底从"纸面"换成了"照片 + 柔光"，方向取决于墨色，所以两族各自朝哪边走要传进来：
 *
 *   浅墨（场是暗的）：light-N → 主色往**黑**走，dark-N → 主色往**白**走；
 *   深墨（场是亮的）：light-N → 主色往**白**走，dark-N → 主色往**黑**走（就是普通亮色主题的样子）。
 *
 * 走错方向会怎样：Dialog 的头部条 `c-primary-light-100-alpha-100` 是一块底板，而壁纸模式下
 * 标题字色是当前那支墨 —— 面朝黑走而字也黑，就是一整条黑底黑字（浅墨那套则是白底白字）。
 * 这类"浅色键当底色"的地方遍布弹层与列表头，一个个改不可能改全，只能在这一层整族翻。
 *
 * alpha 命名是反的（alpha-900 = 0.10），照主题自己的规矩来。
 */
const buildPrimaryFamilies = (primary: unknown, lightTowards: number[], darkTowards: number[]) => {
  const base = typeof primary == 'string' ? toRgb(primary) : null
  const families: Record<string, string> = {}
  if (base == null) return families

  for (let step = 1; step <= 10; step++) {
    const n = step * 100
    const raised = mix(base, darkTowards, step / 10)
    const sunk = mix(base, lightTowards, step / 10)
    families[`c-primary-dark-${n}`] = css(raised, 1)
    families[`c-primary-light-${n}`] = css(sunk, 1)
    for (let alphaStep = 1; alphaStep <= 9; alphaStep++) {
      const alpha = (1000 - alphaStep * 100) / 1000
      families[`c-primary-dark-${n}-alpha-${alphaStep * 100}`] = css(raised, alpha)
      families[`c-primary-light-${n}-alpha-${alphaStep * 100}`] = css(sunk, alpha)
    }
  }
  return families
}

/**
 * 强调色抽成墨的那一族。
 *
 * 只要壁纸模式在生效，这一族就恒为当前那支墨 —— 与"图有没有铺到播控页"（applyToPlayer / 播控页背景）
 * 无关。这个"无关"是刻意的：applyToPlayer 是播控页的一个可选项，它一变就整棵树重拼主题，
 * 若强调色还挂在它身上，用户每切一次播控页背景，整个 App（首页、设置页、列表选中态、图标）
 * 的强调色就跟着翻一次 —— 一个播放页的选项去改主界面的配色，读起来像 bug。
 *
 * 除了这条一致性，墨本身还有两条理由：**照片是不可预测的，而强调色是主题自带的一支彩色**。
 * 绿主题压上一张草地、橙主题压上一张落日，撞成同色系就是一整片看不出对比的颜色；墨永远不会
 * 跟图撞成那样（用户是照着这张图挑的），而且它跟这里其它字色是同一支，一眼看过去是一家人。
 *
 * 只抽"强调色自己"这三支：c-primary、它的 alpha 族、以及 dark 族（壁纸模式下 dark = 从场里跳出来的那一侧）。
 * light 族不动 —— 它在这一层是"面"，由 buildPrimaryFamilies 按场的明暗算好。
 */
const buildInkAccentFamilies = (inkBase: number[], darkTowards: number[]) => {
  const families: Record<string, string> = {
    'c-primary': css(inkBase, 1),
  }
  // buildPrimaryFamilies 不产 c-primary 自己那支 alpha 族，这里补上（命名同样是反的）
  for (let alphaStep = 1; alphaStep <= 9; alphaStep++) {
    families[`c-primary-alpha-${alphaStep * 100}`] = css(inkBase, (1000 - alphaStep * 100) / 1000)
  }
  const raised = buildPrimaryFamilies(css(inkBase, 1), darkTowards, darkTowards)
  for (const [key, value] of Object.entries(raised)) {
    if (key.includes('-light-')) continue
    families[key] = value
  }
  return families
}

const buildOverrides = (inkBase: number[], dark: boolean) => {
  const ink = (alpha: number) => css(inkBase, alpha)
  // 文字阴影（Text / Icon 共用的那一条）。
  //
  // 浅墨配实黑描边：白字压在照片的高光上有时候只剩 1.5:1，那圈黑边是把它救回来的东西。
  // 深墨**不描边**：浅色柔光已经把场提到近白，再套一圈白环只会让笔画发虚、边缘发毛 ——
  // 这正是"黑色字有白色描边"那个观感的来源，去掉。
  const shadow = dark ? 'transparent' : 'rgba(0, 0, 0, 0.65)'

  const colors: Record<string, string> = {
    // 面：全透明。壁纸要真的落到所有面板下面，不能被任何一层不透明的同色壳子挡住
    'c-content-background': 'transparent',
    'c-main-background': 'transparent',

    // 字：只有墨这一套。层次靠上面那条阶梯与下面的阴影
    'c-font': ink(1),
    'c-font-label': ink(0.78),
    'c-primary-font': ink(1),
    'c-primary-font-hover': ink(0.90),
    'c-primary-font-active': ink(0.86),
    'c-button-font': ink(0.92),
    'c-button-font-selected': ink(1),

    // 线：墨色的细线才在照片上看得见（分割线、列表头那条）
    'c-border-background': ink(0.18),
    'c-list-header-border-bottom': ink(0.12),

    // 浅色块 → 墨色玻璃。主题那支"浅色淡彩"压在照片上是一块脏色，且墨字在上面对比不足；
    // 深墨那套同样走这条：墨 @0.14 压在浅场上就是一块淡灰玻璃，不会变成"白底黑字"的实心块
    'c-primary-background': ink(0.14),
    'c-primary-background-hover': ink(0.20),
    'c-primary-background-active': ink(0.26),
    'c-primary-input-background': ink(0.12),
    'c-button-background': ink(0.16),
    'c-button-background-hover': ink(0.22),
    'c-button-background-active': ink(0.28),
    // 碟片垫（PlayDetail / PlayerOverlay）：整族反转之后它是一块近乎不透明的面板，
    // 压在照片上会糊成一大块；这里单独改成薄玻璃，碟片轮廓才立得住
    'c-primary-light-900-alpha-200': ink(0.10),

    // 进度条：主题把这几支放在**浅**族里（主色往场的方向走 10~40%），在亮色主题里是一条淡彩槽。
    // 壁纸模式下拿它画进度条就会变成"照片上的一条暗（或亮）色彩槽"，一眼看过去还是主题色。
    // 这里只换颜料、不动阶梯：alpha 全部沿用主题自己的取值，"槽 < 缓冲 < 已播 < 圆点"一字未改。
    'c-primary-light-300-alpha-800': ink(0.20), // 槽（ProgressBar.DefaultBar）
    'c-primary-light-400-alpha-700': ink(0.30), // 缓冲
    'c-primary-light-100-alpha-400': ink(0.60), // 已播
    'c-primary-light-100-alpha-600': ink(0.40), // 拖拽时的目标段
    'c-primary-light-100-alpha-700': ink(0.30), // 拖拽时的已播段 / 竖屏分页指示器
    'c-primary-light-100-alpha-800': ink(0.20), // 横屏播放页（Progress.tsx）的拖拽目标段
    'c-primary-light-200-alpha-900': ink(0.10), // 横屏播放页的拖拽已播段
    'c-primary-light-600-alpha-900': ink(0.10), // 横屏播放页的缓冲
    'c-primary-light-100': ink(1), // 拖拽圆点

    // 文字阴影：Text / Icon 共用。深墨是 transparent（见上面那段），浅墨是实黑
    'c-primary-dark-300-alpha-800': shadow,
  }

  RAMP_KEYS.forEach((key, index) => {
    colors[key] = ink(0.20 + 0.04 * index)
  })

  return colors
}

// 每一支墨各算一次就够：buildActiveThemeColors 会在换图 / 切主题时反复调它，
// 而基础色 × 滑杆能拼出的颜色散得很开，缓存按解析后的颜色串存
const overridesCache = new Map<string, Record<string, string>>()
const getOverrides = (inkColor: string, inkBase: number[], dark: boolean) => {
  let colors = overridesCache.get(inkColor)
  if (colors == null) {
    colors = buildOverrides(inkBase, dark)
    overridesCache.set(inkColor, colors)
  }
  return colors
}

/**
 * 把主题换成壁纸模式那一套。
 *
 * 顺序：先按场的方向重算 primary 色阶（它要覆盖 110 个键，只能算），再盖上"墨"那族，
 * 最后是手工挑的那批（逐处核过的，包括碟片垫与阴影色，必须赢）。
 *
 * 任何一支颜色都走同一段算法：给出它的 RGB，`isDarkWallpaperInk` 决定场往哪边走，
 * 其余推导逐字相同。加色板里的新颜色不需要改这里。
 *
 * `isDark` 跟着墨走：浅墨那套场恒为深色（状态栏图标用亮的），深墨那套反过来。
 * components/common/StatusBar.tsx 读 context 里这个布尔，翻它一个就把图标带对了。
 *
 * 墨本身也挂回主题（`wallpaper-ink`）：Dialog 标题、选择器的箭头、歌词页都要取这支，
 * 而它不是"主题色阶"能推出来的东西。柔光的底色不在这里 —— 两层柔光的颜色是常量
 * （WALLPAPER_SCRIM / WALLPAPER_SCRIM_LIGHT），深度跟每张背景走，与墨无关。
 */
export const buildWallpaperTheme = <T extends object>(base: T, ink: WallpaperInk = 'white'): T => {
  const inkColor = normalizeWallpaperInk(ink)
  const inkBase = toRgb(inkColor) ?? INK_LIGHT_RGB
  const dark = isDarkInk(inkBase)
  // 场往哪边走：浅墨的场是暗的（面往黑），深墨的场是亮的（面往白）
  const surfaceTowards = dark ? WHITE_RGB : BLACK_RGB
  const inkTowards = dark ? BLACK_RGB : WHITE_RGB

  // ActiveTheme 上的键既有 string 也有 boolean（isDark / is-wallpaper），按 unknown 读写、只动字符串键
  const next: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  next.isDark = !dark
  next['is-wallpaper'] = true
  next['wallpaper-ink'] = inkColor

  const overrides = {
    ...buildPrimaryFamilies(next['c-primary'], surfaceTowards, inkTowards),
    ...buildInkAccentFamilies(inkBase, inkTowards),
    ...getOverrides(inkColor, inkBase, dark),
  }
  for (const [key, value] of Object.entries(overrides)) {
    // 主题里没有这个键就跳过，不凭空造键：造出来的键没人读，只会让 theme 对象越来越像垃圾场
    if (typeof next[key] !== 'string') continue
    next[key] = value
  }
  return next as T
}
