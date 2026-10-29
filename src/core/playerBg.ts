/**
 * 播控页背景：三选一（纯白 / 动态背景 / 跟随自定义背景）。
 *
 * 为什么不再多存一个 `theme.playerBgMode`：播控页背景的三种落点原本就由两个布尔拼得出来 ——
 * `theme.dynamicBg`（封面那支）和 `theme.customBg.applyToPlayer`（壁纸那支），
 * 全项目读它们的组件（PlayerOverlay / GlassBackdrop / warmCurrentBackdrop / preloadNextMusic）
 * 一个都不用改。多存一个枚举就要在启动迁移、备份导入、多端同步三处同时照顾新键，
 * 而它携带的信息量并不比那两个布尔的组合更多。
 *
 * 于是这里只做一件事：把"三选一"翻译成那两个布尔，并保持它们互斥 ——
 * 两个同时开着时播控页铺的是封面色，壁纸那一支就是死设置，用户看着像开关失灵。
 *
 * 纯白那一档 = 两支都关：不铺封面取色、也不铺图，播控页退回主题本身的 `c-content-background`
 * （浅色主题下就是白，暗色主题下跟着暗）。想让它无条件刷成 #fff 得连播控页的墨色一起换，
 * 属于另一件事，这里不做。
 *
 * 壁纸模式下"纯白"这一档不可落：那套主题给播控页的是恒白字 + 透明面，纯白底等于白字压白底。
 * 所以两个方向都有闸 —— 没图时不许选"跟随"，有壁纸时不许选"纯白"，见 setPlayerBgMode。
 */
import settingState from '@/store/setting/state'
import { updateSetting } from '@/core/common'
import { setCustomBgApplyToPlayer } from '@/core/customBg'
import { refreshTheme } from '@/core/theme'
import { clearCoverPaletteCache } from '@/utils/monet'
import { resetCoverBackdrop } from '@/utils/monet/coverBackdropStore'

export type PlayerBgMode = 'white' | 'dynamic' | 'custom'

/** 取色层（缓存 + "问过没有"的账）和已发布的那一份背景层是两套记忆，只清一套就会错位。 */
const republishBackdrop = () => {
  clearCoverPaletteCache()
  resetCoverBackdrop()
}

/** 当前生效的那一档。dynamicBg 优先：它开着时封面色盖在最上面，壁纸铺不进去。 */
export const getPlayerBgMode = (): PlayerBgMode => {
  const setting = settingState.setting
  if (setting['theme.dynamicBg']) return 'dynamic'
  return setting['theme.customBg.applyToPlayer'] ? 'custom' : 'white'
}

export const setPlayerBgMode = (mode: PlayerBgMode) => {
  // 两个方向都不允许落到"空"的那一档：
  // 没有自定义背景可跟时选 custom，播控页上没有图；壁纸模式下选 white，播控页是白字压白底 —— 都等于背景消失
  if (mode == 'custom' && !settingState.setting['theme.customBg.enabled']) return
  if (mode == 'white' && settingState.setting['theme.customBg.enabled']) return

  updateSetting({ 'theme.dynamicBg': mode == 'dynamic' })
  setCustomBgApplyToPlayer(mode == 'custom')
  republishBackdrop()
  // applyToPlayer 决定主题里 bg-image 拼的是哪张图，光改 setting 不会重拼主题
  void refreshTheme()
}

export const setPlayerBgAlgorithm = (algorithm: LX.AppSetting['theme.dynamicBgAlgorithm']) => {
  updateSetting({ 'theme.dynamicBgAlgorithm': algorithm })
  republishBackdrop()
}
