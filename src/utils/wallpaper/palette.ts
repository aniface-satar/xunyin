/**
 * 壁纸模式（自定义图片背景开启时）的通用配色。
 *
 * 为什么不再"按图片明暗挑两套字"：任意一张照片上，深字和浅字都会各自找到失效的那半 ——
 * 亮图下浅字化掉、暗图下深字化掉，用户换一张图就换了一种失效方式。所以这里只给一套：
 *
 *   1. **白字**，用一条 alpha 阶梯拉开层次（c-000 → c-1000 换成白 @0.20 → 1.00）；
 *   2. **一层可调的深色柔光**（PageContent 铺，数值在设置里，见 WALLPAPER_SCRIM）；
 *   3. **强制打开文字阴影**（就是 theme.fontShadow 那条，这里把颜色换成实黑）。
 *
 * 三件事各管一段：柔光把"照片最亮的地方"压到足够暗（全局对比度），阴影兜住局部高光
 * （笔画边缘的对比度），白字负责"压暗之后仍然够亮"。任何一张图都落在这三段里，
 * 不需要为每张图单独调色。
 *
 * 面（c-content-background / c-main-background）在这里变成全透明 —— 壁纸要真的落在所有面板下面。
 * 这是壁纸模式本身的取舍：面板那一层层次没了，改由柔光 + 阴影补。
 *
 * 这个模块不许 import react-native / store / core：`buildActiveThemeColors` 在启动最早那一步
 * 同步调它，那边连 storage 都还没准备好。
 */

/** 柔光的底色：带一点点蓝的近黑。纯黑在 OLED 上会糊成一块死黑，照片的暗部会整片消失。 */
export const WALLPAPER_SCRIM = 'rgb(10, 10, 12)'

/** 壁纸模式下唯一的那支字色。组件里少数把"纸色键"当字色用的地方（如 Dialog 标题）显式取它。 */
export const WALLPAPER_INK = 'rgb(255, 255, 255)'

/**
 * 歌词页「非当前行」那一档（壁纸模式专用）。
 *
 * 为什么不能沿用主题的灰阶：壁纸模式把 c-000~c-1000 整条换成"白 @0.20~1.00"，
 * 非当前行读的 `c-350` 落在 0.48、译文 `c-300` 落在 0.44，再乘页面上那层 0.6，
 * 屏上只剩 0.29 / 0.26 —— 对着默认柔光 0.55 的场（L*46）是 **1.87 / 1.61**，用户的原话是"看不清"。
 *
 * 为什么也不直接抬 `c-350` / `c-300`：那是全局灰阶，列表副标题、说明文字、时间戳都在用；
 * 为歌词把整条阶梯提亮，全 App 的层次会一起塌。所以这一档由歌词页自己带（见 Vertical/Lyric.tsx），
 * 只在那棵子树里换颜料，不碰主题键。
 *
 * 取值：颜料 × 页面 opacity 0.72。
 *   - 正文 0.98 → 屏上 0.706，最坏场 3.11:1（过大字号 3.0 那条线），L*86
 *   - 译文 0.74 → 屏上 0.533，2.45:1，L*77.5
 * 同场对照：当前行 1.00 → 4.48:1 / L*100，当前行译文 0.80 → 3.51:1 / L*90.5。
 * 也就是"看清了 65%，但比当前行仍暗 14 个 L*"，两个要求同时成立。
 * 要再拉开差距就压 `WALLPAPER_LYRIC_OPACITY`（0.66 起会跌破 3.0，账记在这里）。
 */
export const WALLPAPER_LYRIC_INK = 'rgba(255, 255, 255, 0.98)'
export const WALLPAPER_LYRIC_TRANSLATION_INK = 'rgba(255, 255, 255, 0.74)'
export const WALLPAPER_LYRIC_OPACITY = 0.72

/**
 * 歌词页「当前行」的描边（壁纸模式专用）。
 *
 * 当前行读 `c-primary`，壁纸模式下它就是 `WALLPAPER_INK` —— **rgb(255,255,255)，色值到顶了**，
 * 再想让它"更亮/更浓"在数学上已经不存在那个方向。还能加深的只剩笔画外面那一圈暗部：
 *
 * 主题默认那条文字阴影是 0.65 / 半径 2 / 偏移 0.2，压在照片的局部高光上几乎看不出；
 * 这里换成 0.90 / 半径 3.5 / 偏移 0.5~0.6，笔画外沿会多出一圈实暗环。
 * 视觉上这一行就从"一层薄白"变成"带黑边的一笔"，高光被托住、也才压得住亮照片。
 *
 * 只给当前行用。非当前行一个像素都没动（它走上面 `WALLPAPER_LYRIC_INK` 那一档）。
 * 刻意不读 `useTextShadow()`：那是给普通主题的全局开关，壁纸模式当前的这一行需要恒定托底。
 */
export const WALLPAPER_LYRIC_ACTIVE_SHADOW = {
  color: 'rgba(0, 0, 0, 0.90)',
  offset: { width: 0.5, height: 0.6 },
  radius: 3.5,
}

/**
 * 柔光强度的默认值与上限。
 *
 * 0.55 是照"最坏那张图"定的：纯白照片压 0.55 之后场约 L*46，白字压在上面 4.6:1，
 * 正好过正文那条 4.5 的线（0.45 只有 3.2，0.60 有 5.3）。真实照片绝大多数比纯白暗得多，
 * 所以这个值在观感上还给照片留了 45% 的亮度 —— 想再看见图一点可以往下调，
 * 那条文字阴影是第二道保险（局部高光上兜住笔画边缘）。
 */
export const DEFAULT_WALLPAPER_VEIL = 0.55
export const MAX_WALLPAPER_VEIL = 0.85

export const clampWallpaperVeil = (value: unknown) => {
  const num = Number(value)
  if (!Number.isFinite(num)) return DEFAULT_WALLPAPER_VEIL
  return Math.min(MAX_WALLPAPER_VEIL, Math.max(0, num))
}

const ink = (alpha: number) => `rgba(255, 255, 255, ${alpha.toFixed(2)})`

/**
 * 灰阶阶梯：c-000 ~ c-1000。
 *
 * 这条阶梯在主题里的语义是**"与底色的对比度"**，不是"明度"：亮色主题里 1000 最深（近黑），
 * 暗色主题里 1000 最亮（近白）—— 两头都是"最跳"的那一档。所以换成白 alpha 时不用分亮暗主题，
 * 直接把序号当强度用，两套主题同一条映射都是对的。
 *
 * 系数 0.20 + 0.04i：c-000 落在 0.20（几乎只是底噪），c-450（次级说明文字）0.56，
 * c-850（主文字）0.88，c-1000 满白。
 */
const RAMP_KEYS = [
  'c-000', 'c-050', 'c-100', 'c-150', 'c-200', 'c-250', 'c-300', 'c-350', 'c-400',
  'c-450', 'c-500', 'c-550', 'c-600', 'c-650', 'c-700', 'c-750', 'c-800', 'c-850',
  'c-900', 'c-950', 'c-1000',
] as const

const rgbRxp = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/

const toRgb = (css: string): number[] | null => {
  const matched = rgbRxp.exec(css.trim())
  if (!matched) return null
  return [Number(matched[1]), Number(matched[2]), Number(matched[3])]
}

const mix = (from: number[], to: number[], ratio: number) =>
  from.map((value, index) => Math.round(value + (to[index] - value) * ratio))

const css = (rgb: number[], alpha: number) =>
  alpha >= 1
    ? `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`
    : `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha.toFixed(2)})`

/**
 * 把主题的 `c-primary-light-*` / `c-primary-dark-*` 两族反转。
 *
 * 这两族的命名语义同样是"相对底色"：`light-N` 往底色里退（亮主题=往白走，所以 light-1000 就是纸面白），
 * `dark-N` 从底色里跳出来（亮主题=往黑走）。壁纸模式把底从"纸面"换成了"照片 + 柔光"，
 * 方向整个翻过来，所以两族要交换方向：
 *
 *   light-N  →  主色往**黑**走 N/10     （亮主题里它是"纸面"，这里得是"暗面"）
 *   dark-N   →  主色往**白**走 N/10     （亮主题里它是"墨色"，这里得是"亮墨"）
 *
 * 不翻会怎样：Dialog 的头部条 `c-primary-light-100-alpha-100` 是一块近白的底板，
 * 而壁纸模式下标题是白字 —— 一整条白底白字。这类"浅色键当底色"的地方遍布弹层与列表头，
 * 一个个改不可能改全，只能在这一层整族翻。
 *
 * alpha 命名是反的（alpha-900 = 0.10），照主题自己的规矩来。
 */
const buildPrimaryFamilies = (primary: unknown) => {
  const base = typeof primary == 'string' ? toRgb(primary) : null
  const families: Record<string, string> = {}
  if (base == null) return families
  const WHITE = [255, 255, 255]
  const BLACK = [0, 0, 0]

  for (let step = 1; step <= 10; step++) {
    const n = step * 100
    const raised = mix(base, WHITE, step / 10)
    const sunk = mix(base, BLACK, step / 10)
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
 * 强调色抽成白的那一族。
 *
 * 只要壁纸模式在生效，这一族就恒为白 —— 与"图有没有铺到播控页"（applyToPlayer / 播控页背景）
 * 无关。这个"无关"是刻意的：applyToPlayer 是播控页的一个可选项，它一变就整棵树重拼主题，
 * 若强调色还挂在它身上，用户每切一次播控页背景，整个 App（首页、设置页、列表选中态、图标）
 * 的强调色就跟着翻一次 —— 一个播放页的选项去改主界面的配色，读起来像 bug。
 *
 * 除了这条一致性，白本身还有两条理由：**照片是不可预测的，而强调色是主题自带的一支彩色**。
 * 绿主题压上一张草地、橙主题压上一张落日，撞成同色系就是一整片看不出对比的颜色；白永远不会
 * 跟图撞成那样，而且它跟这里其它字色是同一支（WALLPAPER_INK），一眼看过去是一家人。
 *
 * 只抽"强调色自己"这三支：c-primary、它的 alpha 族、以及 dark 族（壁纸模式下 dark = 往白走，
 * 本来就该是亮的那支）。light 族不动 —— 它在这套反转里是"暗面"，诸如弹窗头部那条
 * `c-primary-light-100-alpha-100` 靠它压出一块深底再摆白字；换成白就是白底白字。
 */
const buildInkAccentFamilies = () => {
  const families: Record<string, string> = {
    'c-primary': WALLPAPER_INK,
  }
  // buildPrimaryFamilies 不产 c-primary 自己那支 alpha 族，这里补上（命名同样是反的）
  for (let alphaStep = 1; alphaStep <= 9; alphaStep++) {
    families[`c-primary-alpha-${alphaStep * 100}`] = ink((1000 - alphaStep * 100) / 1000)
  }
  const raised = buildPrimaryFamilies(WALLPAPER_INK)
  for (const [key, value] of Object.entries(raised)) {
    if (key.includes('-light-')) continue
    families[key] = value
  }
  return families
}

const buildOverrides = () => {
  const colors: Record<string, string> = {
    // 面：全透明。壁纸要真的落到所有白底下面，不能被任何一层不透明的同色壳子挡住
    'c-content-background': 'transparent',
    'c-main-background': 'transparent',

    // 字：只有白这一套。层次靠上面那条阶梯与下面的阴影
    'c-font': WALLPAPER_INK,
    'c-font-label': ink(0.78),
    'c-primary-font': WALLPAPER_INK,
    'c-primary-font-hover': ink(0.90),
    'c-primary-font-active': ink(0.86),
    'c-button-font': ink(0.92),
    'c-button-font-selected': WALLPAPER_INK,

    // 线：白线才在照片上看得见
    'c-border-background': ink(0.18),
    'c-list-header-border-bottom': ink(0.12),

    // 浅色块 → 白玻璃。主题那支"浅色淡彩"压在照片上是一块脏色，且白字在上面对比不足
    'c-primary-background': ink(0.14),
    'c-primary-background-hover': ink(0.20),
    'c-primary-background-active': ink(0.26),
    'c-primary-input-background': ink(0.12),
    'c-button-background': ink(0.16),
    'c-button-background-hover': ink(0.22),
    'c-button-background-active': ink(0.28),
    // 碟片垫（PlayDetail / PlayerOverlay）：整族反转之后它是一块近乎不透明的暗板，
    // 压在照片上会糊成一大块黑；这里单独改成薄白玻璃，碟片轮廓才立得住
    'c-primary-light-900-alpha-200': ink(0.10),

    // 进度条：主题把这几支放在**浅**族里（主色往暗面走 10~40%），在白底上是一条淡彩槽。
    // 壁纸模式的浅族是"深色面"（见 buildPrimaryFamilies），拿它画进度条就是在照片上压一条
    // 暗色彩槽 —— 控制栏那条进度条被读成"还是之前的主题色"正是这个来路。
    // 这里只换颜料、不动阶梯：alpha 全部沿用主题自己的取值，"槽 < 缓冲 < 已播 < 圆点"一字未改。
    'c-primary-light-300-alpha-800': ink(0.20), // 槽（ProgressBar.DefaultBar）
    'c-primary-light-400-alpha-700': ink(0.30), // 缓冲
    'c-primary-light-100-alpha-400': ink(0.60), // 已播
    'c-primary-light-100-alpha-600': ink(0.40), // 拖拽时的目标段
    'c-primary-light-100-alpha-700': ink(0.30), // 拖拽时的已播段 / 竖屏分页指示器
    'c-primary-light-100-alpha-800': ink(0.20), // 横屏播放页（Progress.tsx）的拖拽目标段
    'c-primary-light-200-alpha-900': ink(0.10), // 横屏播放页的拖拽已播段
    'c-primary-light-600-alpha-900': ink(0.10), // 横屏播放页的缓冲
    'c-primary-light-100': WALLPAPER_INK, // 拖拽圆点

    // 文字阴影：Text / Icon 共用的那一条。主题给的是 0.20 的彩色阴影，压在照片上等于没有；
    // 壁纸模式必须是一支实黑，才能在局部高光上把笔画边缘托出来
    'c-primary-dark-300-alpha-800': 'rgba(0, 0, 0, 0.65)',
  }

  RAMP_KEYS.forEach((key, index) => {
    colors[key] = ink(0.20 + 0.04 * index)
  })

  return colors
}

const WALLPAPER_COLORS = buildOverrides()

/**
 * 把主题换成壁纸模式那一套。
 *
 * 顺序：先整族反转 primary 色阶（它要覆盖 110 个键，只能算），再盖上强调色那族白，
 * 最后是手工挑的那批（逐处核过的，包括碟片垫与阴影色，必须赢）。
 *
 * 强调色一律抽白（见 buildInkAccentFamilies）—— 主题自己那支彩色在这里没有立足之地：
 * 壁纸模式下底是一张不可预测的照片，而强调色要跟它共存于每一屏。
 * light 族例外：它在这套反转里是"暗面"，仍按主题自己那支主色算；
 * `isDark` / `bg-image` 这类非颜色键则原样穿过。
 *
 * `isDark` 一并翻真：components/common/StatusBar.tsx 读 context 里这个布尔决定状态栏图标亮暗，
 * 翻它一个就把图标带对了 —— 场上恒为深色，白字恒亮。
 */
export const buildWallpaperTheme = <T extends object>(base: T): T => {
  // ActiveTheme 上的键既有 string 也有 boolean（isDark / is-wallpaper），按 unknown 读写、只动字符串键
  const next: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  next.isDark = true
  next['is-wallpaper'] = true

  const overrides = { ...buildPrimaryFamilies(next['c-primary']), ...buildInkAccentFamilies(), ...WALLPAPER_COLORS }
  for (const [key, value] of Object.entries(overrides)) {
    // 主题里没有这个键就跳过，不凭空造键：造出来的键没人读，只会让 theme 对象越来越像垃圾场
    if (typeof next[key] !== 'string') continue
    next[key] = value
  }
  return next as T
}
