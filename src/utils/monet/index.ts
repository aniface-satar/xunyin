import { InteractionManager } from 'react-native'
import settingState from '@/store/setting/state'
import { getArgbPixels } from '@/utils/nativeModules/palette'
import { createCoverPalette, normalizeCoverAlgo } from './coverPalette'
import { createIdleRunner } from './analysisGate'
import { buildCoverTexture } from './texture'

export { type CoverSurface } from './surface'
export { TEXTURE_OUT_HEIGHT, textureWidthFor } from './texture'
export { type CoverAlgo } from './coverPalette'

// 直接写 `export const getCoverSurface = palette.getCoverSurface` 会报
// @typescript-eslint/unbound-method（把对象方法当函数引用导出），所以每个导出都包一层箭头。
//
// 这一层是全模块唯一允许 import react-native 的地方，所以"什么时候允许跑量化"的接线也只活在这里：
// 量化整段同步（128×86 封面实测 143ms），落在播放页那段 JS 驱动的 800ms 展开动画里就是掉帧，
// 于是把它排到没有交互在手之后。兜底定时器（见 ANALYSIS_IDLE_FALLBACK_MS）管的是另一半风险：
// 交互句柄若因为别的功能泄漏而长期不清，颜色不能永远不来。
const scheduleIdle = createIdleRunner({
  runAfterInteractions: cb => InteractionManager.runAfterInteractions(cb),
  setTimeoutFn: (cb, ms) => setTimeout(cb, ms),
  clearTimeoutFn: handle => {
    clearTimeout(handle as ReturnType<typeof setTimeout>)
  },
})

const palette = createCoverPalette(getArgbPixels, buildCoverTexture, undefined, scheduleIdle)

// 算法在这层读、而不是下沉到配色层或那个 store：
// coverPalette 要能被 node --test 直接加载（不许 import react-native 与 @/ 别名），
// 而 store 那条重试/宽限定时器链每多一个输入字段就要多改三处判据 —— 切算法本来就要清缓存重发一次取色，
// 用得上现成的那条路，不需要第四个输入。
// 老存储里没有这个键也不用在这里兜：setting 状态是 `{ ...defaultSetting }` 展开的，
// 缺键那一格拿到的就是 defaultSetting 里的 'blur'（② 落地那批一起定的默认档）。
export const getCoverSurface = async(picUrl: string | null | undefined, fontColor: string) =>
  palette.getCoverSurface(picUrl, fontColor, normalizeCoverAlgo(settingState.setting['theme.dynamicBgAlgorithm']))

export const getCoverTexture = async(picUrl: string | null | undefined, fontColor: string, outWidth: number) =>
  palette.getCoverTexture(picUrl, fontColor, outWidth)

// 包一层箭头的原因同上面两条导出（@typescript-eslint/unbound-method）
export const getCoverAverageArgb = async(picUrl: string | null | undefined) =>
  palette.getCoverAverageArgb(picUrl)

export const clearCoverPaletteCache = () => {
  palette.clearCache()
}
